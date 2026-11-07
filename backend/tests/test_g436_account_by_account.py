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
    assert elig["u"]["spend_from_headroom"] == 0.0 and elig["u"]["uncertain"] is True and "account_headroom_raw" not in elig["u"]


def test_negative_figures_stay_negative_and_the_retired_fields_go():
    elig = {"a": _cur(-12.5, allocation_order=0, allocation_unassigned=9.0, spend_from_capped=True, account_headroom_raw=4.0)}
    companion.finalise_account_available(elig)
    assert elig["a"]["spend_from_headroom"] == -12.5
    assert not any(k in elig["a"] for k in ("allocation_order", "allocation_unassigned", "spend_from_capped", "account_headroom_raw"))


# ── The headline: the account figures plus explicit lines ────────────────────

def _headline(monkeypatch, **kw):
    _wire(monkeypatch, **kw)
    return asyncio.run(analytics.compute_safe_to_spend(UID))


def test_headline_is_each_counted_accounts_own_closing_figure_added_up(monkeypatch):
    out = _headline(monkeypatch)
    # Main 1,000 - 400 - 150 (transfer out, no inflow leg in this fake) - 30 - 60 + 140 (Side gig: two
    # sightings, attributed to Main, due after today, so predicted; Refund has none and does not count)
    # = 500; Joint 300; Overdrawn -150.
    assert out["left_to_spend_lines"] == {"accounts_total": 650.0, "plans_total": 0, "buffer": 0.0}
    assert out["safe_to_spend"] == 650.0 == out["lowest_projected_balance"]
    assert out["calculation_status"] == "complete"


def _with_inflow(monkeypatch):
    """The same world, but the 150 standing order Main to Joint also lands on Joint (its destination leg)."""
    real = analytics._build_cashflow_response

    async def with_inflow(cached, uid=None, **kw):
        resp = await real(cached, uid=uid, **kw)
        resp["internal_inflows"] = [{"name": "Move to Joint", "amount": 150.0, "days_away": 3, "account_id": "joint",
                                      "source_account_id": "cur"}]
        return resp

    monkeypatch.setattr(analytics, "_build_cashflow_response", with_inflow)


def test_a_standing_order_between_two_counted_accounts_leaves_the_total_unchanged(monkeypatch):
    # No transfer at all: Main 1,000 - 400 - 30 - 60 + 140 = 650, Joint 300, Overdrawn -150 = 800.
    no_transfer = [b for b in _bills() if b["name"] != "Move to Joint"]
    plain = _headline(monkeypatch, bills=no_transfer)["safe_to_spend"]
    assert plain == 800.0
    # The same standing order: out of Main (-150) and in on Joint (+150) on its date, no special handling.
    _wire(monkeypatch)
    _with_inflow(monkeypatch)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert out["safe_to_spend"] == plain and out["left_to_spend_lines"]["accounts_total"] == plain


def test_an_unfunded_standing_order_still_credits_the_destination_and_the_total_is_unchanged(monkeypatch):
    # Source cannot afford it: 100 against a 300 order. The destination counts its predicted money in
    # (no G360 gate on this figure); the source is the one shown short and given the cover engine's move.
    from datetime import date

    import tests.test_g360_one_account_walk as g
    today = date(2026, 10, 10)
    bills = [g._bill("To HSBC", 300.0, 2, today, acct=g.BC, balance=100.0, kind=analytics.MOVEMENT)]
    inflows = [g._inflow(300.0, 2, today)]
    _items, elig = g._run(monkeypatch, today, bills, [], inflows, {g.HS: (50.0, "hsbc"), g.BC: (100.0, "barclays")})
    assert elig[g.BC]["after_payments"] == -200.0 and elig[g.BC]["low_point"] == -200.0  # flagged short, as today
    assert elig[g.HS]["after_payments_and_money_in"] == 350.0  # credited on its date although BC cannot fund it
    assert elig[g.BC]["after_payments_and_money_in"] == -200.0
    # Moves between the two net to zero: the sum is what the two hold (100 + 50) before any plan.
    assert round(elig[g.BC]["spend_from_headroom"] + elig[g.HS]["spend_from_headroom"], 2) == 150.0


