/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.discovery;

/**
 * The cron dialect SilenceWatch can evaluate.
 *
 * <p>Spring and Quartz both accept expressions the server cannot compute
 * occurrences for — Quartz's {@code W} ("nearest weekday") being the practical
 * case. Declaring such a job would have the server reject the <em>whole</em>
 * declaration, so one exotic schedule would cost an application all of its
 * monitoring.
 *
 * <p>The starter therefore filters those jobs out and says so, which is the same
 * principle as everywhere else here: degrade on the part that cannot work, never
 * on the rest.
 */
public final class CronSupport {

    private CronSupport() {
    }

    /**
     * True when the server will accept this expression.
     *
     * <p>Deliberately permissive about the details (the server validates
     * properly) and strict only about the constructs known to be unsupported.
     */
    public static boolean isSupported(String expression) {
        if (expression == null || expression.isBlank()) {
            return false;
        }

        String trimmed = expression.trim();
        if (trimmed.startsWith("@")) {
            return switch (trimmed.toLowerCase()) {
                case "@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly" -> true;
                default -> false;
            };
        }

        int fields = trimmed.split("\\s+").length;
        if (fields != 5 && fields != 6) {
            return false;
        }

        // `W` only ever appears as part of the nearest-weekday syntax (15W, LW).
        return !trimmed.toUpperCase().matches(".*\\d+W.*") && !trimmed.toUpperCase().contains("LW");
    }
}
