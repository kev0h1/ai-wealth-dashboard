"""G436 (Kevin 2026-11-07): Left to spend and each account's Available are what is
left after payments, goals and set-asides, account by account. Nothing is shared
out across preferred accounts (G414's `cap_spend_from_to_pool` is gone).

Real engine where it matters (`compute_today_items` over fake Mongo, the pooled
`compute_safe_to_spend` over its usual fakes); pure unit tests for the small
helpers. The whole-pipeline hand-derived cases live in tests/scenarios (the
`g436-*` scenario and the re-derived G410/G421/G428/G434 ones).
"""
import asyncio

import pytest

import app.routers.analytics as analytics
import app.routers.companion as companion_router
import app.services.account_available as account_available
import app.services.companion as companion
from test_cover_plan_account_eligibility import _account, _bill, _JAPAN, _run
from test_pooled_walk import UID, _accounts, _bill as _pool_bill, _bills, _incomes, _wire


# ── Kevin's production shape through the real engine ─────────────────────────

def test_a_healthy_account_shows_its_own_figure_and_nothing_is_shared_out(monkeypatch):
    # B and C have room, D is healthy with 116 after its payments and nothing else.
    accounts = [_account("B", 1400.0, provider="barclays"), _account("C", 400.0, provider="monzo"),
                _account("D", 150.0, provider="hsbc")]
    bills = [_bill("Council tax", 3, 150.0, "B", 1400.0), _bill("Broadband", 6, 50.0, "B", 1400.0),
             _bill("Gym", 4, 25.0, "C", 400.0), _bill("Insurance", 8, 34.0, "D", 150.0)]
    elig = {}
    _run(monkeypatch, bills, accounts=accounts, account_eligibility_out=elig)
    figures = {k: elig[k]["spend_from_headroom"] for k in "BCD"}
    assert figures == {"B": 1200.0, "C": 375.0, "D": 116.0}
    assert figures["D"] != 0
    assert not any(k in e for e in elig.values() for k in ("allocation_order", "allocation_unassigned", "spend_from_capped"))
    assert not any("account_headroom_raw" in e for e in elig.values() if e["is_current_account"])


def test_the_engine_signs_a_shortfall_no_account_covers_and_keeps_it_negative(monkeypatch):
    elig = {}
    _run(monkeypatch, [_bill("Rent", 2, 350.0, "A", 100.0)], accounts=[_account("A", 100.0)], account_eligibility_out=elig)
    assert elig["A"]["spend_from_headroom"] == -250.0  # never floored to 0
    assert "moves_in_total" not in elig["A"]


def test_a_covered_shortfall_earmarks_the_source_and_credits_the_destination_and_the_sum_is_unchanged(monkeypatch):
    accounts = [_account("dest", 124.0, name="Meadow Current", provider="natwest"),
                _account("src", 1000.0, name="Harbour Current", provider="barclays")]
    elig = {}
    _run(monkeypatch, [_bill("Rent share", 2, 400.0, "dest", 124.0)], accounts=accounts, account_eligibility_out=elig)
    src, dest = elig["src"], elig["dest"]
    # Shortfall 400 - 124 = 276, 290 suggested: the source sets it aside, the destination counts it in.
    assert src["earmarked_total"] == 290.0 and src["spend_from_headroom"] == 710.0
    assert dest["moves_in_total"] == 290.0 and dest["spend_from_headroom"] == 14.0  # -276 + 290
    assert dest["spend_from_requires_move"] is True
    # The two moves net to zero: the sum is what the accounts hold on their own (1000 + (124 - 400)).
    assert round(src["spend_from_headroom"] + dest["spend_from_headroom"], 2) == 724.0


