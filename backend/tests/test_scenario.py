"""Unit tests for the PURE (no-DB) seams in app.services.scenario:
`normalise_items`, `build_delta_series`, `steady_monthly_delta`, plus
`_build_plans_block`'s POPULATED path (below).

`simulate()` itself is I/O-heavy (cashflow cache, debt plan, commitments) and
is exercised by the routing layer's own tests (test_scenario_routing.py) plus
manual verification against a live UID; this file covers the deterministic
maths that must never drift regardless of what's in the database. The
`reasons`/`lumpy` structural-contract section near the bottom is the one
exception: every I/O boundary `simulate()` touches (`get_user_region`,
`monthly_cashflow_cached`, `_build_debt_block`, `_build_plans_block`,
`_build_grow_block`, `_build_absorb_block`) is a plain name resolved from
`app.services.scenario`'s own module namespace at call time, so monkeypatching
the attribute on that module object drives `simulate()` end to end (real
cash/lumpy maths, fake everything else) without ever touching Mongo.

`_build_plans_block` is the one exception worth driving directly here: it
imports `list_commitments`/`_feasibility_ctx` lazily from
app.routers.commitments (see that module's own lazy-import convention noted
in scenario.py's header), which makes them a clean data-access boundary to
monkeypatch — the tests below replace `list_commitments` with a synthetic
"already serialised" response and `_feasibility_ctx` with a fixed
(surplus, available_savings) pair, never touching Mongo, while still running
the REAL `_apply_joint_feasibility`/`_classify_feasibility` production logic
against that fixture. This is the only way to exercise the plans block's
populated path at all: the real user account this suite runs against
currently has no active commitments, so that path has only ever run its
`None` branch in practice.
"""
import asyncio
from datetime import date

import pytest

import app.routers.commitments as commitments_router
import app.services.scenario as scenario_mod
from app.routers.scenario import _is_lumpy_scenario
from app.services.scenario import (
    HORIZON_MONTHS,
    _build_plans_block,
    build_delta_series,
    normalise_items,
    steady_monthly_delta,
)


def make_item(**overrides) -> dict:
    """A valid raw scenario item, overridable per test."""
    item = {
        "label": "Test item",
        "amount": 100.0,
        "direction": "out",
        "cadence": "monthly",
        "starts": "2026-09-01",
        "ends": None,
        "kind": "new_outgoing",
        "category": None,
    }
    item.update(overrides)
    return item


TODAY = date(2026, 8, 21)


# ── normalise_items ───────────────────────────────────────────────────────

def test_valid_item_passes_through():
    items, rejected = normalise_items([make_item()])
    assert rejected == []
    assert len(items) == 1
    assert items[0]["amount"] == 100.0
    assert items[0]["label"] == "Test item"
    assert items[0]["starts"] == "2026-09-01"


def test_amount_out_of_range_rejected():
    items, rejected = normalise_items([make_item(amount=100_001)])
    assert items == []
    assert len(rejected) == 1

    items2, rejected2 = normalise_items([make_item(amount=0)])
    assert items2 == []
    assert len(rejected2) == 1


def test_unparsable_amount_rejected():
    items, rejected = normalise_items([make_item(amount="not-a-number")])
    assert items == []
    assert len(rejected) == 1


def test_bad_direction_rejected():
    items, rejected = normalise_items([make_item(direction="sideways")])
    assert items == []
    assert len(rejected) == 1


def test_bad_cadence_rejected():
    items, rejected = normalise_items([make_item(cadence="fortnightly")])
    assert items == []
    assert len(rejected) == 1


def test_bad_kind_rejected():
    items, rejected = normalise_items([make_item(kind="something_else")])
    assert items == []
    assert len(rejected) == 1


def test_missing_starts_rejected():
    items, rejected = normalise_items([make_item(starts=None)])
    assert items == []
    assert len(rejected) == 1


