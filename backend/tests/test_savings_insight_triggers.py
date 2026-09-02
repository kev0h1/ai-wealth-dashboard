"""Tests for two data-quality bugs in the savings-insight trigger pipeline
(backend/app/routers/savings_insights.py):

BUG 1 — unanchored substring matching pulled unrelated merchants into a
category. `_detect_insight_categories` and `_find_triggered_transactions`
used plain `trigger in text` containment against INSIGHT_CATEGORIES'
trigger lists. The live, confirmed consequence: the mobile trigger "ee "
matched inside "Cko*Sunday*Mowgli Stree Birmin" (a restaurant, via the
"e-e-space" inside "Stree ") and inside "Barclays Avios Fee " (a card fee,
via the "e-e-space" inside "Fee "), so both ended up stored as
`triggered_by` evidence for a mobile-spend insight. Fixed with
word-boundary phrase matching (`_TRIGGER_PATTERNS` / `_text_matches_triggers`,
~line 426) — a trigger phrase must not be immediately preceded or followed
by an alphanumeric character.

BUG 2 — the same merchant didn't merge across legal-suffix spellings.
`_normalize_merchant_key` stripped phone numbers / LND / LONDON / bare
digit runs but not "Ltd" vs "Limited", so "Ee Ltd" and "Ee Limited" stayed
two separate trigger buckets — the card's bold lead line (`triggered_by[0]`
alone) then disagreed with the generated title (which sums every trigger
line). Fixed by extending `_normalize_merchant_key` to also strip UK
company-suffix noise, apostrophes, domain suffixes and bank date-stamp
noise (~line 493).

No mongomock is available in this environment (see test_verified_saving.py's
own note), so the four transaction collections are replaced with tiny
in-memory fakes following the same monkeypatch-the-module-level-name
pattern already established there.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _TRIGGER_PATTERNS,
    _text_matches_triggers,
    _normalize_merchant_key,
    _find_triggered_transactions,
    _detect_insight_categories,
)


# ── Generic fake-Mongo plumbing (subset matcher + collection) ──────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$in" in cond and val not in cond["$in"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class FakeCol:
    """Stand-in for a Motor collection supporting the subset of the API
    `_find_triggered_transactions` / `_detect_insight_categories` use."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None


UID = "kevin"
NOW = datetime(2026, 8, 27, 12, 0, 0)


def txn(days_ago, *, merchant=None, description="", amount=12.99, ttype="debit"):
    return {
        "user_id": UID,
        "merchant_name": merchant,
        "description": description,
        "amount": amount,
        "date": NOW - timedelta(days=days_ago),
        "transaction_type": ttype,
    }


def _patch_collections(monkeypatch, primary_docs, *, labels=None, recurring_spend=None):
    """Only `transactions_col` carries the fixture's transactions; the other
    three collections stay present (so the fan-out across all four doesn't
    blow up) but empty. `recurring_spend` fakes the recurring engine's own
    cached patterns (`cashflow_cache_col`, `{"_id": user_id, "recurring_spend":
    [...]}`) that `_find_triggered_transactions` now consults for its
    monthly-amount fix — defaults to "no cached doc" so existing tests that
    don't care about it keep exercising the honest-window-average fallback."""
    monkeypatch.setattr(savings_insights, "transactions_col", FakeCol(primary_docs))
    monkeypatch.setattr(savings_insights, "yapily_transactions_col", FakeCol())
    monkeypatch.setattr(savings_insights, "statement_transactions_col", FakeCol())
    monkeypatch.setattr(savings_insights, "mono_transactions_col", FakeCol())
    monkeypatch.setattr(savings_insights, "savings_labels_col", FakeCol(labels or []))
    cache_docs = [{"_id": UID, "recurring_spend": recurring_spend}] if recurring_spend is not None else []
    monkeypatch.setattr(savings_insights, "cashflow_cache_col", FakeCol(cache_docs))


def _run(coro):
    return asyncio.run(coro)


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _frozen_now(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)


