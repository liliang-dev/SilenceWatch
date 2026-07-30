/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.discovery;

import java.lang.reflect.Field;
import org.springframework.scheduling.support.ScheduledMethodRunnable;

/**
 * Finds the {@link ScheduledMethodRunnable} behind a scheduled task.
 *
 * <p>Spring does not always hand back the runnable it was given: since Framework
 * 6.2, {@code @Scheduled} tasks are wrapped in a package-private
 * {@code Task$OutcomeTrackingRunnable} for observability. The wrapper is an
 * implementation detail with no public accessor, and the wrapped runnable is the
 * only thing carrying the job's identity — the class and method that make a
 * stable key.
 *
 * <p>So this unwraps one layer at a time, defensively: a version that stops
 * wrapping works, a version that wraps differently works, and a version that
 * makes it impossible degrades to "this task is not identifiable" rather than
 * throwing. Discovery is best-effort by design; the application is not.
 */
final class ScheduledRunnables {

    /** Enough for any plausible chain of wrappers, small enough to be safe. */
    private static final int MAX_UNWRAP_DEPTH = 4;

    private ScheduledRunnables() {
    }

    static ScheduledMethodRunnable unwrap(Runnable runnable) {
        Runnable current = runnable;

        for (int depth = 0; depth <= MAX_UNWRAP_DEPTH && current != null; depth++) {
            if (current instanceof ScheduledMethodRunnable target) {
                return target;
            }
            current = delegateOf(current);
        }
        return null;
    }

    /** The first {@link Runnable} field of the given object, if any. */
    private static Runnable delegateOf(Runnable wrapper) {
        for (Field field : wrapper.getClass().getDeclaredFields()) {
            if (!Runnable.class.isAssignableFrom(field.getType())) {
                continue;
            }
            try {
                field.setAccessible(true);
                Object value = field.get(wrapper);
                if (value instanceof Runnable delegate) {
                    return delegate;
                }
            } catch (RuntimeException | ReflectiveOperationException | LinkageError ignored) {
                // A module system or security manager said no. Nothing to do but
                // give up on identifying this particular task.
                return null;
            }
        }
        return null;
    }
}
