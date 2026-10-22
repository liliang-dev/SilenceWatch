"""Settings, from keyword arguments and ``SILENCEWATCH_*`` environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any, Mapping, Optional

ENV_PREFIX = "SILENCEWATCH_"
DEFAULT_BASE_URL = "https://app.silencewatch.com"

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off", ""}


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

        config = cls(**values)
        explicit = {key: value for key, value in overrides.items() if value is not None}
        unknown = set(explicit) - set(cls.__dataclass_fields__)
        if unknown:
            raise TypeError(f"unknown SilenceWatch setting(s): {', '.join(sorted(unknown))}")
        if isinstance(explicit.get("default_grace"), (int, float)):
            explicit["default_grace"] = timedelta(seconds=explicit["default_grace"])
        return replace(config, **explicit)

    @property
    def usable(self) -> bool:
        """Enough to talk to the server."""
        return self.enabled and bool(self.api_key)


def _boolean(raw: str) -> bool:
    lowered = raw.lower()
    if lowered in _TRUE:
        return True
    if lowered in _FALSE:
        return False
    raise ValueError(raw)