def test_a_one_sighting_income_does_not_count(monkeypatch):
    base = _headline(monkeypatch)["safe_to_spend"]
    one = {**_incomes()[0], "name": "One-off windfall", "amount": 900.0, "days_away": 1, "occurrences": 1, "amounts_recent": [900.0]}
    assert _headline(monkeypatch, incomes=[one] + _incomes())["safe_to_spend"] == base


def test_a_bill_paid_from_a_savings_account_does_not_reduce_the_total(monkeypatch):
    base = _headline(monkeypatch)["safe_to_spend"]
    bills = _bills() + [_pool_bill("Saver direct debit", 80.0, 4, acct="sav")]
    out = _headline(monkeypatch, bills=bills)
    assert out["safe_to_spend"] == base and "unattributed_bills" not in out["left_to_spend_lines"]


def test_an_overdrawn_current_account_reduces_the_total(monkeypatch):
    accounts = [a for a in _accounts() if a["_id"] != "over"]
    without = _headline(monkeypatch, accounts=accounts)["safe_to_spend"]
    assert without - _headline(monkeypatch)["safe_to_spend"] == 150.0


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


# ── Review notes: coverage kept from the deleted test_spend_from_cap.py ──────

def test_no_penny_surface_quotes_per_account_figures():
    """Penny tools, chips, can_i and affordability read the pooled figure only; the per-account
    figures are reached solely through the /today account_eligibility payload (and, for Penny,
    penny_consolidation). A missing path fails, not skips."""
    import pathlib
    import re
    root = pathlib.Path(companion.__file__).parent.parent
    strict = re.compile(r"account_eligibility|_account_headroom|spend_from|account_headroom_raw|moves_in_total|left_to_spend_lines")
    bare = re.compile(r"headroom")
    allowed_bare = ("#", "_headroom_chip", "if headroom", "chips.append(headroom)", "see your own headroom", "negative headroom")
    for rel in ("services/penny_tools.py", "services/penny_chips.py", "routers/can_i.py", "services/affordability.py"):
        path = root / rel
        assert path.exists(), f"{rel} is gone; update this guard"
        for n, line in enumerate(path.read_text().splitlines(), 1):
            assert not strict.search(line), f"{rel}:{n}: {line.strip()}"
            if bare.search(line):
                stripped = line.strip()
                assert stripped.startswith(("#", '"', "'")) or any(a in line for a in allowed_bare), f"{rel}:{n}: {stripped}"


def test_a_user_excluded_account_never_reaches_eligibility_spend_from_or_the_headline(monkeypatch):
    """G231: the engine emits no entry for an excluded account, and the headline sum never counts it."""
    accounts = [_account("counted", 300.0), {**_account("joint", 900.0), "include_in_safe_to_spend": False}]
    elig = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=elig)
    assert "joint" not in elig and elig["counted"]["spend_from_headroom"] == 300.0
    # The headline: `unpicked` (flag False) is in no counted set and its bill and income never reach the sum.
    rows = _accounts()
    assert "unpicked" not in account_available.counted_current_ids(rows)
    with_it = _headline(monkeypatch)
    without = _headline(monkeypatch, accounts=[a for a in rows if a["_id"] != "unpicked"],
                        bills=[b for b in _bills() if b["account_id"] != "unpicked"],
                        incomes=[i for i in _incomes() if i["account_id"] != "unpicked"])
    assert with_it["safe_to_spend"] == without["safe_to_spend"]


def test_an_ended_connection_is_never_a_counted_account():
    rows = [{**a, "status": "expired"} if a["_id"] == "joint" else a for a in _accounts()]
    assert "joint" not in account_available.counted_current_ids(rows)


