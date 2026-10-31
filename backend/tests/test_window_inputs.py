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


# ── the callers still produce exactly what the hand-copied preambles did ─────

@pytest.mark.parametrize("name", sorted(CAPTURES))
def test_caller_output_equals_pre_extraction_golden(monkeypatch, name):
    golden = json.loads(GOLDEN.read_text())[name]
    assert CAPTURES[name](monkeypatch) == golden


# ── the builder, called directly with each caller's documented settings ──────

_PROJ = {"name": 1, "balance": 1, "current_balance": 1, "available_balance": 1,
         "subtype": 1, "account_subtype": 1, "type": 1, "provider": 1, "currency": 1,
         "nickname": 1, "display_name": 1, "include_in_safe_to_spend": 1}


def _build(monkeypatch, caller, resp=None, **override):
    from app.services import window_inputs as wim

    _patch_common(monkeypatch)
    resp = resp if resp is not None else _resp()
    accounts = FakeCol(ACCOUNTS)
    yapily = FakeCol(YAPILY)
    manual = FakeCol(MANUAL)
    if caller == "at_risk":
        kw = dict(load_balances=wim.bill_account_loader(accounts, yapily))
    elif caller == "companion":
        kw = dict(
            load_balances=wim.user_accounts_loader(UID, accounts, yapily, manual, _PROJ),
            stamp_credit_basis=True, reapply_exclusions=True, load_when_no_bills=True,
        )
    else:  # spend_impact: its own accounts-collection-only map
        monkeypatch.setattr(spend_impact, "accounts_col", accounts)

        async def _load(_bills):
            return wim.LoadedAccounts(live_balances=await spend_impact._live_balances_map(UID))

        kw = dict(load_balances=_load)
    kw.update(override)
    return asyncio.run(wim.build_window_inputs(UID, resp, dict(PREFS), **kw))


@pytest.mark.parametrize("caller", ["at_risk", "spend_impact", "companion"])
def test_builder_lists_equal_what_each_caller_computed_before(monkeypatch, caller):
    golden = json.loads(GOLDEN.read_text())[caller]
    wi = _build(monkeypatch, caller)
    fa = golden["funded_args"]
    assert _norm(wi.window_inflows) == fa["inflows"]
    assert _norm(wi.assessable_bills) == fa["bills"]
    assert _norm(wi.window_income) == fa["incomes"]
    assert _norm({**wi.live_balances, **wi.running_seed}) == fa["balances"]
    assert _norm(wi.funded_window_inflows) == golden["funded_out"]
    if caller == "spend_impact":
        assert _norm(wi.running_seed) == golden["window"]["balances"]


def test_builder_shared_window_facts(monkeypatch):
    wi = _build(monkeypatch, "at_risk")
    assert wi.today == TODAY and wi.days_to_pay == DAYS_TO_PAY
    assert wi.next_pay == TODAY + timedelta(days=DAYS_TO_PAY)
    assert wi.payday_source == "period"
    assert wi.confirmed_income_keys == {"ACME"}
    # window is strictly before payday; payday-day items sit in their own slice
    assert [b["name"] for b in wi.window_bills] == [
        "Council Tax", "To HSBC", "Gym", "Amex bill", "Unpriced", "Yapily bill",
    ]
    assert [b["name"] for b in wi.payday_day_bills] == ["Rent"]
    assert [i["days_away"] for i in wi.payday_day_income] == [DAYS_TO_PAY]
    assert [n["days_away"] for n in wi.payday_day_inflows] == [DAYS_TO_PAY]
    # card and unpriced bills are never assessable
    assert [b["name"] for b in wi.assessable_bills] == ["Council Tax", "To HSBC", "Gym", "Yapily bill"]


def test_builder_confirmed_payday_source(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        income, "get_confirmed_payday", lambda prefs, today_d: (today_d + timedelta(days=4), {})
    )
    from app.services import window_inputs as wim
    wi = asyncio.run(wim.build_window_inputs(
        UID, _resp(), dict(PREFS), load_balances=wim.bill_account_loader(FakeCol(ACCOUNTS)),
    ))
    assert wi.payday_source == "confirmed" and wi.days_to_pay == 4
    assert [b["name"] for b in wi.window_bills] == ["To HSBC", "Gym"]


