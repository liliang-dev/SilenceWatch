"""The monitor: one per process, shared by every integration."""

from __future__ import annotations

import logging
import threading
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from .client import SilenceWatchClient
from .config import Config
from .cron import is_supported
from .heartbeat import HeartbeatSender
from .model import DiscoveredJob

if TYPE_CHECKING:
    from .integrations.base import Integration

log = logging.getLogger("silencewatch")

#: After a declaration that did not go through, the next try waits this long.
_RETRY_AFTER_SECONDS = 60.0


class Monitor:
    """Holds the configuration, the connection to SilenceWatch and every job found.

    Integrations (Celery, APScheduler, and the ones to come) report the jobs they
    find with :meth:`declare` and the runs they see with :meth:`started`,
    :meth:`succeeded` and :meth:`failed`. The monitor declares *all* of them in a
    single request, because a declaration is complete by nature: what it leaves
    out is flagged orphaned, so two integrations declaring separately would each
    orphan the other's jobs.
    """

    def __init__(self, config: Optional[Config] = None, **settings: Any) -> None:
        self.config = config if config is not None else Config.resolve(**settings)
        self._client = SilenceWatchClient(self.config)
        self._sender = HeartbeatSender(self.config, self._client)
        self._lock = threading.RLock()
        self._jobs: Dict[str, List[DiscoveredJob]] = {}
        self._integrations: List[Integration] = []
        self._next_attempt = 0.0
        self._registered = False

    # -- integrations -----------------------------------------------------------

    def attach(self, integration: Integration) -> Integration:
        """Start watching what an integration finds. Does nothing when disabled."""
        if not self.config.enabled:
            log.info("SilenceWatch is disabled; %s is not instrumented", integration.name)
            return integration
        with self._lock:
            self._integrations.append(integration)
        try:
            integration.install(self)
        except Exception:  # noqa: BLE001 - startup must never fail because monitoring could not be set up
            log.warning("SilenceWatch could not instrument %s; the application continues without it",
                        integration.name, exc_info=True)
        return integration

    def declare(self, integration: Integration, jobs: List[DiscoveredJob]) -> None:
        """An integration reports its jobs (all of them, every time): declare everything known."""
        with self._lock:
            self._jobs[integration.name] = list(jobs)
            self._registered = False
            self._next_attempt = 0.0
        self.ensure_registered()

    def ensure_registered(self) -> bool:
        """Declare the jobs now if it has not worked yet. Cheap to call; never raises.

        A first heartbeat calls it too, so a process that started while SilenceWatch
        was unreachable declares itself as soon as it can, at most once a minute.
        """
        if not self.config.usable or not self.config.auto_register:
            return False
        with self._lock:
            if self._registered:
                return True
            if time.monotonic() < self._next_attempt:
                return False
            jobs = self._supported_jobs()
            if not jobs:
                return False
            source = "python-" + "+".join(sorted(name for name, found in self._jobs.items() if found))
            shared, per_instance = self._split(jobs)
            # Two declarations, each in its own environment: the shared one never
            # orphans another instance's checks, nor this instance's the shared ones.
            keys: Dict[str, str] = {}
            complete = True
            for group, environment in ((shared, None), (per_instance, self.config.instance_environment)):
                if not group:
                    continue
                try:
                    found = self._client.sync(group, source, environment)
                except Exception:  # noqa: BLE001
                    log.warning("SilenceWatch registration failed", exc_info=True)
                    found = {}
                complete = complete and bool(found)
                keys.update(found)
            if keys:
                self._sender.register(keys)
            if not complete:
                self._next_attempt = time.monotonic() + _RETRY_AFTER_SECONDS
                return False
            self._registered = True
            if per_instance:
                log.info("SilenceWatch is watching %d job(s) in environment '%s', %d of them for this "
                         "instance alone in '%s'", len(keys), self.config.environment, len(per_instance),
                         self.config.instance_environment)
            else:
                log.info("SilenceWatch is watching %d job(s) in environment '%s'", len(keys),
                         self.config.environment)
            return True

    def _split(self, jobs: List[DiscoveredJob]) -> Tuple[List[DiscoveredJob], List[DiscoveredJob]]:
        """The jobs watched for all instances, and the ones watched on this one alone."""
        shared: List[DiscoveredJob] = []
        per_instance: List[DiscoveredJob] = []
        for job in jobs:
            if not self.config.is_per_instance(job.key):
                shared.append(job)
            elif job.key.startswith("celery:"):
                # One worker runs each run of a Celery task: the others would never
                # report it, and its check on each of them would go down.
                log.warning("SilenceWatch watches Celery task %s for all workers: one worker runs each run, "
                            "so it cannot be watched per instance", job.key)
                shared.append(job)
            else:
                per_instance.append(job)
        if per_instance and self.config.instance_environment is None:
            # Better one check for all the instances than none at all.
            log.warning("SilenceWatch per_instance_jobs is set but instance_id is missing, or leaves no room "
                        "in the environment name; %d job(s) are watched as one check for all instances",
                        len(per_instance))
            return shared + per_instance, []
        return shared, per_instance

    def _supported_jobs(self) -> List[DiscoveredJob]:
        jobs: List[DiscoveredJob] = []
        seen: Dict[str, str] = {}
        for source, found in self._jobs.items():
            for job in found:
                if job.cron is not None and not is_supported(job.cron):
                    log.warning('Not declaring job %s: SilenceWatch cannot evaluate the cron expression "%s"',
                                job.key, job.cron)
                    continue
                if job.key in seen:
                    log.warning("Job %s is found by both %s and %s; keeping the first", job.key, seen[job.key], source)
                    continue
                seen[job.key] = source
                jobs.append(job)
        return jobs

    # -- runs -------------------------------------------------------------------

    def started(self, job_key: str) -> None:
        if self._ready(job_key):
            self._sender.started(job_key)

    def succeeded(self, job_key: str, duration_ms: int) -> None:
        if self._ready(job_key):
            self._sender.succeeded(job_key, duration_ms)

    def failed(self, job_key: str, duration_ms: int) -> None:
        if self._ready(job_key):
            self._sender.failed(job_key, duration_ms)

    def _ready(self, job_key: str) -> bool:
        if not self.config.usable or not self.config.auto_register:
            return False
        try:
            self.ensure_registered()
        except Exception:  # noqa: BLE001
            return False
        return self._sender.knows(job_key)

    def flush(self, timeout: float = 2.0) -> None:
        """Wait for the heartbeats still queued (they are also flushed at exit)."""
        self._sender.flush(timeout)


_default: Optional[Monitor] = None
_default_lock = threading.Lock()


def configure(**settings: Any) -> Monitor:
    """Create the process-wide monitor from keyword settings and the environment."""
    global _default
    with _default_lock:
        _default = Monitor(**settings)
        return _default


def get_monitor() -> Monitor:
    """The process-wide monitor; configured from the environment on first use."""
    global _default
    with _default_lock:
        if _default is None:
            _default = Monitor()
        return _default