# ── Review notes: which account can pay an unsourced set-aside ───────────────

def test_an_expired_or_excluded_account_is_never_picked_as_a_source_but_savings_is(monkeypatch):
    import app.services.companion as c

    async def active(uid):
        return [{"id": "s1", "fill_account_id": "pot", "source_set": False}]

    monkeypatch.setattr(c, "list_active_allocations", active)
    amap = {"gone": {"name": "Gone", "status": "expired"}, "off": {"name": "Off", "include_in_safe_to_spend": False},
            "sav": {"name": "Saver", "subtype": "SAVINGS"}, "pot": {"name": "Pot"}}

    def run(funding):
        async def source(uid, a, inflows, m):
            return funding
        monkeypatch.setattr(c, "_allocation_funding_source", source)
        return asyncio.run(c._attribute_unsourced_set_asides("u", [_plan()], amap, []))[0]["source_account_id"]

    assert run("gone") is None and run("off") is None
    assert run("sav") == "sav"


def test_a_set_aside_paid_from_savings_reduces_the_headline_through_plans_total_only(monkeypatch):
    import app.routers.allocations as allocations_router

    base = _headline(monkeypatch)
    _wire(monkeypatch)

    async def setasides(_uid):
        return 40.0, 1

    monkeypatch.setattr(allocations_router, "total_reserved_remaining", setasides)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    # Nothing is paid from a counted current account, so the accounts line is untouched and the 40 comes off once.
    assert out["left_to_spend_lines"]["accounts_total"] == base["left_to_spend_lines"]["accounts_total"]
    assert out["left_to_spend_lines"]["plans_total"] == 40.0
    assert out["safe_to_spend"] == round(base["safe_to_spend"] - 40.0, 2)


def test_a_plan_sourced_from_savings_is_deducted_from_no_current_account(monkeypatch):
    elig = {}
    sav_plan = {**_JAPAN, "source_account_id": "sav"}
    _run(monkeypatch, [], accounts=[_account("cur", 500.0), _account("sav", 300.0, subtype="SAVINGS")],
         account_eligibility_out=elig, plans=[sav_plan])
    assert elig["cur"]["spend_from_headroom"] == 500.0 and elig["cur"]["plans_reserved"] == 0.0
    assert elig["sav"]["plans_reserved"] == 80.0 and elig["sav"]["spend_from_headroom"] == 0.0


def test_a_dip_below_zero_before_money_arrives_is_a_warning_with_its_date_and_not_part_of_the_figure(monkeypatch):
    from datetime import timedelta

    from test_cover_plan_account_eligibility import TODAY, _salary

    elig = {}
    _run(monkeypatch, [_bill("Rent", 2, 300.0, "A", 100.0)], accounts=[_account("A", 100.0)], account_eligibility_out=elig,
         income_streams=[{"key": "Salary", "status": "confirmed"}], window_income=[_salary("A")])
    a = elig["A"]
    assert a["dips_below_zero"] == {"money_in_date": (TODAY + timedelta(days=8)).isoformat()}
    assert a["spend_from_headroom"] == 800.0 and a["after_payments_and_money_in"] == 800.0  # 100 - 300 + 1,000: the dip is not in it
    assert a["low_point"] == -200.0  # still reported, and the cover engine still sees the account short


# ── Money in counts only after today, and only when predicted ────────────────

def _salary_world(monkeypatch, days_away, *, occurrences=3):
    """One counted account holding 1,000 with a 3,000 salary due `days_away` days from today."""
    inc = {**_incomes()[0], "name": "Salary", "amount": 3000.0, "days_away": days_away, "account_id": "cur",
           "occurrences": occurrences, "amounts_recent": [3000.0] * max(occurrences, 1)}
    accounts = [a for a in _accounts() if a["_id"] == "cur"]
    return _headline(monkeypatch, accounts=accounts, bills=[], incomes=[inc])


