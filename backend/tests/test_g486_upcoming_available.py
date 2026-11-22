"""G486: Upcoming's By account row and the account page's "Available to spend" read one stored figure.

The real engine (`companion.compute_today_items`, the service behind GET /today) is run on fixtures for a covered
account, a short account, an account with a cover move and an earmark, and an account with a goal. The resulting
`account_eligibility` payload is handed to the frontend's own code (`frontend/scripts/g486-compare-payload.mjs`),
which renders Upcoming's By account row and reads the account page's `accountAvailability` from that same payload
and asserts they show the same figure, label and Short verdict for every current account. The engine side also
checks the figure balances on the working both surfaces list.
"""
import json
import shutil
import subprocess
from datetime import date
from pathlib import Path

import pytest

import tests.test_g360_one_account_walk as g
from test_cover_plan_account_eligibility import _JAPAN, _account, _bill as _eng_bill, _run as _eng_run

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
TODAY = date(2026, 10, 20)  # payday Fri 30 Oct


def _web_accounts(rows):
    return [{"id": i, "name": name, "provider": name, "balance": bal, "currency": "GBP", "status": "connected",
             "type": "BANK", "subtype": "TRANSACTION", "include_in_safe_to_spend": True} for i, (bal, name) in rows.items()]


def _covered(monkeypatch):
    balances = {g.HS: (5.05, "hsbc")}
    _items, elig = g._run(monkeypatch, TODAY, [g._bill("Homebridge housing", 77.91, 3, TODAY, acct=g.HS, balance=5.05)],
                          [g._salary(649.59, 6, TODAY, acct=g.HS)], [], balances)
    return elig, _web_accounts(balances)


def _short(monkeypatch):
    balances = {g.HS: (5.05, "hsbc")}
    _items, elig = g._run(monkeypatch, TODAY, [g._bill("Homebridge housing", 77.91, 3, TODAY, acct=g.HS, balance=5.05)], [], [], balances)
    return elig, _web_accounts(balances)


def _cover_move(monkeypatch):
    balances = {g.HS: (5.0, "hsbc"), g.BC: (500.0, "barclays")}
    bills = [g._bill("Rent", 400.0, 3, TODAY, acct=g.HS, balance=5.0), g._bill("Water", 200.0, 3, TODAY, acct=g.BC, balance=500.0)]
    _items, elig = g._run(monkeypatch, TODAY, bills, [g._salary(300.0, 6, TODAY, acct=g.HS)], [], balances)
    return elig, _web_accounts(balances)


def _goal(monkeypatch):
    elig = {}
    goal = dict(_JAPAN, source_account_id="A", source_basis="chosen", remaining=80, period_amount=80)
    _eng_run(monkeypatch, [_eng_bill("Rent", 3, 100.0, "A", 500.0)], accounts=[_account("A", 500.0)],
             account_eligibility_out=elig, plans=[goal])
    return elig, _web_accounts({"A": (500.0, "barclays")})


CASES = {"covered": _covered, "short": _short, "cover_move_and_earmark": _cover_move, "goal": _goal}


def _current(elig):
    return {k: v for k, v in elig.items() if v.get("is_current_account", True) and not v.get("uncertain")}


@pytest.mark.parametrize("kind", CASES)
def test_engine_figure_is_its_working(monkeypatch, kind):
    elig, _accounts = CASES[kind](monkeypatch)
    current = _current(elig)
    assert current
    for account_id, e in current.items():
        working = (e["after_payments_and_money_in"] - e.get("plans_reserved", 0.0)
                   - e.get("earmarked_total", 0.0) + e.get("moves_in_total", 0.0))
        assert round(working, 2) == e["spend_from_headroom"], (kind, account_id)


@pytest.mark.skipif(shutil.which("node") is None or not (FRONTEND / "node_modules").exists(), reason="frontend toolchain not available")
@pytest.mark.parametrize("kind", CASES)
def test_upcoming_row_equals_account_page_for_the_real_engine_payload(monkeypatch, tmp_path, kind):
    elig, accounts = CASES[kind](monkeypatch)
    path = tmp_path / f"{kind}.json"
    path.write_text(json.dumps({"accounts": accounts, "account_eligibility": elig}))
    out = subprocess.run(
        ["node", "--no-warnings", "--experimental-loader", "./scripts/_tsx-loader.mjs", "scripts/g486-compare-payload.mjs", str(path)],
        cwd=FRONTEND, capture_output=True, text=True, timeout=120,
    )
    assert out.returncode == 0, out.stderr[-2000:]
    assert out.stdout.strip() == f"compared {len(_current(elig))}"


def test_scenarios_have_the_shapes_they_claim(monkeypatch):
    elig, _ = _short(monkeypatch)
    assert next(iter(elig.values()))["spend_from_headroom"] == -72.86
    elig, _ = _cover_move(monkeypatch)
    assert elig[g.BC].get("earmarked_total", 0) > 0 and elig[g.HS].get("moves_in_total", 0) > 0
    elig, _ = _goal(monkeypatch)
    assert elig["A"]["plans_reserved"] == 80.0 and elig["A"]["spend_from_headroom"] == 320.0
