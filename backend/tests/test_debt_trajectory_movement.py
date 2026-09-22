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
):
    carried = [c for c in cards if c["classification"] != "cleared_monthly"]
    by_class = lambda k: round(  # noqa: E731 — test-local shorthand
        sum(c["debt"] for c in cards if c["classification"] == k), 2
    )
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
            # Only the LENGTH matters to the copy: it is the guard for "is
            # there a full three completed months behind this trend".
            "points": [{"month": f"2026-{i:02d}", "total": 0.0} for i in range(1, history_months + 1)],
            "trend_3m": trend_3m,
            "trend_3m_all": trend_3m,
            "trend_3m_partial_cards": partial_cards,
            "rising": trend_3m > 1.0,
            "assumptions": [],
        },
    }


def _mixed_cards():
    """Two carried cards: one visibly charging interest, one on a 0% deal."""
    return [
        _card(
            account_id="amex",
            name="American Express",
            debt=INTEREST_BALANCE,
            classification="carried_interest",
        ),
        _card(
            account_id="barclaycard",
            name="Barclaycard",
            debt=ZERO_BALANCE,
            classification="carried_zero",
        ),
    ]


def _zero_only_cards():
    return [
        _card(account_id="amex", name="American Express", debt=INTEREST_BALANCE, classification="carried_zero"),
        _card(account_id="barclaycard", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]


def _all_text(copy):
    return " ".join([copy["headline"], copy["body"], copy["brief_lead"]["value"], copy["brief_lead"]["companion"]])


# ── State 1: rising, interest being charged ──────────────────────────────────

def test_rising_on_interest_leads_with_the_movement_not_the_carried_total():
    copy = companion.trajectory_copy(
        _plan(trend_3m=412.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "rising"
    assert copy["tone"] == "watch"
    # The hero figure is the movement over a stated window.
    assert copy["brief_lead"] == {"value": "£412", "companion": "more owed than three months ago"}
    # The stock is demoted to the body, and never repeated as the hero.
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
    # The headline must not simply restate the lead figure (the G103 fault).
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
    # Same movement, different risk: no amber signifier without a cost or a cliff.
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

def test_falling_reads_as_progress_in_words_and_signifier():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_zero_only_cards(), debt_free_month="2029-03"),
        TODAY,
    )
    assert copy["trend"] == "falling"
    assert copy["tone"] == "positive"
    assert copy["headline"] == "Your cards are coming down."
    assert copy["brief_lead"] == {"value": "£612", "companion": "less owed than three months ago"}
    assert "At your current pace they clear in Mar 2029." in copy["body"]


def test_falling_still_states_the_interest_cost_in_the_body():
    copy = companion.trajectory_copy(
        _plan(trend_3m=-612.0, cards=_mixed_cards(), monthly_interest=38.0),
        TODAY,
    )
    assert copy["headline"] == "Your cards are coming down."
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


# ── The flat threshold agrees with the engine's own rising flag ──────────────

@pytest.mark.parametrize(
    "trend, expected",
    [(1.5, "rising"), (1.0, "flat"), (0.0, "flat"), (-1.0, "flat"), (-1.5, "falling")],
)
def test_the_flat_band_matches_the_debt_engine_rising_threshold(trend, expected):
    from app.services.debt_plan import HISTORY_RISING_EPS

    assert HISTORY_RISING_EPS == 1.0
    copy = companion.trajectory_copy(_plan(trend_3m=trend, cards=_zero_only_cards()), TODAY)
    assert copy["trend"] == expected


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


def test_compute_history_reports_how_many_cards_had_a_clamped_anchor():
    """The structured fact the copy above depends on, asserted against the
    engine rather than a fixture."""
    from datetime import date as _date

    from app.services.debt_plan import _compute_history

    old_card = {"_id": "old", "name": "Barclaycard", "balance": -2000.0}
    young_card = {"_id": "young", "name": "Virgin Money", "balance": -500.0}
    txns_by_account = {
        # Reaches back past the three-month anchor (2026-05-31).
        "old": [{"date": _date(2025, 10, 1), "amount": 100.0, "transaction_type": "debit"}],
        # First appears after it, so its anchor gets clamped forward.
        "young": [{"date": _date(2026, 7, 5), "amount": 50.0, "transaction_type": "debit"}],
    }
    history = _compute_history(
        TODAY,
        txns_by_account["old"] + txns_by_account["young"],
        txns_by_account,
        [old_card, young_card],
    )
    assert history["trend_3m_partial_cards"] == 1
    assert any("Virgin Money from" in a for a in history["assumptions"])


# ── Thin history: the direction is not guessed ───────────────────────────────

def test_thin_history_refuses_to_state_a_direction():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_mixed_cards(), history_months=2, monthly_interest=38.0),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert "isn't enough card history yet" in copy["headline"]
    assert "coming down" not in copy["headline"]
    assert copy["brief_lead"] == {"value": "£38/mo", "companion": "interest right now"}


