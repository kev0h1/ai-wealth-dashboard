#!/usr/bin/env python3
"""C43: build the synthetic Apple App Review demo account.

Idempotent: it deletes and rebuilds ONLY documents belonging to the demo user
(app.core.config.DEMO_LOGIN_EMAIL), across every per-user collection in
app.db.collections.ERASURE_MANIFEST, then writes a realistic invented UK
account dated relative to today (Europe/London, app.core.timeutil):

* an everyday current account, a bills account, an easy-access saver and a credit card;
* about three months of transactions: monthly salary, rent, council tax,
  energy, water, phone, broadband, three subscriptions, groceries, eating out,
  transport, card repayments, a monthly transfer to the saver, interest and
  a few one-offs;
* one goal (summer holiday), one set-aside plan (the monthly saver transfer),
  card terms, a manual full-tier (Plus) subscription grant and the profile name
  "App Reviewer".

Everything is invented. The accounts carry provider "Demo" and no connection
or consent id, so no sync path (which walks connections and consents) can ever
find them, and the demo identity is refused by every sync and consent route
anyway (app.core.demo).

After writing, it runs the app's own compute-on-change recompute in-process
(cashflow patterns, then warm_user), so Home, Upcoming and Spend have stored
results the moment the reviewer signs in.

Usage, from backend/ (Kevin runs it against production; tests run it against a
disposable wealth_test_* database in a subprocess):

    MONGO_DB=<name> .venv/bin/python scripts/seed_demo_account.py --confirm --db-name <name>

--db-name must equal the MONGO_DB the process resolved, and --confirm is
required. It prints the database NAME and counts only: never a URI, a hash or
a password. It refuses to run if the demo user owns a bank connection or
consent (a real person, not the synthetic account).
"""
from __future__ import annotations

import argparse
import asyncio
import calendar
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

PROFILE_NAME = "App Reviewer"
HISTORY_DAYS = 92
PAY_DAY = 28
SALARY = 2400.00
CURRENT_ID = "demo-acc-current"
BILLS_ID = "demo-acc-bills"
BILLS_TRANSFER = 1480.00
SAVER_ID = "demo-acc-saver"
CARD_ID = "demo-acc-card"
# Balances are not constants: each is the figure carried into the pay period
# plus everything posted since payday (see build_transactions), so the same
# story reads the same on every day of the period (H157).
CURRENT_CARRY = 150.00
BILLS_CARRY = 20.00
SAVER_CARRY = 4215.60
CARD_STATEMENT_CLOSE_DAY = 6
CARD_PAYMENT_DAY = 20

# Collections in ERASURE_MANIFEST that are shared or operational: nothing in
# them belongs to a person, and some are keyed by an email as _id (allowed
# sign-ups, bot credentials), so the `_id == email` sweep must never touch
# them. The `user_id == email` sweep is still applied to every collection.
_NO_ID_SWEEP = frozenset({
    "allowed_signups_col", "bot_credentials_col", "bot_credential_uses_col", "bot_credential_unknown_col",
    "settings_col", "settings_audit_col", "ops_audit_col", "oauth_clients_col", "oauth_codes_col",
    "oauth_tokens_col", "instrument_prices_col", "tip_research_col", "vendors_col", "vendor_claims_col",
    "orphaned_revocations_col", "health_samples_col", "alert_state_col", "error_types_seen_col",
    "provider_logos_col", "finexer_providers_col", "llm_global_usage_col", "broadcasts_col",
})


# ---------------------------------------------------------------------------
# dates


def _month_start(d: date, offset: int) -> date:
    idx = d.year * 12 + (d.month - 1) + offset
    return date(idx // 12, idx % 12 + 1, 1)


def monthly_dates(day: int, today: date, window_start: date) -> list[date]:
    """Every occurrence of day-of-month `day` inside [window_start, today]."""
    out = []
    for k in range(-5, 1):
        m = _month_start(today, k)
        d = date(m.year, m.month, min(day, calendar.monthrange(m.year, m.month)[1]))
        if window_start <= d <= today:
            out.append(d)
    return out


def next_business_day(d: date) -> date:
    """Direct debits do not post on a weekend or an England and Wales bank holiday: they
    land on the next working day. Uses the engine's own holiday set so the seed and the
    engine's expected dates agree."""
    from app.routers.analytics import UK_BANK_HOLIDAYS_EW
    while d.weekday() >= 5 or d.isoformat() in UK_BANK_HOLIDAYS_EW:
        d += timedelta(days=1)
    return d


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day)


