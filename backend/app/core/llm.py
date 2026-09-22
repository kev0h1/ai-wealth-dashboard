"""Shared OpenRouter chat-completions client with per-user/pipeline cost
metering.

Every one of the app's ~20 OpenRouter call sites used to POST directly to
`https://openrouter.ai/api/v1/chat/completions` with its own copy of the
same three lines (auth header, provider prefs, json body) and no visibility
into what any of it actually cost. `openrouter_chat` below is now the ONE
place that happens: it merges in `OPENROUTER_PROVIDER_PREFS` (unless a
caller already set its own `provider` key), always asks OpenRouter for
`usage.include` so the response carries `usage.cost` (USD) and
`usage.prompt_tokens_details.cached_tokens`, and — on a 200 — records those
numbers to `llm_usage_col` keyed by `user_id` and `pipeline`, via
`record_llm_usage`.

Contract, deliberately unchanged from the old per-site calls: this returns
the raw `httpx.Response`, never raises for a non-2xx, and never parses the
body. Every call site already had its own (differing) way of inspecting
`r.status_code` / `r.json()` / catching `httpx.TimeoutException` etc — this
keeps every one of those call sites' observable behaviour byte-for-byte,
it just centralises the request + metering, not the response handling.

Metering itself must never be able to turn a working LLM call into a user-
facing failure: `record_llm_usage` catches everything and logs a warning.
"""
import logging
import time
from datetime import datetime, timezone

import httpx
from fastapi import HTTPException
from pymongo import ReturnDocument

from app.core.config import (
    APP_URL, LLM_GLOBAL_MONTHLY_CALL_CEILING, OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS,
)
from app.db.collections import llm_global_usage_col, llm_usage_col

logger = logging.getLogger(__name__)

_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions"

_indexes_ready = False

# A80: same family as every other quota-exceeded signal already raised from
# service-layer code in this app (app.core.subscription's
# CONNECTION_LIMIT_REACHED/OPEN_BANKING_NOT_IN_TIER/STATEMENT_UPLOAD_LIMIT_
# REACHED, app.routers.can_i's PENNY_LIMIT_REACHED) — a plain
# `fastapi.HTTPException(402, detail={"code": ...})`, still 402 and still
# caught by ordinary `except HTTPException`/unhandled-propagates-to-FastAPI
# code everywhere. Given its own subclass (`LLMCeilingReached`, exported)
# so a caller that needs to react to THIS refusal specifically — as opposed
# to any other 402 in the app — can `except LLMCeilingReached` without
# accidentally also swallowing an unrelated HTTPException raised elsewhere
# in the same call stack (penny_agent.py's `_call_openrouter_with_retry`
# does exactly this: it must not widen its catch to every HTTPException,
# only recognise this one signal and re-raise it as `_ProviderFailure`, the
# same as a non-retryable HTTP status — see that module).
_GLOBAL_CEILING_CODE = "LLM_GLOBAL_CEILING_REACHED"


class LLMCeilingReached(HTTPException):
    """Raised by `_check_global_ceiling` when the service-wide monthly
    OpenRouter call ceiling (A80) refuses a call, either because the
    incremented counter exceeds `LLM_GLOBAL_MONTHLY_CALL_CEILING` or
    because the counter write itself failed (fail closed). A subclass of
    `HTTPException`, not a distinct exception hierarchy, so every existing
    "propagate to FastAPI, return 402" code path keeps working unchanged;
    it exists only so a caller can single this specific refusal out from
    any other 402 raised elsewhere in the same stack."""


def _global_ceiling_exception(ym: str) -> LLMCeilingReached:
    return LLMCeilingReached(
        status_code=402,
        detail={
            "code": _GLOBAL_CEILING_CODE,
            "year_month": ym,
            "ceiling": LLM_GLOBAL_MONTHLY_CALL_CEILING,
        },
    )


