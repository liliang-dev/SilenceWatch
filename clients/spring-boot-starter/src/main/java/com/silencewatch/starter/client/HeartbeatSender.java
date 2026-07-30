/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import com.silencewatch.starter.SilenceWatchProperties;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;

/**
 * Sends heartbeats off the job's own thread.
 *
 * <p>Three rules, none of them negotiable:
 *
 * <ol>
 *   <li><b>The job never waits.</b> Submitting a heartbeat is a queue offer, so a
 *       slow or unreachable SilenceWatch costs the application nothing.</li>
 *   <li><b>The queue is bounded.</b> When it is full the oldest heartbeat is
 *       dropped rather than the application's memory being spent on monitoring
 *       nobody is reading.</li>
 *   <li><b>Nothing propagates.</b> Every failure is swallowed and logged at WARN,
 *       at most once a minute so a network outage cannot flood the logs.</li>
 * </ol>
 */
public class HeartbeatSender implements DisposableBean {

    private static final Logger log = LoggerFactory.getLogger(HeartbeatSender.class);
    private static final long WARN_INTERVAL_MS = 60_000;

    private final SilenceWatchClient client;
    private final ThreadPoolExecutor executor;
    private final Map<String, String> pingKeysByJobKey = new ConcurrentHashMap<>();

    private final AtomicLong dropped = new AtomicLong();
    private final AtomicLong failed = new AtomicLong();
    private final AtomicLong sent = new AtomicLong();
    private final AtomicLong lastWarnAt = new AtomicLong();

    public HeartbeatSender(SilenceWatchClient client, SilenceWatchProperties properties) {
        this.client = client;
        this.executor = new ThreadPoolExecutor(
                1,
                2,
                30,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(Math.max(1, properties.getQueueCapacity())),
                runnable -> {
                    Thread thread = new Thread(runnable, "silencewatch-heartbeat");
                    // Daemon: monitoring must never hold up JVM shutdown.
                    thread.setDaemon(true);
                    thread.setPriority(Thread.MIN_PRIORITY);
                    return thread;
                },
                (runnable, pool) -> {
                    // The queue is full: drop the *oldest* pending heartbeat, since
                    // the freshest state is the one worth reporting.
                    pool.getQueue().poll();
                    dropped.incrementAndGet();
                    if (!pool.getQueue().offer(runnable)) {
                        dropped.incrementAndGet();
                    }
                });
        this.executor.allowCoreThreadTimeOut(true);
    }

    /** Registers the ping keys returned by the declaration call. */
    public void register(Map<String, String> pingKeysByJobKey) {
        this.pingKeysByJobKey.putAll(pingKeysByJobKey);
    }

    public boolean knows(String jobKey) {
        return pingKeysByJobKey.containsKey(jobKey);
    }

    /** A run has started. Never blocks, never throws. */
    public void started(String jobKey) {
        submit(jobKey, "/start", null);
    }

    /** A run finished successfully. Never blocks, never throws. */
    public void succeeded(String jobKey, long durationMs) {
        submit(jobKey, "/0", durationMs);
    }

    /** A run failed. Never blocks, never throws. */
    public void failed(String jobKey, long durationMs) {
        submit(jobKey, "/fail", durationMs);
    }

    public Stats stats() {
        return new Stats(sent.get(), failed.get(), dropped.get(), executor.getQueue().size());
    }

    private void submit(String jobKey, String suffix, Long durationMs) {
        String pingKey = pingKeysByJobKey.get(jobKey);
        if (pingKey == null) {
            // The job was never declared (registration failed, or it is new since
            // startup). Nothing to do — and nothing to break.
            return;
        }

        try {
            executor.execute(() -> deliver(pingKey, suffix, durationMs));
        } catch (RejectedExecutionException cause) {
            // Only reachable after shutdown.
            dropped.incrementAndGet();
        } catch (RuntimeException cause) {
            warnOccasionally("Could not queue a SilenceWatch heartbeat", cause);
        }
    }

    private void deliver(String pingKey, String suffix, Long durationMs) {
        try {
            if (client.ping(pingKey, suffix, durationMs)) {
                sent.incrementAndGet();
            } else {
                failed.incrementAndGet();
                warnOccasionally("SilenceWatch did not accept a heartbeat", null);
            }
        } catch (RuntimeException | LinkageError cause) {
            // Belt and braces: nothing at all escapes this thread.
            failed.incrementAndGet();
            warnOccasionally("Unexpected failure while sending a heartbeat", cause);
        }
    }

    private void warnOccasionally(String message, Throwable cause) {
        long now = System.currentTimeMillis();
        long previous = lastWarnAt.get();
        if (now - previous < WARN_INTERVAL_MS || !lastWarnAt.compareAndSet(previous, now)) {
            return;
        }
        if (cause == null) {
            log.warn("{} (sent={}, failed={}, dropped={}). The job itself is unaffected.",
                    message, sent.get(), failed.get(), dropped.get());
        } else {
            log.warn("{} (sent={}, failed={}, dropped={}). The job itself is unaffected.",
                    message, sent.get(), failed.get(), dropped.get(), cause);
        }
    }

    @Override
    public void destroy() {
        executor.shutdown();
        try {
            // A short, bounded wait: in-flight heartbeats are worth a moment,
            // never worth delaying shutdown.
            if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException cause) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /** Counters, exposed for tests and for the application's own diagnostics. */
    public record Stats(long sent, long failed, long dropped, int queued) {
    }
}
