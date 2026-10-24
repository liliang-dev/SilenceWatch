# SilenceWatch for Laravel

Install the package and set an API key. Every task of your Laravel schedule shows up
in SilenceWatch with its real cron expression, and sends a heartbeat around each run.

Licensed under **Apache-2.0** — deliberately, so it can be embedded in any
application without licence consequences.

## Install

```bash
composer require silencewatch/laravel
```

```dotenv
SILENCEWATCH_API_KEY=sw_...
# SILENCEWATCH_URL=https://watch.example.com   # only when you host SilenceWatch yourself
```

Create the API key in your project's Settings page. That is the whole setup: the
service provider is discovered by Laravel, and nothing in your schedule changes.

Laravel 12 and 13, PHP 8.2+.

## What it does

The package listens to the events Laravel's scheduler already fires
(`ScheduledTaskStarting`, `ScheduledTaskFinished`, `ScheduledTaskFailed`,
`ScheduledBackgroundTaskFinished`). Your tasks are not wrapped or changed.

**Declaration.** The first time `schedule:run` runs a task, the whole schedule is
declared to `POST /api/v1/checks/sync` in one request, and the ping keys it returns
are kept in the cache. The next runs reuse them: the declaration is sent again only
when the schedule changed (a deploy), or once a day. `php artisan silencewatch:sync`
declares it right away — useful at the end of a deploy script, and it lists what is
not watched and why.

**Heartbeats.** Around each run:

```
POST /p/<key>/start                     when the task starts
POST /p/<key>/<exit code>?duration_ms=  when it ends (0 succeeds, anything else fails)
POST /p/<key>/fail?duration_ms=         when it throws
```

A task in the background (`->runInBackground()`) reports its end from the
`schedule:finish` process that Laravel starts when it exits, with its exit code.

Each task gets a **stable identity**, which ties it to its history on the server
across deploys and servers:

| Scheduled with | Key |
| --- | --- |
| `Schedule::command('backup:run --only-db')` | `artisan:backup:run --only-db` |
| `Schedule::exec('/opt/scripts/export.sh')` | `exec:/opt/scripts/export.sh` |
| `Schedule::job(new PruneOrders)` | `call:App\Jobs\PruneOrders` |
| `Schedule::call(...)->name('refresh-rates')` | `call:refresh-rates` |

The name shown in SilenceWatch is the task's `->description()` when it has one.
Tasks that disappear from the schedule are **flagged orphaned on the server, never
deleted**.

## Configuration

Environment variables; `php artisan vendor:publish --tag=silencewatch-config` only if
you need to compute one in PHP.

| Variable | Default | |
| --- | --- | --- |
| `SILENCEWATCH_API_KEY` | — | Without one, nothing is sent |
| `SILENCEWATCH_URL` | `https://app.silencewatch.com` | Your own instance when self-hosting |
| `SILENCEWATCH_ENVIRONMENT` | `APP_ENV` | Part of a check's identity |
| `SILENCEWATCH_ENABLED` | `true` | `false` removes everything |
| `SILENCEWATCH_DEFAULT_GRACE` | `300` | Seconds a run may be late before an alert |
| `SILENCEWATCH_REPORT_START` | `true` | `false` to send only the outcome |
| `SILENCEWATCH_TIMEOUT` | `2` | Seconds per request |
| `SILENCEWATCH_PRUNE` | `true` | `false` when several applications share a project and environment |
| `SILENCEWATCH_CACHE_STORE` | default store | Where the ping keys are kept between runs |

Tasks limited to some environments (`->environments('production')`) are declared only
from those environments. Time zones are the task's own (`->timezone()`), else
`app.schedule_timezone`, else `app.timezone`.

## Rules it will not break

- **It never fails your task.** Every error is caught; a task that succeeds is never
  reported to Laravel as failed because of the package.
- **It costs your tasks almost nothing.** PHP has no background thread, so a heartbeat
  is a request the scheduler waits for — at most `SILENCEWATCH_TIMEOUT`. Once
  SilenceWatch has not answered, the other tasks of that run do not wait for it again.
- **It degrades silently.** No key, no network, no server: the schedule runs exactly as
  without the package, and the next run tries again.
- **No dependency** beyond Laravel itself.

## Not watched

Left out of the declaration, and listed by `silencewatch:sync`:

- **A closure without a name** has no stable identity. Give it `->name('...')`.
- **A task with a condition** (`->between()`, `->unlessBetween()`, `->when()`,
  `->skip()`): its cron expression says when it *may* run, not when it does, and
  watching it would raise false alarms. Create its check by hand and ping it yourself.
- **Nearest-weekday cron expressions** (`15W`), which the server cannot evaluate.

A task scheduled twice is declared from the schedule that fires most often. A queued
job (`Schedule::job()`) is reported when it is dispatched to the queue, not when a
worker runs it.

## Development

```bash
composer install
vendor/bin/phpunit
```

The tests run Laravel's real scheduler against a stand-in SilenceWatch.
