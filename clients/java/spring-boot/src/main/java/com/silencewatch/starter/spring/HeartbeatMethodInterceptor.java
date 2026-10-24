/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.spring;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.discovery.ScheduledTaskDiscoverer;
import java.lang.reflect.Method;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;

/**
 * Sends a heartbeat around each run of a scheduled method.
 *
 * <p>Transparent by construction: the invocation is called exactly once, its
 * result is returned untouched, and its exception is rethrown unchanged.
 * Everything SilenceWatch does is wrapped so that it cannot fail into the
 * application — a monitoring library that breaks a backup job is worse than no
 * monitoring at all.
 */
public class HeartbeatMethodInterceptor implements MethodInterceptor {

    private final HeartbeatSender sender;
    private final boolean reportStart;

    public HeartbeatMethodInterceptor(HeartbeatSender sender, boolean reportStart) {
        this.sender = sender;
        this.reportStart = reportStart;
    }

    @Override
    public Object invoke(MethodInvocation invocation) throws Throwable {
        Method method = invocation.getMethod();
        Object target = invocation.getThis();
        String key = ScheduledTaskDiscoverer.keyOf(
                target == null ? method.getDeclaringClass() : target.getClass(), method);

        if (!sender.knows(key)) {
            // Not a declared job (registration failed, or SilenceWatch is off):
            // run it exactly as if this interceptor were not here.
            return invocation.proceed();
        }

        if (reportStart) {
            safely(() -> sender.started(key));
        }

        long startedAt = System.nanoTime();
        try {
            Object result = invocation.proceed();
            safely(() -> sender.succeeded(key, elapsedMs(startedAt)));
            return result;
        } catch (Throwable failure) {
            safely(() -> sender.failed(key, elapsedMs(startedAt)));
            throw failure;
        }
    }

    private static long elapsedMs(long startedAtNanos) {
        return (System.nanoTime() - startedAtNanos) / 1_000_000;
    }

    /**
     * Last line of defence. The sender already swallows everything; this makes it
     * impossible for a change there to ever surface in a user's job.
     */
    private static void safely(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException | LinkageError ignored) {
            // Intentionally ignored: monitoring never breaks the job.
        }
    }
}
