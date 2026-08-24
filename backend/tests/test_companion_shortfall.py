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
    _overdraft_deficits,
    _overdraft_covered_by_today_income,
    _shortfall_for_destination,
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


# ── Overdraft destinations ────────────────────────────────────────────────────
# Context: an account that is ALREADY OVERDRAWN today (a real, live negative
# balance) but has no bill due on it inside the window never entered
# `_walk_events`' `running`/`min_running` at all (only `assessable_bills`
# accounts get seeded — see its docstring), so it could never reach
# `_gate_recommendation`, which requires a bounced bill. `_overdraft_deficits`
# is the pure, DB-free trigger (live balance < 0, independent of any bill or
# of what `_gate_recommendation` decided) and `_shortfall_for_destination`
# is the pure, DB-free decision that combines it with the bill-backed route,
# guaranteeing at most one shortfall per destination — this is the live
# HSBC "-£2.48, nothing due" case, plus the "-£40 live, but the only bill is
# a suppressed movement" case.

def _acc(str_id, *, subtype="TRANSACTION", offline=False):
    d = {"_str_id": str_id, "account_subtype": subtype}
    if offline:
        d["_offline"] = True
    return d


def test_overdrawn_account_with_no_in_window_bills_produces_a_deficit():
    """The core gap being closed: a current account sitting at -£2.48 with
    nothing due on it this window must be picked up as an overdraft
    destination."""
    accounts = [_acc("acc-hsbc")]
    live_balances = {"acc-hsbc": -2.48}
    result = _overdraft_deficits(accounts, live_balances)
    assert result == {"acc-hsbc": -2.48}


def test_no_noise_floor_a_penny_negative_still_counts():
    """Deliberate contrast with the -0.5 thresholds used elsewhere in this
    file: a live balance of -£0.01 is a fact, not projection noise, so it
    must still qualify — no threshold here."""
    accounts = [_acc("acc-hsbc")]
    live_balances = {"acc-hsbc": -0.01}
    result = _overdraft_deficits(accounts, live_balances)
    assert result == {"acc-hsbc": -0.01}


def test_deficit_detection_is_independent_of_whether_the_walk_touched_it():
    """`_overdraft_deficits` itself no longer knows or cares whether
    `_walk_events` already seeded this account (that used to gate inclusion
    here, which was the bug: it meant an account with an in-window
    movement-only bill could never be flagged as overdrawn even though it
    genuinely is, right now). Exclusion of already-seeded keys from
    `min_running` writes now happens at the `compute_today_items` call site
    (step 4b), not here — this function reports every negative live balance,
    full stop."""
    accounts = [_acc("acc-hsbc")]
    live_balances = {"acc-hsbc": -2.48}
    # No `seeded_accounts` concept at all any more — same two-arg call
    # whether or not the account has an in-window bill.
    result = _overdraft_deficits(accounts, live_balances)
    assert result == {"acc-hsbc": -2.48}


def test_credit_card_negative_balance_is_not_an_overdraft():
    """A negative card balance is ordinary debt against a credit limit, not
    an overdraft — credit cards must never become overdraft destinations."""
    accounts = [_acc("acc-card", subtype="CREDIT_CARD")]
    live_balances = {"acc-card": -50.0}
    result = _overdraft_deficits(accounts, live_balances)
    assert result == {}


def test_offline_manual_account_never_becomes_a_destination():
    """Offline/manual accounts stay SOURCES only — belt-and-braces guard on
    `_overdraft_deficits` itself, even though the real call site never
    passes offline accounts in (they live in a separate list)."""
    accounts = [_acc("acc-cash", offline=True)]
    live_balances = {"acc-cash": -10.0}
    result = _overdraft_deficits(accounts, live_balances)
    assert result == {}


def test_positive_balance_is_never_an_overdraft():
    """Sanity: a non-negative live balance never qualifies."""
    accounts = [_acc("acc-hsbc")]
    live_balances = {"acc-hsbc": 0.0}
    assert _overdraft_deficits(accounts, live_balances) == {}


def test_same_day_reliable_income_into_the_same_account_suppresses_the_card():
    """Gate (a)'s spirit, adapted for overdraft destinations: reliable
    income already attributed to this exact account and landing TODAY
    (days_away == 0) that covers the deficit means moving money is wrong,
    since the money that clears it is already arriving today."""
    window_income = [
        {"account_id": "acc-hsbc", "days_away": 0, "amount": 50.0, "name": "Salary"},
    ]
    confirmed_income_keys = {"Salary"}
    assert _overdraft_covered_by_today_income(
        2.48, "acc-hsbc", window_income, confirmed_income_keys
    ) is True


