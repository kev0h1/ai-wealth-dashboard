"""Unit tests for the shortfall/recommendation gating in
app.services.companion — the pure (no-DB) seams `_walk_events` and
`_gate_recommendation`.

Context: Penny was recommending "Move £X" based on a purely conservative
running-balance walk (outflows before inflows on a shared day, every
upcoming_bills entry counted regardless of `kind`). Two false positives
followed: (1) reliable same-day income landing in the SAME account as the
outflows was never allowed to offset them, so a payday with genuine income
still read as a shortfall; (2) `movement` bills (the user's own standing
orders to savings/another own account/investment/debt) counted the same as
a real commitment, so a stack of self-transfers could trigger a "move
money" instruction to cover a "shortfall" that was never a bill at all.

`_gate_recommendation` is consulted ONLY when deciding whether to emit a
recommendation card — the conservative walk itself (`_walk_events`,
`min_running`, `shortfall_bill`, `bounced_bills`) is untouched, so the
at-risk badge (`analytics.at_risk_count`) and the Planning page stay exactly
as conservative as before.
"""
from datetime import datetime, timedelta

from app.services.categories import MOVEMENT
from app.services.companion import (
    _gate_recommendation,
    _walk_events,
    _should_reactivate,
    _recelebration_gated,
    _RECELEBRATE_COOLDOWN_SECONDS,
)


def bill(name, days_away, amount, kind="commitment", account_id="acc"):
    return {
        "name": name,
        "days_away": days_away,
        "amount": amount,
        "kind": kind,
        "account_id": account_id,
        "expected_date": "2026-08-28",
        "account_name": "Test Account",
    }


def income(name, days_away, amount, account_id="acc"):
    return {"name": name, "days_away": days_away, "amount": amount, "account_id": account_id}


def conservative_walk(events):
    """events: list of (days_away, acct, amount, is_income, item) — sorted
    the same way compute_today_items sorts them: same-day, bills before
    income (outflows-before-inflows)."""
    events = sorted(events, key=lambda e: (e[0], 1 if e[3] else 0))
    return _walk_events(events, {})


def optimistic_walk(events):
    """Same events, same-day tie-break flipped to income-before-outflows —
    exactly what compute_today_items builds to gate recommendations."""
    events = sorted(events, key=lambda e: (e[0], 0 if e[3] else 1))
    return _walk_events(events, {})


