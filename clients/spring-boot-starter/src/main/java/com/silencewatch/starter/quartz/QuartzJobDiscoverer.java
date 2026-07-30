/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.quartz;

import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.discovery.DiscoveredJob;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.quartz.CalendarIntervalTrigger;
import org.quartz.CronTrigger;
import org.quartz.JobKey;
import org.quartz.Scheduler;
import org.quartz.SchedulerException;
import org.quartz.SimpleTrigger;
import org.quartz.Trigger;
import org.quartz.impl.matchers.GroupMatcher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Finds Quartz jobs and the schedule of their triggers.
 *
 * <p>A Quartz job's identity is {@code group.name}, which is stable by design —
 * it is how Quartz itself finds the job in its store.
 *
 * <p>A job with several triggers is declared once, from the trigger that fires
 * most often: that is the deadline a missed run would breach first.
 */
public class QuartzJobDiscoverer {

    private static final Logger log = LoggerFactory.getLogger(QuartzJobDiscoverer.class);

    private final Scheduler scheduler;
    private final SilenceWatchProperties properties;

    public QuartzJobDiscoverer(Scheduler scheduler, SilenceWatchProperties properties) {
        this.scheduler = scheduler;
        this.properties = properties;
    }

    public List<DiscoveredJob> discover() {
        List<DiscoveredJob> jobs = new ArrayList<>();

        try {
            for (JobKey jobKey : scheduler.getJobKeys(GroupMatcher.anyJobGroup())) {
                try {
                    DiscoveredJob job = describe(jobKey);
                    if (job != null) {
                        jobs.add(job);
                    }
                } catch (SchedulerException | RuntimeException cause) {
                    log.warn("Skipping Quartz job {}: {}", keyOf(jobKey), cause.toString());
                }
            }
        } catch (SchedulerException | RuntimeException cause) {
            log.warn("Could not list Quartz jobs: {}", cause.toString());
            return List.of();
        }

        log.info("SilenceWatch discovered {} Quartz job(s)", jobs.size());
        return jobs;
    }

    private DiscoveredJob describe(JobKey jobKey) throws SchedulerException {
        List<? extends Trigger> triggers = scheduler.getTriggersOfJob(jobKey);
        if (triggers.isEmpty()) {
            log.debug("Ignoring Quartz job {}: no trigger", keyOf(jobKey));
            return null;
        }

        String key = keyOf(jobKey);
        String name = jobKey.getName();
        Duration grace = properties.getDefaultGrace();

        DiscoveredJob mostFrequent = null;
        for (Trigger trigger : triggers) {
            DiscoveredJob candidate = describe(key, name, trigger, grace);
            if (candidate == null) {
                continue;
            }
            // Cron wins over an interval only if we have nothing else: comparing a
            // cron to an interval is not meaningful, so first-wins for cron and
            // shortest-wins for intervals.
            if (mostFrequent == null) {
                mostFrequent = candidate;
            } else if (candidate.interval() != null
                    && mostFrequent.interval() != null
                    && candidate.interval().compareTo(mostFrequent.interval()) < 0) {
                mostFrequent = candidate;
            }
        }

        if (mostFrequent == null) {
            log.debug("Ignoring Quartz job {}: no supported trigger type", key);
        }
        return mostFrequent;
    }

    private DiscoveredJob describe(String key, String name, Trigger trigger, Duration grace) {
        if (trigger instanceof CronTrigger cronTrigger) {
            String zone = cronTrigger.getTimeZone() == null
                    ? properties.getTimezone()
                    : cronTrigger.getTimeZone().getID();
            return DiscoveredJob.cron(key, name, cronTrigger.getCronExpression(), zone, grace);
        }

        if (trigger instanceof SimpleTrigger simpleTrigger && simpleTrigger.getRepeatInterval() > 0) {
            return DiscoveredJob.interval(key, name, Duration.ofMillis(simpleTrigger.getRepeatInterval()), grace);
        }

        if (trigger instanceof CalendarIntervalTrigger calendarTrigger) {
            Duration interval = toDuration(calendarTrigger);
            return interval == null ? null : DiscoveredJob.interval(key, name, interval, grace);
        }

        return null;
    }

    /**
     * Calendar intervals are approximated in seconds. A month is not a fixed
     * length, but a monitoring deadline does not need to be exact — it needs to be
     * roughly right and never surprising.
     */
    private Duration toDuration(CalendarIntervalTrigger trigger) {
        long count = trigger.getRepeatInterval();
        return switch (trigger.getRepeatIntervalUnit()) {
            case SECOND -> Duration.ofSeconds(count);
            case MINUTE -> Duration.ofMinutes(count);
            case HOUR -> Duration.ofHours(count);
            case DAY -> Duration.ofDays(count);
            case WEEK -> Duration.ofDays(count * 7);
            case MONTH -> Duration.ofDays(count * 30);
            case YEAR -> Duration.ofDays(count * 365);
            default -> null;
        };
    }

    /** The identity used for a Quartz job, shared with the listener. */
    public static String keyOf(JobKey jobKey) {
        return jobKey.getGroup() + "." + jobKey.getName();
    }
}
