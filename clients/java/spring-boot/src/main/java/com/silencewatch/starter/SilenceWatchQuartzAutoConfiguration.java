/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.discovery.DiscoveredJob;
import com.silencewatch.starter.quartz.QuartzJobDiscoverer;
import com.silencewatch.starter.quartz.SilenceWatchJobListener;
import java.util.List;
import java.util.function.Supplier;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.impl.matchers.EverythingMatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;

/**
 * Quartz support, active only when Quartz is on the classpath and a
 * {@link Scheduler} bean exists.
 *
 * <p>Registering the listener is deferred to an {@link InitializingBean} rather
 * than done inline, so a scheduler that is not yet started (the usual case at
 * context refresh) still gets the listener, and a failure to attach it stays a
 * warning instead of breaking the application context.
 */
@AutoConfiguration(after = SilenceWatchAutoConfiguration.class)
@ConditionalOnClass(Scheduler.class)
@ConditionalOnBean(Scheduler.class)
@ConditionalOnProperty(prefix = "silencewatch", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SilenceWatchQuartzAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SilenceWatchQuartzAutoConfiguration.class);

    @Bean
    @ConditionalOnProperty(
            prefix = "silencewatch",
            name = "discover-quartz-jobs",
            havingValue = "true",
            matchIfMissing = true)
    public Supplier<List<DiscoveredJob>> silenceWatchQuartzDiscoverer(
            Scheduler scheduler, SilenceWatchProperties properties) {
        QuartzJobDiscoverer discoverer = new QuartzJobDiscoverer(scheduler, properties);
        return discoverer::discover;
    }

    @Bean
    public InitializingBean silenceWatchQuartzListenerRegistrar(
            Scheduler scheduler, HeartbeatSender sender, SilenceWatchProperties properties) {
        return () -> {
            try {
                scheduler.getListenerManager().addJobListener(
                        new SilenceWatchJobListener(sender, properties.isReportStart()),
                        EverythingMatcher.allJobs());
                log.debug("SilenceWatch Quartz listener registered");
            } catch (SchedulerException | RuntimeException cause) {
                log.warn("Could not register the SilenceWatch Quartz listener; "
                        + "Quartz jobs will be declared but will not send heartbeats: {}", cause.toString());
            }
        };
    }
}
