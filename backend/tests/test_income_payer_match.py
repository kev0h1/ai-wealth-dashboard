"""G157: income series grouped by PAYER identity, not the raw payment
reference (`series_key`) -- see app/services/income_payer.py's module
docstring for the 2026-09-24 bug this closes (a payroll reference change
forked one confirmed salary into two series, each below
`_detect_recurring`'s occurrence floor, and the confirmed stream crossed a
fixed recency cutoff and vanished the day before payday).

Pure, Mongo-free tests throughout (the one exception, the attachments-log
test, uses the same tiny in-memory FakeCol convention
tests/test_income_streams_confirmed_overlay.py already established --
local to this file, not shared, per that file's own note).
"""
import asyncio
from datetime import date, datetime

import app.db.collections as db_collections
import app.routers.analytics as analytics_module
from app.routers.analytics import _detect_recurring, _confirmed_income_fallback
from app.services.income_payer import (
    payer_key,
    payer_tokens,
    deterministic_match,
    missed_cycles,
    is_lapsed,
    stable_stream_id,
)

OLD_REF = "185008 12702436 GOLDMAN SACHS"
NEW_REF = "0201 GOLDMAN SACHS GOLDMAN SACHS PAY"


def income_txn(merchant, d, amount, account_id="acc1"):
    return {
        "merchant_name": merchant,
        "description": merchant,
        "amount": amount,
        "date": datetime(d.year, d.month, d.day),
        "category": "Income",
        "custom_category": None,
        "account_id": account_id,
    }


# ── (a) regression: a monthly salary's reference changes mid-run and the ──
# ── forecast continues, the new credit attaching straight to the series ────

def test_regression_reference_change_mid_run_keeps_forecasting_no_gap():
    """Kevin's exact 2026-09-24 case: four monthly Goldman Sachs salaries,
    the last (28 Aug) under a changed payment reference. Before this item,
    `_detect_recurring` grouped income by the raw statement key, so the 28
    Aug credit started a brand-new, single-occurrence series while the
    confirmed stream's own (old-reference) key had no recent evidence left
    -- the confirmed stream crossed a fixed recency cutoff and the salary
    disappeared from the forecast the day before payday. Grouping by PAYER
    identity instead means all four credits (old and new reference alike)
    fall into ONE series and the 28 Aug credit is simply the newest
    occurrence in it -- no fallback needed, no gap, no drop to zero."""
    TODAY = date(2026, 9, 24)
    income_credits = [
        income_txn(OLD_REF, date(2026, 5, 29), 4798.08),
        income_txn(OLD_REF, date(2026, 6, 26), 4798.08),
        income_txn(OLD_REF, date(2026, 7, 31), 4798.08),
        income_txn(NEW_REF, date(2026, 8, 28), 4798.08),
    ]
    recurring_income = _detect_recurring(income_credits, today=TODAY, is_income=True)
    assert len(recurring_income) == 1
    entry = recurring_income[0]
    assert entry["occurrences"] == 4
    # The 28 Aug (new-reference) credit is the newest occurrence in the ONE
    # merged series, not an orphan.
    assert entry["last_date"] == date(2026, 8, 28)
    # Forecasts the very next payday -- no gap.
    assert entry["next_date"] == date(2026, 9, 25)
    assert entry["avg_amount"] == 4798.08

    # The confirmed stream (still stored under the OLD raw reference in
    # preferences -- this item never rewrites user data) is recognised as
    # THIS series by payer identity, so no duplicate is synthesised.
    confirmed_stream = {
        "key": OLD_REF, "status": "confirmed",
        "schedule": {"type": "last_weekday", "weekday": 4},
        "avg_amount": 4798.08, "last_seen": "2026-07-31",
    }
    fallback = _confirmed_income_fallback(recurring_income, {OLD_REF: confirmed_stream}, set(), TODAY)
    assert fallback == []
    assert entry["confirmed_alias"] == OLD_REF


# ── (b) the couple case: two genuinely different payers with similar ──────
# ── amounts on similar days must stay separate ─────────────────────────────

