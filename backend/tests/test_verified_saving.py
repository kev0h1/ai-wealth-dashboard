"""Tests for `_check_verified_saving` (backend/app/routers/savings_insights.py,
~line 1055) — the loop-closer behind the bills -> covered -> move -> verified
core loop. If an insight's top trigger merchant had debit transactions in the
45-90 day window but NONE in the last 45 days, the spend genuinely ceased and
the insight is stamped `verified_savings` / `verified_merchant` / `verified_at`.

No mongomock is available in this environment (see test_notifications.py's
own note), so the four transaction collections `_check_verified_saving` reads
(`transactions_col`, `yapily_transactions_col`, `statement_transactions_col`,
`mono_transactions_col`) are replaced with tiny in-memory fakes supporting
just enough of Motor's `.find().to_list()` surface to drive the real
function, following the same monkeypatch-the-module-level-name pattern
test_transfer_pairs.py / test_notifications.py already established.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _check_verified_saving,
    _merchant_keys_match,
    _normalize_merchant_key,
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
    """Stand-in for a Motor collection — `.find()` is the only method
    `_check_verified_saving` calls on these four collections."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])


UID = "kevin"
NOW = datetime(2026, 8, 27, 12, 0, 0)


def txn(days_ago, *, merchant=None, description="", amount=12.99, ttype="debit", category=None):
    return {
        "user_id": UID,
        "merchant_name": merchant,
        "description": description,
        "amount": amount,
        "date": NOW - timedelta(days=days_ago),
        "transaction_type": ttype,
        "category": category,
    }


def _patch_collections(monkeypatch, primary_docs, *, others_empty=True):
    """Only `transactions_col` carries the fixture's transactions; the other
    three collections stay present (so `_check_verified_saving`'s fan-out
    across all four doesn't blow up) but empty, matching how a real user's
    data usually lives in exactly one source."""
    monkeypatch.setattr(savings_insights, "transactions_col", FakeCol(primary_docs))
    if others_empty:
        monkeypatch.setattr(savings_insights, "yapily_transactions_col", FakeCol())
        monkeypatch.setattr(savings_insights, "statement_transactions_col", FakeCol())
        monkeypatch.setattr(savings_insights, "mono_transactions_col", FakeCol())


def _run(coro):
    return asyncio.run(coro)


def _existing(merchant_key="netflix.com", monthly_amount=12.99, display_name="Netflix.Com", verified_at=None,
              category=None):
    d = {
        "triggered_by": [
            {"merchant_key": merchant_key, "monthly_amount": monthly_amount, "display_name": display_name},
        ],
    }
    if verified_at:
        d["verified_at"] = verified_at
    if category:
        d["category"] = category
    return d


# ── Core cases ──────────────────────────────────────────────────────────

def test_ceased_spend_is_verified_with_correct_amount(monkeypatch):
    # Payments at 50 and 80 days ago (inside the 45-90 window), none since.
    _patch_collections(monkeypatch, [
        txn(50, merchant="NETFLIX.COM"),
        txn(80, merchant="NETFLIX.COM"),
    ])
    existing = _existing(monthly_amount=12.99)
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 12.99
    assert result["verified_merchant"] == "Netflix.Com"
    assert "verified_at" in result


def test_payments_still_recent_are_not_verified(monkeypatch):
    # One payment 80 days ago (before window) AND one 10 days ago (recent) —
    # spend hasn't ceased, so this must NOT verify.
    _patch_collections(monkeypatch, [
        txn(80, merchant="NETFLIX.COM"),
        txn(10, merchant="NETFLIX.COM"),
    ])
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None


def test_no_payments_at_all_in_window_is_not_verified(monkeypatch):
    # before == 0 — nothing to prove the spend ever existed at this merchant
    # in this window, so it must not be reported as a "stopped" win.
    _patch_collections(monkeypatch, [])
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None


def test_already_verified_insight_never_double_counts(monkeypatch):
    _patch_collections(monkeypatch, [
        txn(50, merchant="NETFLIX.COM"),
        txn(80, merchant="NETFLIX.COM"),
    ])
    existing = _existing(verified_at=NOW - timedelta(days=5))
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None


def test_trigger_under_fiver_floor_is_not_verified(monkeypatch):
    _patch_collections(monkeypatch, [
        txn(50, merchant="TINY CO", amount=4.99),
        txn(80, merchant="TINY CO", amount=4.99),
    ])
    existing = _existing(merchant_key="tiny co", monthly_amount=4.99, display_name="Tiny Co")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None


