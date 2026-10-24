"""django-celery-beat, against a real database (SQLite) and the real models."""

import threading
from datetime import timedelta

import pytest

pytest.importorskip("django_celery_beat")
pytest.importorskip("celery")

import django  # noqa: E402
from celery import Celery, signals  # noqa: E402
from celery.schedules import crontab  # noqa: E402
from django.conf import settings  # noqa: E402

from silencewatch.integrations import django_celery_beat  # noqa: E402
from silencewatch.integrations.celery import CeleryIntegration, instrument  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def database(tmp_path_factory):
    # A file rather than ":memory:": the library closes its connections, and an
    # in-memory database would go with them. Django stays configured once this
    # module has run, so the database outlives it, emptied.
    if not settings.configured:
        path = tmp_path_factory.mktemp("django") / "db.sqlite3"
        settings.configure(
            INSTALLED_APPS=["django_celery_beat"],
            DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": str(path)}},
            USE_TZ=True,
            TIME_ZONE="UTC",
            DEFAULT_AUTO_FIELD="django.db.models.AutoField",
        )
        django.setup()
    from django.core.management import call_command

    call_command("migrate", verbosity=0)
    yield
    clear()


@pytest.fixture(autouse=True)
def empty_schedule(database):
    clear()


def clear():
    from django_celery_beat.models import CrontabSchedule, IntervalSchedule, PeriodicTask

    PeriodicTask.objects.all().delete()
    CrontabSchedule.objects.all().delete()
    IntervalSchedule.objects.all().delete()


def make_app(beat_schedule=None):
    app = Celery("shop", set_as_current=False)
    app.conf.update(beat_schedule=beat_schedule or {}, task_always_eager=True, timezone="Europe/Paris")

    @app.task(name="shop.tasks.report")
    def report():
        return "done"

    return app, report


def add_cron(name, task, timezone="Europe/Paris", **fields):
    from django_celery_beat.models import CrontabSchedule, PeriodicTask

    schedule = CrontabSchedule.objects.create(timezone=timezone, **fields)
    return PeriodicTask.objects.create(name=name, task=task, crontab=schedule)


def add_interval(name, task, every, period="minutes", **options):
    from django_celery_beat.models import IntervalSchedule, PeriodicTask

    schedule = IntervalSchedule.objects.create(every=every, period=period)
    return PeriodicTask.objects.create(name=name, task=task, interval=schedule, **options)


def test_it_is_in_use_when_the_app_is_installed():
    assert django_celery_beat.in_use()


def test_reads_the_entries_of_the_database_with_their_own_time_zone(monitor):
    add_cron("nightly report", "shop.tasks.report", timezone="America/New_York", minute="0", hour="2")
    add_interval("poll prices", "shop.tasks.poll", 15)

    jobs = {job.key: job for job in CeleryIntegration(make_app()[0]).discover()}

    report = jobs["celery:shop.tasks.report"]
    assert (report.name, report.cron, report.timezone) == ("nightly report", "0 2 * * *", "America/New_York")
    assert jobs["celery:shop.tasks.poll"].interval == timedelta(minutes=15)


def test_disabled_and_one_off_entries_are_not_watched(monitor):
    add_interval("paused", "shop.tasks.paused", 5, enabled=False)
    add_interval("once", "shop.tasks.once", 5, one_off=True)
    add_interval("kept", "shop.tasks.kept", 5)

    assert [job.key for job in CeleryIntegration(make_app()[0]).discover()] == ["celery:shop.tasks.kept"]


def test_the_database_and_beat_schedule_are_declared_together(monitor):
    add_interval("from the database", "shop.tasks.poll", 10)
    app, _ = make_app({"from code": {"task": "shop.tasks.report", "schedule": crontab(minute=0, hour=3)},
                       "also the database task": {"task": "shop.tasks.poll", "schedule": 3600.0}})

    jobs = {job.key: job for job in CeleryIntegration(app).discover()}

    assert sorted(jobs) == ["celery:shop.tasks.poll", "celery:shop.tasks.report"]
    # The same task in both: declared from the schedule that fires most often.
    assert jobs["celery:shop.tasks.poll"].interval == timedelta(minutes=10)


def test_a_worker_declares_the_database_schedule_and_reports_its_runs(monitor, server):
    add_cron("nightly report", "shop.tasks.report", minute="0", hour="2")
    app, report = make_app()
    instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)

    assert [check["key"] for check in server.syncs[-1]["checks"]] == ["celery:shop.tasks.report"]
    assert report.apply().get() == "done"
    assert server.wait_pings(2) == [("pk-celery:shop.tasks.report", "/start"), ("pk-celery:shop.tasks.report", "/0")]
    # The process that ran it now watches the database for changes.
    assert any(thread.name == "silencewatch-django-celery-beat" for thread in threading.enumerate())


def test_a_change_in_the_database_is_declared_and_then_reported(monitor, server):
    add_cron("nightly report", "shop.tasks.report", minute="0", hour="2")
    app, _ = make_app()
    integration = instrument(app, monitor=monitor)
    signals.worker_init.send(sender=None)
    assert len(server.syncs) == 1

    @app.task(name="shop.tasks.poll")
    def poll():
        return "polled"

    add_interval("poll prices", "shop.tasks.poll", 15)  # in the admin, while the worker runs
    integration.check_database()  # what the watching thread does every minute

    assert len(server.syncs) == 2
    assert sorted(check["key"] for check in server.syncs[-1]["checks"]) == [
        "celery:shop.tasks.poll", "celery:shop.tasks.report"]
    poll.apply()
    assert server.wait_pings(2) == [("pk-celery:shop.tasks.poll", "/start"), ("pk-celery:shop.tasks.poll", "/0")]


def test_an_unchanged_database_is_not_declared_again(monitor, server):
    add_cron("nightly report", "shop.tasks.report", minute="0", hour="2")
    integration = instrument(make_app()[0], monitor=monitor)
    signals.worker_init.send(sender=None)

    integration.check_database()
    integration.check_database()

    assert len(server.syncs) == 1
