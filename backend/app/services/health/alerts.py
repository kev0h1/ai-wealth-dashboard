"""E8: throttled alerts to the account owner (E6 slice 3).

Run from the `task_health_samples` cron right after the samples are written
(and, for new error types, from the API process's 5 minute sampler loop). It
turns the E7 trend store into a small set of alert conditions, then pushes the
changes to Kevin through the existing push path (`send_push_to_user`: APNs,
FCM, web push) with a throttle so there is never a flood.

Conditions (key -> rule). `evaluate` is pure: it reads sample rows only.

- `error_rate`   API 5xx share at or above ALERT_ERROR_RATE (default 10%) in two
                 consecutive samples, with at least 20 requests in the window.
- `api_p95`      API p95 latency at or above the collector's crit (3000 ms) for
                 two consecutive samples.
- `sync_failures` Finexer consents that failed to sync in 24 h: warn at
                 ALERT_SYNC_FAILURES (default 5), crit at three times that.
- `quota_tavily` Tavily research in back-off (quota or rate limit).
- `quota_openrouter` model spend at or above LLM_MONTHLY_BUDGET_USD.
- `vps_disk`, `vps_memory` disk or memory at 90% (memory also below 700 MB).
- `collector:<name>` any other collector: crit at once, warn after
                 ALERT_WARN_STREAK consecutive non-ok samples. Skipped while a
                 specific rule above is already covering that collector.
- `new_error:<Class>` events, from `error_types` (not part of `evaluate`).

State is one document per key in `alert_state` (`first_seen`, `last_notified`,
`count`, `state` open|resolved). Every mutation is a filtered update, so two
replicas evaluating the same bucket notify once: the first evaluation of a key
in a bucket claims `last_eval_bucket`, the loser skips.
"""
from __future__ import annotations

import calendar
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Awaitable, Callable, Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.services import runtime_settings
from app.services.health import error_types, latency, vps
from app.services.health.base import iso, naive_utc_now
from app.services.health.samples import BUCKET_S

log = logging.getLogger(__name__)

ALERT_URL = "/ops/health"
CAP_ID = "__cap__"
TEST_ID = "__test__"
TEST_COOLDOWN_S = 60
FRESH_S = 15 * 60               # a sample older than this is "no data", not "clear"
CLEAR_SAMPLES = 2               # consecutive clear samples before "Resolved"
MIN_REQUESTS = 20
HISTORY_HOURS = 24
STALE_OPEN_HOURS = 24           # an open alert nothing evaluates any more is closed silently
ROW_WINDOW_H = 2
ROWS_PER_COLLECTOR = 12

TITLES = {
    "api_latency": "API latency", "finexer_sync": "Bank sync", "worker": "Worker queue",
    "llm_tavily": "Model spend and Tavily", "mongo": "Database", "vps": "Server", "push": "Push delivery",
}
# specific rule keys that already speak for a collector (generic rule skipped)
COVERS = {
    "api_latency": ("error_rate", "api_p95"), "finexer_sync": ("sync_failures",),
    "vps": ("vps_disk", "vps_memory"), "llm_tavily": ("quota_tavily", "quota_openrouter"),
}

class _Silent:
    """Result value: evaluated, covered by a specific rule, so any open alert
    for the key closes without a Resolved push."""


SILENT = _Silent()
Send = Callable[[str, str], Awaitable[Optional[dict]]]


@dataclass
class Config:
    enabled: bool = False
    cooldown_h: float = 6.0
    warn_streak: int = 3
    hourly_cap: int = 5
    error_rate: float = 0.10
    sync_failures: int = 5


def load_config() -> Config:
    """E10: every field resolves through the runtime-settings accessor
    (database value, then the env var read now, then the default). Callers in
    async code await `_fresh_config()` so the snapshot is current."""
    g = runtime_settings.setting
    return Config(
        enabled=bool(g("ALERTS_ENABLED")),
        cooldown_h=float(g("ALERT_COOLDOWN_HOURS")),
        warn_streak=min(int(g("ALERT_WARN_STREAK")), ROWS_PER_COLLECTOR),
        hourly_cap=int(g("ALERT_HOURLY_CAP")),
        error_rate=float(g("ALERT_ERROR_RATE")),
        sync_failures=int(g("ALERT_SYNC_FAILURES")),
    )