async def _check_global_ceiling() -> None:
    """A80 (pentest LLM-07): service-wide monthly call ceiling, on top of
    (never instead of — A81's per-user fail-open decision is untouched) the
    per-user allowances in core/subscription.py. No-op when
    `LLM_GLOBAL_MONTHLY_CALL_CEILING` is 0 (disabled, the default): no
    counter write happens at all in that case.

    When enabled, atomically increments this calendar month's counter doc
    in `llm_global_usage_col` BEFORE the request is sent, and raises
    `HTTPException` (see `_global_ceiling_exception`) without sending it if
    the incremented value exceeds the ceiling.

    Fails CLOSED, not open, unlike the per-user check this sits alongside
    (A81, a deliberate, separate decision that is not being revisited
    here): a global cost control that fails open on its own storage error
    stops being a ceiling at all, so a counter-write error here is logged
    at ERROR (not the WARNING the rest of this module's metering uses,
    since this one is not allowed to be silently harmless) and treated as
    over the ceiling.
    """
    if LLM_GLOBAL_MONTHLY_CALL_CEILING <= 0:
        return
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    try:
        doc = await llm_global_usage_col.find_one_and_update(
            {"_id": ym},
            {"$inc": {"count": 1}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        count = int((doc or {}).get("count", 0))
    except Exception:
        logger.error(
            "llm: global ceiling counter write failed for %s, refusing the call (fail closed)",
            ym, exc_info=True,
        )
        raise _global_ceiling_exception(ym)

    warn_threshold = LLM_GLOBAL_MONTHLY_CALL_CEILING * 0.8
    if count >= warn_threshold and not (doc or {}).get("warned_80"):
        try:
            flagged = await llm_global_usage_col.update_one(
                {"_id": ym, "warned_80": {"$ne": True}}, {"$set": {"warned_80": True}},
            )
            if flagged.modified_count:
                logger.warning(
                    "llm: global monthly call count %d has crossed 80%% of the %d ceiling for %s",
                    count, LLM_GLOBAL_MONTHLY_CALL_CEILING, ym,
                )
        except Exception:
            logger.warning("llm: failed to record/emit global-ceiling 80%% warning for %s", ym, exc_info=True)

    if count > LLM_GLOBAL_MONTHLY_CALL_CEILING:
        logger.error(
            "llm: global monthly call ceiling (%d) exceeded for %s (count=%d), refusing the call",
            LLM_GLOBAL_MONTHLY_CALL_CEILING, ym, count,
        )
        raise _global_ceiling_exception(ym)


async def _ensure_indexes() -> None:
    """Lazy, once-per-process index creation — mirrors the pattern other
    services in this codebase use rather than requiring a startup-only
    migration step (see app/main.py's own _create_indexes for the
    equivalent at boot). Never raises: an index that fails to build once
    should not take metering down with it, it just costs a slower query
    later."""
    global _indexes_ready
    if _indexes_ready:
        return
    _indexes_ready = True
    try:
        await llm_usage_col.create_index([("user_id", 1), ("year_month", 1)])
        await llm_usage_col.create_index([("ts", 1)])
    except Exception:
        logger.warning("llm: failed to create llm_usage indexes", exc_info=True)


async def record_llm_usage(
    *,
    user_id: str | None,
    pipeline: str,
    model: str,
    usage: dict,
    latency_ms: int,
    message_id: str | None = None,
) -> None:
    """Insert one `llm_usage_col` doc for a single completed OpenRouter
    call. `usage` is that response's own `usage` object (OpenRouter's
    `usage.include` shape) — `prompt_tokens`, `completion_tokens`, `cost`
    (USD, absent unless usage.include was set, hence the 0.0 fallback), and
    `prompt_tokens_details.cached_tokens` (Anthropic prompt-cache hits,
    absent when nothing was cached).

    `message_id` is populated ONLY for the Penny agent loop, where one user
    message can span several tool-calling rounds — each round is its own
    doc here, all sharing the message's id, so `monthly_usage` can count
    Penny MESSAGES (distinct message_id) rather than rounds while still
    summing every round's cost.

    Never raises — a metering failure must never surface as a user-facing
    error on what was otherwise a successful LLM call.
    """
    try:
        await _ensure_indexes()
        usage = usage or {}
        cached_tokens = 0
        details = usage.get("prompt_tokens_details")
        if isinstance(details, dict):
            cached_tokens = int(details.get("cached_tokens") or 0)
        now = datetime.now(timezone.utc)
        doc: dict = {
            "user_id": user_id,
            "pipeline": pipeline,
            "model": model,
            "prompt_tokens": int(usage.get("prompt_tokens") or 0),
            "cached_tokens": cached_tokens,
            "completion_tokens": int(usage.get("completion_tokens") or 0),
            "cost_usd": float(usage.get("cost") or 0.0),
            "latency_ms": int(latency_ms),
            "ts": now,
            "year_month": now.strftime("%Y-%m"),
        }
        if message_id:
            doc["message_id"] = message_id
        await llm_usage_col.insert_one(doc)
    except Exception:
        logger.warning(
            "llm: failed to record usage for pipeline=%s user=%s", pipeline, user_id, exc_info=True,
        )


async def openrouter_chat(
    body: dict,
    *,
    user_id: str | None,
    pipeline: str,
    timeout: float = 60.0,
    client: httpx.AsyncClient | None = None,
    message_id: str | None = None,
) -> httpx.Response:
    """POST `body` to OpenRouter's chat completions endpoint and meter the
    result. Returns the raw `httpx.Response` — callers keep doing exactly
    what they did before (`r.status_code`, `r.json()["choices"][...]`,
    catching `httpx.TimeoutException`/`Exception` around the call).

    `body["provider"]` is left untouched if the caller already set one;
    otherwise `OPENROUTER_PROVIDER_PREFS` is merged in, matching every
    existing call site. `body["usage"]` is ALWAYS forced to include
    `{"include": True}` (merged with anything the caller already put there)
    so `usage.cost` and `usage.prompt_tokens_details.cached_tokens` are
    always present on a 200 for `record_llm_usage` to read — no call site
    used to ask for this, so every one of them starts getting real cost
    data for free.

    If `client` is passed (some call sites already run inside their own
    `async with httpx.AsyncClient(...)` block), it is reused rather than a
    second client being opened — this changes nothing about connection
    pooling/timeouts that the caller didn't already control itself.

    A80: one deliberate exception to the "never raises" contract above —
    before anything is sent, `_check_global_ceiling` is consulted. When
    `LLM_GLOBAL_MONTHLY_CALL_CEILING` is 0 (the default) this is a no-op.
    When it is set and this call would push the service-wide monthly count
    over it (or the counter itself cannot be written), this raises
    `HTTPException(402, ...)` instead of sending the request — see that
    function's own docstring for why this one control fails closed while
    the per-user allowance next to it (A81) deliberately does not.
    """
    await _check_global_ceiling()

    payload = dict(body)
    if "provider" not in payload:
        payload["provider"] = OPENROUTER_PROVIDER_PREFS
    existing_usage = payload.get("usage")
    payload["usage"] = {**existing_usage, "include": True} if isinstance(existing_usage, dict) else {"include": True}

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": APP_URL,
        "Content-Type": "application/json",
    }

    started = time.monotonic()
    owns_client = client is None
    http_client = client if client is not None else httpx.AsyncClient(timeout=timeout)
    try:
        response = await http_client.post(_CHAT_COMPLETIONS_URL, headers=headers, json=payload)
    finally:
        if owns_client:
            await http_client.aclose()
    latency_ms = int((time.monotonic() - started) * 1000)

    if response.status_code == 200:
        try:
            data = response.json()
        except Exception:
            data = None
        if isinstance(data, dict):
            usage = data.get("usage") or {}
            model = data.get("model") or payload.get("model", "")
            await record_llm_usage(
                user_id=user_id, pipeline=pipeline, model=model, usage=usage,
                latency_ms=latency_ms, message_id=message_id,
            )

    return response


async def monthly_usage(user_id: str, year_month: str | None = None) -> dict:
    """Per-user cost/usage rollup for one calendar month (`year_month` as
    `"YYYY-MM"`, defaults to the current UTC month). Consumed by the
    /subscription surface. Shape is a contract other code depends on —
    do not change without updating every caller:

    {"year_month", "penny_messages" (distinct Penny message_id count, not
    round count), "cost_usd" (total across every pipeline), "by_pipeline":
    {pipeline: {"calls", "cost_usd", "prompt_tokens", "cached_tokens",
    "completion_tokens"}}}.
    """
    ym = year_month or datetime.now(timezone.utc).strftime("%Y-%m")
    match = {"user_id": user_id, "year_month": ym}

    by_pipeline: dict[str, dict] = {}
    total_cost = 0.0
    cursor = llm_usage_col.aggregate([
        {"$match": match},
        {"$group": {
            "_id": "$pipeline",
            "calls": {"$sum": 1},
            "cost_usd": {"$sum": "$cost_usd"},
            "prompt_tokens": {"$sum": "$prompt_tokens"},
            "cached_tokens": {"$sum": "$cached_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
        }},
    ])
    async for row in cursor:
        pipeline_name = row["_id"]
        cost = float(row.get("cost_usd") or 0.0)
        by_pipeline[pipeline_name] = {
            "calls": int(row.get("calls") or 0),
            "cost_usd": round(cost, 6),
            "prompt_tokens": int(row.get("prompt_tokens") or 0),
            "cached_tokens": int(row.get("cached_tokens") or 0),
            "completion_tokens": int(row.get("completion_tokens") or 0),
        }
        total_cost += cost

    penny_message_ids = await llm_usage_col.distinct(
        "message_id", {**match, "pipeline": "penny", "message_id": {"$ne": None}},
    )

    return {
        "year_month": ym,
        "penny_messages": len(penny_message_ids),
        "cost_usd": round(total_cost, 6),
        "by_pipeline": by_pipeline,
    }
