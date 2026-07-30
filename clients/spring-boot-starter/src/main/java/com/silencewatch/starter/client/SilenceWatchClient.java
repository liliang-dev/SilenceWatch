/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.client;

import com.silencewatch.starter.SilenceWatchProperties;
import com.silencewatch.starter.discovery.DiscoveredJob;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * HTTP access to SilenceWatch, built on the JDK client only.
 *
 * <p>Every method here either returns a result or reports failure through its
 * return value. Nothing escapes as an exception into application code: the
 * contract of this library is that monitoring never breaks the thing it
 * monitors.
 */
public class SilenceWatchClient {

    private static final Logger log = LoggerFactory.getLogger(SilenceWatchClient.class);

    /** The server rejects shorter periods; a sub-minute job is declared at this. */
    private static final long MINIMUM_INTERVAL_SECONDS = 30;

    /** Responses are small; anything larger is a proxy error page we do not need. */
    private static final int MAX_RESPONSE_CHARS = 256 * 1024;

    private final SilenceWatchProperties properties;
    private final HttpClient http;

    public SilenceWatchClient(SilenceWatchProperties properties) {
        this(properties, HttpClient.newBuilder()
                .connectTimeout(properties.getTimeout())
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build());
    }

    SilenceWatchClient(SilenceWatchProperties properties, HttpClient http) {
        this.properties = properties;
        this.http = http;
    }

    /**
     * Declares the discovered jobs and returns their ping keys, indexed by job
     * key. An empty map means the declaration did not go through — the caller
     * carries on regardless.
     */
    public Map<String, String> sync(List<DiscoveredJob> jobs) {
        if (jobs.isEmpty()) {
            return Map.of();
        }

        String payload = buildSyncPayload(jobs);
        HttpRequest request = HttpRequest.newBuilder(URI.create(properties.normalisedBaseUrl() + "/api/v1/checks/sync"))
                .timeout(properties.getTimeout())
                .header("authorization", "Bearer " + properties.getApiKey())
                .header("content-type", "application/json")
                .header("accept", "application/json")
                .header("user-agent", userAgent())
                .POST(HttpRequest.BodyPublishers.ofString(payload))
                .build();

        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                log.warn("SilenceWatch rejected the job declaration (HTTP {}): {}",
                        response.statusCode(), firstLine(response.body()));
                return Map.of();
            }
            return parsePingKeys(response.body());
        } catch (IOException | IllegalArgumentException cause) {
            log.warn("Could not declare jobs to SilenceWatch: {}", cause.toString());
            return Map.of();
        } catch (InterruptedException cause) {
            Thread.currentThread().interrupt();
            return Map.of();
        }
    }

    /**
     * Sends one heartbeat. Returns false when it did not arrive; the caller
     * decides whether that is worth a log line.
     *
     * @param pingKey    the check's ping key
     * @param suffix     {@code ""}, {@code "/start"}, {@code "/fail"} or {@code "/<exit code>"}
     * @param durationMs execution time to report, or {@code null}
     */
    public boolean ping(String pingKey, String suffix, Long durationMs) {
        String url = properties.normalisedBaseUrl() + "/p/" + pingKey + suffix
                + (durationMs == null ? "" : "?duration_ms=" + durationMs);

        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(properties.getTimeout())
                .header("user-agent", userAgent())
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();

        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            return response.statusCode() / 100 == 2;
        } catch (IOException cause) {
            return false;
        } catch (InterruptedException cause) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    String buildSyncPayload(List<DiscoveredJob> jobs) {
        StringBuilder json = new StringBuilder(128 * jobs.size());
        json.append("{\"environment\":");
        Json.writeString(json, properties.getEnvironment());
        json.append(",\"source\":\"spring-boot-starter\",\"prune\":true,\"checks\":[");

        boolean first = true;
        for (DiscoveredJob job : jobs) {
            if (!first) {
                json.append(',');
            }
            first = false;
            appendJob(json, job);
        }

        return json.append("]}").toString();
    }

    private void appendJob(StringBuilder json, DiscoveredJob job) {
        json.append("{\"key\":");
        Json.writeString(json, job.key());
        json.append(",\"name\":");
        Json.writeString(json, job.name());

        if (job.cron() != null) {
            json.append(",\"cron\":");
            Json.writeString(json, job.cron());
            json.append(",\"timezone\":");
            Json.writeString(json, job.timezone() == null ? properties.getTimezone() : job.timezone());
        } else {
            long seconds = Math.max(MINIMUM_INTERVAL_SECONDS, job.interval().toSeconds());
            if (seconds != job.interval().toSeconds()) {
                log.warn("Job {} runs every {}s, which is below the {}s minimum SilenceWatch accepts; "
                                + "declaring it at {}s",
                        job.key(), job.interval().toSeconds(), MINIMUM_INTERVAL_SECONDS, seconds);
            }
            json.append(",\"interval_seconds\":").append(seconds);
        }

        Duration grace = job.grace() == null ? properties.getDefaultGrace() : job.grace();
        json.append(",\"grace_seconds\":").append(Math.max(0, grace.toSeconds()));
        json.append('}');
    }

    private Map<String, String> parsePingKeys(String body) {
        if (body.length() > MAX_RESPONSE_CHARS) {
            log.warn("Ignoring an implausibly large sync response ({} chars)", body.length());
            return Map.of();
        }

        Map<String, String> pingKeys = new LinkedHashMap<>();
        for (Object entry : Json.asList(Json.asMap(Json.parse(body)).get("checks"))) {
            Map<String, Object> check = Json.asMap(entry);
            String key = Json.asString(check.get("key"));
            String pingKey = Json.asString(check.get("pingKey"));
            if (key != null && pingKey != null) {
                pingKeys.put(key, pingKey);
            }
        }
        return pingKeys;
    }

    private String userAgent() {
        return "silencewatch-spring-boot-starter/" + version();
    }

    private String version() {
        String implementation = SilenceWatchClient.class.getPackage().getImplementationVersion();
        return implementation == null ? "dev" : implementation;
    }

    private static String firstLine(String body) {
        if (body == null || body.isEmpty()) {
            return "(no body)";
        }
        String line = body.lines().findFirst().orElse("");
        return line.length() > 200 ? line.substring(0, 200) + "…" : line;
    }
}
