"""Schedules kept in the database by django-celery-beat.

Not an integration of its own: the Celery integration reads these entries next to
``beat_schedule`` when ``django_celery_beat`` is an installed Django app, and the
heartbeats are the Celery ones. This module only knows the database::

    INSTALLED_APPS = [..., "django_celery_beat"]
    instrument(app)          # nothing else

Entries are read where the worker starts. A change made afterwards (in the admin,
or in code) is seen by each worker process within a minute, by a thread that
compares django-celery-beat's own change marker (one row) with the one seen when
the schedule was last read; only then is it read and declared again.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, List, Optional, Tuple

log = logging.getLogger("silencewatch")

#: Seconds between two looks at the change marker.
CHECK_EVERY_SECONDS = 60.0


def in_use() -> bool:
    """True when Django is set up and django-celery-beat is one of its apps."""
    try:
        from django.apps import apps
    except ImportError:
        return False
    return bool(apps.ready and apps.is_installed("django_celery_beat"))


def last_change() -> Optional[datetime]:
    """When anything in the database schedule last changed, as django-celery-beat records it."""
    from django_celery_beat.models import PeriodicTasks

    changed: Optional[datetime] = PeriodicTasks.last_change()
    return changed


def entries() -> List[Tuple[str, str, Any]]:
    """``(entry name, task name, Celery schedule)`` of every enabled, repeating entry."""
    from django_celery_beat.models import PeriodicTask

    found: List[Tuple[str, str, Any]] = []
    rows = PeriodicTask.objects.filter(enabled=True, one_off=False).select_related(
        "interval", "crontab", "solar", "clocked"
    )
    for row in rows:
        if row.clocked_id is not None:
            continue  # one moment in time, not a schedule to keep
        try:
            found.append((row.name, row.task, row.schedule))
        except Exception:  # noqa: BLE001
            log.warning("Not declaring periodic task %s: its schedule is not understood", row.name)
    return found


def close_connections() -> None:
    """Close this thread's database connections: they were opened for monitoring, not by the application."""
    from django.db import connections

    connections.close_all()
