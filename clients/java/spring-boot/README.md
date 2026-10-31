# SilenceWatch Spring Boot Starter

Add the dependency and an API key. Every scheduled job in your application shows
up in SilenceWatch, with its real schedule, and sends a heartbeat around each run.

Licensed under **Apache-2.0** — deliberately, so it can be embedded in any
application without licence consequences.

## Install

```xml
<dependency>
  <groupId>com.silencewatch</groupId>
  <artifactId>silencewatch-spring-boot-starter</artifactId>
  <version>0.2.0</version>
</dependency>
```

```groovy
implementation 'com.silencewatch:silencewatch-spring-boot-starter:0.2.0'
```

```yaml
silencewatch:
  api-key: ${SILENCEWATCH_API_KEY}
```

Create the API key in your project's Settings page. That is the whole setup.

## Requirements

- **Java 17 or later.**
- **Spring Boot**: the starter has been run against Spring Boot 3.5 and 4.1.
- **Scheduling switched on.** The starter reads what Spring schedules: `@EnableScheduling` has to
  be on your application (or, for Quartz, a scheduler present), as it must be for your
  `@Scheduled` methods to run at all. Without it there is nothing to discover.
- **Your instance's address** in `silencewatch.base-url` when you self-host; the default is the
  hosted service.

## What it does at startup

On `ApplicationReadyEvent`, in one HTTP call:

- **Spring** — reads the tasks Spring itself scheduled (`ScheduledTaskHolder`), so
  the schedules are the *resolved* ones: `@Scheduled(cron = "${backup.cron}")` is
  declared with the expression the property actually held.
- **Quartz** — if Quartz is on the classpath, iterates the job keys and reads the
  triggers of each job. A job with several triggers is declared from the one that
  fires most often, since that is the deadline a missed run breaches first.
- Declares everything to `POST /api/v1/checks/sync` and keeps the returned ping
  keys in memory.

Each job gets a **stable identity**, which is what ties it to its history on the
server across restarts, redeployments and renames:

| Source | Key |
| --- | --- |
| Spring | `com.acme.jobs.BackupJob#run` |
| Quartz | `group.jobName` |

Jobs that disappear from the code are **flagged orphaned on the server, never
deleted** — a refactoring should not destroy a check's history.

## What it does at run time

A Spring AOP advisor (plain Spring AOP — no AspectJ, no extra dependency) wraps
every `@Scheduled` method; a `JobListener` does the same for Quartz. Around each
run:

```
POST /p/<key>/start                     when the run begins
POST /p/<key>/0?duration_ms=1234        when it returns
POST /p/<key>/fail?duration_ms=1234     when it throws
```

## Configuration

```yaml
silencewatch:
  enabled: true                          # false removes everything, see below
  api-key: ${SILENCEWATCH_API_KEY}
  base-url: https://app.silencewatch.com # your own instance when self-hosting
  environment: production                # part of a check's identity
  default-grace: 5m                      # for jobs that declare none
  auto-register: true                    # false to manage checks by hand
  report-start: true                     # false to send only the outcome
  timeout: 2s                            # per call, deliberately short
  queue-capacity: 1000                   # bounded, oldest dropped when full
  timezone: Europe/Paris                 # for cron jobs whose trigger carries none
  discover-spring-tasks: true
  discover-quartz-jobs: true
  per-instance-jobs: com.acme.cache.LocalCache#evict  # see "Several instances" (0.2.0)
  instance-id: ${HOSTNAME}               # with per-instance-jobs only, and stable
```

## Several instances

When an application runs as several instances (replicas, pods, servers), they all declare the
same jobs in the same environment, so each job is **one check for all of them: it is up while
any instance reports it**. That is what most jobs should be held to:

- a **clustered Quartz** job, or a `@Scheduled` method behind a lock (ShedLock), runs on one
  instance at a time, and whichever one it is, the check hears from it;
- a `@Scheduled` method **without a lock** runs on every instance. The check stays up as long as
  one of them runs it, so an instance whose scheduler is stuck goes unnoticed while another works.
  If the job should run once, put it behind a lock; if it has to run everywhere, read on.

**Jobs that have to run on every instance** (clearing a local cache, deleting temporary files)
can be monitored on each one, from starter 0.2.0:

```yaml
silencewatch:
  per-instance-jobs:
    - com.acme.cache.LocalCache#evict
    - com.acme.tmp.*                     # a trailing * matches a prefix
  instance-id: ${HOSTNAME}
```

Those jobs are declared in an environment of the instance's own, `production.app-0`, so each
instance has its own check and one going quiet is seen while the others report. Every other job
stays shared.

`instance-id` has **no default, and must stay the same across restarts and deploys**: a
StatefulSet pod's name, a server's hostname. A Deployment's pod names change at every rollout,
which would leave behind, each time, checks nobody reports to any more, and they would go down.
Without `instance-id`, the listed jobs are watched as shared, with a warning. When you remove an
instance for good (scaling a StatefulSet down), delete its checks.

## Rules it will not break

These are the reason the library is safe to put in a production application:

- **It never fails your job.** Every network or HTTP error is swallowed and logged
  at WARN. The interceptor calls your method exactly once, returns its result
  untouched, and rethrows its exception unchanged.
- **It never blocks your job.** Sending a heartbeat is a queue offer handled by a
  low-priority daemon thread. An unreachable SilenceWatch costs your job nothing.
- **It is bounded.** The queue holds at most `queue-capacity` heartbeats; past
  that the oldest are dropped, because the freshest state is the one worth
  reporting. Warnings are rate-limited to one a minute so an outage cannot flood
  your logs.
- **It degrades silently.** No API key, no network, no server: the application
  starts and runs exactly as it would without the dependency.
- **`silencewatch.enabled: false` removes the mechanism entirely** — no discovery,
  no proxying of your scheduled methods, no threads, no beans.
- **Zero heavy dependencies.** `spring-boot-starter` plus the JDK HTTP client.
  There is no JSON library: the few payloads exchanged are handled by a small
  internal codec, so this library cannot drag a Jackson version into your
  application.

## Notes and limits

- **Sub-30-second jobs** are declared with a 30-second period, the shortest the
  server accepts, and a warning names them. Anything faster is not really a
  candidate for dead man's switch monitoring.
- **Quartz's `W`** (nearest weekday) cannot be evaluated by the server, so jobs
  using it are skipped with a warning rather than failing the whole declaration.
- **Programmatically scheduled tasks** (`SchedulingConfigurer`, lambdas) have no
  stable identity and are ignored. Declare those checks by hand, or give them a
  `@Scheduled` method.
- **`spring.aop.auto=false`** disables the proxying Spring Boot normally provides.
  Jobs are still declared, but heartbeats cannot be sent — the starter says so at
  startup, because otherwise it would look like every job stopped running at once.

## Building from source

```bash
cd clients/java/spring-boot
mvn test
mvn install
```