# ---------------------------------------------------------------------------
# transaction generation (pure, so tests can inspect it without a database)


class _Txns:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, account_id: str, d: date, amount: float, kind: str, merchant: str, category: str,
            description: str | None = None) -> None:
        self.rows.append({
            "account_id": account_id, "date": d, "amount": round(float(amount), 2),
            "transaction_type": kind, "merchant": merchant, "description": description or merchant,
            "category": category,
        })


def build_transactions(today: date) -> tuple[list[dict], dict]:
    """Return (transactions, facts). Deterministic for a given `today`: no randomness at all (H157).

    Amounts are fixed and spending follows the weekday and the day of the month, so
    the same pay-period day looks the same whichever month it is seeded in.
    """
    start = today - timedelta(days=HISTORY_DAYS)
    t = _Txns()

    def monthly(day, account, amount, kind, merchant, category, description=None, roll=True):
        for d in monthly_dates(day, today, start):
            posted = next_business_day(d) if roll else d
            if posted <= today:
                t.add(account, posted, amount, kind, merchant, category, description)

    # Income and fixed bills, current account.
    monthly(PAY_DAY, CURRENT_ID, SALARY, "credit", "BRIGHTWATER SOLUTIONS LTD", "Income", "BRIGHTWATER SOLUTIONS LTD SALARY", roll=False)
    monthly(1, BILLS_ID, 1150.00, "debit", "FOXGLOVE LETTINGS", "Rent", "FOXGLOVE LETTINGS RENT")
    monthly(2, BILLS_ID, 165.00, "debit", "WILLOWMERE DISTRICT COUNCIL", "Bills", "WILLOWMERE DISTRICT COUNCIL COUNCIL TAX")
    monthly(5, BILLS_ID, 140.00, "debit", "SPARKWELL ENERGY", "Bills", "SPARKWELL ENERGY DIRECT DEBIT")
    monthly(24, BILLS_ID, 31.00, "debit", "CLEARBROOK WATER", "Bills", "CLEARBROOK WATER DIRECT DEBIT")
    monthly(24, BILLS_ID, 24.00, "debit", "BLUEWAVE MOBILE", "Bills", "BLUEWAVE MOBILE DIRECT DEBIT")
    monthly(24, BILLS_ID, 29.99, "debit", "FIBREHOME BROADBAND", "Bills", "FIBREHOME BROADBAND DIRECT DEBIT")
    monthly(24, BILLS_ID, 32.00, "debit", "FORMFIT GYM", "Health", "FORMFIT GYM MEMBERSHIP")

    # Each payday the main account tops up the bills account, both legs.
    for d0 in monthly_dates(PAY_DAY + 1, today, start):
        d = next_business_day(d0)
        if d > today:
            continue
        t.add(CURRENT_ID, d, BILLS_TRANSFER, "debit", "BILLS ACCOUNT", "Transfer", "STANDING ORDER BILLS ACCOUNT")
        t.add(BILLS_ID, d, BILLS_TRANSFER, "credit", "FROM EVERYDAY CURRENT", "Transfer", "STANDING ORDER FROM EVERYDAY CURRENT")

    # The regular transfer to the saver, both legs, and the saver's interest.
    for d in monthly_dates(PAY_DAY + 1, today, start):
        t.add(CURRENT_ID, d, 150.00, "debit", "EASY ACCESS SAVER", "Transfer", "STANDING ORDER EASY ACCESS SAVER")
        t.add(SAVER_ID, d, 150.00, "credit", "FROM EVERYDAY CURRENT", "Transfer", "STANDING ORDER FROM EVERYDAY CURRENT")
    for d in monthly_dates(1, today, start):
        t.add(SAVER_ID, d, 12.40, "credit", "INTEREST PAID", "Income", "GROSS INTEREST")

    # Subscriptions, on the card.
    monthly(9, CARD_ID, 10.99, "debit", "STREAMBOX", "Subscriptions", "STREAMBOX MONTHLY")
    monthly(14, CARD_ID, 11.99, "debit", "TUNEHOUSE", "Subscriptions", "TUNEHOUSE PREMIUM")
    monthly(21, CARD_ID, 2.99, "debit", "PIXELCLOUD STORAGE", "Subscriptions", "PIXELCLOUD STORAGE 200GB")

    # Day-to-day spending: fixed amounts on fixed weekdays and days of the month.
    day = start
    while day <= today:
        wd = day.weekday()
        if wd == 5:
            t.add(CURRENT_ID, day, 22.00, "debit", "FRESHFIELD SUPERMARKET", "Groceries")
            t.add(CARD_ID, day, 24.50, "debit", "THE ANCHOR INN", "Eating Out")
        if wd in (0, 4):
            t.add(CURRENT_ID, day, 3.60, "debit", "KESTREL COFFEE", "Eating Out")
        if wd == 1:
            t.add(CURRENT_ID, day, 3.40, "debit", "CITYLINK TRAVEL", "Transport")
        day += timedelta(days=1)

    # One-off, on the current account, dated by day of month so it does not drift.
    for d in monthly_dates(11, today, start)[:1]:
        t.add(CURRENT_ID, d, 65.00, "debit", "BRIGHTSMILE DENTAL", "Health")

    # Card repayments: the statement closes on the 6th and is paid in full on
    # the 20th, from the current account. Amounts are the cycle's own spending.
    card_spend = [r for r in t.rows if r["account_id"] == CARD_ID and r["transaction_type"] == "debit"]
    for pay in monthly_dates(CARD_PAYMENT_DAY, today, start):
        close = _month_start(pay, 0).replace(day=CARD_STATEMENT_CLOSE_DAY)
        prev_close = _month_start(pay, -1).replace(day=CARD_STATEMENT_CLOSE_DAY)
        owed = round(sum(r["amount"] for r in card_spend if prev_close < r["date"] <= close), 2)
        if owed < 50:
            continue
        posted = next_business_day(pay)
        if posted > today:
            continue
        t.add(CURRENT_ID, posted, owed, "debit", "RAINBOW CARD PAYMENT", "Debt", "RAINBOW CARD PAYMENT DIRECT DEBIT")
        t.add(CARD_ID, posted, owed, "credit", "PAYMENT RECEIVED", "Transfer", "PAYMENT RECEIVED THANK YOU")

    # The card balance is what has been spent since the last statement paid.
    last_pay = max((r["date"] for r in t.rows if r["account_id"] == CARD_ID and r["transaction_type"] == "credit"), default=None)
    if last_pay is not None:
        last_close = _month_start(last_pay, 0).replace(day=CARD_STATEMENT_CLOSE_DAY)
        card_owed = sum(r["amount"] for r in card_spend if r["date"] > last_close)
    else:
        card_owed = sum(r["amount"] for r in card_spend)
    pstart = _period_start(today)

    def carried(account: str, carry: float) -> float:
        posted = sum(r["amount"] if r["transaction_type"] == "credit" else -r["amount"]
                     for r in t.rows if r["account_id"] == account and pstart <= r["date"] <= today)
        return round(carry + posted, 2)

    facts = {
        "card_owed": round(card_owed, 2), "window_start": start,
        "balances": {
            CURRENT_ID: carried(CURRENT_ID, CURRENT_CARRY),
            BILLS_ID: carried(BILLS_ID, BILLS_CARRY),
            SAVER_ID: carried(SAVER_ID, SAVER_CARRY),
        },
    }
    return t.rows, facts


