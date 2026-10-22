# SilenceWatch for Python

Add the library and an API key. The scheduled jobs of your application show up in
SilenceWatch with their real schedule, and send a heartbeat around each run.

Licensed under **Apache-2.0** — deliberately, so it can be embedded in any
application without licence consequences.

| Scheduler | Install | What it reads |
| --- | --- | --- |
| **Celery beat** | `pip install "silencewatch[celery]"` | the `beat_schedule` (crontab, `timedelta`, seconds) |
| **APScheduler 3** | `pip install "silencewatch[apscheduler]"` | the jobs of the scheduler (cron and interval triggers) |

More are planned; see [Adding an integration](#adding-an-integration).

## Set up

Create an API key in your project's Settings page and give it to the process:

```bash
export SILENCEWATCH_API_KEY=sw_...
# export SILENCEWATCH_URL=https://watch.example.com   # only when you host SilenceWatch yourself
```

### Celery

```python
from celery import Celery
from celery.schedules import crontab
from silencewatch.integrations.celery import instrument

app = Celery("shop")
app.conf.beat_schedule = {
    "nightly-backup": {"task": "shop.tasks.backup", "schedule": crontab(hour=2, minute=0)},
    "sync-prices": {"task": "shop.tasks.sync_prices", "schedule": 900.0},
}
instrument(app)
```

Workers declare the schedule when they start, and send a heartbeat from the worker
that runs each scheduled task. Nothing else to write.

### APScheduler

```python
from apscheduler.schedulers.background import BackgroundScheduler
from silencewatch.integrations.apscheduler import instrument

scheduler = BackgroundScheduler()
scheduler.add_job(backup, "cron", hour=2, id="nightly-backup")
scheduler.add_job(sync_prices, "interval", minutes=15, id="sync-prices")
instrument(scheduler)
scheduler.start()
```

**Give each job an `id`.** APScheduler makes up a random one otherwise, which changes
on every start and cannot tie a job to its history. Without an id the job is
identified by the function it runs, which is stable.

## What it does

At startup, in **one HTTP call**, every job found is declared to
`POST /api/v1/checks/sync` and the returned ping keys are kept in memory. Around
each run:

```
POST /p/<key>/start                     when the run begins
POST /p/<key>/0?duration_ms=1234        when it returns
POST /p/<key>/fail?duration_ms=1234     when it raises
```

Each job gets a **stable identity**, which is what ties it to its history on the
server across restarts, redeployments and renames:

| Integration | Key |
| --- | --- |
| Celery | `celery:shop.tasks.backup` (the task name) |
| APScheduler | `apscheduler:nightly-backup` (the job id, else `apscheduler:app.jobs:backup`, the function) |

Jobs that disappear from the code are **flagged orphaned on the server, never
deleted**.

## Configuration

Every setting is a keyword argument (`instrument(app, api_key="…", environment="staging")`)
and an environment variable. The keyword wins. Durations in the environment are a
number of seconds.

| Keyword | Environment variable | Default | |
| --- | --- | --- | --- |
| `api_key` | `SILENCEWATCH_API_KEY` | — | Without one nothing is sent |
| `base_url` | `SILENCEWATCH_URL` | `https://app.silencewatch.com` | Your own instance when self-hosting |
| `environment` | `SILENCEWATCH_ENVIRONMENT` | `production` | Part of a check's identity |
| `enabled` | `SILENCEWATCH_ENABLED` | `true` | `false` removes everything, see below |
| `default_grace` | `SILENCEWATCH_DEFAULT_GRACE` | `5 min` | For jobs that declare none |
| `auto_register` | `SILENCEWATCH_AUTO_REGISTER` | `true` | `false` to manage checks by hand |
| `report_start` | `SILENCEWATCH_REPORT_START` | `true` | `false` to send only the outcome |
| `timeout` | `SILENCEWATCH_TIMEOUT` | `2` (s) | Per call, deliberately short |
| `queue_capacity` | `SILENCEWATCH_QUEUE_CAPACITY` | `1000` | Bounded, oldest dropped when full |
| `timezone` | `SILENCEWATCH_TIMEZONE` | `UTC` | For cron jobs whose own schedule carries none |
| `prune` | `SILENCEWATCH_PRUNE` | `true` | See below |

`prune` flags as orphaned every check of the project and environment that the
declaration leaves out. Use **one environment per application**; if several services
share one project and environment, set `prune=False`, or each would orphan the
others' checks.

## Rules it will not break

These are the reason the library is safe to put in a production application:

- **It never fails your job.** Every network or HTTP error is swallowed and logged at
  `WARNING`. Your task runs exactly once, and its result and its exception are untouched.
- **It never blocks your job.** Sending a heartbeat is a queue append handled by a
  daemon thread. An unreachable SilenceWatch costs your job nothing.
- **It is bounded.** The queue holds at most `queue_capacity` heartbeats; past that the
  oldest are dropped, because the freshest state is the one worth reporting. Warnings
  are limited to one a minute so an outage cannot flood your logs.
- **It degrades silently.** No API key, no network, no server: the application starts
  and runs exactly as it would without the library. A process that started while
  SilenceWatch was unreachable declares itself at its first heartbeat, at most once a
  minute.
- **It survives a fork.** Celery's prefork pool and gunicorn fork after the library
  started; each child starts its own queue and thread.
- **`enabled=False` removes the mechanism entirely**: no discovery, no hooks, no threads.
- **No dependency.** The standard library only. `celery` and `apscheduler` are extras you
  already have.

## Notes and limits

- **Celery** — a task scheduled by several beat entries is declared from the one that
  fires most often. A **manual** `.delay()` of a scheduled task also sends a heartbeat,
  since a worker cannot tell it from a scheduled one; do not rely on a task being called
  by hand for the check to stay green. Solar schedules and schedules kept in a database
  (`django-celery-beat`) are not read. A crontab that restricts both the day of the month
  and the day of the week fires when both match in Celery and when either does in cron;
  the log says so.
- **APScheduler** — version 3 only (4 has another API). A job's duration includes any time
  it waited for an executor. One-off `date` triggers, combined `and`/`or` triggers and the
  `week`, `year` and "third friday" cron fields cannot be expressed and are skipped, with a
  warning. Jobs added or removed after the scheduler started are declared again two
  seconds later.
- **Sub-30-second jobs** are declared with a 30-second period, the shortest the server
  accepts, and a warning names them.
- **Cron expressions the server cannot evaluate** (Quartz's `W`) are skipped with a
  warning rather than failing the whole declaration.

## Adding an integration

The package is organised so the next scheduler (Django, RQ, Dramatiq, a cron wrapper…)
is one module:

```
src/silencewatch/
  config.py          settings, from keywords and SILENCEWATCH_* variables
  model.py           DiscoveredJob: what an integration reports
  client.py          the HTTP calls (declaration, heartbeat), standard library only
  heartbeat.py       the bounded queue and the thread, fork-safe
  monitor.py         one per process: declares everything in one request, sends the runs
  cron.py            the cron dialect the server reads, and helpers to write one
  integrations/
    base.py          the contract an integration follows
    celery.py
    apscheduler.py   ← a new scheduler goes here, next to these
```

An integration is a class with a `name`, a `discover()` that returns the jobs as
`DiscoveredJob`s, and an `install(monitor)` that hooks the scheduler: it calls
`monitor.declare(self, jobs)` when the scheduler is ready and `monitor.started`,
`succeeded` or `failed` around each run. Add an `instrument(...)` function that creates
it and calls `monitor.attach(...)`, tests next to the others, and the README row above.
Nothing else changes.

## Development

```bash
pip install -e ".[celery,apscheduler]" pytest ruff mypy
ruff check . && mypy && pytest
```

The tests start a small stand-in for SilenceWatch, so the real HTTP code runs.
