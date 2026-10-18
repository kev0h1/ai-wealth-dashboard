"""E7: shared interface for the /ops/health metrics collectors.

Every collector has a `name`, a time budget and an async `collect()` that
returns a plain dict (see `result`):

    {"name", "state", "status", "values", "as_of", "note"}

- `state` is how the collection went: "ok" (values are real), "timed_out",
  "not_configured" (an external source whose token is unset), "omitted" (the
  source does not exist on this deployment, feature-detected) or "error".
- `status` is what the values mean: "ok" | "warn" | "crit", or "unknown" when
  `state` is not "ok". Slice 3 (E8, alerts) consumes `status` only.
- `values` holds numbers and short strings, never user data, tokens or raw
  upstream text.

`run_collector` enforces the budget (default 2 s) and never raises, so one
slow or broken source cannot block the endpoint or blank the other blocks.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

log = logging.getLogger(__name__)

BUDGET_S = 2.0
OK, WARN, CRIT, UNKNOWN = "ok", "warn", "crit", "unknown"
_RANK = {OK: 0, WARN: 1, CRIT: 2}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)  # naive-ok: aware UTC timestamp for an ops report


def naive_utc_now() -> datetime:
    """For comparing against Mongo datetimes, which come back naive UTC."""
    return utc_now().replace(tzinfo=None)


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def worst(*statuses: str) -> str:
    return max((s for s in statuses if s in _RANK), key=_RANK.__getitem__, default=OK)


def level(value: Optional[float], warn: float, crit: float) -> str:
    """ok / warn / crit by ascending thresholds; None is ok (no data)."""
    if value is None:
        return OK
    if value >= crit:
        return CRIT
    if value >= warn:
        return WARN
    return OK


def env_float(name: str) -> Optional[float]:
    raw = (os.environ.get(name) or "").strip()
    try:
        return float(raw) if raw else None
    except ValueError:
        return None


def external_calls_enabled() -> bool:
    """Master switch for collectors that call a third-party API. Off when
    HEALTH_EXTERNAL_CALLS is 0/false (the tests set it)."""
    return (os.environ.get("HEALTH_EXTERNAL_CALLS") or "1").strip().lower() not in {"0", "false", "no", "off"}


def result(
    name: str,
    *,
    state: str = "ok",
    status: Optional[str] = None,
    values: Optional[dict] = None,
    as_of: Optional[datetime] = None,
    note: Optional[str] = None,
) -> dict:
    if status is None:
        status = OK if state == "ok" else UNKNOWN
    return {
        "name": name,
        "state": state,
        "status": status,
        "values": values or {},
        "as_of": iso(as_of or utc_now()),
        "note": note,
    }


class Collector:
    """Base class. Subclasses set `name`, optionally `budget_s`, `external`
    (calls a third party: never sampled into the trend store) and
    `sample_fields` (trend metric name -> key in `values`), and implement
    `collect()`."""

    name: str = ""
    title: str = ""
    budget_s: float = BUDGET_S
    external: bool = False
    sample_fields: dict[str, str] = {}

    async def collect(self) -> dict:  # pragma: no cover - interface
        raise NotImplementedError


async def run_collector(collector: Collector, budget_s: Optional[float] = None) -> dict:
    budget = collector.budget_s if budget_s is None else budget_s
    try:
        out = await asyncio.wait_for(collector.collect(), timeout=budget)
        if not isinstance(out, dict):
            return result(collector.name, state="error", note="Collector returned no data.")
        return out
    except asyncio.TimeoutError:
        return result(collector.name, state="timed_out", note=f"Timed out after {budget:g} s.")
    except Exception as exc:  # class name only: messages can carry upstream text
        log.warning("health collector %s failed: %s", collector.name, type(exc).__name__)
        return result(collector.name, state="error", note=f"Failed ({type(exc).__name__}).")


async def run_all(collectors: list[Collector], budget_s: Optional[float] = None) -> dict[str, dict]:
    """Run every collector concurrently, each under its own timeout."""
    results = await asyncio.gather(*(run_collector(c, budget_s) for c in collectors))
    return {c.name: r for c, r in zip(collectors, results)}