async def _fresh_config() -> Config:
    await runtime_settings.ensure_fresh()
    return load_config()


@dataclass
class Condition:
    key: str
    severity: str                  # "warn" | "crit"
    title: str
    body: str
    resolved_title: str = ""
    resolved_body: str = ""
    event: bool = False            # fires once, no resolved notice


def bucket_of(now) -> int:
    return int(calendar.timegm(now.timetuple()) // BUCKET_S)


def _hour_of(now) -> int:
    return int(calendar.timegm(now.timetuple()) // 3600)


def _pct(x: float) -> str:
    return f"{round(x * 100, 1):g}%"


# ---- conditions (pure) ------------------------------------------------------

def _m(row: dict, key: str):
    v = (row.get("metrics") or {}).get(key)
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _usable(rows: list[dict], now) -> Optional[dict]:
    """The newest row, if it is fresh and the collection itself worked."""
    if not rows:
        return None
    latest = rows[0]
    if latest.get("state") != "ok" or latest["ts"] < now - timedelta(seconds=FRESH_S):
        return None
    return latest


def _two_in_a_row(rows: list[dict], now, above: Callable[[dict], Optional[bool]]):
    """True when the newest two samples are both above, False when the newest
    is not, None when unknown (no data, or a single unconfirmed spike)."""
    latest = _usable(rows, now)
    if latest is None:
        return None
    a = above(latest)
    if a is None:
        return None
    if not a:
        return False
    if len(rows) < 2:
        return None
    b = above(rows[1])
    return True if b else None


def evaluate(rows: dict[str, list[dict]], cfg: Config, now) -> dict[str, "Optional[Condition] | _Silent"]:
    """Condition per key: a Condition when it is active, None when it was
    evaluated and is clear, absent when there is no data to tell. `rows` maps
    collector name to samples, newest first."""
    out: dict[str, Optional[Condition]] = {}
    thr = cfg.error_rate

    def rate_above(r):
        rate, n = _m(r, "error_rate"), _m(r, "count")
        if rate is None or n is None:
            return None
        return n >= MIN_REQUESTS and rate >= thr

    api = rows.get("api_latency") or []
    verdict = _two_in_a_row(api, now, rate_above)
    if verdict is True:
        out["error_rate"] = Condition(
            "error_rate", "crit", "API error rate high",
            f"API error rate {_pct(_m(api[0], 'error_rate'))} over the last hour, above {_pct(thr)}",
            "Resolved: API error rate", f"API error rate back under {_pct(thr)}")
    elif verdict is False:
        out["error_rate"] = None

    def p95_above(r):
        v = _m(r, "p95_ms")
        return None if v is None else v >= latency.P95_CRIT_MS

    verdict = _two_in_a_row(api, now, p95_above)
    if verdict is True:
        out["api_p95"] = Condition(
            "api_p95", "crit", "API latency high",
            f"API p95 latency {round(_m(api[0], 'p95_ms'))} ms over the last hour, above {round(latency.P95_CRIT_MS)} ms",
            "Resolved: API latency", f"API p95 latency back under {round(latency.P95_CRIT_MS)} ms")
    elif verdict is False:
        out["api_p95"] = None

    sync = _usable(rows.get("finexer_sync") or [], now)
    failed = _m(sync, "failed_24h") if sync else None
    if failed is not None:
        if failed >= cfg.sync_failures:
            sev = "crit" if failed >= cfg.sync_failures * 3 else "warn"
            out["sync_failures"] = Condition(
                "sync_failures", sev, "Bank sync failures",
                f"{int(failed)} bank connections failed to sync in the last 24 h, above {cfg.sync_failures}",
                "Resolved: bank sync failures", f"Bank sync failures back under {cfg.sync_failures}")
        else:
            out["sync_failures"] = None

    llm = _usable(rows.get("llm_tavily") or [], now)
    if llm is not None:
        backoff = _m(llm, "tavily_backoff")
        if backoff is not None:
            out["quota_tavily"] = Condition(
                "quota_tavily", "crit", "Tavily paused",
                "Tavily research is paused after quota or rate-limit errors",
                "Resolved: Tavily", "Tavily research is running again") if backoff >= 1 else None
        used = _m(llm, "budget_used_pct")
        if used is not None:
            out["quota_openrouter"] = Condition(
                "quota_openrouter", "crit", "Model budget reached",
                f"Model spend is at {round(used)}% of the monthly budget",
                "Resolved: model budget", "Model spend is back under the monthly budget") if used >= 100 else None

    host = _usable(rows.get("vps") or [], now)
    if host is not None:
        disk = _m(host, "disk_used_pct")
        if disk is not None:
            out["vps_disk"] = Condition(
                "vps_disk", "crit", "Server disk nearly full", f"Server disk {round(disk)}% used, above {round(vps.PCT_CRIT)}%",
                "Resolved: server disk", f"Server disk back under {round(vps.PCT_CRIT)}%") if disk >= vps.PCT_CRIT else None
        mem, avail = _m(host, "memory_used_pct"), _m(host, "memory_available_mb")
        if mem is not None:
            low = mem >= vps.PCT_CRIT or (avail is not None and avail < vps.AVAIL_CRIT_MB)
            out["vps_memory"] = Condition(
                "vps_memory", "crit", "Server memory low",
                f"Server memory {round(mem)}% used" + (f", {round(avail)} MB free" if avail is not None else ""),
                "Resolved: server memory", "Server memory back to a safe level") if low else None

    for name, crows in rows.items():
        latest = _usable(crows, now)
        if latest is None:
            continue
        key = f"collector:{name}"
        if any(out.get(k) is not None for k in COVERS.get(name, ())):
            out[key] = SILENT      # one cause, one alert: the specific rule speaks, this key closes quietly
            continue
        title = TITLES.get(name, name)
        status = latest.get("status")
        if status == "crit":
            out[key] = Condition(key, "crit", f"{title} critical", f"{title} reports a critical status",
                                 f"Resolved: {title.lower()}", f"{title} is back to normal")
        elif status == "warn" and len(crows) >= cfg.warn_streak and all(
                r.get("state") == "ok" and r.get("status") in ("warn", "crit") for r in crows[:cfg.warn_streak]):
            out[key] = Condition(key, "warn", f"{title} degraded",
                                 f"{title} has been degraded for {cfg.warn_streak} checks in a row",
                                 f"Resolved: {title.lower()}", f"{title} is back to normal")
        else:
            out[key] = None
    return out


# ---- delivery ---------------------------------------------------------------

async def default_send(title: str, body: str) -> Optional[dict]:
    """Owner only, through the existing push path. None when the owner has the
    `ops_alerts` notification kind switched off (nothing sent)."""
    from app.core.config import PRIMARY_EMAIL
    from app.core.push import send_push_to_user
    from app.services.notifications import notif_pref

    if not await notif_pref(PRIMARY_EMAIL, "ops_alerts"):
        return None
    return await send_push_to_user(PRIMARY_EMAIL, title, body, url=ALERT_URL)


async def _safe_send(send: Send, title: str, body: str) -> Optional[dict]:
    try:
        return await send(title, body)
    except Exception as exc:
        log.warning("health alert push failed: %s", type(exc).__name__)
        return None


def _delivery(res: Optional[dict]) -> dict:
    totals = {"attempted": 0, "delivered": 0, "failed": 0}
    for part in (res or {}).values():
        if isinstance(part, dict):
            for k in totals:
                if isinstance(part.get(k), int):
                    totals[k] += part[k]
    return totals


# ---- throttle state ---------------------------------------------------------

async def _roll_cap(col, now, send: Send) -> None:
    """Start the hour's counter once; whoever wins the roll-over sends the one
    summary for the previous hour's suppressed alerts."""
    hour = _hour_of(now)
    try:
        await col.insert_one({"_id": CAP_ID, "hour": hour, "sent": 0, "suppressed": 0})
    except DuplicateKeyError:
        pass
    prev = await col.find_one_and_update(
        {"_id": CAP_ID, "hour": {"$ne": hour}}, {"$set": {"hour": hour, "sent": 0, "suppressed": 0}},
        return_document=ReturnDocument.BEFORE)
    n = int((prev or {}).get("suppressed") or 0)
    if n > 0:
        word = "alert" if n == 1 else "alerts"
        await _safe_send(send, "More alerts suppressed", f"{n} more {word} suppressed in the last hour. See /ops/health")


async def _take_slot(col, now, cfg: Config) -> bool:
    res = await col.update_one({"_id": CAP_ID, "hour": _hour_of(now), "sent": {"$lt": cfg.hourly_cap}}, {"$inc": {"sent": 1}})
    return res.modified_count == 1


async def _note_suppressed(col, key: str, now) -> None:
    hour = _hour_of(now)
    res = await col.update_one({"_id": key, "suppressed_hour": {"$ne": hour}}, {"$set": {"suppressed_hour": hour}})
    if res.modified_count == 1:
        await col.update_one({"_id": CAP_ID}, {"$inc": {"suppressed": 1}})


async def _apply_active(col, cond: Condition, bucket: int, now, cfg: Config, send: Send, stats: dict) -> None:
    doc = await col.find_one({"_id": cond.key})
    fields = {"severity": cond.severity, "title": cond.title, "body": cond.body, "resolved_title": cond.resolved_title,
              "resolved_body": cond.resolved_body, "event": cond.event, "last_seen": now}
    if doc is None:
        new = {"_id": cond.key, "state": "open", "first_seen": now, "count": 1, "last_notified": None,
               "clear_streak": 0, "last_eval_bucket": bucket, **fields}
        try:
            await col.insert_one(new)
        except DuplicateKeyError:
            stats["deduped"] += 1
            return
        was_open, notified_sev, last_notified = False, None, None
    else:
        was_open = doc.get("state") == "open"
        update: dict = {"$set": {**fields, "state": "open", "clear_streak": 0, "last_eval_bucket": bucket}}
        if not was_open:
            update["$set"]["first_seen"] = now
            update["$inc"] = {"count": 1}
        claimed = await col.update_one({"_id": cond.key, "last_eval_bucket": {"$ne": bucket}}, update)
        if claimed.modified_count != 1:
            stats["deduped"] += 1
            return
        notified_sev, last_notified = (doc.get("notified_severity") if was_open else None), doc.get("last_notified")

    # warn to crit re-notifies once; a crit that was already announced never does
    escalated = was_open and notified_sev == "warn" and cond.severity == "crit"
    cooled = last_notified is None or last_notified <= now - timedelta(hours=cfg.cooldown_h)
    if not (cooled or escalated):
        stats["throttled"] += 1
        return
    if not await _take_slot(col, now, cfg):
        stats["suppressed"] += 1
        await _note_suppressed(col, cond.key, now)
        if cond.event:     # nothing retries an event, so close it; the summary counts it
            await col.update_one({"_id": cond.key}, {"$set": {"state": "resolved", "resolved_at": now}})
        return
    await col.update_one({"_id": cond.key}, {"$set": {"last_notified": now, "notified_severity": cond.severity}})
    await _safe_send(send, cond.title, cond.body)
    stats["sent"] += 1
    if cond.event:
        await col.update_one({"_id": cond.key}, {"$set": {"state": "resolved", "resolved_at": now}})


async def _apply_clear(col, key: str, bucket: int, now, cfg: Config, send: Send, stats: dict, silent: bool = False) -> None:
    doc = await col.find_one({"_id": key})
    if not doc or doc.get("state") != "open":
        return
    if silent:
        await col.update_one({"_id": key, "state": "open"}, {"$set": {"state": "resolved", "resolved_at": now}})
        return
    claimed = await col.update_one({"_id": key, "state": "open", "last_eval_bucket": {"$ne": bucket}},
                                   {"$inc": {"clear_streak": 1}, "$set": {"last_eval_bucket": bucket}})
    if claimed.modified_count != 1:
        stats["deduped"] += 1
        return
    if int(doc.get("clear_streak") or 0) + 1 < CLEAR_SAMPLES:
        return
    closed = await col.update_one({"_id": key, "state": "open"}, {"$set": {"state": "resolved", "resolved_at": now}})
    if closed.modified_count != 1 or doc.get("last_notified") is None or doc.get("event"):
        return
    if not await _take_slot(col, now, cfg):
        stats["suppressed"] += 1
        await _note_suppressed(col, key, now)
        return
    await _safe_send(send, doc.get("resolved_title") or "Resolved", doc.get("resolved_body") or "Back to normal")
    stats["resolved"] += 1
    # the story is told: a relapse is a new alert and notifies, not a repeat inside the cooldown
    await col.update_one({"_id": key}, {"$set": {"last_notified": None, "notified_severity": None}})


def _stats() -> dict:
    return {"sent": 0, "resolved": 0, "throttled": 0, "suppressed": 0, "deduped": 0}


async def process(col, results: dict, now, cfg: Config, send: Send) -> dict:
    """Apply one evaluation to the alert state, notifying as the rules allow."""
    stats = _stats()
    bucket = bucket_of(now)
    await _roll_cap(col, now, send)
    for key, cond in results.items():
        if isinstance(cond, Condition):
            await _apply_active(col, cond, bucket, now, cfg, send, stats)
    for key, cond in results.items():
        if cond is None or cond is SILENT:
            await _apply_clear(col, key, bucket, now, cfg, send, stats, silent=cond is SILENT)
    # an open alert nothing has evaluated for a day (collector gone) closes quietly
    await col.update_many({"state": "open", "event": {"$ne": True}, "last_seen": {"$lt": now - timedelta(hours=STALE_OPEN_HOURS)},
                           "_id": {"$nin": list(results)}}, {"$set": {"state": "resolved", "resolved_at": now}})
    return stats


async def fetch_rows(samples_col, now) -> dict[str, list[dict]]:
    docs = await samples_col.find(
        {"ts": {"$gte": now - timedelta(hours=ROW_WINDOW_H)}}, {"collector": 1, "ts": 1, "state": 1, "status": 1, "metrics": 1},
    ).sort("ts", -1).to_list(None)
    out: dict[str, list[dict]] = {}
    for d in docs:
        rows = out.setdefault(d["collector"], [])
        if len(rows) < ROWS_PER_COLLECTOR:
            rows.append(d)
    return out


async def run_alerts(samples_col=None, state_col=None, now=None, send: Optional[Send] = None, cfg: Optional[Config] = None) -> dict:
    """The cron entry point. Off unless ALERTS_ENABLED; never raises."""
    cfg = cfg or await _fresh_config()
    if not cfg.enabled:
        return {"enabled": False}
    try:
        from app.db import collections as c
        samples_col = samples_col if samples_col is not None else c.health_samples_col
        state_col = state_col if state_col is not None else c.alert_state_col
        now = now or naive_utc_now()
        results = evaluate(await fetch_rows(samples_col, now), cfg, now)
        return {"enabled": True, **await process(state_col, results, now, cfg, send or default_send)}
    except Exception as exc:
        log.warning("health alerts failed: %s", type(exc).__name__)
        return {"enabled": True, "error": True}


# ---- new error types --------------------------------------------------------

async def process_new_error_types(seen_col=None, state_col=None, now=None, send: Optional[Send] = None,
                                  cfg: Optional[Config] = None) -> dict:
    """Flush this process's exception class names; alert on the new ones.
    The baseline is recorded even while alerts are off, so enabling them later
    does not announce every class the app has ever raised."""
    cfg = cfg or await _fresh_config()
    try:
        from app.db import collections as c
        seen_col = seen_col if seen_col is not None else c.error_types_seen_col
        state_col = state_col if state_col is not None else c.alert_state_col
        now = now or naive_utc_now()
        new = await error_types.flush(seen_col)
        if not cfg.enabled or not new:
            return {"enabled": cfg.enabled, "new": 0 if not cfg.enabled else len(new)}
        stats = _stats()
        await _roll_cap(state_col, now, send or default_send)
        for name in new:
            cond = Condition(f"new_error:{name}", "warn", "New error type",
                             f"{name} raised for the first time in {error_types.NEW_AFTER_DAYS} days", event=True)
            await _apply_active(state_col, cond, bucket_of(now), now, cfg, send or default_send, stats)
        return {"enabled": True, "new": len(new), **stats}
    except Exception as exc:
        log.warning("new error type check failed: %s", type(exc).__name__)
        return {"enabled": cfg.enabled, "error": True}


# ---- page data and the test button -----------------------------------------

def _public(d: dict) -> dict:
    return {
        "key": d["_id"], "state": d.get("state"), "severity": d.get("severity"), "title": d.get("title"),
        "body": d.get("body"), "first_seen": iso(d.get("first_seen")), "last_notified": iso(d.get("last_notified")),
        "resolved_at": iso(d.get("resolved_at")), "count": d.get("count", 0),
    }


async def snapshot(state_col, now=None, cfg: Optional[Config] = None) -> dict:
    cfg = cfg or await _fresh_config()
    now = now or naive_utc_now()
    since = now - timedelta(hours=HISTORY_HOURS)
    real = {"_id": {"$nin": [CAP_ID, TEST_ID]}}
    open_docs = await state_col.find({**real, "state": "open"}).sort("first_seen", -1).to_list(100)
    history = await state_col.find({**real, "$or": [{"first_seen": {"$gte": since}}, {"last_notified": {"$gte": since}},
                                                    {"resolved_at": {"$gte": since}}]}).to_list(200)
    history.sort(key=lambda d: max(d.get(k) or since for k in ("first_seen", "last_notified", "resolved_at")), reverse=True)
    cap = await state_col.find_one({"_id": CAP_ID}) or {}
    return {
        "enabled": cfg.enabled,
        "config": {"cooldown_hours": cfg.cooldown_h, "warn_streak": cfg.warn_streak, "hourly_cap": cfg.hourly_cap},
        "open": [_public(d) for d in open_docs],
        "history": [_public(d) for d in history[:50]],
        "cap": {"sent_this_hour": cap.get("sent", 0) if cap.get("hour") == _hour_of(now) else 0,
                "suppressed_this_hour": cap.get("suppressed", 0) if cap.get("hour") == _hour_of(now) else 0},
        "error_types_last_hour": error_types.distinct_last_hour(),
    }


async def send_test(state_col, now=None, send: Optional[Send] = None, cfg: Optional[Config] = None) -> dict:
    """One test push to the owner, at most one a minute. Works with alerts
    switched off so delivery can be checked before enabling them."""
    cfg = cfg or await _fresh_config()
    now = now or naive_utc_now()
    try:
        await state_col.insert_one({"_id": TEST_ID, "last_notified": None})
    except DuplicateKeyError:
        pass
    claimed = await state_col.update_one(
        {"_id": TEST_ID, "$or": [{"last_notified": None}, {"last_notified": {"$lte": now - timedelta(seconds=TEST_COOLDOWN_S)}}]},
        {"$set": {"last_notified": now}})
    if claimed.modified_count != 1:
        doc = await state_col.find_one({"_id": TEST_ID}) or {}
        last = doc.get("last_notified")
        wait = max(1, int(TEST_COOLDOWN_S - (now - last).total_seconds())) if last else TEST_COOLDOWN_S
        return {"sent": False, "throttled": True, "retry_after_s": wait, "enabled": cfg.enabled}
    res = await _safe_send(send or default_send, "Test alert", "This is a test alert from Sorted. Alerts are reaching you.")
    return {"sent": res is not None, "throttled": False, "enabled": cfg.enabled, "delivery": _delivery(res),
            "note": None if res is not None else "Not sent: the ops_alerts notification kind is off or the push failed."}


async def after_api_sample() -> None:
    """Hook for the API process's 5 minute sampler loop."""
    await process_new_error_types()
