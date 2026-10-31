"""G366 (money engine step 4): account positions derived from the walk output.

`tests/fixtures/account_position_golden.json` was captured from the OLD code
(POSITION_GOLDEN_DUMP=1, one-off, committed before any production change): the
exact `closing_by_account`, `low_point_by_account` and full
`account_eligibility_out` that `compute_today_items` produced, on a fixture
exercising every difference between the hand assembly and the walk results:

  idle      an account with no events at all (not walked; closing is live)
  pot       an inflow-only account (a funded inflow seeds it at its live balance)
  salary    the preview salary account (no bill; seeded by the preview salary)
  barclays  plans that overlap a movement to the plan's destination: uncertain
  natwest   a recent-transfers source: estimated
  idle      also carries a plan with no readable amount: uncertain
  hsbc      a chosen plan, certain, reserving from a short account
  excl      a G231-excluded account: never an entry
"""
import asyncio
import json
import os
from datetime import timedelta
from pathlib import Path

import pytest

import app.db.collections as db_collections
import app.routers.analytics as analytics
import app.services.account_position as account_position
import app.services.companion as companion
from app.routers.analytics import PATTERNS_VERSION
from tests import test_account_walk as tw
from tests.test_internal_inflows import FakeCol

UID = tw.UID
TODAY = tw.TODAY
GOLDEN = Path(__file__).parent / "fixtures" / "account_position_golden.json"

ACCOUNTS = [dict(a) for a in tw.ACCOUNTS] + [
    {"_id": "salary", "user_id": UID, "balance": 300.0, "subtype": "current"},
]


def _resp():
    r = tw._resp()
    for i in r["upcoming_income"]:
        if i["name"] == "ACME":
            i["account_id"] = "salary"
    for b in r["upcoming_bills"]:
        if b["name"] == "To Pot":
            b["dest_account_id"] = "pot"
    return r


def _plan(src, remaining, *, basis="chosen", dests=("man1",), period=None, kind="allocation"):
    return {
        "kind": kind, "active": True, "source_account_id": src, "source_basis": basis,
        "destination_account_ids": list(dests), "remaining": remaining,
        "period_amount": remaining if period is None else period, "filled_amount": 0,
    }


PLANS = [
    _plan("barclays", 300.0, dests=("pot",)),                   # overlaps the To Pot movement: uncertain
    _plan("natwest", 40.0, basis="recent-transfers"),            # estimated
    _plan("hsbc", 20.0),                                         # certain
    _plan("idle", 10.0, period=-1.0),                    # unreadable amount: uncertain
]


def _norm(x):
    return json.loads(json.dumps(x, default=str, sort_keys=True))


def _setup(monkeypatch, plans=None):
    from app.core import timeutil
    from datetime import date
    import app.services.income as income
    import app.services.pay_period as pay_period
    import app.services.pace as pace_module

    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, cfg: today_d + timedelta(days=tw.DAYS_TO_PAY))

    async def fake_resp(cached, uid=None, prefs=None):
        return _resp()

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]))
    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    monkeypatch.setattr(companion, "preferences_col", FakeCol([json.loads(json.dumps(tw.PREFS))]))
    monkeypatch.setattr(companion, "accounts_col", FakeCol([dict(a) for a in ACCOUNTS]))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol(tw.YAPILY))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol(tw.MANUAL))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([json.loads(json.dumps(tw.PREFS))]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))
    use = PLANS if plans is None else plans

    async def _plans(uid, goals=False, strict=False):
        return [dict(p) for p in use]

    monkeypatch.setattr(companion, "_load_account_plans", _plans)


def _capture(monkeypatch, plans=None):
    """What compute_today_items produced: the kernel's arguments (the closing
    and low-point maps) and the whole `account_eligibility_out`."""
    _setup(monkeypatch, plans)
    store: dict = {}
    real = account_position.compute_account_positions

    def spy(plans_, closing, **kw):
        store["closing_by_account"] = list(closing.items())
        store["low_point_by_account"] = list((kw.get("low_point_by_account") or {}).items())
        return real(plans_, closing, **kw)

    monkeypatch.setattr(account_position, "compute_account_positions", spy)
    eligibility: dict = {}
    asyncio.run(companion.compute_today_items(
        UID, payday_preview=True, persist=False, account_eligibility_out=eligibility,
    ))
    store["account_eligibility_out"] = list(eligibility.items())
    return _norm(store)


def test_dump_golden(monkeypatch):
    """Only runs with POSITION_GOLDEN_DUMP=1 (used once, on the pre-change code)."""
    if not os.environ.get("POSITION_GOLDEN_DUMP"):
        pytest.skip("golden capture is a one-off")
    GOLDEN.write_text(json.dumps(_capture(monkeypatch), indent=1, sort_keys=True) + "\n")
