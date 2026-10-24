"""The examples are the library's real contract: if they stop declaring their jobs, this fails.

Nothing is sent anywhere: the integrations are asked what they find, which is what they
would declare to SilenceWatch.
"""

from datetime import timedelta

from apscheduler_demo import build_scheduler
from celery_demo import app

from silencewatch.integrations.apscheduler import APSchedulerIntegration
from silencewatch.integrations.celery import CeleryIntegration


def test_apscheduler_demo_declares_its_two_jobs() -> None:
    jobs = {job.key: job for job in APSchedulerIntegration(build_scheduler()).discover()}

    assert set(jobs) == {"apscheduler:backup", "apscheduler:export"}
    assert jobs["apscheduler:backup"].cron == "*/5 * * * *"
    assert jobs["apscheduler:export"].interval == timedelta(minutes=1)


def test_celery_demo_declares_its_two_tasks() -> None:
    jobs = {job.key: job for job in CeleryIntegration(app).discover()}

    assert set(jobs) == {"celery:celery_demo.backup", "celery:celery_demo.export"}
    assert jobs["celery:celery_demo.backup"].cron == "*/5 * * * *"
    assert jobs["celery:celery_demo.export"].interval == timedelta(minutes=1)
