"""HTTP access to SilenceWatch, on the standard library only.

Every method either returns a result or reports failure through its return
value. Nothing escapes as an exception into application code: the contract of
this library is that monitoring never breaks the thing it monitors.
"""

from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request
from typing import Optional, Sequence

from ._version import __version__
from .config import Config
from .model import DiscoveredJob

log = logging.getLogger("silencewatch")

#: The server rejects shorter periods; a sub-minute job is declared at this.
MINIMUM_INTERVAL_SECONDS = 30
#: Responses are small; anything larger is a proxy error page we do not need.
_MAX_RESPONSE_BYTES = 256 * 1024

USER_AGENT = f"silencewatch-python/{__version__}"


class SilenceWatchClient:
    """Declares jobs and sends heartbeats."""

    def __init__(self, config: Config) -> None:
        self._config = config

    def sync(self, jobs: Sequence[DiscoveredJob], source: str = "python") -> dict[str, str]:
        """Declare the jobs; return their ping keys, indexed by job key.

        An empty result means the declaration did not go through. The caller
        carries on regardless.
        """
        if not jobs:
            return {}
        body = json.dumps(self.build_payload(jobs, source)).encode("utf-8")
        request = urllib.request.Request(
            self._config.normalised_base_url + "/api/v1/checks/sync",
            data=body,
            method="POST",
            headers={
                "authorization": f"Bearer {self._config.api_key}",
                "content-type": "application/json",
                "accept": "application/json",
                "user-agent": USER_AGENT,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._config.timeout) as response:  # noqa: S310
                raw = response.read(_MAX_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            log.warning("SilenceWatch rejected the job declaration (HTTP %s): %s", error.code, _first_line(error))
            return {}
        except (OSError, ValueError) as error:
            log.warning("Could not declare jobs to SilenceWatch: %s", error)
            return {}
        if len(raw) > _MAX_RESPONSE_BYTES:
            log.warning("Ignoring an implausibly large sync response")
            return {}
        return self._ping_keys(raw)

    def ping(self, ping_key: str, suffix: str, duration_ms: Optional[int] = None) -> bool:
        """One heartbeat. ``suffix`` is ``"/start"``, ``"/0"`` (success) or ``"/fail"``."""
        url = f"{self._config.normalised_base_url}/p/{ping_key}{suffix}"
        if duration_ms is not None:
            url += f"?duration_ms={int(duration_ms)}"
        request = urllib.request.Request(url, data=b"", method="POST", headers={"user-agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=self._config.timeout) as response:  # noqa: S310
                return bool(200 <= response.status < 300)
        except (OSError, ValueError):
            return False

    def build_payload(self, jobs: Sequence[DiscoveredJob], source: str) -> dict[str, object]:
        return {
            "environment": self._config.environment,
            "source": source[:60],
            "prune": self._config.prune,
            "checks": [self._job(job) for job in jobs],
        }

    def _job(self, job: DiscoveredJob) -> dict[str, object]:
        entry: dict[str, object] = {"key": job.key, "name": job.name}
        if job.cron is not None:
            entry["cron"] = job.cron
            entry["timezone"] = job.timezone or self._config.timezone
        else:
            assert job.interval is not None
            seconds = int(job.interval.total_seconds())
            if seconds < MINIMUM_INTERVAL_SECONDS:
                log.warning(
                    "Job %s runs every %ss, below the %ss minimum SilenceWatch accepts; declaring it at %ss",
                    job.key, seconds, MINIMUM_INTERVAL_SECONDS, MINIMUM_INTERVAL_SECONDS,
                )
                seconds = MINIMUM_INTERVAL_SECONDS
            entry["interval_seconds"] = seconds
        grace = job.grace if job.grace is not None else self._config.default_grace
        entry["grace_seconds"] = max(0, int(grace.total_seconds()))
        return entry

    @staticmethod
    def _ping_keys(raw: bytes) -> dict[str, str]:
        try:
            document = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}
        keys: dict[str, str] = {}
        checks = document.get("checks") if isinstance(document, dict) else None
        for check in checks if isinstance(checks, list) else []:
            if isinstance(check, dict) and isinstance(check.get("key"), str) and isinstance(check.get("pingKey"), str):
                keys[check["key"]] = check["pingKey"]
        return keys


def _first_line(error: urllib.error.HTTPError) -> str:
    try:
        text = error.read(2048).decode("utf-8", "replace")
    except OSError:
        return "(no body)"
    line = text.splitlines()[0] if text else "(no body)"
    return line if len(line) <= 200 else line[:200] + "…"
