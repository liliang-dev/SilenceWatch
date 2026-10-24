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
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Applies {@link HeartbeatMethodInterceptor} to every {@code @Scheduled} method.
 *
 * <p>Plain Spring AOP — an Advisor bean picked up by the auto-proxy creator, no
 * AspectJ weaver and therefore no extra dependency. Matching on the annotation is
 * what yields the exact class and method, and therefore the same stable key the
 * discoverer declared to the server.
 */
public class ScheduledMethodAdvisor extends StaticMethodMatcherPointcutAdvisor {

    private static final long serialVersionUID = 1L;

    public ScheduledMethodAdvisor(HeartbeatSender sender, SilenceWatchProperties properties) {
        super(new HeartbeatMethodInterceptor(sender, properties.isReportStart()));
        // Outermost: the measured duration should include whatever @Transactional
        // and friends add, because that is what the job actually costs.
        setOrder(Ordered.HIGHEST_PRECEDENCE + 100);
    }

    @Override
    public boolean matches(Method method, Class<?> targetClass) {
        return AnnotatedElementUtils.hasAnnotation(method, Scheduled.class)
                || AnnotatedElementUtils.hasAnnotation(method, org.springframework.scheduling.annotation.Schedules.class);
    }
}
