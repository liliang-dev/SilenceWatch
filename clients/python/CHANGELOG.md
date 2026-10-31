# Changelog

The Python library is versioned apart from the application, and tagged
`python-N.N.N`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] — 2026-10-31

- **Jobs watched on each instance.** Processes and servers declare the same jobs, so each job is
  one check, up while any of them reports it: right for Celery, where one worker runs each run,
  but an APScheduler process whose scheduler is stuck went unnoticed while another worked.
  `per_instance_jobs` (`SILENCEWATCH_PER_INSTANCE_JOBS`) with a stable `instance_id`
  (`SILENCEWATCH_INSTANCE_ID`) declares the listed jobs in an environment of the instance's own
  (`production.web-1`). No default name; without one, or for a Celery task, the job stays shared,
  with a warning. The README says what a check means across instances.

## [0.1.1] — 2026-10-24

- **django-celery-beat**: the periodic tasks kept in the database are declared and
  watched by the Celery integration, with nothing to configure. A change made while
  the workers run is declared again within a minute.

## [0.1.0]

First release.

- **Celery beat** and **APScheduler 3** integrations: the jobs are declared to SilenceWatch
  with their real schedule, and a heartbeat is sent around each run.
- No runtime dependency; never fails or blocks a job; bounded queue; survives a fork.
