"""Unit tests for the PURE (no-DB, no-network) seams in app.routers.can_i:
`_derive_verdict`, `_nearest_yes_amount`, `_fmt_rate`/`_per_day_line`,
`_whatif_delta_line`, `_multimonth_fit_headline`, `_DEBT_VERDICT_HEADLINES`,
and `_is_saving_vs_investing_question`.

The whole point of moving the Can-I verdict off the LLM (see can_i.py's
module docstring and _derive_verdict's own docstring) is that the headline
the user reads becomes testable arithmetic instead of a temperature-0 guess.
These tests pin that arithmetic down, in particular the golf-session bug
(a positive free_after_spend must never render as a refusal) and the
follow-up review findings: a multi-month savings question must not be
answered as a this-pay-period affordability question, and a "tight" verdict
must always carry the number that makes it tight.

Owner decision, 2026-08-25: the headline itself is no longer a verdict word
("Yes"/"Not this one"/"Yes, but it'll be tight" all read as advice — a
recommendation on what the user should do — even though the numbers behind
them are entirely the user's own). `_derive_verdict`'s internal yes/tight/no
result is UNCHANGED and still tested below (it still drives which
consequence the LLM is told to weave into its reply — the nearest-yes
suggestion on "no", the post-spend daily rate on "tight"), but what is now
SHOWN as the headline is either the factual what-if delta
(`_whatif_delta_line`) or, for the one amount-bearing branch with no delta,
a softened factual-conditional fallback (`_multimonth_fit_headline`).

Owner order, 2026-08-25 (the "duplication war" — his own screenshot showed a
debt reply quoting two different, unexplained debt totals side by side):
"all these grayed out answers can we remove all of them." Every /can-i path
now returns `facts: []`; `_compose_facts`, the function that used to build
that muted grey list, was deleted outright (nothing else depended on it —
see can_i.py's own comment where it used to live). The tests that exercised
it directly are gone too; the arithmetic it assembled is still pinned above
it in this file (`_nearest_yes_amount`, `_whatif_delta_line`,
`_nothing_spare_line`) and below via the `/can-i` wiring tests, which now
assert `facts == []` on every response shape they touch.
"""
import asyncio
import json
from datetime import date

import app.routers.can_i as can_i_module
import app.services.debt_narration as debt_narration_module
from app.routers.can_i import (
    _ASK_WHEN_INSTRUCTION,
    _ASK_WHEN_SUFFIX,
    _DEBT_SYSTEM_TEMPLATE,
    _DEBT_VERDICT_HEADLINES,
    _append_ask_when_suffix,
    _build_ask_when_block,
    _derive_verdict,
    _extract_amount,
    _extract_horizon_year,
    _extract_month_year,
    _fmt_rate,
    _handle_debt_domain,
    _handle_insights_domain,
    _handle_payday_status_question,
    _is_big_one_off_with_no_horizon,
    _is_categorisation_explainer_question,
    _is_isa_capability_question,
    _is_out_of_scope,
    _is_page_explainer_question,
    _is_saving_vs_investing_question,
    _is_tax_question,
    _months_until_horizon_year,
    _months_until_month_year,
    _multimonth_fit_headline,
    _nearest_yes_amount,
    _nothing_spare_line,
    _per_day_line,
    _route_domain,
    _screen_vocabulary_route,
    _valid_screen,
    _whatif_delta_line,
    can_i_suggestions,
)


def what_ifs(amount, safe_to_spend, days_until_payday, months_until_target=None, savable_by_target=None):
    """Build a what_ifs dict the same way can_i.py's request handler does,
    so tests exercise the exact fields _derive_verdict reads."""
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


# ── Affordability/debt HEADLINE strings (owner decision, 2026-08-25) ─────
# The exact strings below are now the product's voice, not an implementation
# detail — pinned the same way _fmt_rate/_per_day_line are, so drift is
# caught here, not by a screenshot months later.

def test_whatif_delta_line_positive_is_the_delta_headline():
    # This exact sentence is now shown as the affordability HEADLINE itself
    # (see can_i.py's `can_i` handler) whenever _derive_verdict resolves.
    assert _whatif_delta_line(100.0, 61.0) == "£100 leaves £61 free"


def test_whatif_delta_line_negative_is_the_delta_headline():
    assert _whatif_delta_line(250.0, -89.0) == "£250 would take you −£89"


def test_multimonth_fit_headline_covers_target_is_that_fits():
    # savable_by_target (2000) covers amount_asked (1600) -> fits.
    assert _multimonth_fit_headline(2000, 1600) == "That fits"


def test_multimonth_fit_headline_short_of_target_is_that_doesnt_fit():
    # savable_by_target (1600) falls short of amount_asked (2000) -> doesn't fit.
    assert _multimonth_fit_headline(1600, 2000) == "That doesn't fit"


def test_multimonth_fit_headline_exactly_equal_counts_as_fits():
    # >= , not > — exactly covering the target is still a fit, not a miss.
    assert _multimonth_fit_headline(2000, 2000) == "That fits"


def test_debt_verdict_headlines_exact_strings():
    # Debt counselling is a regulated activity — these strings are strictly
    # descriptive (what the numbers are doing), never advisory.
    assert _DEBT_VERDICT_HEADLINES["bad"] == "Growing, not clearing"
    assert _DEBT_VERDICT_HEADLINES["drifting"] == "Pace has slipped"
    assert _DEBT_VERDICT_HEADLINES["good"] == "Clearing steadily"


# Regression guard for the owner's advice-exposure decision: none of these
# words may ever be producible as an affordability or debt headline again,
# under any input. If a future change reintroduces one of them (e.g. by
# adding it back to _DEBT_VERDICT_HEADLINES, or by some new code path
# formatting a bare verdict word into a headline string), this test fails.
_BANNED_VERDICT_WORDS = {"Yes", "No", "Not this one", "Needs attention"}


def test_no_banned_verdict_word_producible_as_a_headline():
    affordability_headlines = {
        _whatif_delta_line(100.0, 61.0),
        _whatif_delta_line(100.0, -3.0),
        _whatif_delta_line(250.0, -89.0),
        _multimonth_fit_headline(1600, 2000),
        _multimonth_fit_headline(2000, 1600),
    }
    debt_headlines = set(_DEBT_VERDICT_HEADLINES.values())
    all_headlines = affordability_headlines | debt_headlines
    assert not (all_headlines & _BANNED_VERDICT_WORDS), all_headlines & _BANNED_VERDICT_WORDS
    # Old debt strings must also be gone, not just the affordability ones.
    assert "Slipping, not clearing" not in debt_headlines
    assert "Clearing on track" not in debt_headlines


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


# ── _is_saving_vs_investing_question ──────────────────────────────────────
# Owner decision, 2026-08-25: "Should I be investing instead of saving?"
# invites a personal investment recommendation (the FCA perimeter). Both
# phrasings the grow-screen chip actually sends must route to the fixed
# general-information explainer; an ordinary "am I saving enough?" question
# (no investing word at all) must NOT, so it keeps going to the general
# affordability path as before.

def test_saving_vs_investing_matches_instead_of_phrasing():
    assert _is_saving_vs_investing_question(
        "Should I be investing instead of saving?", None
    ) is True


def test_saving_vs_investing_matches_vs_phrasing():
    assert _is_saving_vs_investing_question(
        "Saving vs investing, how does it work?", None
    ) is True


def test_saving_vs_investing_does_not_match_saving_enough():
    # No investing word at all — must fall through harmlessly, never a false
    # positive on ordinary "saving" vocabulary.
    assert _is_saving_vs_investing_question("Am I saving enough?", None) is False


def test_saving_vs_investing_does_not_match_with_a_priced_amount():
    # A priced question is a real affordability ask the existing what-if
    # machinery already answers — never this fixed explainer, which has no
    # way to engage with a specific amount.
    assert _is_saving_vs_investing_question(
        "Can I afford to put £50 into an investment instead of savings?", 50.0
    ) is False


def test_saving_vs_investing_does_not_match_bare_co_occurrence():
    # Both words present but no comparison connector — an ordinary accounts
    # question, not a "how does this work" ask. Conservative on purpose (see
    # the matcher's own comment): a false negative just falls through.
    assert _is_saving_vs_investing_question(
        "How much do I have in savings and investments?", None
    ) is False


# ── _nothing_spare_line + the negative-safe_to_spend guard (owner-approved
# fix, 2026-08) — safe_to_spend is net of unpaid card growth and can land at
# or below zero. These pin the sites that used to format it as a bare
# (possibly negative) "£X free" figure: _handle_payday_status_question's
# reply and can_i_suggestions's context_line. ─────────────────────────────

def test_nothing_spare_line_bills_reason():
    assert _nothing_spare_line("Fri 28 Aug", "bills") == "Nothing spare until Fri 28 Aug, bills come first"


def test_nothing_spare_line_cards_reason():
    assert (
        _nothing_spare_line("Fri 28 Aug", "cards")
        == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    )


def test_nothing_spare_line_no_payday_label_falls_back_to_generic():
    assert _nothing_spare_line(None, "bills") == "Nothing spare until payday, bills come first"
    assert (
        _nothing_spare_line(None, "cards")
        == "Bills are covered, but nothing spare until payday, it's gone on cards"
    )


def test_nothing_spare_line_never_uses_em_dash():
    for reason in (None, "bills", "cards"):
        assert "—" not in _nothing_spare_line("Fri 28 Aug", reason)


