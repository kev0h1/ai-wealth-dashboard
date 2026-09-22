"""User preferences endpoints."""
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pymongo.errors import DuplicateKeyError

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

# A85 (pentest A51-2026-09-20, API-08): the exact set of top-level fields
# PATCH /preferences has ever been asked to write, enumerated from every
# caller -- frontend/lib/api.ts's updatePreferences() type plus its actual
# call sites (components/Onboarding.tsx, app/components/AccountsPage.tsx,
# components/SpendTrends.tsx, components/PreferencesContext.tsx,
# app/settings/SettingsPage.tsx, lib/useHomePinnedCards.ts), and every
# Penny propose-tool in services/penny_tools.py that replays through this
# same endpoint via app.routers.can_i._execute_update_preferences
# (set_pay_period, set_income, set_pension, set_child_benefit,
# set_debt_target, set_debt_tracking_start, set_cover_plan_exclusions,
# set_hide_balances -- each sends exactly one of the keys already listed
# here for its own frontend equivalent). A body key outside this set is
# rejected below with 422 rather than silently written: this endpoint used
# to accept and store ANY top-level field with no schema check at all
# (mass assignment), live-confirmed in A51-2026-09-20's API-08 case.
#
# `income_bracket` is included even though no caller sends it directly
# today: update_preferences derives and injects it onto `body` itself when
# `income_value` is present (see below), and it is a documented field of
# the GET/PATCH response shape (frontend/lib/api.ts's getPreferences type).
#
# Deliberately NOT here: `penny_agent_consent`, which is only ever written
# by POST /penny/agent-consent and its DELETE counterpart, never by this
# endpoint; and `payday_buffer`, which has no writer anywhere in the app
# today (read-only, defaults to 50 in services/companion.py). Fields such
# as `income_streams`, `dismissed_recurring`, `dismissed_recurring_meta`,
# `vetoed_hidden`, `judge_overrides`, `dismissed_miscategorised(_series)`,
# `dismissed_transfer_pairs` and `spotlight_last_shown` are also excluded:
# they are real preference-document fields, but every writer of them
# (routers/income.py, routers/analytics.py, routers/savings_insights.py,
# services/account_cascade.py, services/penny_tools.py) calls
# preferences_col.update_one directly, never this PATCH endpoint, so they
# were never reachable through this body in the first place.
ALLOWED_PREFERENCE_FIELDS = frozenset({
    "hide_net_worth",
    "dark_mode",
    "pay_period_config",
    "income_value",
    "income_bracket",
    "pension_annual",
    "has_child_benefit",
    "home_pinned_accounts",
    "home_pinned_cards",
    "recurring_categories",
    "spend_widgets",
    "home_pinned_widget",
    "debt_burndown_overrides",
    "cover_plan_excluded_accounts",
    "cover_plan_exclude_add",
    "cover_plan_exclude_remove",
    "debt_target_months",
    "debt_tracking_start",
    "notification_prefs",
})

# A85: a protocol-level key, not a preference field itself -- carries the
# optimistic-concurrency check in update_preferences below. Kept out of
# ALLOWED_PREFERENCE_FIELDS (and popped from the body before the unknown-
# field check's complement would otherwise need to special-case it) so it
# can never be validated as a preference or written into the document.
EXPECTED_VERSION_KEY = "expected_version"


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
            # KNOWN GAP (flagged 2026-09-22, not fixed here per instruction):
            # this upsert has the same unconditioned {"user_id": uid} shape
            # as _versioned_write's bootstrap branch below did before its
            # own DuplicateKeyError fix -- two genuinely simultaneous first
            # writes would raise pymongo.errors.DuplicateKeyError here,
            # uncaught, i.e. a 500 rather than a clean retry. Sibling of
            # A85's gap 2; left alone here, a separate item should apply the
            # same catch-and-retry/409.
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


def _version_match_query(expected_version: int) -> dict:
    """A85 rework: the filter fragment that makes `expected_version` an
    actual compare-and-set condition, mirroring the same "legacy doc with no
    `version` field reads as 0" rule _cas_set_cover_plan_excluded_accounts
    already applies (see its own comment above `version_query`) -- a plain
    Mongo equality filter `{"version": 0}` does NOT match a document where
    `version` is simply absent, so expected_version == 0 must match EITHER
    an explicit stored 0 OR a missing field, expressed as `$or` since (unlike
    the CAS helper, which builds its filter from a doc it just read) this is
    built from the client's claimed version alone, with no read in between."""
    if expected_version == 0:
        return {"$or": [{"version": 0}, {"version": {"$exists": False}}]}
    return {"version": expected_version}


