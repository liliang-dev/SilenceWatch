"""A plain APScheduler application with two jobs and no monitoring code.

Adding the library is the whole integration: the single `instrument(scheduler)` line.
"""

import logging
import time

from apscheduler.schedulers.background import BackgroundScheduler

from silencewatch.integrations.apscheduler import instrument

log = logging.getLogger("demo")

runs = {"export": 0}


def backup() -> None:
    log.info("backing up")


def export() -> None:
    runs["export"] += 1
    log.info("exporting (run %d)", runs["export"])
    if runs["export"] % 3 == 0:
        # Every third run fails, so the down-and-recovered path is visible too.
        raise RuntimeError("the export failed")


def build_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler()
    # Give each job an id: it is what ties a job to its history across restarts.
    scheduler.add_job(backup, "cron", minute="*/5", id="backup")
    scheduler.add_job(export, "interval", minutes=1, id="export")
    return scheduler


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    scheduler = build_scheduler()
    instrument(scheduler)  # reads SILENCEWATCH_API_KEY (and SILENCEWATCH_URL) from the environment
    scheduler.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        scheduler.shutdown()
