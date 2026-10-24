"""Finexer webhook support (A167): provider-shape-independent plumbing.

Finexer's webhook documentation has not been pinned down from an
authoritative source (docs/ops/FINEXER_WEBHOOKS.md lists exactly which facts
are confirmed and which are assumed). Everything provider-shaped here is
therefore driven by config (app.core.config FINEXER_WEBHOOK_*) so correcting
it from Finexer's docs page needs no code change:

- signature verification: pluggable scheme, header name, tolerance;
- event id and event type extraction: dotted paths;
- event type -> action table: DEFAULT_EVENT_ACTIONS plus a JSON override.

Also here: the polling safety-net decision (finexer_poll_due), the per-day
Finexer API-call counters, and the /ops/health summary.

Naive-clock note: Mongo returns naive UTC datetimes, so every comparison
against stored values here uses a naive UTC "now".
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Optional

from app.core import config as cfg

logger = logging.getLogger(__name__)

# ── Event type -> action ──────────────────────────────────────────────────
ACTION_SYNC_CONSENT = "sync_consent"
ACTION_CONSENT_AUTHORISED = "consent_authorised"
ACTION_CONSENT_EXPIRING = "consent_expiring"
ACTION_CONSENT_EXPIRED = "consent_expired"
ACTION_CONSENT_REVOKED = "consent_revoked"
ACTION_ACCOUNT_DELETED = "account_deleted"
ACTION_RECORD_ONLY = "record_only"
ACTION_UNKNOWN = "unknown"
VALID_ACTIONS = frozenset({
    ACTION_SYNC_CONSENT, ACTION_CONSENT_AUTHORISED, ACTION_CONSENT_EXPIRING,
    ACTION_CONSENT_EXPIRED, ACTION_CONSENT_REVOKED, ACTION_ACCOUNT_DELETED,
    ACTION_RECORD_ONLY, ACTION_UNKNOWN,
})

# Finexer docs, Set up webhooks, read 2026-10-18: the dashboard offers exactly
# these bank account and bank consent events (US spellings: authorized,
# canceled). Payment events exist but are not consumed. Any type not listed is
# "unknown": recorded and ignored, never a sync. Override or extend per type
# with FINEXER_WEBHOOK_EVENT_ACTIONS.
DEFAULT_EVENT_ACTIONS: dict[str, str] = {
    "bank_account.created": ACTION_SYNC_CONSENT,
    "bank_account.updated": ACTION_SYNC_CONSENT,
    "bank_account.synced": ACTION_SYNC_CONSENT,
    "bank_account.deleted": ACTION_ACCOUNT_DELETED,
    "consent.authorized": ACTION_CONSENT_AUTHORISED,
    "consent.canceled": ACTION_CONSENT_REVOKED,
    # Expiry is distinct from cancellation: it feeds the reconsent prompt
    # (A6.2A, task_consent_watch), it does not revoke.
    "consent.expired": ACTION_CONSENT_EXPIRED,
    "consent.created": ACTION_RECORD_ONLY,
}


def event_actions(override_json: Optional[str] = None) -> dict[str, str]:
    """Default table merged with the JSON override (lower-cased keys). A bad
    override (invalid JSON, non-object, unknown action) is dropped with a
    warning, never raised: a config typo must not take the receiver down."""
    table = dict(DEFAULT_EVENT_ACTIONS)
    raw = cfg.FINEXER_WEBHOOK_EVENT_ACTIONS if override_json is None else override_json
    if not raw:
        return table
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("FINEXER_WEBHOOK_EVENT_ACTIONS is not valid JSON; ignoring it")
        return table
    if not isinstance(parsed, dict):
        logger.warning("FINEXER_WEBHOOK_EVENT_ACTIONS must be a JSON object; ignoring it")
        return table
    for k, v in parsed.items():
        if isinstance(k, str) and v in VALID_ACTIONS:
            table[k.strip().lower()] = v
        else:
            logger.warning("FINEXER_WEBHOOK_EVENT_ACTIONS: ignoring an invalid entry")
    return table


def resolve_action(event_type: Optional[str], table: Optional[Mapping[str, str]] = None) -> str:
    if not isinstance(event_type, str) or not event_type:
        return ACTION_UNKNOWN
    t = table if table is not None else event_actions()
    return t.get(event_type.strip().lower(), ACTION_UNKNOWN)


def safe_type_for_log(event_type: Any) -> str:
    """Event type only, bounded and repr'd so a hostile value cannot inject
    log lines. Never log payloads."""
    return repr(str(event_type)[:80])


# ── Envelope field extraction ─────────────────────────────────────────────
def dig(obj: Any, path: str) -> Any:
    cur = obj
    for part in (path or "").split("."):
        if not part:
            return None
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def extract_event_type(event: dict) -> str:
    for path in (cfg.FINEXER_WEBHOOK_EVENT_TYPE_FIELDS or "type").split(","):
        v = dig(event, path.strip())
        if isinstance(v, str) and v:
            return v
    return "unknown"


def extract_event_id(event: dict) -> Optional[str]:
    v = dig(event, cfg.FINEXER_WEBHOOK_EVENT_ID_FIELD)
    if isinstance(v, str) and v and len(v) <= 200:
        return v
    return None


# ── Signature verification (pluggable) ────────────────────────────────────
SCHEME_T_S_HMAC_SHA256 = "t_s_hmac_sha256"
SCHEME_RAW_HMAC_SHA256 = "raw_hmac_sha256"


def _parse_timestamp(ts: str) -> Optional[datetime]:
    try:
        ts = ts.strip()
        if ts.isdigit():
            n = int(ts)
            if n > 10_000_000_000:  # milliseconds
                n //= 1000
            return datetime.fromtimestamp(n, tz=timezone.utc)
        iso = ts[:-1] + "+00:00" if ts.endswith("Z") else ts
        dt = datetime.fromisoformat(iso)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (ValueError, OverflowError, OSError):
        return None


def _fresh(event_time: datetime, tolerance: int, now: Optional[datetime]) -> bool:
    now = now or datetime.now(timezone.utc)  # naive-ok: tz-aware, compared to a parsed aware timestamp
    return abs((now - event_time).total_seconds()) <= tolerance


def verify_signature(
    raw_body: bytes,
    headers: Mapping[str, str],
    *,
    secret: str,
    scheme: Optional[str] = None,
    header_name: Optional[str] = None,
    timestamp_header: Optional[str] = None,
    tolerance_seconds: Optional[int] = None,
    now: Optional[datetime] = None,
) -> bool:
    """True only for a correctly signed, fresh request. Fails closed: an empty
    secret, a missing header or an unknown scheme is False. Always verifies
    the exact raw body bytes (never re-serialised JSON) and compares in
    constant time."""
    if not secret:
        return False
    scheme = scheme or cfg.FINEXER_WEBHOOK_SIGNATURE_SCHEME
    header_name = header_name or cfg.FINEXER_WEBHOOK_SIGNATURE_HEADER
    tolerance = cfg.FINEXER_WEBHOOK_TOLERANCE_SECONDS if tolerance_seconds is None else tolerance_seconds
    ts_header = cfg.FINEXER_WEBHOOK_TIMESTAMP_HEADER if timestamp_header is None else timestamp_header

    value = headers.get(header_name) or headers.get(header_name.lower())
    if not value or not isinstance(value, str):
        return False

    if scheme == SCHEME_T_S_HMAC_SHA256:
        parts: dict[str, str] = {}
        for chunk in value.split(";"):
            if "=" not in chunk:
                continue
            k, v = chunk.split("=", 1)
            parts[k.strip()] = v.strip()
        ts, sig = parts.get("t"), parts.get("s")
        if not ts or not sig:
            return False
        event_time = _parse_timestamp(ts)
        if event_time is None or not _fresh(event_time, tolerance, now):
            return False
        expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected.encode(), sig.encode())

    if scheme == SCHEME_RAW_HMAC_SHA256:
        if ts_header:
            raw_ts = headers.get(ts_header) or headers.get(ts_header.lower())
            event_time = _parse_timestamp(raw_ts) if isinstance(raw_ts, str) else None
            if event_time is None or not _fresh(event_time, tolerance, now):
                return False
        sig = value.strip()
        if sig.lower().startswith("sha256="):
            sig = sig[7:]
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected.encode(), sig.lower().encode())

    logger.error("Finexer webhook: unknown FINEXER_WEBHOOK_SIGNATURE_SCHEME; rejecting")
    return False


def explain_signature_failure(
    raw_body: bytes,
    headers: Mapping[str, str],
    *,
    secret: str,
    scheme: Optional[str] = None,
    header_name: Optional[str] = None,
    timestamp_header: Optional[str] = None,
    tolerance_seconds: Optional[int] = None,
    now: Optional[datetime] = None,
) -> str:
    """Diagnostic twin of verify_signature (A168): re-runs the same parsing
    steps and returns a short reason code for the log. Never includes the
    secret, the signature value or the body. Returns "ok" if the request would
    in fact verify."""
    if not secret:
        return "no_secret"
    scheme = scheme or cfg.FINEXER_WEBHOOK_SIGNATURE_SCHEME
    header_name = header_name or cfg.FINEXER_WEBHOOK_SIGNATURE_HEADER
    tolerance = cfg.FINEXER_WEBHOOK_TOLERANCE_SECONDS if tolerance_seconds is None else tolerance_seconds
    ts_header = cfg.FINEXER_WEBHOOK_TIMESTAMP_HEADER if timestamp_header is None else timestamp_header

    value = headers.get(header_name) or headers.get(header_name.lower())
    if not value or not isinstance(value, str):
        return "header_missing"

    def _skew(event_time: datetime) -> Optional[str]:
        current = now or datetime.now(timezone.utc)  # naive-ok: tz-aware, compared to a parsed aware timestamp
        skew = (current - event_time).total_seconds()
        if abs(skew) > tolerance:
            return f"timestamp_stale(skew={round(skew)}s)"
        return None

    if scheme == SCHEME_T_S_HMAC_SHA256:
        parts: dict[str, str] = {}
        for chunk in value.split(";"):
            if "=" not in chunk:
                continue
            k, v = chunk.split("=", 1)
            parts[k.strip()] = v.strip()
        ts, sig = parts.get("t"), parts.get("s")
        if not ts or not sig:
            return "header_malformed"
        event_time = _parse_timestamp(ts)
        if event_time is None:
            return "timestamp_unparseable"
        stale = _skew(event_time)
        if stale:
            return stale
        expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
        return "ok" if hmac.compare_digest(expected.encode(), sig.encode()) else "digest_mismatch"

    if scheme == SCHEME_RAW_HMAC_SHA256:
        if ts_header:
            raw_ts = headers.get(ts_header) or headers.get(ts_header.lower())
            if not isinstance(raw_ts, str) or not raw_ts:
                return "header_missing"
            event_time = _parse_timestamp(raw_ts)
            if event_time is None:
                return "timestamp_unparseable"
            stale = _skew(event_time)
            if stale:
                return stale
        sig = value.strip()
        if sig.lower().startswith("sha256="):
            sig = sig[7:]
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return "ok" if hmac.compare_digest(expected.encode(), sig.lower().encode()) else "digest_mismatch"

    return "unknown_scheme"


_signing_status_logged = False


def log_signing_status(signing_secret: Optional[str] = None) -> None:
    """Called once at API startup. States, once, whether the signature gate is
    on; never prints the secret."""
    global _signing_status_logged
    if _signing_status_logged:
        return
    _signing_status_logged = True
    secret = cfg.FINEXER_WEBHOOK_SIGNING_SECRET if signing_secret is None else signing_secret
    if secret:
        logger.info("Finexer webhooks: signature verification is mandatory (fail closed)")
    else:
        logger.warning(
            "Finexer webhooks: FINEXER_WEBHOOK_SIGNING_SECRET is not configured; "
            "the URL path secret is the only gate on POST /webhooks/finexer/{secret}"
        )


# ── Polling safety net ────────────────────────────────────────────────────
def finexer_poll_due(
    fx: Mapping[str, Any],
    now: datetime,
    tier_window: Optional[timedelta],
    *,
    poll_hours: Optional[float] = None,
    stale_hours: Optional[float] = None,
    safety_net_hours: float = 0,
) -> bool:
    """Is this authorised consent due a reconcile sync (naive-UTC `now`)?

    - `tier_window` None (on-upload tiers) is never polled, as before.
    - Webhooks healthy for this consent (one within `stale_hours`): poll only
      once per `poll_hours` (minus half an hour so a 4-hourly cron tick never
      drifts a whole cycle late), never more often than the tier's own window.
    - No webhook within `stale_hours` (or ever): fall back to the tier's own
      cadence, exactly the pre-A167 behaviour.
    - poll_hours <= 0 disables the safety-net gating entirely (legacy).
    - E11 `safety_net_hours` > 0 (runtime setting SYNC_WEBHOOK_SAFETY_NET_HOURS,
      0 is off): on top of the above, a consent is only polled when it has had
      neither a webhook nor a sync in that many hours. Never-synced consents
      are still always due.
    """
    if tier_window is None:
        return False
    poll_hours = cfg.FINEXER_POLL_INTERVAL_HOURS if poll_hours is None else poll_hours
    stale_hours = cfg.FINEXER_WEBHOOK_STALE_HOURS if stale_hours is None else stale_hours
    last_synced = fx.get("last_synced")
    if last_synced is None:
        return True
    window = tier_window
    last_webhook = fx.get("last_webhook_at")
    if poll_hours > 0 and last_webhook is not None and last_webhook >= now - timedelta(hours=stale_hours):
        window = max(timedelta(hours=poll_hours) - timedelta(minutes=30), tier_window)
    if not last_synced < now - window:
        return False
    if safety_net_hours and safety_net_hours > 0:
        latest = last_synced
        if last_webhook is not None and last_webhook > latest:
            latest = last_webhook
        return latest < now - timedelta(hours=safety_net_hours)
    return True


def effective_poll_window(tier_window: Optional[timedelta], sync_poll_hours: float) -> Optional[timedelta]:
    """E11: apply SYNC_POLL_HOURS to a tier's staleness window. Half an hour is
    taken off so a cron tick never drifts a whole cycle late, and a tier is
    never polled more often than its own window, so the default of 4 (3 h 30)
    changes nothing and Lite's daily window is kept."""
    if tier_window is None:
        return None
    return max(tier_window, timedelta(hours=sync_poll_hours) - timedelta(minutes=30))


