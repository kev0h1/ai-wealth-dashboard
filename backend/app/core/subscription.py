"""Subscription tiers and feature limits (data only, no enforcement beyond
connection limits). See CLAUDE.md "Codex design round" section for the
retirement of the old free/pro/premium/family tiers.

Tiers: Statements (free, statement upload only) < Lite < Standard < Connect
< Max. Nobody should be restricted before launch — the tier a user gets
when they have no subscription doc (or an expired/unrecognised one) is
DEFAULT_TIER (app.core.config), which defaults to "max"."""
import logging
from datetime import date, datetime, timedelta, timezone
from enum import IntEnum
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)


class Tier(IntEnum):
    STATEMENTS = 0   # free: statement upload only, no open banking
    LITE = 1
    STANDARD = 2
    CONNECT = 3
    MAX = 4


TIER_NAMES = {
    Tier.STATEMENTS: "statements",
    Tier.LITE:       "lite",
    Tier.STANDARD:   "standard",
    Tier.CONNECT:    "connect",
    Tier.MAX:        "max",
}
TIER_BY_NAME = {v: k for k, v in TIER_NAMES.items()}

TIER_PRICES_GBP = {
    "statements": 0.0,
    "lite":       5.99,
    "standard":   9.99,
    "connect":    12.99,
    "max":        16.99,
}

# B21: the full set of billing periods the schema understands. This stays
# four entries deliberately (including "three_months") even after B27
# dropped three_months from SUBSCRIPTION_PERIODS_ENABLED below, both here
# and in TIER_BILLING_PRICES_GBP just below: it is the reference table, so
# re-enabling the period later is a one-line change to the enabled tuple
# rather than re-deriving prices. A future reader should not "clean up"
# these two structures by deleting the three_months rows.
SUBSCRIPTION_BILLING_PERIODS = {
    "monthly":      {"months": 1,  "label": "Monthly"},
    "three_months": {"months": 3,  "label": "Every 3 months"},
    "six_months":   {"months": 6,  "label": "Every 6 months"},
    "annual":       {"months": 12, "label": "Yearly"},
}
SUBSCRIPTION_TRIAL_DAYS = 14

# B22: Kevin's agreed pricing of 2026-09-11 (TODO.md B22 notes). Every
# longer-period total is set here explicitly, not computed from the
# monthly price, because these totals carry a genuine saving (about 16.6%
# on every tier's annual price, less on three/six months) — the earlier
# B21 placeholder multiplied the monthly price by the number of months,
# which claimed no saving at all and was wrong. Statements stays free on
# every period. billing_period_detail() below is the one place that turns
# a (tier, period) pair into months/label/total/saving/per-month, so
# GET /subscription and the tests reading this table can never drift.
TIER_BILLING_PRICES_GBP = {
    "statements": {"monthly": 0.0,   "three_months": 0.0,   "six_months": 0.0,    "annual": 0.0},
    "lite":       {"monthly": 5.99,  "three_months": 16.99, "six_months": 31.99,  "annual": 59.99},
    "standard":   {"monthly": 9.99,  "three_months": 28.99, "six_months": 53.99,  "annual": 99.99},
    "connect":    {"monthly": 12.99, "three_months": 36.99, "six_months": 69.99,  "annual": 129.99},
    "max":        {"monthly": 16.99, "three_months": 48.99, "six_months": 91.99,  "annual": 169.99},
}

# Kevin decides: which periods are offered at all. He dropped "three_months"
# on 2026-09-12 (TODO.md B27 note, resolving one of B22's two open
# switches): it saved a Lite user under £2 versus monthly, and every period
# kept becomes four more SKUs to create and maintain in App Store Connect
# for C13. SUBSCRIPTION_BILLING_PERIODS and TIER_BILLING_PRICES_GBP above
# deliberately still carry a "three_months" column (see their own
# comments), so re-enabling it later is a one-line change to this tuple.
SUBSCRIPTION_PERIODS_ENABLED = ("monthly", "six_months", "annual")

