# Changelog

The Python library is versioned apart from the application, and tagged
`python-N.N.N`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.1] — 2026-10-24

- **django-celery-beat**: the periodic tasks kept in the database are declared and
  watched by the Celery integration, with nothing to configure. A change made while
  the workers run is declared again within a minute.

## [0.1.0]

First release.

- **Celery beat** and **APScheduler 3** integrations: the jobs are declared to SilenceWatch
  with their real schedule, and a heartbeat is sent around each run.
- No runtime dependency; never fails or blocks a job; bounded queue; survives a fork.
