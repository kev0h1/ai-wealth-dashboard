"""Unit tests for the PURE (no-DB, no-network) seams in app.routers.can_i:
`_derive_verdict`, `_nearest_yes_amount`, `_fmt_rate`/`_per_day_line`, and
`_compose_facts`.

The whole point of moving the Can-I verdict off the LLM (see can_i.py's
module docstring and _derive_verdict's own docstring) is that the one word
the user reads becomes testable arithmetic instead of a temperature-0 guess.
These tests pin that arithmetic down, in particular the golf-session bug
(a positive free_after_spend must never render as a refusal) and the
follow-up review findings: a multi-month savings question must not be
answered as a this-pay-period affordability question, and a "tight" verdict
must always carry the number that makes it tight.
"""
from app.routers.can_i import (
    _compose_facts,
    _derive_verdict,
    _fmt_rate,
    _nearest_yes_amount,
    _per_day_line,
    _VERDICT_HEADLINES,
)


def what_ifs(amount, safe_to_spend, days_until_payday, months_until_target=None, savable_by_target=None):
    """Build a what_ifs dict the same way can_i.py's request handler does,
    so tests exercise the exact fields _derive_verdict/_compose_facts read."""
    after = round(safe_to_spend - amount)
    wi = {
        "amount_asked": amount,
        "free_after_spend": after,
        "per_day_after": round(after / days_until_payday, 2),
        "goes_negative": after < 0,
    }
    if months_until_target is not None:
        wi["months_until_target"] = months_until_target
    if savable_by_target is not None:
        wi["savable_by_target"] = savable_by_target
    return wi


# ── _derive_verdict ──────────────────────────────────────────────────────

def test_derive_verdict_no_amount_asked_returns_none():
    # "name a thing, no price" path — still an LLM call, not this function's job.
    assert _derive_verdict({}, 161.0) is None


def test_derive_verdict_transcript_numbers_are_yes():
    # The exact golf-session numbers (safe_to_spend 161, bills_total 206,
    # amount 100, 5 days to payday): free_after_spend = 61, which is a
    # genuinely comfortable 38% of safe_to_spend at £12.20/day. The original
    # bug was the LLM saying "No" here — a faithful implementation of the
    # stated formula must say "Yes", not reproduce the bug under new copy.
    wi = what_ifs(100.0, 161.0, 5)
    assert wi["free_after_spend"] == 61
    assert _derive_verdict(wi, 161.0) == "yes"


def test_derive_verdict_negative_after_is_no():
    wi = what_ifs(250.0, 161.0, 5)
    assert wi["free_after_spend"] < 0
    assert _derive_verdict(wi, 161.0) == "no"


def test_derive_verdict_after_exactly_zero_is_not_no():
    # after < 0 is the "no" test — after == 0 must fall through to the tight
    # arms, not be treated as a refusal (spending exactly what's free is not
    # "No").
    wi = what_ifs(161.0, 161.0, 5)
    assert wi["free_after_spend"] == 0
    assert _derive_verdict(wi, 161.0) != "no"


def test_derive_verdict_tight_via_relative_arm():
    # after (10) is < 20% of safe_to_spend (161 * 0.2 = 32.2), but per_day_after
    # (10/20 = 0.5) would also trip the absolute arm — pick numbers where only
    # the relative arm fires: after just under 20% but per_day_after >= 5.
    wi = what_ifs(131.0, 161.0, 1)  # after = 30, per_day_after = 30 (1 day left)
    assert wi["free_after_spend"] == 30 < 0.2 * 161.0
    assert wi["per_day_after"] >= 5
    assert _derive_verdict(wi, 161.0) == "tight"


def test_derive_verdict_tight_via_absolute_arm():
    # after (61) is well above 20% of safe_to_spend, but a long runway
    # (20 days) makes per_day_after (3.05) unliveable — the case fix 3 was
    # about: comfortable-looking headline figure, tight actual daily rate.
    wi = what_ifs(100.0, 161.0, 20)
    assert wi["free_after_spend"] >= 0.2 * 161.0
    assert wi["per_day_after"] < 5
    assert _derive_verdict(wi, 161.0) == "tight"


def test_derive_verdict_per_day_after_exactly_five_is_not_tight_via_that_arm():
    # per_day_after < 5 is the absolute-arm test — exactly 5 must not trip it.
    # Chosen so the relative arm doesn't trip either (after well above 20%).
    wi = what_ifs(50.0, 150.0, 20)  # after = 100, per_day_after = 5.0
    assert wi["per_day_after"] == 5.0
    assert wi["free_after_spend"] >= 0.2 * 150.0
    assert _derive_verdict(wi, 150.0) == "yes"


def test_derive_verdict_comfortable_is_yes():
    wi = what_ifs(20.0, 500.0, 5)
    assert _derive_verdict(wi, 500.0) == "yes"


def test_derive_verdict_multi_month_target_is_never_hijacked():
    # Review fix 1: "Can I put £2000 aside for Japan in December?" carries an
    # amount, and free_after_spend (a THIS-PAY-PERIOD figure) would say "no"
    # on its own — but months_until_target being set means this is a
    # multi-month savings question, not a this-period affordability one, and
    # must be left entirely to the offer/savable_by_target branch instead.
    wi = what_ifs(2000.0, 300.0, 30, months_until_target=4, savable_by_target=1600)
    assert wi["free_after_spend"] < 0  # would otherwise force "no"
    assert _derive_verdict(wi, 300.0) is None


