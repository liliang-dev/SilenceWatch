/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.acme.demo;

import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The kind of job this product exists for: it matters, it runs unattended, and
 * nobody would notice for days if it quietly stopped.
 */
@Component
public class BackupJob {

    private static final Logger log = LoggerFactory.getLogger(BackupJob.class);
    private final AtomicInteger runs = new AtomicInteger();

    /** Declared to SilenceWatch as com.acme.demo.BackupJob#run. */
    @Scheduled(cron = "${demo.backup.cron:*/30 * * * * *}", zone = "Europe/Paris")
    public void run() throws InterruptedException {
        log.info("Backing up… (run {})", runs.incrementAndGet());
        // Long enough that the reported duration is not zero.
        Thread.sleep(250);
    }

    /** Fails on every third run, to show failures reaching SilenceWatch. */
    @Scheduled(fixedRateString = "${demo.export.rate:45000}")
    public void export() {
        int run = runs.get();
        log.info("Exporting… (run {})", run);
        if (run % 3 == 0) {
            throw new IllegalStateException("the export failed, as it does every third run");
        }
    }
}
