/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.client.SilenceWatchClient;
import com.silencewatch.starter.discovery.DiscoveredJob;
import com.silencewatch.starter.discovery.ScheduledTaskDiscoverer;
import com.silencewatch.starter.spring.ScheduledMethodAdvisor;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Role;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.config.ScheduledTaskHolder;

/**
 * Wires the starter.
 *
 * <p>Nothing is created unless {@code silencewatch.enabled} is true <em>and</em>
 * an API key is present: {@code silencewatch.enabled=false} leaves an application
 * exactly as it would be without the dependency — no discovery, no proxying of
 * scheduled methods, no threads, no beans.
 */
@AutoConfiguration(after = AopAutoConfiguration.class)
@EnableConfigurationProperties(SilenceWatchProperties.class)
@ConditionalOnProperty(prefix = "silencewatch", name = "enabled", havingValue = "true", matchIfMissing = true)
public class SilenceWatchAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SilenceWatchAutoConfiguration.class);

    @Bean
    @ConditionalOnMissingBean
    public SilenceWatchClient silenceWatchClient(SilenceWatchProperties properties) {
        if (!properties.isUsable()) {
            log.warn("SilenceWatch is enabled but silencewatch.api-key is not set: "
                    + "no job will be declared and no heartbeat will be sent");
        }
        return new SilenceWatchClient(properties);
    }

    @Bean(destroyMethod = "destroy")
    @ConditionalOnMissingBean
    public HeartbeatSender silenceWatchHeartbeatSender(
            SilenceWatchClient client, SilenceWatchProperties properties) {
        return new HeartbeatSender(client, properties);
    }

    /**
     * Discovery of Spring {@code @Scheduled} methods. Registered as a
     * {@link Supplier} so the registrar can collect any number of discoverers
     * (Spring, Quartz, and whatever comes next) without knowing about them.
     */
    @Bean
    @ConditionalOnProperty(
            prefix = "silencewatch",
            name = "discover-spring-tasks",
            havingValue = "true",
            matchIfMissing = true)
    public Supplier<List<DiscoveredJob>> silenceWatchSpringTaskDiscoverer(
            ObjectProvider<ScheduledTaskHolder> holders,
            SilenceWatchProperties properties,
            Environment environment) {
        // Resolved when discovery runs, not when this bean is created: Spring
        // registers its scheduled tasks during context refresh, so anything read
        // here and now would see an empty scheduler.
        return () -> {
            List<ScheduledTaskHolder> resolved = new ArrayList<>();
            holders.orderedStream().forEach(resolved::add);
            return new ScheduledTaskDiscoverer(resolved, properties, environment).discover();
        };
    }

    /**
     * Sends heartbeats around {@code @Scheduled} methods. This is plain Spring AOP
     * — an Advisor bean picked up by the auto-proxy creator Spring Boot registers
     * by default — so it adds no AspectJ dependency.
     *
     * <p>An application that turns proxying off with {@code spring.aop.auto=false}
     * gets its jobs declared but not their heartbeats, which would look like every
     * job going silent at once. That deserves to be said out loud rather than
     * discovered during an incident.
     */
    @Bean
    @ConditionalOnMissingBean
    // Infrastructure role, like Spring's own transaction advisor: without it the
    // InfrastructureAdvisorAutoProxyCreator that Boot registers when AspectJ is
    // absent would ignore this advisor, and no heartbeat would ever be sent.
    @Role(BeanDefinition.ROLE_INFRASTRUCTURE)
    public ScheduledMethodAdvisor silenceWatchScheduledMethodAdvisor(
            HeartbeatSender sender, SilenceWatchProperties properties, Environment environment) {
        if (!environment.getProperty("spring.aop.auto", Boolean.class, Boolean.TRUE)) {
            log.warn("spring.aop.auto is false: SilenceWatch will declare your @Scheduled jobs but "
                    + "cannot send their heartbeats, so they will appear to have stopped running. "
                    + "Enable spring.aop.auto, or ping the check URLs yourself.");
        }
        return new ScheduledMethodAdvisor(sender, properties);
    }

    @Bean
    @ConditionalOnMissingBean
    public SilenceWatchRegistrar silenceWatchRegistrar(
            SilenceWatchProperties properties,
            SilenceWatchClient client,
            HeartbeatSender sender,
            ObjectProvider<Supplier<List<DiscoveredJob>>> discoverers) {
        return new SilenceWatchRegistrar(properties, client, sender, discoverers);
    }
}
