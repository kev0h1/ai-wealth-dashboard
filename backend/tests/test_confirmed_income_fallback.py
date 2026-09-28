"""G158: a confirmed income stream must keep forecasting even when
`_detect_recurring`'s own 90-day window/2-occurrence floor loses it -- see
`_confirmed_income_fallback`'s docstring in analytics.py for the exact
mechanism (flat window sliding past an occurrence, or a payroll reference
change splitting one salary across two series keys, each alone under the
floor). Pure, Mongo-free tests: the helper takes plain dicts.
"""
from datetime import date, datetime

from app.routers.analytics import _detect_recurring, _confirmed_income_fallback, _build_confirmed_income_map, _raw_income_stream_map, income_credit_ok
from app.services.income import get_confirmed_payday

TODAY = date(2026, 9, 24)

CONFIRMED_KEY = "185008 12702436 Goldman Sachs BGC"
NEW_REF_KEY = "0201-GOLDMAN SACHS GOLDMAN SACHS PA"

CONFIRMED_STREAM = {
    "key": CONFIRMED_KEY,
    "status": "confirmed",
    "schedule": {"type": "last_weekday", "weekday": 4},
    "avg_amount": 4798.08,
    "last_seen": "2026-07-31",
    "confirmed_at": "2026-08-02T09:00:00",
}


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


def test_absent_confirmed_stream_is_synthesised():
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY)
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == CONFIRMED_KEY
    assert entry["next_date"] == date(2026, 9, 25)
    assert entry["avg_amount"] == 4798.08
    assert entry["source"] == "confirmed"
    assert entry["last_date"] == date(2026, 7, 31)


def test_already_detected_stream_is_not_duplicated():
    already_detected = [{"key": CONFIRMED_KEY, "avg_amount": 4798.08, "next_date": date(2026, 9, 25)}]
    result = _confirmed_income_fallback(already_detected, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY)
    assert result == []


def test_dismissed_key_is_not_synthesised():
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: CONFIRMED_STREAM}, {CONFIRMED_KEY}, TODAY)
    assert result == []


def test_stream_without_schedule_is_skipped():
    no_schedule = {**CONFIRMED_STREAM, "schedule": None}
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: no_schedule}, set(), TODAY)
    assert result == []


def test_manual_key_is_skipped():
    manual_stream = {**CONFIRMED_STREAM, "key": "manual"}
    result = _confirmed_income_fallback([], {"manual": manual_stream}, set(), TODAY)
    assert result == []


