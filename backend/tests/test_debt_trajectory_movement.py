"""G103 — the Home debt-trajectory card leads on MOVEMENT, not the stock.

Before G103 the card read "The cards aren't coming down at your current pace,
£24,926 carried across 6 cards" and then repeated £24,926 as its hero figure,
so the loudest number on Home was a balance the user cannot change this pay
period. These tests pin the replacement: a signed movement figure over a
stated window, direction carried in the words, and a 0%-versus-interest split
so a rising balance on a promotional deal is never worded like one that is
accruing interest.

The copy is exercised through `app.services.companion.trajectory_copy`, a
pure function over the debt plan — the same "factor the derivation out so it
is unit-testable without the full DB fan-out" precedent
`app.services.net_position.short_reason_for` set.
"""
from datetime import date
from pathlib import Path

import pytest

import app.services.companion as companion

TODAY = date(2026, 9, 22)

# Figures used across the states. Kept as module constants so a test can
# assert a figure is ABSENT from the headline without re-typing a literal.
INTEREST_BALANCE = 3180.0
ZERO_BALANCE = 21746.0
CARRIED_TOTAL = INTEREST_BALANCE + ZERO_BALANCE  # £24,926 — Kevin's real card
CARRIED_TOTAL_STR = "£24,926"


def _card(
    *,
    account_id="card-1",
    name="Barclaycard",
    debt=1000.0,
    classification="carried_zero",
    first_interest_month=None,
    monthly_interest_at_first=None,
    balance_at_first_interest=None,
    rate_schedule=None,
    terms_missing=False,
):
    """One `plan["cards"]` entry, trimmed to the fields the copy reads."""
    return {
        "account_id": account_id,
        "name": name,
        "debt": debt,
        "classification": classification,
        "movement": {"monthly": 0.0, "per_period": [], "periods_used": 0},
        "rate_schedule": rate_schedule or [],
        "first_interest_month": first_interest_month,
        "monthly_interest_at_first": monthly_interest_at_first,
        "balance_at_first_interest": balance_at_first_interest,
        "flags": {"terms_missing": terms_missing, "assumptions": []},
    }


def _plan(
    *,
    trend_3m,
    cards,
    history_months=12,
    monthly_interest=0.0,
    debt_free_month=None,
    verdict="bad",
    partial_cards=0,
    uncovered_cards=0,
    window_months=None,
):
    if window_months is None:
        # What `_compute_history` reports for cards whose anchors all reach
        # the full three-month mark: min(3, completed months - 1).
        window_months = max(0, min(3, history_months - 1))
    carried = [c for c in cards if c["classification"] != "cleared_monthly"]

    def by_class(k):
        return round(sum(c["debt"] for c in cards if c["classification"] == k), 2)

    return {
        "status": "ok",
        "cards": cards,
        "totals": {
            "debt": round(sum(c["debt"] for c in cards), 2),
            "debt_free_month": debt_free_month,
            "monthly_interest_now": monthly_interest,
            "verdict": verdict,
            "buckets": {
                "cleared_monthly": by_class("cleared_monthly"),
                "carried_zero": by_class("carried_zero"),
                "carried_interest": by_class("carried_interest"),
                "unclear": by_class("unclear"),
                "carried_total": round(sum(c["debt"] for c in carried), 2),
                "float_total": by_class("cleared_monthly"),
                "carried_card_count": len(carried),
                "cleared_card_count": len([c for c in cards if c["classification"] == "cleared_monthly"]),
            },
        },
        "history": {
            # Only the LENGTH matters to the copy: it is what says how many
            # completed months the trend actually spans.
            # `points` is deliberately NOT what the copy reads for its window:
        # it counts float cards too. See `trend_3m_months`.
        "points": [{"month": f"2026-{i:02d}", "total": 0.0} for i in range(1, history_months + 1)],
            "trend_3m": trend_3m,
            "trend_3m_all": trend_3m,
            "trend_3m_partial_cards": partial_cards,
            "trend_3m_uncovered_cards": uncovered_cards,
            "trend_3m_months": window_months,
            "rising": trend_3m > 1.0,
            "assumptions": [],
        },
    }


def _mixed_cards():
    """Two carried cards: one visibly charging interest, one on a 0% deal."""
    return [
        _card(account_id="amex", name="American Express", debt=INTEREST_BALANCE, classification="carried_interest"),
        _card(account_id="barclaycard", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]


def _zero_only_cards():
    return [
        _card(account_id="amex", name="American Express", debt=INTEREST_BALANCE, classification="carried_zero"),
        _card(account_id="barclaycard", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]


def _unclear_cards():
    """The shape `_classify_card` rule 5 produces: no interest seen, but no
    rate on file either, so the engine declines to conclude anything."""
    return [
        _card(account_id="amex", name="American Express", debt=INTEREST_BALANCE, classification="unclear", terms_missing=True),
        _card(account_id="barclaycard", name="Barclaycard", debt=ZERO_BALANCE, classification="unclear", terms_missing=True),
    ]


def _all_text(copy):
    lead = copy["brief_lead"] or {"value": "", "companion": ""}
    return " ".join([copy["headline"], copy["body"], lead["value"], lead["companion"]])


# ── State 1: rising, interest being charged ──────────────────────────────────

def test_rising_on_interest_leads_with_the_movement_not_the_carried_total():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "rising"
    assert copy["tone"] == "watch"
    assert copy["brief_lead"] == {"value": "£412", "companion": "more owed than three months ago"}
    assert CARRIED_TOTAL_STR not in copy["headline"]
    assert CARRIED_TOTAL_STR in copy["body"]
    assert copy["brief_lead"]["value"] != CARRIED_TOTAL_STR


def test_rising_on_interest_carries_the_direction_in_the_words():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert "going up, not down" in copy["headline"]
    assert "interest is being charged" in copy["headline"]
    assert "£412" not in copy["headline"]


def test_rising_on_interest_body_splits_the_interest_bearing_balance_from_the_promo_one():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert "£3,180 of the balance is charging interest" in copy["body"]
    assert "£38 a month" in copy["body"]
    assert "£21,746 is on 0% deals" in copy["body"]


# ── State 2: rising, everything on 0% ────────────────────────────────────────

def test_rising_on_zero_percent_never_words_it_as_interest():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_zero_only_cards(), monthly_interest=0.0),
        TODAY,
    )
    assert copy["trend"] == "rising"
    assert "going up, not down" in copy["headline"]
    assert "interest is being charged" not in copy["headline"]
    assert "nothing on them is charging interest at the moment" in copy["headline"]
    assert "no interest is being charged right now" in copy["body"]
    assert copy["tone"] == "neutral"


