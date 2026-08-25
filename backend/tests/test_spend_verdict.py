"""Unit tests for app.services.spend_verdict — the pure (no-DB) seams only:
`bucket_transactions` and `assemble_verdict`. No network, no Mongo.
"""
from datetime import date

from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.spend_verdict import (
    _movement_fallback_sentence,
    _unresolved_display_name,
    assemble_verdict,
    bucket_transactions,
    build_unresolved,
    compose_reading,
    determine_state,
)

KIND_MAP = dict(BUILTIN_CATEGORY_KINDS)


def txn(category, amount, *, debit=True, merchant="", desc="", d=date(2026, 8, 13)):
    return {
        "date": d, "category": category, "amount": abs(float(amount)), "debit": debit,
        "merchant_name": merchant, "description": desc, "id": "x",
    }


def base_signals():
    """One signals dict reused across tests — usual_rate_per_day chosen so
    each category's qualifying-ness is easy to reason about by hand at
    days_elapsed=13."""
    return {
        "Bills":         {"usual_rate_per_day": 100.0, "multiple": 2.0},
        "Transport":     {"usual_rate_per_day": 15.0,  "multiple": 1.4},
        "Health":        {"usual_rate_per_day": 8.0,   "multiple": 2.0},
        "Groceries":     {"usual_rate_per_day": 32.0,  "multiple": 1.05},
        "Subscriptions": {"usual_rate_per_day": 2.0,   "multiple": 4.2},
        "Cash":          {"usual_rate_per_day": 8.0,   "multiple": 1.0},
        "Golf":          {"usual_rate_per_day": None,  "multiple": None},  # thin per-category history
    }


def build_period_txns():
    """A realistic period's worth of transactions across spend, movement and
    income kinds, mirroring the SpendBClient mock roughly (not exactly)."""
    return [
        # Bills — qualifies (low-multiple branch: 2.0>=1.5, excess huge)
        txn("Bills", 340, merchant="British Gas"),
        txn("Bills", 180, merchant="EDF"),
        txn("Bills", 167, merchant="Council Tax"),
        txn("Bills", 1341, merchant="Rent"),
        # Transport — qualifies via high-multiple branch
        txn("Transport", 449, merchant="Shell", d=date(2026, 8, 5)),
        # Health — qualifies (one big payment)
        txn("Health", 117, merchant="David Lloyd"),
        txn("Health", 111, merchant="Boots"),
        # Groceries — under threshold, stays in majority
        txn("Groceries", 421, merchant="Tesco"),
        # Cash — multiple exactly 1.0, majority
        txn("Cash", 115, merchant="ATM"),
        # Other — unresolved
        txn("Other", 1020, merchant="WISE", d=date(2026, 8, 4)),
        # Movement
        txn("Savings", 2724, merchant="Monzo Pot"),
        txn("Debt", 834, merchant="Barclaycard"),
        txn("Investment", 400, merchant="Vanguard"),
        # Income
        txn("Income", 253, merchant="Employer", debit=False),
    ]


def test_bucket_transactions_reconciliation_and_moved_never_negative():
    kind_map = KIND_MAP
    txns = build_period_txns()
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)

    # Spend categories present, movement/income excluded from cat_agg.
    assert set(cat_agg) == {"Bills", "Transport", "Health", "Groceries", "Cash", "Other"}
    assert "Savings" not in cat_agg and "Debt" not in cat_agg and "Investment" not in cat_agg
    assert "Income" not in cat_agg

    assert moved_groups["pots"]["amount"] == 2724
    assert moved_groups["credit_cards"]["amount"] == 834
    assert moved_groups["investments"]["amount"] == 400
    for g in moved_groups.values():
        assert g["amount"] >= 0  # Destination Rule: never a minus sign

    assert income_total == 253

    signals = base_signals()
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=["Japan", "Rainy Day Saver"], period={"start": "2026-08-01"},
    )

    notables_total = sum(n["spent"] for n in result["notables"])
    majority_total = sum(m["spent"] for m in result["majority"])
    unresolved_total = result["unresolved"]["total"]
    assert round(notables_total + majority_total + unresolved_total, 2) == result["pills"]["spent"]
    assert result["pills"]["spent"] == round(sum(r["spent"] for r in cat_agg.values()), 2)
    assert result["pills"]["income"] == 253
    assert result["pills"]["net"] == round(253 - result["pills"]["spent"], 2)