def test_past_start_one_month_ago_is_clamped_not_rejected(monkeypatch):
    # A start exactly one calendar month behind "today" is clamped forward
    # to the current month rather than rejected -- normalise_items derives
    # "today" internally via date.today(), so this test just needs a start
    # that is unambiguously one calendar month before whatever "today" is
    # by construction: use a date far enough in the past relative to any
    # plausible test-run date is wrong (would get rejected as >1 month
    # back), so we patch date.today() used inside the module instead.
    import app.services.scenario as scenario_mod

    class _FixedDate(date):
        @classmethod
        def today(cls):
            return TODAY

    monkeypatch.setattr(scenario_mod, "date", _FixedDate)
    items, rejected = normalise_items([make_item(starts="2026-07-15")])
    assert rejected == []
    assert len(items) == 1
    # Clamped to the first of the CURRENT month (August 2026), not rejected
    # and not left at its original July day.
    assert items[0]["starts"] == "2026-08-01"


def test_start_two_months_ago_is_rejected(monkeypatch):
    import app.services.scenario as scenario_mod

    class _FixedDate(date):
        @classmethod
        def today(cls):
            return TODAY

    monkeypatch.setattr(scenario_mod, "date", _FixedDate)
    items, rejected = normalise_items([make_item(starts="2026-06-01")])
    assert items == []
    assert len(rejected) == 1


def test_start_beyond_horizon_is_rejected(monkeypatch):
    import app.services.scenario as scenario_mod

    class _FixedDate(date):
        @classmethod
        def today(cls):
            return TODAY

    monkeypatch.setattr(scenario_mod, "date", _FixedDate)
    # 30 months ahead of August 2026 is well past the 24-month horizon.
    items, rejected = normalise_items([make_item(starts="2029-02-01")])
    assert items == []
    assert len(rejected) == 1


def test_ends_before_starts_is_dropped_to_none():
    items, rejected = normalise_items([make_item(starts="2026-09-01", ends="2026-08-01")])
    assert rejected == []
    assert items[0]["ends"] is None


def test_ends_after_starts_is_kept():
    items, rejected = normalise_items([make_item(starts="2026-09-01", ends="2027-01-01")])
    assert rejected == []
    assert items[0]["ends"] == "2027-01-01"


def test_label_truncated_and_default_falls_back():
    long_label = "x" * 100
    items, _ = normalise_items([make_item(label=long_label)])
    assert len(items[0]["label"]) == 40

    items2, _ = normalise_items([make_item(label="", kind="removal")])
    assert items2[0]["label"] == "Cancellation"

    items3, _ = normalise_items([make_item(label="   ", kind="income_change")])
    assert items3[0]["label"] == "Income change"

    items4, _ = normalise_items([make_item(label=None, kind="new_outgoing")])
    assert items4[0]["label"] == "New cost"


def test_category_only_kept_for_removal():
    items, _ = normalise_items([make_item(kind="removal", category="Subscriptions")])
    assert items[0]["category"] == "Subscriptions"

    items2, _ = normalise_items([make_item(kind="new_outgoing", category="Subscriptions")])
    assert items2[0]["category"] is None


def test_cap_at_three_items_drops_extras_with_reason():
    raw = [make_item(label=f"Item {i}", starts="2026-09-01") for i in range(5)]
    items, rejected = normalise_items(raw)
    assert len(items) == 3
    assert len(rejected) == 2
    assert all("Item 3" in r or "Item 4" in r for r in rejected)


def test_non_dict_item_skipped_with_reason():
    items, rejected = normalise_items(["not-a-dict", make_item()])
    assert len(items) == 1
    assert len(rejected) == 1


def test_normalise_items_never_raises_on_garbage():
    # Deliberately pathological input.
    items, rejected = normalise_items(None)
    assert items == []
    assert isinstance(rejected, list)

    items2, rejected2 = normalise_items([{"amount": object()}])
    assert items2 == []
    assert len(rejected2) == 1


# ── build_delta_series ───────────────────────────────────────────────────

def test_monthly_from_future_start_fills_every_month_from_start():
    item = make_item(amount=100.0, direction="out", cadence="monthly", starts="2026-11-01")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    # today = 2026-08-21 -> November is index 3.
    assert series[0] == 0.0
    assert series[1] == 0.0
    assert series[2] == 0.0
    assert series[3] == -100.0
    assert series[-1] == -100.0  # open-ended, still active at the horizon's edge


