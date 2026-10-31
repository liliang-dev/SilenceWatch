/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Configuration of the SilenceWatch starter.
 *
 * <pre>
 * silencewatch:
 *   enabled: true
 *   api-key: ${SILENCEWATCH_API_KEY}
 *   base-url: https://app.silencewatch.com   # override when self-hosting
 *   environment: production
 *   default-grace: 5m
 *   auto-register: true
 *   per-instance-jobs: com.acme.cache.LocalCache#evict
 *   instance-id: ${HOSTNAME}   # a name that survives restarts, e.g. a StatefulSet pod
 * </pre>
 */
@ConfigurationProperties(prefix = "silencewatch")
public class SilenceWatchProperties {

    /** The longest environment name the server accepts. */
    private static final int MAX_ENVIRONMENT_LENGTH = 40;

    /** Master switch. When false, nothing is discovered, registered or sent. */
    private boolean enabled = true;

    /** Project API key ({@code sw_…}). Without it the starter stays dormant. */
    private String apiKey;

    /** SilenceWatch base URL. Point this at your own instance when self-hosting. */
    private String baseUrl = "https://app.silencewatch.com";

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

    /**
     * Jobs that have to run on every instance (a local cache to clear, temporary
     * files to delete), each monitored on its own. Keys as the starter declares
     * them; a trailing {@code *} matches every key with that prefix.
     *
     * <p>Every other job is one check for all the instances of the application,
     * and stays up while any of them reports it: what a clustered Quartz job or a
     * job behind a lock should be held to. Requires {@link #instanceId}.
     */
    private List<String> perInstanceJobs = new ArrayList<>();

    /**
     * The name of this instance, for the jobs of {@link #perInstanceJobs}. It must
     * stay the same across restarts and deploys (a StatefulSet pod, a VM's
     * hostname): one that changes at every deploy would leave behind, each time,
     * checks that nothing reports to any more, and that go down. So there is no
     * default.
     */
    private String instanceId;

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

    public List<String> getPerInstanceJobs() {
        return perInstanceJobs;
    }

    public void setPerInstanceJobs(List<String> perInstanceJobs) {
        this.perInstanceJobs = perInstanceJobs == null ? new ArrayList<>() : perInstanceJobs;
    }

    public String getInstanceId() {
        return instanceId;
    }

    public void setInstanceId(String instanceId) {
        this.instanceId = instanceId;
    }

    /** Whether the job with this key is monitored on each instance rather than for all of them. */
    public boolean isPerInstance(String jobKey) {
        for (String pattern : perInstanceJobs) {
            String trimmed = pattern.trim();
            if (trimmed.endsWith("*")
                    ? jobKey.startsWith(trimmed.substring(0, trimmed.length() - 1))
                    : jobKey.equals(trimmed)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The environment the per-instance jobs are declared in: this one, a dot, and
     * the instance's name ({@code production.app-0}). Each instance then has its
     * own checks, which the server already keeps apart, so one instance's
     * declaration never touches another's.
     *
     * <p>The server accepts 40 characters of letters, digits, dot, dash and
     * underscore. Anything else in the name becomes a dash, and a name too long is
     * cut from the front: pods of one StatefulSet differ by their end.
     *
     * @return the environment, or {@code null} when there is no usable instance name
     */
    public String instanceEnvironment() {
        if (instanceId == null || instanceId.isBlank() || environment == null) {
            return null;
        }
        String name = instanceId.trim().replaceAll("[^A-Za-z0-9._-]", "-");
        int room = MAX_ENVIRONMENT_LENGTH - environment.length() - 1;
        if (room <= 0) {
            return null;
        }
        if (name.length() > room) {
            name = name.substring(name.length() - room);
        }
        return environment + "." + name;
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
