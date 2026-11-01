"""A184 (E9 follow-up): reconcile missed Finexer webhooks with List events.

Finexer's GET /events is an audit of every event. Webhooks can be lost (a
paused webhook after ten failures, an outage on our side), so this pass pages
the events created since the last completed reconcile, compares event ids with
the deliveries we stored (`webhook_events_col.event_id`), and for any event we
never received whose type is in the action table runs the SAME dispatch the
webhook runs (`routers.webhooks.process_finexer_event`, idempotent on the event
id), counting received, missed and replayed.

Safety rules:
  - A 429 or 5xx, a transport error, a page cap or a replay cap stops the pass
    and it is NOT marked complete, so the next run covers the same window.
  - Nothing is logged but counts and short codes; event payloads never are.
  - The state lives in one `worker_runs_col` doc (`_id` below).

ASSUMPTIONS to confirm against the dashboard reference (which sits behind the
login): the list endpoint filters with `created[gte]` taking epoch seconds
(override the parameter name with FINEXER_EVENTS_SINCE_PARAM), and each event
carries the same envelope as a webhook delivery (`id`, `type`, `data.object`)
plus a `created` time. Events older than the window are skipped client-side
too, so a server that ignores the filter cannot replay history.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.db.collections import webhook_events_col, worker_runs_col
from app.services import finexer_webhooks as fxw

logger = logging.getLogger(__name__)

STATE_DOC_ID = "finexer_event_reconcile"
SINCE_PARAM = os.getenv("FINEXER_EVENTS_SINCE_PARAM", "created[gte]")
FIRST_LOOKBACK = timedelta(hours=48)
MAX_LOOKBACK = timedelta(days=7)
OVERLAP = timedelta(hours=1)
MAX_PAGES = 20
MAX_REPLAYS = 50
MIN_GAP = timedelta(minutes=2)


def _created_at(event: dict) -> Optional[datetime]:
    """The event's creation time as naive UTC, from epoch seconds or ISO text."""
    raw = event.get("created")
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        n = float(raw)
        if n > 10_000_000_000:
            n /= 1000.0
        try:
            return datetime.fromtimestamp(n, tz=timezone.utc).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return None
    from app.services.finexer_sync import _parse_iso_utc
    return _parse_iso_utc(str(raw))


async def _read_state() -> dict:
    try:
        return await worker_runs_col.find_one({"_id": STATE_DOC_ID}) or {}
    except Exception:
        return {}


async def _write_state(fields: dict) -> None:
    try:
        await worker_runs_col.update_one({"_id": STATE_DOC_ID}, {"$set": fields}, upsert=True)
    except Exception:
        logger.exception("finexer event reconcile: could not write state")