# ---------------------------------------------------------------------------
# database work


def _period_start(today: date) -> date:
    return today.replace(day=PAY_DAY) if today.day >= PAY_DAY else _month_start(today, -1).replace(day=PAY_DAY)


def _goal_target(today: date) -> date:
    m = _month_start(today, 8)
    return date(m.year, m.month, min(30, calendar.monthrange(m.year, m.month)[1]))


async def wipe_demo_documents(uid: str) -> int:
    """Delete only this user's documents, in every ERASURE_MANIFEST collection."""
    from app.db import collections as dbc
    from app.db.collections import ERASURE_MANIFEST
    removed = 0
    for name in sorted(ERASURE_MANIFEST):
        col = getattr(dbc, name, None)
        if col is None:
            continue
        flt: dict = {"user_id": uid} if name in _NO_ID_SWEEP else {"$or": [{"user_id": uid}, {"_id": uid}]}
        res = await col.delete_many(flt)
        removed += res.deleted_count
    return removed


async def seed(uid: str | None = None, today: date | None = None) -> dict:
    """Wipe and rebuild the demo user's data. Returns counts only."""
    from app.core import config, timeutil
    from app.db import collections as dbc

    uid = (uid or config.DEMO_LOGIN_EMAIL).strip().lower()
    if uid != config.DEMO_LOGIN_EMAIL:
        raise SystemExit("Refusing: the seeder only ever builds the configured demo user.")
    today = today or timeutil.user_today()

    # A real person must never be wiped: the demo user owns no bank connection.
    for col in (dbc.connections_col, dbc.finexer_consents_col, dbc.yapily_consents_col):
        if await col.count_documents({"user_id": uid}, limit=1):
            raise SystemExit("Refusing: the demo user owns a bank connection, so this is not the synthetic account.")

    removed = await wipe_demo_documents(uid)

    txns, facts = build_transactions(today)
    now_utc = datetime.now(timezone.utc)  # naive-ok: persisted aware UTC stamp
    common = {"user_id": uid, "currency": "GBP", "status": "connected", "provider": "Demo", "source": "demo"}
    await dbc.accounts_col.insert_many([
        {"_id": CURRENT_ID, "name": "Everyday Current", "type": "BANK", "subtype": "TRANSACTION",
         "balance": facts["balances"][CURRENT_ID], "include_in_safe_to_spend": True, "overdraft_limit": 250.0,
         "balance_as_of": now_utc, **common},
        {"_id": BILLS_ID, "name": "Bills Account", "type": "BANK", "subtype": "TRANSACTION",
         "balance": facts["balances"][BILLS_ID], "include_in_safe_to_spend": True, "balance_as_of": now_utc, **common},
        {"_id": SAVER_ID, "name": "Easy Access Saver", "type": "BANK", "subtype": "SAVINGS",
         "balance": facts["balances"][SAVER_ID], "include_in_safe_to_spend": True, "balance_as_of": now_utc, **common},
        {"_id": CARD_ID, "name": "Rainbow Credit Card", "type": "CREDIT", "subtype": "CREDIT_CARD",
         "balance": -facts["card_owed"], "credit_limit": 3000.0, "include_in_safe_to_spend": True,
         "balance_as_of": now_utc, **common},
    ])

    from app.services.categorisation import canonical_merchant_key
    docs = []
    for i, r in enumerate(sorted(txns, key=lambda r: (r["date"], r["account_id"], r["merchant"])), start=1):
        d = _dt(r["date"])
        docs.append({
            "_id": f"demo-txn-{i:04d}", "user_id": uid, "account_id": r["account_id"], "date": d,
            "amount": r["amount"], "currency": "GBP", "description": r["description"],
            "merchant_name": r["merchant"], "category": r["category"], "custom_category": None,
            "transaction_type": r["transaction_type"], "provider": "Demo",
            "merchant_key": canonical_merchant_key(r["merchant"], r["description"]),
            "first_seen": d, "activity_date": d,
        })
    await dbc.transactions_col.insert_many(docs)

    from app.routers.profile import tokenise_name
    await dbc.user_profiles_col.insert_one({
        "_id": uid, "full_name": PROFILE_NAME, "name_tokens": tokenise_name(PROFILE_NAME),
        "onboarding_complete": True,
    })
    await dbc.preferences_col.insert_one({
        "user_id": uid, "pay_period_config": {"type": "monthly_pay_date", "day": PAY_DAY}, "income_streams": [],
    })
    await dbc.card_terms_col.insert_one({
        "user_id": uid, "account_id": CARD_ID, "status": "confirmed", "apr_pct": 21.9, "promos": [],
        "bt_offers": [], "statement_close_day": CARD_STATEMENT_CLOSE_DAY, "payment_due_day": CARD_PAYMENT_DAY, "payment_due_days_after_close": None,
        "payment_method": "full", "payment_account_id": CURRENT_ID, "fixed_payment_amount": None,
        "usage": "clear_monthly",
    })
    await dbc.commitments_col.insert_one({
        "_id": "demo-goal-holiday", "user_id": uid, "name": "Summer holiday", "amount": 1800.0,
        "target_date": _goal_target(today).isoformat(),
        "status": "active", "source": "manual", "contributed": 0.0, "created_at": _dt(today - timedelta(days=60)),
        "funding_pots": [{"account_id": SAVER_ID, "kind": "connected", "baseline": 1200.0, "count_existing": False}],
        "source_account_id": CURRENT_ID,
    })
    await dbc.allocations_col.insert_one({
        "_id": "demo-plan-saver", "user_id": uid, "name": "Monthly saving", "amount_per_period": 150.0,
        "fill_account_id": SAVER_ID, "fill_display_name": "Easy Access Saver", "source_account_id": CURRENT_ID,
        "match_type": "description_contains", "match_value": "EASY ACCESS SAVER",
        "effective_from": _dt(_period_start(today)), "recurrence": "every_period", "active": True,
        "created_at": _dt(today - timedelta(days=60)),
    })

    # Full-tier access: the same manual grant the owner's People page writes.
    from app.services.subscription_admin import set_manual_tier
    await set_manual_tier(uid, "plus")

    # Compute on change (H145): recompute the cashflow patterns, then the warm
    # set (Left to spend, Today items, cover plan, verdict, grow, goals).
    from app.routers.analytics import compute_and_cache_cashflow
    from app.services import data_version, response_cache
    from app.services.warmup import warm_user
    await response_cache.ainvalidate(uid)
    await compute_and_cache_cashflow(uid)
    warmed = await warm_user(uid)
    await data_version.bump(uid)

    return {
        "removed": removed, "accounts": 4, "transactions": len(docs), "goals": 1, "plans": 1,
        "warmed": len(warmed.get("warmed", [])), "failed": len(warmed.get("failed", [])),
    }