def test_state_normal_three_qualifying():
    kind_map = KIND_MAP
    cat_agg, moved_groups, income_total = bucket_transactions(build_period_txns(), kind_map)
    signals = base_signals()
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=[], period={},
    )
    assert result["state"] == "normal"
    assert len(result["notables"]) == 3
    assert {n["category"] for n in result["notables"]} == {"Bills", "Transport", "Health"}
    assert result["quiet_flags"] == []
    assert "Other" not in {m["category"] for m in result["majority"]}
    assert "mostly Bills" in result["reading"]  # Bills has the largest excess


def test_state_everything_caps_notables_and_overflows_to_quiet_flags():
    kind_map = KIND_MAP
    txns = build_period_txns() + [
        # Push Subscriptions and Groceries over the qualifying line too.
        txn("Subscriptions", 122, merchant="Netflix"),
        txn("Groceries", 900, merchant="Tesco", d=date(2026, 8, 2)),
    ]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    signals = base_signals()
    signals["Groceries"] = {"usual_rate_per_day": 32.0, "multiple": 2.7}  # now qualifies too
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=[], period={},
    )
    assert result["state"] == "everything"
    assert len(result["notables"]) == 3
    assert len(result["quiet_flags"]) >= 1
    promoted = {n["category"] for n in result["notables"]}
    flagged = {q["category"] for q in result["quiet_flags"]}
    assert promoted.isdisjoint(flagged)
    # Overflow categories still show up in majority (quiet, not promoted).
    assert flagged <= {m["category"] for m in result["majority"]}
    assert "The three biggest are below." in result["reading"]


def test_state_nothing_zero_qualifying():
    kind_map = KIND_MAP
    txns = [txn("Groceries", 400, merchant="Tesco"), txn("Cash", 100, merchant="ATM")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    signals = {
        "Groceries": {"usual_rate_per_day": 32.0, "multiple": 1.0},
        "Cash":      {"usual_rate_per_day": 8.0,  "multiple": 1.0},
    }
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=[], period={},
    )
    assert result["state"] == "nothing"
    assert result["notables"] == []
    assert "Nothing unusual to report" in result["reading"]
    assert "all 2 categories are running close to usual" in result["reading"]


def test_state_nobaseline_overrides_qualification():
    kind_map = KIND_MAP
    txns = [txn("Groceries", 400, merchant="Tesco")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals={}, days_elapsed=13, thin_history=True,
        goal_names=[], period={},
    )
    assert result["state"] == "nobaseline"
    assert result["notables"] == []
    assert "Still learning your usual" in result["reading"]


def test_state_early_overrides_everything_else():
    kind_map = KIND_MAP
    txns = [txn("Groceries", 400, merchant="Tesco")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals={}, days_elapsed=3, thin_history=True,  # both would-be triggers present
        goal_names=[], period={},
    )
    assert result["state"] == "early"
    assert "3 days in" in result["reading"]


def test_determine_state_precedence():
    assert determine_state(days_elapsed=3, thin_history=True, qualifying_count=5) == "early"
    assert determine_state(days_elapsed=10, thin_history=True, qualifying_count=5) == "nobaseline"
    assert determine_state(days_elapsed=10, thin_history=False, qualifying_count=0) == "nothing"
    assert determine_state(days_elapsed=10, thin_history=False, qualifying_count=4) == "everything"
    assert determine_state(days_elapsed=10, thin_history=False, qualifying_count=1) == "normal"


