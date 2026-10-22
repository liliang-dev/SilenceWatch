"""What every integration is.

Adding one (Django, RQ, Dramatiq, a plain ``cron`` wrapper…) is writing one module
in this package with a class that follows this contract, plus ``instrument`` to
create and attach it. Nothing else changes: the monitor, the configuration, the
declaration and the heartbeats are shared.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, List

if TYPE_CHECKING:
    from ..model import DiscoveredJob
    from ..monitor import Monitor


class Integration(ABC):
    """A scheduler SilenceWatch knows how to read and to listen to."""

    #: Short and lower case: used in the job keys (``celery:app.tasks.backup``) and in
    #: the ``source`` of a declaration (``python-celery``).
    name: str

    @abstractmethod
    def discover(self) -> List[DiscoveredJob]:
        """The scheduled jobs of the application, as they are right now.

        Every job, every time: a declaration is complete, and what it leaves out is
        flagged orphaned.
        """

    @abstractmethod
    def install(self, monitor: Monitor) -> None:
        """Hook the scheduler: report what is found with ``monitor.declare(self, jobs)``,
        at the moment the scheduler is ready, and each run with ``monitor.started``,
        ``succeeded`` and ``failed``.

        Must not fail the application, and must not slow a job down: report and
        return.
        """
