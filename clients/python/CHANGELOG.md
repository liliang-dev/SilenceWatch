# Changelog

The Python library is versioned apart from the application, and tagged
`python-N.N.N`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0]

First release.

- **Celery beat** and **APScheduler 3** integrations: the jobs are declared to SilenceWatch
  with their real schedule, and a heartbeat is sent around each run.
- No runtime dependency; never fails or blocks a job; bounded queue; survives a fork.
