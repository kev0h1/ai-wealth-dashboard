"""Unit test for the `period_gate` addition to
`penny_tools._exec_get_savings_position` — owner decision (2026-08-30):
"if I'm short and to say I have money to stash away doesn't make sense."
monthly_surplus is a 90-day smoothed median and can read positive while the
CURRENT pay period is short, so Penny must not tell a short-period user
they have money spare to move or stash. This mirrors
`backend/app/routers/grow.py`'s own `_period_gate` derivation (imported,
never re-derived) against the same `compute_safe_to_spend` fact — see
test_grow.py for the pure-function coverage of the gate condition itself.

No mongomock is available in this environment; every DB-touching
collaborator `_exec_get_savings_position` reaches is monkeypatched at
`app.services.penny_tools`'s own namespace (it imports each by name),
matching the pattern test_grow.py/test_spend_impact.py already established.
"""
import asyncio

import app.services.penny_tools as penny_tools

UID = "kevin@example.com"


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None


def _patch_common(monkeypatch, *, sts, monthly_income=2000.0, monthly_spending=1934.0, monthly_surplus=66.0):
    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools, "get_user_region", fake_region)
    monkeypatch.setattr(penny_tools, "savings_goals_col", _FakeCol([{"_id": UID, "target_months": 3}]))

    async def fake_cashflow(uid, region, cutoff):
        return monthly_income, monthly_spending, monthly_surplus

    monkeypatch.setattr(penny_tools, "_cashflow", fake_cashflow)

    async def fake_current_savings(uid, goal):
        return 500.0

    monkeypatch.setattr(penny_tools, "_current_savings", fake_current_savings)

    def fake_target_amount(goal, monthly_spending_):
        return round(monthly_spending_ * 3, 2)

    monkeypatch.setattr(penny_tools, "_target_amount", fake_target_amount)

    async def fake_sts(uid):
        return sts

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", fake_sts)


def test_get_savings_position_gates_when_period_short(monkeypatch):
    sts = {"status": "ok", "state": "short", "safe_to_spend": -156.0, "next_payday": "2026-09-25"}
    _patch_common(monkeypatch, sts=sts)

    result = asyncio.run(penny_tools._exec_get_savings_position(UID))

    assert result["period_gate"]["short"] is True
    assert result["period_gate"]["to_cover"]["raw"] == 156.0
    assert result["period_gate"]["period_end"] == "2026-09-25"
    assert "note" in result["period_gate"]
    # The typical-month figure itself is untouched — additive field only.
    assert result["monthly_surplus"]["raw"] == 66.0


def test_get_savings_position_not_gated_when_not_short(monkeypatch):
    sts = {"status": "ok", "state": "comfortable", "safe_to_spend": 900.0, "next_payday": "2026-09-25"}
    _patch_common(monkeypatch, sts=sts)

    result = asyncio.run(penny_tools._exec_get_savings_position(UID))

    assert result["period_gate"]["short"] is False
    assert result["period_gate"]["to_cover"]["raw"] == 0.0
    assert "note" not in result["period_gate"]
    assert result["monthly_surplus"]["raw"] == 66.0


def test_get_savings_position_degrades_gracefully_when_sts_lookup_fails(monkeypatch):
    _patch_common(monkeypatch, sts={"status": "insufficient_data"})

    async def _boom(uid):
        raise RuntimeError("db outage")

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", _boom)

    result = asyncio.run(penny_tools._exec_get_savings_position(UID))
    assert result["period_gate"]["short"] is False
    # A compute_safe_to_spend outage must not take the whole tool down.
    assert result["monthly_surplus"]["raw"] == 66.0