def test_couple_with_similar_paydays_and_amounts_stay_separate():
    """Two different employers whose salaries happen to land on similar
    days for similar amounts must never merge into one series just because
    date and amount coincide -- that coincidence is exactly what the old
    G174 date+amount dedupe heuristic (replaced by this item) got wrong.
    Payer-identity tokens (different employer names) keep them apart."""
    acme_1 = income_txn("ACME CORP PAYROLL", date(2026, 7, 25), 3000.00, account_id="joint-acc")
    acme_2 = income_txn("ACME CORP PAYROLL", date(2026, 8, 25), 3000.00, account_id="joint-acc")
    sunrise_1 = income_txn("SUNRISE RETAIL LTD WAGES", date(2026, 7, 26), 2950.00, account_id="joint-acc")
    sunrise_2 = income_txn("SUNRISE RETAIL LTD WAGES", date(2026, 8, 26), 2950.00, account_id="joint-acc")

    recurring_income = _detect_recurring(
        [acme_1, acme_2, sunrise_1, sunrise_2], today=date(2026, 9, 24), is_income=True,
    )
    assert len(recurring_income) == 2
    keys = {r["key"] for r in recurring_income}
    assert len(keys) == 2  # two distinct payer-identity buckets, not merged
    for r in recurring_income:
        assert r["occurrences"] == 2

    # Token sets genuinely don't overlap -- no shared counterparty evidence
    # at all, so a deterministic match between them isn't even "ambiguous".
    assert payer_tokens("ACME CORP PAYROLL") & payer_tokens("SUNRISE RETAIL LTD WAGES") == frozenset()
    stream = {"schedule": {"type": "day_of_month", "day": 25}, "avg_amount": 3000.0}
    verdict = deterministic_match("ACME CORP PAYROLL", stream, sunrise_2, date(2026, 9, 24))
    assert verdict is None


def test_two_employers_sharing_only_boilerplate_words_never_confident():
    """Reviewer-reproduced blocker (independent review of a165200d): two
    genuinely different employers on the SAME account with similar amounts
    on cadence, whose statement text happens to share ONLY a payroll-
    boilerplate word ("PAYROLL") once that word is filtered as generic --
    before this fix, "payroll" was missing from `_GENERIC_PAYER_TOKENS`, so
    `deterministic_match` saw `shared_tokens == ["payroll"]` and returned
    "confident", auto-merging two unrelated payers with no confirmation.
    Must now return None (no non-generic token in common at all) or, if
    any other coincidental single-word overlap survives the generic list
    in future, at most "ambiguous" via the full-containment rule -- NEVER
    "confident"."""
    acme_stream_key = "PAYROLL SALARY LTD ACME"
    acme_stream = {
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 3000.0,
    }
    sunrise_candidate = income_txn(
        "PAYROLL SALARY LTD SUNRISE", date(2026, 8, 28), 3050.00, account_id="joint-acc",
    )
    verdict = deterministic_match(
        acme_stream_key, acme_stream, sunrise_candidate, date(2026, 9, 24),
        stream_account_id="joint-acc",
    )
    assert verdict is None or verdict["decision"] == "ambiguous"
    if verdict is not None:
        assert verdict["decision"] != "confident"

    # And via `_detect_recurring`/`_confirmed_income_fallback`, end to end:
    # never merged into one series, and the fallback's own deterministic-
    # attach step never confidently attaches SUNRISE's credit to ACME's
    # confirmed stream.
    acme_1 = income_txn("PAYROLL SALARY LTD ACME", date(2026, 6, 28), 3000.00, account_id="joint-acc")
    acme_2 = income_txn("PAYROLL SALARY LTD ACME", date(2026, 7, 28), 3000.00, account_id="joint-acc")
    recurring_income = _detect_recurring([acme_1, acme_2], today=date(2026, 9, 24), is_income=True)
    assert len(recurring_income) == 1

    confirmed_stream = {
        "key": acme_stream_key, "status": "confirmed",
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 3000.0, "last_seen": "2026-07-28",
    }
    log: list = []
    result = _confirmed_income_fallback(
        recurring_income, {acme_stream_key: confirmed_stream}, set(), date(2026, 9, 24),
        unattributed_credits=[sunrise_candidate], attachments_log=log,
    )
    # ACME's own series is already detected/aliased -- nothing left to
    # synthesise, and the deterministic-attach step is never even reached
    # (an already-covered confirmed stream skips it entirely), so SUNRISE's
    # credit is never confidently attached to ACME's stream under either
    # path.
    assert result == []
    assert recurring_income[0]["confirmed_alias"] == acme_stream_key
    assert all(entry.get("decision") != "confident" for entry in log)