# ── BUG 1: word-boundary trigger matching ──────────────────────────────────

def test_ee_trigger_no_longer_matches_unrelated_substrings():
    mobile_patterns = _TRIGGER_PATTERNS["mobile"]
    # Restaurant descriptor — "ee " used to match inside "...Stree Birmin".
    assert not _text_matches_triggers(
        "cko*sunday*mowgli stree birmingham", mobile_patterns
    )
    # Card fee descriptor — "ee " used to match inside "...Avios Fee...".
    assert not _text_matches_triggers(
        "barclays avios fee 577000000469672301 cb", mobile_patterns
    )


def test_ee_trigger_still_matches_real_ee_merchants():
    mobile_patterns = _TRIGGER_PATTERNS["mobile"]
    assert _text_matches_triggers("ee ltd", mobile_patterns)
    assert _text_matches_triggers("ee limited", mobile_patterns)
    # A description ending exactly in "EE" (bare word, nothing trailing) —
    # the old hand-rolled trailing space in the trigger ("ee ") would have
    # missed this; a real boundary must not.
    assert _text_matches_triggers("direct debit to ee", mobile_patterns)


def test_stem_triggers_match_bare_plural_as_well_as_apostrophe_form():
    # "nando"/"mcdonald" are deliberately without a trailing "s" so they act
    # as a stem for both spellings a bank uses for the same merchant. A
    # right boundary that only accepted "not alphanumeric" would match the
    # apostrophe form (the apostrophe itself is non-alnum) but reject the
    # bare-plural bank descriptor, since the "s" right after the stem is
    # alphanumeric — this was a real regression caught against live data.
    eating_out = _TRIGGER_PATTERNS["eating_out"]
    assert _text_matches_triggers("nando's", eating_out)
    assert _text_matches_triggers("nandos.co.uk london", eating_out)
    assert _text_matches_triggers("mcdonald's", eating_out)
    assert _text_matches_triggers("mcdonalds 1435 on 29 may clp", eating_out)
    # The trailing-"s" allowance must not reopen the left-boundary bug this
    # whole fix exists for — "ee" must still not match inside "fee"/"stree"
    # regardless of what's allowed on the right.
    assert not _text_matches_triggers("barclays avios fee", _TRIGGER_PATTERNS["mobile"])


# ── Trailing-"s" absorption must be opt-in, not global ──────────────────────
# A follow-up regression: the trailing-"s" tolerance added for
# "nando"/"mcdonald" was briefly applied to EVERY trigger, not just the ones
# that need it. That let "bt" (broadband) match "BTS MERCH STORE" and "leon"
# (eating_out) match "LEONS GARAGE" — an unrelated merchant store and an
# unrelated garage, neither with anything to do with BT or Leon. Fixed by
# making the absorption opt-in via `_STEM_TRIGGERS` (~line 479): only brands
# whose OFFICIAL name carries a possessive apostrophe get it.

def test_bt_does_not_absorb_trailing_s_into_unrelated_merchant():
    broadband = _TRIGGER_PATTERNS["broadband"]
    assert not _text_matches_triggers("bts merch store", broadband)
    assert _text_matches_triggers("bt broadband", broadband)
    # A descriptor ending exactly in "BT" (bare word, nothing trailing).
    assert _text_matches_triggers("direct debit to bt", broadband)


def test_leon_does_not_absorb_trailing_s_into_unrelated_merchant():
    eating_out = _TRIGGER_PATTERNS["eating_out"]
    assert not _text_matches_triggers("leons garage", eating_out)
    assert _text_matches_triggers("leon restaurant", eating_out)


def test_nando_stem_still_matches_both_bank_spellings():
    eating_out = _TRIGGER_PATTERNS["eating_out"]
    assert _text_matches_triggers("nandos.co.uk", eating_out)
    assert _text_matches_triggers("nando's", eating_out)


def test_mcdonald_stem_still_matches_datestamped_spelling():
    eating_out = _TRIGGER_PATTERNS["eating_out"]
    assert _text_matches_triggers("mcdonalds 1435 on 29 may clp", eating_out)