def test_the_same_movement_reads_differently_on_interest_and_on_zero_percent():
    on_interest = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0), TODAY
    )
    on_promo = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_zero_only_cards(), monthly_interest=0.0), TODAY
    )
    assert on_interest["brief_lead"]["value"] == on_promo["brief_lead"]["value"] == "£412"
    assert on_interest["headline"] != on_promo["headline"]
    assert on_interest["tone"] == "watch" and on_promo["tone"] == "neutral"


# ── State 3: falling ─────────────────────────────────────────────────────────

def test_falling_with_nothing_charging_interest_reads_as_progress():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_zero_only_cards(), debt_free_month="2029-03"),
        TODAY,
    )
    assert copy["trend"] == "falling"
    assert copy["tone"] == "positive"
    assert copy["headline"] == "Your cards are coming down."
    assert copy["brief_lead"] == {"value": "£612", "companion": "less owed than three months ago"}
    assert "At your current pace they clear in Mar 2029." in copy["body"]


def test_falling_while_charging_interest_says_so_and_never_wears_the_positive_mark():
    """A balance coming down while £38 a month goes on interest is exactly
    the caution condition the amber rule exists for, so the emerald check
    must not be reachable just because the direction is favourable."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "falling"
    assert copy["tone"] == "watch"
    assert copy["headline"] == "Your cards are coming down, though interest is still being charged."
    assert "£38 a month" in copy["body"]


# ── State 4: flat ────────────────────────────────────────────────────────────

def test_flat_says_holding_steady_and_leads_with_no_movement():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.4, cards=_zero_only_cards()),
        TODAY,
    )
    assert copy["trend"] == "flat"
    assert copy["headline"] == "Your cards are holding steady, not coming down."
    assert copy["brief_lead"] == {"value": "£0", "companion": "change over the last three months"}
    assert copy["tone"] == "neutral"


def test_flat_while_paying_interest_earns_the_watch_signifier():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-0.6, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "flat"
    assert copy["tone"] == "watch"
    assert "holding steady, not coming down" in copy["headline"]
    assert "interest is being charged" in copy["headline"]


# ── The direction the card states can never contradict the engine's own ──────

@pytest.mark.parametrize(
    "trend, expected",
    [(1.5, "rising"), (1.0, "flat"), (0.0, "flat"), (-1.0, "flat"), (-1.5, "falling")],
)
def test_the_flat_band_matches_the_debt_engine_rising_threshold(trend, expected):
    from app.services.debt_plan import HISTORY_RISING_EPS

    assert HISTORY_RISING_EPS == 1.0
    copy = companion.trajectory_copy(_plan(trend_3m=trend, cards=_zero_only_cards()), TODAY)
    assert copy["trend"] == expected


@pytest.mark.parametrize("months", [2, 3, 4, 12])
def test_a_short_but_real_window_still_states_the_direction(months):
    """REGRESSION. The card used to require four history points while
    `_compute_history`'s own `rising` flag required none, so a user with
    three months of card history got "there isn't enough card history yet"
    over a £2,000 rise the engine had already turned into a "bad" verdict —
    and the stock-led hero G103 exists to remove came straight back."""
    plan = _plan(trend_3m=2000.0, cards=_zero_only_cards(), history_months=months)
    assert plan["history"]["rising"] is True
    copy = companion.trajectory_copy(plan, TODAY)
    assert copy["trend"] == "rising"
    assert "isn't enough card history" not in copy["headline"]


@pytest.mark.parametrize(
    "partial, uncovered",
    [(0, 0), (1, 0), (0, 1), (2, 3)],
)
@pytest.mark.parametrize("trend_3m", [2000.0, -2000.0, 1.01, -1.01])
def test_a_non_zero_reading_is_never_suppressed_by_any_guard(trend_3m, partial, uncovered):
    """The claim the doctrine comment makes, asserted rather than assumed:
    with a real window behind it, `trend == "rising"` is exactly
    `history["rising"]`. Clamped anchors and unread cards narrow the WORDS,
    they never take the direction away, so the card can never answer a
    "bad" verdict the engine derived from `rising` with "I can't tell"."""
    plan = _plan(
        trend_3m=trend_3m, cards=_zero_only_cards(),
        partial_cards=partial, uncovered_cards=uncovered,
    )
    copy = companion.trajectory_copy(plan, TODAY)
    assert copy["trend"] == ("rising" if trend_3m > 0 else "falling")
    assert (copy["trend"] == "rising") is plan["history"]["rising"]


def test_a_zero_window_can_only_ever_carry_a_zero_reading():
    """The one guard that does sit ahead of the rising check is safe by
    construction: with no completed month between the anchor and the latest
    month-end, every per-card delta is zero, so `rising` is always False."""
    from app.services.debt_plan import _compute_history

    txns = [{"date": date(2026, 9, 2), "amount": 500.0, "transaction_type": "debit"}]
    history = _compute_history(
        TODAY, txns, {"bc": txns}, [{"_id": "bc", "name": "Barclaycard", "balance": -500.0}],
    )
    assert history["trend_3m_months"] == 0
    assert history["trend_3m"] == 0.0
    assert history["rising"] is False


def test_the_window_named_in_the_lead_is_the_window_actually_covered():
    three = companion.trajectory_copy(_plan(trend_3m=412.0, cards=_zero_only_cards(), history_months=12), TODAY)
    two = companion.trajectory_copy(_plan(trend_3m=412.0, cards=_zero_only_cards(), history_months=3), TODAY)
    one = companion.trajectory_copy(_plan(trend_3m=412.0, cards=_zero_only_cards(), history_months=2), TODAY)
    assert three["brief_lead"]["companion"] == "more owed than three months ago"
    assert two["brief_lead"]["companion"] == "more owed than two months ago"
    assert one["brief_lead"]["companion"] == "more owed than a month ago"


def test_the_real_engine_on_three_months_of_history_produces_a_stated_direction():
    """End to end against `_compute_history` rather than a fixture: the exact
    shape the reviewer reproduced — one card whose transactions begin
    2026-06-10, a £2,000 rise, `rising=True`, verdict bad."""
    from app.services.debt_plan import _compute_history, _verdict

    txns = [
        # The card's history begins here, three completed months back.
        {"date": date(2026, 6, 10), "amount": 40.0, "transaction_type": "debit"},
        # ... and £2,000 goes on it after the anchor month-end.
        {"date": date(2026, 8, 15), "amount": 2000.0, "transaction_type": "debit"},
    ]
    acc = {"_id": "bc", "name": "Barclaycard", "balance": -5000.0}
    history = _compute_history(TODAY, txns, {"bc": txns}, [acc])
    assert len(history["points"]) == 3
    assert history["trend_3m"] == 2000.0
    assert history["rising"] is True

    card = _card(account_id="bc", name="Barclaycard", debt=5000.0, classification="carried_zero")
    assert _verdict([card], None, 0.0, history_rising=history["rising"]) == "bad"

    plan = _plan(trend_3m=history["trend_3m"], cards=[card])
    plan["history"] = history
    copy = companion.trajectory_copy(plan, TODAY)
    assert copy["trend"] == "rising"
    assert "isn't enough card history" not in copy["headline"]
    assert copy["brief_lead"] == {"value": "£2,000", "companion": "more owed over the last two months"}
    assert copy["brief_lead"]["value"] != "£5,000"
    assert "clear in" not in copy["body"]


# ── The "not readable" state never reinstates the stock hero ─────────────────

def test_an_unreadable_direction_leads_on_the_interest_rate_not_the_stock():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), history_months=1, monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "isn't enough card history yet" in copy["headline"]
    assert copy["brief_lead"] == {"value": "£38/mo", "companion": "interest right now"}


def test_an_unreadable_direction_with_no_interest_shows_no_hero_figure_at_all():
    """DESIGN.md Flows vs Positions: a position total never greets the user
    on Home. With no direction and no rate to state, the card carries no
    lead figure rather than falling back to the carried total."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_zero_only_cards(), history_months=1),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert copy["brief_lead"] is None
    assert CARRIED_TOTAL_STR in copy["body"]