# Kevin decides: which of the enabled periods carry the 14-day introductory
# trial. He may widen this to every period — the coordinator's own
# recommendation (TODO.md B22 note) is that the trial should never be a
# lever into a 12-month commitment, only the discounted periods should be.
SUBSCRIPTION_TRIAL_PERIODS = ("annual",)


def billing_period_detail(tier: str, period: str) -> dict:
    """The one calculation GET /subscription (app.routers.subscription)
    and tests/test_billing.py's price-table tests both read, so the API
    payload and the tests can never quietly drift apart. Returns months,
    label, total (TIER_BILLING_PRICES_GBP[tier][period]), saving_gbp (the
    saving in pounds versus paying the monthly price for that many
    months, clamped to never go negative) and per_month_gbp (total spread
    evenly across the period's months)."""
    period_detail = SUBSCRIPTION_BILLING_PERIODS[period]
    months = int(period_detail["months"])
    label = period_detail["label"]
    total = TIER_BILLING_PRICES_GBP[tier][period]
    monthly_price = TIER_PRICES_GBP[tier]
    saving_gbp = round(max(0.0, monthly_price * months - total), 2)
    per_month_gbp = round(total / months, 2) if months else total
    return {
        "months": months, "label": label, "total": total,
        "saving_gbp": saving_gbp, "per_month_gbp": per_month_gbp,
    }

# B11 (docs/pricing/tiering-unit-economics-mcp-2026-09.md section 9): three
# top-up packs, good/better/best. The middle pack is the target ("Most
# popular"); the largest is priced about 10% under the Standard-to-Max
# marginal rate so a repeat buyer is nudged towards the sheet's "Move to
# Max" row (see penny_allowance's packs_bought_this_month) rather than
# living on packs. Prices sit on standard App Store / Play price points so
# the same SKU works in-app and on Stripe.
PENNY_TOPUP_PACKS = [
    {"id": "small",  "messages": 20,  "price_gbp": 0.99, "badge": None},
    {"id": "medium", "messages": 100, "price_gbp": 2.99, "badge": "Most popular"},
    {"id": "large",  "messages": 200, "price_gbp": 4.99, "badge": "Best value"},
]

# Packs last 90 days from purchase rather than expiring at month end (section
# 9's whole point: "this month only" makes the large pack a bad buy in the
# last week of a month and suppresses exactly the purchase we most want).
PENNY_TOPUP_LIFETIME_DAYS = 90

# Legacy alias — kept for one release so any code/tests still reading the
# single-pack shape (`{"messages", "price_gbp"}`) keep working. Grep
# `PENNY_TOPUP` (not `PENNY_TOPUP_PACKS`) before deleting this; GET
# /subscription now also serves the full list as `topups`.
PENNY_TOPUP = {"messages": PENNY_TOPUP_PACKS[1]["messages"], "price_gbp": PENNY_TOPUP_PACKS[1]["price_gbp"]}

# F9: one MCP connector call pack, same mechanics as the Penny packs above
# (`_settle_packs`/`mcp_allowance` below share the implementation with
# `settle_topups`/`penny_allowance`). Only Connect and Max have the
# connector at all (`mcp_tool_calls_per_month` 2000/5000), so this is the
# only pack a Connect user would reach for; Max's 5000/month is the
# DEFAULT_TIER today (see module docstring) so nobody needs it yet.
MCP_CALL_PACKS = [
    {"id": "mcp_1000", "calls": 1000, "price_gbp": 2.99, "badge": None},
]