def test_a_plan_is_deducted_only_from_the_account_it_is_paid_from(monkeypatch):
    elig = {}
    _run(monkeypatch, [], accounts=[_account("barclays", 141.04), _account("other", 500.0, provider="monzo")],
         account_eligibility_out=elig, plans=[_JAPAN])
    assert elig["barclays"]["spend_from_headroom"] == 61.04 and elig["barclays"]["plans_reserved"] == 80.0
    assert elig["other"]["spend_from_headroom"] == 500.0 and elig["other"]["plans_reserved"] == 0.0


# ── finalise_account_available: the pure rules ───────────────────────────────

def _cur(value, **extra):
    return {"is_current_account": True, "headroom": 50.0, "spend_from_headroom": value, **extra}


def test_moves_in_are_counted_only_from_current_accounts_and_net_to_zero():
    elig = {
        "src": _cur(100.0, earmarks_out=[{"to_account_id": "dst", "to_name": "D", "amount": 60.0}], earmarked_total=60.0),
        "dst": _cur(-40.0, covered_by_move={"amount": 60.0, "shortfall": 40.0, "from": [{"account_id": "src", "name": "S", "amount": 60.0}]}),
    }
    companion.finalise_account_available(elig)
    assert elig["dst"]["spend_from_headroom"] == 20.0 and elig["dst"]["moves_in_total"] == 60.0
    assert elig["dst"]["spend_from_requires_move"] is True
    assert elig["src"]["spend_from_headroom"] == 100.0 and "moves_in_total" not in elig["src"]
    # The source's figure already had its 60 set aside (the engine does that), so the pair holds 100 + 20.
    assert sum(e["spend_from_headroom"] for e in elig.values()) == 120.0


def test_a_move_from_savings_is_shown_on_the_destination_but_never_counted():
    elig = {
        "sav": {"is_current_account": False, "headroom": 900.0, "spend_from_headroom": 800.0,
                "earmarks_out": [{"to_account_id": "dst", "to_name": "D", "amount": 500.0}], "earmarked_total": 500.0},
        "dst": _cur(-500.0, covered_by_move={"amount": 500.0, "shortfall": 500.0, "savings_amount": 500.0, "current_amount": 0.0,
                                             "from": [{"account_id": "sav", "name": "Saver", "amount": 500.0, "source_kind": "savings"}]}),
    }
    companion.finalise_account_available(elig)
    assert elig["dst"]["spend_from_headroom"] == -500.0  # still the shortfall until the move is made
    assert "moves_in_total" not in elig["dst"] and "spend_from_requires_move" not in elig["dst"]
    assert elig["dst"]["covered_by_move"]["amount"] == 500.0  # but it is shown
    assert elig["sav"]["spend_from_headroom"] == 0.0  # savings are never an everyday-spending figure
    assert elig["sav"]["account_headroom_raw"] == 400.0  # its protected move capacity, as before: min(800, 900 - 500)


def test_an_uncertain_account_shows_no_figure_and_is_not_credited():
    elig = {
        "src": _cur(100.0, earmarks_out=[{"to_account_id": "u", "to_name": "U", "amount": 30.0}]),
        "u": _cur(0.0, uncertain=True),
    }
    companion.finalise_account_available(elig)
    # An uncertain account is never shown (lib/accountAvailability.ts reads `uncertain` first) and gets no credit.
    assert elig["u"]["spend_from_headroom"] == 0.0 and elig["u"]["uncertain"] is True and elig["u"]["account_headroom_raw"] == 0.0


def test_negative_figures_stay_negative_and_the_retired_fields_go():
    elig = {"a": _cur(-12.5, allocation_order=0, allocation_unassigned=9.0, spend_from_capped=True, account_headroom_raw=4.0)}
    companion.finalise_account_available(elig)
    assert elig["a"]["spend_from_headroom"] == -12.5
    assert not any(k in elig["a"] for k in ("allocation_order", "allocation_unassigned", "spend_from_capped", "account_headroom_raw"))


# ── The headline: the account figures plus explicit lines ────────────────────

