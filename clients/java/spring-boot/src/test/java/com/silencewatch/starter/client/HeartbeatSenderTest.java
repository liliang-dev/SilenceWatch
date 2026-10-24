/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.awaitility.Awaitility.await;

import com.silencewatch.starter.SilenceWatchProperties;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

/**
 * The rules this class exists to guarantee: the job never waits, the queue never
 * grows without bound, and nothing ever propagates.
 */
class HeartbeatSenderTest {

    private final SilenceWatchProperties properties = new SilenceWatchProperties();

    private HeartbeatSender senderFor(SilenceWatchClient client) {
        HeartbeatSender sender = new HeartbeatSender(client, properties);
        sender.register(Map.of("job", "ping-1"));
        return sender;
    }

    /** A client that records calls and can be made slow or hostile. */
    private static class RecordingClient extends SilenceWatchClient {
        final CopyOnWriteArrayList<String> calls = new CopyOnWriteArrayList<>();
        final AtomicBoolean fail = new AtomicBoolean();
        final AtomicBoolean explode = new AtomicBoolean();
        volatile CountDownLatch gate;

        RecordingClient(SilenceWatchProperties properties) {
            super(properties);
        }

        @Override
        public boolean ping(String pingKey, String suffix, Long durationMs) {
            if (gate != null) {
                try {
                    gate.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
            calls.add(pingKey + suffix + (durationMs == null ? "" : "?" + durationMs));
            if (explode.get()) {
                throw new IllegalStateException("boom");
            }
            return !fail.get();
        }
    }

    @Test
    void sendsStartSuccessAndFailure() {
        RecordingClient client = new RecordingClient(properties);
        HeartbeatSender sender = senderFor(client);

        sender.started("job");
        sender.succeeded("job", 1_200);
        sender.failed("job", 800);

        await().atMost(Duration.ofSeconds(5)).until(() -> client.calls.size() == 3);
        assertThat(client.calls).containsExactly("ping-1/start", "ping-1/0?1200", "ping-1/fail?800");
        sender.destroy();
    }

    @Test
    void ignoresJobsItWasNeverGivenAPingKeyFor() {
        RecordingClient client = new RecordingClient(properties);
        HeartbeatSender sender = senderFor(client);

        sender.succeeded("unknown-job", 10);

        assertThat(sender.knows("unknown-job")).isFalse();
        assertThat(client.calls).isEmpty();
        sender.destroy();
    }

    @Test
    void returnsImmediatelyEvenWhenTheServerHangs() {
        RecordingClient client = new RecordingClient(properties);
        client.gate = new CountDownLatch(1);
        HeartbeatSender sender = senderFor(client);

        long startedAt = System.nanoTime();
        for (int index = 0; index < 50; index++) {
            sender.succeeded("job", index);
        }
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        // The job thread must never pay for a slow SilenceWatch.
        assertThat(elapsedMs).isLessThan(200);
        client.gate.countDown();
        sender.destroy();
    }

    @Test
    void dropsTheOldestHeartbeatsRatherThanGrowingWithoutBound() {
        properties.setQueueCapacity(5);
        RecordingClient client = new RecordingClient(properties);
        client.gate = new CountDownLatch(1);
        HeartbeatSender sender = senderFor(client);

        for (int index = 0; index < 500; index++) {
            sender.succeeded("job", index);
        }

        assertThat(sender.stats().queued()).isLessThanOrEqualTo(5);
        assertThat(sender.stats().dropped()).isPositive();

        client.gate.countDown();
        sender.destroy();
    }

    @Test
    void swallowsEverythingTheTransportCanThrow() {
        RecordingClient client = new RecordingClient(properties);
        client.explode.set(true);
        HeartbeatSender sender = senderFor(client);

        assertThatCode(() -> {
            sender.started("job");
            sender.succeeded("job", 1);
            sender.failed("job", 1);
        }).doesNotThrowAnyException();

        await().atMost(Duration.ofSeconds(5)).until(() -> sender.stats().failed() >= 3);
        sender.destroy();
    }

    @Test
    void countsRejectedHeartbeatsWithoutRetrying() {
        RecordingClient client = new RecordingClient(properties);
        client.fail.set(true);
        HeartbeatSender sender = senderFor(client);

        sender.succeeded("job", 1);

        await().atMost(Duration.ofSeconds(5)).until(() -> sender.stats().failed() == 1);
        // A heartbeat is only meaningful now: retrying a stale one would lie.
        assertThat(client.calls).hasSize(1);
        sender.destroy();
    }

    @Test
    void stopsAcceptingWorkOnceDestroyed() {
        RecordingClient client = new RecordingClient(properties);
        HeartbeatSender sender = senderFor(client);
        sender.destroy();

        assertThatCode(() -> sender.succeeded("job", 1)).doesNotThrowAnyException();
    }
}