def test_an_unreadable_direction_never_prints_a_clear_by_month():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), history_months=1, monthly_interest=38.0, debt_free_month="2029-03"),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "clear in" not in copy["body"]


# ── A carried card with no readings at all ───────────────────────────────────

def test_a_carried_card_with_no_history_suppresses_the_direction():
    """BEHAVIOURS.md: suppressed, not guessed. `_compute_history` skips a card
    with no transactions entirely, so `sum([]) == 0.0` would otherwise read as
    "holding steady" about a balance with zero observations behind it."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), monthly_interest=38.0, uncovered_cards=1),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "holding steady" not in copy["headline"]
    assert "1 card has no transaction history yet, so it is not counted." in copy["body"]
    assert copy["brief_lead"] == {"value": "£38/mo", "companion": "interest right now"}


def test_an_uncovered_card_scopes_a_rising_reading_rather_than_muting_it():
    """A card that never syncs must not permanently hide a real rise. The
    observed delta is still "at least this much moved", so the direction is
    stated and the WORDS narrow to the cards that were actually read."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0, uncovered_cards=1),
        TODAY,
    )
    assert copy["trend"] == "rising"
    assert copy["headline"].startswith("The card with history is going up, not down")
    assert copy["brief_lead"] == {"value": "£412", "companion": "more owed on the cards with history"}
    assert "1 card has no transaction history yet, so it is not counted." in copy["body"]


