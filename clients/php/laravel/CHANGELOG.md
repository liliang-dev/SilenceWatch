# Changelog

The Laravel package is versioned apart from the application, and tagged
`php-laravel-N.N.N`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

- **Tasks watched on each server.** Servers running the scheduler declare the same tasks, so
  each task is one check, up while any of them reports it: right for `->onOneServer()`, but a
  server whose scheduler stopped went unnoticed while another worked, for tasks that run
  everywhere. `SILENCEWATCH_PER_INSTANCE_TASKS` with a stable `SILENCEWATCH_INSTANCE_ID`
  declares the listed tasks in an environment of the server's own (`production.web-1`), and the
  ping keys are cached per server. No default name; without one, or for an `->onOneServer()`
  task, the task stays shared, with a warning. The README says what a check means across servers.

## [0.1.0]

First release.

- The Laravel schedule is declared to SilenceWatch with its real cron expressions, and
  a heartbeat is sent around each run, background tasks included.
- `php artisan silencewatch:sync` to declare from a deploy script.
- Laravel 12 and 13; no dependency beyond Laravel.