def test_monthly_respects_end_boundary_exclusive():
    item = make_item(amount=100.0, direction="out", cadence="monthly", starts="2026-09-01", ends="2026-12-01")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    # start index 1 (Sep), end index 4 (Dec) EXCLUSIVE -> active Sep/Oct/Nov (idx 1,2,3), not Dec (idx 4).
    assert series[1] == -100.0
    assert series[2] == -100.0
    assert series[3] == -100.0
    assert series[4] == 0.0


def test_weekly_converts_to_monthly_equivalent():
    item = make_item(amount=50.0, direction="out", cadence="weekly", starts="2026-08-01")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    expected = -50.0 * 52.0 / 12.0
    assert series[0] == expected


def test_annual_lands_only_on_anniversary_months():
    item = make_item(amount=600.0, direction="out", cadence="annual", starts="2026-09-01")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    # index 1 = Sep 2026, index 13 = Sep 2027 (12 months later); everything else 0.
    assert series[1] == -600.0
    assert series[13] == -600.0
    non_anniversary = [v for i, v in enumerate(series) if i not in (1, 13)]
    assert all(v == 0.0 for v in non_anniversary)


def test_one_off_hits_a_single_month_only():
    item = make_item(amount=250.0, direction="out", cadence="one_off", starts="2026-10-01")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    assert series[2] == -250.0  # October 2026 is index 2
    assert sum(1 for v in series if v != 0.0) == 1


def test_direction_in_is_positive():
    item = make_item(amount=80.0, direction="in", cadence="monthly", starts="2026-08-01", kind="removal")
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    assert series[0] == 80.0


def test_two_stacked_items_sum():
    a = make_item(amount=100.0, direction="out", cadence="monthly", starts="2026-08-01")
    b = make_item(amount=30.0, direction="in", cadence="monthly", starts="2026-08-01", kind="removal")
    series = build_delta_series([a, b], TODAY, HORIZON_MONTHS)
    assert series[0] == -70.0


# ── steady_monthly_delta ──────────────────────────────────────────────────

def test_recurring_monthly_case_is_the_steady_value():
    item = make_item(amount=120.0, direction="out", cadence="monthly", starts="2026-08-01")
    assert steady_monthly_delta([item], TODAY, HORIZON_MONTHS) == -120.0


def test_one_off_case_is_zero():
    item = make_item(amount=5000.0, direction="out", cadence="one_off", starts="2026-08-01")
    assert steady_monthly_delta([item], TODAY, HORIZON_MONTHS) == 0.0


def test_annual_case_is_amount_over_twelve_not_zero():
    # This is the corrected behaviour: an annual cost is NOT washed out to
    # ~0 the way a median-of-series approach would. It reports its honest
    # steady-state monthly-equivalent, -1200/12 = -100, so a real recurring
    # yearly cost still visibly eats into a debt/plan/absorb projection.
    item = make_item(amount=1200.0, direction="out", cadence="annual", starts="2026-09-01")
    assert steady_monthly_delta([item], TODAY, HORIZON_MONTHS) == -100.0

    # The underlying per-month series is untouched by this fix: it still
    # lands the FULL amount only on anniversary months, never smoothed.
    series = build_delta_series([item], TODAY, HORIZON_MONTHS)
    assert series[1] == -1200.0
    assert series[13] == -1200.0
    assert all(v == 0.0 for i, v in enumerate(series) if i not in (1, 13))


def test_mixed_recurring_plus_one_off():
    recurring = make_item(amount=100.0, direction="out", cadence="monthly", starts="2026-08-01")
    one_off = make_item(amount=2000.0, direction="out", cadence="one_off", starts="2026-09-01")
    # The one-off contributes 0 to the steady figure (it's a one-time dent
    # the cash block's per-month series shows separately), so the mixed
    # total reads the recurring item's own steady -100/month.
    assert steady_monthly_delta([recurring, one_off], TODAY, HORIZON_MONTHS) == -100.0


def test_weekly_and_annual_combine_on_their_own_monthly_equivalents():
    weekly = make_item(amount=20.0, direction="out", cadence="weekly", starts="2026-08-01")
    annual = make_item(amount=600.0, direction="in", cadence="annual", starts="2026-08-01", kind="removal")
    expected = -(20.0 * 52.0 / 12.0) + (600.0 / 12.0)
    assert steady_monthly_delta([weekly, annual], TODAY, HORIZON_MONTHS) == round(expected, 2)