def test_sainsbury_stem_matches_apostrophe_and_bare_plural_spelling():
    # Same shape as nando/mcdonald: "Sainsbury's" is the brand's official
    # name, and UK bank descriptors routinely drop the apostrophe ("SAINSBURYS
    # S/MKT"). Opted into _STEM_TRIGGERS for the same reason.
    groceries = _TRIGGER_PATTERNS["groceries"]
    assert _text_matches_triggers("sainsbury's supermarket", groceries)
    assert _text_matches_triggers("sainsburys s/mkt 1234", groceries)


def test_sweep_other_short_triggers_do_not_absorb_trailing_s():
    # Other short triggers found during the sweep whose "trigger+s" spelling
    # is a real, unrelated English word or an unrelated business, not an
    # alternate spelling of the same merchant. None of these are in
    # _STEM_TRIGGERS, so the strict boundary must reject the "+s" form.
    assert not _text_matches_triggers("it took eons to arrive", _TRIGGER_PATTERNS["energy"])
    assert _text_matches_triggers("eon energy bill", _TRIGGER_PATTERNS["energy"])

    assert not _text_matches_triggers("the admirals rest pub", _TRIGGER_PATTERNS["car_insurance"])
    assert _text_matches_triggers("admiral insurance", _TRIGGER_PATTERNS["car_insurance"])

    assert not _text_matches_triggers("student housing co-ops society", _TRIGGER_PATTERNS["groceries"])
    assert _text_matches_triggers("co-op food", _TRIGGER_PATTERNS["groceries"])

    assert not _text_matches_triggers("london subways heritage tour", _TRIGGER_PATTERNS["eating_out"])
    assert _text_matches_triggers("subway sandwich", _TRIGGER_PATTERNS["eating_out"])


def test_awkward_triggers_match_with_correct_boundaries():
    assert _text_matches_triggers("co-op", _TRIGGER_PATTERNS["groceries"])
    assert not _text_matches_triggers("recoup", _TRIGGER_PATTERNS["groceries"])

    assert _text_matches_triggers("m&s food hall", _TRIGGER_PATTERNS["groceries"])
    assert not _text_matches_triggers("m&s clothing", _TRIGGER_PATTERNS["groceries"])

    assert _text_matches_triggers("disney+ subscription", _TRIGGER_PATTERNS["subscriptions"])
    assert not _text_matches_triggers("disneystore purchase", _TRIGGER_PATTERNS["subscriptions"])

    assert _text_matches_triggers("o2 direct debit", _TRIGGER_PATTERNS["mobile"])
    assert not _text_matches_triggers("o2ish other thing", _TRIGGER_PATTERNS["mobile"])

    assert _text_matches_triggers("apple tv subscription", _TRIGGER_PATTERNS["subscriptions"])
    assert not _text_matches_triggers("appletvstore.com", _TRIGGER_PATTERNS["subscriptions"])


def test_detect_insight_categories_excludes_false_positive_mobile_match(monkeypatch):
    # Only a restaurant and a card fee in the window — neither is a genuine
    # mobile trigger under word-boundary matching, so "mobile" must not be
    # detected from these alone.
    _patch_collections(monkeypatch, [
        txn(5, description="CKO*SUNDAY*MOWGLI STREE BIRMINGHAM", amount=20.65),
        txn(5, description="Barclays Avios Fee 577000000469672301 CB", amount=12.0),
    ])
    detected = _run(_detect_insight_categories(UID))
    assert "mobile" not in detected


# ── BUG 1 end-to-end via _find_triggered_transactions ──────────────────────