# None = unlimited
TIER_LIMITS = {
    Tier.STATEMENTS: {
        "open_banking":                False,
        "max_banks":                   0,
        "max_accounts":                0,
        "refresh":                     "on_upload",
        "penny_messages_per_month":    10,
        "mcp_tool_calls_per_month":    0,
        "history_days":                90,
        "statement_uploads_per_month": 3,
    },
    Tier.LITE: {
        "open_banking":                True,
        "max_banks":                   3,
        "max_accounts":                None,
        "refresh":                     "daily",
        "penny_messages_per_month":    40,
        "mcp_tool_calls_per_month":    0,
        "history_days":                180,
        "statement_uploads_per_month": None,
    },
    Tier.STANDARD: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                20,
        "refresh":                     "4h",
        "penny_messages_per_month":    150,
        "mcp_tool_calls_per_month":    0,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
    Tier.CONNECT: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                20,
        "refresh":                     "4h",
        "penny_messages_per_month":    150,
        "mcp_tool_calls_per_month":    2000,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
    Tier.MAX: {
        "open_banking":                True,
        "max_banks":                   None,
        "max_accounts":                None,
        "refresh":                     "priority",
        "penny_messages_per_month":    400,
        "mcp_tool_calls_per_month":    5000,
        "history_days":                None,
        "statement_uploads_per_month": None,
    },
}

# Legacy stored tier names map onto the new tiers for anyone with an existing
# subscription doc. "free" resolves to whatever DEFAULT_TIER is configured as
# (looked up lazily in get_subscription to avoid a stale import-time value).
_LEGACY_TIER_MAP = {
    "pro":     Tier.STANDARD,
    "premium": Tier.MAX,
    "family":  Tier.MAX,
}


class Subscription:
    def __init__(
        self, tier: Tier, status: str = "active", *,
        billing_period: str | None = None,
        trial_ends_at: datetime | None = None,
        renews_at: datetime | None = None,
        cancel_at_period_end: bool = False,
        has_paid_subscription: bool = False,
    ):
        self.tier = tier
        self.status = status
        self.limits = TIER_LIMITS[tier]
        self.billing_period = billing_period
        self.trial_ends_at = trial_ends_at
        self.renews_at = renews_at
        self.cancel_at_period_end = cancel_at_period_end
        self.has_paid_subscription = has_paid_subscription

    @property
    def tier_name(self) -> str:
        return TIER_NAMES[self.tier]

    def limit(self, key: str) -> Optional[int]:
        return self.limits.get(key)


def _default_tier() -> Tier:
    from app.core.config import DEFAULT_TIER
    return TIER_BY_NAME.get(DEFAULT_TIER.strip().lower(), Tier.MAX)


async def get_subscription(email: str) -> Subscription:
    from app.db.collections import subscriptions_col

    default_tier = _default_tier()
    doc = await subscriptions_col.find_one({"user_id": email})
    if not doc:
        return Subscription(default_tier)

    stripe_backed = bool(doc.get("source") == "stripe" and doc.get("stripe_subscription_id"))
    if doc.get("status") == "expired":
        return Subscription(default_tier, "expired", has_paid_subscription=stripe_backed)

    expires_at = doc.get("expires_at")
    if expires_at and expires_at < datetime.now(timezone.utc):
        return Subscription(default_tier, "expired", has_paid_subscription=stripe_backed)

    stored_name = (doc.get("tier") or "").strip().lower()
    if stored_name in TIER_BY_NAME:
        tier = TIER_BY_NAME[stored_name]
    elif stored_name in _LEGACY_TIER_MAP:
        tier = _LEGACY_TIER_MAP[stored_name]
        logger.info("subscription: legacy tier '%s' mapped to '%s' for user", stored_name, TIER_NAMES[tier])
    else:
        tier = default_tier
        if stored_name == "free":
            logger.info("subscription: legacy tier 'free' mapped to default tier '%s' for user", TIER_NAMES[tier])
        elif stored_name:
            logger.info("subscription: unrecognised tier '%s' mapped to default tier '%s' for user", stored_name, TIER_NAMES[tier])

    return Subscription(
        tier, doc.get("status", "active"),
        billing_period=doc.get("billing_period"),
        trial_ends_at=doc.get("trial_ends_at"),
        renews_at=doc.get("expires_at"),
        cancel_at_period_end=bool(doc.get("cancel_at_period_end")),
        has_paid_subscription=stripe_backed,
    )


def _ym_tuple(ym: str) -> tuple[int, int]:
    y, m = ym.split("-")
    return int(y), int(m)


