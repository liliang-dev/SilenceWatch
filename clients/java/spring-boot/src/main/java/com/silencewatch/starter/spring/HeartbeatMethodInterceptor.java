/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.spring;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.discovery.ScheduledTaskDiscoverer;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicBoolean;
import org.aopalliance.intercept.MethodInterceptor;
import org.aopalliance.intercept.MethodInvocation;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

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

    private static final Logger log = LoggerFactory.getLogger(HeartbeatMethodInterceptor.class);

    private final HeartbeatSender sender;
    private final boolean reportStart;
    private final boolean locked;
    private final AtomicBoolean misplacedWarned = new AtomicBoolean();

    public HeartbeatMethodInterceptor(HeartbeatSender sender, boolean reportStart) {
        this(sender, reportStart, false);
    }

    /**
     * @param locked the methods this intercepts are behind ShedLock's
     *     {@code @SchedulerLock}, so this must run inside ShedLock's own advisor
     */
    public HeartbeatMethodInterceptor(HeartbeatSender sender, boolean reportStart, boolean locked) {
        this.sender = sender;
        this.reportStart = reportStart;
        this.locked = locked;
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

        if (locked) {
            safely(() -> warnIfOutsideTheLock(key));
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

    /**
     * Inside ShedLock's advisor, the lock is held by the time this runs. If it is
     * not, ShedLock was configured to apply after this interceptor (a custom
     * {@code @EnableSchedulerLock(order = …)}), and instances that do not get the
     * lock will report runs that did not happen. Said once, at WARN.
     */
    private void warnIfOutsideTheLock(String key) {
        if (misplacedWarned.get() || ShedLockSupport.isLockHeld()) {
            return;
        }
        if (misplacedWarned.compareAndSet(false, true)) {
            log.warn("SilenceWatch runs outside ShedLock's lock for {}: instances that do not get the lock "
                    + "would report a run they skipped. Leave @EnableSchedulerLock's order at its default.",
                    key);
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
