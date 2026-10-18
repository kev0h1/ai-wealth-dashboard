"""E7 collector 9: the trend store behind the 24 h and 7 d trends.

`health_samples` is a capped collection: one document per collector per
5 minute bucket, `_id` = "<collector>:<bucket epoch>" (so replicas and retries
cannot double-write a bucket), shaped
{collector, ts, state, status, metrics: {name: number}}.

The bound to 30 days is by document count: SAMPLED collectors x 288 buckets a
day x 30 days (plus slack), with a byte ceiling as well. A capped collection
cannot be TTL'd or have documents deleted, so the oldest samples are dropped
by Mongo itself once the count is reached. External collectors (Railway,
Vercel) are never sampled so the 5 minute cadence never polls a third party.

Writers: the arq cron `task_health_samples` (every collector that lives in the
worker's world) and a small loop in the API process for `api_latency`, whose
ring buffer only exists there. Reads: `trends()`.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta
from typing import Optional

from pymongo.errors import CollectionInvalid, DuplicateKeyError

from app.services.health.base import Collector, naive_utc_now, run_all

log = logging.getLogger(__name__)

COLLECTION = "health_samples"
BUCKET_S = 300
RETENTION_DAYS = 30
SAMPLED_COLLECTORS = 7          # every non-external collector
MAX_DOCS = SAMPLED_COLLECTORS * (86400 // BUCKET_S) * RETENTION_DAYS + 2000
MAX_BYTES = 64 * 1024 * 1024

# metric key -> (collector, sample field, label, unit)
TREND_METRICS = {
    "p95_ms": ("api_latency", "p95_ms", "API p95 latency", "ms"),
    "queue_depth": ("worker", "queue_depth", "Worker backlog", "jobs"),
    "mongo_storage_mb": ("mongo", "storage_mb", "Database size", "MB"),
    "memory_used_pct": ("vps", "memory_used_pct", "Server memory used", "%"),
}


def bucket_of(now: Optional[float] = None) -> int:
    return int((time.time() if now is None else now) // BUCKET_S) * BUCKET_S


async def ensure_collection(database, max_docs: int = MAX_DOCS, size: int = MAX_BYTES, name: str = COLLECTION) -> None:
    """Create the capped collection once; an existing one is left alone."""
    try:
        await database.create_collection(name, capped=True, size=size, max=max_docs)
    except CollectionInvalid:
        pass
    except Exception as exc:
        # An "already exists" from a racing creator surfaces as OperationFailure.
        if "already exists" not in str(exc).lower():
            raise


def _metrics(collector: Collector, res: dict) -> dict:
    values = res.get("values") or {}
    out = {}
    for metric, field in collector.sample_fields.items():
        v = values.get(field)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            out[metric] = v
    return out


async def write_samples(collectors: list[Collector], col, now: Optional[float] = None) -> int:
    """Run `collectors` (under their budgets) and insert one sample each.
    Returns how many documents were written. Never raises."""
    bucket = bucket_of(now)
    ts = naive_utc_now().replace(microsecond=0)
    results = await run_all([c for c in collectors if not c.external])
    written = 0
    for c in collectors:
        res = results.get(c.name)
        if res is None:
            continue
        doc = {
            "_id": f"{c.name}:{bucket}", "collector": c.name, "ts": ts,
            "state": res.get("state"), "status": res.get("status"),
            "metrics": _metrics(c, res) if res.get("state") == "ok" else {},
        }
        try:
            await col.insert_one(doc)
            written += 1
        except DuplicateKeyError:
            pass
        except Exception as exc:
            log.warning("health sample for %s not written: %s", c.name, type(exc).__name__)
    return written


def _summarise(points: list[tuple], limit: int = 48) -> dict:
    values = [v for _, v in points]
    if not values:
        return {"n": 0, "min": None, "avg": None, "max": None, "points": []}
    step = max(1, len(values) // limit)
    return {
        "n": len(values), "min": round(min(values), 2), "avg": round(sum(values) / len(values), 2),
        "max": round(max(values), 2), "points": [round(v, 2) for v in values[::step]],
    }


async def trends(col) -> dict:
    """24 h and 7 d min/avg/max (and a downsampled series) per tracked metric."""
    now = naive_utc_now()
    out: dict = {}
    for key, (collector, _field, label, unit) in TREND_METRICS.items():
        rows = await col.find(
            {"collector": collector, "ts": {"$gte": now - timedelta(days=7)}, f"metrics.{key}": {"$exists": True}},
            {"ts": 1, "metrics": 1},
        ).sort("ts", 1).to_list(None)
        series = [(r["ts"], r["metrics"][key]) for r in rows]
        day = [(t, v) for t, v in series if t >= now - timedelta(hours=24)]
        out[key] = {"label": label, "unit": unit, "h24": _summarise(day), "d7": _summarise(series)}
    return out


async def api_sampler_loop(collectors: list[Collector], col, interval_s: float = BUCKET_S) -> None:
    """API-process loop writing `api_latency` samples (its ring buffer lives
    only here). Errors never escape; cancellation ends it."""
    mine = [c for c in collectors if c.name == "api_latency"]
    while True:
        try:
            await asyncio.sleep(interval_s)
            await write_samples(mine, col)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("health api sampler error: %s", type(exc).__name__)
