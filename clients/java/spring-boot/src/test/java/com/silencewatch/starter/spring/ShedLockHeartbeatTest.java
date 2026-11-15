/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.spring;

import static org.assertj.core.api.Assertions.assertThat;

import com.silencewatch.starter.SilenceWatchAutoConfiguration;
import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.client.SilenceWatchClient;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.SimpleLock;
import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.boot.test.context.FilteredClassLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * A job behind ShedLock runs on one instance; the others skip it. Only the run
 * that happened may be reported: a skipped run reported as a success would keep
 * the check up while the job runs nowhere.
 */
class ShedLockHeartbeatTest {

    private static final String LOCKED = LockedJobs.class.getName() + "#report";
    private static final String UNLOCKED = LockedJobs.class.getName() + "#poll";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(AopAutoConfiguration.class, SilenceWatchAutoConfiguration.class))
            .withUserConfiguration(ShedLockConfiguration.class)
            .withPropertyValues("silencewatch.api-key=sw_test");

    @Test
    void reportsALockedRunOnlyOnTheInstanceThatGotTheLock() {
        runner.run(context -> {
            RecordingClient client = context.getBean(RecordingClient.class);
            context.getBean(HeartbeatSender.class).register(Map.of(LOCKED, "ping-report"));
            LockedJobs jobs = context.getBean(LockedJobs.class);
            ToggleLockProvider locks = context.getBean(ToggleLockProvider.class);

            // Another instance holds the lock: the job is skipped, and nothing is said.
            locks.available.set(false);
            jobs.report();
            Thread.sleep(300);
            assertThat(jobs.runCount()).isZero();
            assertThat(client.calls).isEmpty();

            // This instance gets the lock: the job runs, and the run is reported.
            locks.available.set(true);
            jobs.report();
            Thread.sleep(300);
            assertThat(jobs.runCount()).isEqualTo(1);
            assertThat(client.calls).contains("ping-report/start");
            assertThat(client.calls).anyMatch(call -> call.startsWith("ping-report/0"));
        });
    }

    @Test
    void keepsUnlockedMethodsOnTheOutermostAdvisor() {
        runner.run(context -> {
            RecordingClient client = context.getBean(RecordingClient.class);
            context.getBean(HeartbeatSender.class).register(Map.of(UNLOCKED, "ping-poll"));

            context.getBean(LockedJobs.class).poll();
            Thread.sleep(300);
            assertThat(client.calls).contains("ping-poll/start");

            ScheduledMethodAdvisor outer = context.getBean("silenceWatchScheduledMethodAdvisor",
                    ScheduledMethodAdvisor.class);
            ScheduledMethodAdvisor inner = context.getBean("silenceWatchLockedScheduledMethodAdvisor",
                    ScheduledMethodAdvisor.class);
            assertThat(outer.isLocked()).isFalse();
            assertThat(inner.isLocked()).isTrue();
        });
    }

    @Test
    void registersNoLockedAdvisorWithoutShedLock() {
        new ApplicationContextRunner()
                .withConfiguration(AutoConfigurations.of(AopAutoConfiguration.class, SilenceWatchAutoConfiguration.class))
                .withClassLoader(new FilteredClassLoader("net.javacrumbs.shedlock"))
                .withPropertyValues("silencewatch.api-key=sw_test")
                .run(context -> assertThat(context)
                        .hasSingleBean(ScheduledMethodAdvisor.class)
                        .doesNotHaveBean("silenceWatchLockedScheduledMethodAdvisor"));
    }

    @Configuration(proxyBeanMethods = false)
    @EnableSchedulerLock(defaultLockAtMostFor = "1m")
    static class ShedLockConfiguration {
        @Bean
        ToggleLockProvider lockProvider() {
            return new ToggleLockProvider();
        }

        @Bean
        LockedJobs lockedJobs() {
            return new LockedJobs();
        }

        @Bean
        RecordingClient silenceWatchClient(SilenceWatchProperties properties) {
            return new RecordingClient(properties);
        }
    }

    static class LockedJobs {
        final AtomicInteger runs = new AtomicInteger();

        @Scheduled(cron = "0 0 3 * * *")
        @SchedulerLock(name = "report")
        public void report() {
            runs.incrementAndGet();
        }

        @Scheduled(fixedRate = 300_000)
        public void poll() {
            // nothing to do in a test
        }

        /** Read through the proxy: a field of the proxy itself is never set. */
        public int runCount() {
            return runs.get();
        }
    }

    /** Hands out the lock only while {@link #available} is true, like a shared lock table. */
    static class ToggleLockProvider implements LockProvider {
        final AtomicBoolean available = new AtomicBoolean(true);

        @Override
        public Optional<SimpleLock> lock(LockConfiguration lockConfiguration) {
            return available.get() ? Optional.of(() -> { }) : Optional.empty();
        }
    }

    static class RecordingClient extends SilenceWatchClient {
        final CopyOnWriteArrayList<String> calls = new CopyOnWriteArrayList<>();

        RecordingClient(SilenceWatchProperties properties) {
            super(properties);
        }

        @Override
        public boolean ping(String pingKey, String suffix, Long durationMs) {
            calls.add(pingKey + suffix + (durationMs == null ? "" : "?" + durationMs));
            return true;
        }
    }

}