# ── differences table: each keyword flips exactly the documented difference ──

def test_w1_w2_w3_loaders_differ_only_in_the_documented_way(monkeypatch):
    at_risk = _build(monkeypatch, "at_risk")
    companion_wi = _build(monkeypatch, "companion")
    spend = _build(monkeypatch, "spend_impact")
    # W1: bill accounts only (incl. Yapily) / every account + offline / accounts collection only
    assert at_risk.live_balances == {"barclays": 4800.0, "hsbc": 12.0, "natwest": 90.0, "yap1": 75.0}
    assert companion_wi.live_balances == {
        "barclays": 4800.0, "hsbc": 12.0, "nobal": 33.0, "yap1": 75.0, "man1": 250.0,
    }
    assert spend.live_balances == {"barclays": 4800.0, "hsbc": 12.0, "nobal": 0.0}
    # W2: fallback chain (companion) versus `balance` only (spend impact)
    assert companion_wi.live_balances["nobal"] == 33.0 and spend.live_balances["nobal"] == 0.0
    # W3: G231 exclusion recorded by the companion loader only
    assert companion_wi.excluded_account_ids == {"natwest"}
    assert at_risk.excluded_account_ids == set() and spend.excluded_account_ids == set()
    assert [a["_str_id"] for a in companion_wi.offline_accounts] == ["man1"]
    assert at_risk.all_uk_accounts == [] and spend.offline_accounts == []


def test_w4_reapply_exclusions_flips_only_the_redrop(monkeypatch):
    from app.services import window_inputs as wim
    off = _build(monkeypatch, "companion", reapply_exclusions=False)
    on = _build(monkeypatch, "companion", reapply_exclusions=True)
    assert "Gym" in [b["name"] for b in off.window_bills]
    assert "Gym" not in [b["name"] for b in on.window_bills]
    assert [b["name"] for b in off.assessable_bills] == ["Council Tax", "To HSBC", "Gym", "Yapily bill"]
    assert [b["name"] for b in on.assessable_bills] == ["Council Tax", "To HSBC", "Yapily bill"]
    # inflows, payday-day slices and the pre-drop income snapshot are untouched
    assert on.window_inflows == off.window_inflows
    assert on.payday_day_bills == off.payday_day_bills
    assert on.window_income_before_exclusions == off.window_income_before_exclusions
    # a response that says exclusions were verified is never re-dropped
    resp = _resp()
    resp["exclusions_unverified"] = False
    verified = _build(monkeypatch, "companion", resp=resp, reapply_exclusions=True)
    assert "Gym" in [b["name"] for b in verified.window_bills]
    assert wim  # module imported for the loader factories above


def test_w5_stamp_credit_basis_flips_only_the_stamp(monkeypatch):
    plain = _build(monkeypatch, "at_risk", stamp_credit_basis=False)
    stamped = _build(monkeypatch, "at_risk", stamp_credit_basis=True)
    assert all("credit_basis" not in i for i in plain.window_income)
    assert [i["credit_basis"] for i in stamped.window_income] == ["confirmed"]
    assert _norm([{k: v for k, v in i.items() if k not in ("credit_basis", "steady_salary")}
                  for i in stamped.window_income]) == _norm(plain.window_income)


def test_w6_load_when_no_bills_flips_only_the_read(monkeypatch):
    from app.services import window_inputs as wim
    calls: list = []

    async def loader(bills):
        calls.append(list(bills))
        return wim.LoadedAccounts(live_balances={"hsbc": 1.0})

    resp = _resp()
    resp["upcoming_bills"] = [_bill("Amex bill", 5, 80.0, "amex", None, card=True)]
    _patch_common(monkeypatch)
    skipped = asyncio.run(wim.build_window_inputs(UID, resp, dict(PREFS), load_balances=loader))
    assert calls == [] and skipped.live_balances == {} and skipped.running_seed == {}
    loaded = asyncio.run(wim.build_window_inputs(
        UID, resp, dict(PREFS), load_balances=loader, load_when_no_bills=True,
    ))
    assert calls == [[]] and loaded.live_balances == {"hsbc": 1.0}
    # nothing else differs: the lists are identical
    assert skipped.window_bills == loaded.window_bills and skipped.assessable_bills == loaded.assessable_bills == []
