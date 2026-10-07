"""G228: easing a goal plan's contribution for one pay period.

Mirrors G217's allocation period_overrides: only the live `period_eased` key
shapes a slice, so an easing lapses by itself; lapsed keys stay as history for
the caps. Money is never moved. Same in-memory fakes as the other commitments
suites (no mongomock).
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from bson import ObjectId
from fastapi import HTTPException

import app.db.collections as db_collections
import app.routers.commitments as commitments
import app.services.companion as companion
from app.services import plan_easing
from tests.test_commitments_a86 import FakeCol as _BaseCol, _UpdateResult, _boom, _doc, _match
from tests.test_cover_plan_account_eligibility import FakeCol as CompanionCol, _account, UID as CUID
from tests.test_allocation_shortfall import _plan

UID = "kevin@example.com"
USER = {"email": UID}
OTHER = {"email": "someone-else@example.com"}


class FakeCol(_BaseCol):
    """Adds dotted `$set` / `$unset`, as Mongo applies them."""

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    _put(d, k, v)
                for k in (update.get("$unset") or {}):
                    _del(d, k)
                return _UpdateResult(matched_count=1)
        return _UpdateResult(matched_count=0)


def _put(d, dotted, value):
    parts = dotted.split(".")
    for p in parts[:-1]:
        d = d.setdefault(p, {})
    d[parts[-1]] = value


def _del(d, dotted):
    parts = dotted.split(".")
    for p in parts[:-1]:
        d = d.get(p, {})
    d.pop(parts[-1], None)


def _today(monkeypatch, day):
    monkeypatch.setattr(commitments.timeutil, "user_today", lambda: day)


def _setup(monkeypatch, docs):
    col = FakeCol(docs)
    monkeypatch.setattr(commitments, "commitments_col", col)
    for name in ("accounts_col", "yapily_accounts_col", "manual_accounts_col", "preferences_col", "savings_goals_col"):
        monkeypatch.setattr(commitments, name, FakeCol([]))
    monkeypatch.setattr(commitments, "_cashflow", _boom)
    monkeypatch.setattr(commitments, "get_debt_plan_cached", _boom)

    async def no_invalidate(_):
        pass

    monkeypatch.setattr(commitments.response_cache, "ainvalidate", no_invalidate)
    return col


def _japan(**extra):
    # 2,000 left, 25 pay-period starts from Nov 2026 to Nov 2028: usual slice 80.
    return _doc("Japan", amount=2000.0, target_date="2028-11-01", **extra)


def _ease(doc, pence, mode="keep_date", user=USER):
    return asyncio.run(commitments.ease_commitment(str(doc["_id"]), {"contribution_pence": pence, "mode": mode}, user))


def _preview(doc, pence, user=USER):
    return asyncio.run(commitments.preview_ease(str(doc["_id"]), pence, user))


def _reserved():
    return asyncio.run(commitments.total_reserved_slices(UID))[0]


def _get(doc):
    out = asyncio.run(commitments._serialise_one_with_siblings(UID, doc))
    return out


# ── The slice this period, and lapse ─────────────────────────────────────────

def test_engine_figures_for_the_japan_example(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    base = _get(doc)
    assert (base["usual_slice"], base["per_period_slice"], base["periods_left"]) == (80, 80, 25)
    opts = _preview(doc, 3000)
    # Mid-period the current period is not one of the counted starts, so the
    # engine already has 25 later periods: 1,970 / 25 rounds up to 80.
    assert opts["keep_date"]["later_slice"] == 80 and opts["keep_date"]["refused"] is None
    assert opts["keep_amount"]["date_moves_periods"] == 0 and opts["keep_amount"]["target_date"] == "2028-11-01"


def test_ease_sets_this_periods_slice_and_the_reserve_drops(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    assert _reserved() == 80
    out = _ease(doc, 3000)
    assert out["eased_this_period"] == 30 and out["per_period_slice"] == 30 and out["usual_slice"] == 80
    assert out["eased_mode"] == "keep_date" and out["eased_count_12m"] == 1
    assert _reserved() == 30  # Safe to Spend's commitments_reserved follows at once
    assert "2026-10-31" in doc["period_eased"]
    assert doc["period_eased"]["2026-10-31"]["note"].startswith("Eased to £30")


def test_easing_lapses_when_the_next_period_starts(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    _today(monkeypatch, date(2026, 11, 2))
    out = _get(doc)
    assert out["eased_this_period"] is None and out["per_period_slice"] == out["usual_slice"] == 85
    assert "2026-10-31" in doc["period_eased"]  # kept as history for the caps


def test_clamp_zero_to_usual(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    for bad in (-100, 8000, 9000, 150, True, "30", None):
        with pytest.raises(HTTPException) as exc:
            _ease(doc, bad)
        assert exc.value.status_code == 422
    assert _ease(doc, 0)["per_period_slice"] == 0  # skip the period
    assert _reserved() == 0


# ── keep the date / keep the amount (a period start, so the current period counts) ──

def _at_period_start(monkeypatch):
    _today(monkeypatch, date(2026, 11, 1))
    doc = _doc("Trip", amount=300.0, target_date="2027-01-01")  # starts: Nov 1, Dec 1, Jan 1
    _setup(monkeypatch, [doc])
    return doc


def test_keep_date_recomputes_later_slices_with_ceil5(monkeypatch):
    doc = _at_period_start(monkeypatch)
    assert _get(doc)["usual_slice"] == 100
    opts = _preview(doc, 5000)
    assert opts["keep_date"]["later_slice"] == 125 and opts["keep_date"]["refused"] is None  # 250 / 2
    out = _ease(doc, 5000, "keep_date")
    assert out["later_slice"] == 125 and out["target_date"] == "2027-01-01"


def test_keep_date_refused_when_later_slice_would_exceed_125_percent(monkeypatch):
    doc = _at_period_start(monkeypatch)
    opts = _preview(doc, 4000)  # 260 / 2 = 130 > 125
    assert opts["keep_date"]["refused"] == plan_easing.MSG_RISE
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 4000, "keep_date")
    assert (exc.value.status_code, exc.value.detail) == (422, plan_easing.MSG_RISE)
    assert "period_eased" not in doc


def test_keep_amount_moves_the_date_and_records_the_old_one(monkeypatch):
    doc = _at_period_start(monkeypatch)
    out = _ease(doc, 4000, "keep_amount")
    assert out["target_date"] == "2027-02-01"
    entry = doc["period_eased"]["2026-11-30"]
    assert entry["previous_target_date"] == "2027-01-01" and "2027-01-01" in entry["note"] and "2027-02-01" in entry["note"]
    assert out["usual_slice"] == 100 and out["per_period_slice"] == 40
    assert out["later_slice"] == 90  # 260 / 3 periods to Feb, rounded up
    assert _reserved() == 40


def test_keep_amount_date_cap_is_enforced_by_the_pure_rule():
    # The engine rounds slices up, so a real plan never needs more than one extra
    # period; the cap still holds if the inputs say otherwise.
    opts = plan_easing.ease_options(
        remaining=300, later_periods=2, usual=50, contribution=0, target=date(2027, 1, 1), cfg={"type": "calendar_month"},
    )
    assert opts["keep_amount"]["date_moves_periods"] == 4
    assert opts["keep_amount"]["refused"] == plan_easing.MSG_DATE


def test_no_later_periods_refuses_keep_date(monkeypatch):
    _today(monkeypatch, date(2026, 11, 5))
    doc = _doc("Last", amount=100.0, target_date="2026-11-20")
    _setup(monkeypatch, [doc])
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 0, "keep_date")
    assert exc.value.detail == plan_easing.MSG_NO_LATER
    assert _ease(doc, 0, "keep_amount")["target_date"] == "2026-12-01"


# ── Period-level caps ────────────────────────────────────────────────────────

def test_second_easing_in_the_same_period_is_refused(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 1000)
    assert exc.value.detail == plan_easing.MSG_ALREADY


def test_two_periods_running_refused_then_twelve_month_count(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    _today(monkeypatch, date(2026, 11, 9))
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 3000)
    assert exc.value.detail == plan_easing.MSG_CONSECUTIVE
    _today(monkeypatch, date(2026, 12, 9))
    _ease(doc, 3000)  # skipped a period, allowed
    _today(monkeypatch, date(2027, 2, 9))
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 3000)
    assert exc.value.detail == plan_easing.MSG_COUNT
    assert _get(doc)["ease_blocked_reason"] == plan_easing.MSG_COUNT
    # Rolling: once October 2026 is more than twelve months back, one slot frees up.
    _today(monkeypatch, date(2027, 11, 9))
    assert _ease(doc, 3000)["eased_this_period"] == 30


def test_editing_the_plan_clears_the_live_easing_but_history_still_counts(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    # An unrelated edit and a no-op amount leave it alone.
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"name": "Japan trip", "amount": 2000}, USER))
    assert _get(doc)["eased_this_period"] == 30
    out = asyncio.run(commitments.update_commitment(str(doc["_id"]), {"amount": 2400}, USER))
    assert out["eased_this_period"] is None and out["per_period_slice"] == out["usual_slice"] == 100
    assert doc["period_eased"]["2026-10-31"]["cleared"] is True
    assert out["eased_count_12m"] == 1
    out = asyncio.run(commitments.update_commitment(str(doc["_id"]), {"target_date": "2028-12-01"}, USER))
    assert out["eased_this_period"] is None
    assert _reserved() == out["per_period_slice"]


def test_editing_the_date_also_clears(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    out = asyncio.run(commitments.update_commitment(str(doc["_id"]), {"target_date": "2029-01-01"}, USER))
    assert out["eased_this_period"] is None


def test_another_users_plan_is_404_and_inactive_plans_are_refused(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    cancelled = _doc("Old", status="cancelled")
    _setup(monkeypatch, [doc, cancelled])
    for call in (lambda: _ease(doc, 3000, user=OTHER), lambda: _preview(doc, 3000, user=OTHER)):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        _ease(cancelled, 0)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 3000, "later")
    assert exc.value.detail == plan_easing.MSG_MODE


def test_only_the_live_key_is_written_and_old_history_is_pruned(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    old = "2025-01-31"
    kept = "2026-04-30"
    doc = _japan(period_eased={old: {"contribution_pence": 0}, kept: {"contribution_pence": 0}})
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    assert sorted(doc["period_eased"]) == [kept, "2026-10-31"]


# ── Home brief ───────────────────────────────────────────────────────────────

def _run_brief(monkeypatch, plans, accounts, commitment_docs, bills=None):
    import app.services.pay_period as pay_period
    import app.services.income as income
    import app.services.pace as pace_module

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda today_d, pay_cfg: (today_d - timedelta(days=10), today_d + timedelta(days=17)),
    )

    async def _no_reserve(uid, internal_inflows, account_map):
        return {}

    async def _plans(uid, **kw):
        return list(plans)

    monkeypatch.setattr(companion, "_reserved_for_allocations", _no_reserve)
    monkeypatch.setattr(companion, "_load_account_plans", _plans)
    for name in ("yapily_accounts_col", "manual_accounts_col", "companion_items_col", "behaviour_portrait_col", "transactions_col"):
        monkeypatch.setattr(companion, name, CompanionCol([]))
    monkeypatch.setattr(companion, "accounts_col", CompanionCol(accounts))
    monkeypatch.setattr(db_collections, "savings_insights_col", CompanionCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", CompanionCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", CompanionCol([{"_id": CUID}]))
    monkeypatch.setattr(companion, "preferences_col", CompanionCol([{"user_id": CUID, "income_streams": []}]))
    monkeypatch.setattr(pace_module, "cashflow_cache_col", CompanionCol([{"_id": CUID}]))
    monkeypatch.setattr(pace_module, "preferences_col", CompanionCol([{"user_id": CUID}]))
    monkeypatch.setattr(pace_module, "transactions_col", CompanionCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", CompanionCol([]))
    col = FakeCol(commitment_docs)
    monkeypatch.setattr(db_collections, "commitments_col", col)
    monkeypatch.setattr(commitments, "commitments_col", col)
    for name in ("accounts_col", "yapily_accounts_col", "manual_accounts_col", "preferences_col"):
        monkeypatch.setattr(commitments, name, FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills or [], "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    return asyncio.run(companion.compute_today_items(CUID, persist=False))


def _goal(slice_pounds=80.0, **extra):
    return _doc("Japan", amount=2000.0, target_date=(date.today() + timedelta(days=800)).isoformat(),
                user_id=CUID, **extra)


def _gplan(doc, source="cur", remaining=80.0, dest="potG"):
    return _plan(str(doc["_id"]), "Japan", source, remaining, kind="goal", period=remaining, dest=(dest,))


def _card(items):
    return next((i for i in items if i["type"] == "plan_easing"), None)


def test_short_account_with_no_safe_source_offers_the_easing_card(monkeypatch):
    doc = _goal()
    items = _run_brief(monkeypatch, [_gplan(doc)], [_account("cur", 50.0, name="Premier Current")], [doc])
    card = _card(items)
    assert card is not None and card["action"] is None
    p = card["plan_easing"]
    assert p["state"] == "eligible" and p["plan"] == {"id": str(doc["_id"]), "name": "Japan"}
    assert p["gap"] == 30.0 and p["usual_slice"] == p["max_easing"] and p["cap_reason"] is None
    assert p["periods_left"] >= 1 and p["target_date"] == doc["target_date"]
    assert card["id"].startswith(f"plan_easing:{doc['_id']}:")
    assert card["headline"] == "Cash looks short this period"


def test_gap_under_five_pounds_gives_no_card(monkeypatch):
    doc = _goal()
    items = _run_brief(monkeypatch, [_gplan(doc)], [_account("cur", 77.0)], [doc])
    assert _card(items) is None


def test_a_viable_source_means_no_easing_card(monkeypatch):
    doc = _goal()
    accounts = [_account("cur", 50.0), _account("sav", 1000.0, name="Savings", subtype="SAVINGS")]
    items = _run_brief(monkeypatch, [_gplan(doc)], accounts, [doc])
    assert _card(items) is None


def test_a_goal_only_account_never_raises_a_set_aside_card(monkeypatch):
    doc = _goal()
    items = _run_brief(monkeypatch, [_gplan(doc)], [_account("cur", 50.0)], [doc])
    assert all(i["type"] != "allocation_shortfall" for i in items) and _card(items)


def test_ranks_after_the_set_aside_card(monkeypatch):
    doc = _goal()
    plans = [_plan("a1", "Holiday", "cur", 20.0, dest=("potA",)), _gplan(doc, dest="potG")]
    items = _run_brief(monkeypatch, plans, [_account("cur", 50.0)], [doc])
    kinds = [i["type"] for i in items]
    assert kinds.index("allocation_shortfall") < kinds.index("plan_easing")


def test_capped_plan_shows_the_reason(monkeypatch):
    today = date.today()
    start, end = commitments.get_pay_period_for_date(today, {"type": "calendar_month"})
    prev = (start - timedelta(days=1)).isoformat()
    doc = _goal(period_eased={prev: {"contribution_pence": 0, "usual_pence": 8000}})
    items = _run_brief(monkeypatch, [_gplan(doc)], [_account("cur", 50.0)], [doc])
    p = _card(items)["plan_easing"]
    assert p["state"] == "capped" and p["cap_reason"] == plan_easing.MSG_CONSECUTIVE


def test_largest_slice_first_and_only_one_card(monkeypatch):
    big = _goal()
    small = _doc("Car", amount=500.0, target_date=(date.today() + timedelta(days=800)).isoformat(), user_id=CUID)
    plans = [_gplan(big, remaining=80.0, dest="p1"), _plan(str(small["_id"]), "Car", "cur", 20.0, kind="goal", dest=("p2",))]
    items = _run_brief(monkeypatch, plans, [_account("cur", 40.0)], [big, small])
    assert len([i for i in items if i["type"] == "plan_easing"]) == 1
    assert _card(items)["plan_easing"]["plan"]["name"] == "Japan"


def test_eased_plan_shows_the_deferred_line(monkeypatch):
    today = date.today()
    _s, end = commitments.get_pay_period_for_date(today, {"type": "calendar_month"})
    doc = _goal(period_eased={end.isoformat(): {"contribution_pence": 3000, "usual_pence": 8000, "mode": "keep_date"}})
    items = _run_brief(monkeypatch, [_gplan(doc, remaining=30.0)], [_account("cur", 500.0)], [doc])
    p = _card(items)["plan_easing"]
    assert p["state"] == "deferred" and p["eased_this_period"] == 30 and p["usual_slice"] >= 30


def test_editing_the_plan_never_buys_a_second_ease_in_the_same_period(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    _ease(doc, 3000)
    asyncio.run(commitments.update_commitment(str(doc["_id"]), {"amount": 2400}, USER))
    assert doc["period_eased"]["2026-10-31"]["cleared"] is True
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 3000)
    assert (exc.value.status_code, exc.value.detail) == (422, plan_easing.MSG_ALREADY)
    assert _preview(doc, 3000)["blocked_reason"] == plan_easing.MSG_ALREADY
    assert _get(doc)["ease_blocked_reason"] == plan_easing.MSG_ALREADY


def test_cleared_entries_count_toward_the_twelve_month_cap(monkeypatch):
    _today(monkeypatch, date(2026, 12, 9))
    doc = _japan(period_eased={
        "2026-09-30": {"contribution_pence": 0, "usual_pence": 8000, "cleared": True},
        "2026-10-31": {"contribution_pence": 0, "usual_pence": 8000, "cleared": True},
    })
    _setup(monkeypatch, [doc])
    with pytest.raises(HTTPException) as exc:
        _ease(doc, 3000)
    assert exc.value.detail == plan_easing.MSG_COUNT


def test_preview_reports_remaining_after(monkeypatch):
    _today(monkeypatch, date(2026, 10, 7))
    doc = _japan()
    _setup(monkeypatch, [doc])
    assert _preview(doc, 3000)["remaining_after"] == 1970.0