async def _versioned_write(uid: str, expected_version, update_doc: dict):
    """A85 rework: run `update_doc` (a Mongo update document, e.g.
    `{"$set": ..., "$inc": {"version": 1}}`) against this user's preferences
    document. When `expected_version` is supplied, the version check lives
    in `update_one`'s FILTER -- not a separate pre-read -- because a
    pre-read-then-write is not atomic: two concurrent callers can both pass
    the read and both write, which was the exact defect Kevin's rejection of
    this item identified (the ordinary path used to filter on
    `{"user_id": uid}` alone, no version condition, so the earlier
    `expected_version` pre-check above could not actually prevent a lost
    update under a real race). A zero `matched_count` is the sole conflict
    signal, exactly the pattern `_cas_set_cover_plan_excluded_accounts`
    already uses.

    `upsert=True` is deliberately NOT used together with the version filter:
    if a document with a DIFFERENT version already exists for this user, an
    upsert on a filter that fails to match it would attempt to INSERT a
    second document with the same user_id rather than report the conflict.
    So the version-conditioned attempt always runs with `upsert=False`, and
    only a confirmed absence of any document for this user (checked by a
    fresh read after a zero match) is treated as a genuine first write and
    allowed to create one.

    When `expected_version` is None, behaviour is unchanged from before this
    fix: last-write-wins, unconditional `upsert=True`, matching every
    existing caller that has never sent `expected_version`, and this returns
    None since nothing needs to chain a version forward.

    Returns the resulting version when `expected_version` was supplied, so a
    caller that makes more than one write for a single PATCH (the delta-ops
    loop below, when it runs for both `cover_plan_exclude_add` and
    `cover_plan_exclude_remove` in the same body) can pass the bumped
    version into its NEXT call instead of replaying the client's original
    `expected_version` -- which this same request's own earlier write has by
    then already advanced, and would otherwise make the second write
    spuriously conflict with itself.

    Adversarial review (2026-09-22, two gaps in the "no document yet"
    bootstrap branch):

    1. This function used to bootstrap-create a document whenever
       `current_doc is None`, REGARDLESS of what `expected_version` actually
       claimed -- calling it directly with `expected_version=99` against an
       empty collection would create a document at version 1, discarding a
       bogus/stale claim instead of rejecting it. The handler's fast
       pre-check above happens to catch this in the ordinary call path
       (current_version also defaults to 0 for a missing document, so 99
       would already 409 there) -- but that is the handler's behaviour, not
       this function's, and this function must not rely on a caller having
       already done that check. Fixed: the bootstrap branch below only
       creates when `expected_version` is None or 0 (the only claims
       consistent with "no document has ever existed for this user"); any
       other value is a conflict, reported as 409 with `current_version: 0`
       since that is what GET /preferences would show for this user right
       now.

    2. Two genuinely simultaneous first writes for a brand-new user can both
       reach the bootstrap branch (both saw `current_doc is None`) and both
       attempt the identical, unconditioned `update_one({"user_id": uid},
       ..., upsert=True)`. In real MongoDB the unique index on
       `preferences_col`'s `user_id` field (app/main.py ~370) lets only one
       of those inserts actually land; the loser raises
       `pymongo.errors.DuplicateKeyError`, which -- uncaught -- would 500
       instead of giving that caller a clean conflict response. Fixed:
       caught here and converted to the same 409 shape a version conflict
       gets, with the version re-read fresh (the winner's write already
       landed by the time this exception fires, so `current_version` is 1,
       not 0). `_cas_set_cover_plan_excluded_accounts`'s own doc-is-None
       bootstrap branch (above) has this identical shape and this identical
       gap; left alone here per instruction, flagged as a sibling for a
       separate item.
    """
    if expected_version is None:
        await preferences_col.update_one({"user_id": uid}, update_doc, upsert=True)
        return None

    write_filter = {"user_id": uid, **_version_match_query(expected_version)}
    result = await preferences_col.update_one(write_filter, update_doc, upsert=False)
    if getattr(result, "matched_count", 0) >= 1:
        updated_doc = await preferences_col.find_one({"user_id": uid}, {"version": 1})
        return (updated_doc or {}).get("version", expected_version + 1)

    current_doc = await preferences_col.find_one({"user_id": uid}, {"version": 1})
    if current_doc is None:
        if expected_version not in (None, 0):
            # Gap 1: expected_version claims a version other than "never
            # written" against a user who genuinely has no document at all
            # -- that is a stale/bogus claim, not a first write, and must
            # not be allowed to fabricate a document at that version.
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Preferences have changed since you last loaded them.",
                    "current_version": 0,
                },
            )
        try:
            await preferences_col.update_one({"user_id": uid}, update_doc, upsert=True)
            return 1
        except DuplicateKeyError:
            # Gap 2: another writer's own bootstrap upsert landed between
            # our "no document" read above and this insert attempt -- the
            # unique index on user_id caught it as MongoDB would. Re-read
            # rather than assume version 1, since the winner's update_doc
            # (not ours) is what actually landed.
            current_doc = await preferences_col.find_one({"user_id": uid}, {"version": 1})
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Preferences have changed since you last loaded them.",
                    "current_version": (current_doc or {}).get("version", 0),
                },
            )

    raise HTTPException(
        status_code=409,
        detail={
            "message": "Preferences have changed since you last loaded them.",
            "current_version": current_doc.get("version", 0),
        },
    )