# ── (c) lapse counts missed CYCLES, not days ───────────────────────────────

def test_lapse_counts_cycles_not_a_fixed_day_count():
    """A fixed day-count cutoff can expire between two ordinary monthly
    paydays purely because the calendar gap is wide -- the exact shape of
    the original bug. Counting missed CYCLES instead means one missed
    payday (about one month) is not lapsed; two in a row is."""
    schedule = {"type": "day_of_month", "day": 28}
    last_credit = date(2026, 7, 28)

    # One missed cycle (~35 days) -- well short of two full months.
    assert missed_cycles(schedule, last_credit, date(2026, 9, 1)) < 2
    assert is_lapsed(schedule, last_credit, date(2026, 9, 1)) is False

    # Two missed cycles (~63 days).
    assert missed_cycles(schedule, last_credit, date(2026, 9, 29)) >= 2
    assert is_lapsed(schedule, last_credit, date(2026, 9, 29)) is True


def test_lapsed_confirmed_stream_still_forecasts_hedged_not_dropped_to_zero():
    """A confirmed stream never silently drops to zero: once lapsed (two
    missed monthly cycles here), it still forecasts at its confirmed
    cadence/amount, and carries `lapsed`/`missed_cycles` so the companion
    ask pipeline can raise the payday-confirmation ask -- the ask is what
    changes, never the forecast itself."""
    stream_key = "OLD PAYROLL REF 4471"
    stream = {
        "key": stream_key, "status": "confirmed",
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 3000.0, "last_seen": "2026-07-28",
    }
    TODAY = date(2026, 9, 29)  # two missed cycles since 28 Jul
    result = _confirmed_income_fallback([], {stream_key: stream}, set(), TODAY)
    assert len(result) == 1
    entry = result[0]
    assert entry["lapsed"] is True
    assert entry["missed_cycles"] >= 2
    # Still forecasts at the confirmed cadence/amount.
    assert entry["avg_amount"] == 3000.0
    assert entry["next_date"] is not None
    assert entry["source"] == "confirmed"


def test_stream_with_a_recent_credit_is_not_lapsed():
    """Regression guard alongside the lapse test above: a stream with a
    credit inside its own cadence is never reported lapsed."""
    stream_key = "CURRENT PAYROLL REF"
    stream = {
        "key": stream_key, "status": "confirmed",
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 3000.0, "last_seen": "2026-08-28",
    }
    credit = income_txn("SOME EMPLOYER", date(2026, 8, 28), 3000.0)
    credits_by_key = {stream_key: [credit]}
    result = _confirmed_income_fallback(
        [], {stream_key: stream}, set(), date(2026, 9, 24), credits_by_key,
    )
    assert len(result) == 1
    assert result[0]["lapsed"] is False


# ── (d) ambiguous evidence routes to the judge, never auto-attaches ───────

def test_deterministic_match_is_ambiguous_on_account_mismatch():
    """Tokens overlap (same payer name) but the destination account
    disagrees with the stream's own known landing account -- partial
    evidence, routed to the judge, never a confident auto-attach."""
    stream_key = "0455 GOLDMAN SACHS"
    stream = {"schedule": {"type": "day_of_month", "day": 28}, "avg_amount": 4798.08}
    candidate = income_txn("GOLDMAN SACHS EUROPE PAYROLL", date(2026, 8, 28), 4798.08, account_id="different-account")
    verdict = deterministic_match(
        stream_key, stream, candidate, date(2026, 9, 24), stream_account_id="original-account",
    )
    assert verdict is not None
    assert verdict["decision"] == "ambiguous"