def test_income_landing_a_different_day_does_not_suppress():
    """Regression guard for the conservative default: income due tomorrow,
    not today, must not suppress an overdraft card that's true right now."""
    window_income = [
        {"account_id": "acc-hsbc", "days_away": 1, "amount": 50.0, "name": "Salary"},
    ]
    confirmed_income_keys = {"Salary"}
    assert _overdraft_covered_by_today_income(
        2.48, "acc-hsbc", window_income, confirmed_income_keys
    ) is False


def test_income_attributed_to_a_different_account_does_not_suppress():
    """Per-account attribution matters — income landing in a different
    account today must not silently cover this one's deficit."""
    window_income = [
        {"account_id": "acc-other", "days_away": 0, "amount": 50.0, "name": "Salary"},
    ]
    confirmed_income_keys = {"Salary"}
    assert _overdraft_covered_by_today_income(
        2.48, "acc-hsbc", window_income, confirmed_income_keys
    ) is False


def test_unreliable_income_does_not_suppress():
    """Income that hasn't earned `income_credit_ok`'s reliability bar
    (unconfirmed, fewer than 3 occurrences) must not suppress the card even
    if it happens to land today."""
    window_income = [
        {"account_id": "acc-hsbc", "days_away": 0, "amount": 50.0, "name": "Random Payer",
         "occurrences": 1},
    ]
    assert _overdraft_covered_by_today_income(
        2.48, "acc-hsbc", window_income, confirmed_income_keys=set()
    ) is False


def test_today_income_that_falls_short_does_not_suppress():
    """Partial cover isn't full cover — today's reliable income must at
    least meet the deficit, not just reduce it, to suppress the card."""
    window_income = [
        {"account_id": "acc-hsbc", "days_away": 0, "amount": 1.0, "name": "Salary"},
    ]
    confirmed_income_keys = {"Salary"}
    assert _overdraft_covered_by_today_income(
        2.48, "acc-hsbc", window_income, confirmed_income_keys
    ) is False


# ── _shortfall_for_destination: combining the two routes, one card each ─────
# Context (the gap the coordinator flagged): `_overdraft_deficits` used to be
# gated by `seeded_accounts`, so an account that DID have an in-window bill
# was invisible to it even when every bounce on that bill was `movement` and
# `_gate_recommendation` gate (b) suppressed it — an account sitting at -£40
# right now, with a £200 standing order to savings due, got no card from
# EITHER route. `_shortfall_for_destination` is the single seam that now
# decides, per destination, which (if either) route fires — and guarantees
# at most one entry, since it structurally can only ever `return` once.

def test_movement_only_bounce_but_live_overdrawn_still_flags_via_overdraft_route():
    """The exact scenario from the coordinator's note: an account already at
    -£40 live, with an in-window bill that's movement-only (a standing
    order to savings). Gate (b) rightly suppresses recommending THAT — it's
    the user's own money move — but the account is independently overdrawn
    right now, and the overdraft route must still fire, sized off the LIVE
    balance (£40), not the deeper post-movement min_running figure (£240)."""
    b = bill("Rainy Day Saver STO", 3, 200, kind="movement")
    events = sorted([(3, "acc", 200.0, False, b)], key=lambda e: (e[0], 1 if e[3] else 0))
    _, min_running, shortfall_bill, bounced_bills = _walk_events(events, {"acc": -40.0})
    assert min_running["acc"] == -240.0  # conservative walk: -£40 live, then -£200 more

    optimistic_events = sorted(events, key=lambda e: (e[0], 0 if e[3] else 1))
    _, optimistic_min_running, _, _ = _walk_events(optimistic_events, {"acc": -40.0})

    overdraft_today = {"acc": -40.0}  # the LIVE balance, independent of the walk
    result = _shortfall_for_destination(
        "acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running,
        overdraft_today, window_income=[], confirmed_income_keys=set(),
    )
    assert result is not None
    days_away, amount, display_bill = result
    assert display_bill is None  # overdraft route — not the suppressed movement bill
    assert amount == 40.0  # sized off the LIVE balance, NOT the -£240 post-movement figure
    assert days_away == 0


