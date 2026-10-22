"""The cron dialect SilenceWatch can evaluate, and helpers to write one.

Celery and APScheduler both build schedules the server cannot always compute
occurrences for. Declaring such a job would have the server reject the *whole*
declaration, so one exotic schedule would cost an application all of its
monitoring. Integrations therefore filter those jobs out and say so: degrade on
the part that cannot work, never on the rest.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

_DESCRIPTORS = {"@yearly", "@annually", "@monthly", "@weekly", "@daily", "@midnight", "@hourly"}
# `W` only ever appears as part of the nearest-weekday syntax (15W, LW).
_UNSUPPORTED = re.compile(r"\d+W|LW", re.IGNORECASE)


def is_supported(expression: Optional[str]) -> bool:
    """True when the server will accept this expression.

    Deliberately permissive about the details (the server validates properly) and
    strict only about what is known not to work.
    """
    if expression is None or not expression.strip():
        return False
    trimmed = expression.strip()
    if trimmed.startswith("@"):
        return trimmed.lower() in _DESCRIPTORS
    if len(trimmed.split()) not in (5, 6):
        return False
    return _UNSUPPORTED.search(trimmed) is None


def compact(values: Iterable[int], low: int, high: int) -> str:
    """A set of numbers as one cron field: ``*``, ``*/15``, ``1-5`` or ``0,15,30``.

    ``low`` and ``high`` are the bounds of the field (minutes are 0 to 59, months
    1 to 12), which is how "every value" and "every N" are recognised.
    """
    ordered = sorted(set(values))
    if not ordered:
        raise ValueError("a cron field cannot be empty")
    full = list(range(low, high + 1))
    if ordered == full:
        return "*"

    if len(ordered) > 2 and ordered[0] == low:
        step = ordered[1] - ordered[0]
        if step > 1 and ordered == list(range(low, high + 1, step)):
            return f"*/{step}"

    runs: list[tuple[int, int]] = []
    for value in ordered:
        if runs and value == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], value)
        else:
            runs.append((value, value))

    def write(first: int, last: int) -> str:
        if first == last:
            return str(first)
        # Two neighbours read better as "5,6" than as "5-6".
        return f"{first}-{last}" if last - first >= 2 else f"{first},{last}"

    return ",".join(write(first, last) for first, last in runs)