def parse_args(argv=None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Seed the synthetic App Review demo account (C43).")
    p.add_argument("--confirm", action="store_true", help="required: acknowledge this wipes and rebuilds the demo user")
    p.add_argument("--today", default="", help="test aid only: build the account as of YYYY-MM-DD instead of today")
    p.add_argument("--db-name", default="", help="required: must equal the MONGO_DB this process resolved")
    return p.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    if not args.confirm:
        print("Refusing: pass --confirm to wipe and rebuild the demo user's data.", file=sys.stderr)
        return 2
    from app.core import config, timeutil
    if not args.db_name or args.db_name != config.MONGO_DB:
        print("Refusing: --db-name does not match the database this process is configured for.", file=sys.stderr)
        return 2
    print(f"Target database: {config.MONGO_DB}")
    pinned = date.fromisoformat(args.today) if args.today else None
    if pinned is not None and pinned > timeutil.user_today() and os.environ.get("DEMO_SEED_ALLOW_FUTURE_TODAY") != "1":
        print("Refusing: --today is later than today (test aid only; set DEMO_SEED_ALLOW_FUTURE_TODAY=1 in tests).", file=sys.stderr)
        return 2
    result = asyncio.run(seed(today=pinned))
    print("Seeded: " + ", ".join(f"{k}={v}" for k, v in result.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
