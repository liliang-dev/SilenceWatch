/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import static org.assertj.core.api.Assertions.assertThat;

import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.discovery.DiscoveredJob;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Exercised against a real HTTP server from the JDK: the point of this client is
 * what goes over the wire, so stubbing the transport would test nothing.
 */
class SilenceWatchClientTest {

    private HttpServer server;
    private SilenceWatchProperties properties;
    private SilenceWatchClient client;

    private final List<String> requestLines = new CopyOnWriteArrayList<>();
    private final List<String> bodies = new CopyOnWriteArrayList<>();
    private final AtomicInteger status = new AtomicInteger(200);
    private volatile String response = "{\"checks\":[],\"orphaned\":[]}";
    private volatile long delayMs = 0;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::handle);
        server.start();

        properties = new SilenceWatchProperties();
        properties.setApiKey("sw_0123456789abcdef_" + "a".repeat(43));
        properties.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/");
        properties.setEnvironment("production");
        properties.setTimeout(Duration.ofSeconds(2));
        client = new SilenceWatchClient(properties);
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        if (delayMs > 0) {
            try {
                Thread.sleep(delayMs);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
        requestLines.add(exchange.getRequestMethod() + " " + exchange.getRequestURI()
                + " auth=" + exchange.getRequestHeaders().getFirst("authorization"));
        try (InputStream body = exchange.getRequestBody()) {
            bodies.add(new String(body.readAllBytes(), StandardCharsets.UTF_8));
        }

        byte[] payload = response.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("content-type", "application/json");
        exchange.sendResponseHeaders(status.get(), payload.length);
        exchange.getResponseBody().write(payload);
        exchange.close();
    }

    @Test
    void sendsADeclarationTheServerUnderstands() {
        response = """
                {"checks":[{"key":"com.acme.BackupJob#run","id":"1","pingKey":"ping-1","created":true}],
                 "orphaned":[]}""";

        Map<String, String> pingKeys = client.sync(List.of(
                DiscoveredJob.cron("com.acme.BackupJob#run", "BackupJob.run", "0 2 * * *",
                        "Europe/Paris", Duration.ofMinutes(5))));

        assertThat(pingKeys).containsExactly(Map.entry("com.acme.BackupJob#run", "ping-1"));
        assertThat(requestLines.get(0)).startsWith("POST /api/v1/checks/sync auth=Bearer sw_");
        assertThat(bodies.get(0))
                .contains("\"environment\":\"production\"")
                .contains("\"source\":\"spring-boot-starter\"")
                .contains("\"key\":\"com.acme.BackupJob#run\"")
                .contains("\"cron\":\"0 2 * * *\"")
                .contains("\"timezone\":\"Europe/Paris\"")
                .contains("\"grace_seconds\":300");
    }

    @Test
    void declaresIntervalJobsInSeconds() {
        client.sync(List.of(DiscoveredJob.interval(
                "com.acme.PollJob#poll", "PollJob.poll", Duration.ofMinutes(15), Duration.ofMinutes(1))));

        assertThat(bodies.get(0))
                .contains("\"interval_seconds\":900")
                .contains("\"grace_seconds\":60")
                .doesNotContain("\"cron\"");
    }

    @Test
    void raisesSubMinimumIntervalsToWhatTheServerAccepts() {
        client.sync(List.of(DiscoveredJob.interval(
                "com.acme.FastJob#run", "FastJob.run", Duration.ofSeconds(5), Duration.ofMinutes(1))));

        // Declaring 5s would be rejected outright, losing the job entirely.
        assertThat(bodies.get(0)).contains("\"interval_seconds\":30");
    }

    @Test
    void escapesJobNamesInsteadOfBreakingThePayload() {
        client.sync(List.of(DiscoveredJob.interval(
                "com.acme.\"Weird\"#run", "He said \"hello\"\n", Duration.ofMinutes(5), Duration.ZERO)));

        assertThat(bodies.get(0)).contains("\\\"Weird\\\"").contains("\\n");
    }

    @Test
    void returnsNothingWhenTheServerRejectsTheDeclaration() {
        status.set(401);
        response = "{\"message\":\"Invalid API key\"}";

        assertThat(client.sync(List.of(DiscoveredJob.interval(
                "com.acme.Job#run", "Job.run", Duration.ofMinutes(5), Duration.ZERO)))).isEmpty();
    }

    @Test
    void returnsNothingWhenTheServerIsUnreachable() {
        properties.setBaseUrl("http://127.0.0.1:1/");
        SilenceWatchClient unreachable = new SilenceWatchClient(properties);

        // No exception: the application must not care that monitoring is down.
        assertThat(unreachable.sync(List.of(DiscoveredJob.interval(
                "com.acme.Job#run", "Job.run", Duration.ofMinutes(5), Duration.ZERO)))).isEmpty();
    }

    @Test
    void returnsNothingWhenTheResponseIsNotJson() {
        response = "<html><body>502 Bad Gateway</body></html>";
        assertThat(client.sync(List.of(DiscoveredJob.interval(
                "com.acme.Job#run", "Job.run", Duration.ofMinutes(5), Duration.ZERO)))).isEmpty();
    }

    @Test
    void skipsTheCallEntirelyWhenThereIsNothingToDeclare() {
        assertThat(client.sync(List.of())).isEmpty();
        assertThat(requestLines).isEmpty();
    }

    @Test
    void sendsHeartbeatsOnTheDocumentedUrls() {
        assertThat(client.ping("ping-1", "/start", null)).isTrue();
        assertThat(client.ping("ping-1", "/0", 1_500L)).isTrue();
        assertThat(client.ping("ping-1", "/fail", 900L)).isTrue();

        assertThat(requestLines).hasSize(3);
        assertThat(requestLines.get(0)).startsWith("POST /p/ping-1/start");
        assertThat(requestLines.get(1)).startsWith("POST /p/ping-1/0?duration_ms=1500");
        assertThat(requestLines.get(2)).startsWith("POST /p/ping-1/fail?duration_ms=900");
    }

    @Test
    void reportsAFailedHeartbeatWithoutThrowing() {
        status.set(404);
        assertThat(client.ping("unknown", "", null)).isFalse();
    }

    @Test
    void givesUpOnASlowServerInsteadOfHoldingTheCaller() {
        properties.setTimeout(Duration.ofMillis(150));
        SilenceWatchClient impatient = new SilenceWatchClient(properties);
        delayMs = 1_500;

        long startedAt = System.nanoTime();
        boolean delivered = impatient.ping("ping-1", "", null);
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        assertThat(delivered).isFalse();
        assertThat(elapsedMs).isLessThan(1_000);
    }
}
