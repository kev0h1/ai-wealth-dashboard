"""Post-sync cache warm-up — precompute the heavy Home/Penny/Spend/Grow/
Commitments responses right after a sync so the NEXT page open reads a warm
`app.services.response_cache` entry instead of recomputing cold.

Called from every sync task in `app.workers.sync_worker` (so the 4-hourly
reconcile cron and every webhook-triggered sync warm the API's cache even
though they run in the WORKER process), and from the API's own
`POST /accounts/sync` (`app.routers.accounts.sync_all`) so an in-app sync
warms too.

Each of the six steps below is independently wrapped: one broken
computation must never stop the rest from warming, and must never surface
to the sync task that called `warm_user`.

The six `_compute_*` helpers are deliberately thin, MODULE-LEVEL functions
(not inlined into `_warm_user_impl`, not imported lazily inside it) so a
test can monkeypatch `warmup._compute_today` etc. directly — the same
monkeypatch-at-the-source-module convention this codebase's other DB-free
unit tests already use (see tests/test_grow.py's own docstring). The actual
DB-touching imports inside each one stay LAZY, matching
app.workers.sync_worker's own convention, to keep this module cheap to
import from both the worker and the API.
"""
import asyncio
import logging
import time

from app.services import data_version, response_cache

logger = logging.getLogger(__name__)


async def _compute_today(uid: str) -> dict:
    from app.services.companion import compute_today_items
    items = await compute_today_items(uid, payday_preview=False)
    return {"status": "ok", "items": items}


async def _compute_safe_to_spend(uid: str) -> dict:
    # Shared with GET /safe-to-spend (app.routers.analytics.get_safe_to_spend)
    # so the two call sites can never drift on this endpoint's shape.
    from app.routers.analytics import build_safe_to_spend_response
    return await build_safe_to_spend_response(uid, include_series=False)


async def _compute_spend_verdict(uid: str) -> dict:
    from app.services.spend_verdict import compute_spend_verdict
    return await compute_spend_verdict(uid, offset=0)


async def _compute_miscategorised_count(uid: str) -> dict:
    # Calls the router function directly (bypassing FastAPI's Depends), the
    # same pattern tests/test_grow.py uses to drive grow_view — reuses its
    # exact guardrail logic (including its OWN version-pinned aget/aput)
    # rather than re-deriving it here.
    from app.routers.analytics import get_miscategorised_count
    return await get_miscategorised_count(offset=0, user={"email": uid})


async def _compute_grow(uid: str) -> dict:
    from app.routers.grow import grow_view
    return await grow_view({"email": uid})


async def _compute_commitments(uid: str) -> dict:
    from app.routers.commitments import list_commitments
    return await list_commitments({"email": uid})


# Per-uid in-flight tasks for warm_user's single-flight guard (see warm_user's
# own docstring) — a plain module-level dict is safe here with no lock: every
# access below is a synchronous dict get/set with no `await` in between, and
# asyncio only runs one coroutine at a time, so there's no interleaving
# window for two callers to both miss and both start a second task.
_inflight: dict[str, "asyncio.Task"] = {}


async def warm_user(uid: str) -> dict:
    """Single-flight wrapper around `_warm_user_impl`: multiple bank
    connections syncing for the same user can each enqueue their own
    post-sync warm-up in quick succession (see
    app.workers.sync_worker._warm_after_sync) — without this, they'd race
    each other's version bumps and redundantly recompute the same six
    responses. A second call for a uid that's already warming just awaits
    the SAME in-flight task instead of starting another."""
    existing = _inflight.get(uid)
    if existing is not None and not existing.done():
        return await existing

    task = asyncio.ensure_future(_warm_user_impl(uid))
    _inflight[uid] = task
    try:
        return await task
    finally:
        if _inflight.get(uid) is task:
            _inflight.pop(uid, None)


async def _warm_user_impl(uid: str) -> dict:
    """Bump uid's data version FIRST — so every entry this function writes
    carries a version newer than anything computed before this sync — then
    recompute each of the six heaviest per-page-load responses.

    The version is PINNED once, immediately after the bump (`v = await
    data_version.bump(uid)` — the bump call itself already returns the
    fresh value, so there's no need for a separate `response_cache.snapshot`
    read here), and that same `v` is passed to every step's `aput` that
    this function owns. `response_cache.aput` re-checks this pin against
    the LIVE version at write time and silently skips the write if
    something bumped again meanwhile (see response_cache.aput's own
    docstring for the race this closes) — correct even here, where "the
    write is stale before it happens" just means a newer warm-up (or a live
    request) is already superseding this one.

    Three of the six underlying compute steps call their ROUTER function
    directly (`_compute_grow`, `_compute_commitments`,
    `_compute_miscategorised_count`) and those routers already self-cache
    (their own internal `aget`/`aput`, pinning their OWN snapshot right
    before they compute — see response_cache.py's write contract) — so no
    explicit `aput` is needed, or done, for those three here; `_step` just
    calls them and lets them write their own entry. The other three call a
    PURE compute function with no caching of its own, so `_step` `aput`s
    their result itself, pinned to `v`: `_compute_today`
    (`compute_today_items`), `_compute_safe_to_spend`
    (`build_safe_to_spend_response`, extracted from the router specifically
    so it wouldn't self-cache and this function could own the write), and
    `_compute_spend_verdict` (`app.services.spend_verdict.compute_spend_verdict`
    — the SERVICE function, not the self-caching router wrapper around it).

    Each step is called by its bare module-global name (not via a
    module-load-time list of the six function objects) specifically so a
    test can `monkeypatch.setattr(warmup, "_compute_today", fake)` etc. and
    have this function actually see it — Python resolves a bare name inside
    a function body against the ENCLOSING MODULE's namespace at CALL time,
    but a list built from those names at import time would freeze the
    original references and silently ignore any later monkeypatch.
    """
    t0 = time.monotonic()
    v = await data_version.bump(uid)

    warmed: list[str] = []
    failed: list[str] = []

    async def _step(name, compute_fn, *, self_caching: bool) -> None:
        try:
            payload = await compute_fn(uid)
            if not self_caching:
                await response_cache.aput(name, uid, payload, version=v)
            warmed.append(name)
        except Exception:
            logger.exception("warm_user(%s): %s failed to warm", uid, name)
            failed.append(name)

    await _step("today", _compute_today, self_caching=False)
    await _step("safe_to_spend", _compute_safe_to_spend, self_caching=False)
    await _step("spend_verdict:0", _compute_spend_verdict, self_caching=False)
    await _step("miscategorised_count:0", _compute_miscategorised_count, self_caching=True)
    await _step("grow", _compute_grow, self_caching=True)
    await _step("commitments", _compute_commitments, self_caching=True)

    elapsed_ms = round((time.monotonic() - t0) * 1000, 1)
    logger.info(
        "warm_user(%s): warmed=%s failed=%s in %sms", uid, warmed, failed, elapsed_ms
    )
    return {"warmed": warmed, "failed": failed, "elapsed_ms": elapsed_ms}