def test_a_salary_due_today_and_already_in_the_balance_counts_once(monkeypatch):
    out = _salary_world(monkeypatch, 0)
    # The 1,000 balance already holds it (landed, no posted credit yet): the occurrence dated today is not money in.
    assert out["left_to_spend_lines"]["accounts_total"] == 1000.0 and out["safe_to_spend"] == 1000.0


def test_a_salary_due_tomorrow_counts(monkeypatch):
    assert _salary_world(monkeypatch, 1)["safe_to_spend"] == 4000.0


def test_an_overdue_unobserved_salary_does_not_count(monkeypatch):
    # An occurrence dated before today is not in the window at all (a lapsed expectation drops out).
    assert _salary_world(monkeypatch, -1)["safe_to_spend"] == 1000.0


def test_two_sightings_count_but_one_does_not(monkeypatch):
    assert _salary_world(monkeypatch, 3, occurrences=2)["safe_to_spend"] == 4000.0
    assert _salary_world(monkeypatch, 3, occurrences=1)["safe_to_spend"] == 1000.0


def test_the_same_rule_holds_for_the_account_page_figure_through_the_engine(monkeypatch):
    from datetime import timedelta
    from test_cover_plan_account_eligibility import _salary

    def run(days):
        elig = {}
        sal = {**_salary("A"), "days_away": days, "expected_date": "2030-01-01", "occurrences": 3, "amounts_recent": [1000.0] * 3}
        _run(monkeypatch, [], accounts=[_account("A", 150.0)], account_eligibility_out=elig,
             income_streams=[{"key": "Salary", "status": "confirmed"}], window_income=[sal])
        return elig["A"]["spend_from_headroom"]

    assert run(0) == 150.0 and run(2) == 1150.0


# ── An own transfer that already posted is counted once on each side ─────────

def _posted(kind, account_id, on_date, desc="ALEX CARTER HSBC STO", amount=1758.33):
    import app.core.timeutil as timeutil
    return {
        "user_id": "kevin", "transaction_type": kind, "merchant_name": None, "description": desc,
        "amount": amount, "date": on_date or timeutil.user_today(), "category": "Transfer",
        "custom_category": None, "account_id": account_id,
    }


def _today_standing_order(monkeypatch, observed):
    import app.core.timeutil as timeutil
    import test_internal_inflows as ti
    monkeypatch.setattr(ti, "UID", "kevin", raising=False)
    pattern = ti._pattern(key="ALEX CARTER HSBC STO", next_date=timeutil.user_today().isoformat())
    return ti._run_build_response(monkeypatch, [pattern], observed=observed)


def test_a_standing_order_that_posted_today_is_walked_on_neither_side(monkeypatch):
    # Source debit and destination credit both posted: both balances already hold it, so there is no
    # walk event on either account and the total (the sum of the two balances) is untouched.
    resp = _today_standing_order(monkeypatch, [_posted("debit", "barclays", None), _posted("credit", "hsbc", None)])
    assert resp["upcoming_bills"] == [] and resp["internal_inflows"] == []


def test_a_credit_that_already_landed_is_not_credited_again_while_the_debit_is_still_walked_once(monkeypatch):
    # Only the destination's credit has posted (the source's debit has not matched yet, so its balance
    # still holds the money). The debit is the one walk event on the source; the destination is NOT
    # credited a second time. Total: source -X on its walk, destination +X already in its balance, nil net.
    # Before the fix both the debit and the mirrored credit were walked, so the destination counted X twice.
    resp = _today_standing_order(monkeypatch, [_posted("credit", "hsbc", None)])
    assert [b["account_id"] for b in resp["upcoming_bills"]] == ["barclays"]
    assert resp["internal_inflows"] == []


def test_a_standing_order_not_yet_posted_still_credits_the_destination_on_its_date(monkeypatch):
    resp = _today_standing_order(monkeypatch, [])
    assert len(resp["upcoming_bills"]) == 1
    assert [i["account_id"] for i in resp["internal_inflows"]] == ["hsbc"]