def _ym_after(ym: str) -> str:
    y, m = _ym_tuple(ym)
    return f"{y + 1}-01" if m == 12 else f"{y}-{m + 1:02d}"


def _pack_covers_month(pack: dict, ym: str) -> bool:
    """True if `pack` was still alive for at least part of calendar month
    `ym` (bought on or before it, not expired before it started). Packs
    that expire mid-month are treated as covering that whole month — the
    settlement below only draws down `remaining`, so an empty pack takes
    nothing regardless."""
    purchased_ym = pack.get("year_month") or ""
    if purchased_ym > ym:
        return False
    expires_at = pack.get("expires_at")
    if expires_at is None:
        return True
    return expires_at.strftime("%Y-%m") >= ym


async def _settle_packs(
    email: str, now: datetime, *, col, tier_limit_key: str, usage_fn, persist: bool = True,
) -> list[dict]:
    """Shared implementation behind `settle_topups` (Penny message packs,
    B11) and `settle_mcp_packs` (MCP connector call packs, F9) — the two
    only differ in which collection holds the pack docs, which
    `TIER_LIMITS[...]` key is the tier's own monthly allowance, and how
    that month's usage is counted (`usage_fn(email, ym) -> int`).

    Lazily settles every PAST calendar month (up to but excluding the
    current one) that this user's packs haven't already accounted for,
    attributing each month's overflow (usage past the tier's own allowance
    that month) to the OLDEST covering pack's `remaining` first. Idempotent:
    each (pack, month) pair is written at most once, tracked in the pack
    doc's own `settled_months` list, so re-running this for a month already
    settled is a no-op check with no DB write.

    `persist=False` (B23) runs the exact same computation — the returned
    packs reflect what settlement WOULD produce, so a caller reading
    `remaining`/`settled_months` off the result sees the truthful,
    as-if-settled numbers — but skips every `col.update_one` call, so no
    document is touched. This is for read-only callers (B20's broadcast
    audience preview, which must never mutate a candidate's pack records
    just by evaluating whether they match a filter) that need the correct
    number without performing the settlement write; the write is left for
    whichever caller next reads this with `persist=True` (default), e.g.
    the user's own next `penny_allowance`/`mcp_allowance` check.

    The current month is never settled here — its usage is still moving,
    so the caller (`penny_allowance`/`mcp_allowance`) reads it live (this
    month's overflow is simply tier_limit vs used, no pack draw-down
    needed against it beyond the ordinary `limit = tier_limit + pack
    remaining` sum). Returns the user's full (possibly just-mutated, if
    `persist`) list of pack docs so the caller doesn't have to re-query."""
    packs = [doc async for doc in col.find({"user_id": email})]
    if not packs:
        return packs

    cur_ym = now.strftime("%Y-%m")
    earliest_ym = min((p.get("year_month") or cur_ym) for p in packs)

    ym = earliest_ym
    while ym < cur_ym:
        relevant = [p for p in packs if (p.get("year_month") or "") <= ym]
        unsettled = [p for p in relevant if ym not in (p.get("settled_months") or [])]
        if not unsettled:
            ym = _ym_after(ym)
            continue

        tier_limit = (await get_subscription(email)).limit(tier_limit_key)
        if tier_limit is None:
            overflow = 0
        else:
            used = await usage_fn(email, ym)
            overflow = max(0, int(used) - tier_limit)

        covering = sorted(
            (p for p in unsettled if _pack_covers_month(p, ym)),
            key=lambda p: p.get("purchased_at") or datetime.min.replace(tzinfo=timezone.utc),
        )
        not_covering = [p for p in unsettled if p not in covering]

        for p in covering:
            take = min(int(p.get("remaining") or 0), overflow)
            overflow -= take
            new_remaining = int(p.get("remaining") or 0) - take
            settled_months = list(p.get("settled_months") or []) + [ym]
            p["remaining"] = new_remaining
            p["settled_months"] = settled_months
            if persist:
                await col.update_one(
                    {"_id": p["_id"]},
                    {"$set": {"remaining": new_remaining, "settled_months": settled_months}},
                )

        for p in not_covering:
            settled_months = list(p.get("settled_months") or []) + [ym]
            p["settled_months"] = settled_months
            if persist:
                await col.update_one(
                    {"_id": p["_id"]}, {"$set": {"settled_months": settled_months}},
                )

        ym = _ym_after(ym)

    return packs


