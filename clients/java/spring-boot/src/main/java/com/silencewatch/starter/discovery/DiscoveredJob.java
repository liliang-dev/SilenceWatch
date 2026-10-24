/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.discovery;

import java.time.Duration;
import java.util.Objects;

/**
 * A scheduled job found in the application, in the form SilenceWatch expects.
 *
 * <p>The {@code key} is the stable identity: it must survive restarts,
 * redeployments and renames, because it is what ties a running job to its
 * history on the server. For Spring it is
 * {@code com.acme.jobs.BackupJob#run}; for Quartz, {@code group.jobName}.
 *
 * @param key       stable identity
 * @param name      human-readable name shown in the UI
 * @param cron      cron expression, or {@code null} for interval jobs
 * @param interval  interval between runs, or {@code null} for cron jobs
 * @param timezone  IANA zone the cron expression is evaluated in
 * @param grace     tolerated delay before the job is considered down
 */
public record DiscoveredJob(
        String key,
        String name,
        String cron,
        Duration interval,
        String timezone,
        Duration grace) {

    public DiscoveredJob {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(name, "name");
        if ((cron == null) == (interval == null)) {
            throw new IllegalArgumentException(
                    "job " + key + " must have exactly one of a cron expression or an interval");
        }
    }

    public static DiscoveredJob cron(String key, String name, String cron, String timezone, Duration grace) {
        return new DiscoveredJob(key, name, cron, null, timezone, grace);
    }

    public static DiscoveredJob interval(String key, String name, Duration interval, Duration grace) {
        return new DiscoveredJob(key, name, null, interval, null, grace);
    }
}