def test_verdict_headlines_exact_strings():
    assert _VERDICT_HEADLINES["no"] == "Not this one"
    assert _VERDICT_HEADLINES["tight"] == "Yes, but it'll be tight"
    assert _VERDICT_HEADLINES["yes"] == "Yes"


# ── _nearest_yes_amount ──────────────────────────────────────────────────

def test_nearest_yes_below_five_pounds_is_none():
    assert _nearest_yes_amount(4.99) is None


def test_nearest_yes_exactly_five_pounds():
    assert _nearest_yes_amount(5.00) == 5


def test_nearest_yes_floors_never_rounds_up():
    # 9.99 must floor to 5, not round up to 10.
    assert _nearest_yes_amount(9.99) == 5
    # 161 must floor to 160, not round to the nearest 5 (which would be 160
    # anyway here, so also check a value where floor and round-to-nearest
    # actually disagree).
    assert _nearest_yes_amount(161.0) == 160
    assert _nearest_yes_amount(163.0) == 160  # round-to-nearest would give 165


def test_nearest_yes_zero_is_none():
    assert _nearest_yes_amount(0.0) is None


def test_nearest_yes_negative_is_none():
    assert _nearest_yes_amount(-89.0) is None


# ── _fmt_rate / _per_day_line ────────────────────────────────────────────

def test_fmt_rate_whole_pounds_at_five_and_above():
    assert _fmt_rate(5.0) == "£5"
    assert _fmt_rate(32.264) == "£32"


def test_fmt_rate_pence_below_five():
    assert _fmt_rate(4.99) == "£4.99"
    assert _fmt_rate(1.2) == "£1.20"


def test_per_day_line_uses_fmt_rate():
    assert _per_day_line(32.264) == "That's about £32 a day"
    assert _per_day_line(1.2) == "That's about £1.20 a day"


# ── _compose_facts ───────────────────────────────────────────────────────

def _facts(safe_to_spend, bills_total, wi, per_day=None):
    return {
        "safe_to_spend": safe_to_spend,
        "next_payday": "2026-08-28",
        "bills_total": bills_total,
        "per_day": per_day if per_day is not None else round(safe_to_spend / 5, 2),
        "what_ifs": wi,
    }


def test_compose_facts_transcript_scenario_reads_as_approval_not_refusal():
    # safe_to_spend 161, bills_total 206, amount 100, 5 days — the exact
    # golf-session numbers. Verdict is "yes" (see test above); the bills
    # line and the what-if line must both be present and neither may read
    # like it's telling a different story from the other.
    wi = what_ifs(100.0, 161.0, 5)
    facts = _facts(161.0, 206, wi)
    lines = _compose_facts(facts, None)
    assert lines == [
        "£161 free until Fri 28 Aug",
        "£206 of bills due before payday, already accounted for",
        "£100 leaves £61 free",
    ]


def test_compose_facts_bills_collision_refusal_gets_nearest_yes():
    # Amount exceeds safe_to_spend with a material bill in the way: bills is
    # the reason, the negative what-if is the consequence, nearest-yes is
    # the way forward — all three must appear, per-day must not (it's
    # dropped to make room).
    wi = what_ifs(250.0, 161.0, 5)
    facts = _facts(161.0, 206, wi)
    lines = _compose_facts(facts, None)
    assert lines == [
        "£161 free until Fri 28 Aug",
        "£206 of bills due before payday, already accounted for",
        "£250 would take you −£89",
        "£160 would work",
    ]


def test_compose_facts_tight_verdict_shows_the_post_spend_rate():
    # safe_to_spend 161, bills 420, amount 100, 20 days: tight via the
    # per_day_after arm. The card must show the £3.05/day figure that IS
    # the reason it's tight, not just a comfortable-looking "£61 free".
    wi = what_ifs(100.0, 161.0, 20)
    assert _derive_verdict(wi, 161.0) == "tight"
    facts = _facts(161.0, 420, wi, per_day=round(161.0 / 20, 2))
    facts["next_payday"] = "2026-09-13"  # 20 days out from the fixed 28 Aug default
    lines = _compose_facts(facts, None)
    assert lines == [
        "£161 free until Sun 13 Sep",
        "£420 of bills due before payday, already accounted for",
        "£100 leaves £61 free",
        "That leaves about £3.05 a day until payday",
    ]


def test_compose_facts_savings_by_december_offer_branch_wins():
    # Review fix 1's traced failure: "Can I put £2000 aside for Japan in
    # December?", safe_to_spend £300, bills £480, monthly_surplus £400. The
    # this-period what-if (£2000 against £300 free) must NOT appear, no
    # nearest-yes must appear (there is no this-period refusal to soften),
    # and the savings-pace line must be the only third line — exactly the
    # single coherent answer the endpoint gave before verdict derivation
    # was added.
    wi = what_ifs(2000.0, 300.0, 30, months_until_target=4, savable_by_target=1600)
    assert _derive_verdict(wi, 300.0) is None
    facts = _facts(300.0, 480, wi, per_day=round(300.0 / 30, 2))
    offer = {"target_date": "2026-12-01"}
    lines = _compose_facts(facts, offer)
    assert lines == [
        "£300 free until Fri 28 Aug",
        "That's about £10 a day",
        "Saving at this pace, about £1,600 by December 2026",
    ]
    joined = " ".join(lines)
    assert "£2,000" not in joined and "2000" not in joined  # no this-period what-if
    assert "would work" not in joined  # no nearest-yes