def test_rotating_descriptor_still_matches_on_both_sides(monkeypatch):
    # Real corpus pattern this normaliser targets: same merchant, different
    # trailing noise token per charge. "before" carries a trailing phone-style
    # reference, "recent" carries a trailing location word — both normalise
    # to "netflix.com" via _normalize_merchant_key, so this must count as
    # ONE still-active merchant (NOT verified), not two disjoint ones.
    _patch_collections(monkeypatch, [
        txn(80, merchant="NETFLIX.COM 18665797172"),
        txn(10, merchant="NETFLIX.COM LONDON"),
    ])
    assert _normalize_merchant_key("NETFLIX.COM 18665797172") == "netflix.com"
    assert _normalize_merchant_key("NETFLIX.COM LONDON") == "netflix.com"
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None  # still paying — descriptor rotation must not hide that


def test_rotating_descriptor_ceased_spend_still_verifies(monkeypatch):
    # Same rotation, but genuinely ceased: both occurrences fall in the
    # 45-90 day window under different rotating descriptors, none since.
    _patch_collections(monkeypatch, [
        txn(50, merchant="NETFLIX.COM 18665797172"),
        txn(80, merchant="NETFLIX.COM LONDON"),
    ])
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 12.99


# ── Fixed defect: description[:30] fallback no longer false-positives ─────
#
# `_check_verified_saving` derives a transaction's merchant key the same way
# `_find_triggered_transactions` does: `merchant_name` if present, else
# `description[:30]`. That fallback is an arbitrary character-count slice,
# not a semantic boundary. If the SAME merchant's transactions arrive via a
# different source at different times (e.g. `merchant_name` populated in the
# 45-90 day window's source but absent — falling back to a differently
# formatted `description` — in the last-45-days source), the 30-char slice
# can land mid-token and produce a normalised key that does not exactly
# equal the original merchant_key. Because `_normalize_merchant_key` only
# knows how to strip a handful of specific trailing-noise shapes
# (phone-number runs, "LND"/"LONDON", bare digit runs), a slice that doesn't
# happen to end in one of those shapes survived untouched as noise fused
# onto the key — under plain equality, that used to hide a still-live
# payment and get the merchant falsely reported as a VERIFIED, banked
# saving. `_check_verified_saving` now compares keys with
# `_merchant_keys_match`, which accepts a prefix relationship ONLY when the
# transaction-side key is confirmed to have been built from that truncated
# `description[:30]` fallback (no `merchant_name`, description longer than
# 30 chars) — "netflix.com direct debit ref 9" still starts with
# "netflix.com" and, because it really is a truncation artifact, counts as
# the same still-paying merchant. A transaction with a clean, untruncated
# `merchant_name` never gets this leniency: see the colliding-sibling tests
# below (Vodafone/Vodafone Broadband, Amazon/Amazon Prime) for why that
# matters — those are genuinely different products that merely share a
# brand prefix, not truncation noise.
def test_description_fallback_prefix_match_prevents_false_positive(monkeypatch):
    _patch_collections(monkeypatch, [
        # 80 days ago: merchant_name populated cleanly.
        txn(80, merchant="NETFLIX.COM 18665797172"),
        # 10 days ago (still within the last-45-days "still paying" window):
        # merchant_name is MISSING, so the code falls back to description[:30].
        # The slice doesn't end in a shape _normalize_merchant_key strips, but
        # it still starts with "netflix.com", so the prefix match catches it.
        txn(10, merchant=None, description="NETFLIX.COM DIRECT DEBIT REF 998877"),
    ])
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None, (
        "The merchant was still charged 10 days ago (inside the last-45-day "
        "'still paying' window) via a description-fallback key that doesn't "
        "exactly equal the stored key but does share its prefix — this must "
        "NOT be reported as a verified saving."
    )


def test_description_fallback_genuinely_ceased_merchant_still_verifies(monkeypatch):
    # Same description-fallback shape as above, but the merchant has
    # genuinely stopped: both occurrences fall inside the 45-90 day window,
    # nothing since. Proves the prefix-match fix doesn't just disable the
    # feature — a real ceased-spend case still verifies.
    _patch_collections(monkeypatch, [
        txn(50, merchant="NETFLIX.COM 18665797172"),
        txn(80, merchant=None, description="NETFLIX.COM DIRECT DEBIT REF 998877"),
    ])
    existing = _existing()
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 12.99
    assert result["verified_merchant"] == "Netflix.Com"


# ── _merchant_keys_match unit tests ────────────────────────────────────────
#
# Signature is `_merchant_keys_match(stored_key_norm, txn_key_norm,
# txn_key_truncated)`. `txn_key_truncated` must be True for a prefix
# relationship to ever be accepted — it asserts the caller has confirmed the
# txn-side key came from the `description[:30]` fallback with no clean
# `merchant_name`, i.e. that it is genuinely a cut-off string and not a
# complete, different product name that merely shares a brand prefix.

def test_merchant_keys_match_exact():
    assert _merchant_keys_match("netflix.com", "netflix.com", False) is True