def test_item_starting_after_horizon_end_contributes_nothing():
    # Defensive: an item whose active window never overlaps the horizon
    # (shouldn't happen after normalise_items clamps starts, but the pure
    # function must still degrade safely) contributes 0.
    item = make_item(amount=100.0, direction="out", cadence="monthly", starts="2026-08-01", ends="2026-08-15")
    # ends resolves to the same month as starts -> end_i == start_i -> no
    # presence in the horizon (monthly is exclusive of the end month).
    assert steady_monthly_delta([item], TODAY, HORIZON_MONTHS) == 0.0


# ── _build_plans_block (populated path) ───────────────────────────────────
# The data-access boundary is `list_commitments` (returns the "now" items,
# already serialised with a real `feasibility`) and `_feasibility_ctx`
# (returns the "now" (monthly_surplus, available_savings) pair) — both
# imported lazily inside `_build_plans_block` from app.routers.commitments,
# so patching the attributes on that module object is picked up by the
# import statement at call time. Everything else `_build_plans_block` uses
# (`_apply_joint_feasibility`, `_classify_feasibility`) is the REAL,
# unmocked production code, so these tests exercise the actual feasibility
# maths, not a re-description of it.

def _goal(name, per_period_slice, remaining, target_date="2027-01-01", status="active"):
    return {
        "name":              name,
        "status":            status,
        "target_date":       target_date,
        "per_period_slice":  per_period_slice,
        "remaining":         remaining,
    }


def _run_plans_block(monkeypatch, goals, fctx_now, baseline_surplus, recurring_delta):
    """Drive `_build_plans_block` against synthetic commitments.

    `goals`' "now" feasibility is derived by running the REAL
    `_apply_joint_feasibility` against `fctx_now` before the fake
    `list_commitments` response is built — exactly what `list_commitments`
    itself would have produced — so the fixture is internally consistent
    rather than an arbitrary hand-picked label. The lazily-imported
    `_apply_joint_feasibility` inside `_build_plans_block` itself then reruns
    the same real function against `adjusted_fctx` to build the "after" side.
    """
    items = [dict(g) for g in goals]
    docs = [{"status": g.get("status", "active")} for g in goals]
    commitments_router._apply_joint_feasibility(items, docs, fctx_now)

    async def fake_list_commitments(user=None):
        return {"items": items}

    async def fake_feasibility_ctx(uid):
        return fctx_now

    monkeypatch.setattr(commitments_router, "list_commitments", fake_list_commitments)
    monkeypatch.setattr(commitments_router, "_feasibility_ctx", fake_feasibility_ctx)

    plans, note = asyncio.run(_build_plans_block("test-uid", baseline_surplus, recurring_delta))
    return plans, note, items


def test_plans_block_none_active_returns_null_with_reason(monkeypatch):
    # Sanity check on the fixture harness itself: no goals at all still
    # degrades the same way the real `None` path (the only path this block
    # has ever run in production) always has.
    result, note, _ = _run_plans_block(monkeypatch, [], fctx_now=(500.0, 5000.0), baseline_surplus=500.0, recurring_delta=-50.0)
    assert result is None
    assert note == "No active plans to check against this scenario."


def test_goal_stays_feasible_under_a_modest_new_cost(monkeypatch):
    # £100/period slice against £500 spare stays comfortably "surplus" even
    # after a modest -£50/month new cost drops spare to £450.
    goal = _goal("Holiday", per_period_slice=100.0, remaining=500.0)
    result, _, items_now = _run_plans_block(
        monkeypatch, [goal], fctx_now=(500.0, 5000.0),
        baseline_surplus=500.0, recurring_delta=-50.0,
    )
    assert items_now[0]["feasibility"] == "surplus"  # sanity: fixture itself is "surplus" now

    assert result is not None
    item = result["items"][0]
    assert item["feasibility_now"] == "surplus"
    assert item["feasibility_after"] == "surplus"
    assert item["slipped"] is False
    assert result["any_worse"] is False


