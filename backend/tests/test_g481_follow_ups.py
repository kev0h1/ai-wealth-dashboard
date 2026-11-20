"""G481 follow-ups: income dated today counts on no walk until it has posted, and the destination of a
predicted own transfer is never offered as the lender for that transfer's source (the G479 rule, kept)."""
from datetime import date
from types import SimpleNamespace

import pytest

import app.routers.analytics as analytics
import app.services.account_walk as aw
import tests.test_g360_one_account_walk as g

TODAY = date(2026, 10, 20)  # payday Fri 30 Oct


def _ceil5(x):
    return -(-x // 5) * 5


def _moves_total(items):
    return sum(float(m.get("amount") or 0) for i in items if i.get("type") == "move" for m in i.get("moves") or [])


# ── Income dated today is money in on no surface until it has posted ─────────

def _inputs(income_day):
    bill = {"name": "Rent", "days_away": 3, "amount": 200.0, "account_id": "a", "account_balance": 5.0, "kind": "commitment"}
    inc = {"name": "Pay", "days_away": income_day, "amount": 300.0, "account_id": "a", "occurrences": 4,
           "amounts_recent": [300.0] * 4, "confirmed_alias": None}
    return SimpleNamespace(assessable_bills=[bill], window_income=[inc], running_seed={"a": 5.0}, window_inflows=[],
                           confirmed_income_keys=frozenset(), live_balances={"a": 5.0}, days_to_pay=10)


def test_one_shared_filter_decides_what_counts():
    assert aw.income_counts_in_walk({"days_away": 0}) is False
    assert aw.income_counts_in_walk({"days_away": 1}) is True


def test_the_at_risk_walk_does_not_credit_income_dated_today():
    for day, bounced in ((0, 1), (1, 0)):
        events, seed, _ = aw.window_events(_inputs(day))
        _r, _m, _s, b = aw.walk_events(events, dict(seed))
        assert aw.count_at_risk(b) == bounced, day


def test_the_closing_and_position_walks_do_not_credit_income_dated_today():
    for day, closing in ((0, -195.0), (1, 105.0)):
        w = aw.walk_account("a", _inputs(day), opening=5.0)
        assert round(w.closing, 2) == closing, day
        low = aw.walk_account("a", _inputs(day), opening=5.0, income_admit="any", inflow_admit="any", same_day_key="positive_delta")
        assert low.low_point == (-195.0 if day == 0 else 5.0), day


def test_the_engine_positions_and_cover_plan_do_not_credit_income_dated_today(monkeypatch):
    def run(day):
        bills = [g._bill("Rent", 200.0, 3, TODAY, acct=g.HS, balance=5.0)]
        return g._run(monkeypatch, TODAY, bills, [g._salary(300.0, day, TODAY, acct=g.HS)], [],
                      {g.HS: (5.0, "hsbc"), g.BC: (5000.0, "barclays")})

    items, elig = run(0)
    h = elig[g.HS]
    # 5 - 200 = -195: short on the position walks, on the figure, and the cover plan moves money in.
    assert h["after_payments"] == h["low_point"] == -195.0
    assert h["after_payments_and_money_in"] == -195.0 and g._short(h)
    assert _moves_total(items) == _ceil5(195.0) + 10
    items, elig = run(1)
    h = elig[g.HS]
    assert h["low_point"] == 5.0 and h["after_payments_and_money_in"] == 5.0 and not g._short(h)
    assert _moves_total(items) == 0.0


# ── The destination of a transfer is never a lender to that transfer's source ─

def _edge_world(monkeypatch, *, third=False, third_balance=5000.0):
    # BC holds 100 and is due to send 300 to HS on day 2; HS holds 50 and pays 120 on day 3.
    bills = [g._bill("To HSBC", 300.0, 2, TODAY, acct=g.BC, balance=100.0, kind=analytics.MOVEMENT),
             g._bill("Insurance", 120.0, 3, TODAY, acct=g.HS, balance=50.0)]
    balances = {g.HS: (50.0, "hsbc"), g.BC: (100.0, "barclays")}
    if third:
        balances["acc-third"] = (third_balance, "monzo")
    return g._run(monkeypatch, TODAY, bills, [], [g._inflow(300.0, 2, TODAY)], balances)


def test_the_destination_of_a_transfer_is_never_offered_as_a_source_for_the_senders_shortfall(monkeypatch):
    # The third account has only 100 (90 of headroom), so on its own it cannot cover BC's 210 target and the
    # engine would reach for a second source: HS, the destination of BC's order. It must not.
    items, elig = _edge_world(monkeypatch, third=True, third_balance=100.0)
    sources = {f["account_id"] for f in (elig[g.BC].get("covered_by_move") or {}).get("from") or []}
    assert g.HS not in sources and sources == {"acc-third"}
    for item in items:
        for move in item.get("moves") or []:
            assert move["move_map"]["from"]["account_id"] != g.HS


def test_with_no_other_lender_the_sender_stays_short_and_no_move_is_made(monkeypatch):
    items, elig = _edge_world(monkeypatch)
    assert "covered_by_move" not in elig[g.BC] and _moves_total(items) == 0.0
