"""Settings, from keyword arguments and ``SILENCEWATCH_*`` environment variables."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any, Mapping, Optional, Tuple

ENV_PREFIX = "SILENCEWATCH_"
DEFAULT_BASE_URL = "https://app.silencewatch.com"

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}

#: The longest environment name the server accepts.
_MAX_ENVIRONMENT_LENGTH = 40


@dataclass(frozen=True)
class Config:
    """Everything the library can be told.

    Each field has a keyword argument of the same name and an environment
    variable (``SILENCEWATCH_API_KEY``, ``SILENCEWATCH_URL``, …). The keyword wins.
    Durations in the environment are a number of seconds.
    """

    #: Created in the project's Settings page. Without one nothing is sent.
    api_key: Optional[str] = None
    #: Your own instance when self-hosting.
    base_url: str = DEFAULT_BASE_URL
    #: Part of a check's identity, so staging and production stay apart.
    environment: str = "production"
    #: ``False`` removes the mechanism entirely: no discovery, no hooks, no threads.
    enabled: bool = True
    #: For jobs that declare none.
    default_grace: timedelta = field(default_factory=lambda: timedelta(minutes=5))
    #: ``False`` to manage checks by hand: nothing is declared, heartbeats are not sent.
    auto_register: bool = True
    #: ``False`` to send only the outcome of a run, not its beginning.
    report_start: bool = True
    #: Per call, in seconds. Deliberately short: a slow server costs a job nothing.
    timeout: float = 2.0
    #: Heartbeats waiting to be sent; past that the oldest are dropped.
    queue_capacity: int = 1000
    #: For cron jobs whose own schedule carries none.
    timezone: str = "UTC"
    #: Checks missing from a declaration are flagged orphaned (never deleted). Turn
    #: it off when several services share one project and environment: each one
    #: would otherwise orphan the others' checks.
    prune: bool = True
    #: Jobs that have to run in every process or server (a local cache to clear,
    #: temporary files to delete), each monitored on its own. Keys as declared; a
    #: trailing ``*`` matches a prefix. Every other job is one check for all the
    #: instances, up while any of them reports it. Needs ``instance_id``. Not for
    #: Celery tasks: one worker runs each, so the others would never report it.
    per_instance_jobs: Tuple[str, ...] = ()
    #: The name of this instance for ``per_instance_jobs``. It must stay the same
    #: across restarts and deploys; one that changes at every deploy would leave
    #: behind checks nothing reports to any more, and they would go down. So there
    #: is no default.
    instance_id: Optional[str] = None

    def is_per_instance(self, job_key: str) -> bool:
        """Whether the job is monitored on each instance rather than for all of them."""
        for pattern in self.per_instance_jobs:
            pattern = pattern.strip()
            if pattern.endswith("*") and job_key.startswith(pattern[:-1]):
                return True
            if pattern and job_key == pattern:
                return True
        return False

    @property
    def instance_environment(self) -> Optional[str]:
        """Where the per-instance jobs are declared: ``production.web-1``.

        Each instance then has its own checks, which the server keeps apart, so no
        instance's declaration orphans another's. The server accepts 40 letters,
        digits, dots, dashes and underscores: anything else becomes a dash, and a
        name too long is cut from the front, where instances tend to look alike.
        ``None`` when there is no usable name.
        """
        if not self.instance_id or not self.instance_id.strip():
            return None
        name = re.sub(r"[^A-Za-z0-9._-]", "-", self.instance_id.strip())
        room = _MAX_ENVIRONMENT_LENGTH - len(self.environment) - 1
        if room <= 0:
            return None
        return f"{self.environment}.{name[-room:]}"

    @property
    def normalised_base_url(self) -> str:
        return self.base_url.rstrip("/")

    @classmethod
    def resolve(cls, environ: Optional[Mapping[str, str]] = None, **overrides: Any) -> Config:
        """The configuration: defaults, then the environment, then ``overrides``."""
        env = os.environ if environ is None else environ
        values: dict[str, Any] = {}

        def read(name: str, convert: Any) -> None:
            raw = env.get(ENV_PREFIX + name.upper())
            if raw is None or raw.strip() == "":
                return
            try:
                values[name] = convert(raw.strip())
            except ValueError:
                # A typo in an environment variable must not take the application down.
                values.pop(name, None)

        read("api_key", str)
        read("base_url", str)  # SILENCEWATCH_BASE_URL
        read("url", str)  # SILENCEWATCH_URL, the shorter way to say the same
        if "url" in values:
            values["base_url"] = values.pop("url")
        read("environment", str)
        read("enabled", _boolean)
        read("default_grace", lambda raw: timedelta(seconds=float(raw)))
        read("auto_register", _boolean)
        read("report_start", _boolean)
        read("timeout", float)
        read("queue_capacity", int)
        read("timezone", str)
        read("prune", _boolean)
        read("per_instance_jobs", _list)
        read("instance_id", str)

        config = cls(**values)
        explicit = {key: value for key, value in overrides.items() if value is not None}
        unknown = set(explicit) - set(cls.__dataclass_fields__)
        if unknown:
            raise TypeError(f"unknown SilenceWatch setting(s): {', '.join(sorted(unknown))}")
        if isinstance(explicit.get("per_instance_jobs"), (list, str)):
            jobs = explicit["per_instance_jobs"]
            explicit["per_instance_jobs"] = _list(jobs) if isinstance(jobs, str) else tuple(jobs)
        if isinstance(explicit.get("default_grace"), (int, float)):
            explicit["default_grace"] = timedelta(seconds=explicit["default_grace"])
        return replace(config, **explicit)

    @property
    def usable(self) -> bool:
        """Enough to talk to the server."""
        return self.enabled and bool(self.api_key)


def _list(raw: str) -> Tuple[str, ...]:
    return tuple(item.strip() for item in raw.split(",") if item.strip())


def _boolean(raw: str) -> bool:
    lowered = raw.lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    raise ValueError(raw)
