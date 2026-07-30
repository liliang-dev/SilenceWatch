/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration of the SilenceWatch starter.
 *
 * <pre>
 * silencewatch:
 *   enabled: true
 *   api-key: ${SILENCEWATCH_API_KEY}
 *   base-url: https://silencewatch.com   # override when self-hosting
 *   environment: production
 *   default-grace: 5m
 *   auto-register: true
 * </pre>
 */
@ConfigurationProperties(prefix = "silencewatch")
public class SilenceWatchProperties {

    /** Master switch. When false, nothing is discovered, registered or sent. */
    private boolean enabled = true;

    /** Project API key ({@code sw_…}). Without it the starter stays dormant. */
    private String apiKey;

    /** SilenceWatch base URL. Point this at your own instance when self-hosting. */
    private String baseUrl = "https://silencewatch.com";

    /** Environment name reported with every declared job (production, staging…). */
    private String environment = "production";

    /** Grace period applied to jobs that do not declare one. */
    private Duration defaultGrace = Duration.ofMinutes(5);

    /** Declare discovered jobs at startup. Disable to manage checks by hand. */
    private boolean autoRegister = true;

    /** Send a heartbeat when a scheduled method starts, not only when it ends. */
    private boolean reportStart = true;

    /** Timeout of every call to SilenceWatch. Kept short on purpose. */
    private Duration timeout = Duration.ofSeconds(2);

    /**
     * Maximum number of heartbeats waiting to be sent. Beyond this, the oldest
     * are dropped: monitoring must never grow unboundedly inside the
     * application it monitors.
     */
    private int queueCapacity = 1_000;

    /** Time zone reported for cron jobs when the trigger does not carry one. */
    private String timezone = java.util.TimeZone.getDefault().getID();

    /** Discovery of Spring {@code @Scheduled} methods. */
    private boolean discoverSpringTasks = true;

    /** Discovery of Quartz jobs, when Quartz is on the classpath. */
    private boolean discoverQuartzJobs = true;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getApiKey() {
        return apiKey;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
    }

    public String getBaseUrl() {
        return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    public String getEnvironment() {
        return environment;
    }

    public void setEnvironment(String environment) {
        this.environment = environment;
    }

    public Duration getDefaultGrace() {
        return defaultGrace;
    }

    public void setDefaultGrace(Duration defaultGrace) {
        this.defaultGrace = defaultGrace;
    }

    public boolean isAutoRegister() {
        return autoRegister;
    }

    public void setAutoRegister(boolean autoRegister) {
        this.autoRegister = autoRegister;
    }

    public boolean isReportStart() {
        return reportStart;
    }

    public void setReportStart(boolean reportStart) {
        this.reportStart = reportStart;
    }

    public Duration getTimeout() {
        return timeout;
    }

    public void setTimeout(Duration timeout) {
        this.timeout = timeout;
    }

    public int getQueueCapacity() {
        return queueCapacity;
    }

    public void setQueueCapacity(int queueCapacity) {
        this.queueCapacity = queueCapacity;
    }

    public String getTimezone() {
        return timezone;
    }

    public void setTimezone(String timezone) {
        this.timezone = timezone;
    }

    public boolean isDiscoverSpringTasks() {
        return discoverSpringTasks;
    }

    public void setDiscoverSpringTasks(boolean discoverSpringTasks) {
        this.discoverSpringTasks = discoverSpringTasks;
    }

    public boolean isDiscoverQuartzJobs() {
        return discoverQuartzJobs;
    }

    public void setDiscoverQuartzJobs(boolean discoverQuartzJobs) {
        this.discoverQuartzJobs = discoverQuartzJobs;
    }

    /** True when there is enough configuration to talk to SilenceWatch. */
    public boolean isUsable() {
        return enabled && apiKey != null && !apiKey.isBlank() && baseUrl != null && !baseUrl.isBlank();
    }

    /** Base URL without a trailing slash, so paths can simply be appended. */
    public String normalisedBaseUrl() {
        return baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
    }
}
