"""G479 follow-up: the cover plan's shortfall, the Upcoming By account position and the hero/Available
ledger dip are one number per account.

The hero and Available read `account_available.account_ledger` (ungated: an expected own-account transfer
credit counts on its date, G436). The cover engine and the Upcoming position read the gated walks. Since the G479 ruling (Kevin 2026-11-19, "all figures must be
consistent") there is ONE gate: a transfer its source cannot fund (G360) is excluded on both legs everywhere
(`window_inputs`), so the surfaces agree even where the gate drops a transfer.
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


def test_when_a_g360_gate_drops_a_transfer_both_legs_go_and_every_surface_agrees(monkeypatch):
    # Kevin 2026-11-19, "all figures must be consistent". BC holds 100 and is due to send 300 on day 2, so the
    # G360 test says it cannot fund it: the transfer is excluded on BOTH legs everywhere. HS holds 50 and pays 120
    # on day 3. BC keeps 100 with no dip; HS is 50 - 120 = -70. Total 30, the pooled 100 + 50 - 120.
    bills = [g._bill("To HSBC", 300.0, 2, TODAY, acct=g.BC, balance=100.0, kind=analytics.MOVEMENT),
             g._bill("Insurance", 120.0, 3, TODAY, acct=g.HS, balance=50.0)]
    inflows = [{**g._inflow(300.0, 2, TODAY), "name": "To HSBC", "destination_spendable": True}]
    items, elig = g._run(monkeypatch, TODAY, bills, [], inflows, {g.HS: (50.0, "hsbc"), g.BC: (100.0, "barclays")})
    # Ledger dip == gated shortfall (Upcoming's position and the cover plan) on every account.
    assert (_ledger_dip(elig[g.BC]), _gated_shortfall(elig[g.BC])) == (0.0, 0.0)
    assert (_ledger_dip(elig[g.HS]), _gated_shortfall(elig[g.HS])) == (70.0, 70.0)
    # Exactly one shortfall (HS 70) and one cover move, sized from it: ceil5(70) + 10 = 80, taken from BC.
    assert _moves_total(items) == _ceil5(70.0) + 10 == 80.0
    assert elig[g.HS]["covered_by_move"]["shortfall"] == 70.0 and "covered_by_move" not in elig[g.BC]
    # The total is the pooled 100 + 50 - 120 = 30 (the move nets to zero): BC 100 - 80 earmarked, HS -70 + 80.
    assert round(elig[g.BC]["spend_from_headroom"] + elig[g.HS]["spend_from_headroom"], 2) == 30.0
    assert (elig[g.BC]["spend_from_headroom"], elig[g.HS]["spend_from_headroom"]) == (20.0, 10.0)
