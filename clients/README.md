# Client libraries

Everything that lives next to an application and tells SilenceWatch about its
scheduled jobs. One folder per language and, inside it, one per package: each is a package
of its own, versioned and released apart from the server. A language with a single package
and several schedulers (Python) has just the one folder.

| Folder | Language | Reads | Install | Tag |
| --- | --- | --- | --- | --- |
| [`java/spring-boot`](java/spring-boot/README.md) | Java | `@Scheduled`, Quartz | `com.silencewatch:silencewatch-spring-boot-starter` | `java-spring-boot-N.N.N` |
| [`python`](python/README.md) | Python 3.9+ | Celery beat, django-celery-beat, APScheduler 3 | `pip install silencewatch` | `python-N.N.N` |
| [`php/laravel`](php/laravel/README.md) | PHP 8.2+ | the Laravel 12 and 13 scheduler | `composer require silencewatch/laravel` | `php-laravel-N.N.N` |

Runnable applications for each client are in [`examples`](../examples), and CI checks them against the
clients in this repository.

## The contract every client follows

A client does two things, and the server needs nothing else from it.

1. **Declare the jobs** with one `POST /api/v1/checks/sync` (see
   [docs/api.md](../docs/api.md)): a stable `key` per job, its cron expression or its
   interval, its time zone and grace period. The response gives each job's ping key.
   A declaration is *complete*: whatever it leaves out (in that project and
   environment) is flagged orphaned, never deleted.
2. **Send a heartbeat around each run** with `POST /p/<ping key>/start`, then
   `/0?duration_ms=…` when it returns or `/fail?duration_ms=…` when it raises.

And the rules that make a client safe to put in a production application:

- it **never fails** the job it watches, and returns the job's result and exception
  untouched;
- it **never blocks** it: a heartbeat is a queue append, sent by another thread (PHP has
  no thread to hand it to: the Laravel package waits at most its timeout, once per run);
- it is **bounded** (the oldest heartbeats are dropped when the queue is full) and its
  log noise is rate limited;
- it **degrades silently**: no key, no network, no server, and the application runs as
  if it were not there;
- it can be **switched off entirely**, with no discovery, no hook and no thread left behind;
- it brings **no heavy dependency** into the application it is embedded in.

## Adding a client

For another scheduler in a language that already has a client, add a module to it
(see "Adding an integration" in the [Python README](python/README.md): one class with
`discover()` and `install()`). For another language, add a folder here with its own
package, its own tests, its own release workflow and its own README, following the
contract above, and a row in the table. Put a new language's CI job in
`.github/workflows/ci.yml` and its release workflow beside `java-release.yml`,
`python-release.yml` and `laravel-release.yml`, with a tag named after the package
(`java-spring-boot-N.N.N`, `python-N.N.N`, `php-laravel-N.N.N`) so that no workflow can fire on another's tags. A
registry that reads a repository root rather than an uploaded archive (Packagist, Go modules) gets
a read-only mirror of the folder, pushed by the release workflow, as `laravel-release.yml` does.

Licence: Apache-2.0, deliberately, so a client can be embedded in any application
without licence consequences.