# ── Per-day Finexer API-call counters ─────────────────────────────────────
def _day_key(now: Optional[datetime] = None) -> str:
    return "finexer_api_calls:" + (now or datetime.utcnow()).strftime("%Y-%m-%d")  # naive-ok: UTC day bucket for a metrics counter


async def bump_daily_counters(now: Optional[datetime] = None, **increments: int) -> None:
    """$inc counters on one worker_runs_col doc per UTC day (`requests`,
    `rate_limited`, `webhook_events`, `webhook_syncs_enqueued`,
    `webhook_events_coalesced`, `poll_syncs_enqueued`, and E11's `user_syncs` and
    `history_syncs`). Best effort: metrics
    must never break a sync or a webhook."""
    incs = {k: int(v) for k, v in increments.items() if v}
    if not incs:
        return
    try:
        from app.db.collections import worker_runs_col
        n = now or datetime.utcnow()  # naive-ok: UTC day bucket for a metrics counter
        await worker_runs_col.update_one(
            {"_id": _day_key(n)},
            {"$inc": incs, "$set": {"updated_at": n}},
            upsert=True,
        )
    except Exception:
        logger.exception("finexer: failed to record daily counters")


# ── /ops/health summary ───────────────────────────────────────────────────
async def webhook_health(now: Optional[datetime] = None) -> dict:
    from app.db.collections import finexer_consents_col, worker_runs_col

    now = now or datetime.utcnow()  # naive-ok: compared with Mongo's naive UTC datetimes
    stale_hours = cfg.FINEXER_WEBHOOK_STALE_HOURS
    cutoff = now - timedelta(hours=stale_hours)

    last_doc = None
    async for d in finexer_consents_col.find(
        {"last_webhook_at": {"$exists": True, "$ne": None}}, {"last_webhook_at": 1}
    ).sort("last_webhook_at", -1).limit(1):
        last_doc = d
    last_at = (last_doc or {}).get("last_webhook_at")
    minutes_ago = int((now - last_at).total_seconds() // 60) if last_at else None

    authorised = await finexer_consents_col.count_documents({"status": "authorized"})
    without = await finexer_consents_col.count_documents({
        "status": "authorized",
        "$or": [
            {"last_webhook_at": {"$exists": False}},
            {"last_webhook_at": None},
            {"last_webhook_at": {"$lt": cutoff}},
        ],
    })
    today = await worker_runs_col.find_one({"_id": _day_key(now)}) or {}
    yesterday = await worker_runs_col.find_one({"_id": _day_key(now - timedelta(days=1))}) or {}

    if minutes_ago is None:
        line = f"webhooks: none received yet, consents without webhook in {stale_hours:g}h: {without}"
    else:
        line = f"webhooks: last received {minutes_ago} min ago, consents without webhook in {stale_hours:g}h: {without}"
    return {
        "signing_configured": bool(cfg.FINEXER_WEBHOOK_SIGNING_SECRET),
        # A171: false in production means FINEXER_WEBHOOK_SECRET is unset and
        # the webhook route is disabled. Source is a label, never the value.
        "path_secret_configured": bool(cfg.FINEXER_WEBHOOK_SECRET),
        "path_secret_source": cfg.FINEXER_WEBHOOK_SECRET_SOURCE,
        "last_received_at": last_at.isoformat() if last_at else None,
        "minutes_ago": minutes_ago,
        "authorized_consents": authorised,
        "consents_without_webhook": without,
        "stale_hours": stale_hours,
        "line": line,
        "api_calls_today": int(today.get("requests", 0)),
        "api_calls_yesterday": int(yesterday.get("requests", 0)),
        "webhook_syncs_today": int(today.get("webhook_syncs_enqueued", 0)),
        "poll_syncs_today": int(today.get("poll_syncs_enqueued", 0)),
    }
