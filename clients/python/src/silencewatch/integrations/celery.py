"""Celery beat.

Reads the ``beat_schedule`` of a Celery app, declares each entry to SilenceWatch
with its real schedule, and sends a heartbeat around every run of a task that beat
schedules::

    from silencewatch.integrations.celery import instrument

    app = Celery("shop")
    app.conf.beat_schedule = {...}
    instrument(app)

Discovery happens when a worker starts, in the main process before the pool
forks, so every child inherits the ping keys. Heartbeats are sent from the worker
that runs the task.

A task is identified by its name (``celery:shop.tasks.nightly_backup``), which is
stable across restarts and renames of the beat entry. If one task is scheduled by
several entries, it is declared from the one that fires most often, since that is
the deadline a missed run breaches first.

Not supported, and said so in the log: solar schedules, and schedules kept in a
database (``django-celery-beat``), which are not in ``beat_schedule``.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import timedelta
from typing import Any, Dict, List, Optional, Tuple

from celery import Celery, signals
from celery.schedules import crontab, maybe_schedule, schedule, solar

from ..cron import compact
from ..model import DiscoveredJob
from ..monitor import Monitor, get_monitor
from .base import Integration

log = logging.getLogger("silencewatch")

# (attribute, lowest, highest). Celery counts Sunday as 0, like cron.
_CRONTAB_FIELDS: Tuple[Tuple[str, int, int], ...] = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day_of_month", 1, 31),
    ("month_of_year", 1, 12),
    ("day_of_week", 0, 6),
)


def crontab_expression(entry: crontab) -> str:
    """A Celery ``crontab`` as the five-field expression SilenceWatch reads."""
    fields = [compact(getattr(entry, name), low, high) for name, low, high in _CRONTAB_FIELDS]
    day_of_month, day_of_week = fields[2], fields[4]
    if day_of_month != "*" and day_of_week != "*":
        # Celery requires both to match; standard cron fires when either does.
        log.warning("A beat entry restricts both the day of the month and the day of the week: Celery "
                    "runs it when both match, SilenceWatch will expect it when either does")
    return " ".join(fields)


class CeleryIntegration(Integration):
    name = "celery"

    def __init__(self, app: Celery) -> None:
        self.app = app
        self._monitor: Optional[Monitor] = None
        self._keys: Dict[str, str] = {}  # task name -> job key
        self._started: Dict[str, float] = {}  # task id -> monotonic start
        self._lock = threading.Lock()

    # -- discovery --------------------------------------------------------------

    def discover(self) -> List[DiscoveredJob]:
        # task name -> (beat entry name, cron, interval, seconds between runs)
        chosen: Dict[str, Tuple[str, Optional[str], Optional[timedelta], float]] = {}
        for entry_name, entry in dict(self.app.conf.beat_schedule or {}).items():
            task = entry.get("task") if isinstance(entry, dict) else getattr(entry, "task", None)
            raw = entry.get("schedule") if isinstance(entry, dict) else getattr(entry, "schedule", None)
            if not task or raw is None:
                continue
            try:
                parsed = maybe_schedule(raw, app=self.app)
            except Exception:  # noqa: BLE001
                log.warning("Not declaring beat entry %s: its schedule is not understood", entry_name)
                continue
            cron, interval, period = self._describe(entry_name, parsed)
            if period is None:
                continue
            kept = chosen.get(task)
            if kept is None or period < kept[3]:
                chosen[task] = (entry_name, cron, interval, period)

        zone = self._timezone()
        jobs: List[DiscoveredJob] = []
        self._keys = {}
        for task, (entry_name, cron, interval, _) in chosen.items():
            key = f"{self.name}:{task}"
            self._keys[task] = key
            jobs.append(DiscoveredJob(key=key, name=entry_name, cron=cron, interval=interval,
                                      timezone=zone if cron else None))
        return jobs

    @staticmethod
    def _describe(entry_name: str, parsed: Any) -> Tuple[Optional[str], Optional[timedelta], Optional[float]]:
        """``(cron, interval, average seconds between runs)``; all ``None`` when it cannot be watched."""
        if isinstance(parsed, crontab):  # before `schedule`: a crontab is one
            return crontab_expression(parsed), None, _crontab_period(parsed)
        if isinstance(parsed, solar):
            log.warning("Not declaring beat entry %s: a solar schedule has no fixed time to watch", entry_name)
            return None, None, None
        if isinstance(parsed, schedule):
            return None, parsed.run_every, parsed.run_every.total_seconds()
        log.warning("Not declaring beat entry %s: unsupported schedule %r", entry_name, type(parsed).__name__)
        return None, None, None

    def _timezone(self) -> str:
        zone = self.app.conf.timezone
        return str(zone) if zone else "UTC"

    # -- hooks ------------------------------------------------------------------

    def install(self, monitor: Monitor) -> None:
        self._monitor = monitor
        # `worker_init` fires in the main process before the pool forks.
        signals.worker_init.connect(self._on_worker_init, weak=False, dispatch_uid=f"silencewatch-init-{id(self)}")
        signals.task_prerun.connect(self._on_prerun, weak=False, dispatch_uid=f"silencewatch-pre-{id(self)}")
        signals.task_postrun.connect(self._on_postrun, weak=False, dispatch_uid=f"silencewatch-post-{id(self)}")

    def _on_worker_init(self, **_: Any) -> None:
        self.register()

    def register(self) -> None:
        """Declare the beat schedule now. Called when a worker starts; callable by hand."""
        if self._monitor is None:
            return
        try:
            self._monitor.declare(self, self.discover())
        except Exception:  # noqa: BLE001
            log.warning("SilenceWatch could not read the beat schedule", exc_info=True)

    def _on_prerun(self, task_id: Optional[str] = None, task: Any = None, **_: Any) -> None:
        key = self._key_of(task)
        if key is None or self._monitor is None or task_id is None:
            return
        try:
            with self._lock:
                self._started[task_id] = time.monotonic()
            self._monitor.started(key)
        except Exception:  # noqa: BLE001 - never fail the task
            log.debug("SilenceWatch could not report the start of %s", key, exc_info=True)

    def _on_postrun(
        self, task_id: Optional[str] = None, task: Any = None, state: Optional[str] = None, **_: Any
    ) -> None:
        key = self._key_of(task)
        if key is None or self._monitor is None or task_id is None:
            return
        try:
            with self._lock:
                began = self._started.pop(task_id, None)
            elapsed = int((time.monotonic() - began) * 1000) if began is not None else 0
            if state == "SUCCESS":
                self._monitor.succeeded(key, elapsed)
            elif state == "FAILURE":
                self._monitor.failed(key, elapsed)
            # RETRY, REVOKED, IGNORED: the run did not end, so there is nothing to report.
        except Exception:  # noqa: BLE001
            log.debug("SilenceWatch could not report the end of %s", key, exc_info=True)

    def _key_of(self, task: Any) -> Optional[str]:
        name = getattr(task, "name", None)
        return self._keys.get(name) if name else None


def _crontab_period(entry: crontab) -> float:
    """Average seconds between runs of a crontab, to tell which of two fires more often."""
    per_day = len(entry.minute) * len(entry.hour)
    share = (len(entry.day_of_month) / 31) * (len(entry.month_of_year) / 12) * (len(entry.day_of_week) / 7)
    return 86400.0 / max(per_day * max(share, 1e-6), 1e-9)


def instrument(app: Celery, monitor: Optional[Monitor] = None, **settings: Any) -> CeleryIntegration:
    """Watch the beat schedule of ``app``.

    ``settings`` (``api_key=``, ``environment=``, …) configure a new monitor for
    this call; without them the process-wide one is used, configured from the
    environment (``SILENCEWATCH_API_KEY`` …).
    """
    integration = CeleryIntegration(app)
    chosen = monitor if monitor is not None else (Monitor(**settings) if settings else get_monitor())
    chosen.attach(integration)
    return integration
