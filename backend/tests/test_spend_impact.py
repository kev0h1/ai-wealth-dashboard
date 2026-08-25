"""Unit tests for the headroom cap + net-negative gate in
app.services.spend_impact — the owner-approved 2026-08 fix for the Spend
page's "your move could be about £X bigger" promise, which previously had
no cap against money that actually exists.

No mongomock is available in this environment (see test_notifications.py's
own note); `_compute_move_and_horizon`'s DB-touching collaborators
(`_usual_move_total`, `_debt_horizon`, `_goal_horizon`) and
`compute_spend_impact`'s headroom/net-position lookups
(`app.routers.analytics.compute_safe_to_spend`,
`app.services.net_position.period_net`) are monkeypatched at their source
modules so only the pure capping/gating logic under test actually runs.
"""
import asyncio

import app.routers.analytics as analytics
import app.services.net_position as net_position
import app.services.spend_impact as spend_impact

PAY_CFG = {"type": "calendar_month"}


def _patch_usual_move(monkeypatch, usual_move=300.0, salary_acct="acct1", evidence_paydays=4):
    async def fake_usual(uid, pay_cfg):
        return usual_move, salary_acct, evidence_paydays

    monkeypatch.setattr(spend_impact, "_usual_move_total", fake_usual)


def _patch_no_horizon(monkeypatch):
    async def fake_debt(uid, delta):
        return None

    async def fake_goal(uid, delta, pay_cfg):
        return None

    monkeypatch.setattr(spend_impact, "_debt_horizon", fake_debt)
    monkeypatch.setattr(spend_impact, "_goal_horizon", fake_goal)


# ── _compute_move_and_horizon: headroom cap ─────────────────────────────────

def test_permission_direction_extra_capped_at_headroom(monkeypatch):
    _patch_usual_move(monkeypatch)
    _patch_no_horizon(monkeypatch)

    # Under usual pace by £500; usual move £300; threshold = max(25, 30) = 30.
    move_out, _ = asyncio.run(
        spend_impact._compute_move_and_horizon("kevin", -500.0, PAY_CFG, headroom=120.0)
    )
    assert move_out == {"usual": 300.0, "projected": 420.0}  # 300 + min(500, 120)


def test_permission_direction_suppressed_when_capped_extra_below_threshold(monkeypatch):
    _patch_usual_move(monkeypatch)
    _patch_no_horizon(monkeypatch)

    # headroom (£10) caps extra below the £30 silence threshold — no trivial
    # promise, move falls through to None.
    move_out, _ = asyncio.run(
        spend_impact._compute_move_and_horizon("kevin", -500.0, PAY_CFG, headroom=10.0)
    )
    assert move_out is None


def test_permission_direction_uncapped_when_headroom_is_none(monkeypatch):
    _patch_usual_move(monkeypatch)
    _patch_no_horizon(monkeypatch)

    # No headroom passed (compute_intent_preview's use case) — full delta,
    # matching the pre-fix behaviour for that caller.
    move_out, _ = asyncio.run(
        spend_impact._compute_move_and_horizon("kevin", -500.0, PAY_CFG)
    )
    assert move_out == {"usual": 300.0, "projected": 800.0}


def test_over_pace_direction_unaffected_by_headroom(monkeypatch):
    _patch_usual_move(monkeypatch)
    _patch_no_horizon(monkeypatch)

    # Over-pace direction (delta > 0) shrinks the move — headroom is
    # irrelevant here and must not touch this branch.
    move_out, _ = asyncio.run(
        spend_impact._compute_move_and_horizon("kevin", 500.0, PAY_CFG, headroom=10.0)
    )
    assert move_out == {"usual": 300.0, "projected": 0.0}  # max(0, 300-500)


# ── compute_spend_impact: net-negative / exhausted-headroom gate ───────────

def _base_verdict_ctx(total_excess=-50.0, days_elapsed=20):
    return {
        "period": {"days_elapsed": days_elapsed, "closed": False, "thin_history": False},
        "total_excess": total_excess,
    }


def _patch_common(monkeypatch, *, headroom_sts, net_pos, move_out=None):
    async def fake_sts(uid):
        return headroom_sts

    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_sts)

    async def fake_period_net(uid):
        return net_pos

    monkeypatch.setattr(net_position, "period_net", fake_period_net)

    async def fake_move_and_horizon(uid, delta, pay_cfg, headroom=None):
        return move_out, None

    monkeypatch.setattr(spend_impact, "_compute_move_and_horizon", fake_move_and_horizon)

    async def fake_bills_risk(uid, total_excess, period):
        return None

    monkeypatch.setattr(spend_impact, "_bills_risk", fake_bills_risk)

    async def fake_pay_cfg(uid):
        return PAY_CFG

    monkeypatch.setattr(spend_impact, "_pay_cfg", fake_pay_cfg)


def test_permission_suppressed_when_period_net_negative(monkeypatch):
    _patch_common(
        monkeypatch,
        headroom_sts={"status": "ok", "safe_to_spend": 200.0},
        net_pos={"income": 800.0, "outflow": 900.0, "net": -100.0, "card_growth": 0.0,
                 "period_start": "2026-08-01", "days_elapsed": 20},
        move_out={"usual": 300.0, "projected": 420.0},
    )
    result = asyncio.run(spend_impact.compute_spend_impact("kevin", _base_verdict_ctx()))
    assert result["consequence"] is None
    assert result["move"] is None


def test_permission_suppressed_when_headroom_exhausted(monkeypatch):
    _patch_common(
        monkeypatch,
        headroom_sts={"status": "ok", "safe_to_spend": 0.0},
        net_pos={"income": 800.0, "outflow": 700.0, "net": 100.0, "card_growth": 0.0,
                 "period_start": "2026-08-01", "days_elapsed": 20},
        move_out={"usual": 300.0, "projected": 310.0},
    )
    result = asyncio.run(spend_impact.compute_spend_impact("kevin", _base_verdict_ctx()))
    assert result["consequence"] is None
    assert result["move"] is None


def test_permission_kept_when_net_positive_and_headroom_available(monkeypatch):
    _patch_common(
        monkeypatch,
        headroom_sts={"status": "ok", "safe_to_spend": 200.0},
        net_pos={"income": 800.0, "outflow": 700.0, "net": 100.0, "card_growth": 0.0,
                 "period_start": "2026-08-01", "days_elapsed": 20},
        move_out={"usual": 300.0, "projected": 420.0},
    )
    result = asyncio.run(spend_impact.compute_spend_impact("kevin", _base_verdict_ctx()))
    assert result["consequence"] == "permission"
    assert result["move"] == {"usual": 300.0, "projected": 420.0}


def test_move_delta_direction_not_gated_by_net_negative(monkeypatch):
    # Over-pace direction resolves to "move_delta", not "permission" — the
    # net-negative/headroom gate only ever applies to "permission" (a bill
    # at risk / a shrinking move is not an unfounded promise of spare cash).
    _patch_common(
        monkeypatch,
        headroom_sts={"status": "ok", "safe_to_spend": 0.0},
        net_pos={"income": 800.0, "outflow": 900.0, "net": -100.0, "card_growth": 0.0,
                 "period_start": "2026-08-01", "days_elapsed": 20},
        move_out={"usual": 300.0, "projected": 100.0},
    )
    result = asyncio.run(
        spend_impact.compute_spend_impact("kevin", _base_verdict_ctx(total_excess=50.0))
    )
    assert result["consequence"] == "move_delta"
    assert result["move"] == {"usual": 300.0, "projected": 100.0}
