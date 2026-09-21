"""User preferences endpoints."""
import asyncio
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.db.collections import preferences_col, cashflow_cache_col
from app.services.notifications import NOTIF_DEFAULTS
from app.services import response_cache
# Single source of truth for the recurring-trust default (G39 fix: this file
# used to carry its own hand-duplicated copy of analytics.py's
# DEFAULT_RECURRING_CATEGORIES, which would have silently fallen out of sync
# the moment G39 added Mortgage/Car finance to the real one).
from app.routers.analytics import DEFAULT_RECURRING_CATEGORIES

router = APIRouter(tags=["preferences"])

# G57 A1: a first-time user's Home evidence starts with the approved period
# comparison chart. An explicitly stored None still means they chose to
# unpin it, because dict.get returns that stored value instead of this
# missing-field default.
DEFAULT_HOME_PINNED_WIDGET = "period_compare"


def _notif_prefs(doc: dict) -> dict:
    saved = (doc or {}).get("notification_prefs") or {}
    return {k: bool(saved.get(k, default)) for k, default in NOTIF_DEFAULTS.items()}


def _coerce_money_field(value, field_name: str) -> int:
    """Accept int/float/numeric-string (commas and whitespace stripped) and
    return an int. Raises HTTPException(422) on anything non-coercible, so a
    bad client payload can never reach the write or the bracket derivation
    below with an unvalidated value (was: `v < 100_000` on a raw string
    500ing the whole save). None/absent stays 0, matching the prior
    `body.get(...) or 0` behaviour."""
    if value is None:
        return 0
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a number")
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        cleaned = value.replace(",", "").strip()
        if cleaned == "":
            return 0
        try:
            return int(float(cleaned))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"{field_name} must be a number")
    raise HTTPException(status_code=422, detail=f"{field_name} must be a number")


@router.get("/preferences")
async def get_preferences(user: dict = Depends(current_user)):
    # G61: a single doc-driven shape for both "no document yet" and "document
    # exists but is missing some fields" — the two used to be built by
    # separate literal dicts (a `not doc` branch and this one), which drifted
    # out of sync (found via G58: the no-document branch was missing
    # income_bracket, income_value, pension_annual, has_child_benefit, plus
    # six more keys nobody had noticed). Folding `doc = doc or {}` into the
    # one dict-building block below means every default here is evaluated by
    # `doc.get(key, default)` against an empty dict when there's no document,
    # which is exactly what the old no-document branch was hand-duplicating.
    doc = await preferences_col.find_one({"user_id": user["email"]}) or {}
    result = {
        "hide_net_worth":     doc.get("hide_net_worth", False),
        "dark_mode":          doc.get("dark_mode", False),
        "pay_period_config":  doc.get("pay_period_config", {"type": "calendar_month"}),
        "debt_target_months": doc.get("debt_target_months", 12),
        "notification_prefs": _notif_prefs(doc),
        "income_bracket":     doc.get("income_bracket", ""),
        "income_value":       doc.get("income_value", 0),
        "pension_annual":     doc.get("pension_annual", 0),
        "has_child_benefit":  doc.get("has_child_benefit", False),
        "home_pinned_accounts": doc.get("home_pinned_accounts", []),
        "home_pinned_cards":  doc.get("home_pinned_cards", []),
        "spend_widgets":      doc.get("spend_widgets"),
        "home_pinned_widget": doc.get("home_pinned_widget", DEFAULT_HOME_PINNED_WIDGET),
        # "What-if" figures for the Spend page's debt_burndown widget — local
        # experimentation only, never fed back into card_terms/accounts.
        "debt_burndown_overrides": doc.get("debt_burndown_overrides"),
        "recurring_categories": doc.get("recurring_categories") or DEFAULT_RECURRING_CATEGORIES,
        "dismissed_recurring":  doc.get("dismissed_recurring", []),
        "cover_plan_excluded_accounts": doc.get("cover_plan_excluded_accounts", []),
        "payday_buffer": doc.get("payday_buffer", 50),
        "penny_agent_consent": doc.get("penny_agent_consent"),
        "version": doc.get("version", 0),
    }
    if "debt_tracking_start" in doc:
        result["debt_tracking_start"] = doc["debt_tracking_start"]
    return result


_COVER_PLAN_CAS_MAX_ATTEMPTS = 8