@router.patch("/preferences")
async def update_preferences(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]

    # A85 mass-assignment fix: reject any top-level key this endpoint does
    # not know how to handle, BEFORE it can reach any $set. Checked against
    # the body's ORIGINAL keys, ahead of the income_bracket derivation and
    # the cover_plan_exclude_add/remove pops below, so nothing the server
    # itself later adds to (or removes from) `body` can hide a genuinely
    # unknown client-supplied key, or get mistakenly flagged as one.
    unknown_fields = set(body.keys()) - ALLOWED_PREFERENCE_FIELDS - {EXPECTED_VERSION_KEY}
    if unknown_fields:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown preference field(s): {', '.join(sorted(unknown_fields))}",
        )

    # A85 optimistic-concurrency fix: an optional `expected_version` in the
    # JSON body -- the same body-carried convention the frontend already
    # uses for the `version` counter on every GET/PATCH response (see
    # frontend/lib/preferencesVersion.ts, components/PreferencesContext.tsx)
    # rather than a new header, so there is one convention for "where does
    # the version live" across this endpoint. Omitted (the default):
    # behaviour is unchanged from before this fix, last write wins, exactly
    # like every existing client today.
    #
    # A85 REWORK (Kevin's rejection, 2026-09-22): this used to be the ONLY
    # check -- a separate find_one read compared against expected_version,
    # with the actual writes below filtering on {"user_id": uid} alone, no
    # version condition. That is not atomic: two concurrent writers can both
    # read the same version, both pass this check, and both write, silently
    # losing whichever one wrote first (the live-confirmed A51-2026-09-20
    # API-08 case, and independently reproduced by the reviewer with an
    # asyncio.Event rendezvous forcing both reads to land before either
    # write). This read is now ONLY a fast path -- a cheap early 409 for the
    # common case where the client is already visibly stale, saving the
    # write attempt below. The actual guarantee lives in _versioned_write's
    # version-conditioned update_one FILTER, used by every write path below
    # (the delta ops, and the ordinary catch-all $set/$inc); a zero
    # matched_count there is what a real conflict looks like, not this read.
    # (The cover-plan compare-and-swap is a pre-existing, already-atomic
    # retry loop of its own -- _cas_set_cover_plan_excluded_accounts -- and
    # is untouched by this rework.)
    expected_version = body.pop(EXPECTED_VERSION_KEY, None)
    if expected_version is not None:
        if isinstance(expected_version, bool) or not isinstance(expected_version, int):
            raise HTTPException(status_code=422, detail="expected_version must be an integer")
        current_doc = await preferences_col.find_one({"user_id": uid}, {"version": 1})
        current_version = (current_doc or {}).get("version", 0)
        if current_version != expected_version:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Preferences have changed since you last loaded them.",
                    "current_version": current_version,
                },
            )

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
        # A85 rework: this used to be an unconditional
        # update_one({"user_id": uid}, ..., upsert=True) -- the same missing
        # version-filter defect as the ordinary $set path below, just on the
        # delta ops instead. Routed through _versioned_write so a supplied
        # expected_version is a real compare-and-set here too. The version
        # is chained forward (not replayed) in case BOTH add and remove ids
        # were sent in the same body -- see _versioned_write's own docstring
        # for why replaying the original expected_version on the second call
        # would spuriously conflict with this request's own first write.
        new_version = await _versioned_write(uid, expected_version, update_doc)
        if expected_version is not None:
            expected_version = new_version

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
        #
        # A85 rework: this was the exact path Kevin's rejection identified --
        # update_one({"user_id": uid}, ..., upsert=True) with no version
        # condition in the filter, so the expected_version check above (a
        # separate read) could not stop two concurrent writers from both
        # passing it and both writing. Routed through _versioned_write, whose
        # filter carries the version itself.
        await _versioned_write(
            uid, expected_version,
            {"$set": {**body, "user_id": uid}, "$inc": {"version": 1}},
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