def test_goal_pushed_from_feasible_to_stretch(monkeypatch):
    # £450/period slice fits £500 spare now ("surplus"). A -£100/month new
    # cost drops spare to £400 (slice no longer fits the spare rate) AND the
    # £5,000 remaining vastly exceeds the £1,000 available in savings, so it
    # lands in "stretch" -- the exact case this feature exists to warn about.
    goal = _goal("New car", per_period_slice=450.0, remaining=5000.0)
    result, _, items_now = _run_plans_block(
        monkeypatch, [goal], fctx_now=(500.0, 1000.0),
        baseline_surplus=500.0, recurring_delta=-100.0,
    )
    assert items_now[0]["feasibility"] == "surplus"

    item = result["items"][0]
    assert item["feasibility_now"] == "surplus"
    assert item["feasibility_after"] == "stretch"
    assert item["slipped"] is True
    assert result["any_worse"] is True


def test_positive_scenario_improves_feasibility_not_flagged_worse(monkeypatch):
    # A cancellation / pay rise (direction "in") is a POSITIVE recurring_delta
    # -- this is the direction most likely to have a sign error, since every
    # other exercised path in this suite so far has been a tightening ("out").
    # Starts "stretch" (£300/period slice against £200 spare, £3,000
    # remaining against only £1,000 available), a +£150/month relief lifts
    # spare to £350 -- enough for the slice on its own -- so it should read
    # as an IMPROVEMENT, never reported as `slipped` or `any_worse`.
    goal = _goal("Wedding", per_period_slice=300.0, remaining=3000.0)
    result, _, items_now = _run_plans_block(
        monkeypatch, [goal], fctx_now=(200.0, 1000.0),
        baseline_surplus=200.0, recurring_delta=150.0,
    )
    assert items_now[0]["feasibility"] == "stretch"

    item = result["items"][0]
    assert item["feasibility_now"] == "stretch"
    assert item["feasibility_after"] == "surplus"
    assert item["slipped"] is False
    assert result["any_worse"] is False


def test_multiple_goals_judged_against_remaining_capacity_after_others_claim(monkeypatch):
    # Two goals share £1,000/month spare and £5,000 available savings.
    # Individually, EITHER goal's own slice (£600 or £500) fits comfortably
    # inside the full £1,000 spare on its own -- a naive per-goal check
    # (others_slice=0) would call both "surplus". Jointly, each goal only
    # sees what's left after the OTHER goal's own claim:
    #   Goal A: spare = 1000 - 500 (B's slice) = 500; 600 > 500 -> not
    #           "surplus"; remaining 3000 <= available (5000 - 1000 (B's
    #           remaining)) = 4000 -> "savings".
    #   Goal B: spare = 1000 - 600 (A's slice) = 400; 500 > 400 -> not
    #           "surplus"; remaining 1000 <= available (5000 - 3000) = 2000
    #           -> "savings".
    # This proves others_slice/others_remaining are actually threaded through
    # `_build_plans_block`, not just assumed correct.
    fctx_now = (1000.0, 5000.0)
    goal_a = _goal("A: New car", per_period_slice=600.0, remaining=3000.0)
    goal_b = _goal("B: Holiday", per_period_slice=500.0, remaining=1000.0)

    # Confirm the naive (no joint accounting) verdict really would differ,
    # so the assertions below are meaningfully distinguishing joint from
    # naive rather than restating the same answer either way would give.
    naive_a, _, _ = commitments_router._classify_feasibility(600.0, 3000.0, fctx_now)
    naive_b, _, _ = commitments_router._classify_feasibility(500.0, 1000.0, fctx_now)
    assert naive_a == "surplus"
    assert naive_b == "surplus"

    result, _, items_now = _run_plans_block(
        monkeypatch, [goal_a, goal_b], fctx_now=fctx_now,
        baseline_surplus=1000.0, recurring_delta=0.0,
    )
    assert items_now[0]["feasibility"] == "savings"
    assert items_now[1]["feasibility"] == "savings"

    by_name = {item["name"]: item for item in result["items"]}
    assert by_name["A: New car"]["feasibility_now"] == "savings"
    assert by_name["A: New car"]["feasibility_after"] == "savings"
    assert by_name["B: Holiday"]["feasibility_now"] == "savings"
    assert by_name["B: Holiday"]["feasibility_after"] == "savings"
    assert result["any_worse"] is False


