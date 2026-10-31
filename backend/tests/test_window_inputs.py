"""G364 (money engine step 2): the one window-inputs builder.

Three callers used to hand-copy the same preamble (analytics.at_risk_count,
companion.compute_today_items, spend_impact._cashflow_window). This file pins
that the shared builder (`app.services.window_inputs`) hands every caller
exactly what its own preamble computed before the extraction:

  - `tests/fixtures/window_inputs_golden.json` was captured from the OLD,
    hand-copied code on one fixture (the lists each caller fed to
    `funded_inflows`, the events each walk consumed, and the result). The
    callers are re-run here and must reproduce it byte for byte, in order.
  - `build_window_inputs` is then called directly with each caller's
    documented keyword settings and must produce the same lists.
  - Each documented difference keyword is flipped on its own and must change
    exactly the documented thing.
"""
import asyncio
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

import app.core.timeutil as timeutil
import app.db.collections as db_collections
import app.routers.analytics as analytics
import app.services.companion as companion
import app.services.inflow_credit as inflow_credit
import app.services.income as income
import app.services.pay_period as pay_period
import app.services.spend_impact as spend_impact
from app.routers.analytics import PATTERNS_VERSION
from tests.test_internal_inflows import FakeCol

UID = "kevin"
TODAY = date(2026, 11, 2)
DAYS_TO_PAY = 10
GOLDEN = Path(__file__).parent / "fixtures" / "window_inputs_golden.json"


# ── fixture ──────────────────────────────────────────────────────────────────

def _bill(name, days, amount, acct, bal, kind="commitment", card=False, **extra):
    b = {
        "name": name, "days_away": days, "amount": amount, "account_id": acct,
        "account_balance": bal, "is_credit_card": card, "kind": kind,
    }
    b.update(extra)
    return b


def _income(name, days, amount, acct):
    return {
        "name": name, "days_away": days, "amount": amount, "account_id": acct,
        "occurrences": 3, "amounts_recent": [amount, amount, amount],
        "confirmed_alias": None,
    }


def _inflow(days, amount, dest, src="barclays"):
    return {
        "name": "OWN TRANSFER", "amount": amount, "days_away": days,
        "account_id": dest, "source_account_id": src,
    }


def _resp():
    return {
        "upcoming_bills": [
            _bill("Council Tax", 4, 100.0, "hsbc", 10.0),
            _bill("To HSBC", 2, 1758.33, "barclays", 5000.0, kind="movement"),
            _bill("Gym", 3, 60.0, "natwest", 100.0),
            _bill("Amex bill", 5, 80.0, "amex", None, card=True),
            _bill("Unpriced", 6, 20.0, "ghost", None),
            _bill("Rent", DAYS_TO_PAY, 500.0, "barclays", 5000.0),
            _bill("Later", 15, 40.0, "barclays", 5000.0),
            _bill("Yapily bill", 7, 30.0, "yap1", 40.0),
        ],
        "upcoming_income": [
            _income("ACME", 6, 2500.0, "barclays"),
            _income("ACME", DAYS_TO_PAY, 2500.0, "barclays"),
            _income("Late", 12, 100.0, "barclays"),
        ],
        "internal_inflows": [
            _inflow(2, 1758.33, "hsbc"),
            _inflow(DAYS_TO_PAY, 900.0, "hsbc"),
            _inflow(11, 50.0, "hsbc"),
        ],
        "exclusions_unverified": True,
    }


PREFS = {
    "user_id": UID,
    "income_streams": [{"key": "ACME", "status": "confirmed"}],
    "pay_period_config": {"type": "calendar_month"},
}

ACCOUNTS = [
    {"_id": "barclays", "user_id": UID, "balance": 4800.0},
    {"_id": "hsbc", "user_id": UID, "balance": 12.0},
    {"_id": "natwest", "user_id": UID, "balance": 90.0, "include_in_safe_to_spend": False},
    {"_id": "nobal", "user_id": UID, "current_balance": 33.0},
]
YAPILY = [{"_id": "yap1", "user_id": UID, "balance": 75.0}]
MANUAL = [{"_id": "man1", "user_id": UID, "balance": 250.0, "account_type": "savings", "name": "Pot"}]


def _patch_common(monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(
        pay_period, "_next_payday", lambda today_d, cfg: today_d + timedelta(days=DAYS_TO_PAY)
    )

    async def fake_resp(cached, uid=None, prefs=None):
        return _resp()

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)


def _spy_funded(monkeypatch, store):
    real = inflow_credit.funded_inflows

    def spy(inflows, bills, incomes, balances, credit_ok):
        store["funded_args"] = {
            "inflows": list(inflows), "bills": list(bills),
            "incomes": list(incomes), "balances": dict(balances),
        }
        out = real(inflows, bills, incomes, balances, credit_ok)
        store["funded_out"] = list(out)
        return out

    monkeypatch.setattr(inflow_credit, "funded_inflows", spy)
    # companion imported the name at module level before the extraction.
    if hasattr(companion, "funded_inflows"):
        monkeypatch.setattr(companion, "funded_inflows", spy)


def _norm(x):
    return json.loads(json.dumps(x, default=str, sort_keys=True))


def _capture_at_risk(monkeypatch):
    _patch_common(monkeypatch)
    store: dict = {}
    _spy_funded(monkeypatch, store)
    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]),
    )
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([PREFS]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol(ACCOUNTS))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol(YAPILY))
    real_key = companion.walk_sort_key
    seen: list = []

    def spy_key(ev):
        seen.append(ev)
        return real_key(ev)

    monkeypatch.setattr(companion, "walk_sort_key", spy_key)
    result = asyncio.run(analytics.at_risk_count(user={"email": UID}))
    store["events_unsorted"] = list(seen)
    store["result"] = result
    return _norm(store)


def _capture_spend_impact(monkeypatch):
    _patch_common(monkeypatch)
    store: dict = {}
    _spy_funded(monkeypatch, store)
    monkeypatch.setattr(spend_impact, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(spend_impact, "preferences_col", FakeCol([PREFS]))
    monkeypatch.setattr(spend_impact, "accounts_col", FakeCol(ACCOUNTS))
    window = asyncio.run(spend_impact._cashflow_window(UID))
    store["window"] = window
    return _norm(store)


def _capture_companion(monkeypatch):
    _patch_common(monkeypatch)
    store: dict = {}
    _spy_funded(monkeypatch, store)
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]))
    monkeypatch.setattr(companion, "_build_cashflow_response", analytics._build_cashflow_response)
    monkeypatch.setattr(companion, "preferences_col", FakeCol([PREFS]))
    monkeypatch.setattr(companion, "accounts_col", FakeCol(ACCOUNTS))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol(YAPILY))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol(MANUAL))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([PREFS]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))
    real_walk = companion._walk_events

    def spy_walk(events, balances):
        if "events" not in store:
            store["events"] = list(events)
            store["walk_balances"] = dict(balances)
        return real_walk(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy_walk)
    asyncio.run(companion.compute_today_items(UID, persist=False))
    return _norm(store)


CAPTURES = {
    "at_risk": _capture_at_risk,
    "spend_impact": _capture_spend_impact,
    "companion": _capture_companion,
}


def test_dump_golden(monkeypatch):
    """Only runs with WINDOW_INPUTS_DUMP=1 (used once, on the pre-extraction code)."""
    if not os.environ.get("WINDOW_INPUTS_DUMP"):
        pytest.skip("golden capture is a one-off")
    out = {}
    for name, fn in CAPTURES.items():
        with monkeypatch.context() as m:
            out[name] = fn(m)
    GOLDEN.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")