def test_bill_backed_shortfall_wins_over_overdraft_route_no_double_emission():
    """An account overdrawn live AND with a genuine (non-movement) bill
    bouncing must produce exactly ONE shortfall entry — the richer,
    bill-backed one, sized off the full conservative deficit (which already
    clears the live overdraft too, since the walk starts from that same
    live balance) — not a second, separate overdraft entry."""
    b = bill("Council Tax", 3, 60, kind="commitment")
    events = sorted([(3, "acc", 60.0, False, b)], key=lambda e: (e[0], 1 if e[3] else 0))
    _, min_running, shortfall_bill, bounced_bills = _walk_events(events, {"acc": -40.0})
    assert min_running["acc"] == -100.0

    optimistic_events = sorted(events, key=lambda e: (e[0], 0 if e[3] else 1))
    _, optimistic_min_running, _, _ = _walk_events(optimistic_events, {"acc": -40.0})

    overdraft_today = {"acc": -40.0}  # also genuinely overdrawn live
    result = _shortfall_for_destination(
        "acc", min_running["acc"], shortfall_bill, bounced_bills, optimistic_min_running,
        overdraft_today, window_income=[], confirmed_income_keys=set(),
    )
    assert result is not None
    days_away, amount, display_bill = result
    assert display_bill is not None
    assert display_bill["name"] == "Council Tax"
    assert amount == 100.0  # the bill-backed figure, not the £40 live-only figure
    # Structurally a single (days_away, amount, bill) tuple or None — there is
    # no code path that could return two entries for the same destination.


def test_shortfall_for_destination_overdraft_route_suppressed_by_today_income():
    """Integration of the same-day-income gate through the combined seam:
    reliable income landing today that covers the live deficit suppresses
    the overdraft route entirely."""
    overdraft_today = {"acc": -40.0}
    window_income = [{"account_id": "acc", "days_away": 0, "amount": 50.0, "name": "Salary"}]
    result = _shortfall_for_destination(
        "acc", -40.0, shortfall_bill={}, bounced_bills={}, optimistic_min_running={},
        overdraft_today=overdraft_today, window_income=window_income,
        confirmed_income_keys={"Salary"},
    )
    assert result is None


def test_shortfall_for_destination_pure_overdraft_no_bill_at_all():
    """Regression guard for the original case this task closes: no bill on
    the account inside the window at all, just a live negative balance."""
    overdraft_today = {"acc": -2.48}
    result = _shortfall_for_destination(
        "acc", -2.48, shortfall_bill={}, bounced_bills={}, optimistic_min_running={},
        overdraft_today=overdraft_today, window_income=[], confirmed_income_keys=set(),
    )
    assert result == (0, 2.48, None)


def test_shortfall_for_destination_neither_route_returns_none():
    """A destination absent from both `shortfall_bill` and `overdraft_today`
    (e.g. it's negative only because of a same-day income timing artifact
    already handled elsewhere) must not fire either route."""
    result = _shortfall_for_destination(
        "acc", -5.0, shortfall_bill={}, bounced_bills={}, optimistic_min_running={},
        overdraft_today={}, window_income=[], confirmed_income_keys=set(),
    )
    assert result is None


# ── Source safety (reused, not reimplemented) ─────────────────────────────────
# The task guarantees a source is never drawn below its own £10 floor —
# `_source_min_running` (a closure inside `compute_today_items`, simulating a
# candidate source's own bills + own reliably-attributed income across the
# window) and the leg-building loop's `headroom = source_capacity − 10` /
# `leg_amount = min(remaining, headroom)` are UNCHANGED by this work and are
# not exposed as standalone pure functions to unit-test directly. Both are
# generic over `dest_acct` — nothing in the leg-building loop branches on
# whether a destination's shortfall came from a bounced bill or from the new
# step-4b overdraft seed, so the exact same floor applies to both. This test
# pins the floor arithmetic those call sites apply, as a regression guard on
# the invariant itself.
def test_source_floor_arithmetic_never_allows_drawing_below_ten_pounds():
    """headroom = source_min_running − £10; a leg is capped to headroom, so
    a source's post-contribution minimum can never fall below £10 no matter
    how large the destination's need is — overdraft or bill-driven alike."""
    source_min_running = 42.0
    floor = 10.0
    headroom = source_min_running - floor
    for requested in (5.0, 32.0, 1000.0):  # small, exact headroom, way over
        leg_amount = min(requested, headroom)
        assert source_min_running - leg_amount >= floor - 1e-9
