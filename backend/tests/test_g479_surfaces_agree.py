"""G479 follow-up: the cover plan's shortfall, the Upcoming By account position and the hero/Available
ledger dip are one number per account.

The hero and Available read `account_available.account_ledger` (ungated: an expected own-account transfer
credit counts on its date, G436). The cover engine and the Upcoming position read the same window events. Since the G479 ruling (Kevin 2026-11-19, option 1) there
is NO inbound-transfer gate: a predicted own transfer counts on both legs everywhere, so the surfaces agree.
"""
from datetime import date

import pytest

import app.routers.analytics as analytics
import tests.test_g360_one_account_walk as g

TODAY = date(2026, 10, 10)


def _ceil5(x):
    return -(-x // 5) * 5


def _moves_total(items):
    total = 0.0
    for item in items:
        if item.get("type") == "move":
            total += sum(float(m.get("amount") or 0) for m in item.get("moves") or [])
    return total


def _gated_shortfall(entry):
    """What Upcoming's By account and the cover engine call the account's shortfall."""
    return round(max(0.0, -min(float(entry["after_payments"]), float(entry["low_point"]))), 2)


def _ledger_dip(entry):
    return float((entry.get("dips_below_zero") or {}).get("short_by") or 0.0)


def test_a_dip_before_money_lands_is_one_number_on_every_surface(monkeypatch):
    bills = [g._bill("Rent", 300.0, 2, TODAY, acct=g.BC, balance=100.0)]
    income = [g._salary(1000.0, 6, TODAY, acct=g.BC)]
    items, elig = g._run(monkeypatch, TODAY, bills, income, [], {g.BC: (100.0, "barclays")})
    bc = elig[g.BC]
    # 100 - 300 = -200 on day 2, + 1,000 on day 6: the dip is 200 everywhere.
    assert _ledger_dip(bc) == 200.0 == _gated_shortfall(bc)
    assert bc["spend_from_headroom"] == -200.0
    assert _moves_total(items) == 0.0  # no other account to cover it


def test_the_cover_plan_move_is_sized_from_the_same_dip_the_ledger_reports(monkeypatch):
    bills = [g._bill("Rent", 300.0, 2, TODAY, acct=g.HS, balance=100.0)]
    items, elig = g._run(monkeypatch, TODAY, bills, [], [], {g.HS: (100.0, "hsbc"), g.BC: (5000.0, "barclays")})
    hs = elig[g.HS]
    assert _ledger_dip(hs) == 200.0 == _gated_shortfall(hs)
    assert hs["covered_by_move"]["shortfall"] == 200.0
    assert _moves_total(items) == _ceil5(200.0) + 10  # the engine's own sizing rule: next 5 plus 10
    # The dip is counted once: the source is earmarked, the destination covered, the pair nets as before.
    assert round(elig[g.BC]["spend_from_headroom"] + hs["spend_from_headroom"], 2) == 5000.0 - 200.0


def test_a_funded_transfer_credit_agrees_everywhere(monkeypatch):
    # BC 1,000 pays HS 300 on day 2; HS 50 pays 120 on day 3. The source is covered, so the gate keeps the credit.
    bills = [g._bill("To HSBC", 300.0, 2, TODAY, acct=g.BC, balance=1000.0, kind=analytics.MOVEMENT),
             g._bill("Insurance", 120.0, 3, TODAY, acct=g.HS, balance=50.0)]
    items, elig = g._run(monkeypatch, TODAY, bills, [], [g._inflow(300.0, 2, TODAY)], {g.HS: (50.0, "hsbc"), g.BC: (1000.0, "barclays")})
    for acct in (g.HS, g.BC):
        assert _ledger_dip(elig[acct]) == 0.0 == _gated_shortfall(elig[acct])
    assert _moves_total(items) == 0.0


def _edge_world(monkeypatch, *, third=False):
    # Kevin's option 1 (2026-11-19): BC holds 100 and is due to send 300 on day 2; HS holds 50 and pays 120 on day 3.
    # The transfer counts on BOTH legs whether or not BC can fund it: BC is -200 short, HS is fine (50 + 300 - 120).
    bills = [g._bill("To HSBC", 300.0, 2, TODAY, acct=g.BC, balance=100.0, kind=analytics.MOVEMENT),
             g._bill("Insurance", 120.0, 3, TODAY, acct=g.HS, balance=50.0)]
    balances = {g.HS: (50.0, "hsbc"), g.BC: (100.0, "barclays")}
    if third:
        balances["acc-third"] = (5000.0, "monzo")
    return g._run(monkeypatch, TODAY, bills, [], [g._inflow(300.0, 2, TODAY)], balances)


def test_an_unfundable_standing_order_is_one_shortfall_on_the_source_on_every_surface(monkeypatch):
    items, elig = _edge_world(monkeypatch)
    # Ledger dip == gated shortfall (Upcoming's position and the cover plan) on every account: BC 200, HS 0.
    assert (_ledger_dip(elig[g.BC]), _gated_shortfall(elig[g.BC])) == (200.0, 200.0)
    assert (_ledger_dip(elig[g.HS]), _gated_shortfall(elig[g.HS])) == (0.0, 0.0)
    # HS is fine on its own (50 + 300 - 120 = 230, never flagged short for money due to arrive) and is the only
    # account with any room, so it can lend BC 40 (230 - 10 cushion... its headroom is 40): HS 230 - 40, BC -200 + 40.
    assert elig[g.HS]["earmarked_total"] == 40.0 and elig[g.HS]["spend_from_headroom"] == 190.0
    assert elig[g.BC]["spend_from_headroom"] == -160.0 and elig[g.BC]["short_after_cover"] == 160.0
    # BC stays short after the move and the total shows it: -200 + 230 = 30 (the move nets to zero).
    assert round(elig[g.BC]["spend_from_headroom"] + elig[g.HS]["spend_from_headroom"], 2) == 30.0
    assert _moves_total(items) == 40.0


def test_the_cover_move_goes_into_the_source_so_the_standing_order_does_not_bounce(monkeypatch):
    items, elig = _edge_world(monkeypatch, third=True)
    assert (_ledger_dip(elig[g.BC]), _gated_shortfall(elig[g.BC])) == (200.0, 200.0)
    assert elig[g.BC]["covered_by_move"]["shortfall"] == 200.0 and "covered_by_move" not in elig[g.HS]
    assert _moves_total(items) == _ceil5(200.0) + 10 == 210.0  # one move, from the room-rich third account
    # The move nets to zero in the total: BC -200 + 210 = 10, the third 5,000 - 210, HS 230.
    assert elig[g.BC]["spend_from_headroom"] == 10.0
    assert round(sum(e["spend_from_headroom"] for e in elig.values()), 2) == 5030.0
