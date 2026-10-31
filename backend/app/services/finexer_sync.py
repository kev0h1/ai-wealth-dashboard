"""Finexer open-banking sync — HTTP Basic auth, consent-based flow."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

from app.services.sync_freshness import sync_error_code, sync_in_progress

logger = logging.getLogger(__name__)

from app.core.config import (
    FINEXER_API_KEY, FINEXER_API_URL, FINEXER_RETURN_URL, FINEXER_PROVIDERS_TTL_HOURS,
)
from app.db.collections import (
    finexer_consents_col, finexer_customers_col, finexer_providers_col,
    accounts_col, transactions_col,
)
from app.services.categorisation import rule_categorise, rule_categorise_directed, user_identity, is_own_transfer, canonical_merchant_key
from app.services.notifications import notify_after_sync
from app.services.pending_transactions import replace_pending_for_account
from app.services.derived_caches import TXN_MATERIAL_PROJECTION, mark_stale, txn_materially_changed
from pymongo import ReturnDocument


def _client() -> httpx.AsyncClient:
    """Authenticated Finexer HTTP client (HTTP Basic: key as username, empty password)."""
    return httpx.AsyncClient(
        base_url=FINEXER_API_URL,
        auth=(FINEXER_API_KEY, ""),
        timeout=30,
    )


# E2: Finexer's documented rate limit is unknown (see DEPLOY.md's "Railway
# Pro and replicas (E2)" section), so a real 429 is the ground truth. Rather
# than fail a whole sync the first time the API pushes back, this backs off
# and retries a bounded number of times before giving up on just that GET.
_MAX_429_RETRIES = 3
# Cap on how long any single sleep (whether honouring Finexer's own
# Retry-After header or our own backoff) is allowed to run — a huge or
# malformed Retry-After value must not stall a worker job anywhere near its
# 600s job_timeout (app.workers.sync_worker.WorkerSettings).
_MAX_RETRY_AFTER_SECONDS = 30.0


async def _get(
    client: httpx.AsyncClient,
    url: str,
    params: Optional[dict] = None,
    *,
    counter: Optional[dict] = None,
) -> httpx.Response:
    """GET through Finexer's rate limit.

    Counts every attempt (including retries) in `counter["requests"]` and
    every 429 seen in `counter["429s"]`, when a counter dict is passed, so
    the real per-sync request volume becomes visible (see
    sync_finexer_consent's `last_sync_requests`/`last_sync_429s` and
    GET /admin/sync-stats). `counter` is optional so callers outside a sync
    (e.g. the standalone /finexer/providers route) can skip it.

    On a 429, sleeps for the response's `Retry-After` header (falling back
    to exponential backoff if absent/unparseable, both capped at
    `_MAX_RETRY_AFTER_SECONDS`) and retries, up to `_MAX_429_RETRIES` times.
    If still 429 after the last retry, gives up and returns that response —
    the caller's existing non-200 handling takes it from there; this
    function only logs the retry/give-up, not the final failure.
    """
    attempt = 0
    resp: httpx.Response
    while True:
        if counter is not None:
            counter["requests"] = counter.get("requests", 0) + 1
        resp = await client.get(url, params=params)
        # A167: per-day API-call counter (before/after measurement).
        from app.services.finexer_webhooks import bump_daily_counters
        await bump_daily_counters(requests=1, rate_limited=1 if resp.status_code == 429 else 0)
        if resp.status_code != 429:
            return resp
        if counter is not None:
            counter["429s"] = counter.get("429s", 0) + 1
        attempt += 1
        if attempt > _MAX_429_RETRIES:
            logger.warning(
                "Finexer 429 on %s: giving up after %d retries", url, _MAX_429_RETRIES,
            )
            return resp
        retry_after = resp.headers.get("Retry-After")
        try:
            sleep_s = float(retry_after) if retry_after is not None else float(2 ** attempt)
        except (TypeError, ValueError):
            sleep_s = float(2 ** attempt)
        sleep_s = max(0.0, min(sleep_s, _MAX_RETRY_AFTER_SECONDS))
        logger.warning(
            "Finexer 429 on %s: retrying in %.1fs (attempt %d/%d)",
            url, sleep_s, attempt, _MAX_429_RETRIES,
        )
        await asyncio.sleep(sleep_s)


# ── A176: Bank Account Sync (ask Finexer to refresh from the bank) ──────────
#
# Contract known only from Kevin's reading of Finexer's API reference on
# 2026-10-31 (the reference sits behind the dashboard login, and the discovery
# GET with the key available on this host was refused with HTTP 401, so the
# real field names are NOT yet confirmed against a live response):
#   POST /bank_accounts/{id}/sync   triggers a sync with the bank. Short periods
#                                   finish at once (status "idle", synced_from
#                                   and synced_to updated); long ones return
#                                   "running" and are polled with
#   GET  /bank_accounts/{id}/sync   until "idle".
#   One POST per bank account per 60 minutes, else HTTP 429.
# The reconcile cron and webhook-driven syncs never POST (Finexer's automatic
# sync and the bank_account.synced webhook cover them, and the PSD2 four a day
# unattended limit must not be spent there). Only a user-present refresh and
# the first sync after connect do.
BANK_SYNC_MIN_GAP = timedelta(minutes=60)
# Bounded backoff while a sync reads "running": 2 + 4 + 8 + 16 = 30 seconds.
BANK_SYNC_POLL_DELAYS: tuple = (2.0, 4.0, 8.0, 16.0)
# Overall wait across one consent so many accounts cannot stall a request.
BANK_SYNC_CONSENT_BUDGET_S = 60.0

# All A176 assumptions are listed in one place for Kevin to confirm:
# docs/ops/FINEXER_TRANSACTIONS.md, "A176 assumptions to confirm".
#
# ASSUMPTION (confirm against the dashboard reference): the transactions
# endpoint's event filter is a query parameter with this name, taking the
# bank_account.synced event id. Off by default: the full walk stays the path
# until both the name and the webhook payload shape are confirmed.
TXN_EVENT_FILTER_PARAM = "event"
USE_TXN_EVENT_FILTER = False
# More pending rows than this for one account means the filter was ignored.
PENDING_MAX_ROWS = 200

_auto_sync_warned = False


def _utcnow() -> datetime:
    return datetime.utcnow()  # naive-ok: matches last_synced convention


async def _post(
    client: httpx.AsyncClient,
    url: str,
    data: Optional[dict] = None,
    *,
    counter: Optional[dict] = None,
) -> httpx.Response:
    """POST through the same counters as `_get`, with NO retry on 429.

    For the bank sync a 429 means the per-account hourly limit, so waiting
    seconds would not help: the caller records it and moves on."""
    if counter is not None:
        counter["requests"] = counter.get("requests", 0) + 1
    resp = await client.post(url, data=data)
    from app.services.finexer_webhooks import bump_daily_counters
    limited = resp.status_code == 429
    await bump_daily_counters(requests=1, rate_limited=1 if limited else 0)
    if limited and counter is not None:
        counter["429s"] = counter.get("429s", 0) + 1
    return resp


def _retry_after_delta(resp: httpx.Response) -> timedelta:
    """Retry-After (seconds) as a delta, capped at the 60-minute rule; the
    full hour when absent or unparseable."""
    try:
        secs = float(resp.headers.get("Retry-After"))
        return min(max(timedelta(seconds=secs), timedelta(0)), BANK_SYNC_MIN_GAP)
    except (TypeError, ValueError):
        return BANK_SYNC_MIN_GAP


def _sync_object(body) -> dict:
    """The sync object, tolerating a `data` envelope (shape unconfirmed)."""
    if isinstance(body, dict) and isinstance(body.get("data"), dict) and "status" not in body:
        return body["data"]
    return body if isinstance(body, dict) else {}


def _sync_fields(obj: dict) -> dict:
    """Account-doc `$set` fields from a sync object: the bank's own as-of
    window (synced_from/synced_to) and the status word."""
    fields: dict = {}
    status = obj.get("status")
    if isinstance(status, str) and status:
        fields["bank_sync_status"] = status[:40]
    frm = _parse_iso_utc(obj.get("synced_from"))
    to = _parse_iso_utc(obj.get("synced_to"))
    if frm:
        fields["bank_synced_from"] = frm
    if to:
        fields["bank_synced_to"] = to
    return fields


async def _write_account_fields(account_id: str, set_fields: dict, unset_fields: Optional[dict] = None) -> None:
    """Best effort, no upsert (the account doc may not exist yet on the very
    first sync: the caller merges the same fields into its own upsert)."""
    update: dict = {}
    if set_fields:
        update["$set"] = set_fields
    if unset_fields:
        update["$unset"] = unset_fields
    if not update:
        return
    try:
        await accounts_col.update_one({"_id": account_id}, update)
    except Exception:
        logger.exception("Finexer bank sync field write failed for %s", account_id)


async def trigger_bank_sync(
    client: httpx.AsyncClient,
    account_id: str,
    counter: Optional[dict] = None,
    *,
    now: Optional[datetime] = None,
) -> dict:
    """POST /bank_accounts/{id}/sync, honouring the 60-minute rule locally.

    Never raises for Finexer's answer and never surfaces a raw 429. Returns
    {"outcome": "requested" | "skipped_local" | "rate_limited" | "error",
     "status": <sync status or None>, "next_request_at": <naive UTC or None>,
     "set": <fields written, for the caller's own upsert>,
     "unset": <fields cleared>}."""
    now = now or _utcnow()
    try:
        doc = await accounts_col.find_one(
            {"_id": account_id}, {"bank_sync_requested_at": 1, "bank_sync_next_at": 1},
        ) or {}
    except Exception:
        doc = {}
    last = doc.get("bank_sync_requested_at")
    nxt = doc.get("bank_sync_next_at")
    next_at = None
    if isinstance(last, datetime) and now - last < BANK_SYNC_MIN_GAP:
        next_at = last + BANK_SYNC_MIN_GAP
    if isinstance(nxt, datetime) and nxt > now and (next_at is None or nxt > next_at):
        next_at = nxt
    if next_at is not None:
        return {"outcome": "skipped_local", "status": None, "next_request_at": next_at, "set": {}, "unset": {}}

    try:
        resp = await _post(client, f"/bank_accounts/{account_id}/sync", counter=counter)
    except httpx.HTTPError:
        logger.warning("Finexer POST bank sync transport error for %s", account_id)
        sets = {"bank_sync_error": "request_failed", "bank_sync_error_at": now}
        await _write_account_fields(account_id, sets)
        return {"outcome": "error", "status": None, "next_request_at": None, "set": sets, "unset": {}}

    if resp.status_code == 429:
        next_at = now + _retry_after_delta(resp)
        sets = {
            "bank_sync_last_429_at": now, "bank_sync_error": "rate_limited",
            "bank_sync_error_at": now, "bank_sync_next_at": next_at,
        }
        logger.info("Finexer bank sync rate limited for an account; next request possible later")
        await _write_account_fields(account_id, sets)
        return {"outcome": "rate_limited", "status": None, "next_request_at": next_at, "set": sets, "unset": {}}

    if resp.status_code not in (200, 201, 202):
        logger.warning("Finexer POST bank sync failed for %s: HTTP %s", account_id, resp.status_code)
        sets = {"bank_sync_error": f"http_{resp.status_code}", "bank_sync_error_at": now}
        await _write_account_fields(account_id, sets)
        return {"outcome": "error", "status": None, "next_request_at": None, "set": sets, "unset": {}}

    try:
        obj = _sync_object(resp.json())
    except ValueError:
        obj = {}
    sets = {
        "bank_sync_requested_at": now,
        "bank_sync_next_at": now + BANK_SYNC_MIN_GAP,
        **_sync_fields(obj),
    }
    unsets = {"bank_sync_error": "", "bank_sync_error_at": ""}
    await _write_account_fields(account_id, sets, unsets)
    return {
        "outcome": "requested", "status": sets.get("bank_sync_status"),
        "next_request_at": None, "set": sets, "unset": unsets,
    }


async def read_bank_sync(
    client: httpx.AsyncClient,
    account_id: str,
    counter: Optional[dict] = None,
) -> Optional[dict]:
    """GET /bank_accounts/{id}/sync and store its status and as-of window.
    Returns the `$set` fields written, or None when the read failed."""
    try:
        resp = await _get(client, f"/bank_accounts/{account_id}/sync", counter=counter)
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        logger.warning("Finexer GET bank sync failed for %s: HTTP %s", account_id, resp.status_code)
        return None
    try:
        obj = _sync_object(resp.json())
    except ValueError:
        return None
    fields = _sync_fields(obj)
    await _write_account_fields(account_id, fields)
    return fields


async def wait_bank_sync_idle(
    client: httpx.AsyncClient,
    account_id: str,
    counter: Optional[dict],
    result: dict,
    *,
    budget: Optional[dict] = None,
    sleep=None,
) -> dict:
    """Poll GET /sync with bounded backoff while `result["status"]` reads
    running. Returns when idle, when the bound or the consent-wide budget is
    hit, or when a read fails: the caller fetches anyway and the
    bank_account.synced webhook delivers the rest. `result["set"]` collects
    every field written."""
    sleep = sleep or asyncio.sleep
    status = (result.get("status") or "").lower()
    for delay in BANK_SYNC_POLL_DELAYS:
        if status != "running":
            break
        if budget is not None:
            if budget.get("remaining", 0) < delay:
                break
            budget["remaining"] = budget["remaining"] - delay
        await sleep(delay)
        fields = await read_bank_sync(client, account_id, counter)
        if fields is None:
            break
        result["set"].update(fields)
        status = (fields.get("bank_sync_status") or "").lower()
    result["status"] = status or result.get("status")
    return result


async def request_and_wait_bank_sync(
    client: httpx.AsyncClient,
    account_id: str,
    counter: Optional[dict] = None,
    *,
    budget: Optional[dict] = None,
    sleep=None,
) -> dict:
    """Trigger a bank sync and poll until idle (see `wait_bank_sync_idle`)."""
    result = await trigger_bank_sync(client, account_id, counter)
    if result["outcome"] != "requested":
        return result
    return await wait_bank_sync_idle(client, account_id, counter, result, budget=budget, sleep=sleep)


def _echoes_interval(obj: dict, hours: int) -> bool:
    try:
        return int(obj.get("auto_sync_interval")) == hours
    except (TypeError, ValueError):
        return False


def _looks_like_sync_object(obj: dict) -> bool:
    return str(obj.get("status") or "").strip().lower() in ("idle", "running")


async def ensure_auto_sync(
    client: httpx.AsyncClient,
    account_id: str,
    hours: int,
    counter: Optional[dict] = None,
    *,
    now: Optional[datetime] = None,
) -> dict:
    """Set the account's automatic sync interval (hours, 1 to 720).

    ASSUMPTION, to confirm against the dashboard reference: the note says the
    sync object carries auto_sync_interval (hours, null disables) but not the
    verb or body that sets it. This sends POST /bank_accounts/{id}/sync with
    the form field auto_sync_interval. That POST may ALSO trigger a bank sync,
    so the response is read to tell the cases apart:
      - it echoes auto_sync_interval: bank_auto_sync_hours is recorded (and
        only then, never on a bare 2xx);
      - it looks like a sync object (status idle or running): it also
        triggered a sync, so bank_sync_requested_at and the as-of window are
        stamped from it and the caller skips its own manual trigger;
      - 429: recorded like any other bank sync 429.
    The same 60-minute rule as the manual trigger applies. A 4xx is logged
    once per process and tolerated, and a failure never fails the sync.
    `hours` of 0 means off here and nothing is sent.

    Returns {"ok": bool (the interval was echoed), "triggered": bool (the
    response was a sync object), "outcome": str, "status": str | None,
    "set": fields written, for the caller's own upsert}."""
    global _auto_sync_warned
    now = now or _utcnow()
    res: dict = {"ok": False, "triggered": False, "outcome": "skipped", "status": None, "set": {}}
    if not isinstance(hours, int) or isinstance(hours, bool) or hours < 1 or hours > 720:
        return res
    try:
        doc = await accounts_col.find_one(
            {"_id": account_id},
            {"bank_sync_requested_at": 1, "bank_sync_next_at": 1, "bank_auto_sync_refused_at": 1},
        ) or {}
    except Exception:
        doc = {}
    for key in ("bank_sync_requested_at", "bank_auto_sync_refused_at"):
        last = doc.get(key)
        if isinstance(last, datetime) and now - last < BANK_SYNC_MIN_GAP:
            res["outcome"] = "skipped_local"
            return res
    nxt = doc.get("bank_sync_next_at")
    if isinstance(nxt, datetime) and nxt > now:
        res["outcome"] = "skipped_local"
        return res
    try:
        resp = await _post(
            client, f"/bank_accounts/{account_id}/sync",
            data={"auto_sync_interval": str(hours)}, counter=counter,
        )
    except httpx.HTTPError:
        logger.warning("Finexer auto sync request transport error")
        res["outcome"] = "error"
        return res
    if resp.status_code == 429:
        sets = {
            "bank_sync_last_429_at": now, "bank_sync_error": "rate_limited",
            "bank_sync_error_at": now, "bank_sync_next_at": now + _retry_after_delta(resp),
        }
        await _write_account_fields(account_id, sets)
        res.update(outcome="rate_limited", set=sets)
        return res
    if not (200 <= resp.status_code < 300):
        sets = {"bank_auto_sync_refused_at": now}
        await _write_account_fields(account_id, sets)
        res.update(outcome="refused", set=sets)
        if not _auto_sync_warned:
            _auto_sync_warned = True
            logger.warning(
                "Finexer refused the auto_sync_interval request (HTTP %s); the verb or body is an "
                "unconfirmed assumption. Continuing without it.", resp.status_code,
            )
        return res
    try:
        obj = _sync_object(resp.json())
    except ValueError:
        obj = {}
    sets: dict = {}
    unsets: dict = {}
    if _echoes_interval(obj, hours):
        sets["bank_auto_sync_hours"] = hours
        res["ok"] = True
    if _looks_like_sync_object(obj):
        sets.update({"bank_sync_requested_at": now, "bank_sync_next_at": now + BANK_SYNC_MIN_GAP, **_sync_fields(obj)})
        unsets = {"bank_sync_error": "", "bank_sync_error_at": ""}
        res["triggered"] = True
        res["status"] = sets.get("bank_sync_status")
    res["outcome"] = "accepted" if sets else "no_echo"
    res["set"] = sets
    await _write_account_fields(account_id, sets, unsets)
    return res


# H19: the provider list is effectively static reference data (the banks
# Finexer supports), so re-walking every /providers page on every consent
# sync is pure waste against the same per-minute request budget E2's
# RECONCILE_MAX_PER_MINUTE is sized against. Two layers on top of the live
# walk, both optional (a cache problem must never break a sync — same
# doctrine as app.services.response_cache / app.core.allowlist):
#   - Mongo (`finexer_providers_col`), one doc, shared by every process
#     (API + worker) and surviving restarts.
#   - An in-process memo on top, so a worker process syncing many consents
#     back to back doesn't even re-read Mongo for each one.
_PROVIDERS_MAX_TIME_MS = 3000
_providers_memo: Optional[dict] = None  # {"providers": [...], "fetched_at": datetime}


def _providers_fresh(fetched_at, ttl_hours: float) -> bool:
    if not isinstance(fetched_at, datetime):
        return False
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - fetched_at < timedelta(hours=ttl_hours)


async def list_providers(counter: Optional[dict] = None, *, force: bool = False) -> list[dict]:
    """Return all AIS-capable providers from GET /providers (paginated),
    cached for FINEXER_PROVIDERS_TTL_HOURS (default 24h) so a normal call
    costs nothing beyond a memo/Mongo lookup — see the cache-layer comment
    above.

    `counter`: optional request/429 tally shared with the calling sync (see
    `_get`'s docstring) — passed through by sync_finexer_consent since this
    opens its own client but still counts against the same sync's Finexer
    request budget. None for standalone callers (e.g. the providers route).
    A cache hit (memo or Mongo) makes zero Finexer requests, so `counter` is
    left untouched; only a real walk increments it, exactly as before.

    `force`: skip both cache layers and walk the API regardless of freshness
    (used by the admin refresh endpoint only — see
    app/routers/admin_usage.py's POST /admin/finexer/providers/refresh).
    Even when forced, a STALE cached doc is still read up front so a failed
    forced walk still has something to fall back to.

    Correctness rules: a walk that hit a non-200 partway through is NEVER
    written to the cache (a partial list would poison it for the full TTL
    on a Finexer outage). If the walk fails (or comes back empty) and a
    stale cached doc exists, that stale list is returned and logged at
    WARNING rather than an empty result — slightly old reference data beats
    losing the sync's account/provider names entirely.
    """
    global _providers_memo

    if not force and _providers_memo is not None and _providers_fresh(
        _providers_memo["fetched_at"], FINEXER_PROVIDERS_TTL_HOURS
    ):
        return list(_providers_memo["providers"])

    cached_doc = None
    try:
        cached_doc = await finexer_providers_col.find_one(
            {"_id": "providers"}, max_time_ms=_PROVIDERS_MAX_TIME_MS,
        )
    except Exception:
        logger.exception("list_providers: Mongo read failed, falling through to a live walk")
        cached_doc = None

    if not force and cached_doc is not None and _providers_fresh(
        cached_doc.get("fetched_at"), FINEXER_PROVIDERS_TTL_HOURS
    ):
        providers = list(cached_doc.get("providers") or [])
        _providers_memo = {"providers": providers, "fetched_at": cached_doc.get("fetched_at")}
        return providers

    # Cache miss (or forced refresh): walk the API for real.
    providers = []
    offset = 0
    walk_ok = True
    async with _client() as client:
        while True:
            r = await _get(client, "/providers", params={"offset": offset}, counter=counter)
            if r.status_code != 200:
                logger.warning("Finexer /providers failed: HTTP %s (upstream error)", r.status_code)
                logger.debug("Finexer /providers failed body: %.400s", r.text)
                walk_ok = False
                break
            data = r.json()
            items = data.get("data") or []
            for p in items:
                if "ais" in (p.get("roles") or []):
                    providers.append({
                        "id":       p["id"],
                        "name":     p.get("name", p["id"]),
                        "logo":     p.get("logo_url", ""),
                        "bg_colors": p.get("bg_colors") or [],
                    })
            paging = data.get("paging") or {}
            if not paging.get("next"):
                break
            offset += len(items)
            if not items:
                break

    if walk_ok and providers:
        now = datetime.now(timezone.utc)
        try:
            await finexer_providers_col.replace_one(
                {"_id": "providers"},
                {"_id": "providers", "providers": providers, "fetched_at": now, "count": len(providers)},
                upsert=True,
            )
        except Exception:
            logger.exception("list_providers: Mongo write failed, continuing with the fresh in-memory list")
        _providers_memo = {"providers": providers, "fetched_at": now}
        return providers

    # Walk failed (or came back empty) — serve stale cached data rather than
    # an empty list, if we have any.
    stale_providers = list((cached_doc or {}).get("providers") or [])
    if stale_providers:
        logger.warning(
            "list_providers: live walk %s, serving %d stale cached providers instead",
            "failed" if not walk_ok else "returned no ais providers", len(stale_providers),
        )
        return stale_providers

    return providers


async def get_or_create_customer(user: dict) -> str:
    """Look up or create a Finexer customer record for this app user."""
    user_id = user["email"]
    doc = await finexer_customers_col.find_one({"_id": user_id})
    if doc:
        return doc["customer_id"]

    name  = user.get("name") or user["email"]
    email = user["email"]
    async with _client() as client:
        r = await client.post(
            "/customers",
            data={
                "name":             name,
                "email":            email,
                "metadata[app_user]": email,
            },
        )
        if r.status_code not in (200, 201):
            logger.error("Finexer POST /customers failed: HTTP %s (upstream error)", r.status_code)
            logger.debug("Finexer POST /customers failed body: %.400s", r.text)
            raise RuntimeError(f"Finexer customer creation failed: {r.status_code}")
        customer = r.json()
        customer_id = customer["id"]

    await finexer_customers_col.update_one(
        {"_id": user_id},
        {"$set": {"customer_id": customer_id, "created_at": datetime.utcnow()}},
        upsert=True,
    )
    return customer_id


async def create_consent(
    user_id: str,
    customer_id: str,
    provider: Optional[str],
    state: str,
) -> dict:
    """Create a Finexer consent and return the full consent dict."""
    return_url = f"{FINEXER_RETURN_URL}?state={state}"
    data: dict = {
        "customer":   customer_id,
        "return_url": return_url,
    }
    if provider:
        data["provider"] = provider

    async with _client() as client:
        r = await client.post("/consents", data=data)
        if r.status_code not in (200, 201):
            logger.error("Finexer POST /consents failed: HTTP %s (upstream error)", r.status_code)
            logger.debug("Finexer POST /consents failed body: %.400s", r.text)
            raise RuntimeError(f"Finexer consent creation failed: {r.status_code}")
        return r.json()


def _infer_transaction_type(txn: dict) -> str:
    """Infer 'credit' or 'debit' from amount sign or a type field."""
    # Finexer field names not yet confirmed — check common candidates defensively
    txn_type = (txn.get("type") or txn.get("transaction_type") or "").lower()
    if txn_type in ("credit", "debit"):
        return txn_type
    amount = txn.get("amount", 0)
    try:
        return "credit" if float(amount) > 0 else "debit"
    except (TypeError, ValueError):
        return "debit"


def _parse_iso_utc(s) -> Optional[datetime]:
    """Parse an ISO 8601 timestamp (optionally trailing 'Z') to a NAIVE UTC
    datetime, matching this codebase's convention of storing naive UTC in
    Mongo. Returns None if absent or unparseable."""
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


def _parse_date(txn: dict) -> datetime:
    """Parse transaction date from possible field names."""
    raw = (
        txn.get("date")
        or txn.get("timestamp")
        or txn.get("created_at")
        or txn.get("booking_date")
        or txn.get("value_date")
    )
    if not raw:
        return datetime.utcnow()
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return datetime.utcnow()


async def _upsert_finexer_transactions(
    txns: list,
    account_id: str,
    user_id: str,
    identity: dict | None = None,
) -> tuple[list, list]:
    """Walk and upsert (see `_upsert_finexer_walk`); G177: if the walk raises
    part way, rows already written still mark the cashflow cache stale."""
    state = {"changed": False}
    try:
        return await _upsert_finexer_walk(txns, account_id, user_id, identity, state)
    finally:
        if state["changed"]:
            await mark_stale(user_id)


async def _upsert_finexer_walk(
    txns: list,
    account_id: str,
    user_id: str,
    identity: dict | None,
    state: dict,
) -> tuple[list, list]:
    """Upsert SETTLED transactions into unified transactions_col; a row whose
    `status` field (UK Open Banking "Booked"/"Pending") reads "pending" is
    routed to the sibling pending collection instead — see
    app/services/pending_transactions.py's module docstring for why it must
    never enter transactions_col (recurring detection/categorisation
    learning/spend history would all treat a provisional debit as real).
    Any other/absent status (e.g. "booked") takes the existing settled path
    unchanged. Returns (new_txn_summaries, pending_rows) — `pending_rows` is
    the normalised shape `replace_pending_for_account` expects."""
    new_txns = []
    pending_rows = []
    for txn in txns:
        # Defensive field mapping — exact names TBD until first sandbox login
        txn_id = (
            txn.get("id")
            or txn.get("transaction_id")
            or txn.get("reference")
        )
        if not txn_id:
            logger.warning("Finexer transaction missing id: %s", txn)
            continue

        description  = txn.get("description") or txn.get("reference") or txn.get("narrative") or ""
        merchant     = txn.get("merchant_name") or txn.get("merchant") or txn.get("counterparty_name") or ""

        if (txn.get("status") or "").strip().lower() == "pending":
            pending_rows.append({
                "transaction_id":   txn_id,
                "date":             _parse_date(txn),
                "amount":           txn.get("amount", 0),
                "description":      description,
                "merchant_name":    merchant,
                "transaction_type": _infer_transaction_type(txn),
            })
            continue

        raw_amount   = txn.get("amount", 0)
        try:
            amount = abs(float(raw_amount))
        except (TypeError, ValueError):
            amount = 0.0
        currency = (txn.get("currency") or "GBP").upper()
        txn_type = _infer_transaction_type(txn)
        running_balance = txn.get("balance")

        is_credit = txn_type == "credit"
        if is_credit:
            # Incoming money: try user rules first, then identity corroboration.
            # A credit whose description carries the user's OWN name is their own
            # transfer (e.g. "From Kevin Maingi"), not income. Peer payments don't
            # carry the owner's name, so the peer-payment trap (untrusted raw TRANSFER
            # tags) is unaffected.
            category = rule_categorise_directed(merchant, description, is_credit=True) or (
                "Transfer" if identity is not None and is_own_transfer(f"{merchant} {description}", identity, own_account_id=account_id)
                else "Income"
            )
        else:
            category = rule_categorise(merchant, description) or None

        tdoc: dict = {
            "account_id":       account_id,
            "user_id":          user_id,
            "date":             _parse_date(txn),
            "amount":           amount,
            "currency":         currency,
            "description":      description,
            "merchant_name":    merchant or None,
            "category":         category,
            "transaction_type": txn_type,
            "provider":         "Finexer",
            "merchant_key":     canonical_merchant_key(merchant, description),
        }
        if running_balance is not None:
            try:
                tdoc["running_balance"] = float(running_balance)
            except (TypeError, ValueError):
                pass

        # BEFORE image (None on insert) so a material update to an existing
        # row is told apart from a no-op re-pull (G177).
        before = await transactions_col.find_one_and_update(
            {"_id": txn_id},
            {"$set": tdoc, "$setOnInsert": {"_id": txn_id, "custom_category": None}},
            upsert=True,
            projection=TXN_MATERIAL_PROJECTION,
            return_document=ReturnDocument.BEFORE,
        )
        if txn_materially_changed(before, tdoc):
            state["changed"] = True
        if before is None:
            new_txns.append({
                "description":   description,
                "merchant_name": merchant or None,
                "amount":        amount,
                "currency":      currency,
            })
    return new_txns, pending_rows


async def _mark_finexer_accounts_expired(consent_id: str) -> None:
    """Flag every account on this consent so the existing "needs reconnecting"
    banner fires (the UI reads status), mirroring truelayer_sync.py."""
    await accounts_col.update_many(
        {"connection_id": consent_id},
        {"$set": {"status": "expired"}},
    )


def _carry_params(next_url: str, params: Optional[dict]) -> str:
    """A `paging.next` path may drop the query filters of the first page, so
    re-add any that are missing (status=pending must survive paging). The
    query is parsed, not substring-matched."""
    if not params:
        return next_url
    parts = urlsplit(next_url)
    query = parse_qsl(parts.query, keep_blank_values=True)
    present = {k for k, _ in query}
    missing = [(k, str(v)) for k, v in params.items() if k not in present]
    if not missing:
        return next_url
    return urlunsplit(parts._replace(query=urlencode(query + missing)))


async def _walk_transactions(
    client: httpx.AsyncClient,
    account_id: str,
    user_id: str,
    identity: Optional[dict],
    counter: Optional[dict],
    *,
    params: Optional[dict] = None,
    force_pending: bool = False,
) -> dict:
    """Page through GET /bank_accounts/{id}/transactions.

    `force_pending` is for the status=pending fetch: a row whose status is
    absent or already pending is treated as pending, so it can never be written
    into the settled collection. A row with any other explicit status (booked,
    settled) is dropped and counted, never forced. Returns
    {"ok", "rows", "new", "pending", "dropped"};
    on a non-200 `ok` is False and the caller must not wipe stored state."""
    url: Optional[str] = f"/bank_accounts/{account_id}/transactions"
    first_page = True
    first_txn_logged = False
    out = {"ok": True, "rows": 0, "new": [], "pending": [], "dropped": 0}
    while url:
        tr = await _get(client, url, params if first_page else None, counter=counter)
        first_page = False
        if tr.status_code != 200:
            logger.warning("Finexer transactions failed for %s: HTTP %s", account_id, tr.status_code)
            out["ok"] = False
            break
        txn_data = tr.json()
        txns = txn_data.get("data") or txn_data.get("results") or []
        out["rows"] += len(txns)
        if txns and not first_txn_logged and not force_pending:
            logger.info("FINEXER raw first transaction JSON for account %s: %s", account_id, txns[0])
            first_txn_logged = True
        if force_pending:
            kept = []
            for t in txns:
                if not isinstance(t, dict):
                    continue
                st = str(t.get("status") or "").strip().lower()
                if st in ("", "pending"):
                    kept.append({**t, "status": "pending"})
                else:
                    out["dropped"] += 1
            txns = kept
        new, pending_rows = await _upsert_finexer_transactions(txns, account_id, user_id, identity=identity)
        out["new"].extend(new)
        out["pending"].extend(pending_rows)
        next_url = (txn_data.get("paging") or {}).get("next")
        url = _carry_params(next_url, params) if next_url else None
    return out


async def sync_finexer_consent(
    consent_id: str,
    user_id: str,
    *,
    request_bank_sync: bool = False,
    event_id: Optional[str] = None,
    event_account_id: Optional[str] = None,
) -> tuple[list, int]:
    """
    Sync all accounts and transactions for one Finexer consent.
    Returns (account_ids_fetched, new_txn_count).

    A176: `request_bank_sync` asks Finexer to refresh each account from the
    bank first (POST /bank_accounts/{id}/sync, polled until idle within a
    bound). It is explicit and False by default: only a user-present refresh
    and the first sync after connect set it. The reconcile cron and
    webhook-driven syncs leave it off. `event_id` and `event_account_id` (a
    bank_account.synced event) narrow that one account's booked walk when
    USE_TXN_EVENT_FILTER is on; any failure falls back to the full walk.
    """
    # ── Guard: do not sync a consent that was locally deleted/revoked ────────
    local_consent = await finexer_consents_col.find_one({"_id": consent_id})
    if not local_consent or local_consent.get("status") != "authorized":
        logger.info(
            "Finexer consent %s is absent or non-authorized locally (status=%s) — skipping sync",
            consent_id,
            (local_consent or {}).get("status"),
        )
        return [], 0

    # Build exclusion set: consent-level exclusions ∪ user-level excluded_accounts
    from app.db.collections import excluded_accounts_col as _excl_col
    is_initial_sync = not local_consent.get("last_synced")
    consent_excluded: set[str] = set(local_consent.get("excluded_accounts") or [])
    user_excluded: set[str] = {
        d["account_id"]
        async for d in _excl_col.find({"user_id": user_id}, {"account_id": 1})
    }

    all_new_txns: list = []
    fetched_account_ids: list = []
    identity = await user_identity(user_id)
    # E2: tallies every HTTP request (incl. 429 retries) this sync makes
    # against Finexer, so the true per-connection request volume is
    # observable (see `_get`, `last_sync_requests`/`last_sync_429s` below,
    # and GET /admin/sync-stats).
    counter: dict = {"requests": 0, "429s": 0}
    bank_sync_budget: dict = {"remaining": BANK_SYNC_CONSENT_BUDGET_S}
    from app.services import runtime_settings
    try:
        auto_sync_hours = int(await runtime_settings.asetting("FINEXER_AUTO_SYNC_HOURS"))
    except Exception:
        auto_sync_hours = 6

    async with _client() as client:
        # Verify consent status remotely
        cr = await _get(client, f"/consents/{consent_id}", counter=counter)
        if cr.status_code == 200:
            consent_doc = cr.json()
            remote_status = consent_doc.get("status")
            # Always persist what the remote told us, even when we're about
            # to bail below — a stale local "authorized" must not linger.
            update_fields = {
                "status":      remote_status,
                "expiry_date": _parse_iso_utc(consent_doc.get("expiry_date")),
                "renewed_at":  _parse_iso_utc(consent_doc.get("renewed_at")),
            }
            # Stamp the moment the status actually changed away from
            # "authorized" (local_consent was verified authorized above), so
            # the retention sweep (app.services.retention) has a timestamp to
            # measure the 30-day grace period from.
            if remote_status != local_consent.get("status"):
                update_fields["status_changed_at"] = datetime.utcnow()
            if remote_status != "authorized":
                # This is the sync's final Finexer call — record the true
                # totals now rather than leaving them stale from a previous run.
                update_fields["last_sync_requests"] = counter["requests"]
                update_fields["last_sync_429s"] = counter["429s"]
            await finexer_consents_col.update_one(
                {"_id": consent_id},
                {"$set": update_fields},
            )
            if remote_status != "authorized":
                logger.warning(
                    "Finexer consent %s status is %s, marking its accounts expired",
                    consent_id, remote_status,
                )
                await _mark_finexer_accounts_expired(consent_id)
                return [], 0
        elif cr.status_code in (401, 403, 404):
            # Consent is gone remotely: revoke locally and flag its accounts.
            logger.warning(
                "Finexer consent %s no longer exists remotely (HTTP %s), marking revoked",
                consent_id, cr.status_code,
            )
            await finexer_consents_col.update_one(
                {"_id": consent_id},
                # status_changed_at: see the retention-sweep note above.
                # This is the sync's final Finexer call — record the true
                # totals, same as the not-authorized branch above.
                {"$set": {
                    "status": "revoked", "status_changed_at": datetime.utcnow(),
                    "last_sync_requests": counter["requests"], "last_sync_429s": counter["429s"],
                }},
            )
            await _mark_finexer_accounts_expired(consent_id)
            return [], 0
        else:
            # Transient/server error: leave local state untouched, retry next run.
            logger.error("Finexer GET /consents/%s failed: HTTP %s", consent_id, cr.status_code)
            return [], 0

        # Fetch accounts
        ar = await _get(client, "/bank_accounts", params={"consent": consent_id}, counter=counter)
        if ar.status_code != 200:
            logger.error("Finexer GET /bank_accounts failed: HTTP %s (upstream error)", ar.status_code)
            logger.debug("Finexer GET /bank_accounts failed body: %.400s", ar.text)
            return [], 0

        acc_data = ar.json()
        accounts = acc_data.get("data") or acc_data.get("results") or []

        # Log raw shape of first account for field discovery
        if accounts:
            logger.info("FINEXER raw first account JSON: %s", accounts[0])

        # Build provider info map once (id → full provider dict with name, logo, bg_colors)
        provs = await list_providers(counter=counter)
        prov_map = {p["id"]: p for p in provs}

        for acc in accounts:
            account_id = acc.get("id")
            if not account_id:
                logger.warning("Finexer account missing id: %s", acc)
                continue
            if account_id in consent_excluded:
                logger.info("Finexer: skipping consent-excluded account %s for consent %s", account_id, consent_id)
                continue
            if account_id in user_excluded:
                if is_initial_sync:
                    # Reconnect wins: a freshly authorized consent is the user
                    # explicitly asking for these accounts. Account ids are
                    # stable across consents, so this row is a stale guard from
                    # a source that no longer exists — clear it and sync.
                    await _excl_col.delete_many({"user_id": user_id, "account_id": account_id})
                    user_excluded.discard(account_id)
                    logger.info(
                        "Finexer reconnect-wins: cleared stale user-level exclusion for %s (new consent %s)",
                        account_id, consent_id,
                    )
                else:
                    logger.info("Finexer: skipping user-excluded account %s for consent %s", account_id, consent_id)
                    continue

            name = acc.get("nickname") or acc.get("holder_name") or "Account"

            acc_class = (acc.get("class") or "").lower()
            if acc_class == "credit_card":
                acc_type = "credit_card"
                subtype  = "CREDIT_CARD"
            elif "saving" in acc_class:
                acc_type = "bank"
                subtype  = "SAVINGS"
            else:
                acc_type = "bank"
                subtype  = "TRANSACTION"

            ident = acc.get("identification") or {}
            account_number = (
                ident.get("account_number")
                or ident.get("number")
                or ident.get("pan")
                or ident.get("iban")
            )
            sort_code = ident.get("sort_code")

            provider_code = acc.get("provider")
            pinfo = prov_map.get(provider_code) or {}
            provider_name = pinfo.get("name") or (provider_code or "Bank").replace("_", " ").title()

            currency = (acc.get("currency") or "GBP").upper()

            # A176: ask Finexer to refresh this account from the bank first, so
            # the balance and transactions below are the bank's current ones.
            bank_sync_set: dict = {}
            sync_current = False  # this pass already holds a fresh sync object
            setter_triggered = False
            # First consent sync: switch on Finexer's automatic sync FIRST. The
            # setter is a POST to the same path as the manual trigger and may
            # itself trigger a sync, in which case the manual trigger is
            # skipped for this account (one POST, not two within seconds).
            if is_initial_sync and auto_sync_hours:
                try:
                    au = await ensure_auto_sync(client, account_id, auto_sync_hours, counter)
                    bank_sync_set.update(au.get("set") or {})
                    if au.get("triggered"):
                        setter_triggered = True
                        await wait_bank_sync_idle(
                            client, account_id, counter,
                            {"status": au.get("status"), "set": bank_sync_set}, budget=bank_sync_budget,
                        )
                        sync_current = True
                except Exception:
                    logger.exception("Finexer auto sync setup failed for an account; continuing")
            if request_bank_sync and not setter_triggered:
                try:
                    bs = await request_and_wait_bank_sync(client, account_id, counter, budget=bank_sync_budget)
                    bank_sync_set.update(bs.get("set") or {})
                    sync_current = bs.get("outcome") == "requested" and (bs.get("status") or "") != "running"
                except Exception:
                    logger.exception("Finexer bank sync request failed for an account; continuing")

            # Fetch balance via dedicated endpoint
            balance: float = 0.0
            available = None
            br = await _get(client, f"/bank_accounts/{account_id}/balance", counter=counter)
            if br.status_code == 200:
                bal_data = br.json()
                bal_entries = bal_data.get("data") or []
                chosen = next((e for e in bal_entries if e.get("type") == "actual"), None)
                if chosen is None and bal_entries:
                    chosen = bal_entries[0]
                if chosen:
                    try:
                        balance = float(chosen.get("current") or 0.0)
                    except (TypeError, ValueError):
                        balance = 0.0
                    try:
                        available = float(chosen["available"]) if chosen.get("available") is not None else None
                    except (TypeError, ValueError):
                        available = None
            else:
                logger.warning(
                    "Finexer GET /bank_accounts/%s/balance failed: HTTP %s",
                    account_id, br.status_code,
                )

            set_doc: dict = {
                "name":           name,
                "type":           acc_type,
                "subtype":        subtype,
                "balance":        balance,
                "currency":       currency,
                "provider":       provider_name,
                "provider_id":    provider_code,
                "connection_id":  consent_id,
                "status":         "connected",
                "account_number": account_number,
                "sort_code":      sort_code,
                "finexer":        True,
                "source":         "finexer",
                "logo_url":       pinfo.get("logo") or None,
                "bg_colors":      pinfo.get("bg_colors") or [],
                "updated_at":     datetime.utcnow(),
            }
            if available is not None:
                set_doc["available"] = available
            set_doc.update(bank_sync_set)

            await accounts_col.update_one(
                {"_id": account_id},
                {
                    "$set": set_doc,
                    "$setOnInsert": {
                        "_id":     account_id,
                        "user_id": user_id,
                    },
                },
                upsert=True,
            )
            fetched_account_ids.append(account_id)

            # Fetch transactions (paginated). A bank_account.synced event may
            # narrow this account's booked walk (off by default, see
            # USE_TXN_EVENT_FILTER); a failed filtered walk falls back to full.
            filtered = bool(USE_TXN_EVENT_FILTER and event_id and event_account_id == account_id)
            booked = None
            if filtered:
                booked = await _walk_transactions(
                    client, account_id, user_id, identity, counter,
                    params={TXN_EVENT_FILTER_PARAM: event_id},
                )
                if not booked["ok"]:
                    filtered = False
                    booked = None
            if booked is None:
                booked = await _walk_transactions(client, account_id, user_id, identity, counter)
            fetch_failed = not booked["ok"]
            walk_row_count = booked["rows"]
            all_new_txns.extend(booked["new"])

            # A176: pending rows come from GET ...?status=pending (the default
            # is booked only), merged with any pending rows the booked list
            # carried, de-duplicated on transaction id.
            pending_failed = False
            merged_pending: dict = {}
            if not fetch_failed:
                for row in booked["pending"]:
                    merged_pending[row.get("transaction_id") or row.get("id")] = row
                try:
                    pend = await _walk_transactions(
                        client, account_id, user_id, identity, counter,
                        params={"status": "pending"}, force_pending=True,
                    )
                except (httpx.HTTPError, ValueError):
                    logger.warning("Finexer pending walk failed for an account; keeping its stored pending set")
                    pend = {"ok": False}
                if pend["ok"] and pend["dropped"]:
                    logger.warning(
                        "Finexer pending walk dropped %d row(s) with an explicit booked status for an account",
                        pend["dropped"],
                    )
                if pend["ok"] and pend["rows"] > PENDING_MAX_ROWS:
                    # A pending list this long means the status filter was
                    # ignored (it is a booked list). Treat it as a failure.
                    logger.warning(
                        "Finexer pending walk returned %d rows for one account (over %d); treating as a filter failure",
                        pend["rows"], PENDING_MAX_ROWS,
                    )
                    pend = {"ok": False}
                if pend["ok"]:
                    for row in pend["pending"]:
                        merged_pending.setdefault(row.get("transaction_id") or row.get("id"), row)
                    walk_row_count += pend["rows"]
                else:
                    pending_failed = True

            # Bank-side PENDING transactions (see app/services/
            # pending_transactions.py). The set is replaced wholesale, so it
            # is only replaced when BOTH walks succeeded: a failure partway
            # through must never wipe a genuinely pending set already stored
            # (same "never overwrite a known good value with a failure" rule
            # as the balance fetch above). A filtered booked walk is partial
            # for booked rows only; pending comes from its own full fetch.
            if not fetch_failed and not pending_failed:
                await replace_pending_for_account(list(merged_pending.values()), account_id, user_id, provider="Finexer")

            # A176 (F1): in EVERY sync path, read the sync object once after the
            # walk (a GET, no documented hourly limit) so bank_synced_to tracks
            # the bank's own freshness and not just the last manual refresh.
            # Skipped only when this pass already read a fresh idle one.
            if not sync_current:
                try:
                    await read_bank_sync(client, account_id, counter)
                except Exception:
                    logger.exception("Finexer bank sync read failed for an account; continuing")

            # A175: per-account transaction sync diagnostics. A 200 with no
            # rows used to leave no trace at all, so the account sheet could
            # not tell "the bank sent nothing" from "we never looked".
            # Success fields are only ever written on a successful walk, and
            # a failure leaves the last known good values untouched.
            if fetch_failed:
                diag_set = {"transactions_fetch_failed_at": datetime.utcnow()}  # naive-ok: matches last_synced convention
            else:
                diag_set = {"transactions_synced_at": datetime.utcnow()}  # naive-ok: matches last_synced convention
                if not filtered:
                    # A filtered walk only saw newly imported rows, so its
                    # count says nothing about whether the bank sent history.
                    diag_set["transactions_last_count"] = walk_row_count
                if walk_row_count == 0 and balance and not filtered:
                    logger.info(
                        "Finexer returned no transactions for a %s account with a non-zero balance (consent %s)",
                        acc_class or "unknown", consent_id,
                    )
            try:
                await accounts_col.update_one({"_id": account_id}, {"$set": diag_set})
            except Exception:
                logger.exception("Finexer transaction diagnostics write failed for %s", account_id)

    # A renewed consent should clear the "needs reconnecting" banner on the
    # accounts we just fetched. Unlike truelayer_sync.py, there is no inverse
    # sweep here (unfetched accounts on this consent are left alone).
    if fetched_account_ids:
        await accounts_col.update_many(
            {"_id": {"$in": fetched_account_ids}},
            {"$set": {"status": "connected"}},
        )

    # Update last_synced on the consent record, alongside this sync's true
    # Finexer request volume (E2 — see `_get`'s docstring).
    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {
            "last_synced": datetime.utcnow(),
            "last_sync_requests": counter["requests"],
            "last_sync_429s": counter["429s"],
        }, "$unset": {"last_sync_error": "", "last_sync_error_at": ""}},
    )

    return fetched_account_ids, len(all_new_txns)


