"""Subscription tiers and feature limits (data only, no enforcement beyond
connection limits). See CLAUDE.md "Codex design round" section for the
retirement of the old free/pro/premium/family tiers.

Tiers: Statements (free, statement upload only) < Lite < Standard < Connect
< Max. Nobody should be restricted before launch — the tier a user gets
when they have no subscription doc (or an expired/unrecognised one) is
DEFAULT_TIER (app.core.config), which defaults to "max"."""
import logging
from datetime import date, datetime, timezone
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
    def __init__(self, tier: Tier, status: str = "active"):
        self.tier = tier
        self.status = status
        self.limits = TIER_LIMITS[tier]

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
    if not doc or doc.get("status") == "expired":
        return Subscription(default_tier)

    expires_at = doc.get("expires_at")
    if expires_at and expires_at < datetime.now(timezone.utc):
        return Subscription(default_tier)

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

    return Subscription(tier, doc.get("status", "active"))


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


async def settle_topups(email: str, now: datetime) -> list[dict]:
    """Lazily settle every PAST calendar month (up to but excluding the
    current one) that this user's top-up packs haven't already accounted
    for, attributing each month's overflow (messages used past the tier's
    own allowance that month) to the OLDEST covering pack's `remaining`
    first. Idempotent: each (pack, month) pair is written at most once,
    tracked in the pack doc's own `settled_months` list, so re-running
    this for a month already settled is a no-op check with no DB write.

    The current month is never settled here — its usage is still moving,
    so `penny_allowance` reads it live (this month's overflow is simply
    tier_limit vs used, no pack draw-down needed against it beyond the
    ordinary `limit = tier_limit + topup_messages` sum below). Returns the
    user's full (possibly just-mutated) list of top-up pack docs so
    `penny_allowance` doesn't have to re-query."""
    from app.core.llm import monthly_usage
    from app.db.collections import penny_topups_col

    packs = [doc async for doc in penny_topups_col.find({"user_id": email})]
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

        tier_limit = (await get_subscription(email)).limit("penny_messages_per_month")
        if tier_limit is None:
            overflow = 0
        else:
            usage = await monthly_usage(email, ym)
            overflow = max(0, int(usage.get("penny_messages") or 0) - tier_limit)

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
            await penny_topups_col.update_one(
                {"_id": p["_id"]},
                {"$set": {"remaining": new_remaining, "settled_months": settled_months}},
            )

        for p in not_covering:
            settled_months = list(p.get("settled_months") or []) + [ym]
            p["settled_months"] = settled_months
            await penny_topups_col.update_one(
                {"_id": p["_id"]}, {"$set": {"settled_months": settled_months}},
            )

        ym = _ym_after(ym)

    return packs


async def penny_allowance(email: str) -> dict:
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
    here without a fresh top-level import cycle."""
    from app.core.llm import monthly_usage

    sub = await get_subscription(email)
    tier_limit = sub.limit("penny_messages_per_month")

    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")

    packs = await settle_topups(email, now)

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