def test_reference_change_scenario_end_to_end():
    """Kevin's real 2026-09-24 case: three Goldman Sachs credits under the
    old payroll reference, then one under a new reference after the bank
    changed it. As of `TODAY`, only the newest occurrence under EACH key is
    still inside the (already-applied, in this fixture) 90-day window -- one
    under the confirmed key, one under the new, orphan key -- both below
    `_detect_recurring`'s 2-occurrence floor, so plain detection finds no
    salary at all. The confirmed stream must still forecast.
    """
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08),
        income_txn(NEW_REF_KEY, date(2026, 8, 28), 4798.08),
    ]
    recurring_income = _detect_recurring(income_credits, today=TODAY, is_income=True)
    # Both keys have exactly one in-window occurrence -- under the floor.
    assert recurring_income == []

    credits_by_key: dict = {}
    for t in income_credits:
        credits_by_key.setdefault(t["merchant_name"], []).append(t)

    fallback = _confirmed_income_fallback(
        recurring_income, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    assert len(fallback) == 1
    entry = fallback[0]
    assert entry["key"] == CONFIRMED_KEY
    assert entry["next_date"] == date(2026, 9, 25)
    assert entry["avg_amount"] == 4798.08
    assert entry["source"] == "confirmed"
    assert entry["occurrences"] == 1


# ── 2026-09-24 review follow-up: malformed `income_streams` entries must ──
# ── degrade to "skip that entry", never raise and crash Safe to Spend ─────

def test_build_confirmed_income_map_skips_entry_with_no_key():
    malformed = {"status": "confirmed", "schedule": {"type": "last_weekday", "weekday": 4}, "avg_amount": 4798.08}
    income_streams = [malformed, CONFIRMED_STREAM]
    result = _build_confirmed_income_map(income_streams)
    # The malformed entry (no "key") is skipped; the well-formed one is not.
    assert list(result.keys()) == [CONFIRMED_KEY]


def test_build_confirmed_income_map_skips_non_dict_entry():
    income_streams = ["not-a-stream-dict", None, CONFIRMED_STREAM]
    result = _build_confirmed_income_map(income_streams)
    assert list(result.keys()) == [CONFIRMED_KEY]


def test_fallback_skips_entry_whose_schedule_is_a_string_instead_of_raising():
    # A truthy but non-dict schedule -- e.g. a stray string from a bad write
    # -- must not raise (`schedule["type"]` on a str is a TypeError, not a
    # KeyError, so the except clause must catch both).
    bad_schedule_stream = {**CONFIRMED_STREAM, "schedule": "last_weekday"}
    result = _confirmed_income_fallback([], {CONFIRMED_KEY: bad_schedule_stream}, set(), TODAY)
    assert result == []


def test_raw_income_stream_map_skips_entry_with_no_key():
    # `compute_safe_to_spend`'s income_suggestion step (analytics.py
    # `_stored_map`, ~line 3783) and `_build_cashflow_response`'s
    # `confirmed_income` (~line 3183) both key off `income_streams` without
    # the status/schedule filter `_build_confirmed_income_map` applies.
    malformed = {"status": "suggested"}
    result = _raw_income_stream_map([malformed, "not-a-dict", None, CONFIRMED_STREAM])
    assert list(result.keys()) == [CONFIRMED_KEY]


def test_get_confirmed_payday_skips_non_dict_entry_instead_of_raising():
    # `get_confirmed_payday` sits directly on `compute_safe_to_spend`'s
    # "next payday" step -- a malformed `income_streams` entry here must
    # not crash Safe to Spend (2026-09-24 review sweep).
    uid_prefs = {"income_streams": ["not-a-dict", None, CONFIRMED_STREAM]}
    result = get_confirmed_payday(uid_prefs, TODAY)
    assert result is not None
    next_date, primary = result
    assert next_date == date(2026, 9, 25)
    assert primary["key"] == CONFIRMED_KEY


# ── 2026-09-24 review, finding 2: a payroll reference change must not ─────
# ── double the same salary once the NEW key clears the detection floor ────

NEW_REF_KEY_2 = "0201-GOLDMAN SACHS GOLDMAN SACHS PA"


def test_dedupe_guard_suppresses_confirmed_when_new_reference_gets_detected():
    """Reproduces the reviewer's follow-on scenario: by the month AFTER the
    reference change, the NEW key (B) has accrued two occurrences of its
    own and clears `_detect_recurring`'s floor on real transaction
    evidence, while the CONFIRMED key (A, old reference) has only one
    surviving occurrence in view and stays undetected. Without the dedupe
    guard, `_confirmed_income_fallback` would still synthesise A (same
    payer, same amount) alongside the genuinely-detected B, doubling the
    salary in `upcoming_income`/`payday_income` (4798.08 -> 9596.16, the
    reviewer's own repro number). The guard must suppress A because B's
    next_date lands within 3 days of A's and the amount matches within 15%.
    """
    TODAY = date(2026, 10, 26)

    # Three A credits exist in Kevin's real history (29 May, 26 Jun, 31 Jul
    # -- see the module docstring's original G158 scenario); only the
    # newest survives whatever window feeds `_detect_recurring` as of this
    # later `today`, same convention as `test_reference_change_scenario_end_to_end`.
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08),
        income_txn(NEW_REF_KEY_2, date(2026, 8, 28), 4798.08),
        income_txn(NEW_REF_KEY_2, date(2026, 9, 30), 4798.08),
    ]
    recurring_income = _detect_recurring(income_credits, today=TODAY, is_income=True)
    # B cleared the floor on its own evidence; A did not.
    assert len(recurring_income) == 1
    assert recurring_income[0]["key"] == NEW_REF_KEY_2

    fallback = _confirmed_income_fallback(
        recurring_income, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY,
    )
    # A must be suppressed as a near-duplicate of the detected B entry, not
    # synthesised alongside it.
    assert fallback == []

    combined = recurring_income + fallback
    assert len(combined) == 1
    assert combined[0]["key"] == NEW_REF_KEY_2
    assert "source" not in combined[0]
    # G174: the guard must also STAMP the detected entry it deferred to with
    # the confirmed key it stands in for, not merely suppress the duplicate
    # silently.
    assert combined[0]["confirmed_alias"] == CONFIRMED_KEY


# ── G174: the stamped `confirmed_alias` lets income_credit_ok recognise a ──
# ── fresh, still-unreliable detected series as its confirmed stream ────────