def test_an_uncovered_card_still_suppresses_a_flat_reading():
    """"Nothing moved" is a negative claim, and it cannot be made about a
    balance with zero observations behind it."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), monthly_interest=38.0, uncovered_cards=2),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "holding steady" not in copy["headline"]
    assert "2 cards have no transaction history yet, so they are not counted." in copy["body"]


def test_compute_history_reports_carried_cards_it_could_not_read():
    from app.services.debt_plan import _compute_history

    seen = {"date": date(2025, 10, 1), "amount": 100.0, "transaction_type": "debit"}
    accounts = [
        {"_id": "seen", "name": "Barclaycard", "balance": -2000.0},
        {"_id": "unseen", "name": "Virgin Money", "balance": -900.0},
    ]
    history = _compute_history(TODAY, [seen], {"seen": [seen], "unseen": []}, accounts)
    assert history["trend_3m_uncovered_cards"] == 1


def test_compute_history_does_not_count_a_cleared_or_trivial_card_as_uncovered():
    """A float card is deliberately outside the carried trend, and a card
    with no material balance has nothing to hide."""
    from app.services.debt_plan import _compute_history

    seen = {"date": date(2025, 10, 1), "amount": 100.0, "transaction_type": "debit"}
    accounts = [
        {"_id": "seen", "name": "Barclaycard", "balance": -2000.0},
        {"_id": "float", "name": "Amex", "balance": -900.0},
        {"_id": "tiny", "name": "Santander", "balance": -12.0},
    ]
    history = _compute_history(
        TODAY, [seen], {"seen": [seen], "float": [], "tiny": []}, accounts,
        float_account_ids={"float"},
    )
    assert history["trend_3m_uncovered_cards"] == 0


# ── A card with under three months of history narrows the window claim ───────

def test_a_full_three_month_window_keeps_the_point_in_time_wording():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["brief_lead"]["companion"] == "more owed than three months ago"
    assert "less than three months of history" not in copy["body"]


def test_a_clamped_anchor_drops_the_point_in_time_claim_and_says_why():
    """`_compute_history` clamps a young card's anchor forward to its own
    first covered month, so "than three months ago" would be a comparison
    against a reading that does not exist for that card."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0, partial_cards=1),
        TODAY,
    )
    assert copy["brief_lead"]["companion"] == "more owed over the last three months"
    assert (
        "1 card has less than three months of history, so it is counted from where that history starts."
        in copy["body"]
    )


def test_a_clamped_anchor_narrows_the_falling_wording_too_and_pluralises():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_mixed_cards(), monthly_interest=38.0, partial_cards=2),
        TODAY,
    )
    assert copy["brief_lead"]["companion"] == "less owed over the last three months"
    assert (
        "2 cards have less than three months of history, so they are counted from where that history starts."
        in copy["body"]
    )