def test_handle_payday_status_question_negative_cards_short(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -83.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)
    result = asyncio.run(_handle_payday_status_question("kevin"))
    assert result["headline"] == can_i_module._PAYDAY_STATUS_SHORT_CARDS_HEADLINE
    # Owner order, 2026-08-25: the grey facts tier is gone, so the content
    # that used to live there is now the flowing REPLY prose instead.
    assert result["facts"] == []
    assert result["reply"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards."
    assert not any(s in result["reply"] for s in ("-£", "−£"))


def test_handle_payday_status_question_negative_bills_short(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -40.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 120.0, "state": "short",
            "short_reason": "bills",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)
    result = asyncio.run(_handle_payday_status_question("kevin"))
    assert result["headline"] == "You're short until payday"
    assert result["facts"] == []
    assert result["reply"] == (
        "Nothing spare until Fri 28 Aug, bills come first. "
        "£120 of bills due before payday, already accounted for."
    )
    assert not any(s in result["reply"] for s in ("-£", "−£"))


def test_handle_payday_status_question_reuses_precomputed_sts(monkeypatch):
    # `sts` may be passed in already-fetched, so a caller with its own fact
    # pack in hand (there is none in `can_i` today, but the capability is
    # kept for a future caller — see the function's own docstring) never
    # forces a second compute_safe_to_spend call for one request.
    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", _RaisingSts())
    sts = {
        "status": "ok", "safe_to_spend": -188.94, "days_until_payday": 3,
        "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
        "short_reason": "cards",
    }
    result = asyncio.run(_handle_payday_status_question("kevin", sts))
    assert result["headline"] == can_i_module._PAYDAY_STATUS_SHORT_CARDS_HEADLINE
    assert result["facts"] == []
    assert result["reply"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards."


# ── /can-i wiring: a HEADROOM-intent question ("how much do I actually
# have", "what's left", "how much can I spend") asked while "short" must
# route to the deterministic payday-status template, never the free-form
# affordability LLM — owner-reported trust bug, 2026-08-25. "How much do I
# actually have until payday" didn't match _is_payday_status_question's old
# phrase list, so it fell through to the LLM below with safe_to_spend able
# to be negative (net of unpaid card growth) and nothing to anchor it: the
# model invented a bills total from the unrelated 90-day monthly-spending
# average, re-narrated the negative per-day rate as an "overspend" pace, and
# claimed the savings buffer "covers some of it" — none of it derived, all
# of it contradicting the Home card's "Bills are covered" for the same
# state.
#
# The fix widens `_PAYDAY_STATUS_PHRASES` to catch the headroom family
# properly (see that list's own comment) rather than bypassing the LLM for
# every no-amount question while short: a genuinely different question with
# no headroom intent ("is my spending normal?") must still reach the LLM and
# get a real answer even while the user is short — see
# test_can_i_non_headroom_question_while_short_still_reaches_llm below, the
# regression guard for that narrower scope.
class _RaisingSts:
    """compute_safe_to_spend stand-in that raises if called a second time."""
    def __init__(self):
        self.calls = 0

    async def __call__(self, uid):
        self.calls += 1
        raise AssertionError("compute_safe_to_spend should not be called twice")


class _RaisingAsyncClient:
    """httpx.AsyncClient stand-in — constructing it at all proves the LLM
    path was reached, which this fix must prevent for a short-state,
    no-amount question."""
    def __init__(self, *args, **kwargs):
        raise AssertionError("httpx.AsyncClient should not be constructed on this path")


class _RaisingFind:
    """commitments_col stand-in for `_active_goals_summary`, which wraps its
    whole body in a bare `except Exception: return []` — a synchronous raise
    here is swallowed exactly like a real Mongo outage, giving an empty
    active-goals list without ever touching real Mongo."""
    def find(self, *args, **kwargs):
        raise RuntimeError("no real Mongo access in this test")


async def _noop_check_ai_chat_limit(email):
    return None


def _patch_can_i_common(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())
    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _RaisingAsyncClient)


def test_can_i_headroom_intent_question_while_short_routes_deterministic_cards(monkeypatch):
    # "How much do I actually have until payday" is headroom intent, not
    # domain-routed, no £ amount — it must now match the widened
    # _PAYDAY_STATUS_PHRASES and answer via _handle_payday_status_question,
    # same as "What's still due before payday" always has. httpx.AsyncClient
    # is patched to raise, proving the LLM is never touched.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -188.94, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards", "card_debt": 372.98,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "How much do I actually have until payday"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == can_i_module._PAYDAY_STATUS_SHORT_CARDS_HEADLINE
    # Owner order, 2026-08-25: the grey facts tier is gone everywhere.
    assert result["facts"] == []
    assert result["reply"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards."
    assert result["out_of_scope"] is False
    # The invented-content regression this fix targets: no fabricated bills
    # total, no re-narrated overspend rate, no invented buffer claim.
    for blob in (result["headline"], result["reply"]):
        assert "bills totalling" not in blob.lower()
        assert "a day" not in blob.lower()
        assert "buffer" not in blob.lower()
        assert "—" not in blob and "–" not in blob


def test_can_i_headroom_intent_question_while_short_routes_deterministic_bills(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -40.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 120.0, "state": "short",
            "short_reason": "bills",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "How much do I actually have until payday"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == "You're short until payday"
    assert result["facts"] == []
    assert result["reply"] == (
        "Nothing spare until Fri 28 Aug, bills come first. "
        "£120 of bills due before payday, already accounted for."
    )
    assert result["out_of_scope"] is False


# ── /can-i wiring: an AMOUNT-BEARING question that resolves to a shortfall
# ("no") while the user is already short must ALSO get a fully deterministic
# reply, not just a deterministic headline — owner-reported trust bug,
# 2026-08-25 (round 2). "Can I spend £45 until payday?" got the correct,
# deterministic HEADLINE ("£45 would take you −£234", via resolved_headline/
# _whatif_delta_line) but the REPLY was still handed to the LLM with the full
# facts pack in view. The model latched onto `card_debt` (a raw outstanding
# card balance, no due date at all — now removed from the pack) and asserted
# a false, specific due date for it ("£2,774 in bills hitting in three days")
# plus a prediction about payment method it cannot know ("this £45 goes on
# the card like the rest of your spending"). Both violate the owner's
# standing rule that bill/income timing is always hedged, never asserted.
def test_can_i_amount_bearing_shortfall_cards_is_fully_deterministic(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -188.94, "safe_to_spend_cash": 184.04,
            "card_growth_reserved": 372.98, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £45 until payday?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == "£45 would take you −£234"
    assert result["reply"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    assert result["facts"] == []
    # The exact two fabrications this fix targets must be structurally
    # impossible now, not just banned by a prompt clause: no bills total/due
    # date invented, no payment-method prediction.
    assert "2,774" not in result["reply"] and "£2,774" not in result["reply"]
    assert "hitting" not in result["reply"].lower() and "due" not in result["reply"].lower()
    assert "card like the rest" not in result["reply"].lower()
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_can_i_amount_bearing_shortfall_bills_is_fully_deterministic(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -40.0, "safe_to_spend_cash": -40.0,
            "card_growth_reserved": 0.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 120.0, "state": "short",
            "short_reason": "bills",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £20 until payday?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == "£20 would take you −£60"
    assert result["reply"] == "Nothing spare until Fri 28 Aug, bills come first"
    assert result["facts"] == []


def test_can_i_amount_bearing_not_short_still_reaches_llm(monkeypatch):
    # The narrower scope of this fix: only a resolved "no" verdict WHILE
    # state == "short" is rerouted deterministically. An amount-bearing
    # question that resolves "tight" (state comfortable/tight, not short)
    # must still reach the LLM for its interpretive reply, same as always —
    # proven by letting the LLM boundary raise.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 20,
            "next_payday": "2026-09-13", "bills_total": 0.0, "state": "tight",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £100 until payday?"}
    try:
        asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
        raised = False
    except AssertionError as e:
        raised = "httpx.AsyncClient should not be constructed" in str(e)
    assert raised, "a non-short amount-bearing question should still reach the LLM boundary"


def test_can_i_facts_pack_never_includes_ambiguous_card_debt_total(monkeypatch):
    # card_debt (total outstanding balance across cards, no due date at all)
    # was the second unscoped, bills-shaped number the model in the trust bug
    # above latched onto — removed from the fact pack entirely rather than
    # captioned, since nothing downstream needs it. Captured via a spy
    # httpx.AsyncClient standing in for the real LLM call on a "tight" (not
    # short, so still LLM-routed) amount-bearing question.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 20,
            "next_payday": "2026-09-13", "bills_total": 0.0, "state": "tight",
            "short_reason": None, "card_debt": 2774.0,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £100 until payday?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert "card_debt" not in system_prompt
    assert "2774" not in system_prompt
    # Owner order, 2026-08-25: the grey facts tier is gone everywhere,
    # including the general LLM-phrased affordability path.
    assert result["facts"] == []


def test_can_i_nearest_yes_amount_reaches_llm_grounding_on_shortfall(monkeypatch):
    # Owner order, 2026-08-25: the "£X would work" nearest-yes suggestion
    # used to live only in the grey facts list _compose_facts built (now
    # deleted along with that list). It was genuinely useful, so it moves
    # into what_ifs as LLM grounding instead of disappearing — this pins
    # that it actually reaches the system prompt whenever the resolved
    # verdict is a shortfall, on a state that is NOT "short" (so this goes
    # through the general LLM path, not the fully-deterministic
    # card-funded/bills-shortfall short-circuit tested above).
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    # £250 against £161 free -> free_after_spend = -89 -> derived_verdict
    # "no", state stays "comfortable" (not "short"), so this reaches the
    # general LLM path, not the deterministic short-circuit.
    body = {"question": "Can I spend £250 until payday?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == "£250 would take you −£89"
    assert result["facts"] == []
    system_prompt = captured["messages"][0]["content"]
    assert '"nearest_yes_amount": 160' in system_prompt


def test_can_i_non_headroom_question_while_short_still_reaches_llm(monkeypatch):
    # The narrower fix's own regression guard, coordinator-requested
    # 2026-08-25: a no-amount question with NO headroom intent ("is my
    # spending normal?") must NOT be hijacked by the payday-status template
    # just because the user happens to be short right now — that reply
    # ("Nothing spare until payday, it's gone on cards") is a non-sequitur
    # for this question. It must still reach the free-form LLM and get a
    # real answer. Proven the same way as the amount-bearing test above,
    # inverted: the httpx.AsyncClient boundary IS reached.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -188.94, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "is my spending normal?"}
    try:
        asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
        raised = False
    except AssertionError as e:
        raised = "httpx.AsyncClient should not be constructed" in str(e)
    assert raised, "non-headroom question while short should still reach the LLM boundary, not the payday-status template"


def test_can_i_suggestions_context_line_negative_safe_to_spend(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -12.0, "days_until_payday": 2,
            "next_payday": "2026-08-28", "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)
    result = asyncio.run(can_i_suggestions(user={"email": "kevin"}))
    assert result["context_line"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    assert "-£" not in result["context_line"] and "−£" not in result["context_line"]
    # Tight/negative-headroom branch — reassurance chips only, never a
    # spend-suggesting chip (pre-existing gate, unaffected by this fix).
    assert result["chips"]


# ── Penny page-awareness (owner testing, 2026-08-25) ──────────────────────
# `screen` is an optional, validated ENUM the frontend sets from its own tab
# router (see `_valid_screen`'s own comment for why that lets it inform
# routing deterministically, unlike the free-text `context` field). Three
# things this section pins: (1) the page-explainer matcher fires on
# questions ABOUT the current screen and nothing else, (2) two screen-gated
# domain-routing boosts (debt deixis, spend "placing" vocabulary) only fire
# with the matching screen, and (3) everything that worked before this
# feature (`screen` absent) is completely unaffected.

def test_valid_screen_accepts_known_values_only():
    assert _valid_screen("debt") == "debt"
    assert _valid_screen("insights") == "insights"
    assert _valid_screen("not-a-real-screen") is None
    assert _valid_screen(None) is None
    assert _valid_screen(123) is None  # wrong type, not just wrong value


def test_page_explainer_matcher_hits_the_owner_tested_phrasings():
    assert _is_page_explainer_question("What are these insights") is True
    assert _is_page_explainer_question("what is this page") is True


def test_page_explainer_matcher_misses_a_real_insights_question():
    # "What insights do you have about my spending?" carries the noun
    # ("insights") but no deictic pointing at the CURRENT screen — it is a
    # real question about the user's own spending, not a question about the
    # page itself, so the conservative matcher must not claim it.
    assert _is_page_explainer_question(
        "what insights do you have about my spending"
    ) is False


def test_page_explainer_miss_falls_through_to_general_llm_path():
    # Where a page-explainer MISS actually goes (per the brief): "insights"
    # has no domain of its own (grow/insights are explicitly out of scope
    # for _route_domain, see that function's module comment) and is not one
    # of _SPEND_TIER1_RE's retrospective-pace phrasings, so this reaches
    # neither a domain handler nor the out-of-scope refusal (the bare
    # "spending" word is a _SCOPE_KEYWORDS hit) — it lands on the general
    # affordability LLM path, unrouted and unexplained, same as it would
    # have before this feature existed.
    q = "what insights do you have about my spending"
    amount = _extract_amount(q)
    assert _route_domain(q, amount, [], "insights") is None
    assert _is_out_of_scope(q, amount, []) is False


def test_debt_payoff_deixis_requires_the_debt_screen():
    # The owner's exact tested phrasing: "this" names no subject at all, so
    # only the SCREEN can resolve what it refers to (see _DEBT_DEICTIC_RE's
    # own comment) — the phrase must not be screen-independently debt-shaped.
    q = "How long do you think it will take to pay this off"
    amount = _extract_amount(q)
    assert amount is None
    assert _route_domain(q, amount, [], "debt") == "debt"
    assert _route_domain(q, amount, [], None) is None
    assert _route_domain(q, amount, [], "spend") is None  # wrong screen, no boost
    # Where the screen=None case actually goes: bare "pay" is a
    # _SCOPE_KEYWORDS hit (substring containment), so this is judged IN
    # scope and falls through to the general affordability LLM path rather
    # than being refused outright — an unrouted, ungrounded answer, but not
    # a false refusal either.
    assert _is_out_of_scope(q, amount, []) is False


def test_debt_payoff_screen_independent_phrasings_need_no_screen():
    # Bare "pay off"/"paid off" name no OTHER plausible subject in this
    # app (there is nothing else you "pay off"), so these stay
    # screen-independent tier-1 debt phrasings — unlike the bare-pronoun
    # "pay this/it/them off" shape pinned above.
    assert _route_domain("pay off my cards", None, [], None) == "debt"
    assert _route_domain("have I paid off anything this month", None, [], None) == "debt"
    assert _route_domain("when will I be debt-free", None, [], None) == "debt"


def test_spend_placing_vocabulary_requires_the_spend_screen():
    q = "What other payments need placing"
    amount = _extract_amount(q)
    assert amount is None
    assert _route_domain(q, amount, [], "spend") == "spend"
    assert _route_domain(q, amount, [], None) is None
    assert _route_domain(q, amount, [], "debt") is None  # wrong screen, no boost


# ── /can-i wiring — full request/response shape for the two new
# deterministic, no-LLM, no-quota page-explainer replies, plus the
# screen-gated spend "placing" domain route reaching the LLM with the
# unresolved-money grounding the brief asks for. ───────────────────────────

def test_can_i_page_explainer_insights_with_screen(monkeypatch):
    _patch_can_i_common(monkeypatch)
    body = {"question": "What are these insights", "screen": "insights"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "insights"
    assert result["headline"] is None
    assert result["facts"] == []
    assert result["out_of_scope"] is False
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_can_i_page_explainer_debt_with_screen(monkeypatch):
    _patch_can_i_common(monkeypatch)
    body = {"question": "what is this page", "screen": "debt"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "debt"
    assert result["headline"] is None


def test_can_i_page_explainer_ignored_without_a_known_screen(monkeypatch):
    # No/unknown screen -> "fall through to existing behaviour": "what is
    # this page" carries no £ amount, no domain vocabulary and no scope
    # keyword of its own, so — exactly as it would have before `screen`
    # existed — it hits the pre-existing out-of-scope refusal, never the new
    # fixed explainer reply and never the LLM boundary either.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "what is this page"}  # no screen at all
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is False
    assert result["out_of_scope"] is True


def test_can_i_out_of_scope_reply_appends_screen_hint_only_when_known(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "what's the weather like today", "screen": "home"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True
    assert result["reply"].endswith(can_i_module._OUT_OF_SCOPE_SCREEN_HINT)

    body_no_screen = {"question": "what's the weather like today"}
    result_no_screen = asyncio.run(can_i_module.can_i(body_no_screen, {"email": "kevin"}))
    assert result_no_screen["out_of_scope"] is True
    assert not result_no_screen["reply"].endswith(can_i_module._OUT_OF_SCOPE_SCREEN_HINT)


def test_can_i_spend_placing_question_routes_and_grounds_unresolved(monkeypatch):
    # Full wiring for the spend "placing" screen boost: routes to the SPEND
    # domain only because screen="spend", and the LLM grounding carries the
    # engine's own unresolved-money summary (verdict["unresolved"] from
    # build_unresolved, spend_verdict.py) so the model can actually name the
    # single largest still-placing payment — never invent others.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_verdict(uid, offset=0):
        return {
            "state": "normal",
            "reading": "You're under usual pace.",
            "notables": [],
            "unresolved_material": True,
            "unresolved_total": 42.5,
            "unresolved": {
                "total": 42.5,
                "payments_count": 3,
                "largest": {
                    "id": "abc123",
                    "display_name": "Wise",
                    "raw_description": "WISE *8827 TRANSFER",
                    "amount": 30.0,
                    "date": "2026-08-20",
                    "account_id": "acc1",
                },
            },
        }

    import app.services.spend_verdict as spend_verdict_module
    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    body = {"question": "What other payments need placing", "screen": "spend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert '"unresolved_payments_count": 3' in system_prompt
    assert '"unresolved_total": 42.5' in system_prompt
    assert "Wise" in system_prompt
    assert "Asked from the spend screen." in system_prompt
    assert result["explainer"] is False
    assert result["out_of_scope"] is False


def test_can_i_screen_line_reaches_affordability_and_domain_prompts(monkeypatch):
    # "Asked from the <screen> screen." — cheap deixis grounding — must reach
    # BOTH the general affordability prompt and a domain-handler prompt
    # whenever `screen` is known, and must be absent when it is not.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £20 this weekend?", "screen": "home"}
    asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    system_prompt = captured["messages"][0]["content"]
    assert "Asked from the home screen." in system_prompt

    captured.clear()
    body_no_screen = {"question": "Can I spend £20 this weekend?"}
    asyncio.run(can_i_module.can_i(body_no_screen, {"email": "kevin"}))
    system_prompt_no_screen = captured["messages"][0]["content"]
    assert "Asked from the" not in system_prompt_no_screen


# ── _handle_debt_domain — cold-cache "no debt" trust bug + 0%-interest
# invention (owner-reported, 2026-08-24: right after a wealth-api restart,
# this handler told a user carrying £23,588 in real card debt "No card debt
# on file", then answered correctly minutes later; a separate reply also
# claimed interest was "adding to what you owe" for a user whose cards are
# ALL on 0% deals). ─────────────────────────────────────────────────────────

class _StubCursor:
    def __init__(self, items):
        self._items = items

    async def to_list(self, n):
        return self._items


class _StubAccountsCol:
    """accounts_col stand-in for the debt-domain zero-debt recheck."""
    def __init__(self, accounts):
        self._accounts = accounts

    def find(self, *args, **kwargs):
        return _StubCursor(self._accounts)


class _RaisingAccountsCol:
    """accounts_col stand-in that proves the recheck was never reached."""
    def find(self, *args, **kwargs):
        raise AssertionError("accounts_col.find should not be called on this path")


def test_handle_debt_domain_not_ready_status_never_says_no_debt(monkeypatch):
    # Forward guard: even though compute_debt_plan today only ever stamps
    # "ok" (there is no "building"/"insufficient" value yet), a plan
    # reporting anything else, with zeroed-out totals exactly as a cold/
    # not-yet-real compute would look, must NEVER be read as "no debt".
    async def fake_view(uid):
        return {"status": "building", "totals": {"debt": 0}}

    monkeypatch.setattr(debt_narration_module, "get_debt_plan_view", fake_view)
    monkeypatch.setattr(can_i_module, "accounts_col", _RaisingAccountsCol())

    result = asyncio.run(_handle_debt_domain("kevin", "how's my card debt doing?", []))
    assert result["headline"] == "Couldn't work that out"
    assert result["reply"] == "Couldn't look at your cards just now, try again in a moment."
    assert "No card debt on file" != result["headline"]


def test_handle_debt_domain_ready_status_genuine_zero_debt_still_says_no_debt(monkeypatch):
    # The recheck must not become a new false negative: a genuinely ready
    # plan with debt below MATERIAL_BALANCE, confirmed by a fresh accounts_col
    # read showing no material card balance, must still produce the plain
    # "no debt" reply.
    async def fake_view(uid):
        return {"status": "ok", "totals": {"debt": 0}}

    monkeypatch.setattr(debt_narration_module, "get_debt_plan_view", fake_view)
    monkeypatch.setattr(
        can_i_module,
        "accounts_col",
        _StubAccountsCol([
            {"account_type": "credit_card", "balance": 0.0},
            {"account_type": "current", "balance": 1500.0},
        ]),
    )

    result = asyncio.run(_handle_debt_domain("kevin", "how's my card debt doing?", []))
    assert result["headline"] == "No card debt on file"
    assert result["reply"] == "You're not carrying any material credit card debt right now."


def test_handle_debt_domain_ready_status_but_recheck_finds_real_debt_is_graceful(monkeypatch):
    # The actual incident: plan-level totals say zero, but the real accounts
    # collection disagrees (the cold-cache/restart scenario) -- must serve
    # the graceful reply, never "No card debt on file".
    async def fake_view(uid):
        return {"status": "ok", "totals": {"debt": 0}}

    monkeypatch.setattr(debt_narration_module, "get_debt_plan_view", fake_view)
    monkeypatch.setattr(
        can_i_module,
        "accounts_col",
        _StubAccountsCol([
            {"account_type": "credit_card", "balance": -23588.0},
        ]),
    )

    result = asyncio.run(_handle_debt_domain("kevin", "how's my card debt doing?", []))
    assert result["headline"] == "Couldn't work that out"
    assert result["reply"] == "Couldn't look at your cards just now, try again in a moment."


def test_handle_debt_domain_zero_pct_cards_grounding_states_explicit_zero_interest(monkeypatch):
    # Bug 2: monthly_interest_now must always reach the model, 0 explicit,
    # and the potential (conditional, "if the 0% deals ended") figure must be
    # present and clearly labelled -- never omitted, never presented as a
    # current cost.
    async def fake_view(uid):
        return {
            "status": "ok",
            "totals": {
                "debt": 500.0,
                "monthly_interest_now": 0,
                "potential_monthly_interest": 12.5,
                "debt_free_month": None,
                "verdict": "drifting",
                "buckets": {"float_total": 0, "carried_total": 500.0},
            },
        }

    monkeypatch.setattr(debt_narration_module, "get_debt_plan_view", fake_view)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    captured = {}

    async def fake_phrasing(system_prompt, question, history):
        captured["system_prompt"] = system_prompt
        return "HEADLINE: x\nREPLY: y"

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)

    result = asyncio.run(_handle_debt_domain("kevin", "is interest adding to my cards?", []))

    system_prompt = captured["system_prompt"]
    # Parse the embedded FACTS JSON rather than substring-matching the raw
    # prompt text: json.dumps escapes non-ASCII (£ -> £) by default, so a
    # literal "£" substring check would never match the prompt as sent.
    import json as _json
    grounding = _json.loads(system_prompt.split("FACTS: ", 1)[1])
    assert grounding["monthly_interest_now"] == 0
    assert grounding["potential_monthly_interest_if_0pct_ended"] == 12.5
    zero_interest_fact = grounding["grounding"][1]
    assert zero_interest_fact.startswith("No interest is currently being charged")
    assert "though if those deals ended it would cost about £12 a month" in zero_interest_fact
    # Server-side resolved verdict still wins the headline, as it always has.
    assert result["headline"] == _DEBT_VERDICT_HEADLINES["drifting"]


# ── Per-screen vocabulary fallback (owner feedback, 2026-08-25) ─────────────
# Owner: "it's still restrictive, I thought the restriction was just the
# page that we were on" — on a page, any question in that page's financial
# territory should route to that page's domain engine, never the out-of-
# scope refusal. `_route_domain`'s own pre-listed phrasings only unlock a
# handful of structural shapes; this fallback widens that to a plain
# per-screen vocabulary, consulted as a last resort (see
# `_screen_vocabulary_route`'s own module comment in can_i.py).

def test_screen_vocabulary_route_pure_function_per_screen():
    # debt: "owe"/"reduce" both hit, no screen or wrong screen: no match.
    assert _screen_vocabulary_route("What can I do to reduce what I owe", "debt") == "debt"
    assert _screen_vocabulary_route("What can I do to reduce what I owe", None) is None
    assert _screen_vocabulary_route("What can I do to reduce what I owe", "spend") is None
    # 0% handled as a plain substring, not folded into the shared \b group.
    assert _screen_vocabulary_route("what about 0%", "debt") == "debt"
    # spend
    assert _screen_vocabulary_route("why is my spending so high", "spend") == "spend"
    assert _screen_vocabulary_route("why is my spending so high", "debt") is None
    # planning — "coming up" is the page-explainer's own phrasing for
    # "upcoming", must match too.
    assert _screen_vocabulary_route("what's coming up", "planning") == "planning"
    assert _screen_vocabulary_route("what's coming up", "spend") is None
    # home/grow soften, they never route to a domain.
    assert _screen_vocabulary_route("do I have enough money", "home") == "soften"
    assert _screen_vocabulary_route("should I be topping up my buffer", "grow") == "soften"
    # insights now has a real domain handler (owner-reported gap: "What is
    # the best insight" got a refusal from the general LLM, which has no
    # insights grounding) — a vocabulary hit routes there, not to "soften".
    assert _screen_vocabulary_route("what do these insights mean", "insights") == "insights"
    assert _screen_vocabulary_route("what is the best insight", "insights") == "insights"
    assert _screen_vocabulary_route("what is the best insight", None) is None
    assert _screen_vocabulary_route("what is the best insight", "debt") is None
    # genuinely non-financial question: no vocabulary hit on any screen.
    assert _screen_vocabulary_route("What is the meaning of life?", "debt") is None
    assert _screen_vocabulary_route("What is the meaning of life?", "spend") is None
    assert _screen_vocabulary_route("What is the meaning of life?", "planning") is None
    # unknown/"other" screen: always None regardless of wording.
    assert _screen_vocabulary_route("why is my spending so high", "other") is None
    assert _screen_vocabulary_route("why is my spending so high", "not-a-real-screen") is None


def test_can_i_debt_screen_vocabulary_routes_to_debt_domain(monkeypatch):
    # Full /can-i wiring: stub the domain handler itself (proven-elsewhere
    # engine wiring, e.g. test_handle_debt_domain_* above, is not what this
    # test is pinning) so this only asserts ROUTING, not the debt handler's
    # own behaviour.
    _patch_can_i_common(monkeypatch)

    async def stub_debt_domain(uid, question, history, context="", screen=None):
        return {"marker": "debt-domain", "screen_seen": screen, "question_seen": question}

    monkeypatch.setattr(can_i_module, "_handle_debt_domain", stub_debt_domain)

    body = {"question": "What can I do to reduce what I owe", "screen": "debt"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["marker"] == "debt-domain"
    assert result["screen_seen"] == "debt"


def test_can_i_debt_phrasing_without_screen_is_not_debt_domain(monkeypatch):
    # Same question, no screen context at all: the engine has no signal
    # this is a debt question — it carries no domain-tier phrasing
    # (_route_domain misses it) and no _SCOPE_KEYWORDS/category hit either,
    # so it lands on the out-of-scope refusal, not the debt domain and not
    # an unrouted LLM guess. Reported here (rather than silently assumed)
    # per the brief's "report where it goes" instruction.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    def raise_if_called(*a, **kw):
        raise AssertionError("debt domain must not be reached without screen context")

    monkeypatch.setattr(can_i_module, "_handle_debt_domain", raise_if_called)

    body = {"question": "What can I do to reduce what I owe"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


def test_can_i_spend_screen_vocabulary_routes_to_spend_domain(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def stub_spend_domain(uid, question, history, context="", screen=None, category_names=None):
        return {"marker": "spend-domain", "screen_seen": screen}

    monkeypatch.setattr(can_i_module, "_handle_spend_domain", stub_spend_domain)

    body = {"question": "why is my spending so high", "screen": "spend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["marker"] == "spend-domain"
    assert result["screen_seen"] == "spend"


def test_can_i_planning_screen_vocabulary_routes_to_planning_domain(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def stub_planning_domain(uid, question, history, active_goals, context="", screen=None):
        return {"marker": "planning-domain", "screen_seen": screen}

    monkeypatch.setattr(can_i_module, "_handle_planning_domain", stub_planning_domain)

    body = {"question": "what's coming up", "screen": "planning"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["marker"] == "planning-domain"
    assert result["screen_seen"] == "planning"


def test_can_i_non_financial_question_still_refused_on_debt_screen(monkeypatch):
    # The refusal must still fire for genuinely non-financial questions on
    # every screen — the vocabulary fallback widens what counts as IN scope,
    # it must never widen scope to "anything asked on this page".
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    def raise_if_called(*a, **kw):
        raise AssertionError("no domain handler should be reached for a non-financial question")

    monkeypatch.setattr(can_i_module, "_handle_debt_domain", raise_if_called)

    body = {"question": "What is the meaning of life?", "screen": "debt"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


def test_can_i_amount_bearing_question_unaffected_by_screen_vocabulary_fallback(monkeypatch):
    # "Can I spend £45 this weekend?" carries an extracted amount, so the
    # amount_asked is None guard keeps the new fallback from ever running,
    # on ANY screen — this must reach the ordinary affordability LLM path,
    # completely unchanged, exactly as it always has.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    for screen in (None, "debt", "spend", "planning", "home", "grow", "insights", "other"):
        body = {"question": "Can I spend £45 this weekend?"}
        if screen:
            body["screen"] = screen
        try:
            asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
            raised = False
        except AssertionError as e:
            raised = "httpx.AsyncClient should not be constructed" in str(e)
        assert raised, f"amount-bearing question should still reach the LLM boundary for screen={screen}"


def test_debt_system_template_carries_the_mechanics_not_prescription_guardrail():
    # Debt counselling is regulated; the debt-screen vocabulary fallback
    # above now lets a "what can I do about my debt" question reach this
    # prompt, so it must never be allowed to prescribe an action.
    assert "never prescribe a specific action, product, balance" in _DEBT_SYSTEM_TEMPLATE
    assert "the balance falls only when more is cleared each month" in _DEBT_SYSTEM_TEMPLATE


# ── Insights domain (owner-reported gap, 2026-08-25) ────────────────────────
# "What is the best insight" on the Insights screen used to route past the
# deterministic gate via the old screen-vocabulary "soften" path, land on the
# general affordability LLM, which has no idea what the user's insights even
# are, and get refused. `_handle_insights_domain` grounds this in the SAME
# ranked list GET /savings-insights itself serves; these tests pin the
# routing wiring and the handler's own read/rank/fallback behaviour.

class _StubInsightsCol:
    """savings_insights_col stand-in for the insights-domain read."""
    def __init__(self, docs):
        self._docs = docs

    def find(self, *args, **kwargs):
        return _StubCursor(self._docs)


class _RaisingInsightsCol:
    """savings_insights_col stand-in that proves a read failure gets the
    graceful reply, never the confidently-wrong "no insights" one."""
    def find(self, *args, **kwargs):
        raise RuntimeError("no real Mongo access in this test")


def test_can_i_best_insight_with_insights_screen_routes_to_insights_domain(monkeypatch):
    # Full /can-i wiring: stub the domain handler itself (proven-elsewhere
    # engine wiring, e.g. the direct _handle_insights_domain tests below, is
    # not what this test is pinning) so this only asserts ROUTING.
    _patch_can_i_common(monkeypatch)

    async def stub_insights_domain(uid, question, history, context="", screen=None):
        return {"marker": "insights-domain", "screen_seen": screen}

    monkeypatch.setattr(can_i_module, "_handle_insights_domain", stub_insights_domain)

    body = {"question": "What is the best insight", "screen": "insights"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["marker"] == "insights-domain"
    assert result["screen_seen"] == "insights"


def test_can_i_best_insight_without_screen_is_not_insights_domain(monkeypatch):
    # Same question, no screen context: the engine has no signal this is an
    # insights question at all ("insight"/"best" carry no _SCOPE_KEYWORDS/
    # category hit and _route_domain has no insights tier), so it must never
    # reach the insights domain. Reported here per the brief's "report where
    # it goes" instruction: it lands on the out-of-scope refusal.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    def raise_if_called(*a, **kw):
        raise AssertionError("insights domain must not be reached without screen context")

    monkeypatch.setattr(can_i_module, "_handle_insights_domain", raise_if_called)

    body = {"question": "What is the best insight"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


def test_handle_insights_domain_headline_is_top_ranked_title_and_grounding_preserves_rank(monkeypatch):
    # Three insights, ranked by the SAME tie-break GET /savings-insights uses
    # (pinned, then verified, then parsed £ estimate, then triggering
    # spend): "Pinned One" wins on pinned alone, ahead of a bigger estimate.
    docs = [
        {
            "title": "Switch broadband, save more", "body": "A bigger number.",
            "savings_estimate": "~£40/mo", "pinned": False, "verified_savings": None,
            "triggered_by": [],
        },
        {
            "title": "Pinned One", "body": "Pinned takes priority.",
            "savings_estimate": "~£5/mo", "pinned": True, "verified_savings": None,
            "triggered_by": [],
        },
        {
            "title": "Third insight", "body": "Smallest.",
            "savings_estimate": None, "pinned": False, "verified_savings": None,
            "triggered_by": [],
        },
    ]
    monkeypatch.setattr(can_i_module, "savings_insights_col", _StubInsightsCol(docs))
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    captured = {}

    async def fake_phrasing(system_prompt, question, history):
        captured["system_prompt"] = system_prompt
        return "HEADLINE: x\nREPLY: y"

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)

    result = asyncio.run(_handle_insights_domain("kevin", "What is the best insight", []))

    # Server-side resolved verdict wins the headline, same belt-and-braces
    # mechanism every other domain handler uses.
    assert result["headline"] == "Pinned One"

    import json as _json
    grounding = _json.loads(captured["system_prompt"].split("FACTS: ", 1)[1])
    assert grounding["top_rank"] == 1
    assert grounding["resolved_verdict"] == "Pinned One"
    ranked = grounding["insights"]
    assert [r["rank"] for r in ranked] == [1, 2, 3]
    assert ranked[0]["title"] == "Pinned One"
    assert ranked[0]["estimated_saving"] == "~£5/mo"
    assert ranked[1]["title"] == "Switch broadband, save more"
    assert ranked[2]["title"] == "Third insight"
    assert ranked[2]["estimated_saving"] is None


def test_handle_insights_domain_empty_successful_read_is_no_insights_short_circuit(monkeypatch):
    monkeypatch.setattr(can_i_module, "savings_insights_col", _StubInsightsCol([]))
    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _RaisingAsyncClient)

    result = asyncio.run(_handle_insights_domain("kevin", "What is the best insight", []))
    assert result["headline"] == "No insights right now"
    assert result["out_of_scope"] is False


def test_handle_insights_domain_read_failure_is_graceful_not_no_insights(monkeypatch):
    # Absence-assertion doctrine (same as the debt domain's zero-debt
    # recheck): "no insights" may only be asserted after a SUCCESSFUL read
    # that genuinely came back empty. A raising read must get the graceful
    # "couldn't look" reply, never the confidently-wrong "no insights" one.
    monkeypatch.setattr(can_i_module, "savings_insights_col", _RaisingInsightsCol())
    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _RaisingAsyncClient)

    result = asyncio.run(_handle_insights_domain("kevin", "What is the best insight", []))
    assert result["headline"] == "Couldn't work that out"
    assert result["reply"] == "Couldn't look at your insights just now, try again in a moment."
    assert result["headline"] != "No insights right now"


def test_handle_insights_domain_phrasing_failure_falls_back_to_engine_content(monkeypatch):
    docs = [{
        "title": "Switch broadband, save more", "body": "You pay a lot for broadband.",
        "savings_estimate": "~£15/mo", "pinned": False, "verified_savings": None,
        "triggered_by": [],
    }]
    monkeypatch.setattr(can_i_module, "savings_insights_col", _StubInsightsCol(docs))

    async def raise_call(*a, **kw):
        raise can_i_module.HTTPException(500, "AI unavailable")

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", raise_call)

    called = {"increment": False}

    async def fake_increment(uid):
        called["increment"] = True

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", fake_increment)

    result = asyncio.run(_handle_insights_domain("kevin", "What is the best insight", []))
    assert result["headline"] == "Switch broadband, save more"
    assert "Switch broadband, save more" in result["reply"]
    assert called["increment"] is False


# ── Categorisation explainer + ISA capability + accounts screen
# (2026-08-26 owner report: two rejected questions tonight, "How should I
# categorise the transactions" on Spend and "how can I add an ISA" on
# Accounts) ──────────────────────────────────────────────────────────────

def test_can_i_categorise_transactions_question_hits_categorisation_explainer(monkeypatch):
    # The owner's exact reported phrasing, asked with no screen at all —
    # engine-general, must not require being on the Spend screen.
    _patch_can_i_common(monkeypatch)
    body = {"question": "How should I categorise the transactions"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "categories"
    assert result["headline"] is None
    assert result["facts"] == []
    assert result["out_of_scope"] is False
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_can_i_how_do_categories_work_hits_categorisation_explainer(monkeypatch):
    _patch_can_i_common(monkeypatch)
    body = {"question": "how do categories work", "screen": "spend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "categories"


def test_can_i_add_isa_question_hits_isa_capability_not_tax(monkeypatch):
    _patch_can_i_common(monkeypatch)
    body = {"question": "how can I add an ISA", "screen": "accounts"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "accounts"
    assert "tax" not in result["reply"].lower()
    assert "open banking" in result["reply"].lower()
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_pension_carry_forward_question_is_still_tax_regression():
    # Regression: the new ISA-capability/categorisation short-circuits must
    # not steal a genuine tax question.
    q = "How does pension carry-forward work?"
    amount = _extract_amount(q)
    assert _is_isa_capability_question(q, amount) is False
    assert _is_categorisation_explainer_question(q, amount) is False
    assert _is_tax_question(q, amount) is True


def test_put_50_toward_isa_question_is_still_affordability_regression():
    # Regression: a priced ISA contribution question must stay on the
    # affordability path, not be reclassified as the ISA capability answer
    # or a tax question.
    q = "Can I put £50 toward my ISA?"
    amount = _extract_amount(q)
    assert amount == 50.0
    assert _is_isa_capability_question(q, amount) is False
    assert _is_tax_question(q, amount) is False
    assert _is_categorisation_explainer_question(q, amount) is False


def test_can_i_accounts_page_explainer(monkeypatch):
    _patch_can_i_common(monkeypatch)
    body = {"question": "what is this page", "screen": "accounts"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["explainer"] is True
    assert result["topic"] == "accounts"
    assert result["headline"] is None
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_can_i_categorised_wrong_on_spend_screen_routes_to_spend_domain(monkeypatch):
    # "why is Netflix categorised wrong" is NOT the categorisation-explainer
    # shape (no "how should I"/"how do categories work"/"why is THIS
    # categorised as" deictic) — it names a specific merchant and reports it
    # as wrong, which is the Spend domain's own miscategorised-adjacent
    # territory. Actual routing: falls through every explainer/domain-tier-1
    # gate, then lands on the per-screen vocabulary fallback, where the
    # fixed `categor\w*` stem now matches "categorised" and routes to the
    # Spend domain handler (previously this vocabulary list missed the word
    # entirely and the question was refused as out of scope).
    _patch_can_i_common(monkeypatch)

    async def stub_spend_domain(uid, question, history, context="", screen=None, category_names=None):
        return {"marker": "spend-domain", "screen_seen": screen}

    monkeypatch.setattr(can_i_module, "_handle_spend_domain", stub_spend_domain)

    body = {"question": "why is Netflix categorised wrong", "screen": "spend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["marker"] == "spend-domain"
    assert result["screen_seen"] == "spend"


def test_categorisation_explainer_matcher_pure_function():
    assert _is_categorisation_explainer_question("How should I categorise the transactions", None) is True
    assert _is_categorisation_explainer_question("how do categories work", None) is True
    assert _is_categorisation_explainer_question("how are transactions classified", None) is True
    assert _is_categorisation_explainer_question("why is this categorised as spending", None) is True
    # A priced question is never this explainer, regardless of wording.
    assert _is_categorisation_explainer_question("how should I categorise this £50", 50.0) is False
    # Naming a specific merchant, not asking how the system works in general.
    assert _is_categorisation_explainer_question("why is Netflix categorised wrong", None) is False


def test_isa_capability_matcher_pure_function():
    assert _is_isa_capability_question("how can I add an ISA", None) is True
    assert _is_isa_capability_question("can I track my ISA here", None) is True
    assert _is_isa_capability_question("can I connect my isa", None) is True
    # word-boundary protection: must not fire on "visa" (isa glued inside it).
    assert _is_isa_capability_question("is my visa going to arrive", None) is False
    # A priced contribution question is never this capability answer.
    assert _is_isa_capability_question("Can I put £50 toward my ISA?", 50.0) is False


def test_accounts_screen_is_a_known_screen():
    assert _valid_screen("accounts") == "accounts"


def test_accounts_screen_vocabulary_softens_not_routes():
    assert _screen_vocabulary_route("what accounts do I have", "accounts") == "soften"
    assert _screen_vocabulary_route("can I connect my bank", "accounts") == "soften"
    assert _screen_vocabulary_route("tell me about my isa", "accounts") == "soften"
    assert _screen_vocabulary_route("what's the weather like", "accounts") is None


# ── Owner bug, 2026-08-26: "Does a trip to Japan in 2027 seem feasible" got
# "£2,027 would take you −£2,239" — _extract_amount parsed the bare YEAR 2027
# as an amount, routing a future-horizon feasibility question into the
# immediate this-pay-period delta path. Two fixes: (1) a bare, non-£ number
# in a time context ("in 2027", "by 2030", ...) is a year, not money; (2) the
# multi-month savings-pace fact pack a named month already gets is extended
# to year-shaped horizons too, so the amount-less question still gets an
# honest envelope instead of nothing at all. ───────────────────────────────

def test_extract_amount_bare_year_in_time_context_is_not_money():
    # The exact owner-reported sentence: no £ sign anywhere, "2027" sits
    # right after "in", an unambiguous time-context word.
    assert _extract_amount("Does a trip to Japan in 2027 seem feasible") is None
    # Other time-context prepositions get the same treatment.
    assert _extract_amount("Can I get this sorted by 2030?") is None
    assert _extract_amount("I want this cleared until 2026") is None
    assert _extract_amount("I'd like this done before 2028") is None


def test_extract_amount_explicit_currency_sign_always_wins():
    # An explicit £ sign is a deliberate, unambiguous money signal and wins
    # outright even though 2027 is also a plausible year.
    assert _extract_amount("can I spend £2,027") == 2027.0


def test_extract_amount_bare_year_shaped_number_with_explicit_money_intent_still_extracts():
    # No time-context word directly in front of the number, but the
    # question carries explicit money-intent vocabulary elsewhere ("spend")
    # -- the pre-existing bare-number money case this extractor has always
    # supported must keep working.
    assert _extract_amount("can I spend 2027 this month") == 2027.0
    assert _extract_amount("can I spend 2000 this month") == 2000.0


def test_extract_amount_bare_year_shaped_number_with_no_money_intent_is_ambiguous():
    # No £, no time-context word directly before it, and no money-intent
    # word anywhere either -- genuinely ambiguous. Conservative default:
    # do not extract, per this function's own "prefer NOT extracting" rule.
    assert _extract_amount("my mortgage started in 2027 sometime") is None
    assert _extract_amount("2027 was a good year") is None


def test_extract_amount_typo_and_unit_rejection_unaffected_by_year_fix():
    # Pre-existing rejection rules (digit run glued to a trailing letter)
    # must be entirely unaffected by the £-sign/year-context rework above.
    assert _extract_amount("can I spend £2OO") is None  # typo, letter O not zero
    assert _extract_amount("I'm on the 3rd of the month") is None  # ordinal
    assert _extract_amount("that's about 50p") is None  # unit
    assert _extract_amount("wake me at 10am") is None  # unit
    # Ordinary priced questions are untouched.
    assert _extract_amount("Can I spend £45 this weekend?") == 45.0
    assert _extract_amount("Can I put £50 toward my ISA?") == 50.0


def test_extract_horizon_year_recognises_time_context_years_and_next_year():
    today = date(2026, 8, 26)
    assert _extract_horizon_year("Does a trip to Japan in 2027 seem feasible", today) == 2027
    assert _extract_horizon_year("Can I afford this by 2030?", today) == 2030
    assert _extract_horizon_year("I want this sorted by next year", today) == 2027
    # No year-shaped time phrase at all -> no horizon.
    assert _extract_horizon_year("Can I spend £45 this weekend?", today) is None


def test_months_until_horizon_year_anchors_on_january_conservatively():
    today = date(2026, 8, 26)
    # August 2026 -> January 2027 is 5 months: the earliest, most
    # conservative reading of a bare "2027" with no month named.
    assert _months_until_horizon_year(2027, today) == 5
    # A year whose January has already passed has no honest positive figure.
    assert _months_until_horizon_year(2026, today) <= 0


def test_can_i_japan_2027_gets_horizon_envelope_not_delta_headline(monkeypatch):
    # Full /can-i wiring: with the year-exclusion fix, this question is
    # amount-less, so it must reach the general LLM path with a genuine
    # horizon fact (months_until_target/savable_by_target, populated from
    # the bare year "2027" the same way a named month already populates
    # them), never the old comically-wrong £-delta headline, and never a
    # bare out-of-scope refusal either ("trip" is a _SCOPE_KEYWORDS hit).
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        # income, spending, surplus -- a demonstrated £300/month savings pace.
        return (3000.0, 2700.0, 300.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {
                "choices": [{"message": {"content": (
                    "HEADLINE: What would the trip cost?\n"
                    "REPLY: At your recent pace you could have about ~£1,500 "
                    "aside by then, what would the trip cost?"
                )}}]
            }

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    body = {"question": "Does a trip to Japan in 2027 seem feasible"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    facts = json.loads(system_prompt[system_prompt.index("FACTS: ") + len("FACTS: "):])

    # No amount was ever extracted -- the old bug's precondition is gone.
    assert "amount_asked" not in facts["what_ifs"]
    assert "resolved_verdict" not in facts

    today = date.today()
    expected_months = _months_until_horizon_year(2027, today)
    assert expected_months > 0
    expected_savable = round(300.0 * expected_months)
    assert facts["what_ifs"]["months_until_target"] == expected_months
    assert facts["what_ifs"]["savable_by_target"] == expected_savable

    # The new envelope-and-ask instruction actually reached the prompt.
    assert "aside by then" in system_prompt
    assert "future-horizon question with a this-pay-period delta" in system_prompt

    # The response shape: no delta headline (structurally impossible now,
    # since resolved_headline is None whenever no amount was extracted), no
    # bare out-of-scope refusal, and the reply/headline is about the horizon
    # envelope and the trip's cost, exactly as the new prompt instructs.
    assert result["out_of_scope"] is False
    assert result["facts"] == []
    assert "would take you" not in result["headline"]
    assert result["headline"] not in ("That fits", "That doesn't fit")
    assert "cost" in result["headline"].lower() or "cost" in result["reply"].lower()
    assert "aside by then" in result["reply"]


# ── Owner bug, 2026-08-26 (round 2): "A 2000£ trip to Japan in October
# 2027" got offered "Set this up: £1,000/period" — an honest slice of £2,000
# over the ~14 months to October 2027 is roughly £140-150/period, so the
# offer builder was clearly working off a ~2-period horizon instead. Root
# cause: the month-detection block found "october" as a bare substring of
# the question and fed it alone to `_months_until_target`, which always
# resolves to the NEXT occurrence of that month within 12 months (October
# 2026, ~2 months away) — it has no way to see the trailing "2027" at all,
# and the pre-existing bare-year fallback (`_extract_horizon_year`) never
# even ran, because it is only consulted when NO month name is found in the
# question, and "October 2027" contains one. Fix: `_extract_month_year` +
# `_months_until_month_year`, checked BEFORE both the bare-month and
# bare-year paths, so an explicit month+year pairing always wins. ─────────

def test_extract_month_year_parses_the_pairing():
    assert _extract_month_year("A trip to Japan in October 2027") == ("october", 2027)
    assert _extract_month_year("October of 2027") == ("october", 2027)


def test_extract_month_year_none_without_a_year_attached():
    # A bare month name with no year at all must not be claimed here — it
    # stays on the pre-existing bare-month path untouched (see the
    # "bare 'by October' still behaves as before" test below).
    assert _extract_month_year("Can I save for the October trip?") is None


def test_extract_month_year_rejects_out_of_range_year():
    # Same plausible-year range every other horizon check in this file
    # uses — "October 1899" is not a real horizon target.
    assert _extract_month_year("October 1899") is None


def test_months_until_month_year_exact_count_not_next_occurrence():
    today = date(2026, 8, 26)
    # The actual bug fix: October 2027 is exactly 14 months from August
    # 2026, not the ~2 months `_months_until_target("october", today)` alone
    # would give by assuming the NEXT October.
    assert _months_until_month_year("october", 2027, today) == 14
    from app.routers.can_i import _months_until_target as _bare_month_fn
    assert _bare_month_fn("october", today) == 2  # the wrong horizon the bug used


def test_months_until_month_year_past_pairing_is_non_positive():
    today = date(2026, 8, 26)
    # A month/year pair already behind "today" has no honest positive
    # figure — same convention as `_months_until_horizon_year`, left to the
    # caller's positive-only guard.
    assert _months_until_month_year("january", 2026, today) <= 0


def test_can_i_month_and_year_offer_per_period_matches_real_horizon(monkeypatch):
    # Full /can-i wiring for the owner's exact reported sentence. £2,000
    # over the true ~14-month horizon to October 2027 must produce a
    # per_period offer near £140-150, never the wrong £1,000 a ~2-month
    # horizon would produce.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        # income, spending, surplus -- a demonstrated £300/month savings pace.
        return (3000.0, 2700.0, 300.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    body = {"question": "A 2000£ trip to Japan in October 2027"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    facts = json.loads(system_prompt[system_prompt.index("FACTS: ") + len("FACTS: "):])

    today = date.today()
    expected_months = _months_until_month_year("october", 2027, today)
    assert expected_months > 0
    assert facts["what_ifs"]["months_until_target"] == expected_months
    assert facts["what_ifs"]["amount_asked"] == 2000.0

    assert "offer" in result
    offer = result["offer"]
    assert offer["amount"] == 2000.0
    assert offer["target_date"] == "2027-10-01"
    # The actual deterministic per_period formula (can_i.py's offer-building
    # block): ceil(amount / months / 5) * 5. Pinned via that same formula so
    # this test tracks the real code, not a hand-guessed number, while the
    # explicit range assertion below is the owner's own sanity check.
    import math as _math
    expected_per_period = int(_math.ceil(2000.0 / max(1, expected_months) / 5) * 5)
    assert offer["per_period"] == expected_per_period
    assert 140 <= offer["per_period"] <= 150, offer["per_period"]
    assert offer["per_period"] != 1000  # the exact wrong figure the owner saw


def test_can_i_bare_by_october_behaves_as_before(monkeypatch):
    # Regression: a bare month with NO year attached must be completely
    # unaffected by the month+year fix — it stays on the pre-existing
    # bare-month path, resolving to the NEXT occurrence of that month
    # (report: this is "the next October", not a full year out).
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        return (3000.0, 2700.0, 300.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    body = {"question": "Can I save £2000 for the October trip?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    facts = json.loads(system_prompt[system_prompt.index("FACTS: ") + len("FACTS: "):])

    today = date.today()
    from app.routers.can_i import _months_until_target as _bare_month_fn
    expected_months = _bare_month_fn("october", today)
    assert facts["what_ifs"]["months_until_target"] == expected_months
    # Report: with no year attached, this still resolves to the NEXT
    # October (at most 12 months away), exactly as it always has -- this is
    # the pre-existing, unfixed (and, for a genuinely near-term "October",
    # correct) behaviour this bug report left untouched on purpose.
    assert 1 <= expected_months <= 12
    assert "offer" in result
    assert result["offer"]["target_date"][5:7] == "10"


# ── Bug 2, owner-reported: a big one-off spend question with no timeframe
# ("Would I be able to afford a trip for 2000£") answered against only the
# CURRENT pay period and never asked when the trip actually is, forcing the
# owner to restate the whole question. Fix is prompt-only (the deterministic
# delta headline is unchanged): when the amount is large relative to the
# current free envelope, the subject reads as one-off-purchase shaped, and
# no timeframe/horizon was parsed at all, the model is told to give the
# brief now-answer AND ask when it's for, in the same reply. ───────────────

def test_is_big_one_off_with_no_horizon_true_for_the_turn_one_shape():
    wi = {"amount_asked": 2000.0}
    assert _is_big_one_off_with_no_horizon(
        "Would I be able to afford a trip for 2000£", wi, 161.0
    ) is True


def test_is_big_one_off_with_no_horizon_false_when_small_relative_to_envelope():
    wi = {"amount_asked": 20.0}
    assert _is_big_one_off_with_no_horizon(
        "Would I be able to afford a trip for £20", wi, 161.0
    ) is False


def test_is_big_one_off_with_no_horizon_false_when_a_timeframe_was_parsed():
    # A real future-horizon question already gets the proper multi-month
    # treatment elsewhere -- this gate must never ALSO fire for it.
    wi = {"amount_asked": 2000.0, "months_until_target": 14, "savable_by_target": 4200}
    assert _is_big_one_off_with_no_horizon(
        "A 2000£ trip to Japan in October 2027", wi, 161.0
    ) is False


def test_is_big_one_off_with_no_horizon_false_for_non_one_off_subject():
    # Conservative subject list: a big sofa purchase is not a "trip/holiday/
    # flight/tickets/wedding/car" shaped one-off, so this must not fire.
    wi = {"amount_asked": 2000.0}
    assert _is_big_one_off_with_no_horizon(
        "Can I afford a £2000 sofa", wi, 161.0
    ) is False


def test_is_big_one_off_with_no_horizon_false_when_no_amount():
    assert _is_big_one_off_with_no_horizon("Can I afford a trip?", {}, 161.0) is False


def test_is_big_one_off_with_no_horizon_true_when_envelope_already_short():
    # safe_to_spend at or below zero: no positive envelope left to take a
    # fraction of, so any further one-off ask counts as large by definition.
    wi = {"amount_asked": 50.0}
    assert _is_big_one_off_with_no_horizon("Can I afford a car?", wi, -20.0) is True


def test_build_ask_when_block_is_a_noop_when_gate_is_false():
    assert _build_ask_when_block(False) == ""
    assert _build_ask_when_block(True) == _ASK_WHEN_INSTRUCTION


def test_can_i_turn_one_trip_question_reaches_llm_with_ask_when_instruction(monkeypatch):
    # The owner's exact turn-1 phrasing. The deterministic delta headline
    # must still fire unchanged (Bug 1/2 are independent fixes), but the
    # system prompt sent to the model must now also carry the ask-when
    # instruction so the reply invites the missing timeframe instead of
    # ending the conversation on a same-period answer alone.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Would I be able to afford a trip for 2000£"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert _ASK_WHEN_INSTRUCTION in system_prompt

    # The deterministic delta headline is untouched by this fix.
    expected_headline = _whatif_delta_line(2000.0, round(161.0 - 2000.0))
    assert result["headline"] == expected_headline


def test_can_i_45_this_weekend_delta_unchanged_no_ask_when(monkeypatch):
    # Regression: an ordinary small, non-one-off amount must never trip the
    # new ask-when gate -- the prompt and the deterministic headline are
    # both completely unaffected by this fix.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £45 this weekend?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert _ASK_WHEN_INSTRUCTION not in system_prompt
    assert result["headline"] == _whatif_delta_line(45.0, round(161.0 - 45.0))


# ── Bug 3, owner-reported: follow-up acknowledgment. History is already
# sent (last 6 turns); when the current question refines a previous one
# (same amount or subject, new detail added, e.g. a date), the model should
# briefly acknowledge the refinement instead of answering as if unrelated.
# One prompt instruction line -- pinned here on the affordability system
# prompt text itself (a full multi-turn LLM-authored-reply assertion would
# require a real model call, which this suite never makes). ───────────────

def test_affordability_prompt_carries_the_followup_acknowledgment_instruction(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {
        "question": "A 2000£ trip to Japan in October 2027",
        "history": [
            {"role": "user", "content": "Would I be able to afford a trip for 2000£"},
            {"role": "assistant", "content": "£2,000 would take you −£1,839"},
        ],
    }
    asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert "refines a question" in system_prompt
    assert "briefly acknowledge the refinement" in system_prompt

    # The history itself must still reach the model as separate messages,
    # unchanged by this fix (the acknowledgment is the model's job, not a
    # server-side rewrite of the conversation).
    assert captured["messages"][1]["content"] == "Would I be able to afford a trip for 2000£"
    assert captured["messages"][2]["content"] == "£2,000 would take you −£1,839"


# ── Round 2 residuals (coordinator live-verification, 2026-08-26) ──────────
# 1. The ask-when prompt instruction alone was not reliably acted on by the
#    live model: "Would I be able to afford a trip for 2000£" got the
#    correct deterministic delta headline but a REPLY that answered the
#    now-question only, never asking when the trip was. Fixed with a
#    deterministic server-side suffix (`_append_ask_when_suffix`), same
#    append-after-parsing doctrine as `resolved_headline` overriding the
#    model's own HEADLINE guess.
# 2. The known-amount + known-horizon case ("A £2,000 trip to Japan in
#    October 2027") was closing with the model asking for the cost/target
#    it already had, because the envelope-and-ask prompt instruction (meant
#    for the NO-amount horizon case) had no amount_asked guard. Fixed in
#    the prompt: the ask-for-cost instruction is now scoped to
#    "AND what_ifs.amount_asked is ABSENT", and a new explicit branch tells
#    the model never to ask for cost/target again once amount_asked is
#    known, closing instead with what_ifs.per_period_needed (the same
#    figure the offer chip already shows).

def test_append_ask_when_suffix_noop_when_gate_false():
    assert _append_ask_when_suffix("Bills are covered.", False) == "Bills are covered."


def test_append_ask_when_suffix_appends_when_reply_has_no_when_question():
    reply = "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    result = _append_ask_when_suffix(reply, True)
    assert result.startswith(reply)
    assert result.endswith(_ASK_WHEN_SUFFIX)
    # A full stop is inserted before the suffix when the reply had none.
    assert result == f"{reply}. {_ASK_WHEN_SUFFIX}"


def test_append_ask_when_suffix_no_double_punctuation_when_reply_already_ends_a_sentence():
    reply = "Bills are covered, nothing spare right now."
    result = _append_ask_when_suffix(reply, True)
    assert result == f"{reply} {_ASK_WHEN_SUFFIX}"


def test_append_ask_when_suffix_skips_when_reply_already_asks_when():
    # Defensive dedupe: a model that DID comply must never get a second
    # when-question glued on.
    reply = "That's a big one right now, when is the trip actually happening?"
    assert _append_ask_when_suffix(reply, True) == reply


def test_append_ask_when_suffix_bare_when_without_question_mark_still_gets_suffix():
    # A bare "when" with no question mark nearby is not a real when-question
    # (could be an unrelated use of the word) -- the suffix must still land.
    reply = "This is fine for now, whenever you like."
    result = _append_ask_when_suffix(reply, True)
    assert result.endswith(_ASK_WHEN_SUFFIX)


def test_append_ask_when_suffix_empty_reply_returns_bare_suffix():
    assert _append_ask_when_suffix("", True) == _ASK_WHEN_SUFFIX


def test_can_i_big_one_off_reply_always_carries_ask_when_even_if_model_omits_it(monkeypatch):
    # Full /can-i wiring, live-verification regression: the mocked LLM reply
    # deliberately omits any when-question (reproducing the exact failure
    # the coordinator observed) -- the deterministic suffix must still land
    # in the final user-facing reply regardless.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {
                "content": (
                    "HEADLINE: x\n"
                    "REPLY: Bills are covered, but nothing spare until payday, "
                    "it's gone on cards"
                )
            }}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Would I be able to afford a trip for 2000£"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["reply"].endswith(_ASK_WHEN_SUFFIX)


def test_can_i_big_one_off_no_double_append_when_model_already_asked_when(monkeypatch):
    # Same shape, but this time the mocked LLM reply already asks a
    # when-shaped question of its own -- the deterministic suffix must not
    # be glued on a second time.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    compliant_reply = "Bills are covered for now, when is the trip actually happening?"

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {
                "content": f"HEADLINE: x\nREPLY: {compliant_reply}"
            }}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Would I be able to afford a trip for 2000£"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["reply"] == compliant_reply
    assert _ASK_WHEN_SUFFIX not in result["reply"]


def test_can_i_45_weekend_no_ask_when_suffix_regression(monkeypatch):
    # Regression: the gate must not fire for an ordinary small, non-one-off
    # amount, so the deterministic suffix must never be appended here either
    # (the prompt-level regression is already pinned separately above).
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £45 this weekend?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert _ASK_WHEN_SUFFIX not in result["reply"]
    assert result["reply"] == "y"


# ── Residual 2: known-amount + known-horizon must never ask for the cost
# it already has, and must close with the per-period figure instead. ───────

def test_prompt_known_amount_horizon_branch_forbids_asking_for_cost_again(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        return (3000.0, 2700.0, 300.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": (
                "HEADLINE: x\n"
                "REPLY: Putting aside about £145 a period would get there."
            )}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    body = {"question": "A 2000£ trip to Japan in October 2027"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    facts = json.loads(system_prompt[system_prompt.index("FACTS: ") + len("FACTS: "):])

    # per_period_needed reaches the LLM grounding, matching the offer chip's
    # own already-computed figure exactly.
    assert "per_period_needed" in facts["what_ifs"]
    assert facts["what_ifs"]["per_period_needed"] == result["offer"]["per_period"]
    assert 140 <= facts["what_ifs"]["per_period_needed"] <= 150

    # The prompt now explicitly forbids re-asking for cost/target once the
    # amount is known, and points at per_period_needed instead.
    assert "NEVER ask for the cost, the price, or a savings target again" in system_prompt
    assert "per_period_needed" in system_prompt
    # The no-amount ask-for-cost instruction must be explicitly scoped away
    # from this case.
    assert "AND what_ifs.amount_asked is ABSENT" in system_prompt


def test_can_i_japan_2027_no_amount_still_asks_for_cost_unaffected(monkeypatch):
    # Regression: the pre-existing NO-amount horizon case (yesterday's
    # Japan-2027 fix) must be completely unaffected by narrowing the
    # ask-for-cost instruction to amount_asked being absent -- it already
    # satisfies that narrowed condition, so its own behaviour is unchanged.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        return (3000.0, 2700.0, 300.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {
                "choices": [{"message": {"content": (
                    "HEADLINE: What would the trip cost?\n"
                    "REPLY: At your recent pace you could have about ~£1,500 "
                    "aside by then, what would the trip cost?"
                )}}]
            }

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    body = {"question": "Does a trip to Japan in 2027 seem feasible"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    facts = json.loads(system_prompt[system_prompt.index("FACTS: ") + len("FACTS: "):])
    assert "amount_asked" not in facts["what_ifs"]
    assert "per_period_needed" not in facts["what_ifs"]
    assert "offer" not in result
    assert "aside by then" in result["reply"]


# ── Round 3 residual (coordinator live-verification after restart,
# 2026-08-26): the deterministic shortfall short path (owner's own parallel
# commit fa33db7, "deterministic shortfall replies, no LLM on the short
# path") returns its own fixed reply and NEVER reaches the LLM call or the
# `_append_ask_when_suffix` wiring on that path -- so an undated big one-off
# asked while already short (free <= 0, the common case right now) skipped
# the ask-when suffix entirely, even though the fix for the LLM path itself
# was correct. `_patch_can_i_common` here proves the LLM is never touched
# (httpx.AsyncClient raises if constructed), so these tests pin the fully
# deterministic short-path reply, suffix included.

def test_can_i_short_path_big_one_off_gets_ask_when_suffix(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -212.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Would I be able to afford a trip for 2000£"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["headline"] == _whatif_delta_line(2000.0, round(-212.0 - 2000.0))
    assert result["reply"].startswith(
        "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    )
    assert result["reply"].endswith(_ASK_WHEN_SUFFIX)


def test_can_i_short_path_45_this_weekend_no_ask_when_suffix(monkeypatch):
    # Same short path, same fixed reply text, but "£45 this weekend" is
    # neither one-off-shaped nor large relative to the (already short)
    # envelope's subject vocabulary -- the coordinator's explicit regression
    # check: this must NOT get the suffix.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -212.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "short",
            "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £45 this weekend?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["reply"] == "Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"
    assert _ASK_WHEN_SUFFIX not in result["reply"]


# ── Follow-up route inheritance — owner-reported systemic bug ───────────────
# "if I'm responding to a message surely I should get a response." Every
# deterministic gate in this file reads ONLY the current question text; a
# pure anaphoric follow-up ("why doesn't it fit", "why not", "what do you
# mean") carries no routable vocabulary of its own by construction, so it
# always failed every gate and hit the out-of-scope refusal, no matter how
# good any individual gate's word list got. The fix: at the exact point the
# CURRENT question is about to be refused, check whether it is shaped like a
# follow-up (`_is_followup_question`) and, if so, re-resolve the PREVIOUS
# user turn through the same `_resolve_deterministic_route` and answer using
# whatever that route resolves to, phrased for the current wording.

def test_is_followup_question_owner_reported_shapes_all_match():
    history = [{"role": "user", "content": "A 2000£ trip to Japan in October 2027"}]
    assert can_i_module._is_followup_question("Why doesn't it fit", history) is True
    assert can_i_module._is_followup_question("why not", history) is True
    assert can_i_module._is_followup_question("what do you mean", history) is True
    assert can_i_module._is_followup_question("how so", history) is True
    assert can_i_module._is_followup_question("and if I wait?", history) is True


def test_is_followup_question_requires_a_prior_user_turn():
    # Empty history, and an all-assistant history (should never happen in
    # practice, but no user turn at all either way): never a follow-up, no
    # matter how the question is shaped.
    assert can_i_module._is_followup_question("Why doesn't it fit", []) is False
    assert can_i_module._is_followup_question(
        "Why doesn't it fit", [{"role": "assistant", "content": "That doesn't fit"}]
    ) is False


def test_is_followup_question_meaning_of_life_does_not_pass():
    # The brief's own explicit check: a genuinely new, self-contained,
    # wh-shaped question must NOT be treated as a follow-up just because it
    # starts with "what" and history happens to be non-empty. This is 6
    # words -- longer than every real follow-up shape the owner has hit (all
    # 2-4 words) -- which is exactly why the word cap is tightened to 5
    # rather than left at the brief's own suggested ~8-10.
    history = [{"role": "user", "content": "Can I spend £45 this weekend?"}]
    assert can_i_module._is_followup_question("What is the meaning of life?", history) is False


def test_is_followup_question_long_question_never_matches_even_with_anaphor():
    # Long AND carries "it" -- still not short enough to count.
    history = [{"role": "user", "content": "Can I spend £45 this weekend?"}]
    q = "Is it definitely true that this will always be the case for me"
    assert can_i_module._is_followup_question(q, history) is False


def test_last_user_question_returns_most_recent_user_turn():
    history = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
        {"role": "user", "content": "second question"},
        {"role": "assistant", "content": "second answer"},
    ]
    assert can_i_module._last_user_question(history) == "second question"
    assert can_i_module._last_user_question([]) is None


def test_resolve_deterministic_route_pure_function_sanity():
    # A handful of direct sanity checks on the extracted resolver, pinning
    # the exact tag vocabulary the inheritance dispatcher below switches on.
    assert can_i_module._resolve_deterministic_route("How can I add an ISA", None, [], None) == "isa_capability"
    assert can_i_module._resolve_deterministic_route("What is my tax code", None, [], None) == "tax"
    assert can_i_module._resolve_deterministic_route("How am I doing on my debt?", None, [], None) == "debt"
    assert can_i_module._resolve_deterministic_route("Can I spend £45 this weekend?", 45.0, [], None) == "affordability"
    assert can_i_module._resolve_deterministic_route("What is the meaning of life?", None, [], None) is None


def test_can_i_followup_inherits_multimonth_grounding(monkeypatch):
    # The flagship owner-reported failure: Penny answered "That doesn't fit"
    # (the £2000-Japan-Oct-2027 multimonth verdict), the owner replied "Why
    # doesn't it fit", and got the out-of-scope refusal -- "Why doesn't it
    # fit" carries no £ figure, no month/year, no scope keyword of its own.
    # The fix must re-derive the SAME multimonth grounding the original
    # question produced (amount, months_until_target, savable_by_target,
    # per_period_needed, monthly_surplus) and hand it to the LLM to answer
    # the "why", never refuse it a second time.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        # A flat, undemonstrated pace (surplus 0) -- deliberately the "recent
        # pace is negative/zero" case the brief's own worked example names.
        return (2000.0, 2000.0, 0.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    captured = {}

    async def fake_phrasing(system_prompt, question, history):
        captured["system_prompt"] = system_prompt
        captured["question"] = question
        return "HEADLINE: That doesn't fit\nREPLY: Recent pace has nothing spare to put toward it."

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)

    body = {
        "question": "Why doesn't it fit",
        "history": [
            {"role": "user", "content": "A 2000£ trip to Japan in October 2027"},
            {"role": "assistant", "content": "That doesn't fit"},
        ],
    }
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is False
    # The LLM is asked to answer the CURRENT wording, not re-answer the
    # original question -- the whole point of inheriting the ROUTE without
    # replaying the same question.
    assert captured["question"] == "Why doesn't it fit"

    grounding = json.loads(captured["system_prompt"].split("FACTS: ", 1)[1])
    what_ifs = grounding["what_ifs"]
    assert "months_until_target" in what_ifs
    assert "savable_by_target" in what_ifs
    assert "per_period_needed" in what_ifs
    assert what_ifs["amount_asked"] == 2000.0
    assert grounding["monthly_surplus"] == 0.0
    assert grounding["previous_question"] == "A 2000£ trip to Japan in October 2027"


def test_can_i_followup_inherits_simple_affordability(monkeypatch):
    # "why not" after "Can I spend £45 this weekend?" -- a single-period
    # affordability follow-up, not a multi-month one. Must inherit the £45
    # what-if, never refuse.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 30.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "tight",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    async def fake_region(uid):
        return "UK"

    async def fake_cashflow(uid, region, cutoff):
        return (2000.0, 1900.0, 100.0)

    monkeypatch.setattr(can_i_module, "get_user_region", fake_region)
    monkeypatch.setattr(can_i_module, "_cashflow", fake_cashflow)

    captured = {}

    async def fake_phrasing(system_prompt, question, history):
        captured["system_prompt"] = system_prompt
        return "HEADLINE: x\nREPLY: y"

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)

    body = {
        "question": "why not",
        "history": [
            {"role": "user", "content": "Can I spend £45 this weekend?"},
            {"role": "assistant", "content": "£45 would take you −£15"},
        ],
    }
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is False
    grounding = json.loads(captured["system_prompt"].split("FACTS: ", 1)[1])
    assert grounding["what_ifs"]["amount_asked"] == 45.0
    assert grounding["what_ifs"]["free_after_spend"] == round(30.0 - 45.0)
    # A shortfall carries the nearest-yes suggestion, same as the original
    # (non-inherited) path.
    assert "nearest_yes_amount" in grounding["what_ifs"]


def test_can_i_followup_inherits_debt_domain(monkeypatch):
    # "what do you mean" after "How am I doing on my debt?" (screen=debt) --
    # must route to the DEBT domain handler for the follow-up wording, never
    # refuse. Stubs the domain handler itself (its own engine wiring is
    # covered elsewhere, e.g. test_handle_debt_domain_*) so this only pins
    # ROUTING.
    _patch_can_i_common(monkeypatch)

    captured = {}

    async def stub_debt_domain(uid, question, history, context="", screen=None):
        captured["question"] = question
        captured["screen"] = screen
        return {
            "reply": "debt reply", "headline": "debt headline", "facts": [],
            "explainer": False, "topic": None, "out_of_scope": False,
        }

    monkeypatch.setattr(can_i_module, "_handle_debt_domain", stub_debt_domain)

    body = {
        "question": "what do you mean",
        "screen": "debt",
        "history": [
            {"role": "user", "content": "How am I doing on my debt?"},
            {"role": "assistant", "content": "Growing, not clearing"},
        ],
    }
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is False
    assert result["reply"] == "debt reply"
    # The CURRENT wording reaches the debt handler as the human turn, not
    # the original question replayed.
    assert captured["question"] == "what do you mean"
    assert captured["screen"] == "debt"


def test_can_i_followup_empty_history_refused_as_today(monkeypatch):
    # No history at all -- `_is_followup_question` can never fire (no prior
    # user turn to follow up on), so this must refuse exactly as it always
    # has, regardless of how follow-up-shaped the question looks.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Why doesn't it fit"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


def test_can_i_followup_meaning_of_life_still_refused(monkeypatch):
    # Not follow-up shaped (too long, no anaphor) -- must still refuse even
    # with a real, in-scope prior turn sitting right there in history.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {
        "question": "What is the meaning of life?",
        "history": [
            {"role": "user", "content": "Can I spend £45 this weekend?"},
            {"role": "assistant", "content": "£45 leaves £55 free"},
        ],
    }
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


# ── Owner's live failure, 2026-08-26: "How much was my golf spend in the
# last 3 months" got "£3 would take you −£215" -- _extract_amount's
# bare-number rule read the "3" out of "last 3 months" as a £3 spend ask,
# and the delta arithmetic did the rest. Two fixes: (1) a bare number glued
# to a time unit ("3 months") or a time-scoping word ("last 3") is a WINDOW
# SIZE, never money; (2) "how much was my X spend in the last N months" is
# answered as a real, deterministic database SUM (no LLM, no quota), not an
# affordability verdict. ──────────────────────────────────────────────────

def test_extract_amount_time_glued_bare_number_is_not_money():
    # The exact owner-reported sentence: no amount at all now extracts.
    assert can_i_module._extract_amount(
        "How much was my golf spend in the last 3 months"
    ) is None
    # Explicit £ still always wins, anywhere in the question.
    assert can_i_module._extract_amount("£3 coffee") == 3.0
    # A legit bare-number money ask alongside a glued time-window number in
    # the SAME sentence: only the money one is picked, the window number is
    # skipped.
    assert can_i_module._extract_amount("spend 50 in the next 2 weeks") == 50.0
    # Pre-existing bare-number money cases (no glued time unit/scope word)
    # are entirely unaffected by this fix.
    assert can_i_module._extract_amount("can I spend 2000 this month") == 2000.0
    assert can_i_module._extract_amount("Can I spend £45 this weekend?") == 45.0


def test_extract_amount_time_glued_rule_handles_other_units_and_scope_words():
    assert can_i_module._extract_amount("how much have I spent in the past 2 weeks") is None
    assert can_i_module._extract_amount("what did I spend in the last 6 months") is None
    assert can_i_module._extract_amount("anything due in the next 5 days") is None
    # A bare number NOT glued to a time unit/scope word is untouched by this
    # rule (still governed by the pre-existing year-range/money-intent logic).
    assert can_i_module._extract_amount("can I afford 30 this week") == 30.0


def test_extract_history_window_shapes():
    today = date(2026, 8, 26)
    assert can_i_module._extract_history_window(
        "How much was my golf spend in the last 3 months", today
    ) == (90, "the last 3 months")
    assert can_i_module._extract_history_window(
        "what did I spend since March", today
    ) == ((today - date(2026, 3, 1)).days, "since March")
    assert can_i_module._extract_history_window(
        "how much on takeaways this year", today
    ) == ((today - date(2026, 1, 1)).days, "this year")
    assert can_i_module._extract_history_window(
        "how much did I spend last month", today
    ) == (30, "the last month")
    # No window phrase at all.
    assert can_i_module._extract_history_window("can I afford a coffee", today) is None


def test_is_category_spend_history_question_requires_shape_window_and_category():
    q = "How much was my golf spend in the last 3 months"
    assert can_i_module._is_category_spend_history_question(q, None, ["Golf", "Groceries"]) is True
    # No matching category name -- never invented, falls through unclaimed.
    assert can_i_module._is_category_spend_history_question(q, None, ["Groceries"]) is False
    # No window phrase -- this is the existing SPEND_TIER1 retrospective
    # (this-period-only) path instead, not the history lookup.
    assert can_i_module._is_category_spend_history_question(
        "how much did I spend on golf", None, ["Golf"]
    ) is False
    # A priced question never takes this deterministic path.
    assert can_i_module._is_category_spend_history_question(q, 50.0, ["Golf"]) is False


def test_resolve_deterministic_route_category_spend_history_beats_spend_vocab():
    # Placement: checked right after tax, before the SPEND domain vocab --
    # a history lookup is the more specific question whenever both would
    # otherwise match the same sentence.
    q = "How much was my golf spend in the last 3 months"
    assert can_i_module._resolve_deterministic_route(
        q, None, [], None, ["Golf"]
    ) == "category_spend_history"
    # No matching category -- falls through to the ordinary pipeline
    # (this sentence still carries "spend", so it lands on "affordability",
    # never a refusal).
    assert can_i_module._resolve_deterministic_route(
        q, None, [], None, ["Groceries"]
    ) == "affordability"


class _HistoryCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


def _history_mongo_matches(doc, query):
    for key, cond in query.items():
        if key == "date":
            d = doc.get("date")
            if "$gte" in cond and d < cond["$gte"]:
                return False
            if "$lte" in cond and d > cond["$lte"]:
                return False
        elif doc.get(key) != cond:
            return False
    return True


class _HistoryCol:
    """Stand-in for `transactions_col`/`yapily_transactions_col`: enough of
    Motor's `.find()` (sync call returning an async-iterable cursor) to
    drive `_handle_category_spend_history`'s query against real documents,
    and it records every query dict passed in so the filter SHAPE itself
    can be pinned, not just the summed result."""

    def __init__(self, docs):
        self._docs = docs
        self.queries = []

    def find(self, query, *args, **kwargs):
        self.queries.append(query)
        return _HistoryCursor([d for d in self._docs if _history_mongo_matches(d, query)])


class _RaisingHistoryCol:
    def find(self, *args, **kwargs):
        raise RuntimeError("boom")


def test_handle_category_spend_history_sums_debits_only(monkeypatch):
    from datetime import datetime as _dt, timedelta as _td

    today = date.today()
    in_window = _dt(today.year, today.month, today.day)
    docs = [
        {"user_id": "kevin", "transaction_type": "debit", "category": "Golf", "amount": 40.0, "date": in_window},
        {"user_id": "kevin", "transaction_type": "debit", "category": "Golf", "amount": 66.0, "date": in_window},
        # custom_category override wins over the stored `category`.
        {
            "user_id": "kevin", "transaction_type": "debit", "category": "Other",
            "custom_category": "Golf", "amount": 30.0, "date": in_window,
        },
        # A credit (refund) row on Golf -- doctrine says sum ONLY debits, so
        # this must never be added in, however it's categorised.
        {"user_id": "kevin", "transaction_type": "credit", "category": "Golf", "amount": 999.0, "date": in_window},
        # A different user's Golf spend -- must never leak into this total.
        {"user_id": "someone-else", "transaction_type": "debit", "category": "Golf", "amount": 500.0, "date": in_window},
        # A different category -- ignored.
        {"user_id": "kevin", "transaction_type": "debit", "category": "Groceries", "amount": 20.0, "date": in_window},
    ]
    col = _HistoryCol(docs)
    empty_col = _HistoryCol([])
    monkeypatch.setattr(can_i_module, "transactions_col", col)
    monkeypatch.setattr(can_i_module, "yapily_transactions_col", empty_col)

    result = asyncio.run(can_i_module._handle_category_spend_history(
        "kevin", "How much was my golf spend in the last 3 months", ["Golf", "Groceries"],
    ))

    # 40 + 66 + 30 = 136, only the three "kevin"/"debit"/"Golf" rows.
    assert result["headline"] == "£136 on Golf in the last 3 months"
    assert "£45 a month" in result["reply"]
    assert "3 payments" in result["reply"]
    assert result["facts"] == []
    assert result["out_of_scope"] is False

    # Pin the exact query filter shape: user-scoped, debit-only, bounded to
    # the parsed rolling window -- both collections queried identically.
    expected_start = today - _td(days=90)
    expected_start_dt = _dt(expected_start.year, expected_start.month, expected_start.day)
    expected_end_dt = _dt(today.year, today.month, today.day, 23, 59, 59)
    expected_query = {
        "user_id": "kevin",
        "transaction_type": "debit",
        "date": {"$gte": expected_start_dt, "$lte": expected_end_dt},
    }
    assert col.queries == [expected_query]
    assert empty_col.queries == [expected_query]


def test_handle_category_spend_history_zero_matches_is_honest_absence(monkeypatch):
    monkeypatch.setattr(can_i_module, "transactions_col", _HistoryCol([]))
    monkeypatch.setattr(can_i_module, "yapily_transactions_col", _HistoryCol([]))

    result = asyncio.run(can_i_module._handle_category_spend_history(
        "kevin", "How much did I spend on Golf in the last 3 months", ["Golf"],
    ))

    assert result["headline"] == "Nothing recorded on Golf in the last 3 months"
    assert "No Golf transactions turned up" in result["reply"]
    assert result["out_of_scope"] is False


def test_handle_category_spend_history_failed_query_is_graceful(monkeypatch):
    monkeypatch.setattr(can_i_module, "transactions_col", _RaisingHistoryCol())
    monkeypatch.setattr(can_i_module, "yapily_transactions_col", _HistoryCol([]))

    result = asyncio.run(can_i_module._handle_category_spend_history(
        "kevin", "How much was my golf spend in the last 3 months", ["Golf"],
    ))

    assert result["headline"] == "Couldn't work that out"
    assert "try again in a moment" in result["reply"]
    assert result["out_of_scope"] is False


# ── Owner's SECOND live failure, an hour after the history-lookup feature
# shipped: "What did I spend on eating out in april" missed the history
# matcher entirely and landed on the current-period spend domain, which
# answered about Entertainment and apologised for not having an eating-out
# breakdown. Two matcher gaps fixed here: the rigid `_HISTORY_LOOKUP_SHAPE_
# RE` sentence template (only covered "how much did I spend on X", never
# "what did I spend on X") was replaced outright with a presence-based gate
# (`_SPEND_WORD_RE` + a resolved category + a resolved window, no shape
# requirement connecting them), and the window parser now also recognises
# "in <month>"/"during <month>"/bare "<month>" naming the MOST RECENT past
# occurrence of that calendar month, guarded against stealing a genuinely
# forward question by requiring either an explicit past-tense spend context
# or one of the original structurally-past window phrases. ──────────────────

def _mock_today(monkeypatch, today):
    """Freeze `date.today()` as observed from inside can_i.py, same pattern
    already used for exactly this purpose in test_scenario.py (`_FixedDate`
    subclassing `date`, monkeypatched over the module's own `date` name) --
    the calendar-exact month bounds below depend on which real month is
    "August" relative to, so the tests must control it rather than drift
    with whatever day this suite happens to run on."""
    class _FixedDate(date):
        @classmethod
        def today(cls):
            return today

    monkeypatch.setattr(can_i_module, "date", _FixedDate)


def test_extract_history_bounds_month_shapes_calendar_exact(monkeypatch):
    today = date(2026, 8, 26)
    _mock_today(monkeypatch, today)

    # "in april" asked in August 2026: April has already happened THIS year
    # (month_idx 4 <= today's month_idx 8), so it resolves to this year's
    # April, calendar-exact bounds, no year in the label (no year boundary
    # crossed). The label itself is the bare "April" -- same convention
    # every other window label in this file follows ("the last 3 months",
    # "since March") -- `_handle_category_spend_history`'s own "on {category}
    # in {window_label}" template is what supplies the rendered "in April".
    assert can_i_module._extract_history_bounds(
        "What did I spend on eating out in april", today
    ) == (date(2026, 4, 1), date(2026, 4, 30), "April")

    # "in october" asked in August 2026: October is still AHEAD of today in
    # the calendar (month_idx 10 > 8), so the MOST RECENT occurrence is last
    # October, not the one still to come -- and the label carries the year
    # because it crossed a year boundary.
    assert can_i_module._extract_history_bounds(
        "what did I spend on golf in october", today
    ) == (date(2025, 10, 1), date(2025, 10, 31), "October 2025")

    # "during" is the same shape as "in".
    assert can_i_module._extract_history_bounds(
        "what did I spend during october on golf", today
    ) == (date(2025, 10, 1), date(2025, 10, 31), "October 2025")

    # An explicit year pairing wins outright over the implied-year guess,
    # reusing the existing month+year parser (`_extract_month_year`).
    assert can_i_module._extract_history_bounds(
        "what did I spend on golf in april 2025", today
    ) == (date(2025, 4, 1), date(2025, 4, 30), "April 2025")

    # No window phrase at all -- unaffected.
    assert can_i_module._extract_history_bounds("can I afford a coffee", today) is None


def test_is_category_spend_history_question_presence_based_no_shape_required(monkeypatch):
    today = date(2026, 8, 26)
    _mock_today(monkeypatch, today)

    # His exact sentence: no "how much" shape at all, just "spent" + a real
    # category + a month window -- must be claimed now.
    assert can_i_module._is_category_spend_history_question(
        "What did I spend on eating out in april", None, ["Eating Out", "Groceries"]
    ) is True

    # Same sentence with no matching category -- still falls through
    # unclaimed, never invented (unchanged doctrine).
    assert can_i_module._is_category_spend_history_question(
        "What did I spend on eating out in april", None, ["Groceries"]
    ) is False

    # Yesterday's sentence, still works unchanged (regression).
    assert can_i_module._is_category_spend_history_question(
        "How much was my golf spend in the last 3 months", None, ["Golf"]
    ) is True


def test_is_category_spend_history_question_future_month_guard_blocks_forward_asks(monkeypatch):
    today = date(2026, 8, 26)
    _mock_today(monkeypatch, today)

    # "can I spend £50 in October?" -- a priced, forward affordability ask.
    # Blocked twice over: the extracted £50 fails the amount_asked guard on
    # its own, and even amount-less it carries no past-tense spend context
    # and "in October" is not one of the structurally-past window phrases.
    q = "can I spend £50 in October?"
    amount = can_i_module._extract_amount(q)
    assert amount == 50.0
    assert can_i_module._is_category_spend_history_question(q, amount, ["Golf"]) is False

    # Amount-less but still forward and tense-neutral: no "did"/"was"/
    # "spent", no structurally-past window phrase either. Must not be
    # claimed just because it names a category and a month.
    assert can_i_module._is_category_spend_history_question(
        "can I spend on Eating Out in October", None, ["Eating Out"]
    ) is False

    # The regression guard: an amount-bearing, month-and-year-named question
    # (the Japan-2027 multimonth case) never reaches this deterministic path
    # at all -- the amount_asked guard alone already rejects it.
    q_japan = "A 2000£ trip to Japan in October 2027"
    amount_japan = can_i_module._extract_amount(q_japan)
    assert amount_japan == 2000.0
    assert can_i_module._is_category_spend_history_question(q_japan, amount_japan, ["Golf"]) is False


def test_resolve_deterministic_route_history_vs_future_month_collisions(monkeypatch):
    # The full collision suite the fix was written against, all resolved
    # through the single ordered gate `can_i` itself calls.
    today = date(2026, 8, 26)
    _mock_today(monkeypatch, today)

    def route(question, category_names):
        amount = can_i_module._extract_amount(question)
        return can_i_module._resolve_deterministic_route(question, amount, [], None, category_names)

    # His exact sentence -> history, not the current-period spend domain.
    assert route("What did I spend on eating out in april", ["Eating Out"]) == "category_spend_history"

    # A different named month that crosses a year boundary -> still history.
    assert route("what did I spend on golf in october", ["Golf"]) == "category_spend_history"

    # Yesterday's sentence -> still history (regression).
    assert route("How much was my golf spend in the last 3 months", ["Golf"]) == "category_spend_history"

    # A priced, forward affordability ask naming the same month -> NOT
    # history. Falls through to the ordinary affordability path (an amount
    # was extracted, so it is never refused as out of scope either).
    assert route("can I spend £50 in October?", ["Golf"]) == "affordability"

    # The Japan-2027 multimonth regression: amount AND month-year both
    # present -> still the affordability path (which is where the existing
    # multimonth savings-pace machinery lives), never stolen by history.
    assert route("A 2000£ trip to Japan in October 2027", ["Golf"]) == "affordability"


def test_handle_category_spend_history_answers_named_past_month(monkeypatch):
    from datetime import datetime as _dt

    today = date(2026, 8, 26)
    _mock_today(monkeypatch, today)

    in_april = _dt(2026, 4, 15)
    outside_window = _dt(2026, 5, 2)  # just after April -- must not be summed
    docs = [
        {
            "user_id": "kevin", "transaction_type": "debit", "category": "Eating Out",
            "amount": 22.0, "date": in_april,
        },
        {
            "user_id": "kevin", "transaction_type": "debit", "category": "Eating Out",
            "amount": 18.0, "date": in_april,
        },
        {
            "user_id": "kevin", "transaction_type": "debit", "category": "Eating Out",
            "amount": 999.0, "date": outside_window,
        },
    ]
    col = _HistoryCol(docs)
    empty_col = _HistoryCol([])
    monkeypatch.setattr(can_i_module, "transactions_col", col)
    monkeypatch.setattr(can_i_module, "yapily_transactions_col", empty_col)

    result = asyncio.run(can_i_module._handle_category_spend_history(
        "kevin", "What did I spend on eating out in april", ["Eating Out"],
    ))

    assert result["headline"] == "£40 on Eating Out in April"
    assert "2 payments" in result["reply"]
    assert result["out_of_scope"] is False

    expected_query = {
        "user_id": "kevin",
        "transaction_type": "debit",
        "date": {
            "$gte": _dt(2026, 4, 1),
            "$lte": _dt(2026, 4, 30, 23, 59, 59),
        },
    }
    assert col.queries == [expected_query]
    assert empty_col.queries == [expected_query]


def test_can_i_followup_double_refusal_no_inheritance(monkeypatch):
    # The previous user turn ALSO resolves to nothing -- two refusals back
    # to back. Single-step lookback only: must refuse as today, never walk
    # further back through history looking for something answerable.
    _patch_can_i_common(monkeypatch)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {
        "question": "why not",
        "history": [
            {"role": "user", "content": "What is the meaning of life?"},
            {"role": "assistant", "content": "That one's outside what I can work out from your numbers."},
        ],
    }
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True


# ── Owner step-back demand, 2026-08-26: "there's no point of having this
# chat bot if every time I search for something I get this weird answer, if
# we can't answer a particular question, say that you can't as opposed to
# that generic answer." Live case: "What did I spend on golf this month"
# fell past the history matcher ("this month" is not a past window) into
# the SUBJECT-BLIND generic SPEND domain, which recited the aggregate
# verdict (Entertainment running hot) no matter what category was actually
# asked about. Two fixes below: (A) "this month"/"this period" join the
# recognised windows, answered from the engine's own per-category CURRENT-
# period data; (B) the SPEND domain itself gains a subject guard so even a
# bare "what did I spend on golf" (no window word at all) or a genuine
# near-miss ("padel", not one of this user's own categories) never falls
# back to the unrelated aggregate verdict. ───────────────────────────────

def test_is_current_period_category_question_shapes():
    # His exact sentence.
    assert can_i_module._is_current_period_category_question(
        "What did I spend on golf this month", None, ["Golf", "Groceries"]
    ) is True
    # "this period" and "so far this month" are the same phrase family.
    assert can_i_module._is_current_period_category_question(
        "how much have I spent on golf this period", None, ["Golf"]
    ) is True
    assert can_i_module._is_current_period_category_question(
        "what have I spent on golf so far this month", None, ["Golf"]
    ) is True
    # No matching category -- never invented, falls through unclaimed.
    assert can_i_module._is_current_period_category_question(
        "What did I spend on golf this month", None, ["Groceries"]
    ) is False
    # No spend word at all.
    assert can_i_module._is_current_period_category_question(
        "How's golf going this month", None, ["Golf"]
    ) is False
    # A priced question never takes this deterministic path.
    assert can_i_module._is_current_period_category_question(
        "What did I spend on golf this month", 50.0, ["Golf"]
    ) is False
    # No "this month"/"this period" phrase at all -- the bare, no-window
    # shape is the SPEND-domain subject guard's job instead, not this gate's.
    assert can_i_module._is_current_period_category_question(
        "What did I spend on golf", None, ["Golf"]
    ) is False


def test_resolve_deterministic_route_current_period_category_spend_beats_spend_vocab():
    # Same placement doctrine as the past-window history gate: checked
    # before the generic SPEND domain vocab, so it wins whenever it matches.
    q = "What did I spend on golf this month"
    assert can_i_module._resolve_deterministic_route(
        q, None, [], None, ["Golf"]
    ) == "current_period_category_spend"
    # No matching category -- falls through to the ordinary pipeline
    # ("spend" is a scope keyword, so this lands on "affordability", never a
    # refusal).
    assert can_i_module._resolve_deterministic_route(
        q, None, [], None, ["Groceries"]
    ) == "affordability"
    # A genuine PAST window still wins the history route, never this one,
    # even though both a spend word and a category are present.
    q_past = "What did I spend on golf in the last 3 months"
    assert can_i_module._resolve_deterministic_route(
        q_past, None, [], None, ["Golf"]
    ) == "category_spend_history"


def test_extract_spend_subject_phrase_shapes():
    # "on <word>" shape.
    assert can_i_module._extract_spend_subject_phrase(
        "what did I spend on padel this month"
    ) == "padel"
    # "my <word> spend(ing)" shape.
    assert can_i_module._extract_spend_subject_phrase(
        "how's my padel spend looking"
    ) == "padel"
    assert can_i_module._extract_spend_subject_phrase(
        "how's my padel spending looking"
    ) == "padel"
    # Common connector words after "on" are excluded -- never mistaken for a
    # subject named "track"/"budget"/etc.
    assert can_i_module._extract_spend_subject_phrase("am I on track this month") is None
    assert can_i_module._extract_spend_subject_phrase("am I on budget") is None
    # No "on"/"my ... spend" shape at all.
    assert can_i_module._extract_spend_subject_phrase("Am I spending more than usual?") is None
    assert can_i_module._extract_spend_subject_phrase("Where did my money go this month?") is None


def test_spend_subject_examples_clause_names_users_own_categories():
    assert can_i_module._spend_subject_examples_clause(["Golf", "Eating Out", "Groceries"]) == (
        "by category, like Golf or Eating Out, or show the period overall"
    )
    assert can_i_module._spend_subject_examples_clause(["Golf"]) == (
        "by category, like Golf, or show the period overall"
    )
    assert can_i_module._spend_subject_examples_clause([]) == (
        "by category, or show the period overall"
    )


# ── `_handle_current_period_category_spend` — same query/response shape as
# `_handle_category_spend_history`, reading from the engine's own already-
# computed per-category CURRENT-period split (spend_verdict.compute_spend_
# verdict's `notables`/`majority`), never a second, disagreeing computation.

def test_handle_current_period_category_spend_answers_named_category(monkeypatch):
    import app.services.spend_verdict as spend_verdict_module

    captured = {}

    async def fake_verdict(uid, offset=0):
        captured["uid"] = uid
        captured["offset"] = offset
        return {
            "notables": [],
            "majority": [
                {"category": "Golf", "spent": 136.0, "payments_count": 3, "has_baseline": True, "elevated": False},
            ],
        }

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    result = asyncio.run(can_i_module._handle_current_period_category_spend(
        "kevin", "What did I spend on golf this month", ["Golf", "Groceries"],
    ))

    assert result["headline"] == "£136 on Golf this period"
    assert "3 payments" in result["reply"]
    assert "this period" in result["reply"]
    assert result["facts"] == []
    assert result["out_of_scope"] is False
    # Same period the Spend page itself reads -- offset=0, current period,
    # never a prior one.
    assert captured["offset"] == 0
    assert captured["uid"] == "kevin"


def test_handle_current_period_category_spend_zero_matches_is_honest_absence(monkeypatch):
    import app.services.spend_verdict as spend_verdict_module

    async def fake_verdict(uid, offset=0):
        return {"notables": [], "majority": []}

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    result = asyncio.run(can_i_module._handle_current_period_category_spend(
        "kevin", "What did I spend on golf this month", ["Golf"],
    ))

    assert result["headline"] == "Nothing recorded on Golf this period"
    assert "No Golf transactions turned up this period" in result["reply"]
    assert result["out_of_scope"] is False


def test_handle_current_period_category_spend_failed_query_is_graceful(monkeypatch):
    import app.services.spend_verdict as spend_verdict_module

    async def raising_verdict(uid, offset=0):
        raise RuntimeError("boom")

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", raising_verdict)

    result = asyncio.run(can_i_module._handle_current_period_category_spend(
        "kevin", "What did I spend on golf this month", ["Golf"],
    ))

    assert result["headline"] == "Couldn't work that out"
    assert "try again in a moment" in result["reply"]
    assert result["out_of_scope"] is False


# ── SPEND-domain subject guard, inside `_handle_spend_domain` itself ────────

def _raising_call_penny_phrasing(monkeypatch):
    async def _raise(system_prompt, question, history):
        raise AssertionError("LLM must not be called on a deterministic subject path")

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", _raise)


def _raising_increment_usage(monkeypatch):
    async def _raise(uid):
        raise AssertionError("increment_ai_chat_usage must not be called on a deterministic path")

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _raise)


def test_handle_spend_domain_bare_category_subject_answers_from_engine_not_generic_verdict(monkeypatch):
    # No "this month"/"this period" phrase at all -- this bare shape never
    # reaches `_handle_current_period_category_spend` via routing, so the
    # guard must live INSIDE the generic SPEND domain handler itself. The
    # aggregate verdict below is about Entertainment; the question asked
    # about Golf, so the answer must be Golf's own numbers, never
    # Entertainment's.
    import app.services.spend_verdict as spend_verdict_module

    async def fake_verdict(uid, offset=0):
        return {
            "state": "normal",
            "reading": "Running about £50 ahead of usual, mostly Entertainment.",
            "notables": [
                {"category": "Entertainment", "spent": 200.0, "excess": 50.0, "payments_count": 5},
            ],
            "majority": [
                {"category": "Golf", "spent": 136.0, "payments_count": 3, "has_baseline": True, "elevated": False},
            ],
            "unresolved_material": False,
            "unresolved_total": 0,
            "unresolved": {},
        }

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)
    _raising_call_penny_phrasing(monkeypatch)
    _raising_increment_usage(monkeypatch)

    result = asyncio.run(can_i_module._handle_spend_domain(
        "kevin", "What did I spend on golf", [], category_names=["Golf", "Entertainment"],
    ))

    assert result["headline"] == "£136 on Golf this period"
    assert "3 payments" in result["reply"]
    assert "Entertainment" not in result["headline"]
    assert "Entertainment" not in result["reply"]


def test_handle_spend_domain_near_miss_subject_is_honest_miss_not_generic_verdict(monkeypatch):
    # "padel" is not one of this user's own categories -- must get the
    # honest-miss reply, never the unrelated Entertainment aggregate verdict.
    import app.services.spend_verdict as spend_verdict_module

    async def fake_verdict(uid, offset=0):
        return {
            "state": "normal",
            "reading": "Running about £50 ahead of usual, mostly Entertainment.",
            "notables": [
                {"category": "Entertainment", "spent": 200.0, "excess": 50.0, "payments_count": 5},
            ],
            "majority": [],
            "unresolved_material": False,
            "unresolved_total": 0,
            "unresolved": {},
        }

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)
    _raising_call_penny_phrasing(monkeypatch)
    _raising_increment_usage(monkeypatch)

    result = asyncio.run(can_i_module._handle_spend_domain(
        "kevin", "what did I spend on padel this month", [],
        category_names=["Golf", "Eating Out"],
    ))

    assert result["headline"] == "Can't break that down"
    assert result["reply"] == (
        "I can't split out padel specifically. I can answer by category, "
        "like Golf or Eating Out, or show the period overall."
    )
    assert "Entertainment" not in result["reply"]
    assert result["out_of_scope"] is False


def test_handle_spend_domain_pace_question_with_no_subject_is_unchanged(monkeypatch):
    # "Am I spending more than usual?" names no subject at all -- must reach
    # the existing PACE headline machinery completely unchanged, even though
    # the user has real categories on file.
    import app.services.spend_verdict as spend_verdict_module

    async def fake_verdict(uid, offset=0):
        return {
            "state": "normal",
            "reading": "Running about £50 ahead of usual, mostly Entertainment.",
            "notables": [
                {"category": "Entertainment", "spent": 200.0, "excess": 50.0, "payments_count": 5},
            ],
            "majority": [],
            "unresolved_material": False,
            "unresolved_total": 0,
            "unresolved": {},
        }

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    async def fake_phrasing(system_prompt, question, history):
        return "HEADLINE: model guess\nREPLY: some prose"

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    result = asyncio.run(can_i_module._handle_spend_domain(
        "kevin", "Am I spending more than usual?", [],
        category_names=["Golf", "Eating Out"],
    ))

    # The deterministic PACE override wins, exactly as before this fix.
    assert result["headline"] == "Over your usual pace"


def test_handle_spend_domain_breakdown_question_with_no_subject_is_unchanged(monkeypatch):
    # "Where did my money go this month?" carries the new "this month"
    # phrase but names no category subject at all -- must reach the
    # existing BREAKDOWN headline machinery completely unchanged.
    import app.services.spend_verdict as spend_verdict_module

    async def fake_verdict(uid, offset=0):
        return {
            "state": "normal",
            "reading": "Running about £50 ahead of usual, mostly Entertainment.",
            "notables": [
                {"category": "Entertainment", "spent": 200.0, "excess": 50.0, "payments_count": 5},
            ],
            "majority": [],
            "unresolved_material": False,
            "unresolved_total": 0,
            "unresolved": {},
        }

    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    async def fake_phrasing(system_prompt, question, history):
        return "HEADLINE: model guess\nREPLY: some prose"

    monkeypatch.setattr(can_i_module, "_call_penny_phrasing", fake_phrasing)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    result = asyncio.run(can_i_module._handle_spend_domain(
        "kevin", "Where did my money go this month?", [],
        category_names=["Golf", "Eating Out"],
    ))

    assert result["headline"] == "Entertainment is running hot"


# ── Shared "cannot answer" hard rule present in all five LLM handler
# prompts (grep-pinned) ─────────────────────────────────────────────────────

def test_cannot_answer_subject_rule_present_in_all_five_handler_prompts(monkeypatch):
    rule = can_i_module._CANNOT_ANSWER_SUBJECT_RULE
    assert rule in can_i_module._SPEND_SYSTEM_TEMPLATE
    assert rule in can_i_module._PLANNING_SYSTEM_TEMPLATE
    assert rule in can_i_module._DEBT_SYSTEM_TEMPLATE
    assert rule in can_i_module._INSIGHTS_SYSTEM_TEMPLATE

    # The fifth (general affordability) prompt is built inline inside
    # `can_i` at request time, not a static module-level template -- proven
    # by actually driving that path and capturing what was sent.
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())

    captured = {}

    class _SpyResponse:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "HEADLINE: x\nREPLY: y"}}]}

    class _SpyAsyncClient:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return False
        async def post(self, url, headers=None, json=None):
            captured["messages"] = json["messages"]
            return _SpyResponse()

    monkeypatch.setattr(can_i_module.httpx, "AsyncClient", _SpyAsyncClient)

    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 161.0, "safe_to_spend_cash": 161.0,
            "card_growth_reserved": 0.0, "days_until_payday": 5,
            "next_payday": "2026-08-28", "bills_total": 0.0, "state": "comfortable",
            "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "compute_safe_to_spend", fake_sts)

    body = {"question": "Can I spend £20 this weekend?"}
    asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    system_prompt = captured["messages"][0]["content"]
    assert rule in system_prompt
