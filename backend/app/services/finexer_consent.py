"""A182: Finexer consent lifecycle helpers.

- 90-day reconfirmation (renewed_at, next_reconfirm_by, the reconfirm call);
- the requested history start (retro_date);
- consent failure codes and the plain sentence shown for each;
- the per-consent summary for /ops/health.

Contract notes. Finexer's API reference sits behind the dashboard login, so
the request shapes below come from Kevin's notes on it (A182 board note),
not from a live response: `POST /consents/{id}` with `renewed_at` (ISO) is
"Update a consent"; `retro_date` is accepted on `POST /consents`. Nothing
here sends `scopes`: the 2026-07-23 contract said it was rejected as
invalid_parameter and no documented shape has been seen since.

Naive-clock note: Mongo returns naive UTC datetimes, so every comparison
here uses a naive UTC "now".
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from typing import Any, Optional

logger = logging.getLogger(__name__)

RECONFIRM_DAYS = 90
# The in-app prompt appears this long before the due day; the worker push
# (task_consent_watch) goes out inside RECONFIRM_PUSH_DAYS of it.
RECONFIRM_PROMPT_DAYS = 14
RECONFIRM_PUSH_DAYS = 7

RECONFIRM_FAILED_MESSAGE = "We could not confirm just now. Try again later."


def _utcnow() -> datetime:
    return datetime.utcnow()  # naive-ok: compared with Mongo's naive UTC datetimes


# ── 90-day reconfirmation ─────────────────────────────────────────────────
def next_reconfirm_by(authed_at: Any, renewed_at: Any, expiry_date: Any = None) -> Optional[datetime]:
    """The day the user must next reconfirm: renewed_at (or authed_at when never
    renewed) plus 90 days. None when there is nothing to reconfirm: no start
    date known, or the consent itself ends first (expiry not beyond that day,
    so the rule for consents longer than 90 days does not apply)."""
    base = renewed_at if isinstance(renewed_at, datetime) else authed_at
    if not isinstance(base, datetime):
        return None
    due = base + timedelta(days=RECONFIRM_DAYS)
    if isinstance(expiry_date, datetime) and expiry_date <= due:
        return None
    return due


def consent_next_reconfirm_by(doc: dict) -> Optional[datetime]:
    return next_reconfirm_by(doc.get("authed_at"), doc.get("renewed_at"), doc.get("expiry_date"))


def reconfirm_prompt_due(doc: dict, now: Optional[datetime] = None) -> bool:
    """True for an authorised consent inside the prompt window before its due
    day (and after it, until reconfirmed)."""
    if doc.get("status") != "authorized":
        return False
    due = consent_next_reconfirm_by(doc)
    if due is None:
        return False
    return (now or _utcnow()) >= due - timedelta(days=RECONFIRM_PROMPT_DAYS)


def reconfirm_push_due(doc: dict, now: Optional[datetime] = None) -> bool:
    """True when the due day is within RECONFIRM_PUSH_DAYS (or already passed)."""
    if doc.get("status") != "authorized":
        return False
    due = consent_next_reconfirm_by(doc)
    if due is None:
        return False
    return (now or _utcnow()) >= due - timedelta(days=RECONFIRM_PUSH_DAYS)


def _iso_z(dt: datetime) -> str:
    return dt.replace(microsecond=0).isoformat() + "Z"


class ReconfirmError(Exception):
    """Finexer would not record the reconfirmation. The route turns this into
    the plain RECONFIRM_FAILED_MESSAGE; the consent record is left unchanged."""

    def __init__(self, status: Optional[int] = None):
        super().__init__(RECONFIRM_FAILED_MESSAGE)
        self.status = status
        self.message = RECONFIRM_FAILED_MESSAGE


async def reconfirm_consent(consent_id: str, now: Optional[datetime] = None) -> dict:
    """Write renewed_at at Finexer (Update a consent) and store the answer.

    No bank login, and expiry_date is never touched here. Fails closed: any
    non-2xx, network error or unreadable answer raises ReconfirmError before
    the local record changes."""
    from app.db.collections import finexer_consents_col
    from app.services import finexer_sync as fs

    now = now or _utcnow()
    sent = _iso_z(now)
    try:
        async with fs._client() as client:
            resp = await fs._post(client, f"/consents/{consent_id}", data={"renewed_at": sent})
    except Exception as exc:
        logger.warning("Finexer reconfirm failed: %s", type(exc).__name__)
        raise ReconfirmError(None) from exc
    if resp.status_code not in (200, 201):
        fs.log_finexer_error(resp, "POST /consents/{id} reconfirm")
        raise ReconfirmError(resp.status_code)
    try:
        body = resp.json()
    except Exception:
        body = {}
    body = body if isinstance(body, dict) else {}
    renewed = fs._parse_iso_utc(body.get("renewed_at")) or now
    doc = await finexer_consents_col.find_one({"_id": consent_id}) or {}
    fields: dict = {"renewed_at": renewed, "reconfirmed_at": now}
    due = next_reconfirm_by(doc.get("authed_at"), renewed, doc.get("expiry_date"))
    update: dict = {"$set": fields}
    if due is not None:
        fields["next_reconfirm_by"] = due
    else:
        update["$unset"] = {"next_reconfirm_by": ""}
    # A fresh due day means the next reminder is wanted again.
    update.setdefault("$unset", {}).update({"last_reconfirm_nag": ""})
    await finexer_consents_col.update_one({"_id": consent_id}, update)
    return {"renewed_at": renewed, "next_reconfirm_by": due}


# ── History (retro_date) ──────────────────────────────────────────────────
def retro_date_for(months: int, today: Optional[datetime] = None) -> Optional[str]:
    """YYYY-MM-DD `months` calendar months before today (UTC), or None for 0.
    The bank's own maximum still applies at the other end."""
    if not months or months < 1:
        return None
    t = today or _utcnow()
    idx = t.year * 12 + (t.month - 1) - int(months)
    year, month = divmod(idx, 12)
    month += 1
    # Clamp the day for shorter months (31 March minus one month).
    nxt = datetime(year + (month // 12), (month % 12) + 1, 1)
    last = (nxt - timedelta(days=1)).day
    return datetime(year, month, min(t.day, last)).strftime("%Y-%m-%d")


async def retro_months_setting() -> int:
    from app.services import runtime_settings
    try:
        return int(await runtime_settings.asetting("FINEXER_RETRO_MONTHS"))
    except Exception:
        return 12


# ── Failure codes ─────────────────────────────────────────────────────────
_GENERIC_FAILURE = "Your bank did not complete the connection. Reconnect to try again."
FAILURE_REASONS = {
    "access_denied": "Your bank did not approve the connection. Reconnect and approve access when asked.",
    "consent_limit_reached": "Your bank may limit how many connections it allows at once. Reconnecting usually replaces the old one.",
    "consent_revoked_by_bank": "Your bank ended this connection. Reconnect to give access again.",
}

_CODE_RE = re.compile(r"^[a-z0-9_.\-]{1,64}$")
_SECRETISH = re.compile(r"\b(?:sk|pk|rk|key|tok|token|secret)_[A-Za-z0-9_\-]{6,}\b", re.IGNORECASE)


def consent_failure_fields(obj: Any) -> dict:
    """failure_code and failure_message from a consent object (GET
    /consents/{id} or a webhook's data.object), when present. The code is
    kept only if it looks like a code; the message is bounded and scrubbed of
    key-shaped strings. Empty dict when the object carries neither."""
    if not isinstance(obj, dict):
        return {}
    out: dict = {}
    code = obj.get("failure_code")
    if isinstance(code, str) and _CODE_RE.match(code.strip().lower()):
        out["failure_code"] = code.strip().lower()
    msg = obj.get("failure_message")
    if isinstance(msg, str) and msg.strip():
        out["failure_message"] = " ".join(_SECRETISH.sub("[redacted]", msg).split())[:200]
    return out


def consent_sync_fields(consent_doc: dict, local_consent: dict) -> dict:
    """What the sync stores from GET /consents/{id} beyond status and expiry:
    a failure code and message when the consent carries them (a healthy
    authorised one clears an earlier failure), and next_reconfirm_by from the
    renewed_at and expiry_date Finexer reports."""
    from app.services.finexer_sync import _parse_iso_utc
    out: dict = {}
    failure = consent_failure_fields(consent_doc)
    if failure:
        out.update(failure)
    elif consent_doc.get("status") == "authorized":
        out.update({"failure_code": None, "failure_message": None})
    out["next_reconfirm_by"] = next_reconfirm_by(
        local_consent.get("authed_at"),
        _parse_iso_utc(consent_doc.get("renewed_at")),
        _parse_iso_utc(consent_doc.get("expiry_date")),
    )
    return out


def plain_failure_reason(doc: dict) -> Optional[str]:
    """One plain sentence for the reconnect banner, or None when the consent
    carries no failure at all. Known codes get their own sentence, anything
    else (including a failed consent with no code) the generic one. The raw
    failure_message is never shown to the user."""
    code = doc.get("failure_code")
    if isinstance(code, str) and code:
        return FAILURE_REASONS.get(code, _GENERIC_FAILURE)
    if doc.get("status") == "failed":
        return _GENERIC_FAILURE
    return None


# ── /ops/health ───────────────────────────────────────────────────────────
def _iso(dt: Any) -> Optional[str]:
    return dt.isoformat() + "Z" if isinstance(dt, datetime) else None


async def consent_health(now: Optional[datetime] = None) -> dict:
    """Per-consent reconfirmation date, requested history start and failure
    reason. No ids or emails: the bank id (a provider slug) and dates only."""
    from app.db.collections import finexer_consents_col

    now = now or _utcnow()
    rows = []
    due_soon = 0
    async for d in finexer_consents_col.find(
        {}, {"provider": 1, "status": 1, "authed_at": 1, "renewed_at": 1, "expiry_date": 1,
             "next_reconfirm_by": 1, "retro_date_requested": 1, "failure_code": 1,
             "failure_message": 1},
    ):
        due = consent_next_reconfirm_by(d)
        if reconfirm_push_due(d, now):
            due_soon += 1
        rows.append({
            "bank": d.get("provider") or None,
            "status": d.get("status"),
            "renewed_at": _iso(d.get("renewed_at")),
            "next_reconfirm_by": _iso(due),
            "reconfirm_overdue": bool(due and d.get("status") == "authorized" and due < now),
            "history_requested_from": d.get("retro_date_requested"),
            "failure_code": d.get("failure_code"),
            "failure_message": d.get("failure_message"),
        })
    rows.sort(key=lambda r: (r["next_reconfirm_by"] is None, r["next_reconfirm_by"] or ""))
    return {
        "consents": rows[:50],
        "reconfirm_due": due_soon,
        "failed": sum(1 for r in rows if r["failure_code"] or r["status"] == "failed"),
    }