def test_a_zero_delta_over_a_partly_observed_window_is_not_called_steady():
    """"At least this much moved" survives a shortened window; "nothing
    moved" is a negative claim about a window that was not fully observed,
    so it is suppressed instead of asserted."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), monthly_interest=38.0, partial_cards=1),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "holding steady" not in copy["headline"]
    assert copy["brief_lead"] == {"value": "£38/mo", "companion": "interest right now"}


def test_compute_history_reports_how_many_cards_had_a_clamped_anchor():
    from app.services.debt_plan import _compute_history

    old_card = {"_id": "old", "name": "Barclaycard", "balance": -2000.0}
    young_card = {"_id": "young", "name": "Virgin Money", "balance": -500.0}
    txns_by_account = {
        "old": [{"date": date(2025, 10, 1), "amount": 100.0, "transaction_type": "debit"}],
        "young": [{"date": date(2026, 7, 5), "amount": 50.0, "transaction_type": "debit"}],
    }
    history = _compute_history(
        TODAY,
        txns_by_account["old"] + txns_by_account["young"],
        txns_by_account,
        [old_card, young_card],
    )
    assert history["trend_3m_partial_cards"] == 1
    assert any("Virgin Money from" in a for a in history["assumptions"])


# ── The engine declines to conclude, so the card must not conclude ───────────

def test_an_unclassified_balance_is_never_declared_interest_free():
    """`_classify_card` rule 5 says no interest appearing could equally mean
    the card is cleared each statement OR on a 0% deal not on file. The card
    must not turn that into "nothing is charging interest"."""
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_unclear_cards()),
        TODAY,
    )
    assert "nothing on them is charging interest" not in copy["headline"]
    assert "none of the balance is costing you interest" not in copy["body"]
    assert "it isn't clear whether part of the balance is charging interest" in copy["headline"]
    assert "could mean it's cleared each statement, or on a deal that isn't on file" in copy["body"]
    # Unknown cost on a rising balance is worth a look.
    assert copy["tone"] == "watch"


def test_an_unclassified_balance_does_not_contradict_the_no_rate_note():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_unclear_cards()),
        TODAY,
    )
    assert "2 cards have no rate on file, so interest there isn't counted." in copy["body"]
    assert "no interest is being charged right now" not in copy["body"]


def test_a_partly_unclassified_balance_still_names_the_zero_percent_part():
    cards = [
        _card(account_id="a", name="Amex", debt=INTEREST_BALANCE, classification="unclear", terms_missing=True),
        _card(account_id="b", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "£21,746 of the balance is on 0% deals." in copy["body"]
    assert "No interest has shown up on the other £3,180" in copy["body"]
    assert "or on a deal that isn't on file" in copy["body"]


def test_a_falling_unclassified_balance_does_not_earn_the_positive_mark():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_unclear_cards()),
        TODAY,
    )
    assert copy["trend"] == "falling"
    assert copy["tone"] == "watch"
    assert copy["headline"] == (
        "Your cards are coming down, though it isn't clear whether part of the balance is charging interest."
    )


# ── Grammar ──────────────────────────────────────────────────────────────────

def test_a_single_carried_card_with_a_clear_by_month_is_grammatical():
    """REGRESSION: `they = "it" if n_cards == 1` produced "it clear"."""
    cards = [_card(account_id="amex", name="American Express", debt=CARRIED_TOTAL, classification="carried_zero")]
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=cards, debt_free_month="2029-03"),
        TODAY,
    )
    assert "At your current pace it clears in Mar 2029." in copy["body"]
    assert "it clear in" not in copy["body"]


def test_a_single_falling_card_with_a_clear_by_month_is_grammatical():
    cards = [_card(account_id="amex", name="American Express", debt=CARRIED_TOTAL, classification="carried_zero")]
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=cards, debt_free_month="2029-03"),
        TODAY,
    )
    assert "At your current pace it clears in Mar 2029." in copy["body"]


def test_multiple_cards_keep_the_plural_verb():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_zero_only_cards(), debt_free_month="2029-03"),
        TODAY,
    )
    assert "At your current pace they clear in Mar 2029." in copy["body"]


def test_a_single_carried_card_uses_singular_wording():
    cards = [_card(account_id="amex", name="American Express", debt=CARRIED_TOTAL, classification="carried_zero")]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert copy["headline"].startswith("Your card is going up, not down")
    assert "nothing on it is charging interest at the moment" in copy["headline"]
    assert f"{CARRIED_TOTAL_STR} is carried on American Express." in copy["body"]


def test_the_card_count_and_the_carried_total_describe_the_same_population():
    """A sub-£50 carried card counts towards `carried_total`, so it must also
    count towards the card count and the plural, and it must not be named as
    if it were the only card."""
    cards = [
        _card(account_id="big", name="Barclaycard", debt=5000.0, classification="carried_zero"),
        _card(account_id="small", name="Santander", debt=20.0, classification="carried_zero"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert copy["headline"].startswith("Your cards are")
    assert "£5,020 is carried across 2 cards in total." in copy["body"]


def test_a_lone_sub_material_card_is_never_described_as_one_cards():
    cards = [_card(account_id="small", name="Santander", debt=20.0, classification="carried_zero")]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "1 cards" not in copy["body"]
    assert "£20 is carried on Santander." in copy["body"]


# ── Rising never also claims a clear-by month ────────────────────────────────

def test_a_rising_balance_never_also_claims_a_clear_by_month():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0, debt_free_month="2029-03"),
        TODAY,
    )
    assert copy["trend"] == "rising"
    assert "clear in" not in copy["body"]


def test_a_flat_balance_still_states_its_clear_by_month():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), monthly_interest=38.0, debt_free_month="2029-03"),
        TODAY,
    )
    assert copy["trend"] == "flat"
    assert "At your current pace they clear in Mar 2029." in copy["body"]


# ── The promo cliff sentence survives the rewrite ────────────────────────────

def test_promo_cliff_sentence_is_preserved_in_the_body():
    cards = [
        _card(
            account_id="barclaycard",
            name="Barclaycard Platinum",
            debt=ZERO_BALANCE,
            classification="carried_zero",
            first_interest_month="2027-03",
            monthly_interest_at_first=25.0,
            balance_at_first_interest=1200.0,
            rate_schedule=[{"source": "promo", "until": "2027-02-28", "apr_pct": 0.0}],
        ),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "£1,200 will still be on the Barclaycard Platinum" in copy["body"]
    assert "when its 0% ends in Mar 2027" in copy["body"]
    assert "about £25 a month unless it's cleared or moved" in copy["body"]
    assert copy["tone"] == "watch"


def test_missing_rate_note_is_preserved():
    cards = [
        _card(account_id="a", name="Amex", debt=INTEREST_BALANCE, classification="carried_interest", terms_missing=True),
        _card(account_id="b", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards, monthly_interest=38.0), TODAY)
    assert "1 card has no rate on file, so interest there isn't counted." in copy["body"]


# ── Float cards are outside the carried trend, and outside its gates ─────────
#
# `trend_3m` sums CARRIED cards only. Every quantity that gates or words that
# figure has to use the same population, or the card describes one set and
# reasons about another.

def _carried_and_float_accounts():
    """Two carried cards with a full year of history, plus a monthly-cleared
    float card linked last month."""
    old = [{"date": date(2025, 9, 25), "amount": 100.0, "transaction_type": "debit"}]
    young_float = [{"date": date(2026, 8, 5), "amount": 400.0, "transaction_type": "debit"}]
    accounts = [
        {"_id": "bc", "name": "Barclaycard", "balance": -2000.0},
        {"_id": "mbna", "name": "MBNA", "balance": -1500.0},
        {"_id": "amex", "name": "American Express", "balance": -400.0},
    ]
    by_account = {"bc": list(old), "mbna": list(old), "amex": young_float}
    return accounts, by_account


def test_a_float_card_is_never_counted_as_a_partial_carried_card():
    """REGRESSION: the clamped-anchor bookkeeping sat outside the float
    guard, so a float card linked last month reported as a carried card with
    under three months of history."""
    from app.services.debt_plan import _compute_history

    accounts, by_account = _carried_and_float_accounts()
    all_txns = [t for rows in by_account.values() for t in rows]
    history = _compute_history(
        TODAY, all_txns, by_account, accounts, float_account_ids={"amex"},
    )
    assert history["trend_3m_partial_cards"] == 0


def test_a_float_card_never_destroys_a_complete_flat_reading():
    """REGRESSION, end to end: the leaked count tripped the "a flat reading
    needs a fully observed window" guard, throwing away a complete reading to
    print a sentence about a card that is not in the figure at all."""
    from app.services.debt_plan import _compute_history

    accounts, by_account = _carried_and_float_accounts()
    all_txns = [t for rows in by_account.values() for t in rows]
    history = _compute_history(
        TODAY, all_txns, by_account, accounts, float_account_ids={"amex"},
    )
    assert history["trend_3m"] == 0.0

    plan = _plan(trend_3m=0.0, cards=_zero_only_cards())
    plan["history"] = history
    copy = companion.trajectory_copy(plan, TODAY)
    assert copy["trend"] == "flat"
    assert copy["headline"] == "Your cards are holding steady, not coming down."
    assert "less than three months of history" not in copy["body"]


def _one_young_carried_card():
    """One carried card whose history starts 15 Jul 2026, with £900 added on
    20 Aug — a single month of movement."""
    txns = [
        {"date": date(2026, 7, 15), "amount": 30.0, "transaction_type": "debit"},
        {"date": date(2026, 8, 20), "amount": 900.0, "transaction_type": "debit"},
    ]
    return {"_id": "mbna", "name": "MBNA", "balance": -2000.0}, txns


def test_a_float_cards_longer_history_does_not_widen_the_named_window():
    """REGRESSION: the window came from `points`, which counts float cards,
    so linking a float card with a year of history turned a one-month rise
    into a three-month one — the one thing this card exists to communicate."""
    from app.services.debt_plan import _compute_history

    card, txns = _one_young_carried_card()
    alone = _compute_history(TODAY, txns, {"mbna": txns}, [card])
    assert alone["trend_3m"] == 900.0
    assert alone["trend_3m_months"] == 1

    float_txns = [{"date": date(2025, 9, 25), "amount": 50.0, "transaction_type": "debit"}]
    with_float = _compute_history(
        TODAY,
        txns + float_txns,
        {"mbna": txns, "amex": float_txns},
        [card, {"_id": "amex", "name": "American Express", "balance": -300.0}],
        float_account_ids={"amex"},
    )
    assert with_float["trend_3m"] == 900.0
    assert with_float["trend_3m_months"] == 1, "a float card widened the carried window"


def test_the_named_window_is_the_same_with_and_without_a_float_card():
    from app.services.debt_plan import _compute_history

    card, txns = _one_young_carried_card()
    float_txns = [{"date": date(2025, 9, 25), "amount": 50.0, "transaction_type": "debit"}]
    leads = []
    for history in (
        _compute_history(TODAY, txns, {"mbna": txns}, [card]),
        _compute_history(
            TODAY, txns + float_txns, {"mbna": txns, "amex": float_txns},
            [card, {"_id": "amex", "name": "American Express", "balance": -300.0}],
            float_account_ids={"amex"},
        ),
    ):
        plan = _plan(trend_3m=history["trend_3m"], cards=[
            _card(account_id="mbna", name="MBNA", debt=2000.0, classification="carried_zero"),
        ])
        plan["history"] = history
        leads.append(companion.trajectory_copy(plan, TODAY)["brief_lead"])
    assert leads[0] == leads[1]
    assert leads[0] == {"value": "£900", "companion": "more owed over the last month"}


def test_the_window_field_is_required_and_its_absence_states_no_direction():
    """The copy must not fall back to `points`: that count includes float
    cards. A plan cached before this field existed fails safe by saying
    nothing rather than naming a window it cannot verify."""
    plan = _plan(trend_3m=412.0, cards=_zero_only_cards())
    del plan["history"]["trend_3m_months"]
    assert companion.trajectory_copy(plan, TODAY)["trend"] == "unknown"


def test_the_reviewers_unsynced_card_case_states_the_direction_it_can_see():
    """MBNA with a year of history and £3,000 added in July, alongside a
    £3,000 Halifax that returned a balance but no transactions."""
    from app.services.debt_plan import _compute_history, _verdict

    mbna = [
        {"date": date(2025, 9, 25), "amount": 20.0, "transaction_type": "debit"},
        {"date": date(2026, 7, 10), "amount": 3000.0, "transaction_type": "debit"},
    ]
    accounts = [
        {"_id": "mbna", "name": "MBNA", "balance": -5000.0},
        {"_id": "hfx", "name": "Halifax", "balance": -3000.0},
    ]
    history = _compute_history(TODAY, mbna, {"mbna": mbna, "hfx": []}, accounts)
    assert history["trend_3m"] == 3000.0
    assert history["rising"] is True
    assert history["trend_3m_uncovered_cards"] == 1

    cards = [
        _card(account_id="mbna", name="MBNA", debt=5000.0, classification="carried_zero"),
        _card(account_id="hfx", name="Halifax", debt=3000.0, classification="carried_zero"),
    ]
    assert _verdict(cards, None, 0.0, history_rising=history["rising"]) == "bad"

    plan = _plan(trend_3m=history["trend_3m"], cards=cards)
    plan["history"] = history
    copy = companion.trajectory_copy(plan, TODAY)
    assert copy["trend"] == "rising"
    assert "isn't enough card history" not in copy["headline"]
    assert copy["brief_lead"]["value"] == "£3,000"
    assert "1 card has no transaction history yet" in copy["body"]


# ── An immaterial ambiguity does not flip the whole card ─────────────────────

def test_a_sub_material_unclear_scrap_does_not_hedge_the_whole_card():
    """£40 of ambiguity must not put an amber dot on a £4,040 portfolio.
    The £50 floor already governs the uncovered-card guard and the
    missing-rate note."""
    cards = [
        _card(account_id="bc", name="Barclaycard", debt=4000.0, classification="carried_zero"),
        _card(account_id="san", name="Santander", debt=40.0, classification="unclear"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "isn't clear whether" not in copy["headline"]
    assert copy["tone"] == "neutral"
    # ... and it still must not claim the whole balance is on 0%.
    assert "The whole balance is on 0% deals" not in copy["body"]
    assert "£4,000 of the balance is on 0% deals" in copy["body"]


def test_a_material_unclear_balance_still_hedges():
    cards = [
        _card(account_id="bc", name="Barclaycard", debt=4000.0, classification="carried_zero"),
        _card(account_id="san", name="Santander", debt=50.0, classification="unclear"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "isn't clear whether part of the balance is charging interest" in copy["headline"]
    assert copy["tone"] == "watch"


# ── A known 0% cliff blocks the favourable mark in every direction ───────────

def _cliff_card(**kw):
    return _card(
        account_id="bc",
        name="Barclaycard Platinum",
        debt=ZERO_BALANCE,
        classification="carried_zero",
        first_interest_month="2027-03",
        monthly_interest_at_first=128.0,
        balance_at_first_interest=6100.0,
        rate_schedule=[{"source": "promo", "until": "2027-02-28", "apr_pct": 0.0}],
        **kw,
    )


def test_a_falling_balance_with_a_known_cliff_never_wears_the_positive_mark():
    """A green check must not sit above "it'd cost about £128 a month unless
    it's cleared or moved"."""
    copy = companion.trajectory_copy(_plan(trend_3m=-612.0, cards=[_cliff_card()]), TODAY)
    assert copy["trend"] == "falling"
    assert copy["tone"] == "neutral"
    assert "£128 a month" in copy["body"]