def _headline(monkeypatch, **kw):
    _wire(monkeypatch, **kw)
    return asyncio.run(analytics.compute_safe_to_spend(UID))


def test_headline_is_each_counted_accounts_own_lowest_point_added_up(monkeypatch):
    out = _headline(monkeypatch)
    # Main 1,000 - 400 - 150 (transfer out, no inflow leg here) - 30 - 60 = 360; Joint 300; Overdrawn -150.
    assert out["left_to_spend_lines"] == {"accounts_total": 510.0, "uncredited_income": 0.0, "unattributed_bills": 0.0,
                                          "plans_total": 0, "buffer": 0.0}
    assert out["safe_to_spend"] == 510.0 == out["lowest_projected_balance"]
    assert out["calculation_status"] == "complete"


def test_an_overdrawn_current_account_reduces_the_total(monkeypatch):
    accounts = [a for a in _accounts() if a["_id"] != "over"]
    without = _headline(monkeypatch, accounts=accounts)["safe_to_spend"]
    assert without - _headline(monkeypatch)["safe_to_spend"] == 150.0


def test_a_payment_no_counted_account_carries_stays_in_on_its_own_line(monkeypatch):
    bills = _bills() + [_pool_bill("Saver direct debit", 80.0, 4, acct="sav")]  # paid from a savings account
    out = _headline(monkeypatch, bills=bills)
    assert out["left_to_spend_lines"]["unattributed_bills"] == -80.0
    assert out["safe_to_spend"] == 430.0  # 510 - 80, never silently dropped


def test_income_no_account_credits_stays_in_on_its_own_line_when_it_lifts_the_pooled_floor(monkeypatch):
    # One unreliable 600 income on day 1, before Main's 400 rent on day 2: no account walk credits it,
    # but the pooled walk did, so it is kept as its own line (the amount the pooled floor rose by).
    incomes = [{**_incomes()[0], "name": "Unreliable refund", "amount": 600.0, "days_away": 1}]
    out = _headline(monkeypatch, incomes=incomes)
    lines = out["left_to_spend_lines"]
    assert lines["uncredited_income"] > 0
    assert out["safe_to_spend"] == round(lines["accounts_total"] + lines["uncredited_income"] + lines["unattributed_bills"], 2)


def test_buffer_and_plans_come_off_once_as_their_own_lines(monkeypatch):
    import app.routers.allocations as allocations_router
    import app.routers.commitments as commitments_router
    from test_pooled_walk import _Counted

    base = _headline(monkeypatch)
    _wire(monkeypatch)
    monkeypatch.setattr(analytics, "preferences_col", _Counted([], "prefs", doc={"user_id": UID, "safe_to_spend_buffer": 20.0}))

    async def goals(_uid):
        return 40.0, 1

    async def setasides(_uid):
        return 25.0, 1

    monkeypatch.setattr(commitments_router, "total_reserved_slices", goals)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", setasides)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert out["left_to_spend_lines"]["plans_total"] == 65.0 and out["left_to_spend_lines"]["buffer"] == 20.0
    assert out["safe_to_spend"] == round(base["safe_to_spend"] - 65.0 - 20.0, 2)
    assert out["lowest_projected_balance"] == base["lowest_projected_balance"]  # the accounts line is before plans and buffer


def test_unreadable_account_figures_fail_closed_to_degraded_and_never_positive(monkeypatch):
    _wire(monkeypatch)

    def boom(*_a, **_k):
        raise RuntimeError("walk unavailable")

    monkeypatch.setattr(account_available, "account_bases", boom)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert out["calculation_status"] == "degraded"
    assert "account_positions" in out["unavailable_components"]
    assert out["safe_to_spend"] <= 0
    assert out["left_to_spend_lines"] is None


# ── Home reads the account figures, held at zero only when the headline is degraded ──