async def _cas_set_cover_plan_excluded_accounts(uid: str, excluded_ids: list, rest_of_body: dict) -> None:
    """G54: cover_plan_excluded_accounts used to be written as a blind whole-
    array `$set` by two independent writers -- SettingsPage.tsx's own toggle
    and Penny's set_cover_plan_exclusions proposal (replayed through this
    same endpoint via can_i._execute_update_preferences) -- with no
    compare-and-swap. Two racing writers could each read the same array,
    compute their own modified copy, and write the WHOLE thing back:
    whichever PATCH landed second silently discarded whatever the first one
    changed, a classic lost update.

    The Settings side is fixed by moving to true delta ops
    (cover_plan_exclude_add/remove below, $addToSet/$pull -- atomic,
    idempotent, never need to read the array first). Penny's proposal
    genuinely needs "set the exclusion list to EXACTLY these accounts"
    (account_refs names a full desired set, not a delta), so that shape is
    kept here rather than removed -- made safe with an optimistic
    compare-and-swap retry loop on `version` instead of an unconditional
    $set: read the current version, write conditioned on that exact
    version, and if another writer's version bump beat us to it (matched
    nothing), retry against the fresh version.

    G77 FIX: the caller's `excluded_ids` is only meaningful relative to the
    array THIS function's own first read saw -- it is "the array I read,
    with my intended accounts added/removed", not an unconditional literal.
    The pre-fix version forgot that and resent `excluded_ids` UNCHANGED on
    every retry, so a retry that re-read a NEWER array (because a concurrent
    Settings toggle landed in between) still overwrote it with the stale
    target, silently discarding that concurrent change -- a lost update,
    just a deterministic one instead of a racy one. Fixed by capturing the
    delta (added_ids / removed_ids) against the FIRST read once, then on
    every attempt -- including retries -- re-deriving the target by
    re-applying that same delta onto whatever the array actually is right
    now, rather than resending the first attempt's literal. A concurrent
    add/remove of some OTHER account is therefore preserved through any
    number of retries; only the accounts this caller actually asked to
    change are guaranteed to land in the state it asked for.
    """
    baseline_ids = None
    added_ids: set = set()
    removed_ids: set = set()
    for _ in range(_COVER_PLAN_CAS_MAX_ATTEMPTS):
        doc = await preferences_col.find_one({"user_id": uid})
        if doc is None:
            # No document at all yet for this field to race over -- a
            # concurrent first-ever write for the same user is vanishingly
            # unlikely, and even then the loser of the upsert would simply
            # retry as a normal versioned update on its next attempt.
            set_body = {**rest_of_body, "cover_plan_excluded_accounts": excluded_ids, "user_id": uid}
            await preferences_col.update_one(
                {"user_id": uid},
                {"$set": set_body, "$inc": {"version": 1}},
                upsert=True,
            )
            return
        current_ids = sorted({str(a) for a in (doc.get("cover_plan_excluded_accounts") or [])})
        if baseline_ids is None:
            # First read only: this IS the array `excluded_ids` was computed
            # against, so the delta between them is exactly what the caller
            # intends to change. Captured once -- later retries re-apply
            # this same delta rather than recomputing it against a doc the
            # caller never saw.
            baseline_ids = current_ids
            added_ids = set(excluded_ids) - set(baseline_ids)
            removed_ids = set(baseline_ids) - set(excluded_ids)
        target_ids = sorted((set(current_ids) | added_ids) - removed_ids)
        set_body = {**rest_of_body, "cover_plan_excluded_accounts": target_ids, "user_id": uid}
        # A real MongoDB equality filter {"version": 0} does NOT match a
        # document where "version" is simply absent (a legacy doc from
        # before G45 added the counter, never $inc'd since) -- doc.get
        # defaulting to 0 above is only a display default, not what's
        # actually stored. Match on {"$exists": False} for that case so the
        # CAS filter reflects what is really in the document, not a
        # Python-side default that would otherwise always mismatch and
        # exhaust every retry attempt for these legacy docs.
        version_query = doc["version"] if "version" in doc else {"$exists": False}
        result = await preferences_col.update_one(
            {"user_id": uid, "version": version_query},
            {"$set": set_body, "$inc": {"version": 1}},
        )
        if getattr(result, "matched_count", 1) >= 1:
            return
        # Someone else wrote (a delta toggle, or another full-list-set)
        # between our read and our write -- version moved under us, loop
        # and retry: re-read the array and re-apply added_ids/removed_ids
        # onto WHATEVER it now is, rather than resending target_ids from
        # this attempt (which was only correct against the doc we just lost
        # the race against).
    raise HTTPException(
        status_code=409,
        detail="Could not save cover-plan exclusions, too many concurrent changes. Try again.",
    )


