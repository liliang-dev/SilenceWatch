"""SilenceWatch for Python applications.

Declare an application's scheduled jobs to SilenceWatch and send a heartbeat
around each run, without writing a check by hand::

    # Celery
    from silencewatch.integrations.celery import instrument
    instrument(app)

    # APScheduler
    from silencewatch.integrations.apscheduler import instrument
    instrument(scheduler)

Set ``SILENCEWATCH_API_KEY`` (created in the project's Settings page), and
``SILENCEWATCH_URL`` if you host SilenceWatch yourself. Everything else has a
default; see :class:`silencewatch.Config`.

The library never fails a job and never blocks one: every network error is
swallowed, and sending a heartbeat is a queue append.
"""

from ._version import __version__
from .config import Config
from .model import DiscoveredJob
from .monitor import Monitor, configure, get_monitor

__all__ = ["Config", "DiscoveredJob", "Monitor", "__version__", "configure", "get_monitor"]