def test_fallback_logs_ambiguous_match_and_never_auto_attaches():
    """End to end: `_confirmed_income_fallback` logs the ambiguous evidence
    (for the caller's judge step) but leaves the stream unattributed --
    never an unexplained auto-decision on partial evidence."""
    stream_key = "0455 GOLDMAN SACHS"
    stream = {
        "key": stream_key, "status": "confirmed",
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 4798.08, "last_seen": "2026-07-28",
    }
    # Shares the "goldman"/"sachs" tokens and lands on-cadence, but the
    # amount is well outside the stream's 15% band -- ambiguous, not
    # confident.
    candidate = income_txn("GOLDMAN SACHS EUROPE PAYROLL", date(2026, 8, 28), 6200.00, account_id="acc9")
    log: list = []
    result = _confirmed_income_fallback(
        [], {stream_key: stream}, set(), date(2026, 9, 24),
        unattributed_credits=[candidate], attachments_log=log,
    )
    assert len(result) == 1
    assert result[0]["account_id"] is None  # not attached
    assert result[0]["occurrences"] == 0
    assert len(log) == 1
    assert log[0]["decision"] == "ambiguous"


def test_fallback_confidently_attaches_on_full_evidence():
    """Regression guard alongside the ambiguous test above: when tokens
    overlap, the account has no known usual value to contradict, the
    amount is in-band and the date is on-cadence, the credit IS attached
    (build step 2 -- deterministic, no model needed) and logged as
    "confident"."""
    stream_key = "9942 Goldman Sachs Ltd"  # tokenises to {"goldman", "sachs"}
    stream = {
        "key": stream_key, "status": "confirmed",
        "schedule": {"type": "day_of_month", "day": 28},
        "avg_amount": 4798.08, "last_seen": "2026-06-28",
    }
    candidate = income_txn("GOLDMAN SACHS EUROPE", date(2026, 8, 28), 4798.08, account_id="acc9")
    log: list = []
    result = _confirmed_income_fallback(
        [], {stream_key: stream}, set(), date(2026, 9, 24),
        unattributed_credits=[candidate], attachments_log=log,
    )
    assert len(result) == 1
    assert result[0]["account_id"] == "acc9"
    assert result[0]["occurrences"] == 1
    assert len(log) == 1
    assert log[0]["decision"] == "confident"
    # The log carries a STABLE id, never the raw key/reference.
    assert log[0]["stream_id"] == stable_stream_id(stream_key)
    assert log[0]["stream_id"] != stream_key


# ── (e) the attachment log is scoped by user_id and carries no raw ────────
# ── reference ───────────────────────────────────────────────────────────────

class _FakeAttachmentsCol:
    def __init__(self):
        self.docs: list[dict] = []

    async def update_one(self, filt, update, upsert=False):
        self.docs.append({**filt, **update.get("$set", {})})


def test_attachments_log_is_scoped_by_user_and_carries_no_raw_reference():
    fake_col = _FakeAttachmentsCol()
    orig = db_collections.income_payer_attachments_col
    db_collections.income_payer_attachments_col = fake_col
    try:
        attachments = [{
            "stream_id": stable_stream_id(OLD_REF),
            "credit_id": "abc123",
            "decision": "confident",
            "evidence": {"shared_tokens": ["goldman", "sachs"]},
        }]
        asyncio.run(
            analytics_module._process_income_payer_attachments(
                "kevin@example.com", attachments, date(2026, 9, 24),
            )
        )
    finally:
        db_collections.income_payer_attachments_col = orig

    assert len(fake_col.docs) == 1
    doc = fake_col.docs[0]
    assert doc["user_id"] == "kevin@example.com"
    assert doc["stream_id"] == stable_stream_id(OLD_REF)
    # Never the raw reference numbers from the stream's own key.
    assert "185008" not in str(doc)
    assert "12702436" not in str(doc)
