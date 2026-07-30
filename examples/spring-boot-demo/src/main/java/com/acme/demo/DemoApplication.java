/*
 * Copyright the SilenceWatch authors.
 * Licensed under the Apache License, Version 2.0.
 */
package com.acme.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * An ordinary Spring Boot application with scheduled work.
 *
 * <p>Nothing here knows about SilenceWatch. The starter is a dependency and an
 * API key in application.yml; the jobs below are declared and monitored without
 * a single line of monitoring code.
 */
@SpringBootApplication
@EnableScheduling
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