def test_plans_block_user_facing_strings_meet_house_style(monkeypatch):
    # Every plain-English string this block (or the production
    # `_classify_feasibility` feeding it) can surface: the two static
    # `_build_plans_block` notes, plus a feasibility_note for each of
    # funded/surplus/savings(with a gap)/stretch, including the debt-aware
    # variants (debt_shortfall > 0). No em-dash, no en-dash, no spelled-out
    # "pounds", and any negative currency uses the Unicode minus (−)
    # rather than an ASCII hyphen.
    _, none_active_note, _ = _run_plans_block(
        monkeypatch, [], fctx_now=(500.0, 5000.0), baseline_surplus=500.0, recurring_delta=0.0,
    )
    strings = [none_active_note]

    fctx = (500.0, 1000.0)
    # funded
    _, funded_note, _ = commitments_router._classify_feasibility(100.0, 0.0, fctx)
    # surplus
    _, surplus_note, _ = commitments_router._classify_feasibility(100.0, 500.0, fctx)
    # savings, no debt shortfall (exercises the "~£{gap} {qualifier}" phrasing)
    _, savings_note, _ = commitments_router._classify_feasibility(
        600.0, 500.0, fctx, period_label="every 2 weeks",
    )
    # savings, WITH a debt shortfall (debt-aware phrasing swap)
    _, savings_debt_note, _ = commitments_router._classify_feasibility(
        600.0, 500.0, fctx, debt_shortfall=120.0,
    )
    # stretch, no debt shortfall
    _, stretch_note, _ = commitments_router._classify_feasibility(600.0, 5000.0, fctx)
    # stretch, with debt shortfall
    _, stretch_debt_note, _ = commitments_router._classify_feasibility(
        600.0, 5000.0, fctx, debt_shortfall=120.0,
    )
    strings += [funded_note, surplus_note, savings_note, savings_debt_note, stretch_note, stretch_debt_note]

    assert all(s for s in strings)  # sanity: every branch actually produced a note
    for s in strings:
        assert "—" not in s, f"em-dash in: {s!r}"
        assert "–" not in s, f"en-dash in: {s!r}"
        assert "pounds" not in s.lower(), f"spelled-out 'pounds' in: {s!r}"
        # Any ASCII '-' immediately preceding a digit inside a currency
        # figure would be a plain hyphen standing in for a minus sign -- the
        # house rule is the Unicode minus (see feedback_no_em_dashes: "KEEP
        # the -£ currency minus" means the U+2212 character, not '-').
        assert not any(c == "-" and s[i + 1:i + 2] == "£" for i, c in enumerate(s)), (
            f"ASCII hyphen used as a currency minus in: {s!r}"
        )


# ── simulate(): reasons / lumpy structural contract ───────────────────────
# The anti-pattern being fixed: simulate() used to fold every block's
# None-reason into one flat `assumptions: list[str]`, forcing callers to
# reverse-engineer which reason belongs to which block by string-prefix
# matching prose that could silently drift on a copy edit (see
# app/routers/scenario.py's old `_is_lumpy_scenario`, the sibling instance
# of the same anti-pattern, exercised further below). `reasons` and `lumpy`
# are the structured replacement; these tests pin the exact contract:
#   - a None block always has a non-empty `reasons[<block>]`
#   - a populated block always has `reasons[<block>] is None`
#   - `assumptions` never duplicates a string that also appears in `reasons`
#   - `lumpy` is a real boolean callers can read directly, no prose parsing

TODAY_FIXED = date(2026, 8, 21)


class _FixedDate(date):
    """Same technique already used above (see
    test_past_start_one_month_ago_is_clamped_not_rejected) — pins
    `date.today()` inside app.services.scenario so these tests never depend
    on the wall-clock date the suite happens to run on."""

    @classmethod
    def today(cls):
        return TODAY_FIXED


def _default_debt_block():
    return {
        "debt_free_month_now": "Jan 2028", "debt_free_month_after": "Feb 2028",
        "months_later": 1, "extra_interest": 10.0,
        "movement_exhausted": False, "clears_after": True,
    }


def _default_plans_block():
    return {"items": [], "any_worse": False}


