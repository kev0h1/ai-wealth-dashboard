"""Regression guards for work removed from Spend's cold critical path."""

import asyncio

import app.routers.analytics as analytics
import app.services.net_position as net_position
import app.services.spend_impact as spend_impact
import app.services.spend_verdict as spend_verdict


def test_over_pace_skips_permission_only_balance_reads(monkeypatch):
    async def forbidden(*_args, **_kwargs):
        raise AssertionError("over-pace verdict must not load Safe-to-Spend or period net")

    async def fake_pay_cfg(_uid):
        return {"type": "calendar_month"}

    async def fake_move(_uid, _delta, _pay_cfg, headroom=None):
        assert headroom == 0.0
        return {"usual": 300.0, "projected": 100.0}, None

    async def fake_bills(_uid, _total_excess, _period):
        return None

    monkeypatch.setattr(analytics, "compute_safe_to_spend", forbidden)
    monkeypatch.setattr(net_position, "period_net", forbidden)
    monkeypatch.setattr(spend_impact, "_pay_cfg", fake_pay_cfg)
    monkeypatch.setattr(spend_impact, "_compute_move_and_horizon", fake_move)
    monkeypatch.setattr(spend_impact, "_bills_risk", fake_bills)

    result = asyncio.run(spend_impact.compute_spend_impact(
        "cold-path-user",
        {
            "period": {"days_elapsed": 20, "days_left": 10, "closed": False, "thin_history": False},
            "total_excess": 50.0,
        },
    ))

    assert result["consequence"] == "move_delta"


def test_active_goal_names_reads_metadata_without_balance_ledger(monkeypatch):
    class FakeCursor:
        def __init__(self):
            self.sort_spec = None

        def sort(self, spec):
            self.sort_spec = spec
            return self

        async def to_list(self, _length):
            return [
                {"name": "Holiday", "funding_pots": [{"account_id": "pot-1"}]},
                {"name": "Holiday", "funding_pots": [{"account_id": "pot-2"}]},
                {"name": "Legacy goal", "funding_pots": [], "funding_account_id": "legacy-pot"},
                {"name": "Unlinked", "funding_pots": []},
            ]

    class FakeCollection:
        def __init__(self):
            self.query = None
            self.projection = None
            self.cursor = FakeCursor()

        def find(self, query, projection):
            self.query = query
            self.projection = projection
            return self.cursor

    collection = FakeCollection()
    monkeypatch.setattr(spend_verdict, "commitments_col", collection)

    names = asyncio.run(spend_verdict._active_goal_names("cold-path-user"))

    assert names == ["Holiday", "Legacy goal"]
    assert collection.query == {"user_id": "cold-path-user", "status": "active"}
    assert "balance" not in collection.projection
    assert collection.cursor.sort_spec == [("created_at", 1), ("_id", 1)]
