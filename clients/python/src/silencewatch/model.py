"""What an integration finds: a scheduled job, in the form SilenceWatch expects."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Optional


@dataclass(frozen=True)
class DiscoveredJob:
    """A scheduled job found in the application.

    ``key`` is the stable identity: it must survive restarts, redeployments and
    renames, because it is what ties a running job to its history on the server.
    Integrations prefix it with their own name (``celery:app.tasks.backup``) so two
    of them can never claim the same key.

    Exactly one of ``cron`` and ``interval`` is set.
    """

    key: str
    name: str
    cron: Optional[str] = None
    interval: Optional[timedelta] = None
    timezone: Optional[str] = None
    grace: Optional[timedelta] = None

    def __post_init__(self) -> None:
        if (self.cron is None) == (self.interval is None):
            raise ValueError(f"job {self.key} must have exactly one of a cron expression or an interval")
