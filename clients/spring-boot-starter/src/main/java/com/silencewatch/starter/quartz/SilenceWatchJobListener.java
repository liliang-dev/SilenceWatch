/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.quartz;

import com.silencewatch.starter.client.HeartbeatSender;
import org.quartz.JobExecutionContext;
import org.quartz.JobExecutionException;
import org.quartz.JobListener;

/**
 * Reports Quartz executions to SilenceWatch.
 *
 * <p>Quartz gives us exactly the two events we need: {@code jobToBeExecuted}
 * before the run, and {@code jobWasExecuted} after it, with the exception when
 * there was one and the run time either way.
 *
 * <p>Like everything else in this library, the listener is incapable of
 * disturbing the job: both callbacks are wrapped so that no exception can
 * propagate back into the Quartz worker thread, where it would abort execution.
 */
public class SilenceWatchJobListener implements JobListener {

    public static final String NAME = "silencewatch";

    private final HeartbeatSender sender;
    private final boolean reportStart;

    public SilenceWatchJobListener(HeartbeatSender sender, boolean reportStart) {
        this.sender = sender;
        this.reportStart = reportStart;
    }

    @Override
    public String getName() {
        return NAME;
    }

    @Override
    public void jobToBeExecuted(JobExecutionContext context) {
        if (!reportStart) {
            return;
        }
        safely(() -> sender.started(QuartzJobDiscoverer.keyOf(context.getJobDetail().getKey())));
    }

    @Override
    public void jobExecutionVetoed(JobExecutionContext context) {
        // A vetoed job did not run. Saying nothing is right: the check stays
        // silent and, if that persists, SilenceWatch reports it — which is the
        // truth.
    }

    @Override
    public void jobWasExecuted(JobExecutionContext context, JobExecutionException exception) {
        safely(() -> {
            String key = QuartzJobDiscoverer.keyOf(context.getJobDetail().getKey());
            long durationMs = Math.max(0, context.getJobRunTime());
            if (exception == null) {
                sender.succeeded(key, durationMs);
            } else {
                sender.failed(key, durationMs);
            }
        });
    }

    private static void safely(Runnable action) {
        try {
            action.run();
        } catch (RuntimeException | LinkageError ignored) {
            // Intentionally ignored: monitoring never breaks the job.
        }
    }
}