def test_find_triggered_transactions_mobile_excludes_false_positives_and_merges_ee(monkeypatch):
    _patch_collections(monkeypatch, [
        txn(5, description="EE LTD", amount=35.99),
        txn(35, description="EE LIMITED", amount=20.65),
        txn(5, description="CKO*SUNDAY*MOWGLI STREE BIRMINGHAM", amount=20.65),
        txn(5, description="Barclays Avios Fee 577000000469672301 CB", amount=12.0),
    ])
    result = _run(_find_triggered_transactions(UID, "mobile"))
    display_names = {t["display_name"] for t in result}
    assert not any("mowgli" in n.lower() for n in display_names)
    assert not any("avios" in n.lower() or "fee" in n.lower() for n in display_names)

    # EE Ltd and EE Limited must have merged into one bucket whose amounts sum.
    ee_buckets = [t for t in result if t["merchant_key"] == "ee"]
    assert len(ee_buckets) == 1
    assert ee_buckets[0]["occurrences"] == 2
    assert round(sum([35.99, 20.65]) / 3, 2) == ee_buckets[0]["monthly_amount"]


# ── BUG 2: _normalize_merchant_key ──────────────────────────────────────────

def test_ee_ltd_and_ee_limited_normalise_to_same_key():
    assert _normalize_merchant_key("Ee Ltd") == "ee"
    assert _normalize_merchant_key("Ee Limited") == "ee"


def test_awkward_normalisation_cases():
    # Domain suffix + apostrophe: "Nandos.Co.Uk" and "Nando's" are the same
    # restaurant under two bank-descriptor spellings.
    assert _normalize_merchant_key("Nandos.Co.Uk") == _normalize_merchant_key("Nando's")
    # Bank date-stamp noise: "Mcdonald's" and its date-stamped card-present
    # variant are the same merchant.
    assert _normalize_merchant_key("Mcdonald's") == _normalize_merchant_key(
        "Mcdonalds 1435 On 29 May Clp"
    )


def test_normalisation_does_not_break_co_op():
    # "Co-op" must keep its "co" — the company-suffix strip only fires on a
    # trailing, whitespace-separated "co" token, and "co-op" ends in "-op",
    # not in whitespace+"co".
    assert _normalize_merchant_key("Co-op") == "co-op"
    assert _normalize_merchant_key("Co-op Food") == "co-op food"


def test_normalisation_does_not_overmerge_different_merchants():
    # Genuinely different products from the same brand must NOT collapse to
    # one key just because one is a prefix of the other.
    assert _normalize_merchant_key("Vodafone") != _normalize_merchant_key("Vodafone Broadband")
    assert _normalize_merchant_key("Amazon") != _normalize_merchant_key("Amazon Prime")
    assert _normalize_merchant_key("Sky Sports") != _normalize_merchant_key("Sky Sports Cinema")
    # "Limitless Gym" must not be mistaken for carrying a "Limited" suffix.
    assert _normalize_merchant_key("Limitless Gym") == "limitless gym"


def test_find_triggered_transactions_groceries_keeps_different_supermarkets_distinct(monkeypatch):
    _patch_collections(monkeypatch, [
        txn(5, description="TESCO STORE 1234", amount=40.0),
        txn(5, description="SAINSBURY'S SUPERMARKET", amount=30.0),
    ])
    result = _run(_find_triggered_transactions(UID, "groceries"))
    keys = {t["merchant_key"] for t in result}
    assert "tesco store 1234" in keys or any(k.startswith("tesco") for k in keys)
    assert any("sainsbury" in k for k in keys)
    assert len(result) == 2  # must not have merged into one bucket


# ── BUG 3: window-clipped monthly_amount silently undershot the true bill ──
# (backend fix for the phone-reported evidence-footer bug, 2026-08-31): a
# fixed `sum(amounts) / 3` window average silently undershoots whenever the
# 90-day evidence window catches only 2 of a monthly bill's 3 occurrences
# (2/3 of the truth, to the penny), which then contradicted the correct
# figure the card's title/body already quoted from the recurring engine.
# Fix: prefer the recurring engine's own cached `avg_amount` when the
# merchant matches a genuinely-monthly (26-35 day) cached series.