def test_same_day_income_covering_same_day_outflow_suppresses_recommendation():
    """A genuine commitment bill would bounce under the conservative
    same-day ordering, but reliable income lands in the SAME account on the
    SAME day and covers it — this is the exact Barclays "Premier Current
    Account" scenario (7 payments + salary, both on 28 Aug). No
    recommendation should fire."""
    b = bill("Council Tax", 5, 100, kind="commitment")
    i = income("Salary", 5, 200)
    events = [(5, "acc", 100.0, False, b), (5, "acc", 200.0, True, i)]

    _, min_running, shortfall_bill, bounced_bills = conservative_walk(events)
    assert min_running["acc"] < 0  # conservative walk still sees a dip
    _, optimistic_min_running, _, _ = optimistic_walk(events)

    result = _gate_recommendation("acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running)
    assert result is None


def test_movement_only_shortfall_suppresses_recommendation():
    """Every bill this account's deficit bounces is `movement` (a standing
    order to the user's own savings/another own account). Money going into
    the owner's own accounts is not an obligation that can fail expensively
    — no recommendation should fire."""
    b = bill("Rainy Day Saver STO", 5, 100, kind="movement")
    events = [(5, "acc", 100.0, False, b)]

    _, min_running, shortfall_bill, bounced_bills = conservative_walk(events)
    assert min_running["acc"] < 0
    _, optimistic_min_running, _, _ = optimistic_walk(events)

    result = _gate_recommendation("acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running)
    assert result is None


def test_genuine_commitment_shortfall_still_recommends():
    """Regression guard: a real commitment shortfall with no covering
    same-day income and no movement involved must still produce a
    recommendation — this is the NatWest "THE NUMBER ONE" case (a genuine
    £95.90 commitment gap) that must keep firing."""
    b = bill("THE NUMBER ONE overdraft fee", 3, 95.90, kind="commitment")
    events = [(3, "acc", 95.90, False, b)]

    _, min_running, shortfall_bill, bounced_bills = conservative_walk(events)
    assert min_running["acc"] < 0
    _, optimistic_min_running, _, _ = optimistic_walk(events)

    result = _gate_recommendation("acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running)
    assert result is not None
    assert result["name"] == "THE NUMBER ONE overdraft fee"
    assert result["kind"] == "commitment"


def test_movement_that_starves_a_real_commitment_still_flags_the_commitment():
    """A large movement drains the account first (and is itself what tips
    the balance negative — the FIRST bounced item), but a real commitment
    later in the same window also fails as a result. The recommendation
    must still fire, and must be represented by the commitment, never by
    the movement that merely started the drain."""
    starve = bill("Big Standing Order to Savings", 3, 150, kind="movement")
    rent = bill("Rent", 5, 60, kind="commitment")
    events = [(3, "acc", 150.0, False, starve), (5, "acc", 60.0, False, rent)]

    running, min_running, shortfall_bill, bounced_bills = conservative_walk(events)
    # Starting balance defaults to £0 (no seed) — the movement itself is
    # already what tips the account negative.
    assert shortfall_bill["acc"]["name"] == "Big Standing Order to Savings"
    assert [b["name"] for b in bounced_bills["acc"]] == ["Big Standing Order to Savings", "Rent"]

    _, optimistic_min_running, _, _ = optimistic_walk(events)

    result = _gate_recommendation("acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running)
    assert result is not None
    assert result["name"] == "Rent"
    assert result["kind"] == "commitment"


def test_movement_bounce_that_never_reaches_a_real_bill_stays_suppressed():
    """Same shape as above, but with no real bill after the movement at
    all — confirms the all-movement suppression still holds even when the
    movement itself is the sole bounced item across a multi-event window."""
    starve = bill("Big Standing Order to Savings", 3, 150, kind="movement")
    top_up = bill("Weekly Pot Top-up", 6, 20, kind="movement")
    events = [(3, "acc", 150.0, False, starve), (6, "acc", 20.0, False, top_up)]

    _, min_running, shortfall_bill, bounced_bills = conservative_walk(events)
    assert all(b["kind"] == MOVEMENT for b in bounced_bills["acc"])
    _, optimistic_min_running, _, _ = optimistic_walk(events)

    result = _gate_recommendation("acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running)
    assert result is None


# ── Reactivation + celebration-damping ───────────────────────────────────────
# Context: a "done" move/payday_plan doc had no way back to "active" — once a
# shortfall cleared and the doc was marked done, the SAME fingerprinted
# shortfall reopening later (e.g. a bill posted, dropping the account
# negative again) could never re-emit, because step 6's own-doc check skips
# anything already "done" and step 7's old reactivation branch only fired for
# destinations that were ALREADY clearing (`min_running >= 0`), never ones
# that had gone negative again. `_should_reactivate` + `_recelebration_gated`
# back the fix (see companion.py "5c. Reactivation" and the step-7 celebration
# branches) — this is the NatWest "THE NUMBER ONE" live case: doc went done
# at a £0 balance, then a £106.67 commitment posted taking it to -£95.90.

def test_done_doc_whose_shortfall_reopens_is_reactivated():
    """The live bug: a done single-dest doc's destination goes materially
    negative again — it must be flagged for reactivation."""
    stored = {"_dest_acct": "acc-natwest", "status": "done"}
    min_running = {"acc-natwest": -95.90}
    assert _should_reactivate(stored, min_running) is True


def test_done_doc_whose_shortfall_stays_resolved_is_not_reactivated():
    """Regression guard: the common case (a done doc whose destination is
    still fine) must never be flagged — this is what keeps a resolved
    recommendation from nagging the user after they've acted."""
    stored = {"_dest_acct": "acc-natwest", "status": "done"}
    min_running = {"acc-natwest": 12.50}
    assert _should_reactivate(stored, min_running) is False

    # Also true when the destination doesn't appear in this run's walk at all
    # (defaults to 0.0, i.e. still fine).
    assert _should_reactivate(stored, {}) is False


def test_trivial_reopening_does_not_reactivate():
    """A doc that dipped to a few pence below zero and bounced back is
    projection noise, not a genuine reopened shortfall. Uses the same £0.50
    noise floor as the emission loop's `dest_gap > 0.5` and the same-day
    income gate's `optimistic_min_running... >= -0.5`."""
    stored = {"_dest_acct": "acc-natwest", "status": "done"}
    assert _should_reactivate(stored, {"acc-natwest": -0.02}) is False
    assert _should_reactivate(stored, {"acc-natwest": -0.49}) is False
    # Exactly at the floor is still not "materially" negative.
    assert _should_reactivate(stored, {"acc-natwest": -0.5}) is False
    # Just past it is.
    assert _should_reactivate(stored, {"acc-natwest": -0.51}) is True


def test_multi_dest_payday_plan_doc_reopens_if_any_destination_does():
    """Payday Plan docs cover several destinations at once; the same one-way
    "done" bug applies to them (confirmed while diagnosing this fix) — the
    plan's promise covered every listed account, so ONE of them slipping
    back into deficit must reopen the whole doc, not just the one account."""
    stored = {"_dest_accts": ["acc-a", "acc-b", "acc-c"], "status": "done"}
    # Two fine, one materially negative.
    assert _should_reactivate(stored, {"acc-a": 5.0, "acc-b": 0.0, "acc-c": -12.0}) is True
    # All fine.
    assert _should_reactivate(stored, {"acc-a": 5.0, "acc-b": 0.0, "acc-c": 3.0}) is False
    # One trivially negative only — still noise.
    assert _should_reactivate(stored, {"acc-a": 5.0, "acc-b": 0.0, "acc-c": -0.10}) is False


def test_doc_with_no_destination_never_reactivates():
    """Defensive: a malformed/legacy doc with neither `_dest_acct` nor
    `_dest_accts` must not crash or spuriously reactivate."""
    assert _should_reactivate({"status": "done"}, {"acc-a": -50.0}) is False
    assert _should_reactivate({"_dest_accts": [], "status": "done"}, {"acc-a": -50.0}) is False


def test_never_reactivated_doc_is_never_celebration_gated():
    """A doc that resolves for the first time (never reactivated) must
    always be free to celebrate — the damping only targets repeat flapping."""
    stored = {"_dest_acct": "acc-natwest"}
    assert _recelebration_gated(stored, datetime.utcnow()) is False
    # Even with a very recent (or absent) `_celebrated_at`.
    stored_with_recent = {"_dest_acct": "acc-natwest", "_celebrated_at": datetime.utcnow()}
    assert _recelebration_gated(stored_with_recent, datetime.utcnow()) is False


def test_reactivated_doc_resolving_too_soon_is_gated():
    """A doc that was reactivated and then resolves again WITHIN the
    cooldown of its last celebration must be gated (resolved quietly, no
    fresh "Sorted" toast/push) — this is the "balance hovering around zero"
    failure mode the task called out."""
    now = datetime.utcnow()
    stored = {
        "_dest_acct": "acc-natwest",
        "_reactivated_at": now - timedelta(minutes=5),
        "_celebrated_at": now - timedelta(seconds=_RECELEBRATE_COOLDOWN_SECONDS - 60),
    }
    assert _recelebration_gated(stored, now) is True


def test_reactivated_doc_resolving_after_cooldown_is_not_gated():
    """Once the cooldown has genuinely elapsed since the last celebration,
    a reactivated-and-now-resolved doc is free to celebrate again — the
    shortfall reopening and clearing a second time, hours apart, is a real
    event worth telling the user about, not noise."""
    now = datetime.utcnow()
    stored = {
        "_dest_acct": "acc-natwest",
        "_reactivated_at": now - timedelta(hours=5),
        "_celebrated_at": now - timedelta(seconds=_RECELEBRATE_COOLDOWN_SECONDS + 60),
    }
    assert _recelebration_gated(stored, now) is False