def _default_grow_block():
    return {"months_cover_now": 3.0, "months_cover_after": 3.0, "current_savings": 1000.0}


def _default_absorb_block():
    return {"shortfall": 0.0, "covered_by_surplus": 0.0, "candidates": []}


def _patch_simulate_io(
    monkeypatch,
    *,
    n_months=6,
    debt_result=None,
    plans_result=None,
    grow_result=None,
    absorb_result=None,
):
    """Patch every I/O boundary `simulate()` touches (see module docstring),
    plus pin `date.today()`, so `simulate()` can be driven end to end
    (real cash-block/lumpy maths, controllable everything else) without
    ever touching Mongo. Each `*_result` is the (block, note) tuple its
    real builder returns; defaults to a populated block with no note."""
    debt_result = debt_result if debt_result is not None else (_default_debt_block(), None)
    plans_result = plans_result if plans_result is not None else (_default_plans_block(), None)
    grow_result = grow_result if grow_result is not None else (_default_grow_block(), None)
    absorb_result = absorb_result if absorb_result is not None else (_default_absorb_block(), None)

    async def fake_region(uid):
        return "GB"

    async def fake_cf(uid, region, cutoff):
        return {"income": 3000.0, "spending": 2000.0, "debt": 200.0, "n_months": n_months, "cat": {}}

    async def fake_debt_block(uid, recurring_delta, today):
        return debt_result

    async def fake_plans_block(uid, baseline_surplus, recurring_delta):
        return plans_result

    async def fake_grow_block(uid, items, monthly_spending, today, horizon):
        return grow_result

    async def fake_absorb_block(uid, recurring_delta, baseline_surplus, cat_medians):
        return absorb_result

    monkeypatch.setattr(scenario_mod, "date", _FixedDate)
    monkeypatch.setattr(scenario_mod, "get_user_region", fake_region)
    monkeypatch.setattr(scenario_mod, "monthly_cashflow_cached", fake_cf)
    monkeypatch.setattr(scenario_mod, "_build_debt_block", fake_debt_block)
    monkeypatch.setattr(scenario_mod, "_build_plans_block", fake_plans_block)
    monkeypatch.setattr(scenario_mod, "_build_grow_block", fake_grow_block)
    monkeypatch.setattr(scenario_mod, "_build_absorb_block", fake_absorb_block)


def test_simulate_populated_blocks_all_get_a_null_reason(monkeypatch):
    _patch_simulate_io(monkeypatch, n_months=6)
    item = make_item(direction="out", cadence="monthly", amount=100.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))

    for key in ("cash", "debt", "plans", "grow", "absorb"):
        assert payload[key] is not None, f"{key} unexpectedly null"
        assert payload["reasons"][key] is None, f"populated {key} should have a null reason"

    # No lumpy note, no per-block caveats fired -- assumptions carries only
    # the one genuinely global line.
    assert payload["assumptions"] == ["Assumes your payday and rhythm stay as they are."]
    assert payload["lumpy"] is False


def test_simulate_every_null_block_gets_its_own_non_empty_reason(monkeypatch):
    # thin_history (n_months=1) forces cash AND absorb null via the shared
    # thin-history path; debt/plans/grow are forced null via their own
    # builder's (None, note) return so every one of the 5 blocks is null
    # through a DIFFERENT code path in simulate(), not just the same one.
    _patch_simulate_io(
        monkeypatch,
        n_months=1,
        debt_result=(None, "No cards have both a balance and demonstrated monthly movement to project against."),
        plans_result=(None, "No active plans to check against this scenario."),
        grow_result=(None, "Not enough spending history yet to estimate emergency-fund cover."),
    )
    item = make_item(direction="out", cadence="monthly", amount=100.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))

    for key in ("cash", "debt", "plans", "grow", "absorb"):
        assert payload[key] is None, f"{key} unexpectedly populated"
        reason = payload["reasons"][key]
        assert isinstance(reason, str) and reason, f"{key} null with no reason"

    # cash and absorb share the exact same thin-history sentence.
    assert payload["reasons"]["cash"] == payload["reasons"]["absorb"]
    assert payload["reasons"]["cash"] == (
        "Fewer than 2 months of transaction history, cash flow can't be projected yet."
    )
    assert payload["reasons"]["debt"] == (
        "No cards have both a balance and demonstrated monthly movement to project against."
    )
    assert payload["reasons"]["plans"] == "No active plans to check against this scenario."
    assert payload["reasons"]["grow"] == "Not enough spending history yet to estimate emergency-fund cover."

    # None of these per-block reasons is duplicated into the flat list.
    for reason in payload["reasons"].values():
        assert reason not in payload["assumptions"]


