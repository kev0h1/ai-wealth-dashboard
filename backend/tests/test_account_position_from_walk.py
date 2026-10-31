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


_BASE_RESP = tw._resp


def _resp():
    r = _BASE_RESP()
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


# ── the real caller still produces exactly what it did before ────────────────

def test_compute_today_items_equals_the_pre_change_golden(monkeypatch):
    golden = json.loads(GOLDEN.read_text())
    got = _capture(monkeypatch)
    assert got["closing_by_account"] == golden["closing_by_account"]
    assert got["low_point_by_account"] == golden["low_point_by_account"]
    assert got["account_eligibility_out"] == golden["account_eligibility_out"]


# ── one test per PD difference, flipping only that keyword ───────────────────

from app.services import account_walk as aw  # noqa: E402
from app.services.account_position import (  # noqa: E402
    compute_account_positions,
    compute_account_positions_from_walks as from_walks,
    seed_spend_from,
    source_low_walk,
)


@pytest.fixture
def walks(monkeypatch):
    monkeypatch.setattr(tw, "_resp", _resp)
    monkeypatch.setattr(tw, "ACCOUNTS", ACCOUNTS)
    wi = tw._build_wi(monkeypatch)
    salary = tw._preview_salary(wi)
    events, seed, _c = aw.window_events(wi, inflow_admit="seed_live", preview_salary=salary)
    closing = aw.account_walks(events, seed)
    low = {}
    for acc in tw._eligible_sources(wi):
        sid = acc["_str_id"]
        low[sid] = source_low_walk(sid, wi, wi.live_balances.get(sid, float(acc.get("balance") or 0)))
    return {"wi": wi, "salary": salary, "events": events, "seed": seed, "closing": closing, "low": low}


def _ids(w):
    return list(w["low"])


def test_closing_walks_are_the_walk_events_running(walks):
    running, min_running, _s, _b = aw.walk_events(walks["events"], dict(walks["seed"]))
    assert {a: w.closing for a, w in walks["closing"].items()} == {a: running[a] for a in walks["closing"]}
    assert {a: w.low_point for a, w in walks["closing"].items() if any(not e[3] for e in w.events)} == {
        a: min_running[a] for a, w in walks["closing"].items() if any(not e[3] for e in w.events)
    }


def test_default_positions_equal_the_kernel_on_the_walk_numbers(walks):
    ids = _ids(walks)
    live = walks["wi"].live_balances
    got = from_walks(PLANS, ids, walks["closing"], walks["low"], live_balances=live)
    closing = {s: float(walks["closing"][s].closing) if s in walks["closing"] else float(live.get(s, 0.0)) for s in ids}
    low = {s: walks["low"][s].low_point for s in ids}
    assert got == compute_account_positions(PLANS, closing, low_point_by_account=low)


def test_pd1_accounts_walked_drops_the_accounts_the_walk_never_touched(walks):
    ids = _ids(walks)
    live = walks["wi"].live_balances
    every = from_walks(PLANS, ids, walks["closing"], walks["low"], live_balances=live)
    walked = from_walks(PLANS, ids, walks["closing"], walks["low"], live_balances=live, accounts="walked")
    untouched = [s for s in ids if s not in walks["closing"]]
    assert {"idle", "man1"} <= set(untouched)
    assert set(every) == set(ids) and list(every) == ids
    assert set(walked) == set(ids) - set(untouched)
    assert all(walked[s] == every[s] for s in walked)


def test_pd2_closing_fallback_live_or_none(walks):
    ids = _ids(walks)
    live = walks["wi"].live_balances
    a = from_walks([], ids, walks["closing"], walks["low"], live_balances=live)
    b = from_walks([], ids, walks["closing"], walks["low"], live_balances=live, closing_fallback="none")
    assert a["idle"]["after_payments"] == 15.0 and a["man1"]["after_payments"] == 250.0
    assert b["idle"]["after_payments"] is None and b["idle"]["after_payments_and_plans"] is None
    assert b["idle"]["low_point"] == 15.0  # the low point is the walk's own, untouched
    assert b["barclays"] == a["barclays"]  # a walked account does not use the fallback


def test_pd3_low_point_basis_pre_or_post_reservation(walks):
    ids = _ids(walks)
    live = walks["wi"].live_balances
    pre = from_walks(PLANS, ids, walks["closing"], walks["low"], live_balances=live)
    post = from_walks(
        PLANS, ids, walks["closing"], walks["low"], live_balances=live,
        low_point_basis="post_reservation", reserved_by_source={"hsbc": 20.0},
    )
    assert pre["hsbc"]["low_point"] == 12.0 and pre["hsbc"]["low_point_and_plans"] == -8.0
    # R3 taken a second time: 12 - 20 on the low point, then 20 more as plans_reserved
    assert post["hsbc"]["low_point"] == -8.0 and post["hsbc"]["low_point_and_plans"] == -28.0
    assert seed_spend_from(post["hsbc"]) == -28.0 and seed_spend_from(pre["hsbc"]) == -8.0
    assert post["pot"] == pre["pot"]  # no reservation, no difference


def test_pd4_preview_salary_is_in_the_closing_walk_not_the_low_walk(walks):
    wi = walks["wi"]
    assert walks["salary"]["account_id"] == "salary" and "salary" not in wi.running_seed
    assert walks["seed"]["salary"] == 300.0  # seeded at its live balance by the preview salary
    assert walks["closing"]["salary"].closing == 2800.0
    default = walks["low"]["salary"]
    with_salary = source_low_walk("salary", wi, 300.0, preview_salary=walks["salary"])
    assert [e[2] for e in with_salary.events if e not in default.events] == [2500.0]
    assert default.low_point == with_salary.low_point == 300.0


def test_pd5_flags_come_from_the_same_plans(walks):
    ids = _ids(walks)
    pos = from_walks(
        PLANS, ids, walks["closing"], walks["low"], live_balances=walks["wi"].live_balances,
        movements=[b for b in walks["wi"].assessable_bills if b.get("kind") == "movement"],
    )
    assert pos["barclays"]["uncertain"] is True and pos["idle"]["uncertain"] is True
    assert pos["natwest"]["estimated"] is True and pos["natwest"]["uncertain"] is False
    assert pos["hsbc"]["uncertain"] is False and pos["hsbc"]["estimated"] is False


@pytest.mark.parametrize("kw", [
    {"accounts": "all"}, {"closing_fallback": "zero"}, {"low_point_basis": "mid"},
])
def test_unknown_keyword_values_raise(walks, kw):
    with pytest.raises(ValueError):
        from_walks([], ["idle"], walks["closing"], walks["low"], **kw)