async def settle_topups(email: str, now: datetime, *, persist: bool = True) -> list[dict]:
    """Thin wrapper around `_settle_packs` for Penny message top-up packs
    (`penny_topups_col`, B11) — kept as its own name/signature so existing
    callers and tests are unaffected by the F9 refactor. See
    `_settle_packs` for the shared algorithm (including `persist=False`,
    B23) and `penny_allowance` for how the result is folded into this
    month's limit."""
    from app.core.llm import monthly_usage
    from app.db.collections import penny_topups_col

    async def _penny_usage(email: str, ym: str) -> int:
        usage = await monthly_usage(email, ym)
        return int(usage.get("penny_messages") or 0)

    return await _settle_packs(
        email, now, col=penny_topups_col,
        tier_limit_key="penny_messages_per_month", usage_fn=_penny_usage,
        persist=persist,
    )


async def _mcp_call_count(email: str, ym: str) -> int:
    """This calendar month's /mcp `tools/call` count for `email`, read from
    the F14 per-(user_id, year_month) counter doc (`mcp_call_counters_col`)
    rather than counting `mcp_calls_col` rows — the audit log TTLs out
    after MCP_AUDIT_TTL_DAYS (app/main.py), so counting rows would let
    expiry silently reset a user's usage mid-cycle. Returns 0 if no
    counter doc exists yet for this (user, month) pair (a user with no
    calls this month, or a month that predates F14 and was never seeded
    by _seed_mcp_call_counters)."""
    from app.db.collections import mcp_call_counters_col
    doc = await mcp_call_counters_col.find_one({"user_id": email, "year_month": ym})
    return int(doc["count"]) if doc else 0


async def settle_mcp_packs(email: str, now: datetime, *, persist: bool = True) -> list[dict]:
    """Thin wrapper around `_settle_packs` for MCP connector call packs
    (`mcp_call_packs_col`, F9). Usage is read via `_mcp_call_count` (F14:
    the durable per-month counter, not `mcp_calls_col` row counts) rather
    than through `app.core.llm.monthly_usage`, which only knows about LLM
    pipelines. See `mcp_allowance` for how the result is folded into this
    month's limit, and `_settle_packs` for `persist=False` (B23)."""
    from app.db.collections import mcp_call_packs_col

    async def _mcp_usage(email: str, ym: str) -> int:
        return await _mcp_call_count(email, ym)

    return await _settle_packs(
        email, now, col=mcp_call_packs_col,
        tier_limit_key="mcp_tool_calls_per_month", usage_fn=_mcp_usage,
        persist=persist,
    )


