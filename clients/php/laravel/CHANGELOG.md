# Changelog

The Laravel package is versioned apart from the application, and tagged
`php-laravel-N.N.N`. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0]

First release.

- The Laravel schedule is declared to SilenceWatch with its real cron expressions, and
  a heartbeat is sent around each run, background tasks included.
- `php artisan silencewatch:sync` to declare from a deploy script.
- Laravel 12 and 13; no dependency beyond Laravel.
