"""G231: a user can exclude a current account from Safe to Spend.

One flag, `include_in_safe_to_spend` (absent means counted), honoured by the
pooled hero, the Upcoming cashflow lists and walks, spend-from eligibility,
the move and cover source finder, Penny's tools and the payday plan. Only
spendability changes: balances still show.

DB-touching collections are replaced with tiny in-memory fakes (the repo
convention; no mongomock here).
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.accounts as accounts_router
import app.routers.analytics as analytics
import app.services.counted_accounts as counted
from app.core.models import Account
from tests.test_cashflow_live_balance_overlay import UID, _fixture
from tests.test_cover_plan_account_eligibility import (
    FakeCol, _account, _bill, _find, _run,
)


# ── default and model ───────────────────────────────────────────────────────

def test_default_is_counted_when_the_flag_is_absent():
    assert counted.is_excluded({"_id": "a"}) is False
    assert counted.is_excluded({"_id": "a", "include_in_safe_to_spend": True}) is False
    assert counted.is_excluded({"_id": "a", "include_in_safe_to_spend": False}) is True
    acc = Account(id="a", name="A", type="bank", balance=1.0, provider="x")
    assert acc.include_in_safe_to_spend is True
    spendable, _ = analytics._split_balances(
        [{"_id": "a", "balance": 50.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    )
    assert spendable == 50.0


# ── PATCH /accounts/{id} ────────────────────────────────────────────────────

class _Recorder:
    def __init__(self):
        self.calls = []

    async def ainvalidate(self, uid):
        self.calls.append(uid)


def _patch_collections(monkeypatch, docs, *, items=0):
    col = FakeCol(docs)
    monkeypatch.setattr(counted, "accounts_col", col)
    monkeypatch.setattr(counted, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(counted, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(counted, "_COLLECTIONS", (counted.accounts_col, counted.yapily_accounts_col, counted.manual_accounts_col))

    async def paid(_uid, _aid):
        return items

    monkeypatch.setattr(counted, "items_paid_from", paid)
    rec = _Recorder()
    monkeypatch.setattr(accounts_router.response_cache, "ainvalidate", rec.ainvalidate)
    return col, rec


def test_patch_toggles_the_flag_and_invalidates_the_cache(monkeypatch):
    col, rec = _patch_collections(
        monkeypatch, [{"_id": "acc1", "user_id": UID, "name": "Joint", "type": "bank", "subtype": "CURRENT"}],
    )
    out = asyncio.run(accounts_router.update_account(
        "acc1", {"include_in_safe_to_spend": False}, {"email": UID}))
    assert out == {"id": "acc1", "include_in_safe_to_spend": False}
    assert col.docs[0]["include_in_safe_to_spend"] is False
    assert rec.calls == [UID]
    asyncio.run(accounts_router.update_account(
        "acc1", {"include_in_safe_to_spend": True}, {"email": UID}))
    assert col.docs[0]["include_in_safe_to_spend"] is True
    assert rec.calls == [UID, UID]


def test_patch_is_owner_scoped_and_validates_the_body(monkeypatch):
    col, rec = _patch_collections(
        monkeypatch, [{"_id": "acc1", "user_id": "someone@else.com", "name": "Theirs"}],
    )
    with pytest.raises(HTTPException) as nf:
        asyncio.run(accounts_router.update_account(
            "acc1", {"include_in_safe_to_spend": False}, {"email": UID}))
    assert nf.value.status_code == 404
    assert "include_in_safe_to_spend" not in col.docs[0]
    with pytest.raises(HTTPException) as bad:
        asyncio.run(accounts_router.update_account("acc1", {"include_in_safe_to_spend": "no"}, {"email": UID}))
    assert bad.value.status_code == 400
    assert rec.calls == []


def test_refuses_to_exclude_an_account_that_pays_something_this_period(monkeypatch):
    col, rec = _patch_collections(
        monkeypatch,
        [{"_id": "acc1", "user_id": UID, "name": "Bills", "type": "bank", "subtype": "CURRENT"}],
        items=3,
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(accounts_router.update_account(
            "acc1", {"include_in_safe_to_spend": False}, {"email": UID}))
    assert exc.value.status_code == 422
    assert exc.value.detail == "This account pays 3 upcoming items this period, so it has to count"
    assert "include_in_safe_to_spend" not in col.docs[0]
    assert rec.calls == []
    # Turning it back on is never refused.
    col.docs[0]["include_in_safe_to_spend"] = False
    asyncio.run(accounts_router.update_account(
        "acc1", {"include_in_safe_to_spend": True}, {"email": UID}))
    assert col.docs[0]["include_in_safe_to_spend"] is True


def test_items_paid_from_counts_bills_set_asides_and_plan_sources(monkeypatch):
    import app.db.collections as db_collections
    import app.core.timeutil as timeutil
    from datetime import date, timedelta

    today = date(2026, 10, 1)
    monkeypatch.setattr(timeutil, "user_today", lambda: today)
    import app.services.income as income_service
    monkeypatch.setattr(income_service, "get_confirmed_payday",
                        lambda _p, _t: (today + timedelta(days=10), {}))
    monkeypatch.setattr(db_collections, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(db_collections, "preferences_col", FakeCol([{"user_id": UID}]))

    async def build(_cached, uid=None, prefs=None):
        return {"upcoming_bills": [
            {"account_id": "acc1", "days_away": 2, "amount": 10},
            {"account_id": "acc1", "days_away": 9, "amount": 10},
            {"account_id": "acc1", "days_away": 20, "amount": 10},  # next period
            {"account_id": "acc2", "days_away": 1, "amount": 10},
        ]}

    monkeypatch.setattr(analytics, "_build_cashflow_response", build)

    class _Counting(FakeCol):
        async def count_documents(self, query):
            return len(list(self.find(query)._docs))

    monkeypatch.setattr(counted, "allocations_col", _Counting([
        {"user_id": UID, "active": True, "source_account_id": "acc1"},
        {"user_id": UID, "active": False, "source_account_id": "acc1"},
    ]))
    monkeypatch.setattr(counted, "commitments_col", _Counting([
        {"user_id": UID, "status": "active", "source_account_id": "acc1"},
        {"user_id": UID, "status": "active", "source_account_id": "acc2"},
    ]))
    assert asyncio.run(counted.items_paid_from(UID, "acc1")) == 2 + 1 + 1
    assert asyncio.run(counted.items_paid_from(UID, "acc2")) == 1 + 0 + 1
    assert asyncio.run(counted.items_paid_from(UID, "acc3")) == 0


def test_refuses_with_a_reason_when_there_is_no_forecast_to_check(monkeypatch):
    import app.db.collections as db_collections
    monkeypatch.setattr(db_collections, "cashflow_cache_col", FakeCol([]))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(counted.items_paid_from(UID, "acc1"))
    assert exc.value.status_code == 422
    assert exc.value.detail == "We cannot check this account's payments yet"


# ── Safe to Spend pool ──────────────────────────────────────────────────────

def _excluding(monkeypatch, account_id="acc2"):
    bills, income = _fixture(monkeypatch)
    import app.routers.analytics as a

    async def accounts(_uid):
        return [
            {"_id": "acc1", "name": "Main", "balance": 1000.00, "type": "bank", "subtype": "CURRENT", "currency": "GBP"},
            {"_id": "acc2", "name": "Joint bills", "balance": 747.51, "type": "bank", "subtype": "CURRENT", "currency": "GBP",
             "include_in_safe_to_spend": account_id != "acc2"},
            {"_id": "sav", "name": "Saver", "balance": 1420.95, "type": "bank", "subtype": "SAVINGS", "currency": "GBP"},
            {"_id": "card", "name": "Card", "balance": -200.0, "type": "card", "subtype": "CREDIT_CARD", "currency": "GBP"},
        ]

    monkeypatch.setattr(a, "_safe_to_spend_accounts", accounts)
    return bills, income


def test_safe_to_spend_pool_excludes_the_account_and_reports_it(monkeypatch):
    _excluding(monkeypatch)
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert sts["spendable_now"] == 1000.00          # not 1747.51
    assert sts["excluded_accounts_count"] == 1
    assert sts["excluded_accounts"] == [{"id": "acc2", "name": "Joint bills"}]
    # The walk starts from the smaller pool: the lowest point falls with it.
    assert sts["lowest_projected_balance"] == round(1000.00 - 1498.31, 2)


def test_safe_to_spend_reports_nothing_when_all_accounts_count(monkeypatch):
    _excluding(monkeypatch, account_id="none")
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert sts["spendable_now"] == 1747.51
    assert sts["excluded_accounts_count"] == 0
    assert sts["excluded_accounts"] == []


def test_excluded_savings_account_leaves_the_savings_total_too():
    _, savings = analytics._split_balances([
        {"_id": "s", "balance": 300.0, "type": "bank", "subtype": "SAVINGS", "currency": "GBP",
         "include_in_safe_to_spend": False},
        {"_id": "t", "balance": 100.0, "type": "bank", "subtype": "SAVINGS", "currency": "GBP"},
    ])
    assert savings == 100.0


def test_safe_to_spend_card_debt_ignores_an_excluded_overdrawn_account(monkeypatch):
    bills, income = _fixture(monkeypatch)
    import app.routers.analytics as a

    async def accounts(_uid):
        return [
            {"_id": "acc1", "balance": 500.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"},
            {"_id": "acc2", "name": "Partner", "balance": -75.0, "type": "bank", "subtype": "CURRENT",
             "currency": "GBP", "include_in_safe_to_spend": False},
        ]

    monkeypatch.setattr(a, "_safe_to_spend_accounts", accounts)
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert sts["card_debt"] == 0


# ── Upcoming: lists and walks ───────────────────────────────────────────────

def test_cashflow_lists_drop_items_on_an_excluded_account():
    resp = {
        "upcoming_bills": [
            {"name": "Rent", "account_id": "acc1", "amount": 500},
            {"name": "Joint DD", "account_id": "acc2", "amount": 40},
            {"name": "To joint", "account_id": "acc1", "amount": 100,
             "dest_account_id": "acc2", "dest_account_spendable": True},
        ],
        "upcoming_income": [
            {"name": "Salary", "account_id": "acc1", "amount": 2000},
            {"name": "Partner", "account_id": "acc2", "amount": 300},
        ],
        "internal_inflows": [{"name": "To joint", "account_id": "acc2", "amount": 100}],
        "observed_pending_bills": [{"name": "Shop", "account_id": "acc2", "amount": 5}],
    }
    counted.drop_excluded_items(resp, {"acc2"})
    assert [b["name"] for b in resp["upcoming_bills"]] == ["Rent", "To joint"]
    assert [i["name"] for i in resp["upcoming_income"]] == ["Salary"]
    assert resp["internal_inflows"] == []
    assert resp["observed_pending_bills"] == []
    # A transfer into an excluded account leaves the pool: a real outflow.
    assert resp["upcoming_bills"][1]["dest_account_spendable"] is False
    assert analytics._is_pooled_spendable_transfer(resp["upcoming_bills"][1]) is False


def test_real_cashflow_builder_drops_items_on_an_excluded_account(monkeypatch):
    """The real builder, not a source grep: one bill per account, one account
    excluded."""
    from tests.test_internal_inflows import _pattern, _run_build_response, UID as BUILDER_UID

    monkeypatch.setattr(counted, "accounts_col", FakeCol([
        {"_id": "joint", "user_id": BUILDER_UID, "include_in_safe_to_spend": False, "name": "Joint"}]))
    monkeypatch.setattr(counted, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(counted, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(counted, "_COLLECTIONS", (counted.accounts_col, counted.yapily_accounts_col, counted.manual_accounts_col))
    counted_bill = _pattern(key="RENT", account_id="main", dest_account_id=None, category="Bills")
    joint_bill = _pattern(key="JOINT DD", account_id="joint", dest_account_id=None, category="Bills")
    resp = _run_build_response(monkeypatch, [counted_bill, joint_bill])
    assert [b["account_id"] for b in resp["upcoming_bills"]] == ["main"]
    assert "exclusions_unverified" not in resp


def test_failed_exclusion_lookup_is_flagged_not_silently_counted(monkeypatch):
    from tests.test_internal_inflows import _pattern, _run_build_response

    async def boom(_uid):
        raise RuntimeError("db down")

    monkeypatch.setattr(counted, "excluded_account_docs", boom)
    resp = _run_build_response(monkeypatch, [_pattern(key="RENT", account_id="main", dest_account_id=None, category="Bills")])
    assert resp["exclusions_unverified"] is True


def test_safe_to_spend_never_counts_an_excluded_account_when_the_builder_lookup_fails(monkeypatch):
    """Fail closed: Safe to Spend re-derives the exclusion from the account
    rows it already loaded, so the builder's failed lookup cannot leak the
    excluded account's bill or cash into the walk."""
    bills, income = _excluding(monkeypatch)
    joint_bill = {"days_away": 2, "amount": 40.0, "kind": "bill", "account_id": "acc2", "account_balance": 700.0}

    async def build(cached_doc, uid=None, prefs=None):
        # What the builder returns when its own lookup failed: nothing dropped.
        return {"upcoming_bills": bills + [joint_bill], "upcoming_income": income,
                "exclusions_unverified": True,
                "spendable_balance": 0, "savings_balance": 0}

    monkeypatch.setattr(analytics, "_build_cashflow_response", build)
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert sts["spendable_now"] == 1000.00
    assert sts["bills_total"] == round(sum(b["amount"] for b in bills), 2)  # no £40
    assert sts["excluded_accounts_count"] == 1


