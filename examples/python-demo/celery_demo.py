"""A plain Celery application with two scheduled tasks and no monitoring code.

Adding the library is the whole integration: the single `instrument(app)` line.

    celery -A celery_demo worker --beat --loglevel=info

The broker is a folder on disk, so the demo needs no Redis or RabbitMQ.
"""

import logging
import os
import tempfile
from datetime import timedelta

from celery import Celery
from celery.schedules import crontab

from silencewatch.integrations.celery import instrument

log = logging.getLogger("demo")

_broker = os.path.join(tempfile.gettempdir(), "silencewatch-celery-demo")
os.makedirs(os.path.join(_broker, "queue"), exist_ok=True)

app = Celery(
    "demo",
    broker="filesystem://",
    broker_transport_options={
        "data_folder_in": os.path.join(_broker, "queue"),
        "data_folder_out": os.path.join(_broker, "queue"),
        "control_folder": os.path.join(_broker, "control"),
    },
)
app.conf.beat_schedule = {
    "backup": {"task": "celery_demo.backup", "schedule": crontab(minute="*/5")},
    "export": {"task": "celery_demo.export", "schedule": timedelta(minutes=1)},
}
app.conf.beat_schedule_filename = os.path.join(_broker, "celerybeat-schedule")

runs = {"export": 0}


@app.task(name="celery_demo.backup")
def backup() -> None:
    log.info("backing up")


@app.task(name="celery_demo.export")
def export() -> None:
    runs["export"] += 1
    log.info("exporting (run %d)", runs["export"])
    if runs["export"] % 3 == 0:
        # Every third run fails, so the down-and-recovered path is visible too.
        raise RuntimeError("the export failed")


instrument(app)  # reads SILENCEWATCH_API_KEY (and SILENCEWATCH_URL) from the environment