async def reconcile_events(*, now: Optional[datetime] = None, force: bool = False, client=None) -> dict:
    """One reconcile pass. Returns
    {"ran": bool, "complete": bool, "reason": short code or None, "received",
     "missed", "replayed", "failed", "skipped_type", "pages"}.
    `force` skips the minimum gap between runs (the nightly job); the owner's
    button honours it."""
    from app.routers.webhooks import process_finexer_event
    from app.services.finexer_sync import _carry_params, _client, _get

    now = now or datetime.utcnow()  # naive-ok: compared with Mongo's naive UTC datetimes
    state = await _read_state()
    last_started = state.get("last_started_at")
    if not force and isinstance(last_started, datetime) and now - last_started < MIN_GAP:
        return {"ran": False, "complete": False, "reason": "too_soon", "received": 0, "missed": 0,
                "replayed": 0, "failed": 0, "skipped_type": 0, "pages": 0}

    last_done = state.get("last_completed_at")
    if isinstance(last_done, datetime):
        since = max(last_done - OVERLAP, now - MAX_LOOKBACK)
    else:
        since = now - FIRST_LOOKBACK
    await _write_state({"last_started_at": now})

    out = {"ran": True, "complete": False, "reason": None, "received": 0, "missed": 0,
           "replayed": 0, "failed": 0, "skipped_type": 0, "pages": 0}
    table = fxw.event_actions()
    seen: set = set()

    async def _run(c) -> None:
        counter = {"requests": 0, "429s": 0}
        params: Optional[dict] = {SINCE_PARAM: str(_epoch(since))}
        url: Optional[str] = "/events"
        first = True
        while url:
            if out["pages"] >= MAX_PAGES:
                out["reason"] = "page_cap"
                return
            try:
                resp = await _get(c, url, params if first else None, counter=counter)
            except httpx.HTTPError:
                out["reason"] = "transport"
                return
            first = False
            if resp.status_code != 200:
                out["reason"] = f"http_{resp.status_code}"
                return
            out["pages"] += 1
            try:
                body = resp.json()
            except ValueError:
                out["reason"] = "bad_body"
                return
            events = (body.get("data") or body.get("results") or []) if isinstance(body, dict) else []
            batch = []
            for ev in events:
                if not isinstance(ev, dict):
                    continue
                created = _created_at(ev)
                if created is not None and created < since:
                    continue
                eid = fxw.extract_event_id(ev)
                if not eid or eid in seen:
                    continue
                seen.add(eid)
                batch.append((eid, ev))
            if batch:
                ids = [eid for eid, _ in batch]
                known = {d.get("event_id") async for d in webhook_events_col.find({"event_id": {"$in": ids}}, {"event_id": 1})}
                for eid, ev in batch:
                    if eid in known:
                        out["received"] += 1
                        continue
                    if fxw.resolve_action(fxw.extract_event_type(ev), table) == fxw.ACTION_UNKNOWN:
                        out["skipped_type"] += 1
                        continue
                    out["missed"] += 1
                    if out["replayed"] + out["failed"] >= MAX_REPLAYS:
                        out["reason"] = "replay_cap"
                        return
                    try:
                        res = await process_finexer_event(ev, source="reconcile")
                    except Exception as exc:
                        out["failed"] += 1
                        logger.warning("finexer event reconcile: a replay failed (%s)", type(exc).__name__)
                        continue
                    if res.get("duplicate"):
                        out["received"] += 1
                        out["missed"] -= 1
                    else:
                        out["replayed"] += 1
            next_url = (body.get("paging") or {}).get("next") if isinstance(body, dict) else None
            url = _carry_params(next_url, params) if next_url else None

    try:
        if client is not None:
            await _run(client)
        else:
            async with _client() as c:
                await _run(c)
    except Exception as exc:
        out["reason"] = out["reason"] or "error"
        logger.warning("finexer event reconcile stopped (%s)", type(exc).__name__)

    out["complete"] = out["reason"] is None and out["failed"] == 0
    fields = {
        "last_attempt_at": now,
        "last_status": "complete" if out["complete"] else "incomplete",
        "last_reason": out["reason"] or ("replay_failed" if out["failed"] else None),
        "last_counts": {k: out[k] for k in ("received", "missed", "replayed", "failed", "skipped_type", "pages")},
    }
    if out["complete"]:
        fields["last_completed_at"] = now
    await _write_state(fields)
    logger.info(
        "finexer event reconcile: complete=%s received=%d missed=%d replayed=%d failed=%d pages=%d reason=%s",
        out["complete"], out["received"], out["missed"], out["replayed"], out["failed"], out["pages"], out["reason"],
    )
    return out


def _epoch(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp())


async def reconcile_health(now: Optional[datetime] = None) -> dict:
    """/ops/health summary: when the last COMPLETE pass finished, how the last
    attempt went, and its counts. Counts only, no ids."""
    now = now or datetime.utcnow()  # naive-ok: compared with Mongo's naive UTC datetimes
    s = await _read_state()
    done = s.get("last_completed_at")
    attempt = s.get("last_attempt_at")
    counts = s.get("last_counts") or {}
    return {
        "last_completed_at": done.isoformat() if isinstance(done, datetime) else None,
        "minutes_ago": int((now - done).total_seconds() // 60) if isinstance(done, datetime) else None,
        "last_attempt_at": attempt.isoformat() if isinstance(attempt, datetime) else None,
        "last_status": s.get("last_status"),
        "last_reason": s.get("last_reason"),
        "received": int(counts.get("received", 0)),
        "missed": int(counts.get("missed", 0)),
        "replayed": int(counts.get("replayed", 0)),
        "failed": int(counts.get("failed", 0)),
    }
