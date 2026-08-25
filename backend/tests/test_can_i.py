"""Unit tests for the PURE (no-DB, no-network) seams in app.routers.can_i:
`_derive_verdict`, `_nearest_yes_amount`, `_fmt_rate`/`_per_day_line`,
`_compose_facts`, `_whatif_delta_line`, `_multimonth_fit_headline`,
`_DEBT_VERDICT_HEADLINES`, and `_is_saving_vs_investing_question`.

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
consequence fact `_compose_facts` adds), but what is now SHOWN as the
headline is either the factual what-if delta (`_whatif_delta_line`) or, for
the one amount-bearing branch with no delta, a softened factual-conditional
fallback (`_multimonth_fit_headline`). `_compose_facts` no longer echoes the
delta line as a fact underneath the headline — see the "no verdict word can
be produced" and "delta absent from facts" tests below, which are this
change's regression guard.
"""
import asyncio

import app.routers.can_i as can_i_module
from app.routers.can_i import (
    _compose_facts,
    _DEBT_VERDICT_HEADLINES,
    _derive_verdict,
    _fmt_rate,
    _handle_payday_status_question,
    _is_saving_vs_investing_question,
    _multimonth_fit_headline,
    _nearest_yes_amount,
    _nothing_spare_line,
    _per_day_line,
    _whatif_delta_line,
    can_i_suggestions,
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


# ── _compose_facts ───────────────────────────────────────────────────────

def _facts(safe_to_spend, bills_total, wi, per_day=None, short_reason=None):
    return {
        "safe_to_spend": safe_to_spend,
        "next_payday": "2026-08-28",
        "bills_total": bills_total,
        "per_day": per_day if per_day is not None else round(safe_to_spend / 5, 2),
        "what_ifs": wi,
        "short_reason": short_reason,
    }


def test_compose_facts_transcript_scenario_delta_moved_to_headline():
    # safe_to_spend 161, bills_total 206, amount 100, 5 days — the exact
    # golf-session numbers. Verdict is "yes" (see test above). Owner
    # decision, 2026-08-25: the what-if delta ("£100 leaves £61 free") is
    # now the HEADLINE (see can_i.py's `can_i` handler), not an echoed fact
    # — asserted absent here so it can never print twice under the headline
    # that already shows the same sentence. The standing free-until-payday
    # line is also dropped (has_delta), leaving only the bills REASON.
    wi = what_ifs(100.0, 161.0, 5)
    facts = _facts(161.0, 206, wi)
    lines = _compose_facts(facts, None)
    assert lines == [
        "£206 of bills due before payday, already accounted for",
    ]
    assert "£100 leaves £61 free" not in lines  # now the headline, never a fact
    assert "£161 free until Fri 28 Aug" not in lines  # standing line, dropped on delta path


def test_compose_facts_bills_collision_refusal_gets_nearest_yes():
    # Amount exceeds safe_to_spend with a material bill in the way: bills is
    # the REASON, nearest-yes is the way forward — both must appear. The
    # negative what-if delta ("£250 would take you −£89") is now the
    # HEADLINE, not a fact (see the delta test above for why), and per-day
    # is still dropped to make room, unchanged from before.
    wi = what_ifs(250.0, 161.0, 5)
    facts = _facts(161.0, 206, wi)
    lines = _compose_facts(facts, None)
    assert lines == [
        "£206 of bills due before payday, already accounted for",
        "£160 would work",
    ]
    assert "£250 would take you −£89" not in lines  # now the headline, never a fact


def test_compose_facts_tight_verdict_shows_the_post_spend_rate():
    # safe_to_spend 161, bills 420, amount 100, 20 days: tight via the
    # per_day_after arm. The card must show the £3.05/day figure that IS
    # the reason it's tight, not just a comfortable-looking "£61 free" —
    # and the what-if delta itself ("£100 leaves £61 free") is now the
    # HEADLINE, not a fact, same as the two tests above.
    wi = what_ifs(100.0, 161.0, 20)
    assert _derive_verdict(wi, 161.0) == "tight"
    facts = _facts(161.0, 420, wi, per_day=round(161.0 / 20, 2))
    facts["next_payday"] = "2026-09-13"  # 20 days out from the fixed 28 Aug default
    lines = _compose_facts(facts, None)
    assert lines == [
        "£420 of bills due before payday, already accounted for",
        "That leaves about £3.05 a day until payday",
    ]
    assert "£100 leaves £61 free" not in lines  # now the headline, never a fact


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
# or below zero. These pin the three sites that used to format it as a bare
# (possibly negative) "£X free" figure: _compose_facts's free_line/per-day,
# _handle_payday_status_question's facts, and can_i_suggestions's
# context_line. ──────────────────────────────────────────────────────────

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


def test_compose_facts_negative_safe_to_spend_drops_free_line_and_per_day():
    # No amount asked (no-delta path) — the standing free-until-payday line
    # and the per-day rate are the whole answer on this branch (see
    # _compose_facts's own docstring), so this is exactly the site that used
    # to print "-£83 free until Fri 28 Aug" with a negative per-day rate
    # right under it.
    facts = _facts(-83.0, 0, {}, per_day=-16.6, short_reason="cards")
    lines = _compose_facts(facts, None)
    assert lines == ["Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"]
    assert not any("-£" in line or "−£" in line for line in lines)


def test_compose_facts_zero_safe_to_spend_bills_reason():
    facts = _facts(0.0, 0, {}, per_day=0.0, short_reason="bills")
    lines = _compose_facts(facts, None)
    assert lines == ["Nothing spare until Fri 28 Aug, bills come first"]


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
    assert result["facts"] == ["Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"]
    assert not any("-£" in f or "−£" in f for f in result["facts"])


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
    assert result["facts"][0] == "Nothing spare until Fri 28 Aug, bills come first"
    assert not any("-£" in f or "−£" in f for f in result["facts"])


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
    assert result["facts"] == ["Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"]


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
    assert result["facts"] == ["Bills are covered, but nothing spare until Fri 28 Aug, it's gone on cards"]
    assert result["out_of_scope"] is False
    # The invented-content regression this fix targets: no fabricated bills
    # total, no re-narrated overspend rate, no invented buffer claim.
    for blob in (result["headline"], result["reply"], *result["facts"]):
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
    assert result["facts"][0] == "Nothing spare until Fri 28 Aug, bills come first"
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
    asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    system_prompt = captured["messages"][0]["content"]
    assert "card_debt" not in system_prompt
    assert "2774" not in system_prompt


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