def test_simulate_no_valid_items_gives_every_block_the_same_reason(monkeypatch):
    _patch_simulate_io(monkeypatch, n_months=6)
    payload = asyncio.run(scenario_mod.simulate("test-uid", [{"amount": "garbage"}]))

    assert payload["cash"] is None and payload["debt"] is None
    assert payload["plans"] is None and payload["grow"] is None and payload["absorb"] is None
    for key in ("cash", "debt", "plans", "grow", "absorb"):
        assert payload["reasons"][key] == "No valid scenario items to simulate yet."
    # Not duplicated into assumptions despite applying to every block at once.
    assert "No valid scenario items to simulate yet." not in payload["assumptions"]
    assert payload["lumpy"] is False


def test_simulate_populated_block_with_caveat_note_stays_in_assumptions_only(monkeypatch):
    # A populated block can still carry a caveat (e.g. debt's
    # movement_exhausted note) -- this is NOT a "why is this null" reason
    # (the block isn't null), so it belongs in `assumptions`, not `reasons`,
    # and must never appear in both.
    caveat = "This would use up all of your cards' demonstrated monthly movement, they'd stop coming down."
    _patch_simulate_io(monkeypatch, n_months=6, debt_result=(_default_debt_block(), caveat))
    item = make_item(direction="out", cadence="monthly", amount=100.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))

    assert payload["debt"] is not None
    assert payload["reasons"]["debt"] is None
    assert caveat in payload["assumptions"]
    # Dedup invariant still holds: the caveat is absent from reasons.values().
    assert caveat not in [r for r in payload["reasons"].values() if r]


def test_simulate_lumpy_true_for_annual_dominated_scenario(monkeypatch):
    _patch_simulate_io(monkeypatch, n_months=6)
    item = make_item(direction="out", cadence="annual", amount=1200.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))
    assert payload["lumpy"] is True
    assert any("lands in specific months" in a for a in payload["assumptions"])


def test_simulate_lumpy_true_for_one_off_dominated_scenario(monkeypatch):
    _patch_simulate_io(monkeypatch, n_months=6)
    item = make_item(direction="out", cadence="one_off", amount=500.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))
    assert payload["lumpy"] is True


def test_simulate_lumpy_false_for_plain_monthly_scenario(monkeypatch):
    _patch_simulate_io(monkeypatch, n_months=6)
    item = make_item(direction="out", cadence="monthly", amount=100.0, starts="2026-09-01")
    payload = asyncio.run(scenario_mod.simulate("test-uid", [item]))
    assert payload["lumpy"] is False
    assert not any("lands in specific months" in a for a in payload["assumptions"])


# ── _is_lumpy_scenario: reads the flag, never the prose ───────────────────

def test_is_lumpy_scenario_reads_the_flag_not_the_wording():
    # Assumption prose deliberately says the OPPOSITE of what a naive
    # substring match would expect, proving the router function no longer
    # derives its answer from that text at all -- only from `lumpy` itself.
    payload_true_despite_prose = {
        "lumpy": True,
        "assumptions": ["This scenario is perfectly smooth and evenly spread, nothing lumpy here."],
    }
    assert _is_lumpy_scenario(payload_true_despite_prose) is True

    payload_false_despite_prose = {
        "lumpy": False,
        "assumptions": [
            "Some of this lands in specific months rather than being spread evenly, "
            "see the month-by-month figures for where it actually bites."
        ],
    }
    assert _is_lumpy_scenario(payload_false_despite_prose) is False


def test_is_lumpy_scenario_fails_loudly_if_flag_is_missing():
    # A payload without `lumpy` is a programming error upstream (every
    # simulate() response must carry it) -- this must raise, never guess a
    # default by falling back to string-matching assumptions.
    with pytest.raises(KeyError):
        _is_lumpy_scenario({"assumptions": []})