def test_other_never_promoted_to_notable_or_majority():
    kind_map = KIND_MAP
    txns = [txn("Other", 500, merchant="Mystery Co", d=date(2026, 8, 2))]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    signals = {"Other": {"usual_rate_per_day": 1.0, "multiple": 10.0}}  # would obviously qualify if allowed
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=[], period={},
    )
    assert result["notables"] == []
    assert result["quiet_flags"] == []
    assert result["majority"] == []
    assert result["unresolved"]["total"] == 500
    # 500 is both >= the £250 flat floor and >= 10% of the period's only
    # spend category (itself, 500) — material, so ask-worthy.
    assert result["unresolved"]["ask_worthy"] is True
    assert result["unresolved"]["weight"] == "material"


def test_unresolved_ask_worthy_thresholds():
    kind_map = KIND_MAP
    # Below the £250 floor and below 10% of a normal-sized Out, non-recurring
    # — not ask-worthy, but still returned with a clean display name.
    small_other = bucket_transactions([txn("Other", 50, merchant="Corner Shop")], kind_map)[0].get("Other")
    small = build_unresolved(small_other, total_out=3000.0)
    assert small["ask_worthy"] is False
    assert small["weight"] == "routine"
    assert small["total"] == 50
    assert small["largest"]["display_name"] == "Corner Shop"
    assert small["largest"]["raw_description"] == "Corner Shop"

    # Below the floor and below the 10% fraction, but recurring (same
    # merchant twice) — ask-worthy regardless of materiality.
    recurring_other = bucket_transactions(
        [txn("Other", 20, merchant="Mystery Sub"), txn("Other", 20, merchant="Mystery Sub", d=date(2026, 8, 6))],
        kind_map,
    )[0].get("Other")
    recurring = build_unresolved(recurring_other, total_out=3000.0)
    assert recurring["ask_worthy"] is True
    assert recurring["weight"] == "routine"  # recurring earns the ask, not size

    # A single large payment — material via the flat £250 floor.
    big_other = bucket_transactions([txn("Other", 1020, merchant="WISE")], kind_map)[0].get("Other")
    big = build_unresolved(big_other, total_out=4643.0)
    assert big["ask_worthy"] is True
    assert big["weight"] == "material"

    # Material via the 10%-of-Out fraction even though under the flat £250
    # floor — a small-Out period where £60 genuinely is a big chunk of £200.
    fraction_other = bucket_transactions([txn("Other", 60, merchant="Odd One")], kind_map)[0].get("Other")
    fraction = build_unresolved(fraction_other, total_out=200.0)
    assert fraction["weight"] == "material"
    assert fraction["ask_worthy"] is True

    # Part (c) regression: the ask must gate on the LARGEST transaction, not
    # the bucket total. Thirty non-recurring £4 rows sum to £120 — well past
    # the old flat £100 bucket trigger — but no single row is material or
    # recurring, so no ask fires pointing at a £4 payment.
    many_small_txns = [txn("Other", 4.0, merchant=f"Kiosk {i}") for i in range(30)]
    many_small_other = bucket_transactions(many_small_txns, kind_map)[0].get("Other")
    many_small = build_unresolved(many_small_other, total_out=3000.0)
    assert many_small["total"] == 120.0
    assert many_small["ask_worthy"] is False
    assert many_small["weight"] == "routine"
    assert many_small["payments_count"] == 30

    # Empty Other bucket — still returns a shape, never ask-worthy.
    empty = build_unresolved(None)
    assert empty == {
        "total": 0.0, "payments_count": 0, "ask_worthy": False,
        "weight": "routine", "largest": None,
    }


