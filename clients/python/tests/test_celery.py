import logging
from datetime import timedelta

import pytest

pytest.importorskip("celery")

from celery import Celery, signals  # noqa: E402
from celery.schedules import crontab, schedule, solar  # noqa: E402

from silencewatch.integrations.celery import CeleryIntegration, crontab_expression, instrument  # noqa: E402


@pytest.mark.parametrize(
    ("entry", "written"),
    [
        (crontab(minute="0", hour="2"), "0 2 * * *"),
        (crontab(minute="*/15"), "*/15 * * * *"),
        (crontab(minute=0, hour="9-17", day_of_week="mon-fri"), "0 9-17 * * 1-5"),
        (crontab(minute="0,30", hour="*/2"), "0,30 */2 * * *"),
        (crontab(minute=0, hour=0, day_of_month="1", month_of_year="1,7"), "0 0 1 1,7 *"),
        (crontab(minute=0, hour=8, day_of_week="sunday"), "0 8 * * 0"),
        (crontab(), "* * * * *"),
    ],
)
def test_a_crontab_is_written_as_the_five_fields_the_server_reads(entry, written):
    assert crontab_expression(entry) == written


def make_app(schedule_entries, **conf):
    app = Celery("shop", set_as_current=False)
    app.conf.update(beat_schedule=schedule_entries, task_always_eager=True, timezone="Europe/Paris", **conf)

    @app.task(name="shop.tasks.backup")
    def backup():
        return "done"

    @app.task(name="shop.tasks.explode")
    def explode():
        raise RuntimeError("nope")

    return app, backup, explode


def test_reads_the_beat_schedule(monitor):
    app, _, _ = make_app({
        "nightly-backup": {"task": "shop.tasks.backup", "schedule": crontab(minute=0, hour=2)},
        "poll": {"task": "shop.tasks.poll", "schedule": 900.0},
        "tick": {"task": "shop.tasks.tick", "schedule": timedelta(minutes=1)},
        "weekly": {"task": "shop.tasks.weekly", "schedule": schedule(run_every=timedelta(days=7))},
    })
    jobs = {job.key: job for job in CeleryIntegration(app).discover()}

    backup = jobs["celery:shop.tasks.backup"]
    assert (backup.cron, backup.timezone, backup.name) == ("0 2 * * *", "Europe/Paris", "nightly-backup")
    assert jobs["celery:shop.tasks.poll"].interval == timedelta(seconds=900)
    assert jobs["celery:shop.tasks.poll"].cron is None
    assert jobs["celery:shop.tasks.tick"].interval == timedelta(minutes=1)
    assert jobs["celery:shop.tasks.weekly"].interval == timedelta(days=7)


def test_a_task_scheduled_twice_is_declared_from_the_entry_that_fires_most_often(monitor):
    app, _, _ = make_app({
        "daily": {"task": "shop.tasks.backup", "schedule": crontab(minute=0, hour=2)},
        "every-ten": {"task": "shop.tasks.backup", "schedule": crontab(minute="*/10")},
        "hourly": {"task": "shop.tasks.backup", "schedule": timedelta(hours=1)},
    })
    (job,) = CeleryIntegration(app).discover()
    assert job.name == "every-ten"
    assert job.cron == "*/10 * * * *"


def test_a_solar_schedule_is_skipped_and_the_rest_is_declared(monitor, caplog):
    app, _, _ = make_app({
        # solar needs the ephem package to be built; its type is all that matters here
        "sunrise": {"task": "shop.tasks.sun", "schedule": solar.__new__(solar)},
        "poll": {"task": "shop.tasks.poll", "schedule": 600.0},
    })
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        jobs = CeleryIntegration(app).discover()
    assert [job.key for job in jobs] == ["celery:shop.tasks.poll"]
    assert "solar" in caplog.text


def test_an_app_without_a_beat_schedule_declares_nothing(monitor):
    assert CeleryIntegration(Celery("empty", set_as_current=False)).discover() == []


def test_a_scheduled_task_that_succeeds_sends_its_start_and_its_end(monitor, server):
    app, backup, _ = make_app({"nightly": {"task": "shop.tasks.backup", "schedule": crontab(minute=0, hour=2)}})
    integration = instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)  # what a worker does before its pool forks

    assert server.syncs[-1]["source"] == "python-celery"
    assert server.syncs[-1]["checks"][0]["cron"] == "0 2 * * *"

    assert backup.apply().get() == "done"  # the task's own result is untouched
    assert server.wait_pings(2) == [("pk-celery:shop.tasks.backup", "/start"), ("pk-celery:shop.tasks.backup", "/0")]
    assert integration is not None


def test_a_scheduled_task_that_raises_reports_the_failure_and_still_raises(monitor, server):
    app, _, explode = make_app({"boom": {"task": "shop.tasks.explode", "schedule": 60.0}})
    instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)

    result = explode.apply()
    assert result.failed()
    assert isinstance(result.result, RuntimeError)  # Celery still sees the exception
    key = "pk-celery:shop.tasks.explode"
    assert server.wait_pings(2) == [(key, "/start"), (key, "/fail")]


def test_a_task_that_is_not_scheduled_is_not_watched(monitor, server):
    app, backup, _ = make_app({"boom": {"task": "shop.tasks.explode", "schedule": 60.0}})
    instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)
    backup.apply()
    monitor.flush(0.5)
    assert server.pings == []


def test_the_duration_is_the_time_the_task_took(monitor, server):
    app, _, _ = make_app({"slow": {"task": "shop.tasks.slow", "schedule": 60.0}})

    @app.task(name="shop.tasks.slow")
    def slow():
        import time
        time.sleep(0.2)

    instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)
    slow.apply()
    server.wait_pings(2)
    assert int(server.queries[1].split("=")[1]) >= 180