# ── Reconciliation: Home and Upcoming agree with one account excluded ───────

def test_home_and_upcoming_agree_with_one_account_excluded(monkeypatch):
    bills, income = _excluding(monkeypatch)
    cash = asyncio.run(analytics.get_cashflow({"email": UID}))
    sts = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert sts["spendable_now"] == cash["spendable_balance"] == 1000.00
    assert sts["bills_total"] == round(sum(b["amount"] for b in bills), 2)
    assert sts["income_before_payday"] == round(sum(i["amount"] for i in income), 2)
    assert cash["savings_balance"] == 1420.95


# ── Spend-from eligibility and the source finder ────────────────────────────

def test_excluded_account_is_not_offered_to_spend_from(monkeypatch):
    accounts = [
        _account("counted", 200.0),
        {**_account("joint", 900.0), "include_in_safe_to_spend": False},
    ]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)
    assert "counted" in eligibility
    assert "joint" not in eligibility


def test_excluded_account_is_never_a_move_source(monkeypatch):
    accounts = [
        _account("biller", 0.0, name="Biller"),
        {**_account("joint", 900.0, name="Joint", provider="hsbc"), "include_in_safe_to_spend": False},
        _account("other", 40.0, name="Other", provider="monzo"),
    ]
    bills = [_bill("Small bill", 2, 20.0, "biller", 0.0, kind="commitment")]
    items = _run(monkeypatch, bills, accounts=accounts, account_eligibility_out={})
    move = _find(items, "move")
    assert move is not None
    sources = {m["move_map"]["from"]["account_id"] for m in move["moves"]}
    assert sources == {"other"}