def test_a_falling_balance_with_no_cliff_still_wears_the_positive_mark():
    copy = companion.trajectory_copy(_plan(trend_3m=-612.0, cards=_zero_only_cards()), TODAY)
    assert copy["tone"] == "positive"


# ── The card is not attributed to Penny, so it does not speak as Penny ───────

def test_no_first_person_voice_anywhere_in_the_card():
    """`CliffCard` deliberately carries no Penny gradient or attribution
    (DESIGN.md's Penny Gradient Rule), so an unattributed "I" would invite
    the user to ask who is speaking."""
    import re

    for state in sorted(ALL_STATES):
        text = _all_text(_state_copy(state))
        assert not re.search(r"\bI\b", text), f"{state}: first person in {text!r}"
        assert not re.search(r"\b(my|me|I'm|I've|I'd|I'll)\b", text), state


def test_the_headline_pronoun_agrees_with_its_subject():
    """"Your cards are ... whether part of IT" had no antecedent."""
    for state in sorted(ALL_STATES):
        copy = _state_copy(state)
        if copy["headline"].startswith("Your cards are"):
            assert " part of it " not in copy["headline"], state
            assert "nothing on it " not in copy["headline"], state
        if copy["headline"].startswith("Your card is"):
            assert "nothing on them " not in copy["headline"], state


