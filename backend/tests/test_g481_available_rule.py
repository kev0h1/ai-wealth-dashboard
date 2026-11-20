"""G481 (Kevin 2026-11-20): the one Left to spend rule.

    Available (per counted current account) = cash now - max(0, bills before payday - money in before payday)

Money in only OFFSETS bills and never adds. No timing and no day-by-day order is involved, only the two totals
before payday. Left to spend is the sum of every account's Available, less goals and set-asides on no account
and the buffer. Goals and set-asides come off the account they are sourced from, after the figure.

Pure helper over hand-built walks, the headline through the real `compute_safe_to_spend`, the per-account
figure through the real `compute_today_items`, and the same figure read off every surface from the committed
H140 snapshot. Figures are hand-derived in the comments, invented names throughout.
"""
import asyncio
import json
from datetime import date
from pathlib import Path

import pytest

import app.routers.analytics as analytics
import app.services.account_available as aa
import app.services.penny_consolidation as pc
from app.services.account_walk import _run_account
import test_pooled_walk as tpw
from test_pooled_walk import UID, _bill, _income, _wire
import tests.test_g360_one_account_walk as g
from test_cover_plan_account_eligibility import _JAPAN, _account, _bill as _eng_bill, _run as _eng_run

TODAY = date(2026, 11, 19)
OUT = Path(__file__).parent / "scenarios" / "out"


@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(tpw, "TODAY", TODAY)


# ── The pure rule: totals only ────────────────────────────────────────────────

def _walk(opening, *events):
    """events: (day, amount, is_income), walked credits first (the order is irrelevant to the figure)."""
    ordered = sorted(events, key=lambda e: (0 if e[2] else 1, e[0]))
    return _run_account("a", opening, [((d, "a", amt, inc, {}), 0) for d, amt, inc in ordered])


@pytest.mark.parametrize("cash, bills, money_in, want", [
    (5.0, 200.0, 300.0, 5.0),       # money in covers the bills: the cash, and never more
    (5.0, 400.0, 300.0, -95.0),     # 100 of the bills is left uncovered: 5 - 100
    (500.0, 200.0, 0.0, 300.0),     # no money in: cash less the bills
    (5.05, 77.91, 649.59, 5.05),    # Kevin's real shape: not Short
    (5.05, 77.91, 0.0, -72.86),     # the same with no income: Short
    (0.0, 0.0, 900.0, 0.0),         # money in alone adds nothing
])
def test_the_rule_is_cash_less_what_the_bills_exceed_the_money_in_by(cash, bills, money_in, want):
    events = [(4, bills, False)] if bills else []
    events += [(7, money_in, True)] if money_in else []
    assert aa.available_base(_walk(cash, *events)) == want


def test_no_timing_is_involved_the_money_may_come_before_or_after_the_bill():
    after = aa.available_base(_walk(5.05, (4, 77.91, False), (7, 649.59, True)))
    before = aa.available_base(_walk(5.05, (3, 649.59, True), (4, 77.91, False)))
    same_day = aa.available_base(_walk(5.05, (4, 649.59, True), (4, 77.91, False)))
    assert after == before == same_day == 5.05


def test_an_overdrawn_account_is_its_overdraft_less_what_the_bills_exceed_the_money_in_by():
    assert aa.available_base(_walk(-150.0)) == -150.0
    assert aa.available_base(_walk(-150.0, (2, 40.0, False), (3, 1000.0, True))) == -150.0
    assert aa.available_base(_walk(-150.0, (2, 400.0, False), (3, 100.0, True))) == -450.0


def test_several_bills_and_several_credits_are_added_up_first():
    # 1,000 cash; bills 400 + 150 + 90 = 640; money in 140 + 60 = 200: 1,000 - (640 - 200) = 560.
    w = _walk(1000.0, (2, 400.0, False), (3, 150.0, False), (5, 90.0, False), (4, 140.0, True), (6, 60.0, True))
    assert aa.available_base(w) == 560.0


# ── The headline, through the real compute_safe_to_spend ─────────────────────

def _acc(i, name, bal):
    return {"_id": i, "name": name, "balance": bal, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}


def _predicted(name, amount, days, acct):
    return _income(name, amount, days, acct=acct, occurrences=2, amounts_recent=[amount, amount])