def test_merchant_keys_match_prefix_forward_when_truncated():
    # stored key is the shorter prefix of a longer, CONFIRMED-truncated
    # recent-window key.
    assert _merchant_keys_match("netflix.com", "netflix.com direct debit ref 9", True) is True


def test_merchant_keys_match_prefix_reverse_when_truncated():
    # recent-window key (confirmed truncated) is the shorter prefix of a
    # longer stored key.
    assert _merchant_keys_match("netflix.com direct debit ref 9", "netflix.com", True) is True


def test_merchant_keys_match_rejects_short_key_prefix_even_when_truncated():
    # "ee" (2 chars) must not prefix-match an unrelated merchant it happens
    # to be a prefix of — too short to trust as a prefix under any
    # circumstances, must fall back to exact equality only.
    assert _merchant_keys_match("ee", "ee mobile top up", True) is False


def test_merchant_keys_match_rejects_genuinely_different_merchants():
    assert _merchant_keys_match("netflix.com", "spotify.com", True) is False
    assert _merchant_keys_match("sainsburys s/mkt", "sainsburys petrol", True) is False


def test_merchant_keys_match_rejects_prefix_when_not_truncated():
    # Same strings as the "prefix_forward" case above, but txn_key_truncated
    # is False (a clean merchant_name was present, no truncation occurred) —
    # must now require exact equality and reject the prefix relationship.
    assert _merchant_keys_match("netflix.com", "netflix.com direct debit ref 9", False) is False


# ── Colliding-sibling regression: same brand, different product ───────────
#
# These are the cases the original prefix rule got wrong: two genuinely
# different recurring charges from the same brand, where the shorter name is
# a real (non-truncated) prefix of the longer one. Must NOT match, whether
# checked directly via `_merchant_keys_match` or end-to-end via
# `_check_verified_saving`.

def test_merchant_keys_match_rejects_vodafone_broadband_sibling():
    assert _merchant_keys_match("vodafone", "vodafone broadband", False) is False


def test_merchant_keys_match_rejects_amazon_prime_sibling():
    assert _merchant_keys_match("amazon", "amazon prime", False) is False


def test_merchant_keys_match_rejects_sky_sports_cinema_sibling():
    assert _merchant_keys_match("sky sports", "sky sports cinema", False) is False


def test_merchant_keys_match_rejects_giffgaff_plus_sibling():
    assert _merchant_keys_match("giffgaff", "giffgaff plus", False) is False


def test_ceased_mobile_line_verifies_despite_sibling_broadband_still_billing(monkeypatch):
    # Kevin cancels Vodafone mobile (the insight's stored merchant_key is
    # "vodafone"); Vodafone Broadband, a separate direct debit with a clean,
    # untruncated merchant_name, keeps billing every month including
    # recently. The mobile cancellation must still verify — the broadband
    # charges must not prefix-match "vodafone" and suppress it forever.
    _patch_collections(monkeypatch, [
        # Mobile line, ceased: only in the 45-90 day window.
        txn(50, merchant="Vodafone", amount=15.0),
        txn(80, merchant="Vodafone", amount=15.0),
        # Broadband, a different product, still billing recently.
        txn(10, merchant="Vodafone Broadband", amount=32.0),
        txn(40, merchant="Vodafone Broadband", amount=32.0),
    ])
    existing = _existing(merchant_key="vodafone", monthly_amount=15.0, display_name="Vodafone")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None, (
        "Vodafone Broadband (a clean merchant_name, no truncation) must not "
        "prefix-match the stored 'vodafone' key and mask the ceased mobile "
        "line."
    )
    assert result["verified_savings"] == 15.0
    assert result["verified_merchant"] == "Vodafone"


# ── datetime.utcnow() freezing ──────────────────────────────────────────
#
# `_check_verified_saving` calls `datetime.utcnow()` internally to compute
# `now` and the 45/90-day cutoffs. The fixtures above are built relative to
# a fixed NOW, so real wall-clock time must be pinned to that same instant
# for the day-offsets to land in the windows the test names promise.

class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _frozen_now(monkeypatch):
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)


# ── Category-net verification (Insights honesty review, Package B #6) ──────
#
# Merchant silence alone used to be enough to call something a verified
# saving. Live review finding: Kevin's Nando's insight fired "You did it,
# £49 staying in your pocket" unattended, but Eating Out category spend
# never actually dropped (baseline ~£231/mo, post-"win" August £228) — the
# spend substituted to Wagamama (£52 in August), the very merchant the card
# had advertised. `_check_verified_saving` now also computes the insight's
# whole spend category total for the same 45-90-day-before vs last-45-day
# windows already used for merchant silence, and only verifies when the
# category net'd down by at least half the ceased merchant's own monthly
# figure (`_SUBSTITUTION_NET_DOWN_FRACTION`); otherwise it's `substituted`.
#
# These fixtures need BOTH the merchant-silence signal (Nando's txns only in
# the 45-90 day window, none recent) AND category-tagged transactions across
# the whole window so `_category_net_totals` has something to sum.

