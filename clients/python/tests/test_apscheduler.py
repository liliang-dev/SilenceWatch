import logging
from datetime import timedelta

import pytest

pytest.importorskip("apscheduler")

from apscheduler.schedulers.background import BackgroundScheduler  # noqa: E402
from apscheduler.triggers.cron import CronTrigger  # noqa: E402
from apscheduler.triggers.date import DateTrigger  # noqa: E402

from silencewatch.integrations.apscheduler import APSchedulerIntegration, cron_expression, instrument  # noqa: E402


def nightly():
    return "ok"


def boom():
    raise RuntimeError("nope")


@pytest.mark.parametrize(
    ("trigger", "written"),
    [
        (CronTrigger(hour=2, minute=0), "0 2 * * *"),
        (CronTrigger(minute="*/15"), "*/15 * * * *"),
        (CronTrigger(day_of_week="mon-fri", hour=9, minute=30), "30 9 * * mon-fri"),
        (CronTrigger(day_of_week="0,6", hour=1, minute=0), "0 1 * * mon,sun"),
        (CronTrigger(day=1, hour=0, minute=0), "0 0 1 * *"),
        (CronTrigger(second="*/20"), "*/20 * * * * *"),
        (CronTrigger.from_crontab("0 8 * * 1"), "0 8 * * tue"),
    ],
)
def test_a_cron_trigger_is_written_as_a_cron_expression(trigger, written):
    assert cron_expression(trigger) == written


@pytest.mark.parametrize(
    "trigger",
    [
        CronTrigger(week=3),
        CronTrigger(year=2030),
        CronTrigger(day="last fri"),
        CronTrigger(day="3rd mon"),
        CronTrigger(day="last"),
    ],
)
def test_a_trigger_with_no_cron_equivalent_is_refused(trigger):
    assert cron_expression(trigger) is None


def test_reads_the_jobs_of_a_scheduler(monitor):
    scheduler = BackgroundScheduler(timezone="Europe/Paris")
    scheduler.add_job(nightly, "cron", hour=2, id="nightly-backup")
    scheduler.add_job(nightly, "interval", minutes=15, id="poll")
    jobs = {job.key: job for job in APSchedulerIntegration(scheduler).discover()}

    assert jobs["apscheduler:nightly-backup"].cron == "0 2 * * *"
    assert jobs["apscheduler:nightly-backup"].timezone == "Europe/Paris"
    assert jobs["apscheduler:poll"].interval == timedelta(minutes=15)


def test_a_job_without_an_id_is_known_by_its_function_not_by_a_random_id(monitor):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "interval", hours=1)
    (job,) = APSchedulerIntegration(scheduler).discover()
    assert job.key == f"apscheduler:{__name__}:nightly"

    other = BackgroundScheduler()
    other.add_job(nightly, "interval", hours=1)
    (again,) = APSchedulerIntegration(other).discover()
    assert again.key == job.key  # the same on every start


def test_two_jobs_with_the_same_function_and_no_id_are_told_apart_and_it_is_said(monitor, caplog):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "interval", hours=1)
    scheduler.add_job(nightly, "interval", hours=2)
    with caplog.at_level(logging.WARNING, logger="silencewatch"):
        keys = sorted(job.key for job in APSchedulerIntegration(scheduler).discover())
    assert keys == [f"apscheduler:{__name__}:nightly#1", f"apscheduler:{__name__}:nightly#2"]
    assert "give each an id" in caplog.text


def test_a_one_off_job_is_not_a_schedule_to_watch(monitor):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, DateTrigger(run_date="2099-01-01"), id="once")
    scheduler.add_job(nightly, "interval", hours=1, id="regular")
    assert [job.key for job in APSchedulerIntegration(scheduler).discover()] == ["apscheduler:regular"]


def test_runs_are_reported_end_to_end(monitor, server):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "interval", seconds=1, id="tick")
    scheduler.add_job(boom, "interval", seconds=1, id="bad")
    instrument(scheduler, monitor=monitor)
    scheduler.start()
    try:
        assert server.wait_for(
            lambda: any(p[1] == "/0" for p in server.pings) and any(p[1] == "/fail" for p in server.pings), timeout=8
        )
    finally:
        scheduler.shutdown(wait=False)

    assert server.syncs[0]["source"] == "python-apscheduler"
    declared = {c["key"]: c for c in server.syncs[0]["checks"]}
    assert declared["apscheduler:tick"]["interval_seconds"] == 30  # one second is below what the server accepts
    assert ("pk-apscheduler:tick", "/start") in server.pings
    assert ("pk-apscheduler:tick", "/0") in server.pings
    assert ("pk-apscheduler:bad", "/fail") in server.pings


def test_a_scheduler_that_is_already_running_is_declared_at_once(monitor, server):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "interval", hours=1, id="hourly")
    scheduler.start()
    try:
        instrument(scheduler, monitor=monitor)
        assert [c["key"] for c in server.syncs[-1]["checks"]] == ["apscheduler:hourly"]
    finally:
        scheduler.shutdown(wait=False)


def test_a_job_added_later_is_declared_again(monitor, server):
    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "interval", hours=1, id="first")
    instrument(scheduler, monitor=monitor)
    scheduler.start()
    try:
        scheduler.add_job(nightly, "interval", hours=2, id="second")
        both = {"apscheduler:first", "apscheduler:second"}
        assert server.wait_for(lambda: any({c["key"] for c in s["checks"]} == both for s in server.syncs), timeout=8)
    finally:
        scheduler.shutdown(wait=False)