def _headline(monkeypatch, accounts, bills=(), incomes=(), inflows=(), payday_offset=8):
    _wire(monkeypatch, bills=list(bills), incomes=list(incomes), accounts=accounts, payday_offset=payday_offset)
    if inflows:
        real = analytics._build_cashflow_response

        async def with_inflows(cached, uid=None, **kw):
            resp = await real(cached, uid=uid, **kw)
            resp["internal_inflows"] = list(inflows)
            return resp

        monkeypatch.setattr(analytics, "_build_cashflow_response", with_inflows)
    return asyncio.run(analytics.compute_safe_to_spend(UID))


def _one(monkeypatch, cash, bill, money_in):
    return _headline(
        monkeypatch, [_acc("hb", "Harbour Current", cash)],
        bills=[_bill("Homebridge housing", bill, 4, acct="hb")] if bill else [],
        incomes=[_predicted("Transfer from another bank", money_in, 7, "hb")] if money_in else [],
    )


def test_money_in_covers_the_bills_the_figure_is_the_cash(monkeypatch):
    out = _one(monkeypatch, 5.0, 200.0, 300.0)
    assert out["safe_to_spend"] == 5.0 and out["left_to_spend_lines"]["accounts_total"] == 5.0


def test_money_in_that_falls_short_leaves_the_account_short_by_the_rest(monkeypatch):
    out = _one(monkeypatch, 5.0, 400.0, 300.0)
    assert out["safe_to_spend"] == -95.0 and out["state"] == "short"


def test_no_money_in_is_cash_less_the_bills(monkeypatch):
    assert _one(monkeypatch, 500.0, 200.0, 0.0)["safe_to_spend"] == 300.0


def test_kevins_real_shape_is_not_short_and_without_the_income_it_is(monkeypatch):
    out = _one(monkeypatch, 5.05, 77.91, 649.59)
    # 5.05 - max(0, 77.91 - 649.59) = 5.05: the 649.59 offsets the bill and adds nothing.
    assert out["safe_to_spend"] == 5.05 and out["state"] != "short"
    assert out["lowest_projected_balance"] == 5.05
    out = _one(monkeypatch, 5.05, 77.91, 0.0)
    assert out["safe_to_spend"] == -72.86 and out["state"] == "short"  # 5.05 - 77.91


def test_the_figure_does_not_depend_on_which_day_the_money_lands(monkeypatch):
    def run(day):
        return _headline(
            monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
            bills=[_bill("Homebridge housing", 77.91, 4, acct="hb")],
            incomes=[_predicted("Transfer from another bank", 649.59, day, "hb")],
        )["safe_to_spend"]
    assert run(1) == run(4) == run(7) == 34.89  # 34.89 - max(0, 77.91 - 649.59)


def test_the_money_dated_today_is_not_counted_until_it_has_posted(monkeypatch):
    # A bill and an occurrence both dated today: the occurrence may already be in the balance, so it is not
    # money in (account_available.money_in_out_window): 34.89 - 77.91 = -43.02.
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 0, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 0, "hb")],
    )
    assert out["safe_to_spend"] == -43.02


def test_money_and_a_bill_dated_payday_belong_to_the_next_period(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 8, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 8, "hb")],
    )
    assert out["safe_to_spend"] == 34.89


def test_several_accounts_add_up_each_on_its_own(monkeypatch):
    out = _headline(
        monkeypatch,
        [_acc("hb", "Harbour Current", 5.0), _acc("md", "Meadow Current", 5.0), _acc("br", "Brook Current", 500.0)],
        bills=[_bill("Rent share", 200.0, 3, acct="hb"), _bill("Rent", 400.0, 3, acct="md"), _bill("Water", 200.0, 3, acct="br")],
        incomes=[_predicted("Side income", 300.0, 5, "hb"), _predicted("Odd jobs", 300.0, 5, "md")],
    )
    # Harbour 5 - max(0, 200 - 300) = 5; Meadow 5 - max(0, 400 - 300) = -95; Brook 500 - 200 = 300. Total 210.
    assert out["left_to_spend_lines"]["accounts_total"] == 210.0 == out["safe_to_spend"]


def _transfer(amount, day, src, dst):
    return (
        _bill("Move to Meadow", amount, day, acct=src, kind=analytics.MOVEMENT, dest_account_id=dst, dest_account_spendable=True),
        {"name": "Move to Meadow", "amount": amount, "days_away": day, "account_id": dst, "source_account_id": src},
    )