def test_find_triggered_transactions_uses_recurring_engine_amount_when_window_clips_an_occurrence(monkeypatch):
    _patch_collections(
        monkeypatch,
        [
            txn(10, description="NATIONWIDE MORTGAGE", amount=1124.44),
            txn(40, description="NATIONWIDE MORTGAGE", amount=1124.44),
            # A third real-world occurrence exists but falls just outside the
            # 90-day window, which is exactly what "clips" the window
            # average -- deliberately NOT included here, the window only
            # ever sees the two above.
        ],
        recurring_spend=[
            {"key": "Nationwide Mortgage", "avg_amount": 1124.44, "avg_interval": 30},
        ],
    )
    result = _run(_find_triggered_transactions(UID, "mortgage"))
    assert len(result) == 1
    assert result[0]["monthly_amount"] == 1124.44
    assert result[0]["is_recurring"] is True
    # The old, broken window average -- must NOT be what's returned.
    broken_window_average = round(sum([1124.44, 1124.44]) / 3, 2)
    assert broken_window_average == 749.63  # sanity: reproduces the live bug's own number
    assert result[0]["monthly_amount"] != broken_window_average


def test_find_triggered_transactions_ad_hoc_merchant_keeps_honest_window_average(monkeypatch):
    # No matching recurring series at all (genuine ad-hoc spend, e.g. a
    # restaurant visited twice) -- keeps the plain window average and flags
    # is_recurring False so the frontend hedges it with "~".
    _patch_collections(
        monkeypatch,
        [
            txn(5, description="NANDOS.CO.UK", amount=25.0),
            txn(20, description="NANDOS.CO.UK", amount=30.0),
        ],
        recurring_spend=[],
    )
    result = _run(_find_triggered_transactions(UID, "eating_out"))
    assert len(result) == 1
    assert result[0]["monthly_amount"] == round((25.0 + 30.0) / 3, 2)
    assert result[0]["is_recurring"] is False


def test_find_triggered_transactions_sums_recurring_series_that_share_a_merged_key(monkeypatch):
    # Live discovery while verifying the fix above: the recurring engine's
    # own series_key has no legal-suffix normalisation, so "EE LTD" and
    # "EE LIMITED" stay two SEPARATE cached series (different real bills,
    # confirmed on Kevin's own account) even though _normalize_merchant_key
    # merges their transactions into one "ee" evidence bucket here. Picking
    # only one matching engine amount would silently drop the other bill;
    # this asserts they're summed instead.
    _patch_collections(
        monkeypatch,
        [
            txn(5, description="EE LTD", amount=35.99),
            txn(35, description="EE LIMITED", amount=20.65),
        ],
        recurring_spend=[
            {"key": "EE LTD", "avg_amount": 35.99, "avg_interval": 31},
            {"key": "EE LIMITED", "avg_amount": 20.65, "avg_interval": 30},
        ],
    )
    result = _run(_find_triggered_transactions(UID, "mobile"))
    ee_buckets = [t for t in result if t["merchant_key"] == "ee"]
    assert len(ee_buckets) == 1
    assert ee_buckets[0]["is_recurring"] is True
    assert ee_buckets[0]["monthly_amount"] == round(35.99 + 20.65, 2)


def test_find_triggered_transactions_ignores_non_monthly_recurring_match(monkeypatch):
    # A cached pattern matches the merchant key, but its OWN detected cadence
    # is weekly (avg_interval=7) -- avg_amount there is a PER-CHARGE figure,
    # not a monthly one, and this function must not invent a x4.33-style
    # conversion. Falls back to the honest window average instead of trusting
    # a mismatched-cadence number.
    _patch_collections(
        monkeypatch,
        [
            txn(5, description="DAVID LLOYD LEISURE", amount=39.0),
            txn(35, description="DAVID LLOYD LEISURE", amount=39.0),
        ],
        recurring_spend=[
            {"key": "David Lloyd Leisure", "avg_amount": 39.0, "avg_interval": 7},
        ],
    )
    result = _run(_find_triggered_transactions(UID, "gym"))
    assert len(result) == 1
    assert result[0]["is_recurring"] is False
    assert result[0]["monthly_amount"] == round((39.0 + 39.0) / 3, 2)