async def penny_allowance(email: str, *, persist: bool = True) -> dict:
    """This calendar month's Penny message allowance for `email`: the
    user's tier limit (`penny_messages_per_month`, None = unlimited) plus
    the total `remaining` balance of every active (unexpired, unsettled
    overflow already deducted) top-up pack, measured against
    `app.core.llm.monthly_usage`'s distinct-penny-message-id count.

    Packs (`penny_topups_col`, see `settle_topups` above) last 90 days
    from purchase and draw down only AFTER the tier's own monthly
    allowance is used up — `settle_topups` is what actually performs that
    draw-down for past months; this month's overflow doesn't need a pack
    write yet because `limit` already folds the active packs' remaining
    balance straight in.

    Returns `{"tier", "limit" (tier limit + active pack remaining, None
    when the tier itself is unlimited), "used", "remaining" (None when
    unlimited), "resets_on" ("YYYY-MM-DD", the 1st of next month UTC),
    "topup_messages" (active pack remaining total, 0 if none),
    "topup_expires_soonest" (ISO date of the soonest-expiring ACTIVE pack,
    or None), "packs_bought_this_month" (count of packs with this
    calendar month as their purchase month, any source)}`.

    Both cross-module reads (`penny_topups_col`, `monthly_usage`) are
    imported lazily inside the function, matching this module's own
    `get_subscription`/`check_connection_limit` convention above, so a
    test can monkeypatch either module's attribute and have it picked up
    here without a fresh top-level import cycle.

    `persist=False` (B23) computes the exact same numbers — including
    what past-month pack settlement WOULD produce — but never writes that
    settlement to `penny_topups_col`. Every ordinary caller (GET
    /subscription, can_i.py, penny_chips.py) keeps the default
    `persist=True` and performs the write as before; only B20's broadcast
    audience "penny_cap" filter reads with `persist=False`, since a
    preview must never mutate a candidate user's pack records just by
    evaluating whether they match."""
    from app.core.llm import monthly_usage

    sub = await get_subscription(email)
    tier_limit = sub.limit("penny_messages_per_month")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")

    packs = await settle_topups(email, now, persist=persist)

    active_packs = [
        p for p in packs
        if int(p.get("remaining") or 0) > 0
        and (p.get("expires_at") is None or p["expires_at"] > now)
    ]
    topup_messages = sum(int(p.get("remaining") or 0) for p in active_packs)
    expiring_dates = [p["expires_at"] for p in active_packs if p.get("expires_at")]
    topup_expires_soonest = min(expiring_dates).date().isoformat() if expiring_dates else None
    packs_bought_this_month = sum(1 for p in packs if (p.get("year_month") or "") == ym)

    limit = None if tier_limit is None else tier_limit + topup_messages

    usage = await monthly_usage(email, ym)
    used = int(usage.get("penny_messages") or 0)
    remaining = None if limit is None else max(0, limit - used)

    if now.month == 12:
        resets_on = date(now.year + 1, 1, 1)
    else:
        resets_on = date(now.year, now.month + 1, 1)

    return {
        "tier": sub.tier_name,
        "limit": limit,
        "used": used,
        "remaining": remaining,
        "resets_on": resets_on.isoformat(),
        "topup_messages": topup_messages,
        "topup_expires_soonest": topup_expires_soonest,
        "packs_bought_this_month": packs_bought_this_month,
    }


async def mcp_allowance(email: str, *, persist: bool = True) -> dict:
    """This calendar month's MCP connector call allowance for `email` — the
    F9 twin of `penny_allowance` above, sharing `_settle_packs` via
    `settle_mcp_packs`. Only Connect and Max have `mcp_tool_calls_per_month`
    set at all (0 for every tier below); a tier without the connector gets
    NO pack credit folded in even if it somehow holds an active pack
    (`limit` stays 0), since a pack only makes sense on top of a tier that
    already has the connector.

    Returns `{"tier", "limit" (tier limit + active pack remaining; None
    when the tier itself is unlimited; 0 stays 0, packs not applied),
    "used" (this month's `mcp_call_counters_col` count, F14), "remaining"
    (None when unlimited), "resets_on" ("YYYY-MM-DD", the 1st of next month
    UTC), "pack_calls" (active pack remaining total, 0 if none — reported
    even when the tier is 0 and it isn't folded into `limit`, so the UI can
    still explain an unused pack), "pack_expires_soonest" (ISO date of the
    soonest-expiring ACTIVE pack, or None), "packs_bought_this_month"
    (count of packs with this calendar month as their purchase month, any
    source)}`.

    `persist=False` (B23) — same meaning as `penny_allowance`'s own
    parameter: correct, as-if-settled numbers, no write to
    `mcp_call_packs_col`."""
    sub = await get_subscription(email)
    tier_limit = sub.limit("mcp_tool_calls_per_month")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")

    packs = await settle_mcp_packs(email, now, persist=persist)

    active_packs = [
        p for p in packs
        if int(p.get("remaining") or 0) > 0
        and (p.get("expires_at") is None or p["expires_at"] > now)
    ]
    pack_calls = sum(int(p.get("remaining") or 0) for p in active_packs)
    expiring_dates = [p["expires_at"] for p in active_packs if p.get("expires_at")]
    pack_expires_soonest = min(expiring_dates).date().isoformat() if expiring_dates else None
    packs_bought_this_month = sum(1 for p in packs if (p.get("year_month") or "") == ym)

    if tier_limit is None:
        limit = None
    elif tier_limit == 0:
        limit = 0
    else:
        limit = tier_limit + pack_calls

    used = await _mcp_call_count(email, ym)
    remaining = None if limit is None else max(0, limit - used)

    resets_on = _next_month_first_day(now)

    return {
        "tier": sub.tier_name,
        "limit": limit,
        "used": used,
        "remaining": remaining,
        "resets_on": resets_on.isoformat(),
        "pack_calls": pack_calls,
        "pack_expires_soonest": pack_expires_soonest,
        "packs_bought_this_month": packs_bought_this_month,
    }


