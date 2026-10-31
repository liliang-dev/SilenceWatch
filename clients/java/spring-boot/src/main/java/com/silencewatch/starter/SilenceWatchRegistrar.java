/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.client.SilenceWatchClient;
import com.silencewatch.starter.discovery.CronSupport;
import com.silencewatch.starter.discovery.DiscoveredJob;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.beans.factory.ObjectProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;

/**
 * Declares the discovered jobs once, when the application is ready.
 *
 * <p>The whole promise of the starter is here: add the dependency and an API
 * key, and every scheduled task shows up in SilenceWatch with no manual
 * declaration. One call at startup, and never on the request path.
 *
 * <p>If that call fails, the application is unaffected: it logs a warning and
 * keeps running with no heartbeats, which is the only acceptable failure mode for
 * a monitoring agent.
 */
public class SilenceWatchRegistrar {

    private static final Logger log = LoggerFactory.getLogger(SilenceWatchRegistrar.class);

    private final SilenceWatchProperties properties;
    private final SilenceWatchClient client;
    private final HeartbeatSender sender;
    private final ObjectProvider<Supplier<List<DiscoveredJob>>> discoverers;

    public SilenceWatchRegistrar(
            SilenceWatchProperties properties,
            SilenceWatchClient client,
            HeartbeatSender sender,
            ObjectProvider<Supplier<List<DiscoveredJob>>> discoverers) {
        this.properties = properties;
        this.client = client;
        this.sender = sender;
        this.discoverers = discoverers;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void register() {
        if (!properties.isAutoRegister()) {
            log.info("SilenceWatch auto-registration is disabled; checks must be declared manually");
            return;
        }

        try {
            List<DiscoveredJob> jobs = discover();
            if (jobs.isEmpty()) {
                log.info("SilenceWatch found no scheduled job to declare");
                return;
            }

            List<DiscoveredJob> shared = new ArrayList<>();
            List<DiscoveredJob> perInstance = new ArrayList<>();
            for (DiscoveredJob job : jobs) {
                (properties.isPerInstance(job.key()) ? perInstance : shared).add(job);
            }

            String instanceEnvironment = properties.instanceEnvironment();
            if (!perInstance.isEmpty() && instanceEnvironment == null) {
                // Better one check for all the instances than none at all.
                log.warn("SilenceWatch per-instance-jobs is set but instance-id is missing, or leaves no "
                        + "room in the environment name; {} job(s) are watched as one check for all "
                        + "instances", perInstance.size());
                shared.addAll(perInstance);
                perInstance.clear();
            }

            // Two declarations, each in its own environment: the shared one never
            // orphans another instance's checks, nor this instance's the shared ones.
            Map<String, String> pingKeys = new LinkedHashMap<>(client.sync(shared, properties.getEnvironment()));
            pingKeys.putAll(client.sync(perInstance, instanceEnvironment));
            sender.register(pingKeys);

            if (pingKeys.isEmpty()) {
                log.warn("SilenceWatch declared {} job(s) but received no ping key; "
                        + "heartbeats are disabled until the next restart", jobs.size());
            } else if (perInstance.isEmpty()) {
                log.info("SilenceWatch is watching {} job(s) in environment '{}'",
                        pingKeys.size(), properties.getEnvironment());
            } else {
                log.info("SilenceWatch is watching {} job(s) in environment '{}', {} of them for this "
                                + "instance alone in '{}'",
                        pingKeys.size(), properties.getEnvironment(), perInstance.size(), instanceEnvironment);
            }
        } catch (RuntimeException | LinkageError cause) {
            // Startup must never fail because monitoring could not be set up.
            log.warn("SilenceWatch registration failed; the application continues without heartbeats",
                    cause);
        }
    }

    private List<DiscoveredJob> discover() {
        List<DiscoveredJob> jobs = new ArrayList<>();
        for (Supplier<List<DiscoveredJob>> discoverer : discoverers.orderedStream().toList()) {
            try {
                for (DiscoveredJob job : discoverer.get()) {
                    if (job.cron() != null && !CronSupport.isSupported(job.cron())) {
                        // Sending it would have the server reject the entire
                        // declaration, costing this application all of its
                        // monitoring for the sake of one exotic schedule.
                        log.warn("Not declaring job {}: SilenceWatch cannot evaluate the cron "
                                + "expression \"{}\"", job.key(), job.cron());
                        continue;
                    }
                    jobs.add(job);
                }
            } catch (RuntimeException | LinkageError cause) {
                log.warn("A SilenceWatch job discoverer failed: {}", cause.toString());
            }
        }
        return jobs;
    }
}
