"""B44: provider-health record for the savings-insights research step.

The weekly pass researches each category with Tavily and then writes it up
with OpenRouter. From 2026-09-16 to 2026-10-01 Tavily answered HTTP 432
(quota or plan limit) on every call, nothing was regenerated, every tip aged
past `content_valid_until` and blanked, and nothing anywhere said why. This
module is the memory that makes that outage visible and survivable:

- `classify_http_status` / `classify_exception` turn a provider failure into
  a static code (quota, auth, rate, server, timeout, client, error). Only
  the code and the numeric HTTP status are ever stored, never a response
  body, so no provider text can leak into a document or a log.
- One global document in `worker_runs` (`_id` = `savings_insights_research`)
  records the current `research_status` ("ok" | "failing"), the last error
  code and time, when the failure run began, and `skip_until`, a backoff
  that stops the pass spending calls while a quota or auth failure persists.
  The backoff lasts 24 hours, after which exactly one attempt is made, so
  recovery is automatic and costs one call a day at most.
- `status_line` is the single admin-visible sentence: "Tips research failing
  since 1 Oct (quota)".

The Tavily plan and quota are Kevin's decision and are deliberately not
touched here.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

import httpx

from app.db.collections import worker_runs_col

log = logging.getLogger(__name__)

DOC_ID = "savings_insights_research"

# How long a quota/auth/rate failure suppresses further research calls.
BACKOFF = timedelta(hours=24)

# Failures where retrying straight away is pointless or harmful.
BACKOFF_CODES = frozenset({"quota", "auth", "rate"})

_CODE_LABELS = {
    "quota": "quota",
    "auth": "authentication",
    "rate": "rate limit",
    "server": "provider error",
    "timeout": "timeout",
    "client": "request rejected",
    "error": "request error",
}


def classify_http_status(status: int) -> str:
    if status == 432:
        return "quota"
    if status in (401, 403):
        return "auth"
    if status == 429:
        return "rate"
    if 500 <= status <= 599:
        return "server"
    return "client"


def classify_exception(exc: BaseException) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    return "error"


def backoff_active(doc: Optional[dict], now: datetime) -> bool:
    skip_until = (doc or {}).get("skip_until")
    return bool(skip_until) and now < skip_until


async def load() -> Optional[dict]:
    try:
        return await worker_runs_col.find_one({"_id": DOC_ID})
    except Exception:
        log.warning("tips research health: could not read status document")
        return None


async def record_failure(code: str, http_status: Optional[int], now: datetime) -> None:
    try:
        doc = await worker_runs_col.find_one({"_id": DOC_ID}) or {}
        update: dict = {
            "research_status": "failing",
            "last_error_code": code,
            "last_http_status": http_status,
            "last_error_at": now,
            "updated_at": now,
        }
        if doc.get("research_status") != "failing" or not doc.get("failing_since"):
            update["failing_since"] = now
        if code in BACKOFF_CODES:
            update["skip_until"] = now + BACKOFF
        await worker_runs_col.update_one({"_id": DOC_ID}, {"$set": update}, upsert=True)
    except Exception:
        log.warning("tips research health: could not record failure code=%s", code)


async def record_success(now: datetime) -> None:
    try:
        await worker_runs_col.update_one(
            {"_id": DOC_ID},
            {
                "$set": {"research_status": "ok", "last_ok_at": now, "updated_at": now},
                "$unset": {"failing_since": "", "skip_until": ""},
            },
            upsert=True,
        )
    except Exception:
        log.warning("tips research health: could not record success")


def status_line(doc: Optional[dict]) -> Optional[str]:
    """The admin-visible sentence, or None while research is healthy."""
    if not doc or doc.get("research_status") != "failing":
        return None
    since = doc.get("failing_since") or doc.get("last_error_at")
    label = _CODE_LABELS.get(doc.get("last_error_code") or "", "error")
    if not since:
        return f"Tips research failing ({label})"
    return f"Tips research failing since {since.day} {since.strftime('%b')} ({label})"