async def finexer_sync_pipeline(
    consent_id: str,
    user_id: str,
    *,
    trigger: str = "auto",
    recompute: bool = True,
    request_bank_sync: bool = False,
    event_id: Optional[str] = None,
    event_account_id: Optional[str] = None,
) -> dict:
    """
    Full sync pipeline: sync consent → post-sync rules → notifications.
    Called from the OAuth callback (asyncio.create_task), the arq worker,
    and POST /accounts/sync.

    `trigger` is the G159 distinction (see app.services.derived_caches):
    "auto" (default: callback, worker reconcile, webhook) recomputes the
    derived caches only when this pull found new transactions or the cache
    doc is stale for a cheaper reason; "user" always recomputes.
    `recompute=False` leaves the recompute to the caller entirely, which is
    how POST /accounts/sync runs ONE recompute after every source has
    pulled rather than one per Finexer consent racing its own.

    A176: `request_bank_sync` is the explicit choice to ask Finexer to refresh
    from the bank first. POST /accounts/sync (trigger="user") and the first
    sync after the OAuth callback pass True; the worker's reconcile and
    webhook syncs keep the default False. `event_id`/`event_account_id` are
    passed on to sync_finexer_consent (see there).
    """
    from app.services.categorisation import apply_rules_bulk, categorise_others_bg
    from app.services.manual_account_rules import apply_rules as apply_mirror_rules

    try:
        async with sync_in_progress(finexer_consents_col, consent_id):
            fetched_ids, new_count = await sync_finexer_consent(
                consent_id, user_id, request_bank_sync=request_bank_sync,
                event_id=event_id, event_account_id=event_account_id,
            )
    except Exception as exc:
        logger.exception("finexer_sync_pipeline failed for consent %s user %s", consent_id, user_id)
        try:
            await finexer_consents_col.update_one(
                {"_id": consent_id},
                {"$set": {
                    "last_sync_error": sync_error_code(exc),
                    "last_sync_error_at": datetime.utcnow(),  # naive-ok: matches last_synced convention
                }},
            )
        except Exception:
            logger.exception("could not stamp last_sync_error for consent %s", consent_id)
        return {"ok": False, "error": "sync_failed"}

    await apply_rules_bulk(user_id, structural=True)
    await categorise_others_bg(user_id)
    await apply_mirror_rules(user_id)

    if recompute:
        from app.services.derived_caches import recompute_derived_caches
        await recompute_derived_caches(user_id, new_count=new_count, trigger=trigger)
    if new_count > 0:
        asyncio.create_task(notify_after_sync(user_id, []))

    return {"ok": True, "accounts": len(fetched_ids), "new_transactions": new_count}