def test_unresolved_display_name_strips_provider_plumbing():
    # The three real provider strings named in the brief.
    assert _unresolved_display_name("FINEXER LTD OPENBANKINGPAYMENT FT.", "") == "Finexer"
    assert _unresolved_display_name("", "PLAYTOMIC* PI-F0D6 ON 11 JUL BCC") == "Playtomic"
    assert _unresolved_display_name("WISE *8827 TRANSFER", "") == "Wise"
    # Acronym allowlist survives upper-cased.
    assert _unresolved_display_name("EDF ENERGY LTD DD", "") == "EDF Energy"
    # Nothing clean survives -> None, never bank plumbing shown as a name.
    assert _unresolved_display_name("LTD PAYMENTS FT.", "") is None
    assert _unresolved_display_name("", "") is None


def test_unresolved_payments_count_matches_debit_rows():
    kind_map = KIND_MAP
    txns = [
        txn("Other", 30, merchant="A"),
        txn("Other", 40, merchant="B"),
        txn("Other", 10, merchant="C"),
    ]
    other_row = bucket_transactions(txns, kind_map)[0].get("Other")
    result = build_unresolved(other_row, total_out=3000.0)
    assert result["payments_count"] == 3


def test_dismissed_unresolved_id_suppresses_ask_but_keeps_whisper():
    kind_map = KIND_MAP
    txns = [txn("Other", 1020, merchant="WISE")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    largest_id = cat_agg["Other"]["debit_txns"][0]["id"]
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals={}, days_elapsed=13, thin_history=False,
        goal_names=[], period={}, dismissed_unresolved_ids={largest_id},
    )
    assert result["unresolved"]["ask_worthy"] is False
    assert result["unresolved"]["total"] == 1020  # still shown/counted


def test_notable_cause_ranks_top_three_merchants():
    kind_map = KIND_MAP
    txns = [
        txn("Bills", 340, merchant="British Gas"),
        txn("Bills", 180, merchant="EDF"),
        txn("Bills", 167, merchant="Council Tax"),
        txn("Bills", 50, merchant="Small One"),
    ]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    signals = {"Bills": {"usual_rate_per_day": 20.0, "multiple": 2.0}}
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals=signals, days_elapsed=13, thin_history=False,
        goal_names=[], period={},
    )
    bills = next(n for n in result["notables"] if n["category"] == "Bills")
    assert [c["name"] for c in bills["cause"]] == ["British Gas", "EDF", "Council Tax"]
    assert len(bills["cause"]) == 3  # capped, "Small One" excluded


def test_moved_omits_empty_groups_and_carries_goal_names():
    kind_map = KIND_MAP
    txns = [txn("Savings", 200, merchant="Monzo Pot")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)
    result = assemble_verdict(
        cat_agg=cat_agg, moved_groups=moved_groups, income_total=income_total,
        signals={}, days_elapsed=13, thin_history=False,
        goal_names=["Japan"], period={},
    )
    assert len(result["moved"]) == 1
    assert result["moved"][0]["kind"] == "pots"
    assert result["moved"][0]["goal_names"] == ["Japan"]
    assert result["moved"][0]["amount"] == 200


# ── own_accounts split (owner complaint, 2026-08: "£8,087 to savings and
# cards" named a destination for money that was mostly plain shuffling) ─────

def test_bucket_transactions_transfer_goes_to_own_accounts_not_pots():
    kind_map = KIND_MAP
    txns = [
        txn("Transfer", 6074.64, merchant="Kevin Maingi Barclays"),
        txn("Savings", 497.05, merchant="Saving Challenge"),
    ]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)

    # Transfer is no longer folded into "pots" — it earns its own bucket.
    assert moved_groups["own_accounts"]["amount"] == 6074.64
    assert moved_groups["own_accounts"]["categories"] == {"Transfer"}

    # Savings still lands in "pots", undisturbed.
    assert moved_groups["pots"]["amount"] == 497.05
    assert moved_groups["pots"]["categories"] == {"Savings"}