def test_confirmed_alias_lets_a_two_occurrence_detected_series_pass_income_credit_ok():
    """B (the new-reference series) has only 2 occurrences here -- below
    `_income_pattern_reliable`'s 3-occurrence floor on its own evidence, so
    without the alias `income_credit_ok` must reject it (this is the exact
    G174 defect: an unconfirmed, insufficiently-reliable candidate was the
    only thing left standing once the confirmed key's own synthesis was
    suppressed by the dedupe guard). With the alias stamped, the SAME item
    must be accepted for its attributed account."""
    TODAY = date(2026, 10, 26)
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(NEW_REF_KEY_2, date(2026, 8, 28), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(NEW_REF_KEY_2, date(2026, 9, 30), 4798.08, account_id=PREMIER_ACCOUNT),
    ]
    recurring_income = _detect_recurring(income_credits, today=TODAY, is_income=True)
    assert len(recurring_income) == 1
    entry = recurring_income[0]
    assert (entry.get("occurrences") or 0) < 3  # below the reliability floor on its own

    fallback = _confirmed_income_fallback(
        recurring_income, {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY,
    )
    assert fallback == []  # suppressed, not synthesised alongside
    assert entry["confirmed_alias"] == CONFIRMED_KEY

    item = {**entry, "name": entry["key"]}
    assert income_credit_ok(item, PREMIER_ACCOUNT, {CONFIRMED_KEY}) is True

    # Without the alias, the same 2-occurrence pattern is neither confirmed
    # nor reliable enough on its own -- must be rejected.
    unaliased = dict(item)
    unaliased.pop("confirmed_alias")
    assert income_credit_ok(unaliased, PREMIER_ACCOUNT, {CONFIRMED_KEY}) is False


# ── G160: a synthesised confirmed-income entry must carry the same ────────
# ── landing-account attribution a detected series would, otherwise ────────
# ── `income_credit_ok` rejects it before it ever reaches the ──────────────
# ── confirmed-stream clause. See `_confirmed_income_fallback`'s and ───────
# ── `_majority_landing_account`'s docstrings in analytics.py. ─────────────

PREMIER_ACCOUNT = "0aa08204bf059bcdf6266bd0"
OTHER_ACCOUNT = "other-account-id"


def test_account_id_is_majority_of_in_window_matches():
    # Three matches: two land in the Premier account, one elsewhere -- the
    # majority (Premier) wins, exactly the rule `_detect_recurring` gives a
    # DETECTED series.
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 5, 29), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 6, 26), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08, account_id=OTHER_ACCOUNT),
    ]
    credits_by_key = {CONFIRMED_KEY: income_credits}
    result = _confirmed_income_fallback(
        [], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    assert len(result) == 1
    assert result[0]["account_id"] == PREMIER_ACCOUNT


def test_account_id_falls_back_to_newest_out_of_window_credit():
    # No matches inside whatever window fed `credits_by_key` (empty here --
    # e.g. the flat 90-day window sliding past every occurrence) but the
    # caller's wider 180-day load still has one: its account wins.
    latest_credit_by_key = {
        CONFIRMED_KEY: income_txn(CONFIRMED_KEY, date(2026, 4, 24), 4798.08, account_id=PREMIER_ACCOUNT),
    }
    result = _confirmed_income_fallback(
        [], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, {}, latest_credit_by_key,
    )
    assert len(result) == 1
    assert result[0]["account_id"] == PREMIER_ACCOUNT


def test_account_id_is_none_when_neither_in_window_nor_out_of_window_evidence_exists():
    result = _confirmed_income_fallback(
        [], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, {}, {},
    )
    assert len(result) == 1
    assert result[0]["account_id"] is None


def test_synthesised_entry_passes_income_credit_ok_for_its_attributed_account():
    # End-to-end: the fallback's own output, fed straight into
    # `income_credit_ok` the way a per-account simulation (cover plan,
    # at-risk badge, source walk) actually calls it, must credit the
    # confirmed salary to the account it landed in and refuse every other
    # account -- this is the exact defect G160 closes (2026-09-24 22:11:
    # the synthesised entry's `account_id: None` failed attribution before
    # `income_credit_ok` ever reached its confirmed-stream clause).
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 5, 29), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 6, 26), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 7, 31), 4798.08, account_id=PREMIER_ACCOUNT),
    ]
    credits_by_key = {CONFIRMED_KEY: income_credits}
    result = _confirmed_income_fallback(
        [], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    assert len(result) == 1
    item = {**result[0], "name": result[0]["key"]}

    assert income_credit_ok(item, PREMIER_ACCOUNT, {CONFIRMED_KEY}) is True
    assert income_credit_ok(item, OTHER_ACCOUNT, {CONFIRMED_KEY}) is False


# ── G174 review (should-fix 1 + 2): account guard on the alias, and a ────
# ── first-wins rule when two confirmed keys both match one detected dup ───

PARTNER_ACCOUNT = "partner-account-id"

SECOND_CONFIRMED_KEY = "SECOND STREAM REF"
SECOND_CONFIRMED_STREAM = {
    "key": SECOND_CONFIRMED_KEY,
    "status": "confirmed",
    "schedule": {"type": "last_weekday", "weekday": 4},
    "avg_amount": 4800.00,
    "last_seen": "2026-07-31",
}


def test_different_account_dup_is_not_aliased_or_suppressed():
    """G174 review, finding 1: a partner's similarly-sized salary landing on
    a similar date, but into a DIFFERENT account than this confirmed
    stream's own known landing account, must never be aliased -- date and
    amount closeness alone is not proof of the same payer. The confirmed
    stream is still synthesised (attributed to its OWN evidence, not the
    partner's account), and the partner's detected entry is left completely
    untouched: no `confirmed_alias`, and (being only 2 occurrences on its
    own, below the reliability floor) `income_credit_ok` correctly refuses
    it -- not credited as this confirmed stream, and not credited on its
    own reliability either."""
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 5, 29), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 6, 26), 4798.08, account_id=PREMIER_ACCOUNT),
    ]
    credits_by_key = {CONFIRMED_KEY: income_credits}
    partner_dup = {
        "key": "PARTNER SALARY REF", "avg_amount": 4750.00,
        "next_date": date(2026, 9, 25), "account_id": PARTNER_ACCOUNT,
        "occurrences": 2, "amounts_recent": [4750.0, 4750.0],
    }
    result = _confirmed_income_fallback(
        [partner_dup], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    # The confirmed stream is synthesised on its OWN evidence, not merged
    # into or suppressed by the partner's near-miss.
    assert len(result) == 1
    entry = result[0]
    assert entry["key"] == CONFIRMED_KEY
    assert entry["account_id"] == PREMIER_ACCOUNT

    # The partner's own entry is untouched: not aliased.
    assert "confirmed_alias" not in partner_dup

    # ...and not credited either -- neither by (absent) alias nor by its
    # own reliability (2 occurrences is below the floor).
    partner_item = {**partner_dup, "name": partner_dup["key"]}
    assert income_credit_ok(partner_item, PARTNER_ACCOUNT, {CONFIRMED_KEY}) is False


def test_same_account_dup_is_still_aliased_and_suppressed():
    """Regression guard alongside the different-account test above: when
    the confirmed stream's own evidence and the detected dup's attributed
    account genuinely agree, the alias must still apply -- this guard is an
    account check, not a blanket "never alias" regression."""
    income_credits = [
        income_txn(CONFIRMED_KEY, date(2026, 5, 29), 4798.08, account_id=PREMIER_ACCOUNT),
        income_txn(CONFIRMED_KEY, date(2026, 6, 26), 4798.08, account_id=PREMIER_ACCOUNT),
    ]
    credits_by_key = {CONFIRMED_KEY: income_credits}
    same_acct_dup = {
        "key": "NEW REF SAME ACCOUNT", "avg_amount": 4798.08,
        "next_date": date(2026, 9, 25), "account_id": PREMIER_ACCOUNT,
        "occurrences": 2, "amounts_recent": [4798.08, 4798.08],
    }
    result = _confirmed_income_fallback(
        [same_acct_dup], {CONFIRMED_KEY: CONFIRMED_STREAM}, set(), TODAY, credits_by_key,
    )
    assert result == []
    assert same_acct_dup["confirmed_alias"] == CONFIRMED_KEY
    item = {**same_acct_dup, "name": same_acct_dup["key"]}
    assert income_credit_ok(item, PREMIER_ACCOUNT, {CONFIRMED_KEY}) is True


def test_second_confirmed_key_does_not_overwrite_existing_alias():
    """G174 review, finding 2: a pathological doc where TWO different
    confirmed streams both land within tolerance (date + amount) of the
    SAME detected entry -- the second one considered must not clobber the
    first's alias. Dict iteration order is insertion order in this Python
    version, so `confirmed_map`'s own order decides which is "first"."""
    shared_dup = {
        "key": "SHARED DETECTED REF", "avg_amount": 4798.08,
        "next_date": date(2026, 9, 25), "account_id": None,
        "occurrences": 2, "amounts_recent": [4798.08, 4798.08],
    }
    confirmed_map = {CONFIRMED_KEY: CONFIRMED_STREAM, SECOND_CONFIRMED_KEY: SECOND_CONFIRMED_STREAM}
    result = _confirmed_income_fallback([shared_dup], confirmed_map, set(), TODAY)
    assert result == []
    assert shared_dup["confirmed_alias"] == CONFIRMED_KEY