# ── Copy rules ───────────────────────────────────────────────────────────────

ALL_STATES = {
    "rising_interest": dict(trend_3m=412.0, cards=_mixed_cards, monthly_interest=38.0),
    "rising_promo": dict(trend_3m=412.0, cards=_zero_only_cards, monthly_interest=0.0),
    "rising_unclear": dict(trend_3m=412.0, cards=_unclear_cards, monthly_interest=0.0),
    "falling": dict(trend_3m=-612.0, cards=_mixed_cards, monthly_interest=38.0),
    "falling_clear": dict(trend_3m=-612.0, cards=_zero_only_cards, monthly_interest=0.0),
    "flat": dict(trend_3m=0.0, cards=_mixed_cards, monthly_interest=38.0),
    "unknown_interest": dict(trend_3m=0.0, cards=_mixed_cards, monthly_interest=38.0, history_months=1),
    "unknown_quiet": dict(trend_3m=0.0, cards=_zero_only_cards, monthly_interest=0.0, history_months=1),
    "uncovered": dict(trend_3m=412.0, cards=_mixed_cards, monthly_interest=38.0, uncovered_cards=1),
    "partial": dict(trend_3m=412.0, cards=_mixed_cards, monthly_interest=38.0, partial_cards=1),
}


def _state_copy(state):
    spec = dict(ALL_STATES[state])
    spec["cards"] = spec["cards"]()
    return companion.trajectory_copy(_plan(**spec), TODAY)


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_no_em_dashes_and_no_ascii_minus_in_any_state(state):
    text = _all_text(_state_copy(state))
    assert "—" not in text and "–" not in text
    # The currency minus is U+2212; an ASCII hyphen in front of £ is the bug.
    assert "-£" not in text


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_the_headline_never_carries_a_money_figure(state):
    """Figures belong to the lead and the body. The G103 fault was a stock
    figure shouted in the headline AND repeated as the hero."""
    assert "£" not in _state_copy(state)["headline"]


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_every_state_returns_the_full_card_shape(state):
    copy = _state_copy(state)
    assert set(copy) == {"headline", "body", "brief_lead", "tone", "trend"}
    assert copy["headline"] and copy["body"]
    assert copy["tone"] in {"neutral", "watch", "positive"}
    assert copy["trend"] in {"rising", "falling", "flat", "unknown"}
    assert copy["brief_lead"] is None or set(copy["brief_lead"]) == {"value", "companion"}


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_no_state_ever_leads_with_the_carried_total(state):
    copy = _state_copy(state)
    if copy["brief_lead"] is not None:
        assert copy["brief_lead"]["value"] != CARRIED_TOTAL_STR


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_only_a_definitively_interest_free_fall_wears_the_positive_mark(state):
    copy = _state_copy(state)
    if copy["tone"] == "positive":
        assert copy["trend"] == "falling"
        assert "interest" not in copy["headline"]