def test_bucket_transactions_custom_movement_category_defaults_to_pots():
    """No reliable per-transaction signal exists to tell a goal-linked
    custom movement category apart from a non-goal one here (see
    `_movement_bucket`'s docstring): goal claims are keyed by the
    destination account_id, but bucket_transactions only ever sees the
    source (debit) leg. Absent that signal, a custom movement category
    defaults to "pots" — misfiling a genuine goal contribution as
    "shuffling" is the worse error of the two."""
    kind_map = dict(KIND_MAP)
    kind_map["House Fund"] = "movement"
    txns = [txn("House Fund", 300, merchant="House Fund STO")]
    cat_agg, moved_groups, income_total = bucket_transactions(txns, kind_map)

    assert moved_groups["pots"]["amount"] == 300
    assert moved_groups["own_accounts"]["amount"] == 0


def test_movement_fallback_sentence_genuine_only_below_own_floor():
    moved = [
        {"kind": "pots", "amount": 400.0},
        {"kind": "credit_cards", "amount": 100.0},
        {"kind": "own_accounts", "amount": 10.0},  # below MOVED_MATERIAL_FLOOR
    ]
    sentence = _movement_fallback_sentence(moved)
    assert sentence == "You also moved £500 to savings and cards."


def test_movement_fallback_sentence_own_accounts_only():
    moved = [
        {"kind": "pots", "amount": 20.0},  # below floor
        {"kind": "own_accounts", "amount": 6075.0},
    ]
    sentence = _movement_fallback_sentence(moved)
    assert sentence == "You also moved £6,075 between your own accounts."
    assert "savings" not in sentence  # never claim a destination for shuffling


def test_movement_fallback_sentence_both_material_names_both_honestly():
    moved = [
        {"kind": "pots", "amount": 587.0},
        {"kind": "credit_cards", "amount": 1090.0},
        {"kind": "investments", "amount": 425.0},
        {"kind": "own_accounts", "amount": 6075.0},
    ]
    sentence = _movement_fallback_sentence(moved)
    assert sentence == (
        "You also moved £2,102 to savings, cards and investments, "
        "and £6,075 between your own accounts."
    )


def test_movement_fallback_sentence_never_names_an_empty_genuine_group():
    # Genuine total clears the floor via pots alone; investments/credit_cards
    # are present in the payload at £0 (e.g. omitted-in-build_moved groups
    # never reach here in practice, but the helper must be defensive) and
    # must never be named.
    moved = [
        {"kind": "pots", "amount": 200.0},
        {"kind": "credit_cards", "amount": 0.0},
        {"kind": "investments", "amount": 0.0},
    ]
    sentence = _movement_fallback_sentence(moved)
    assert sentence == "You also moved £200 to savings."


def test_movement_fallback_sentence_neither_side_material_returns_none():
    moved = [
        {"kind": "pots", "amount": 10.0},
        {"kind": "own_accounts", "amount": 15.0},
    ]
    assert _movement_fallback_sentence(moved) is None


def _no_consequence_impact():
    return {"consequence": None, "move": None, "horizon": None, "bills_risk": None, "unresolved_hedge": False}


def test_compose_reading_wires_moved_list_into_fallback_sentence():
    """End-to-end through compose_reading (not just the pure helper) —
    confirms the `moved` list, not a collapsed float, is what actually
    reaches the sentence composer."""
    moved = [
        {"kind": "pots", "amount": 497.0},
        {"kind": "credit_cards", "amount": 1090.0},
        {"kind": "investments", "amount": 425.0},
        {"kind": "own_accounts", "amount": 6075.0},
    ]
    reading = compose_reading(
        state="nothing",
        base_reading="Nothing unusual to report.",
        notables=[],
        pace_totals={"excess": 0.0},
        impact=_no_consequence_impact(),
        moved=moved,
        unresolved_total=0.0,
    )
    assert reading == (
        "Nothing unusual to report. You also moved £2,012 to savings, cards and investments, "
        "and £6,075 between your own accounts."
    )