def _stub_today(monkeypatch, eligibility, sts):
    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        if account_eligibility_out is not None:
            account_eligibility_out.update({k: dict(v) for k, v in eligibility.items()})
        return []

    async def cached(uid):
        return sts

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    monkeypatch.setattr(companion_router, "_cached_left_to_spend", cached)


ELIG = {"a": {"short": False, "headroom": 90.0, "spend_from_headroom": 1200.0}, "b": {"short": True, "headroom": 0.0, "spend_from_headroom": -50.0}}


def test_today_payload_carries_each_accounts_own_figure_with_no_cap(monkeypatch):
    _stub_today(monkeypatch, ELIG, {"status": "ok", "calculation_status": "complete", "safe_to_spend": 10.0})
    payload = asyncio.run(companion_router.build_today_payload("u"))
    assert payload["account_eligibility"] == ELIG  # a 1,200 figure under a 10 headline: no cap, no allocation


def test_today_payload_holds_positive_figures_at_zero_when_the_headline_is_degraded(monkeypatch):
    _stub_today(monkeypatch, ELIG, {"status": "ok", "calculation_status": "degraded", "safe_to_spend": -20.0})
    payload = asyncio.run(companion_router.build_today_payload("u"))
    assert payload["account_eligibility"]["a"]["spend_from_headroom"] == 0.0
    assert payload["account_eligibility"]["b"]["spend_from_headroom"] == -50.0  # a shortfall is never hidden


def test_today_payload_is_absent_while_the_headline_is_unreadable_or_syncing(monkeypatch):
    for sts in (None,):
        _stub_today(monkeypatch, ELIG, sts)
        assert asyncio.run(companion_router.build_today_payload("u"))["account_eligibility"] is None


# ── Sources for a set-aside no stored account pays: the cover engine's own rule ──

def _plan(**extra):
    return {"id": "allocation:s1", "record_id": "s1", "kind": "allocation", "name": "Holiday", "source_account_id": None,
            "source_basis": "unknown", "period_amount": 150.0, "filled_amount": 0.0, "remaining": 150.0, "active": True, **extra}


def _attribution(monkeypatch, plans, alloc, funding):
    import app.services.companion as c

    async def active(uid):
        return [alloc]

    async def source(uid, a, inflows, amap):
        return funding

    monkeypatch.setattr(c, "list_active_allocations", active)
    monkeypatch.setattr(c, "_allocation_funding_source", source)
    amap = {"src": {"name": "Src"}, "pot": {"name": "Pot"}, "amex": {"name": "Amex", "subtype": "CREDIT_CARD"}}
    return asyncio.run(c._attribute_unsourced_set_asides("u", plans, amap, []))


def test_a_legacy_set_aside_takes_the_source_the_cover_engine_finds(monkeypatch):
    out = _attribution(monkeypatch, [_plan()], {"id": "s1", "fill_account_id": "pot", "source_set": False}, "src")
    assert out[0]["source_account_id"] == "src" and out[0]["source_basis"] == "recent-transfers" and out[0]["inferred"] is True


def test_a_deliberate_not_set_a_goal_a_credit_card_and_the_fill_account_are_never_attributed(monkeypatch):
    assert _attribution(monkeypatch, [_plan()], {"id": "s1", "fill_account_id": "pot", "source_set": True}, "src")[0]["source_account_id"] is None
    goal = _plan(id="goal:g1", record_id="g1", kind="goal")
    assert _attribution(monkeypatch, [goal], {"id": "g1", "fill_account_id": "pot"}, "src")[0]["source_account_id"] is None
    assert _attribution(monkeypatch, [_plan()], {"id": "s1", "fill_account_id": "pot"}, "amex")[0]["source_account_id"] is None
    assert _attribution(monkeypatch, [_plan()], {"id": "s1", "fill_account_id": "pot"}, "pot")[0]["source_account_id"] is None
    assert _attribution(monkeypatch, [_plan()], {"id": "s1", "fill_account_id": "pot"}, None)[0]["source_account_id"] is None