def test_excluded_account_is_never_a_move_destination(monkeypatch):
    accounts = [
        {**_account("joint", 0.0, name="Joint"), "include_in_safe_to_spend": False},
        _account("rich", 900.0, name="Rich", provider="hsbc"),
    ]
    # The cashflow builder drops this bill for an excluded account; the cover
    # engine must also never list the account as a destination or a source.
    eligibility = {}
    items = _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)
    assert _find(items, "move") is None
    assert "joint" not in eligibility


# ── Penny ───────────────────────────────────────────────────────────────────

def test_penny_accounts_tool_flags_the_excluded_account(monkeypatch):
    import app.services.penny_tools as penny_tools

    async def fake_accounts(user=None):
        return [
            Account(id="a", name="Main", type="bank", subtype="CURRENT", balance=10.0, provider="x"),
            Account(id="b", name="Joint", type="bank", subtype="CURRENT", balance=20.0, provider="x",
                    include_in_safe_to_spend=False),
        ]

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(accounts_router, "get_accounts", fake_accounts)
    monkeypatch.setattr(penny_tools, "preferences_col", FakeCol([]))
    monkeypatch.setattr(penny_tools, "last_bank_sync", no_sync)
    out = asyncio.run(penny_tools._exec_get_accounts(UID))
    flags = {r["id"]: r["counts_towards_safe_to_spend"] for r in out["accounts"]}
    assert flags == {"a": True, "b": False}