def test_an_own_transfer_is_a_bill_on_the_sender_and_money_in_on_the_receiver(monkeypatch):
    bill, inflow = _transfer(150.0, 3, "hb", "md")
    accounts = [_acc("hb", "Harbour Current", 1000.0), _acc("md", "Meadow Current", 300.0)]
    # Harbour: 1,000 - 150 = 850. Meadow has no bill for the 150 to offset, so it stays 300. Total 1,150.
    out = _headline(monkeypatch, accounts, bills=[bill], inflows=[inflow])
    assert out["safe_to_spend"] == 1150.0
    # With a 200 bill of its own on Meadow, the 150 offsets part of it: 300 - (200 - 150) = 250. Total 1,100.
    out = _headline(monkeypatch, accounts, bills=[bill, _bill("Insurance", 200.0, 5, acct="md")], inflows=[inflow])
    assert out["safe_to_spend"] == 1100.0


def test_an_unfunded_transfer_still_counts_on_both_legs(monkeypatch):
    bill, inflow = _transfer(300.0, 3, "hb", "md")
    accounts = [_acc("hb", "Harbour Current", 100.0), _acc("md", "Meadow Current", 50.0)]
    out = _headline(monkeypatch, accounts, bills=[bill, _bill("Insurance", 120.0, 5, acct="md")], inflows=[inflow])
    # Harbour 100 - 300 = -200 (short). Meadow 50 - max(0, 120 - 300) = 50. Total -150.
    assert out["safe_to_spend"] == -150.0


def test_a_goal_or_set_aside_comes_off_the_total_once(monkeypatch):
    import app.routers.allocations as allocations_router
    base = _one(monkeypatch, 500.0, 200.0, 0.0)
    _wire(monkeypatch, bills=[_bill("Homebridge housing", 200.0, 4, acct="hb")], incomes=[], accounts=[_acc("hb", "Harbour Current", 500.0)], payday_offset=8)

    async def setasides(_uid):
        return 40.0, 1

    monkeypatch.setattr(allocations_router, "total_reserved_remaining", setasides)
    out = asyncio.run(analytics.compute_safe_to_spend(UID))
    assert base["safe_to_spend"] == 300.0 and out["safe_to_spend"] == 260.0  # 300 - 40, taken off once


# ── The per-account figure through the real engine ───────────────────────────

def test_a_goal_reduces_the_account_it_is_sourced_from_after_the_figure(monkeypatch):
    elig = {}
    goal = dict(_JAPAN, source_account_id="A", source_basis="chosen", remaining=80, period_amount=80)
    _eng_run(monkeypatch, [_eng_bill("Rent", 3, 100.0, "A", 500.0)], accounts=[_account("A", 500.0)],
             account_eligibility_out=elig, plans=[goal])
    a = elig["A"]
    # 500 - 100 = 400 is the figure before plans; the 80 goal comes off that account: 320.
    assert a["after_payments_and_money_in"] == 400.0 and a["plans_reserved"] == 80.0
    assert a["spend_from_headroom"] == 320.0


def test_the_engine_reads_the_same_rule_for_kevins_shape(monkeypatch):
    today = date(2026, 10, 20)  # payday Fri 30 Oct
    bills = [g._bill("Homebridge housing", 77.91, 3, today, acct=g.HS, balance=5.05)]
    items, elig = g._run(monkeypatch, today, bills, [g._salary(649.59, 6, today, acct=g.HS)], [], {g.HS: (5.05, "hsbc")})
    h = elig[g.HS]
    # The figure, the account's working row and the cover engine's lowest point are one number: 5.05.
    assert h["spend_from_headroom"] == h["after_payments_and_money_in"] == h["low_point"] == 5.05
    assert h["after_payments"] == 576.73  # cash plus money in less bills: information only
    assert not g._short(h)  # the cover engine's own verdict: after payments and low point at or above zero
    assert not [i for i in items if i.get("type") == "move"]


def test_the_engine_calls_an_account_short_exactly_when_its_figure_is_below_zero(monkeypatch):
    today = date(2026, 10, 20)
    bills = [g._bill("Homebridge housing", 77.91, 3, today, acct=g.HS, balance=5.05)]
    items, elig = g._run(monkeypatch, today, bills, [], [], {g.HS: (5.05, "hsbc")})
    h = elig[g.HS]
    assert h["spend_from_headroom"] == -72.86 == h["low_point"] == h["after_payments"]
    assert g._short(h)


def test_money_in_that_comes_before_or_after_the_bill_gives_the_engine_the_same_verdict(monkeypatch):
    today = date(2026, 10, 20)
    bills = [g._bill("Rent", 200.0, 3, today, acct=g.HS, balance=5.0)]
    for day in (1, 3, 6):
        _items, elig = g._run(monkeypatch, today, bills, [g._salary(300.0, day, today, acct=g.HS)], [], {g.HS: (5.0, "hsbc")})
        assert elig[g.HS]["spend_from_headroom"] == 5.0 and not g._short(elig[g.HS])


