"""Unit tests for backend/app/routers/grow.py's `period_gate` — the owner
decision (2026-08-30, verbatim): "if I'm short and to say I have money to
stash away doesn't make sense." Grow's typical-month surplus (a median
smoothed over 90 days) can read positive while the CURRENT pay period is
short; `_period_gate` borrows compute_safe_to_spend's own state/sign
semantics (state == "short") so Grow can never disagree with Home's
Safe-to-Spend hero or Planning's runway about whether the user is short
right now. See grow._period_gate's own docstring.

No mongomock is available in this environment (see test_notifications.py's
own note); grow_view's DB-touching collaborators are monkeypatched at
their SOURCE modules — grow.py imports each helper by name into its own
namespace, and pulls compute_safe_to_spend in via a lazy `from X import Y`
inside the function body, which still reads the patched attribute off
`app.routers.analytics` at call time (same pattern test_spend_impact.py
and test_net_position.py already established).
"""
import asyncio

import app.routers.analytics as analytics
import app.routers.grow as grow

UID = "kevin@example.com"


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class _FakeCol:
    """Stand-in for a Motor collection — just enough of `.find_one()`/
    `.find()` to drive grow_view when there's nothing (or one doc) to
    return."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    def find(self, query=None, projection=None):
        return _FakeCursor(self.docs)


def _patch_grow_common(
    monkeypatch,
    *,
    sts,
    monthly_income=2000.0,
    monthly_spending=1934.0,
    monthly_surplus=66.0,
):
    """Patches every grow_view collaborator except the assertions under
    test, so each test only has to state the one thing it's varying
    (compute_safe_to_spend's result) or override further after calling
    this."""
    monkeypatch.setattr(grow, "preferences_col", _FakeCol([{}]))
    monkeypatch.setattr(grow, "savings_goals_col", _FakeCol([]))
    monkeypatch.setattr(grow, "investment_accounts_col", _FakeCol([]))

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(grow, "get_user_region", fake_region)

    async def fake_cashflow(uid, region, cutoff):
        return monthly_income, monthly_spending, monthly_surplus

    monkeypatch.setattr(grow, "_cashflow", fake_cashflow)

    async def fake_current_savings(uid, goal):
        return 500.0

    monkeypatch.setattr(grow, "_current_savings", fake_current_savings)

    def fake_target_amount(goal, monthly_spending_):
        return round(monthly_spending_ * 3, 2)

    monkeypatch.setattr(grow, "_target_amount", fake_target_amount)

    async def fake_debt_plan(uid):
        return {"cards": [], "totals": {"debt": 0.0}}

    monkeypatch.setattr(grow, "get_debt_plan_cached", fake_debt_plan)

    async def fake_sts(uid):
        return sts

    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_sts)


# ── _period_gate — pure, no DB, mirrors net_position.short_reason_for's own
#    factoring so the gate condition itself is directly testable ─────────

def test_period_gate_short_state_gates():
    sts = {"status": "ok", "state": "short", "safe_to_spend": -156.0, "next_payday": "2026-09-25"}
    gate = grow._period_gate(sts)
    assert gate == {"short": True, "to_cover": 156.0, "period_end": "2026-09-25"}


def test_period_gate_comfortable_state_not_gated():
    sts = {"status": "ok", "state": "comfortable", "safe_to_spend": 420.0, "next_payday": "2026-09-25"}
    gate = grow._period_gate(sts)
    assert gate == {"short": False, "to_cover": 0.0, "period_end": "2026-09-25"}


def test_period_gate_tight_state_not_gated():
    # "tight" is real (in-hand cash is thin) but it's not the genuine
    # shortfall alarm state — only "short" earns the gate, exactly matching
    # Home's Safe-to-Spend hero (SafeToSpendCard.tsx's showSpendCTA/red
    # rules are state === "short" only, never "tight").
    sts = {"status": "ok", "state": "tight", "safe_to_spend": 40.0, "next_payday": "2026-09-25"}
    gate = grow._period_gate(sts)
    assert gate["short"] is False
    assert gate["to_cover"] == 0.0


def test_period_gate_insufficient_data_degrades_to_not_short():
    # No fabricated gate from absent data — degrades to "not short" rather
    # than guessing.
    gate = grow._period_gate({"status": "insufficient_data"})
    assert gate == {"short": False, "to_cover": 0.0, "period_end": None}


def test_period_gate_to_cover_is_absolute_value():
    sts = {"status": "ok", "state": "short", "safe_to_spend": -0.01, "next_payday": "2026-09-25"}
    gate = grow._period_gate(sts)
    assert gate["to_cover"] == 0.01
    assert gate["short"] is True


# ── grow_view integration — gate wired into the real endpoint payload,
#    typical-month figures verified unchanged (verdict-hierarchy change
#    only, per the owner's decision — not an arithmetic one) ─────────────

def test_grow_view_carries_gate_when_short(monkeypatch):
    sts = {"status": "ok", "state": "short", "safe_to_spend": -156.0, "next_payday": "2026-09-25"}
    _patch_grow_common(monkeypatch, sts=sts)

    view = asyncio.run(grow.grow_view({"email": UID}))

    assert view["period_gate"] == {"short": True, "to_cover": 156.0, "period_end": "2026-09-25"}
    # Surplus maths and the existing headline are untouched.
    assert view["surplus_monthly"] == 66.0
    assert "spare" in view["verdict"]["headline"]


def test_grow_view_carries_gate_when_not_short(monkeypatch):
    sts = {"status": "ok", "state": "comfortable", "safe_to_spend": 900.0, "next_payday": "2026-09-25"}
    _patch_grow_common(monkeypatch, sts=sts)

    view = asyncio.run(grow.grow_view({"email": UID}))

    assert view["period_gate"] == {"short": False, "to_cover": 0.0, "period_end": "2026-09-25"}
    assert view["surplus_monthly"] == 66.0


def test_grow_view_degrades_gracefully_when_sts_lookup_fails(monkeypatch):
    _patch_grow_common(monkeypatch, sts={"status": "insufficient_data"})

    async def _boom(uid):
        raise RuntimeError("db outage")

    monkeypatch.setattr(analytics, "compute_safe_to_spend", _boom)

    view = asyncio.run(grow.grow_view({"email": UID}))
    assert view["period_gate"] == {"short": False, "to_cover": 0.0, "period_end": None}
    # A compute_safe_to_spend outage must not take the whole endpoint down.
    assert view["surplus_monthly"] == 66.0
