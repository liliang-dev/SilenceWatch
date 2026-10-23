"""APScheduler 3.

Reads the jobs of a scheduler, declares each to SilenceWatch with its real
schedule, and sends a heartbeat around every run::

    from silencewatch.integrations.apscheduler import instrument

    scheduler = BackgroundScheduler()
    scheduler.add_job(nightly, "cron", hour=2, id="nightly-backup")
    instrument(scheduler)
    scheduler.start()

Jobs are declared when the scheduler starts (or at once, if it is already
running) and again, a couple of seconds later, whenever a job is added or removed.

**Give a job an ``id``.** APScheduler makes up a random one otherwise, which is
different on every start and so cannot tie a job to its history. Without an id a
job is identified by the function it runs (``apscheduler:app.jobs:nightly``),
which is stable; two jobs running the same function with no id are told apart by
their trigger, and the log says so.

A run's duration is measured from the moment the executor accepted it to the
moment it finished, so time spent queued behind other jobs is included.

Not supported, and said so in the log: one-off ``date`` triggers (there is nothing
to wait for twice), combined ``and``/``or`` triggers, and the week, year and
"third friday" cron fields. APScheduler 4 has another API and is not read yet.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from apscheduler.events import (
    EVENT_JOB_ADDED,
    EVENT_JOB_ERROR,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_REMOVED,
    EVENT_JOB_SUBMITTED,
    EVENT_SCHEDULER_STARTED,
    JobEvent,
)
from apscheduler.schedulers.base import BaseScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..model import DiscoveredJob
from ..monitor import Monitor, get_monitor
from .base import Integration

log = logging.getLogger("silencewatch")

_AUTO_ID = re.compile(r"^[0-9a-f]{32}$")  # what APScheduler makes up when no id is given
#: A burst of ``add_job`` calls at startup becomes one declaration.
_REDECLARE_AFTER_SECONDS = 2.0
_POSITIONAL = re.compile(r"\b(\d+(st|nd|rd|th)|last)\b", re.IGNORECASE)
_DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def cron_expression(trigger: CronTrigger) -> Optional[str]:
    """An APScheduler ``CronTrigger`` as a cron expression, or ``None`` if it cannot be one."""
    fields = {field.name: str(field) for field in trigger.fields}
    for name in ("year", "week"):
        if fields.get(name, "*") != "*":
            log.warning("A cron trigger uses the %s field, which cron has no equivalent for", name)
            return None
    # "last fri", "3rd mon" and "last" (the last day) live in APScheduler's day field.
    if _POSITIONAL.search(fields["day"]) or _POSITIONAL.search(fields["day_of_week"]):
        log.warning('A cron trigger uses "%s", which cron has no equivalent for', fields["day"])
        return None

    five = [fields["minute"], fields["hour"], fields["day"], fields["month"], _weekday(fields["day_of_week"])]
    if fields["second"] not in ("0", "00"):
        return " ".join([fields["second"], *five])  # six fields: seconds first
    return " ".join(five)


def _weekday(expression: str) -> str:
    """APScheduler counts Monday as 0 and cron counts Sunday as 0, so spell days out."""
    def convert(token: str) -> str:
        return _DAYS[int(token)] if token.isdigit() and int(token) < 7 else token
    return re.sub(r"[A-Za-z0-9]+", lambda match: convert(match.group(0)), expression)


class APSchedulerIntegration(Integration):
    name = "apscheduler"

    def __init__(self, scheduler: BaseScheduler) -> None:
        self.scheduler = scheduler
        self._monitor: Optional[Monitor] = None
        self._keys: Dict[str, str] = {}  # job id -> job key
        self._started: Dict[Tuple[str, Any], float] = {}
        self._lock = threading.Lock()
        self._timer: Optional[threading.Timer] = None

    # -- discovery --------------------------------------------------------------

    def discover(self) -> List[DiscoveredJob]:
        # (identity, job id, name, cron, interval, timezone)
        found: List[Tuple[str, str, str, Optional[str], Optional[timedelta], Optional[str]]] = []
        for job in self.scheduler.get_jobs():
            trigger = job.trigger
            identity = self._identity(job)
            if isinstance(trigger, CronTrigger):
                cron = cron_expression(trigger)
                if cron is None:
                    log.warning("Not declaring job %s: its cron trigger cannot be expressed as cron", job.id)
                    continue
                found.append((identity, job.id, job.name, cron, None, _zone_name(trigger.timezone)))
            elif isinstance(trigger, IntervalTrigger):
                found.append((identity, job.id, job.name, None, trigger.interval, None))
            else:
                log.info("Not declaring job %s: a %s trigger is not a recurring schedule SilenceWatch can watch",
                         job.id, type(trigger).__name__)

        shared = {identity for identity, *_ in found if sum(1 for other in found if other[0] == identity) > 1}
        position: Dict[str, int] = {}
        jobs: List[DiscoveredJob] = []
        keys: Dict[str, str] = {}
        ordered = sorted(found, key=lambda item: (item[0], str(item[3] or item[4])))
        for identity, job_id, name, cron, interval, zone in ordered:
            key = f"{self.name}:{identity}"
            if identity in shared:
                position[identity] = position.get(identity, 0) + 1
                key += f"#{position[identity]}"
                if position[identity] == 1:
                    log.warning("Several jobs run %s without an id of their own, so they are told apart by their "
                                "trigger; give each an id= to keep their history if one changes.", identity)
            keys[job_id] = key
            jobs.append(DiscoveredJob(key=key, name=name, cron=cron, interval=interval, timezone=zone))
        self._keys = keys
        return jobs

    def _identity(self, job: Any) -> str:
        """A key that is the same on every start: the explicit id, or else the function."""
        if not _AUTO_ID.match(job.id):
            return str(job.id)
        return str(getattr(job, "func_ref", None) or job.name)

    # -- hooks ------------------------------------------------------------------

    def install(self, monitor: Monitor) -> None:
        self._monitor = monitor
        self.scheduler.add_listener(
            self._on_event,
            EVENT_SCHEDULER_STARTED | EVENT_JOB_ADDED | EVENT_JOB_REMOVED
            | EVENT_JOB_SUBMITTED | EVENT_JOB_EXECUTED | EVENT_JOB_ERROR,
        )
        if self.scheduler.running:
            self.register()

    def register(self) -> None:
        """Declare the jobs now. Called when the scheduler starts; callable by hand."""
        if self._monitor is None:
            return
        try:
            self._monitor.declare(self, self.discover())
        except Exception:  # noqa: BLE001 - never fail the scheduler
            log.warning("SilenceWatch could not read the scheduler's jobs", exc_info=True)

    def _on_event(self, event: Any) -> None:
        try:
            code = event.code
            if code == EVENT_SCHEDULER_STARTED:
                self.register()
            elif code in (EVENT_JOB_ADDED, EVENT_JOB_REMOVED):
                if self.scheduler.running:
                    self._schedule_redeclaration()
            elif isinstance(event, JobEvent):
                self._on_run(event)
        except Exception:  # noqa: BLE001 - a listener that raises would be logged by APScheduler as the job's
            log.debug("SilenceWatch could not handle a scheduler event", exc_info=True)

    def _schedule_redeclaration(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(_REDECLARE_AFTER_SECONDS, self.register)
            self._timer.daemon = True
            self._timer.start()

    def _on_run(self, event: JobEvent) -> None:
        key = self._keys.get(event.job_id)
        if key is None or self._monitor is None:
            return
        if event.code == EVENT_JOB_SUBMITTED:
            for run_time in getattr(event, "scheduled_run_times", None) or [None]:
                with self._lock:
                    self._started[(event.job_id, run_time)] = time.monotonic()
            self._monitor.started(key)
            return
        run_time = getattr(event, "scheduled_run_time", None)
        with self._lock:
            began = self._started.pop((event.job_id, run_time), None)
        elapsed = int((time.monotonic() - began) * 1000) if began is not None else 0
        if event.code == EVENT_JOB_EXECUTED:
            self._monitor.succeeded(key, elapsed)
        elif event.code == EVENT_JOB_ERROR:
            self._monitor.failed(key, elapsed)


def _zone_name(zone: Any) -> Optional[str]:
    """The IANA name of a timezone object, whichever library made it."""
    for attribute in ("key", "zone"):
        name = getattr(zone, attribute, None)
        if isinstance(name, str):
            return name
    text = str(zone)
    return text if "/" in text or text == "UTC" else None


def instrument(scheduler: BaseScheduler, monitor: Optional[Monitor] = None, **settings: Any) -> APSchedulerIntegration:
    """Watch the jobs of ``scheduler``.

    ``settings`` (``api_key=``, ``environment=``, …) configure a new monitor for
    this call; without them the process-wide one is used, configured from the
    environment (``SILENCEWATCH_API_KEY`` …).
    """
    integration = APSchedulerIntegration(scheduler)
    chosen = monitor if monitor is not None else (Monitor(**settings) if settings else get_monitor())
    chosen.attach(integration)
    return integration
