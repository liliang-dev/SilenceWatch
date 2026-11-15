/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.silencewatch.starter.spring;

import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

/**
 * Asks ShedLock, reflectively, whether the current thread holds a lock.
 *
 * <p>ShedLock stays an optional dependency the starter never compiles against:
 * without it on the classpath, the answer is simply "yes", so nothing warns.
 */
final class ShedLockSupport {

    private static final MethodHandle ASSERT_LOCKED = find();

    private ShedLockSupport() {}

    static boolean isLockHeld() {
        if (ASSERT_LOCKED == null) {
            return true;
        }
        try {
            ASSERT_LOCKED.invoke();
            return true;
        } catch (IllegalStateException notLocked) {
            return false;
        } catch (Throwable unexpected) {
            return true;
        }
    }

    private static MethodHandle find() {
        try {
            Class<?> lockAssert = Class.forName(
                    "net.javacrumbs.shedlock.core.LockAssert", false, ShedLockSupport.class.getClassLoader());
            return MethodHandles.publicLookup()
                    .findStatic(lockAssert, "assertLocked", MethodType.methodType(void.class));
        } catch (ReflectiveOperationException | LinkageError absent) {
            return null;
        }
    }
}