def test_thin_history_without_interest_falls_back_to_the_carried_total():
    copy = companion.trajectory_copy(
        _plan(trend_3m=0.0, cards=_zero_only_cards(), history_months=2),
        TODAY,
    )
    assert copy["trend"] == "unknown"
    assert copy["brief_lead"]["value"] == CARRIED_TOTAL_STR
    assert copy["brief_lead"]["companion"] == "carried across 2 cards"


def test_a_rising_balance_never_also_claims_a_clear_by_month():
    """The plan's forward projection runs off demonstrated per-period
    movement and can name a clear-by month while the observed three-month
    history rises. Printing both would contradict the headline."""
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
    # A known cliff on a rising balance is worth a look even with no interest today.
    assert copy["tone"] == "watch"


def test_missing_rate_note_is_preserved():
    cards = [
        _card(account_id="a", name="Amex", debt=INTEREST_BALANCE, classification="unclear", terms_missing=True),
        _card(account_id="b", name="Barclaycard", debt=ZERO_BALANCE, classification="carried_zero"),
    ]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert "1 card has no rate on file, so interest there isn't counted." in copy["body"]


# ── Single card ──────────────────────────────────────────────────────────────

def test_a_single_carried_card_uses_singular_wording():
    cards = [_card(account_id="amex", name="American Express", debt=CARRIED_TOTAL, classification="carried_zero")]
    copy = companion.trajectory_copy(_plan(trend_3m=412.0, cards=cards), TODAY)
    assert copy["headline"].startswith("Your card is going up, not down")
    assert "nothing on it is charging interest at the moment" in copy["headline"]
    assert f"{CARRIED_TOTAL_STR} is carried on American Express." in copy["body"]


# ── Copy rules ───────────────────────────────────────────────────────────────

ALL_STATES = {
    "rising_interest": (412.0, _mixed_cards, 38.0, 12),
    "rising_promo": (412.0, _zero_only_cards, 0.0, 12),
    "falling": (-612.0, _mixed_cards, 38.0, 12),
    "flat": (0.0, _mixed_cards, 38.0, 12),
    "unknown": (0.0, _mixed_cards, 38.0, 2),
}


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_no_em_dashes_and_no_ascii_minus_in_any_state(state):
    trend, cards_fn, interest, months = ALL_STATES[state]
    copy = companion.trajectory_copy(
        _plan(trend_3m=trend, cards=cards_fn(), monthly_interest=interest, history_months=months),
        TODAY,
    )
    text = _all_text(copy)
    assert "—" not in text and "–" not in text
    # The currency minus is U+2212; an ASCII hyphen in front of £ is the bug.
    assert "-£" not in text


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_the_headline_never_carries_a_money_figure(state):
    """Figures belong to the lead and the body. The G103 fault was a stock
    figure shouted in the headline AND repeated as the hero."""
    trend, cards_fn, interest, months = ALL_STATES[state]
    copy = companion.trajectory_copy(
        _plan(trend_3m=trend, cards=cards_fn(), monthly_interest=interest, history_months=months),
        TODAY,
    )
    assert "£" not in copy["headline"]


@pytest.mark.parametrize("state", sorted(ALL_STATES))
def test_every_state_returns_the_full_card_shape(state):
    trend, cards_fn, interest, months = ALL_STATES[state]
    copy = companion.trajectory_copy(
        _plan(trend_3m=trend, cards=cards_fn(), monthly_interest=interest, history_months=months),
        TODAY,
    )
    assert set(copy) == {"headline", "body", "brief_lead", "tone", "trend"}
    assert copy["headline"] and copy["body"]
    assert copy["tone"] in {"neutral", "watch", "positive"}
    assert copy["trend"] in {"rising", "falling", "flat", "unknown"}
    assert set(copy["brief_lead"]) == {"value", "companion"}


@pytest.mark.parametrize("state", ["rising_interest", "rising_promo", "falling", "flat"])
def test_a_readable_direction_never_leads_with_the_carried_total(state):
    trend, cards_fn, interest, months = ALL_STATES[state]
    copy = companion.trajectory_copy(
        _plan(trend_3m=trend, cards=cards_fn(), monthly_interest=interest, history_months=months),
        TODAY,
    )
    assert copy["brief_lead"]["value"] != CARRIED_TOTAL_STR
    assert "three months" in copy["brief_lead"]["companion"]
