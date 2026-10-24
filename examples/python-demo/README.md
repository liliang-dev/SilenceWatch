# SilenceWatch Python demo

Two small applications, one for each scheduler the [Python library](../../clients/python/README.md)
reads. Each has two scheduled jobs and **no monitoring code**: adding the library and an API
key is the entire integration, the one `instrument(...)` line you can see at the end of each file.

```bash
# 1. install the library (the copy in this repository; or just `pip install -r requirements.txt`)
pip install -e "../../clients/python[celery,apscheduler]"

# 2. create an API key in your project's Settings page, then
export SILENCEWATCH_API_KEY=sw_…
export SILENCEWATCH_URL=http://localhost:8080    # your own instance; leave it unset for the hosted service
```

| Run | With |
| --- | --- |
| `python apscheduler_demo.py` | APScheduler 3 |
| `celery -A celery_demo worker --beat --loglevel=info` | Celery beat (the broker is a folder in the temp directory: no Redis needed) |

Within a second of startup the jobs appear in SilenceWatch, tagged `auto`, with their real schedules:

| Scheduler | Key | Schedule |
| --- | --- | --- |
| APScheduler | `apscheduler:backup` | every 5 minutes |
| APScheduler | `apscheduler:export` | every minute |
| Celery | `celery:celery_demo.backup` | every 5 minutes |
| Celery | `celery:celery_demo.export` | every minute |

Each run then sends a heartbeat, with its duration, and `export` fails every third run so the
down-and-recovered path is visible too.

Stop the application and watch the checks go `LATE`, then `DOWN`, which is the whole point.

## Keeping the examples honest

`test_demo.py` asks each integration what it finds in these applications, without sending anything:

```bash
pip install pytest && pytest
```

CI runs it against the library in this repository, so an example that stops declaring its jobs
fails the build, the way the Spring Boot demo is compiled against its starter.
