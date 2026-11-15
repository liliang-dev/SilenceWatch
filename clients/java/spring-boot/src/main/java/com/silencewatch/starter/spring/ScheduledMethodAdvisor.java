/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.spring;

import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.client.HeartbeatSender;
import java.lang.reflect.Method;
import org.springframework.aop.support.StaticMethodMatcherPointcutAdvisor;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.core.annotation.MergedAnnotations;
import org.springframework.core.annotation.MergedAnnotations.SearchStrategy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.annotation.Schedules;

/**
 * Applies {@link HeartbeatMethodInterceptor} to every {@code @Scheduled} method.
 *
 * <p>Plain Spring AOP — an Advisor bean picked up by the auto-proxy creator, no
 * AspectJ weaver and therefore no extra dependency. Matching on the annotation is
 * what yields the exact class and method, and therefore the same stable key the
 * discoverer declared to the server.
 *
 * <p>There are two of them. Most methods get the {@linkplain #unlocked outermost}
 * one. A method behind ShedLock's {@code @SchedulerLock} gets the
 * {@linkplain #locked innermost} one instead: ShedLock applies its lock with an
 * advisor of its own, and on an instance that does not get the lock that advisor
 * returns without calling the method. Wrapped outside it, the heartbeat would
 * report a run that never happened, on every such instance, and the check would
 * stay up while the job ran nowhere.
 */
public class ScheduledMethodAdvisor extends StaticMethodMatcherPointcutAdvisor {

    private static final long serialVersionUID = 1L;

    /** ShedLock's annotation, matched by name so that ShedLock stays optional. */
    public static final String SHEDLOCK_ANNOTATION = "net.javacrumbs.shedlock.spring.annotation.SchedulerLock";

    private final boolean locked;

    private ScheduledMethodAdvisor(HeartbeatSender sender, SilenceWatchProperties properties, boolean locked) {
        super(new HeartbeatMethodInterceptor(sender, properties.isReportStart(), locked));
        this.locked = locked;
        // Unlocked: outermost, so the measured duration includes whatever
        // @Transactional and friends add, because that is what the job costs.
        // Locked: innermost, inside ShedLock's advisor (whose default order is
        // also LOWEST_PRECEDENCE and which is registered first, from the user's
        // own @EnableSchedulerLock), so only a run that holds the lock reports.
        setOrder(locked ? Ordered.LOWEST_PRECEDENCE : Ordered.HIGHEST_PRECEDENCE + 100);
    }

    /** The advisor for {@code @Scheduled} methods without a ShedLock lock. */
    public static ScheduledMethodAdvisor unlocked(HeartbeatSender sender, SilenceWatchProperties properties) {
        return new ScheduledMethodAdvisor(sender, properties, false);
    }

    /** The advisor for {@code @Scheduled} methods behind ShedLock's {@code @SchedulerLock}. */
    public static ScheduledMethodAdvisor locked(HeartbeatSender sender, SilenceWatchProperties properties) {
        return new ScheduledMethodAdvisor(sender, properties, true);
    }

    public boolean isLocked() {
        return locked;
    }

    @Override
    public boolean matches(Method method, Class<?> targetClass) {
        boolean scheduled = AnnotatedElementUtils.hasAnnotation(method, Scheduled.class)
                || AnnotatedElementUtils.hasAnnotation(method, Schedules.class);
        return scheduled && isShedLocked(method) == locked;
    }

    static boolean isShedLocked(Method method) {
        return MergedAnnotations.from(method, SearchStrategy.TYPE_HIERARCHY).isPresent(SHEDLOCK_ANNOTATION);
    }
}