@router.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]

    # income_bracket is derived, not chosen — the salary is the source of truth
    if "income_value" in body:
        v = _coerce_money_field(body.get("income_value"), "income_value")
        body["income_value"] = v
        body["income_bracket"] = (
            "under_100k" if v < 100_000 else "100k_125k" if v <= 125_140 else "125k_plus"
        )
    if "pension_annual" in body:
        body["pension_annual"] = _coerce_money_field(body.get("pension_annual"), "pension_annual")
    pay_period_changed = "pay_period_config" in body

    # G54 delta ops: "toggle exclusion for ONE account", exactly what a
    # Settings toggle means. $addToSet/$pull are atomic single-element Mongo
    # operations -- they never read the array first, so two of these (or one
    # of these racing the CAS full-list-set below) can never lose each
    # other's change regardless of write order. Naturally idempotent too:
    # adding an already-present id, or removing an absent one, is a no-op.
    add_ids = sorted({
        str(x).strip() for x in (body.pop("cover_plan_exclude_add", None) or [])
        if str(x).strip()
    })
    remove_ids = sorted({
        str(x).strip() for x in (body.pop("cover_plan_exclude_remove", None) or [])
        if str(x).strip()
    })
    delta_op_ran = False
    for op_ids, set_key in ((add_ids, "$addToSet"), (remove_ids, "$pull")):
        if not op_ids:
            continue
        delta_op_ran = True
        update_doc = {"$inc": {"version": 1}, "$setOnInsert": {"user_id": uid}}
        if set_key == "$addToSet":
            update_doc["$addToSet"] = {"cover_plan_excluded_accounts": {"$each": op_ids}}
        else:
            update_doc["$pull"] = {"cover_plan_excluded_accounts": {"$in": op_ids}}
        await preferences_col.update_one({"user_id": uid}, update_doc, upsert=True)

    # G45 v3: every write bumps a monotonic per-document version, returned by
    # both this endpoint and GET /preferences below. This is the freshness
    # signal the frontend (PreferencesContext.tsx) uses to tell a stale GET
    # snapshot (e.g. a slow app-boot fetch that resolves after a PATCH has
    # already landed) apart from a genuinely newer one — including one
    # written by a DIFFERENT caller than the one reading it (Penny's
    # set_cover_plan_exclusions proposal replays this very endpoint via
    # can_i._execute_update_preferences, so "newer" must never mean
    # "written by me"). $inc on a field that doesn't exist yet starts it at
    # 0 then applies the increment, so a document's very first PATCH always
    # returns version 1 — strictly greater than the 0 GET /preferences
    # reports for a user with no document at all.
    if "cover_plan_excluded_accounts" in body:
        excluded_ids = sorted(
            {str(x) for x in (body.pop("cover_plan_excluded_accounts") or []) if str(x).strip()}
        )
        await _cas_set_cover_plan_excluded_accounts(uid, excluded_ids, body)
    elif body or not delta_op_ran:
        # Skip this catch-all write when a delta op above already ran and
        # nothing else is left in the body -- otherwise a plain
        # cover_plan_exclude_add/remove-only PATCH would bump `version`
        # twice (once for its own $addToSet/$pull, once more here for an
        # empty no-op $set), which is harmless but wasteful. A genuinely
        # empty PATCH (no delta ops, no other fields) still runs this once,
        # matching the pre-G54 behaviour of always creating/touching the
        # document.
        await preferences_col.update_one(
            {"user_id": uid},
            {"$set": {**body, "user_id": uid}, "$inc": {"version": 1}},
            upsert=True,
        )
    doc = await preferences_col.find_one({"user_id": uid})

    # Preferences include Safe-to-Spend inputs (notably the pay-period
    # configuration and the user buffer). A successful patch must never leave
    # a cached spending permission on screen. Full invalidation is
    # deliberately the safe default: some less-obvious preference fields feed
    # dependent Home/Penny summaries too, and cache entries are per-user.
    # Awaited (ainvalidate, not the sync invalidate()'s fire-and-forget bump)
    # so the very next read — even from a different process — is guaranteed
    # cold, not just eventually cold.
    await response_cache.ainvalidate(uid)

    if pay_period_changed:
        # Best-effort: recompute cashflow so the new pay period takes effect
        # immediately. Don't let a compute failure block the pref save.
        try:
            from app.routers.analytics import compute_and_cache_cashflow
            asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
        except Exception:
            pass

    return {
        "hide_net_worth": doc.get("hide_net_worth", False),
        "dark_mode": doc.get("dark_mode", False),
        "version": doc.get("version", 1),
    }