def _eating_out_before_after(monkeypatch, *, before_extra, after_extra):
    """Nando's genuinely goes silent (2 payments totalling £49 in the
    45-90-day window, none since) — the merchant-silence half is identical
    in both the verified and substituted variants below; only the OTHER
    Eating Out spend (`before_extra`/`after_extra`, e.g. a different
    restaurant) changes, to move the category net up or down."""
    docs = [
        txn(50, merchant="NANDOS.CO.UK", amount=24.5, category="Eating Out"),
        txn(80, merchant="NANDOS.CO.UK", amount=24.5, category="Eating Out"),
    ]
    docs += before_extra
    docs += after_extra
    _patch_collections(monkeypatch, docs)


def test_category_nets_down_confirms_verified(monkeypatch):
    # Nando's stops entirely AND the rest of Eating Out spend also drops
    # sharply (231 before -> 0 after) — a genuine saving, not a substitution.
    _eating_out_before_after(
        monkeypatch,
        before_extra=[txn(60, merchant="COSTA COFFEE", amount=91.0, category="Eating Out"),
                      txn(70, merchant="COSTA COFFEE", amount=91.0, category="Eating Out")],
        after_extra=[],
    )
    existing = _existing(merchant_key="nandos.co.uk", monthly_amount=49.0,
                         display_name="Nandos.Co.Uk", category="eating_out")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 49.0
    assert "substituted_at" not in result


def test_category_flat_confirms_substituted_nandos_wagamama_shape(monkeypatch):
    # The exact live-review shape: baseline Eating Out ~£231, post-"win"
    # Eating Out ~£228 — the merchant went silent but the category barely
    # moved because the spend substituted to Wagamama.
    _eating_out_before_after(
        monkeypatch,
        before_extra=[txn(60, merchant="COSTA COFFEE", amount=91.0, category="Eating Out"),
                      txn(70, merchant="COSTA COFFEE", amount=91.0, category="Eating Out")],
        after_extra=[txn(10, merchant="WAGAMAMA", amount=26.0, category="Eating Out"),
                     txn(30, merchant="WAGAMAMA", amount=26.0, category="Eating Out"),
                     txn(15, merchant="COSTA COFFEE", amount=88.0, category="Eating Out"),
                     txn(35, merchant="COSTA COFFEE", amount=88.0, category="Eating Out")],
    )
    existing = _existing(merchant_key="nandos.co.uk", monthly_amount=49.0,
                         display_name="Nandos.Co.Uk", category="eating_out")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert "verified_savings" not in result
    assert result["substituted_at"] is not None
    assert result["substituted_merchant"] == "Nandos.Co.Uk"
    assert result["substituted_amount"] == 49.0


def test_category_net_check_skipped_when_category_unmapped(monkeypatch):
    # mortgage/car_finance have no single reliable spend category
    # (_category_for_net_check returns None for them) — the category-net
    # check can't run at all, so this must fall back to the pre-Package-B
    # merchant-silence-only behaviour and still verify.
    _patch_collections(monkeypatch, [
        txn(50, merchant="NATIONWIDE MORTGAGE", amount=1200.0),
        txn(80, merchant="NATIONWIDE MORTGAGE", amount=1200.0),
    ])
    existing = _existing(merchant_key="nationwide mortgage", monthly_amount=1200.0,
                         display_name="Nationwide Mortgage", category="mortgage")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 1200.0


def test_category_net_check_skipped_when_no_category_spend_at_all(monkeypatch):
    # A mapped category (eating_out -> "Eating Out") but genuinely zero
    # category-tagged spend anywhere in the 90-day window (before == 0,
    # e.g. the merchant's own transactions never carried a `category` field
    # — an older/uncategorised source) — nothing to compare against, so this
    # must fall back to verified rather than guessing either way.
    _patch_collections(monkeypatch, [
        txn(50, merchant="NANDOS.CO.UK", amount=24.5, category=None),
        txn(80, merchant="NANDOS.CO.UK", amount=24.5, category=None),
    ])
    existing = _existing(merchant_key="nandos.co.uk", monthly_amount=49.0,
                         display_name="Nandos.Co.Uk", category="eating_out")
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is not None
    assert result["verified_savings"] == 49.0


def test_already_substituted_insight_never_re_evaluates(monkeypatch):
    _eating_out_before_after(monkeypatch, before_extra=[], after_extra=[])
    existing = _existing(merchant_key="nandos.co.uk", monthly_amount=49.0,
                         display_name="Nandos.Co.Uk", category="eating_out")
    existing["substituted_at"] = NOW - timedelta(days=3)
    _frozen_now(monkeypatch)
    result = _run(_check_verified_saving(UID, existing))
    assert result is None