async def grant_pack(email: str, kind: str, pack_id: str, *, source: str = "purchase") -> dict:
    """Insert one top-up pack doc for `email` — the shared implementation
    behind POST /subscription/admin/topup's catalogue-lookup branch
    (`source="admin"`) and B5's Stripe checkout.session.completed webhook
    handler (`app.services.billing._handle_checkout_completed`,
    `source="purchase"`). `kind` is "penny" (PENNY_TOPUP_PACKS,
    penny_topups_col) or "mcp" (MCP_CALL_PACKS, mcp_call_packs_col);
    `pack_id` must be one of that catalogue's own ids ("small"/"medium"/
    "large" for penny, "mcp_1000" for mcp). Raises ValueError for an
    unknown kind/pack_id rather than a raw KeyError, so a bad Stripe
    metadata value fails with a clear message in the webhook's own log
    rather than a bare 500.

    The stored doc's own `pack_id` field is `pack_id` for a genuine
    purchase, but "admin" for an admin grant — preserving the admin
    route's pre-existing behaviour (an admin grant must never be
    mistaken for a real sale if that distinction matters later; see the
    admin route's own docstring) while a Stripe-driven purchase keeps the
    real pack id for reporting."""
    if kind not in ("penny", "mcp"):
        raise ValueError(f"kind must be 'penny' or 'mcp', got {kind!r}")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")
    stored_pack_id = pack_id if source != "admin" else "admin"

    if kind == "mcp":
        pack = next((p for p in MCP_CALL_PACKS if p["id"] == pack_id), None)
        if pack is None:
            raise ValueError(f"pack_id must be one of: {[p['id'] for p in MCP_CALL_PACKS]}")
        from app.db.collections import mcp_call_packs_col
        doc = {
            "user_id":        email,
            "pack_id":        stored_pack_id,
            "calls":          pack["calls"],
            "remaining":      pack["calls"],
            "price_gbp":      pack["price_gbp"],
            "purchased_at":   now,
            "expires_at":     now + timedelta(days=PENNY_TOPUP_LIFETIME_DAYS),
            "year_month":     ym,
            "source":         source,
            "settled_months": [],
        }
        await mcp_call_packs_col.insert_one(doc)
        return doc

    pack = next((p for p in PENNY_TOPUP_PACKS if p["id"] == pack_id), None)
    if pack is None:
        raise ValueError(f"pack_id must be one of: {[p['id'] for p in PENNY_TOPUP_PACKS]}")
    from app.db.collections import penny_topups_col
    doc = {
        "user_id":        email,
        "pack_id":        stored_pack_id,
        "messages":       pack["messages"],
        "remaining":      pack["messages"],
        "price_gbp":      pack["price_gbp"],
        "purchased_at":   now,
        "expires_at":     now + timedelta(days=PENNY_TOPUP_LIFETIME_DAYS),
        "year_month":     ym,
        "source":         source,
        "settled_months": [],
    }
    await penny_topups_col.insert_one(doc)
    return doc


