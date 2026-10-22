"""Sending heartbeats without ever getting in the way of the job they describe."""

from __future__ import annotations

import atexit
import logging
import os
import threading
import time
from collections import deque
from typing import Deque, Dict, Optional, Tuple

from .client import SilenceWatchClient
from .config import Config

log = logging.getLogger("silencewatch")

#: One warning a minute, so an outage cannot flood the logs.
_WARNING_INTERVAL_SECONDS = 60.0

_Item = Tuple[str, str, Optional[int]]  # (job key, ping suffix, duration in ms)


class HeartbeatSender:
    """A bounded queue and one daemon thread.

    * **It never blocks.** ``send`` is a queue append. An unreachable server costs
      the job nothing.
    * **It is bounded.** At most ``queue_capacity`` heartbeats wait; past that the
      oldest are dropped, because the freshest state is the one worth reporting.
    * **It survives a fork.** Celery's prefork pool and gunicorn fork after the
      library started, and a thread does not cross a fork: the child starts its own
      queue and thread the first time it has something to send.
    """

    def __init__(self, config: Config, client: SilenceWatchClient) -> None:
        self._config = config
        self._client = client
        self._ping_keys: Dict[str, str] = {}
        self._lock = threading.Condition()
        self._queue: Deque[_Item] = deque(maxlen=max(1, config.queue_capacity))
        self._thread: Optional[threading.Thread] = None
        self._pid = os.getpid()
        self._last_warning = 0.0
        self._in_flight = 0
        self.delivered_count = 0
        self.failure_count = 0
        self.dropped_count = 0
        atexit.register(self.flush)
        if hasattr(os, "register_at_fork"):
            os.register_at_fork(after_in_child=self._after_fork)

    # -- what the monitor tells it ---------------------------------------------

    def register(self, ping_keys: Dict[str, str]) -> None:
        """The ping keys the server returned, indexed by job key."""
        self._ping_keys = dict(ping_keys)

    def knows(self, job_key: str) -> bool:
        return job_key in self._ping_keys

    def started(self, job_key: str) -> None:
        if self._config.report_start:
            self._submit(job_key, "/start", None)

    def succeeded(self, job_key: str, duration_ms: int) -> None:
        self._submit(job_key, "/0", duration_ms)

    def failed(self, job_key: str, duration_ms: int) -> None:
        self._submit(job_key, "/fail", duration_ms)

    # -- delivery ---------------------------------------------------------------

    def _submit(self, job_key: str, suffix: str, duration_ms: Optional[int]) -> None:
        # A job that was never declared (registration failed, or it is new since the
        # last declaration) has no ping key: there is nowhere to send it.
        if job_key not in self._ping_keys:
            return
        try:
            with self._lock:
                self._ensure_thread()
                if len(self._queue) == self._queue.maxlen:
                    self.dropped_count += 1
                self._queue.append((job_key, suffix, duration_ms))
                self._lock.notify()
        except Exception:  # noqa: BLE001 - monitoring must never break the job
            log.debug("SilenceWatch could not queue a heartbeat", exc_info=True)

    def _ensure_thread(self) -> None:
        if self._pid != os.getpid():  # a fork that register_at_fork did not catch
            self._after_fork()
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self._run, name="silencewatch-heartbeat", daemon=True)
            self._thread.start()

    def _run(self) -> None:
        while True:
            with self._lock:
                while not self._queue:
                    self._lock.wait()
                job_key, suffix, duration_ms = self._queue.popleft()
                self._in_flight += 1
            try:
                self._deliver(job_key, suffix, duration_ms)
            finally:
                with self._lock:
                    self._in_flight -= 1

    def _deliver(self, job_key: str, suffix: str, duration_ms: Optional[int]) -> None:
        ping_key = self._ping_keys.get(job_key)
        if ping_key is None:
            return
        delivered = False
        try:
            delivered = self._client.ping(ping_key, suffix, duration_ms)
        except Exception:  # noqa: BLE001
            delivered = False
        if delivered:
            self.delivered_count += 1
            return
        self.failure_count += 1
        now = time.monotonic()
        if now - self._last_warning >= _WARNING_INTERVAL_SECONDS:
            self._last_warning = now
            log.warning("SilenceWatch is not reachable: %d heartbeat(s) not delivered so far", self.failure_count)

    def flush(self, timeout: float = 2.0) -> None:
        """Wait, up to ``timeout`` seconds, for what is queued. Called when the process exits."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with self._lock:
                idle = not self._queue and self._in_flight == 0
                if idle or self._thread is None or not self._thread.is_alive():
                    return
            time.sleep(0.02)

    def _after_fork(self) -> None:
        # Only the forking thread survives in the child, and a lock another thread
        # held at that moment is held forever: start over with fresh ones.
        self._lock = threading.Condition()
        # What the parent had queued is the parent's to send, not the child's.
        self._queue = deque(maxlen=self._queue.maxlen)
        self._thread = None
        self._in_flight = 0
        self._pid = os.getpid()

