/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.quartz;

import static org.assertj.core.api.Assertions.assertThat;

import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.discovery.DiscoveredJob;
import java.time.Duration;
import java.util.List;
import java.util.Properties;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.quartz.CronScheduleBuilder;
import org.quartz.Job;
import org.quartz.JobBuilder;
import org.quartz.JobDetail;
import org.quartz.JobExecutionContext;
import org.quartz.Scheduler;
import org.quartz.SimpleScheduleBuilder;
import org.quartz.Trigger;
import org.quartz.TriggerBuilder;
import org.quartz.impl.StdSchedulerFactory;

/**
 * A job with several triggers is declared from the one that fires most often,
 * whatever their types and whatever order Quartz returns them in.
 */
class QuartzJobDiscovererTest {

    private Scheduler scheduler;

    @BeforeEach
    void createScheduler() throws Exception {
        Properties properties = new Properties();
        properties.setProperty("org.quartz.scheduler.instanceName", "test-" + UUID.randomUUID());
        properties.setProperty("org.quartz.threadPool.threadCount", "1");
        properties.setProperty("org.quartz.jobStore.class", "org.quartz.simpl.RAMJobStore");
        // Never started: the discoverer only reads the job store.
        scheduler = new StdSchedulerFactory(properties).getScheduler();
    }

    @AfterEach
    void shutdown() throws Exception {
        scheduler.shutdown();
    }

    @Test
    void picksTheMostFrequentOfTwoCrons() throws Exception {
        schedule(cron("daily", "0 0 2 * * ?"), cron("hourly", "0 0 * * * ?"));

        assertThat(only(discover()).cron()).isEqualTo("0 0 * * * ?");
    }

    @Test
    void comparesACronWithAnInterval() throws Exception {
        schedule(cron("daily", "0 0 2 * * ?"), every("tenMinutes", Duration.ofMinutes(10)));
        assertThat(only(discover()).interval()).isEqualTo(Duration.ofMinutes(10));
    }

    @Test
    void keepsTheCronWhenItIsTheMoreFrequent() throws Exception {
        schedule(every("daily", Duration.ofDays(1)), cron("everyFiveMinutes", "0 */5 * * * ?"));
        assertThat(only(discover()).cron()).isEqualTo("0 */5 * * * ?");
    }

    @Test
    void readsAWeekdayCronAsDailyNotWeekly() {
        Trigger weekdays = cron("weekdays", "0 0 9 ? * MON-FRI");
        Trigger weekly = cron("weekly", "0 0 9 ? * MON");

        java.util.Date now = new java.util.Date();
        assertThat(QuartzJobDiscoverer.shortestGap(weekdays, now)).isEqualTo(Duration.ofDays(1).toMillis());
        assertThat(QuartzJobDiscoverer.shortestGap(weekly, now)).isEqualTo(Duration.ofDays(7).toMillis());
    }

    private void schedule(Trigger first, Trigger second) throws Exception {
        JobDetail job = JobBuilder.newJob(NoOpJob.class).withIdentity("report", "jobs").storeDurably().build();
        scheduler.addJob(job, false);
        scheduler.scheduleJob(TriggerBuilder.newTrigger().forJob(job).withIdentity(first.getKey())
                .withSchedule(first.getScheduleBuilder()).build());
        scheduler.scheduleJob(TriggerBuilder.newTrigger().forJob(job).withIdentity(second.getKey())
                .withSchedule(second.getScheduleBuilder()).build());
    }

    private List<DiscoveredJob> discover() {
        return new QuartzJobDiscoverer(scheduler, new SilenceWatchProperties()).discover();
    }

    private static DiscoveredJob only(List<DiscoveredJob> jobs) {
        assertThat(jobs).hasSize(1);
        return jobs.get(0);
    }

    private static Trigger cron(String name, String expression) {
        return TriggerBuilder.newTrigger().withIdentity(name, "triggers")
                .withSchedule(CronScheduleBuilder.cronSchedule(expression)).build();
    }

    private static Trigger every(String name, Duration interval) {
        return TriggerBuilder.newTrigger().withIdentity(name, "triggers")
                .withSchedule(SimpleScheduleBuilder.simpleSchedule()
                        .withIntervalInMilliseconds(interval.toMillis()).repeatForever())
                .build();
    }

    public static class NoOpJob implements Job {
        @Override
        public void execute(JobExecutionContext context) {
            // nothing to do in a test
        }
    }
}
