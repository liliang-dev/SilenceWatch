/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import static org.assertj.core.api.Assertions.assertThat;

import com.silencewatch.starter.client.HeartbeatSender;
import com.silencewatch.starter.client.SilenceWatchClient;
import com.silencewatch.starter.discovery.DiscoveredJob;
import com.silencewatch.starter.spring.ScheduledMethodAdvisor;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * What the user actually experiences: add the dependency, set a key, and the
 * jobs are declared — or set {@code enabled: false} and it is as if the library
 * were not on the classpath.
 */
class SilenceWatchAutoConfigurationTest {

    // AopAutoConfiguration is what registers the auto-proxy creator in a real
    // Spring Boot application; including it here keeps the test honest about how
    // the interceptor actually gets applied.
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(
                    AopAutoConfiguration.class, SilenceWatchAutoConfiguration.class));

    @Test
    void isActiveByDefaultWithAnApiKey() {
        runner.withPropertyValues("silencewatch.api-key=sw_test", "silencewatch.base-url=http://localhost:9")
                .run(context -> assertThat(context)
                        .hasSingleBean(SilenceWatchClient.class)
                        .hasSingleBean(HeartbeatSender.class)
                        .hasSingleBean(ScheduledMethodAdvisor.class)
                        .hasSingleBean(SilenceWatchRegistrar.class));
    }

    @Test
    void disablingItRemovesEverything() {
        runner.withPropertyValues("silencewatch.enabled=false", "silencewatch.api-key=sw_test")
                .run(context -> assertThat(context)
                        .doesNotHaveBean(SilenceWatchClient.class)
                        .doesNotHaveBean(HeartbeatSender.class)
                        .doesNotHaveBean(ScheduledMethodAdvisor.class)
                        .doesNotHaveBean(SilenceWatchRegistrar.class));
    }

    @Test
    void startsWithoutAnApiKeyInsteadOfFailingTheContext() {
        // A missing key is a misconfiguration, not a reason to stop an
        // application from booting.
        runner.run(context -> assertThat(context).hasNotFailed().hasSingleBean(SilenceWatchClient.class));
    }

    @Test
    void bindsEveryDocumentedProperty() {
        runner.withPropertyValues(
                        "silencewatch.api-key=sw_test",
                        "silencewatch.base-url=https://watch.example.com/",
                        "silencewatch.environment=staging",
                        "silencewatch.default-grace=90s",
                        "silencewatch.auto-register=false",
                        "silencewatch.timeout=1500ms",
                        "silencewatch.queue-capacity=42",
                        "silencewatch.timezone=Europe/Paris")
                .run(context -> {
                    SilenceWatchProperties properties = context.getBean(SilenceWatchProperties.class);
                    assertThat(properties.getEnvironment()).isEqualTo("staging");
                    assertThat(properties.getDefaultGrace()).isEqualTo(Duration.ofSeconds(90));
                    assertThat(properties.isAutoRegister()).isFalse();
                    assertThat(properties.getTimeout()).isEqualTo(Duration.ofMillis(1_500));
                    assertThat(properties.getQueueCapacity()).isEqualTo(42);
                    assertThat(properties.getTimezone()).isEqualTo("Europe/Paris");
                    assertThat(properties.normalisedBaseUrl()).isEqualTo("https://watch.example.com");
                    assertThat(properties.isUsable()).isTrue();
                });
    }

    @Test
    void discoversScheduledMethodsWithStableKeys() {
        runner.withUserConfiguration(SchedulingConfiguration.class)
                .withPropertyValues("silencewatch.api-key=sw_test")
                .run(context -> {
                    List<DiscoveredJob> jobs = discover(context.getBean("silenceWatchSpringTaskDiscoverer",
                            Supplier.class));

                    assertThat(jobs).extracting(DiscoveredJob::key)
                            .containsExactlyInAnyOrder(
                                    NightlyJobs.class.getName() + "#backup",
                                    NightlyJobs.class.getName() + "#poll",
                                    NightlyJobs.class.getName() + "#explode");

                    DiscoveredJob backup = jobs.stream()
                            .filter(job -> job.key().endsWith("#backup"))
                            .findFirst()
                            .orElseThrow();
                    assertThat(backup.cron()).isEqualTo("0 0 2 * * *");
                    assertThat(backup.timezone()).isEqualTo("Europe/Paris");
                    assertThat(backup.name()).isEqualTo("NightlyJobs.backup");

                    DiscoveredJob poll = jobs.stream()
                            .filter(job -> job.key().endsWith("#poll"))
                            .findFirst()
                            .orElseThrow();
                    assertThat(poll.interval()).isEqualTo(Duration.ofMinutes(5));
                    assertThat(poll.cron()).isNull();
                });
    }

    @Test
    void sendsHeartbeatsAroundScheduledMethodsAndNeverBreaksThem() {
        runner.withUserConfiguration(SchedulingConfiguration.class, RecordingClientConfiguration.class)
                .withPropertyValues("silencewatch.api-key=sw_test")
                .run(context -> {
                    RecordingClient client = context.getBean(RecordingClient.class);
                    HeartbeatSender sender = context.getBean(HeartbeatSender.class);
                    NightlyJobs jobs = context.getBean(NightlyJobs.class);
                    String key = NightlyJobs.class.getName() + "#backup";
                    sender.register(Map.of(key, "ping-backup",
                            NightlyJobs.class.getName() + "#explode", "ping-explode"));

                    jobs.backup();
                    Thread.sleep(300);

                    assertThat(client.calls).contains("ping-backup/start");
                    assertThat(client.calls).anyMatch(call -> call.startsWith("ping-backup/0"));

                    // A failing job still fails, and the failure is reported.
                    try {
                        jobs.explode();
                    } catch (IllegalStateException expected) {
                        assertThat(expected).hasMessage("job failed");
                    }
                    Thread.sleep(300);
                    assertThat(client.calls).anyMatch(call -> call.startsWith("ping-explode/fail"));
                });
    }

    @Test
    void leavesJobsUntouchedWhenRegistrationNeverHappened() {
        runner.withUserConfiguration(SchedulingConfiguration.class, RecordingClientConfiguration.class)
                .withPropertyValues("silencewatch.api-key=sw_test")
                .run(context -> {
                    RecordingClient client = context.getBean(RecordingClient.class);

                    // No ping keys registered: the proxy must be a pass-through.
                    context.getBean(NightlyJobs.class).backup();
                    Thread.sleep(200);

                    assertThat(client.calls).isEmpty();
                });
    }

    @SuppressWarnings("unchecked")
    private static List<DiscoveredJob> discover(Supplier<?> supplier) {
        return (List<DiscoveredJob>) supplier.get();
    }

    @Configuration(proxyBeanMethods = false)
    @EnableScheduling
    static class SchedulingConfiguration {
        @Bean
        NightlyJobs nightlyJobs() {
            return new NightlyJobs();
        }
    }

    static class NightlyJobs {
        @Scheduled(cron = "0 0 2 * * *", zone = "Europe/Paris")
        public void backup() {
            // nothing to do in a test
        }

        @Scheduled(fixedRate = 300_000)
        public void poll() {
            // nothing to do in a test
        }

        /** Not scheduled by Spring, but advised: used to check failure reporting. */
        @Scheduled(cron = "0 0 0 30 2 *")
        public void explode() {
            throw new IllegalStateException("job failed");
        }
    }

    @Configuration(proxyBeanMethods = false)
    static class RecordingClientConfiguration {
        @Bean
        RecordingClient silenceWatchClient(SilenceWatchProperties properties) {
            return new RecordingClient(properties);
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

        @Override
        public Map<String, String> sync(List<DiscoveredJob> jobs) {
            return Map.of();
        }
    }
}
