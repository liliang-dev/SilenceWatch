/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.discovery;

import com.silencewatch.starter.SilenceWatchProperties;
import java.lang.reflect.Method;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.support.AopUtils;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.config.CronTask;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.FixedRateTask;
import org.springframework.scheduling.config.IntervalTask;
import org.springframework.scheduling.config.ScheduledTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.scheduling.config.Task;
import org.springframework.scheduling.support.ScheduledMethodRunnable;
import org.springframework.util.ClassUtils;

/**
 * Finds every Spring {@code @Scheduled} task in the application.
 *
 * <p>Spring already keeps the register: {@link ScheduledTaskHolder} exposes the
 * tasks it scheduled, with their resolved triggers — resolved being the
 * important part, since {@code @Scheduled(cron = "${backup.cron}")} is a
 * placeholder in the annotation but a real expression in the task.
 *
 * <p>The identity of a job is its declaring class and method
 * ({@code com.acme.jobs.BackupJob#run}). That survives restarts, redeployments
 * and proxying, which is exactly what the server needs to keep history attached
 * to the right check.
 */
public class ScheduledTaskDiscoverer {

    private static final Logger log = LoggerFactory.getLogger(ScheduledTaskDiscoverer.class);

    private final List<ScheduledTaskHolder> holders;
    private final SilenceWatchProperties properties;
    private final Environment environment;

    public ScheduledTaskDiscoverer(
            List<ScheduledTaskHolder> holders,
            SilenceWatchProperties properties,
            Environment environment) {
        this.holders = holders;
        this.properties = properties;
        this.environment = environment;
    }

    public List<DiscoveredJob> discover() {
        List<DiscoveredJob> jobs = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();

        for (ScheduledTaskHolder holder : holders) {
            for (ScheduledTask scheduledTask : holder.getScheduledTasks()) {
                try {
                    DiscoveredJob job = describe(scheduledTask.getTask());
                    if (job == null) {
                        continue;
                    }
                    if (!seen.add(job.key())) {
                        // The same method scheduled twice (two holders, or a
                        // repeated annotation): one check, not two.
                        continue;
                    }
                    jobs.add(job);
                } catch (RuntimeException cause) {
                    // One unreadable task must not cost us the other ninety-nine.
                    log.warn("Skipping a scheduled task SilenceWatch could not describe: {}",
                            cause.toString());
                }
            }
        }

        log.info("SilenceWatch discovered {} Spring scheduled task(s)", jobs.size());
        return jobs;
    }

    private DiscoveredJob describe(Task task) {
        ScheduledMethodRunnable runnable = ScheduledRunnables.unwrap(task.getRunnable());
        if (runnable == null) {
            // Programmatically registered tasks (SchedulingConfigurer, lambdas)
            // have no stable identity to key on, so they are left alone.
            log.debug("Ignoring scheduled task {}: not an annotated method", task);
            return null;
        }

        Method method = runnable.getMethod();
        Class<?> declaringClass = ClassUtils.getUserClass(
                AopUtils.isAopProxy(runnable.getTarget())
                        ? AopUtils.getTargetClass(runnable.getTarget())
                        : runnable.getTarget().getClass());

        String key = declaringClass.getName() + "#" + method.getName();
        String name = declaringClass.getSimpleName() + "." + method.getName();
        Duration grace = properties.getDefaultGrace();

        if (task instanceof CronTask cronTask) {
            return DiscoveredJob.cron(key, name, cronTask.getExpression(), zoneOf(method), grace);
        }
        if (task instanceof FixedRateTask || task instanceof FixedDelayTask || task instanceof IntervalTask) {
            Duration interval = ((IntervalTask) task).getIntervalDuration();
            if (interval == null || interval.isZero() || interval.isNegative()) {
                log.debug("Ignoring scheduled task {}: no usable interval", key);
                return null;
            }
            return DiscoveredJob.interval(key, name, interval, grace);
        }

        log.debug("Ignoring scheduled task {}: unsupported trigger {}", key, task.getClass().getName());
        return null;
    }

    /**
     * Time zone declared on the annotation, falling back to the configured one.
     * Placeholders are resolved because {@code zone = "${app.timezone}"} is a
     * perfectly ordinary thing to write.
     */
    private String zoneOf(Method method) {
        Scheduled annotation = method.getAnnotation(Scheduled.class);
        if (annotation == null || annotation.zone().isBlank()) {
            return properties.getTimezone();
        }
        try {
            String resolved = environment.resolvePlaceholders(annotation.zone());
            return resolved.isBlank() ? properties.getTimezone() : resolved;
        } catch (RuntimeException cause) {
            return properties.getTimezone();
        }
    }

    /** The identity used for a scheduled method, exposed so the interceptor agrees with us. */
    public static String keyOf(Class<?> targetClass, Method method) {
        return ClassUtils.getUserClass(targetClass).getName() + "#" + method.getName();
    }
}