@pytest.mark.parametrize("state", ["rising_interest", "rising_promo", "falling", "flat"])
def test_a_readable_direction_always_names_its_window(state):
    copy = _state_copy(state)
    assert "three months" in copy["brief_lead"]["companion"]


# ── Every trend gets its own icon ────────────────────────────────────────────

HOME_BRIEF = Path(__file__).resolve().parents[2] / "frontend/components/HomeBrief.tsx"


def test_each_trend_has_a_distinct_icon():
    """"unknown" used to share `Minus` with "flat", so the icon asserted
    "no change" on the one card that refuses to make that claim. DESIGN.md
    keeps direction in the words, which means the icon must never say
    something the words do not."""
    import re

    source = HOME_BRIEF.read_text(encoding="utf-8")
    block = re.search(
        r"const TRAJECTORY_ICON[^=]*=\s*\{(.*?)\}", source, re.S,
    )
    assert block, "TRAJECTORY_ICON map not found in HomeBrief.tsx"
    pairs = dict(re.findall(r"(\w+):\s*(\w+)", block.group(1)))
    assert set(pairs) == {"rising", "falling", "flat", "unknown"}
    assert len(set(pairs.values())) == 4, f"icons are not distinct: {pairs}"


# ── The design preview is judged on the real strings ─────────────────────────

PREVIEW_FIXTURES = (
    Path(__file__).resolve().parents[2]
    / "frontend/app/design/home-brief-cards/trajectoryFixtures.ts"
)


def _preview_scenarios():
    """The five scenarios `/design/home-brief-cards?state=trajectory` claims
    to show. Six carried cards totalling £24,926, differing only in the
    movement, whether interest is observed, and whether a 0% cliff is filed."""
    cliff = dict(
        first_interest_month="2027-03",
        monthly_interest_at_first=128.0,
        balance_at_first_interest=6100.0,
        rate_schedule=[{"source": "promo", "until": "2027-02-28", "apr_pct": 0.0}],
    )

    def six(amex_class="carried_interest", with_cliff=False):
        return [
            _card(account_id="amex", name="American Express", debt=3180.0, classification=amex_class),
            _card(
                account_id="bc", name="Barclaycard Platinum", debt=8420.0,
                classification="carried_zero", **(cliff if with_cliff else {}),
            ),
            _card(account_id="mbna", name="MBNA", debt=5980.0, classification="carried_zero"),
            _card(account_id="hfx", name="Halifax Clarity", debt=3140.0, classification="carried_zero"),
            _card(account_id="vm", name="Virgin Money", debt=2706.0, classification="carried_zero"),
            _card(account_id="san", name="Santander", debt=1500.0, classification="carried_zero"),
        ]

    return {
        "rising-interest": _plan(trend_3m=412.0, cards=six(), monthly_interest=38.0),
        "rising-promo": _plan(trend_3m=412.0, cards=six("carried_zero")),
        "falling": _plan(trend_3m=-612.0, cards=six(), monthly_interest=38.0, debt_free_month="2029-03"),
        "falling-clear": _plan(
            trend_3m=-612.0, cards=six("carried_zero"), debt_free_month="2029-03",
        ),
        "flat": _plan(trend_3m=0.4, cards=six(), monthly_interest=38.0),
        "rising-promo-cliff": _plan(trend_3m=412.0, cards=six("carried_zero", with_cliff=True)),
        "unsynced": _plan(
            trend_3m=412.0, cards=six(), monthly_interest=38.0, uncovered_cards=1,
        ),
        "not-readable": _plan(trend_3m=0.0, cards=six("carried_zero"), history_months=1),
    }


def _fixture_entry(source: str, key: str) -> str:
    """The one generated `TRAJECTORY_FIXTURES` entry for `key`."""
    marker = f'key: "{key}"'
    assert marker in source, f"{key}: missing from the preview fixtures"
    rest = source[source.index(marker):]
    end = rest.index("\n  },")
    return rest[:end]


@pytest.mark.parametrize("key", sorted(_preview_scenarios()))
def test_the_design_preview_shows_the_real_copy(key):
    """CLAUDE.md: a preview that drifts from the shipped code is not a gate.
    The preview renders the production CliffCard, so the component cannot
    drift, but its fixture STRINGS can. This is that gate."""
    source = PREVIEW_FIXTURES.read_text(encoding="utf-8")
    copy = companion.trajectory_copy(_preview_scenarios()[key], TODAY)
    entry = _fixture_entry(source, key)
    assert copy["headline"] in entry, f"{key}: headline drifted"
    assert copy["body"] in entry, f"{key}: body drifted"
    assert f'tone: "{copy["tone"]}"' in entry, f"{key}: tone drifted"
    assert f'trend: "{copy["trend"]}"' in entry, f"{key}: trend drifted"
    lead = copy["brief_lead"]
    if lead is None:
        # The no-hero-figure state: the preview has to show a card with no
        # lead at all, not invent one.
        assert "brief_lead" not in entry, f"{key}: preview invents a lead figure"
    else:
        assert (
            f'brief_lead: {{ value: "{lead["value"]}", companion: "{lead["companion"]}" }}' in entry
        ), f"{key}: lead drifted"


def test_the_preview_shows_every_state_the_gate_knows_about_and_no_others():
    """The per-scenario gate proves nothing DRIFTED. This one proves nothing
    was hand-added beside it, which the drift gate would never see."""
    import re

    source = PREVIEW_FIXTURES.read_text(encoding="utf-8")
    assert set(re.findall(r'key: "([^"]+)"', source)) == set(_preview_scenarios())