def test_a_covered_shortfall_is_counted_once_across_two_accounts(monkeypatch):
    today = date(2026, 10, 20)
    bills = [g._bill("Rent", 400.0, 3, today, acct=g.HS, balance=5.0), g._bill("Water", 200.0, 3, today, acct=g.BC, balance=500.0)]
    items, elig = g._run(monkeypatch, today, bills, [g._salary(300.0, 6, today, acct=g.HS)], [], {g.HS: (5.0, "hsbc"), g.BC: (500.0, "barclays")})
    # HSBC 5 - max(0, 400 - 300) = -95; Barclays 500 - 200 = 300. The cover move (95 -> 100, plus 10 = 110) is
    # set aside at Barclays and counted in at HSBC, so the pair is still 205.
    assert elig[g.HS]["after_payments_and_money_in"] == -95.0 and elig[g.BC]["after_payments_and_money_in"] == 300.0
    assert round(elig[g.HS]["spend_from_headroom"] + elig[g.BC]["spend_from_headroom"], 2) == 205.0


# ── Every surface reads the same stored figure (committed H140 snapshots) ────

def _snap(name):
    return json.loads((OUT / f"{name}.json").read_text())


def _stub_penny(monkeypatch, snap):
    import app.services.notifications as notifications

    async def today(uid):
        return {"account_eligibility": snap["account_eligibility"]}

    async def accounts(uid):
        return [{**a, "name": a["name"]} for a in snap["accounts"]]

    async def pots(uid):
        return set()

    async def tokens(uid):
        return []

    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(pc, "_load_accounts", accounts)
    monkeypatch.setattr(pc, "_load_pot_ids", pots)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)


def test_every_surface_shows_one_figure_for_kevins_shape(monkeypatch):
    snap = _snap("g481-kevins-shape-money-in-offsets-the-bill-and-is-not-short")
    sts, hb = snap["safe_to_spend"], snap["account_eligibility"]["acc-hb"]
    # Hero, status, the headline line, the account's Available (Spend from), its working row, the cover
    # engine's verdict (after payments and low point, `short`), the badge and the cover plan: 5.05 and not Short.
    assert sts["safe_to_spend"] == sts["left_to_spend_lines"]["accounts_total"] == sts["lowest_projected_balance"] == 5.05
    assert sts["safe_to_spend"] > 0 and sts["calculation_status"] == "complete"
    assert hb["spend_from_headroom"] == hb["after_payments_and_money_in"] == hb["low_point"] == 5.05
    assert hb["after_payments"] > 0 and snap["at_risk_count"] == 0
    assert not [i for i in snap["items"] if i["type"] == "move"]
    # Penny lists the account's Available from the same stored figure.
    _stub_penny(monkeypatch, snap)
    out = asyncio.run(pc.spend_from_extras("u"))
    assert [row["amount"]["raw"] for row in out["spend_from"]] == [5.05]
    assert "short_before_money_arrives" not in out and "left_to_spend_basis" not in out


def test_every_surface_shows_one_figure_for_the_short_twin(monkeypatch):
    snap = _snap("g481-kevins-shape-without-the-income-is-short")
    sts, hb = snap["safe_to_spend"], snap["account_eligibility"]["acc-hb"]
    assert sts["safe_to_spend"] == sts["left_to_spend_lines"]["accounts_total"] == hb["spend_from_headroom"] == -72.86
    assert sts["safe_to_spend"] < 0 and hb["low_point"] == hb["after_payments"] == -72.86
    assert snap["at_risk_count"] == 1


def test_the_hero_is_the_account_figures_added_up_when_a_move_covers_a_shortfall(monkeypatch):
    snap = _snap("g481-one-account-is-short-another-has-room-the-move-covers-it")
    sts, elig = snap["safe_to_spend"], snap["account_eligibility"]
    assert round(sum(e["spend_from_headroom"] for e in elig.values()), 2) == sts["safe_to_spend"] == 924.0
    assert elig["acc-md"]["covered_by_move"]["amount"] == 90.0 and elig["acc-hb"]["earmarked_total"] == 90.0
    assert elig["acc-md"]["after_payments_and_money_in"] == -76.0  # the shortfall the move covers, once


def test_the_cache_versions_moved_so_an_old_payload_cannot_contradict_the_rule():
    import app.services.response_cache as rc

    assert analytics.SAFE_TO_SPEND_CALCULATION_VERSION >= 6 and rc.SHAPE_VERSION >= 14
