"""G492's durable, stored-read card repayment progress boundary.

The financial calculation lives in :mod:`app.services.card_plan_progress`.
This module owns only persistence, freshness and worker orchestration: a
screen read never calls the calculator.  A snapshot is valid only for the
same user-data version, London calendar day and result shape that created it.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import time
from datetime import datetime, timezone
from typing import Any

from pymongo.errors import DuplicateKeyError

from app.core import timeutil
from app.db.collections import card_plan_progress_col, commitments_col, user_data_version_col

logger = logging.getLogger(__name__)

SHAPE_VERSION = 1
TASK_NAME = "task_refresh_card_plan_progress"
_JOB_PREFIX = "card-plan-progress:"
QUEUE_TIMEOUT_SECONDS = 0.2


def _day() -> str:
    return timeutil.user_today().isoformat()


def _iso(value: Any) -> str | None:
    return timeutil.as_utc(value).isoformat() if isinstance(value, datetime) else None


async def _version(uid: str) -> int | None:
    """Return a live version, or None when its store cannot be trusted.

    ``None`` deliberately differs from a user who has never been bumped (0):
    a Mongo failure must not make an old snapshot look current.
    """
    try:
        doc = await user_data_version_col.find_one({"_id": uid}, {"version": 1})
    except Exception:
        logger.exception("card_plan_store: version read failed for %s", uid)
        return None
    try:
        value = (doc or {}).get("version", 0)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            return None
        return value
    except (TypeError, ValueError):
        logger.warning("card_plan_store: malformed version for %s", uid)
        return None


async def enqueue_refresh(uid: str, *, again: bool = False) -> bool:
    """Best-effort, deduplicated worker enqueue. Never calculates inline."""
    if not uid:
        return False
    try:
        from app.workers import queue
        suffix = ":again" if again else ""
        await asyncio.wait_for(
            queue.enqueue(TASK_NAME, uid, again, job_id=f"{_JOB_PREFIX}{uid}{suffix}"),
            timeout=QUEUE_TIMEOUT_SECONDS,
        )
        return True
    except TimeoutError:
        logger.warning("card_plan_store: refresh enqueue timed out for %s", uid)
        return False
    except Exception as exc:
        logger.warning("card_plan_store: refresh enqueue failed for %s (%s)", uid, type(exc).__name__)
        try:
            from app.workers import queue
            queue.reset_pool()
        except Exception:
            pass
        return False


def _prior(doc: dict | None) -> dict | None:
    # An error snapshot deliberately has no current ``payload`` (readers must
    # not present it as current), but retains the last successful snapshot for
    # the next calculator run's baseline contract.
    payload = (doc or {}).get("payload") or (doc or {}).get("previous_payload")
    return dict(payload) if isinstance(payload, dict) else None


def _write_filter(uid: str, version: int, day: str, build_started_ns: int) -> dict:
    """Only a newer (version, London day, build-start) result may replace one.

    The build fence stops an earlier, slower computation from replacing a
    later-started result for the exact same user input.  The explicit day
    comparison additionally protects against a delayed writer from yesterday
    should a clock/test harness otherwise make its pre-write day check pass.
    """
    return {
        "_id": uid,
        "$or": [
            {"input_version": {"$exists": False}},
            {"input_version": {"$lt": version}},
            {"input_version": version, "as_of_day": {"$exists": False}},
            {"input_version": version, "as_of_day": {"$lt": day}},
            {"input_version": version, "as_of_day": day, "build_started_ns": {"$exists": False}},
            {"input_version": version, "as_of_day": day, "build_started_ns": {"$lt": build_started_ns}},
        ],
    }


async def _write_error(
    uid: str, version: int, day: str, build_started_at: datetime, build_started_ns: int,
    previous_doc: dict | None, exc: Exception,
) -> None:
    """Persist an operational failure without presenting prior facts as current."""
    if await _version(uid) != version or _day() != day:
        return
    previous = _prior(previous_doc)
    doc: dict[str, Any] = {
        "_id": uid,
        "user_id": uid,
        "shape": SHAPE_VERSION,
        "status": "error",
        "input_version": version,
        "as_of_day": day,
        "build_started_at": build_started_at,
        "build_started_ns": build_started_ns,
        "computed_at": datetime.now(timezone.utc),
        "error_type": type(exc).__name__,
    }
    if previous is not None:
        doc["previous_payload"] = previous
        doc["previous_computed_at"] = previous_doc.get("computed_at")
    try:
        await card_plan_progress_col.replace_one(
            _write_filter(uid, version, day, build_started_ns),
            doc,
            upsert=True,
        )
    except DuplicateKeyError:
        return
    except Exception:
        logger.exception("card_plan_store: error snapshot write failed for %s", uid)


async def refresh(uid: str) -> dict:
    """Compute and persist one snapshot, rejecting a superseded calculation."""
    version = await _version(uid)
    if version is None:
        return {"status": "unavailable", "reason": "version_unavailable"}
    day = _day()
    build_started_at = datetime.now(timezone.utc)
    build_started_ns = time.time_ns()
    try:
        previous_doc = await card_plan_progress_col.find_one({"_id": uid})
    except Exception:
        logger.exception("card_plan_store: previous snapshot read failed for %s", uid)
        previous_doc = None

    try:
        from app.services.card_plan_progress import compute_progress
        computed = compute_progress(uid, previous=_prior(previous_doc))
        payload = await computed if inspect.isawaitable(computed) else computed
    except Exception as exc:
        logger.exception("card_plan_store: progress compute failed for %s", uid)
        if await _version(uid) != version or _day() != day:
            return {"status": "superseded", "input_version": version}
        await _write_error(uid, version, day, build_started_at, build_started_ns, previous_doc, exc)
        return {"status": "unavailable", "reason": "compute_failed", "input_version": version}

    if not isinstance(payload, dict):
        exc = TypeError("compute_progress returned a non-dict payload")
        logger.error("card_plan_store: invalid progress payload for %s", uid)
        if await _version(uid) != version or _day() != day:
            return {"status": "superseded", "input_version": version}
        await _write_error(uid, version, day, build_started_at, build_started_ns, previous_doc, exc)
        return {"status": "unavailable", "reason": "invalid_payload", "input_version": version}

    # The callback may take long enough for a sync or edit to land. Never
    # stamp that older result with a newer version/day.
    if await _version(uid) != version or _day() != day:
        return {"status": "superseded", "input_version": version}

    doc = {
        "_id": uid,
        "user_id": uid,
        "shape": SHAPE_VERSION,
        "status": "ok",
        "input_version": version,
        "as_of_day": day,
        "build_started_at": build_started_at,
        "build_started_ns": build_started_ns,
        "computed_at": datetime.now(timezone.utc),
        "payload": payload,
    }
    try:
        result = await card_plan_progress_col.replace_one(
            _write_filter(uid, version, day, build_started_ns),
            doc,
            upsert=True,
        )
    except DuplicateKeyError:
        return {"status": "superseded", "input_version": version}
    except Exception:
        logger.exception("card_plan_store: snapshot write failed for %s", uid)
        return {"status": "unavailable", "reason": "write_failed", "input_version": version}
    if getattr(result, "matched_count", 0) == 0 and getattr(result, "upserted_id", None) is None:
        return {"status": "superseded", "input_version": version}
    return {"status": "ok", "input_version": version, "as_of_day": day}


async def read(uid: str) -> dict:
    """Read stored facts only, scheduling a refresh on every non-current state."""
    try:
        doc = await card_plan_progress_col.find_one({"_id": uid})
    except Exception:
        logger.exception("card_plan_store: snapshot read failed for %s", uid)
        return {"status": "unavailable", "as_of": None, "plans": {}}
    as_of = _iso((doc or {}).get("computed_at"))
    version = await _version(uid)
    if version is None:
        return {"status": "unavailable", "as_of": as_of, "plans": {}}
    if not doc:
        await enqueue_refresh(uid)
        return {"status": "pending", "as_of": None, "plans": {}}
    if doc.get("status") == "error":
        await enqueue_refresh(uid)
        return {"status": "unavailable", "as_of": as_of, "plans": {}}
    if (
        doc.get("status") != "ok"
        or not isinstance(doc.get("computed_at"), datetime)
        or doc.get("shape") != SHAPE_VERSION
        or doc.get("input_version") != version
        or doc.get("as_of_day") != _day()
    ):
        await enqueue_refresh(uid)
        return {"status": "stale", "as_of": as_of, "plans": {}}
    payload = doc.get("payload")
    plans = payload.get("plans") if isinstance(payload, dict) else None
    if not isinstance(plans, dict):
        await enqueue_refresh(uid)
        return {"status": "stale", "as_of": as_of, "plans": {}}
    return {"status": "ok", "as_of": as_of, "plans": plans}


async def relevant_users() -> list[str]:
    """Users whose current or prior progress needs a rollover/deploy refresh."""
    try:
        active = await commitments_col.distinct(
            "user_id", {"plan_kind": "card_repayment", "status": "active"},
        )
        existing = await card_plan_progress_col.distinct("_id")
    except Exception:
        logger.exception("card_plan_store: relevant-user scan failed")
        return []
    return sorted({str(uid) for uid in [*active, *existing] if isinstance(uid, str) and uid})


async def enqueue_relevant_users() -> dict:
    """Bounded queue fan-out: no financial calculation runs in the caller."""
    users = await relevant_users()
    queued = 0
    for uid in users:
        if await enqueue_refresh(uid):
            queued += 1
    return {"users": len(users), "queued": queued}