def test_penny_safe_to_spend_reads_the_same_excluded_pool(monkeypatch):
    import app.services.penny_tools as penny_tools
    _excluding(monkeypatch)
    seen = {}

    real = analytics.compute_safe_to_spend

    async def spy(uid):
        seen["sts"] = await real(uid)
        return seen["sts"]

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", spy)
    out = asyncio.run(penny_tools._exec_get_safe_to_spend(UID))
    assert seen["sts"]["spendable_now"] == 1000.00
    assert out["safe_to_spend"] is not None


# ── Payday plan, can I, spend impact, needle ────────────────────────────────

def test_payday_plan_never_distributes_to_an_excluded_account(monkeypatch):
    from datetime import timedelta
    import app.core.timeutil as timeutil
    import app.services.companion as companion
    from tests import test_payday_plan_fixes as pp

    today_d = timeutil.user_today()
    accounts = [
        pp._account(pp.SALARY_ACCT, 3000.0),
        pp._account(pp.DEST_ACCT, 0.0, "Everyday"),
        {**pp._account("acc-joint", 0.0, "Joint"), "include_in_safe_to_spend": False},
    ]
    pay_period, _ = pp._base_patch(
        monkeypatch, accounts=accounts,
        bills=[pp._bill("Council Tax", 2, 100.0, account_id=pp.DEST_ACCT, account_balance=0.0)],
        income=[pp._salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    items = asyncio.run(companion.compute_today_items(pp.UID, payday_preview=False, persist=False))
    plan = pp._payday_plan(items)
    assert plan is not None
    dest_ids = {d["account_id"] for d in plan["dests"]}
    assert pp.DEST_ACCT in dest_ids
    assert "acc-joint" not in dest_ids


def test_can_i_affordability_reads_the_excluded_pool(monkeypatch):
    import app.services.affordability as affordability
    _excluding(monkeypatch)
    seen = {}
    real = analytics.compute_safe_to_spend

    async def spy(uid):
        seen["sts"] = await real(uid)
        return seen["sts"]

    monkeypatch.setattr(affordability, "compute_safe_to_spend", spy)
    out = asyncio.run(affordability.check_affordability(UID, 20.0))
    assert seen["sts"]["spendable_now"] == 1000.00
    assert seen["sts"]["excluded_accounts_count"] == 1
    assert out.get("insufficient_data") is not True


def test_spend_impact_ignores_balances_and_usual_moves_for_an_excluded_account(monkeypatch):
    import app.services.spend_impact as spend_impact
    monkeypatch.setattr(spend_impact, "accounts_col", FakeCol([
        {"_id": "main", "user_id": UID, "balance": 100.0},
        {"_id": "joint", "user_id": UID, "balance": 900.0, "include_in_safe_to_spend": False},
    ]))
    assert asyncio.run(spend_impact._live_balances_map(UID)) == {"main": 100.0}

    async def kinds(_uid):
        return None

    async def salary(_uid, _k):
        return "salary"

    async def usual(_uid, _s, _c):
        return {"main": 50, "joint": 200}, {"main": 3, "joint": 3}

    async def slices(_uid, _c, _b):
        return {}

    async def no_debt(_uid):
        return {"cards": []}

    async def excluded(_uid):
        return {"joint"}

    import app.services.companion as companion
    import app.services.debt_plan as debt_plan
    import app.services.counted_accounts as ca
    monkeypatch.setattr(spend_impact, "get_category_kinds", kinds)
    monkeypatch.setattr(spend_impact, "_infer_salary_account", salary)
    monkeypatch.setattr(companion, "_usual_payday_moves_with_counts", usual)
    monkeypatch.setattr(companion, "_active_commitment_slices", slices)
    monkeypatch.setattr(debt_plan, "get_debt_plan_cached", no_debt)
    monkeypatch.setattr(ca, "excluded_account_ids", excluded)
    total, _, _ = asyncio.run(spend_impact._usual_move_total(UID, {"type": "calendar_month"}))
    assert total == 50.0


def test_needle_current_accounts_skip_an_excluded_account(monkeypatch):
    import app.services.needle as needle
    cur = {"subtype": "CURRENT", "type": "bank"}
    monkeypatch.setattr(needle, "accounts_col", FakeCol([
        {"_id": "a", "user_id": UID, **cur},
        {"_id": "b", "user_id": UID, "include_in_safe_to_spend": False, **cur},
    ]))
    docs = asyncio.run(needle._current_account_ids(UID))
    assert [d["_id"] for d in docs] == ["a"]