async def check_connection_limit(email: str) -> None:
    """Raise 402 if the user's tier's bank or account cap is exceeded.

    `max_banks` counts completed TrueLayer connections, connected Finexer
    consents, and Yapily consents. `max_accounts` counts `accounts_col`
    docs for the user. Either cap being None means unlimited. With the
    default tier at max, this is a no-op today."""
    from app.db.collections import (
        accounts_col, connections_col, finexer_consents_col, yapily_consents_col,
    )

    sub = await get_subscription(email)
    max_banks = sub.limit("max_banks")
    max_accounts = sub.limit("max_accounts")

    if max_banks is not None:
        tl_count = await connections_col.count_documents({"user_id": email, "access_token": {"$exists": True}})
        finexer_count = await finexer_consents_col.count_documents({"user_id": email, "status": "connected"})
        yap_count = await yapily_consents_col.count_documents({"user_id": email})
        bank_count = tl_count + finexer_count + yap_count
        if bank_count >= max_banks:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "CONNECTION_LIMIT_REACHED",
                    "current_tier": sub.tier_name,
                    "limit": max_banks,
                    "kind": "banks",
                    "message": f"Your {sub.tier_name.title()} plan allows up to {max_banks} connected banks.",
                },
            )

    if max_accounts is not None:
        account_count = await accounts_col.count_documents({"user_id": email})
        if account_count >= max_accounts:
            raise HTTPException(
                status_code=402,
                detail={
                    "code": "CONNECTION_LIMIT_REACHED",
                    "current_tier": sub.tier_name,
                    "limit": max_accounts,
                    "kind": "accounts",
                    "message": f"Your {sub.tier_name.title()} plan allows up to {max_accounts} connected accounts.",
                },
            )


async def check_open_banking_allowed(email: str) -> None:
    """Raise 402 if the user's tier has no open banking at all (Statements
    tier today). Called at the top of every bank-connect link endpoint,
    immediately before `check_connection_limit`, so a Statements-tier user
    is turned away before we spend a round trip talking to the provider."""
    sub = await get_subscription(email)
    if sub.limit("open_banking") is False:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "OPEN_BANKING_NOT_IN_TIER",
                "current_tier": sub.tier_name,
                "kind": "open_banking",
                "message": f"Bank connections are not included in the {sub.tier_name.title()} plan.",
            },
        )


def _next_month_first_day(now: datetime) -> date:
    if now.month == 12:
        return date(now.year + 1, 1, 1)
    return date(now.year, now.month + 1, 1)


async def check_statement_upload_allowed(email: str) -> None:
    """Raise 402 if the user's tier caps statement uploads per calendar
    month (`statement_uploads_per_month`, None = unlimited) and this
    month's count in `statement_uploads_col` has already reached it.

    Called before any file parsing or LLM call in the upload handlers, so
    a capped user's rejected upload costs nothing."""
    from app.db.collections import statement_uploads_col

    sub = await get_subscription(email)
    limit = sub.limit("statement_uploads_per_month")
    if limit is None:
        return

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")
    used = await statement_uploads_col.count_documents({"user_id": email, "year_month": ym})
    if used >= limit:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "STATEMENT_UPLOAD_LIMIT_REACHED",
                "current_tier": sub.tier_name,
                "limit": limit,
                "used": used,
                "kind": "statement_uploads",
                "resets_on": _next_month_first_day(now).isoformat(),
                "message": (
                    f"You have used this month's {limit} statement uploads. "
                    f"More are available from {_next_month_first_day(now).isoformat()}."
                ),
            },
        )


async def record_statement_upload(
    email: str, *, kind: str, filename: str, region: str, account_id: str,
) -> None:
    """Record one successful statement/M-Pesa upload against the calendar
    month it happened in, for `check_statement_upload_allowed` to count
    against. Only call this after a parse-and-store succeeds; a failed
    parse must not count against the monthly cap."""
    from app.db.collections import statement_uploads_col

    now = datetime.now(timezone.utc)
    await statement_uploads_col.insert_one({
        "user_id": email,
        "uploaded_at": now,
        "year_month": now.strftime("%Y-%m"),
        "kind": kind,
        "filename": filename,
        "region": region,
        "account_id": account_id,
    })
