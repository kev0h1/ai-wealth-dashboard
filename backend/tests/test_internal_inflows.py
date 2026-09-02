"""Tests for the internal-inflows fix to the cashflow simulations:

  - `analytics._learn_transfer_destinations`, the three-pass greedy
    matcher that pairs an own-transfer's outbound debit series to its
    inbound destination account, plus its evidence gate.
  - `analytics._build_cashflow_response`, wiring the learned destination
    into a mirrored `internal_inflows` entry alongside `upcoming_bills`.
  - `analytics.at_risk_count`, crediting `internal_inflows` to their
    destination account inside the running-balance walk.

Context: the projection was asymmetric about the user's own internal
transfers. An outbound standing order to the user's own account was
projected as a bill (it consumes balance on the SOURCE account), but the
matching inbound credit on the DESTINATION account was projected as
nothing at all, so the at-risk simulation could watch one account lose
money to another and never watch the other gain it, falsely reporting the
destination account short. `_learn_transfer_destinations` exists because
the byte-identical-description matcher (categorisation.py Pass 2) misses
most real pairs, since the two legs of one transfer routinely read differently.

No mongomock is available in this environment (see test_notifications.py's
own note), so DB-touching collections are replaced with tiny in-memory
fakes, following the same pattern test_transfer_pairs.py already
established for this file's other DB-touching helpers.
"""
import asyncio
import re
from datetime import date, datetime, timedelta

import app.routers.analytics as analytics
import app.services.companion as companion
import app.services.spend_impact as spend_impact
import app.db.collections as db_collections
from app.routers.analytics import (
    _learn_transfer_destinations,
    _build_cashflow_response,
    _bank_label,
    PATTERNS_VERSION,
)
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS, MOVEMENT


# ── Generic fake-Mongo plumbing (subset matcher + collection), copied from
# test_transfer_pairs.py's own local copy rather than shared, matching this
# suite's existing per-file convention. ───────────────────────────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self  # order is irrelevant to every test in this file

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _ModifiedResult:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    """Stand-in for a Motor collection, enough of `.find()`/`.find_one()`/
    `.update_one()`/`.update_many()` to drive the real code under test.
    `compute_today_items` persists card state through several collections
    (companion_items_col, savings_insights_col, ...) it does not itself
    inspect the return value of, so a minimal $set/$setOnInsert/$addToSet
    apply is enough."""

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

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def update_many(self, filt, update):
        n = 0
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                n += 1
        return _ModifiedResult(n)

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$setOnInsert") or {}).items():
            d.setdefault(k, v)
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


KIND_MAP = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
UID = "kevin"


# ── _learn_transfer_destinations ─────────────────────────────────────────────

ACCOUNT_MAP = {
    "barclays": {"name": "Barclays Current", "balance": 5000.0, "provider": "barclays", "is_credit_card": False, "is_spendable": True},
    "hsbc":     {"name": "HSBC Current",     "balance": 200.0,  "provider": "hsbc",     "is_credit_card": False, "is_spendable": True},
    "natwest":  {"name": "NatWest Current",  "balance": 50.0,   "provider": "natwest",  "is_credit_card": False, "is_spendable": True},
    "monzo":    {"name": "Monzo Current",    "balance": 10.0,   "provider": "monzo",    "is_credit_card": False, "is_spendable": True},
    "amex":     {"name": "Amex Credit Card", "balance": -100.0, "provider": "amex",     "is_credit_card": True,  "is_spendable": False},
    # A savings-subtype destination: `_split_balances` buckets these into
    # savings_balance, not spendable_balance, so `is_spendable` is False
    # even though the account is perfectly ordinary otherwise.
    "rainyday": {"name": "Rainy Day Saver",  "balance": 900.0,  "provider": "hsbc",     "is_credit_card": False, "is_spendable": False},
}


def _t(_id, ttype, amount, on_date, account_id, desc, category="Transfer", merchant=None):
    return {
        "_id": _id, "transaction_type": ttype, "amount": amount, "date": on_date,
        "account_id": account_id, "description": desc, "merchant_name": merchant,
        "category": category, "custom_category": None,
    }


D0 = date(2026, 6, 28)
D1 = date(2026, 7, 28)  # one month later, same series, second occurrence


def test_pass1_differently_worded_legs_same_day_same_amount_paired():
    """The real reported bug: 'KEVIN MAINGI HSBC STO' (debit, Barclays) vs
    'MAINGI K M HSBC' (credit, HSBC), not byte-identical, so Pass 2 in
    categorisation.py never catches it, but same day + same amount twice is
    real evidence of a recurring destination."""
    raw = [
        _t("d1", "debit", 1758.33, D0, "barclays", "KEVIN MAINGI HSBC STO"),
        _t("c1", "credit", 1758.33, D0, "hsbc", "MAINGI K M HSBC"),
        _t("d2", "debit", 1758.33, D1, "barclays", "KEVIN MAINGI HSBC STO"),
        _t("c2", "credit", 1758.33, D1, "hsbc", "MAINGI K M HSBC"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert dest["KEVIN MAINGI HSBC STO"] == {
        "dest_account_id": "hsbc",
        "dest_account_name": "HSBC Current",
        "dest_account_bank": "hsbc",
        "dest_account_spendable": True,
        # Added for `_learn_card_repayment_destinations`'s cap (shared
        # `_gate_destination_votes`, see analytics.py) -- unused by the
        # plain transfer-destination channel's own consumers, carried here
        # only because the two channels share one evidence-gate helper.
        "dest_account_balance": 200.0,
    }


def test_pass0_byte_identical_description_within_five_days():
    """Identical description but posted a few days apart (statement lag),
    Pass 1 requires the same calendar date, so only Pass 0's wider 5-day
    window (mirroring categorisation.py Pass 2's own rule) catches this."""
    raw = [
        _t("d1", "debit", 300.0, D0, "barclays", "TRANSFER TO SAVINGS REF001"),
        _t("c1", "credit", 300.0, D0 + timedelta(days=3), "hsbc", "TRANSFER TO SAVINGS REF001"),
        _t("d2", "debit", 300.0, D1, "barclays", "TRANSFER TO SAVINGS REF001"),
        _t("c2", "credit", 300.0, D1 + timedelta(days=4), "hsbc", "TRANSFER TO SAVINGS REF001"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert dest["TRANSFER TO SAVINGS REF001"]["dest_account_id"] == "hsbc"


def test_pass2_loose_amount_and_one_day_tolerance():
    """Different descriptions, a small rounding-scale amount gap and a
    one-day posting lag, too loose for Pass 0/1, exactly what Pass 2's
    1%-of-amount / +-1-day rule exists for."""
    raw = [
        _t("d1", "debit", 1000.00, D0, "barclays", "STANDING ORDER A"),
        _t("c1", "credit", 1005.00, D0 + timedelta(days=1), "hsbc", "FASTER PAYMENT B"),
        _t("d2", "debit", 1000.00, D1, "barclays", "STANDING ORDER A"),
        _t("c2", "credit", 1004.00, D1 + timedelta(days=1), "hsbc", "FASTER PAYMENT B"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert dest["STANDING ORDER A"]["dest_account_id"] == "hsbc"


def test_evidence_gate_rejects_single_unrepeated_match():
    """One matched occurrence is not enough, could be a coincidence."""
    raw = [
        _t("d1", "debit", 300.0, D0, "barclays", "ONE OFF LOOKING RECURRING"),
        _t("c1", "credit", 300.0, D0, "hsbc", "MATCHING CREDIT"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert "ONE OFF LOOKING RECURRING" not in dest


def test_evidence_gate_rejects_inconsistent_destination():
    """Three matched occurrences landing on three different accounts,
    modal share (1/3) is well under the two-thirds bar, so no destination
    is trusted even though every occurrence matched something."""
    raw = [
        _t("d1", "debit", 300.0, D0, "barclays", "WANDERING TRANSFER"),
        _t("c1", "credit", 300.0, D0, "hsbc", "WANDERING TRANSFER"),
        _t("d2", "debit", 300.0, D1, "barclays", "WANDERING TRANSFER"),
        _t("c2", "credit", 300.0, D1, "natwest", "WANDERING TRANSFER"),
        _t("d3", "debit", 300.0, D1 + timedelta(days=31), "barclays", "WANDERING TRANSFER"),
        _t("c3", "credit", 300.0, D1 + timedelta(days=31), "monzo", "WANDERING TRANSFER"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert "WANDERING TRANSFER" not in dest


def test_credit_consumed_at_most_once():
    """Two different debit series both want the same day's single credit on
    each of two days. Neither series' description has any name affinity
    with the destination account ("Acc A"/"Acc Z" name nothing that appears
    in "DEBIT A"/"DEBIT B"), so the collision is unresolved and the credit
    is left unconsumed by both, every time. This used to be "the sort-order
    winner claims it, the loser is starved" (see git history), which was
    exactly the bug: an arbitrary tiebreak deciding which series a real
    credit belongs to. Failing closed here means neither series reaches the
    2-occurrence evidence bar, so a credit is still never double-claimed,
    but now for the right reason rather than a coin flip that happened to
    land the same way twice."""
    raw = [
        _t("dA1", "debit", 100.0, D0, "accA", "DEBIT A"),
        _t("dB1", "debit", 100.0, D0, "accZ", "DEBIT B"),
        _t("c1", "credit", 100.0, D0, "hsbc", "SHARED CREDIT"),
        _t("dA2", "debit", 100.0, D1, "accA", "DEBIT A"),
        _t("dB2", "debit", 100.0, D1, "accZ", "DEBIT B"),
        _t("c2", "credit", 100.0, D1, "hsbc", "SHARED CREDIT"),
    ]
    account_map = dict(ACCOUNT_MAP)
    account_map["accA"] = {"name": "Acc A", "balance": 0, "provider": "a", "is_credit_card": False}
    account_map["accZ"] = {"name": "Acc Z", "balance": 0, "provider": "z", "is_credit_card": False}
    dest = _learn_transfer_destinations(raw, account_map, KIND_MAP)
    assert "DEBIT A" not in dest
    assert "DEBIT B" not in dest


def test_contended_credit_with_no_affinity_is_learned_by_neither():
    """Direct coverage of the collision-handling rule itself: two unrelated
    recurring series, same amount, same day, competing for one credit on an
    account ("HSBC Current" / provider "hsbc") that neither description
    names. With no way to tell which series the credit actually belongs to,
    the correct behaviour is to learn nothing from it rather than guess,
    exactly as `test_credit_consumed_at_most_once` above demonstrates -- a
    wrong destination would mean mirroring money into an account that never
    received it."""
    raw = [
        _t("d1", "debit", 75.0, D0, "barclays", "MYSTERY TRANSFER ONE"),
        _t("d2", "debit", 75.0, D0, "monzo", "MYSTERY TRANSFER TWO"),
        _t("c1", "credit", 75.0, D0, "hsbc", "INBOUND"),
        _t("d3", "debit", 75.0, D1, "barclays", "MYSTERY TRANSFER ONE"),
        _t("d4", "debit", 75.0, D1, "monzo", "MYSTERY TRANSFER TWO"),
        _t("c2", "credit", 75.0, D1, "hsbc", "INBOUND"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert "MYSTERY TRANSFER ONE" not in dest
    assert "MYSTERY TRANSFER TWO" not in dest


def test_contended_credit_exactly_one_affinity_wins_regardless_of_input_order():
    """The target case this fix exists for: two recurring standing orders
    out of the same source account, same amount, same day, one of which
    (Chase) is genuinely named in its own description, the other (Starling)
    is not competing for anything that names it. Affinity, not sort order,
    must decide the winner, and the result must be identical whichever way
    the two competing debits happen to be ordered in the input (proving the
    fix doesn't just relocate the old arbitrary dependency onto list
    order)."""
    account_map = dict(ACCOUNT_MAP)
    account_map["chase"] = {
        "name": "Main G", "balance": 0.0, "provider": "Chase UK",
        "is_credit_card": False, "is_spendable": True,
    }
    chase_debit_d0 = _t("dc1", "debit", 50.0, D0, "barclays", "KEVIN MAINGI CHASEACCOUNT STO")
    starling_debit_d0 = _t("ds1", "debit", 50.0, D0, "barclays", "KEVIN MAINGI STARLING STO")
    credit_d0 = _t("c1", "credit", 50.0, D0, "chase", "FROM MAINGI K M")
    chase_debit_d1 = _t("dc2", "debit", 50.0, D1, "barclays", "KEVIN MAINGI CHASEACCOUNT STO")
    starling_debit_d1 = _t("ds2", "debit", 50.0, D1, "barclays", "KEVIN MAINGI STARLING STO")
    credit_d1 = _t("c2", "credit", 50.0, D1, "chase", "FROM MAINGI K M")

    forward = [chase_debit_d0, starling_debit_d0, credit_d0,
               chase_debit_d1, starling_debit_d1, credit_d1]
    reversed_order = [starling_debit_d0, chase_debit_d0, credit_d0,
                       starling_debit_d1, chase_debit_d1, credit_d1]

    dest_forward = _learn_transfer_destinations(forward, account_map, KIND_MAP)
    dest_reversed = _learn_transfer_destinations(reversed_order, account_map, KIND_MAP)

    assert dest_forward == dest_reversed
    assert dest_forward["KEVIN MAINGI CHASEACCOUNT STO"]["dest_account_id"] == "chase"
    # Starling never wins a single credit (Chase always has the only
    # affinity for this destination), so it never reaches the evidence
    # gate at all, it isn't merely rejected there.
    assert "KEVIN MAINGI STARLING STO" not in dest_forward


def test_contended_credit_both_affinity_is_learned_by_neither():
    """Two competing series that BOTH plausibly name the destination account
    ("monzo", 5 characters, clears the affinity floor unlike the 4-character
    "hsbc") are just as unresolvable as neither naming it: affinity must
    pick out exactly one series, not merely at least one, or the credit is
    left unconsumed."""
    raw = [
        _t("d1", "debit", 50.0, D0, "barclays", "KEVIN MONZO PRIMARY STO"),
        _t("d2", "debit", 50.0, D0, "natwest", "MONZO BACKUP SAVER STO"),
        _t("c1", "credit", 50.0, D0, "monzo", "INBOUND"),
        _t("d3", "debit", 50.0, D1, "barclays", "KEVIN MONZO PRIMARY STO"),
        _t("d4", "debit", 50.0, D1, "natwest", "MONZO BACKUP SAVER STO"),
        _t("c2", "credit", 50.0, D1, "monzo", "INBOUND"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert "KEVIN MONZO PRIMARY STO" not in dest
    assert "MONZO BACKUP SAVER STO" not in dest


def test_uncontended_credit_matches_even_with_zero_affinity():
    """The common case, and the one that protects every real destination in
    this user's live data: most debit descriptions do not name their
    destination at all ("PAYDAY SWEEP" says nothing about "HSBC Current"),
    and that must not matter when the credit isn't contended by any other
    series. Affinity is only ever consulted to break a genuine collision;
    an uncontended match must keep working exactly as it did before this
    fix, or the fix would have made the common case stricter."""
    raw = [
        _t("d1", "debit", 300.0, D0, "barclays", "PAYDAY SWEEP"),
        _t("c1", "credit", 300.0, D0, "hsbc", "PAYDAY SWEEP INBOUND"),
        _t("d2", "debit", 300.0, D1, "barclays", "PAYDAY SWEEP"),
        _t("c2", "credit", 300.0, D1, "hsbc", "PAYDAY SWEEP INBOUND"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert dest["PAYDAY SWEEP"]["dest_account_id"] == "hsbc"


def test_generic_tokens_do_not_confer_affinity():
    """Direct coverage of the exclusion list: an account whose provider and
    name are made up entirely of generic banking vocabulary must yield no
    affinity tokens at all, so it can never win a contended credit by
    accident just because a debit description happens to say "account" or
    "everyday" or "current"."""
    generic_acct = {"provider": "Personal Banking Limited", "name": "Everyday Current Account"}
    assert analytics._affinity_tokens(generic_acct) == set()
    assert analytics._has_affinity(
        "kevin maingi personal banking everyday current account sto", generic_acct,
    ) is False

    # A genuinely distinctive provider name still clears the bar once the
    # generic words around it are stripped out.
    real_acct = {"provider": "Chase UK", "name": "Main G"}
    assert analytics._affinity_tokens(real_acct) == {"chase"}
    assert analytics._has_affinity("kevin maingi chaseaccount sto", real_acct) is True
    assert analytics._has_affinity("kevin maingi starling sto", real_acct) is False


def test_credit_card_destination_never_learned():
    """The only candidate credit sits on a credit card, excluded from
    candidacy entirely (a credit-card 'balance' is a limit, not cash), so
    even a perfect repeated match never becomes a destination."""
    raw = [
        _t("d1", "debit", 500.0, D0, "barclays", "PAYMENT TO CARD"),
        _t("c1", "credit", 500.0, D0, "amex", "PAYMENT TO CARD"),
        _t("d2", "debit", 500.0, D1, "barclays", "PAYMENT TO CARD"),
        _t("c2", "credit", 500.0, D1, "amex", "PAYMENT TO CARD"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert "PAYMENT TO CARD" not in dest


# ── _build_cashflow_response: mirroring into internal_inflows ───────────────

def _cached(recurring_spend, recurring_income=None):
    return {
        "recurring_spend": recurring_spend,
        "recurring_income": recurring_income or [],
        "avg_daily_spend": 0,
        "available_balance": 0,
        "spendable_balance": 0,
        "savings_balance": 0,
    }


def _pattern(**overrides):
    base = {
        "key": "KEVIN MAINGI HSBC STO",
        "avg_amount": 1758.33,
        "avg_interval": 45,  # outside weekly/monthly stepping ranges: exactly one occurrence in the 35-day window
        "next_date": (date.today() + timedelta(days=5)).isoformat(),
        "account_id": "barclays",
        "account_name": "Barclays Current",
        "account_bank": "barclays",
        "account_balance": 5000.0,
        "is_credit_card": False,
        "category": "Transfer",
        "monthly_anchor": None,
        "dest_account_id": "hsbc",
        "dest_account_name": "HSBC Current",
        "dest_account_bank": "hsbc",
        "dest_account_spendable": True,
    }
    base.update(overrides)
    return base


def _run_build_response(monkeypatch, recurring_spend, *, recurring_income=None, observed=None):
    monkeypatch.setattr(analytics, "transactions_col", FakeCol(observed or []))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    return asyncio.run(_build_cashflow_response(
        _cached(recurring_spend, recurring_income), uid=UID, prefs={},
    ))


def test_mirrored_inflow_shape_matches_source_bill(monkeypatch):
    resp = _run_build_response(monkeypatch, [_pattern()])
    assert len(resp["upcoming_bills"]) == 1
    bill = resp["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT

    assert len(resp["internal_inflows"]) == 1
    inflow = resp["internal_inflows"][0]
    # Amount/date/days_away are byte-identical to the source occurrence:
    # the real debit leg and credit leg post for the exact same amount.
    assert inflow["name"] == bill["name"]
    assert inflow["amount"] == bill["amount"]
    assert inflow["expected_date"] == bill["expected_date"]
    assert inflow["days_away"] == bill["days_away"]
    # But the account fields point at the DESTINATION, not the source.
    assert inflow["account_id"] == "hsbc"
    assert inflow["account_name"] == "HSBC Current"
    assert inflow["account_bank"] == _bank_label("hsbc")
    assert inflow["source_account_id"] == "barclays"
    assert inflow["source_account_name"] == "Barclays Current"
    # HSBC Current is an ordinary current account, so it belongs to the
    # spendable pool: a pooled consumer may credit this inflow.
    assert inflow["destination_spendable"] is True


def test_mirror_to_savings_destination_is_learned_but_not_pool_spendable(monkeypatch):
    """A standing order into the user's own savings pot must still be
    learned and still mirrored (the per-account walk genuinely receives
    that money and needs to know it), but `_split_balances` buckets a
    savings-subtype account into savings_balance, not spendable_balance, so
    the mirror must say so via `destination_spendable`, letting a POOLED
    consumer (spendable_balance) skip crediting an inflow against a pool
    that structurally never contained the destination account."""
    pattern = _pattern(
        dest_account_id="rainyday",
        dest_account_name="Rainy Day Saver",
        dest_account_bank="hsbc",
        dest_account_spendable=False,
    )
    resp = _run_build_response(monkeypatch, [pattern])
    assert len(resp["upcoming_bills"]) == 1  # still learned and still a bill
    assert len(resp["internal_inflows"]) == 1  # still mirrored
    inflow = resp["internal_inflows"][0]
    assert inflow["account_id"] == "rainyday"
    assert inflow["destination_spendable"] is False


def test_learn_transfer_destinations_flags_savings_destination_correctly():
    """Direct coverage of the source of truth for `dest_account_spendable`:
    a savings-subtype account matches just as readily as a current account
    (matching does not change), but the evidence-gate result carries
    `dest_account_spendable: False` because `account_map["rainyday"]` was
    built with `is_spendable: False` (see `_account_pool_kind`)."""
    raw = [
        _t("d1", "debit", 100.0, D0, "barclays", "RAINY DAY SAVER STO RAINY DAY SAVER"),
        _t("c1", "credit", 100.0, D0, "rainyday", "RAINY DAY SAVER STO RAINY DAY SAVER"),
        _t("d2", "debit", 100.0, D1, "barclays", "RAINY DAY SAVER STO RAINY DAY SAVER"),
        _t("c2", "credit", 100.0, D1, "rainyday", "RAINY DAY SAVER STO RAINY DAY SAVER"),
    ]
    dest = _learn_transfer_destinations(raw, ACCOUNT_MAP, KIND_MAP)
    assert dest["RAINY DAY SAVER STO RAINY DAY SAVER"]["dest_account_id"] == "rainyday"
    assert dest["RAINY DAY SAVER STO RAINY DAY SAVER"]["dest_account_spendable"] is False


def test_mirror_dropped_when_source_occurrence_closed_by_observed_debit(monkeypatch):
    """An early payment already posted (observed) closes the bill occurrence
    before it's ever "due", `_match_observed` drops it from `kept`. Its
    mirror must vanish with it, since the mirror only ever looks at what
    survived into `kept`."""
    observed_debit = {
        "user_id": UID,
        "transaction_type": "debit",
        "merchant_name": None,
        "description": "KEVIN MAINGI HSBC STO",
        "amount": 1758.33,
        "date": date.today(),
        "category": "Transfer",
        "custom_category": None,
        "account_id": "barclays",
    }
    resp = _run_build_response(monkeypatch, [_pattern()], observed=[observed_debit])
    assert resp["upcoming_bills"] == []
    assert resp["internal_inflows"] == []


def test_no_mirror_when_pattern_has_no_learned_destination(monkeypatch):
    pattern = _pattern(dest_account_id=None, dest_account_name=None, dest_account_bank=None)
    resp = _run_build_response(monkeypatch, [pattern])
    assert len(resp["upcoming_bills"]) == 1
    assert resp["internal_inflows"] == []


# ── upcoming_bills stamping: dest_account_id / dest_account_spendable ───────
#
# Owner feedback on the live Planning list: the POOLED "£X left" runway
# (balance_after, seeded from spendable_balance) treats an internal
# transfer between two of the user's own spendable accounts as real
# spend, inflating every intermediate figure. The frontend fix is to skip
# BOTH legs of a traced transfer for that pooled total, so the bill itself
# needs to carry its learned destination, matching bills to
# `internal_inflows` by name/date in the frontend would be fragile.
# `internal_inflows` and the per-account walks that consume it are
# untouched by this: they still need every field exactly as before.

def test_movement_bill_with_learned_destination_carries_dest_fields(monkeypatch):
    resp = _run_build_response(monkeypatch, [_pattern()])
    bill = resp["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT
    assert bill["dest_account_id"] == "hsbc"
    assert bill["dest_account_spendable"] is True


def test_movement_bill_without_learned_destination_carries_none(monkeypatch):
    pattern = _pattern(dest_account_id=None, dest_account_name=None,
                        dest_account_bank=None, dest_account_spendable=None)
    resp = _run_build_response(monkeypatch, [pattern])
    bill = resp["upcoming_bills"][0]
    assert bill["kind"] == MOVEMENT
    assert bill.get("dest_account_id") is None
    assert bill.get("dest_account_spendable") is None


def test_non_movement_bill_never_carries_dest_fields(monkeypatch):
    """Belt-and-braces, mirroring the same kind check `_build_cashflow_response`
    already applies before mirroring into `internal_inflows`:
    `_learn_transfer_destinations` only ever populates a destination for a
    MOVEMENT-kind series, but this asserts the gate directly on the bill
    entry itself, in case a future caller ever attaches `dest_account_id` to
    a non-MOVEMENT pattern by mistake."""
    pattern = _pattern(category="Groceries", dest_account_id="hsbc",
                        dest_account_name="HSBC Current", dest_account_bank="hsbc",
                        dest_account_spendable=True)
    resp = _run_build_response(monkeypatch, [pattern])
    bill = resp["upcoming_bills"][0]
    assert bill["kind"] != MOVEMENT
    assert bill.get("dest_account_id") is None
    assert bill.get("dest_account_spendable") is None


def test_planned_one_off_never_carries_dest_fields(monkeypatch):
    """The planned-one-off branch (merged in from `planned_expenses_col`)
    never carries a learned destination at all, Task 1 explicitly excludes
    it: a one-off plan has no recurring series for `_learn_transfer_destinations`
    to have learned anything about."""
    planned_doc = {
        "_id": "planned1", "user_id": UID, "status": "planned",
        "name": "New sofa", "amount": 400.0,
        "date": date.today() + timedelta(days=3),
        "account_id": None,
    }
    monkeypatch.setattr(analytics, "transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_overrides_col", FakeCol([]))
    monkeypatch.setattr(analytics, "upcoming_rules_col", FakeCol([]))
    monkeypatch.setattr(analytics, "planned_expenses_col", FakeCol([planned_doc]))
    monkeypatch.setattr(analytics, "get_category_kinds", _fake_get_category_kinds)
    resp = asyncio.run(_build_cashflow_response(_cached([]), uid=UID, prefs={}))
    assert len(resp["upcoming_bills"]) == 1
    bill = resp["upcoming_bills"][0]
    assert bill.get("planned") is True
    assert "dest_account_id" not in bill
    assert "dest_account_spendable" not in bill


# ── Task 2 (Chase/mono tracing): investigated against live UAT data, NOT
# shipped. Full findings are in the handoff report, summarised here so a
# future reader does not have to re-run the same probes:
#
# `mono_accounts_col`/`mono_transactions_col` hold zero documents for ANY
# user in the live UAT database (verified with a direct read-only query),
# and the Chase account behind the owner's report ("KEVIN MAINGI
# CHASEACCOUNT STO") is a Finexer-sourced row already inside `accounts_col`
# (provider "Chase UK", source "finexer"), already inside `account_map` and
# `raw` today. Widening `_compute_cashflow_patterns` to also read
# `mono_accounts_col`/`mono_transactions_col` would therefore be a pure
# no-op against real data and would not fix the reported bug. The real
# cause, confirmed by running `_compute_cashflow_patterns` against live
# data: a same-day, same-amount coincidence with an unrelated series
# ("KEVIN MAINGI STARLING STO", also a real recurring transfer) makes the
# greedy matcher's account_id/id tiebreak award the one real destination
# credit inconsistently across the two occurrences that have one, so
# neither series ever reaches the evidence gate's 2-match bar. That is a
# separate, deliberate fix, out of this task's scope.
#
# The two tests below document, rather than exercise, the mono account-doc
# SHAPE `mono_sync.sync_mono_connection` actually writes (see
# app/services/mono_sync.py), so a future widening starts from a verified
# shape instead of an assumed one: no `subtype` field is ever written, only
# `type` (the Mono API's own type string, lowercased with spaces turned to
# underscores).

def test_mono_account_shape_transaction_account_classified_spendable():
    """A mono bank-type account with no dedicated subtype (mono_sync.py never
    writes one) falls through to the same "no subtype, not a credit card"
    default an ordinary current account would use."""
    acct = {"name": "Main G", "type": "current_account", "balance": 50.0,
            "currency": "GBP", "provider": "Mono"}
    assert analytics._account_pool_kind(acct) == "spendable"
    assert analytics.is_credit_card_account(acct) is False


def test_mono_account_shape_savings_type_not_recognised_as_savings():
    """Documents a known, pre-existing gap rather than a new one:
    `mono_sync.py` writes `type`, never `subtype`, so a savings-type mono
    account is NOT bucketed into the savings pool by `_account_pool_kind`
    (which only ever inspects `subtype` for its "saving" test) -- it falls
    through to the same spendable default as any other no-subtype account.
    `_account_pool_kind`'s own docstring already calls this out ("covers
    e.g. Mono accounts, which don't populate subtype today"). Flagged here
    so a future mono-savings widening does not silently assume `subtype`
    exists."""
    acct = {"name": "Round up", "type": "savings_account", "balance": 0.0,
            "currency": "GBP", "provider": "Mono"}
    assert analytics._account_pool_kind(acct) == "spendable"


def test_mono_account_shape_credit_card_excluded():
    """A mono credit-card-type account is excluded on the `type` field
    alone (mono_sync.py lowercases and underscores the Mono API's `type`);
    `is_credit_card_account`/`_account_pool_kind`'s credit exclusion never
    depends on `subtype`, so this classifies correctly even though mono
    never populates it."""
    acct = {"name": "Credit Card", "type": "credit_card", "balance": -100.0,
            "currency": "GBP", "provider": "Mono"}
    assert analytics._account_pool_kind(acct) is None
    assert analytics.is_credit_card_account(acct) is True


def test_upcoming_income_unaffected_by_internal_inflows(monkeypatch):
    income_pattern = {
        "key": "ACME PAYROLL",
        "avg_amount": 2500.0,
        "avg_interval": 45,
        "next_date": (date.today() + timedelta(days=7)).isoformat(),
        "account_id": "barclays",
        "account_name": "Barclays Current",
        "account_bank": "barclays",
        "account_balance": 5000.0,
        "category": "Income",
        "occurrences": 3,
        "amounts_recent": [2500.0, 2500.0, 2500.0],
    }
    resp_with = _run_build_response(monkeypatch, [_pattern()], recurring_income=[income_pattern])
    resp_without = _run_build_response(monkeypatch, [], recurring_income=[income_pattern])
    assert resp_with["upcoming_income"] == resp_without["upcoming_income"]
    assert len(resp_with["upcoming_income"]) == 1
    assert resp_with["upcoming_income"][0]["amount"] == 2500.0


# ── at_risk_count: consuming internal_inflows in the running-balance walk ───

def _run_at_risk(monkeypatch, bills, inflows, *, next_pay_in_days=10):
    import app.services.pay_period as pay_period
    import app.services.income as income

    def fake_confirmed_payday(prefs, today_d):
        return None

    def fake_next_payday(today_d, pay_cfg):
        return today_d + timedelta(days=next_pay_in_days)

    monkeypatch.setattr(income, "get_confirmed_payday", fake_confirmed_payday)
    monkeypatch.setattr(pay_period, "_next_payday", fake_next_payday)

    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]),
    )
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": inflows}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    result = asyncio.run(analytics.at_risk_count(user={"email": UID}))
    return result["count"]


def _bill(name, days_away, amount, account_id, balance, kind="commitment"):
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_balance": balance,
        "is_credit_card": False, "kind": kind,
        # Only read by spend_impact._bills_risk (for its result payload),
        # but harmless to carry on every bill fixture.
        "expected_date": (date.today() + timedelta(days=days_away)).isoformat(),
    }


def _inflow(days_away, amount, account_id):
    return {
        "name": "KEVIN MAINGI HSBC STO", "amount": amount, "days_away": days_away,
        "account_id": account_id, "account_name": "HSBC Current", "account_bank": "HSBC",
        "source_account_id": "barclays", "source_account_name": "Barclays Current",
    }


def test_shortfall_covered_by_later_inflow_no_longer_at_risk(monkeypatch):
    """HSBC starts on a low balance and has a real bill after the mirrored
    STO inflow lands. Crediting the inflow first (it's earlier in the
    walk) means the bill is genuinely covered, and the previously-false
    "at risk" flag must clear."""
    bills = [_bill("Council Tax", 4, 100.0, "hsbc", 10.0)]
    inflows = [_inflow(2, 1758.33, "hsbc")]
    assert _run_at_risk(monkeypatch, bills, inflows) == 0


def test_genuinely_short_account_still_counted_alongside_covered_one(monkeypatch):
    """NatWest has no inflow to cover its own shortfall, it must still
    trip the badge even while HSBC's identical-shaped deficit is being
    correctly suppressed by its mirrored inflow."""
    bills = [
        _bill("Council Tax", 4, 100.0, "hsbc", 10.0),
        _bill("Gym", 3, 60.0, "natwest", 10.0),
    ]
    inflows = [_inflow(2, 1758.33, "hsbc")]
    assert _run_at_risk(monkeypatch, bills, inflows) == 1


def test_inflow_never_seeds_a_new_account_into_running(monkeypatch):
    """An inflow whose destination account has no assessable bill of its
    own must never itself create an at-risk entry. An account absent from
    `running` never enters the walk at all, income or not."""
    bills = [_bill("Gym", 3, 60.0, "natwest", 100.0)]
    inflows = [_inflow(2, 1758.33, "hsbc")]  # "hsbc" never appears in bills
    assert _run_at_risk(monkeypatch, bills, inflows) == 0


# ── companion.compute_today_items: direct coverage of the same wiring ───────
#
# compute_today_items is a large function touching many collections beyond
# the cashflow walk (companion_items_col for card state, savings_insights_col
# and behaviour_portrait_col for unrelated celebration/coaching cards,
# card_terms_col for 0%-promo cards). This harness fakes all of them so the
# function runs end to end for real, then inspects the SAME shared
# `_walk_events` this module's at_risk_count test already exercises, proving
# the wiring is genuinely identical across both call sites rather than
# merely reviewed by eye.

def _run_compute_today_items(monkeypatch, bills, inflows):
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    # savings_insights_col / card_terms_col are imported locally, inside the
    # function body, from app.db.collections on every call, so they must be
    # patched at that source module rather than on `companion`.
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    # app.services.pace imports its OWN module-level cashflow_cache_col /
    # transactions_col / yapily_transactions_col / preferences_col (from
    # app.db.collections, at import time), read/written by
    # compute_today_items's rhythm-checkpoint pass via
    # pace._read_cached_baseline / _write_cached_baseline. Patching only
    # `companion`'s names left this write path pointed at the REAL database
    # (root cause of a "kevin" fixture doc found polluting the live
    # cashflow_cache collection, 2026-08-28) — patch pace's own references
    # too so this suite never touches Mongo.
    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": inflows}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    # Spy on the actual shared walk this module calls, capturing the events
    # list from its FIRST invocation (the conservative walk built in step 4;
    # later calls re-sort the same list, so the first call is enough evidence
    # of what got fed in).
    captured: dict = {}
    real_walk = companion._walk_events

    def spy_walk_events(events, balances):
        if "events" not in captured:
            captured["events"] = list(events)
        return real_walk(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy_walk_events)

    # Spy on income_credit_ok, the ONLY gate that feeds `credited_incomes`
    # (see companion.py's window_income loop). The inflow loop deliberately
    # never calls this, so asserting it below.
    credited_calls: list = []
    real_income_credit_ok = companion.income_credit_ok

    def spy_income_credit_ok(item, account_id, confirmed_keys=frozenset()):
        credited_calls.append(item)
        return real_income_credit_ok(item, account_id, confirmed_keys)

    monkeypatch.setattr(companion, "income_credit_ok", spy_income_credit_ok)

    items = asyncio.run(companion.compute_today_items(UID))
    return items, captured, credited_calls


def test_compute_today_items_credits_inflow_into_the_shared_walk(monkeypatch):
    bills = [_bill("Council Tax", 4, 100.0, "hsbc", 10.0)]
    inflow = _inflow(2, 1758.33, "hsbc")
    items, captured, credited_calls = _run_compute_today_items(monkeypatch, bills, [inflow])

    assert isinstance(items, list)  # the function completed a full real run
    inflow_events = [
        e for e in captured["events"]
        if e[3] and e[1] == "hsbc" and e[2] == 1758.33 and e[4] is inflow
    ]
    assert len(inflow_events) == 1
    assert inflow_events[0][0] == 2  # days_away carried through unchanged

    # Doctrine check (owner-approved rewording of the audit's ask): an
    # internal transfer must never be disclosed to the user as INCOME, so it
    # must never pass through the one gate that feeds `credited_incomes`
    # (assumed_incomes on the Payday Plan card, the same-day-income
    # recommendation gate).
    assert all(call is not inflow for call in credited_calls)


def test_compute_today_items_ignores_inflow_for_account_with_no_bill(monkeypatch):
    """Same seed-guard as at_risk_count: an inflow whose destination has no
    assessable bill of its own must never reach the walk at all."""
    bills = [_bill("Gym", 3, 60.0, "natwest", 100.0)]
    inflow = _inflow(2, 1758.33, "hsbc")  # "hsbc" never appears in bills
    items, captured, credited_calls = _run_compute_today_items(monkeypatch, bills, [inflow])

    assert isinstance(items, list)
    assert all(not (e[3] and e[4] is inflow) for e in captured["events"])


# ── spend_impact: direct coverage of the same wiring, in the third walk ─────

def _run_cashflow_window(monkeypatch, bills, inflows, *, next_pay_in_days=10):
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(spend_impact, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(spend_impact, "preferences_col", FakeCol([]))
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=next_pay_in_days))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": inflows}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    return asyncio.run(spend_impact._cashflow_window(UID))


def test_cashflow_window_wires_internal_inflow_into_events(monkeypatch):
    """Direct coverage of the third walk's own window builder (the function
    `_bills_risk` calls): the same inflow-crediting addition made to
    analytics.at_risk_count and companion.compute_today_items, exercised
    here through its own public entry point rather than by inspection."""
    bills = [_bill("Council Tax", 4, 100.0, "hsbc", 10.0)]
    inflow = _inflow(2, 1758.33, "hsbc")
    window = _run_cashflow_window(monkeypatch, bills, [inflow])
    assert window is not None
    matches = [e for e in window["events"] if e[3] and e[1] == "hsbc" and e[4] is inflow]
    assert len(matches) == 1
    assert matches[0][0] == 2
    assert matches[0][2] == 1758.33


def test_cashflow_window_never_seeds_new_account(monkeypatch):
    bills = [_bill("Gym", 3, 60.0, "natwest", 100.0)]
    inflow = _inflow(2, 1758.33, "hsbc")  # never appears in bills
    window = _run_cashflow_window(monkeypatch, bills, [inflow])
    assert window is not None
    assert all(not (e[3] and e[4] is inflow) for e in window["events"])
    assert "hsbc" not in window["balances"]


def _run_bills_risk(monkeypatch, bills, inflows, *, total_excess, days_elapsed, days_left, salary_acct):
    _run_cashflow_window_patches_only(monkeypatch, bills, inflows)
    monkeypatch.setattr(spend_impact, "_infer_salary_account", _fake_async(salary_acct))
    monkeypatch.setattr(spend_impact, "_live_balances_map", _fake_async({}))
    period = {"days_elapsed": days_elapsed, "days_left": days_left}
    return asyncio.run(spend_impact._bills_risk(UID, total_excess, period))


def _run_cashflow_window_patches_only(monkeypatch, bills, inflows, *, next_pay_in_days=10):
    """Same monkeypatching as `_run_cashflow_window`, without calling it, so
    `_bills_risk` can drive `_cashflow_window` itself internally."""
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(spend_impact, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(spend_impact, "preferences_col", FakeCol([]))
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=next_pay_in_days))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": inflows}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)


def _fake_async(value):
    async def _inner(*args, **kwargs):
        return value
    return _inner


def test_bills_risk_uses_inflow_corrected_baseline(monkeypatch):
    """Without the inflow wired in, HSBC's baseline (bill alone, £10 start,
    £55 Council Tax) would already be negative, and `_bills_risk` would
    exclude it from causation (a pre-existing shortfall is companion's
    territory, not a spend-pace consequence). WITH the inflow correctly
    credited first, the baseline clears (£10 + £50 - £55 = £5 >= 0), so the
    account is a legitimate causation candidate once the extra "at this
    pace" outflow is layered in and pushes it back under the floor at
    exactly the real bill's event, not before."""
    bill = _bill("Council Tax", 5, 55.0, "hsbc", 10.0)
    inflow = _inflow(2, 50.0, "hsbc")

    result = _run_bills_risk(
        monkeypatch, [bill], [inflow],
        total_excess=25.0, days_elapsed=5, days_left=3, salary_acct="hsbc",
    )
    assert result is not None
    assert result["bill"]  # humanised Council Tax name
    assert result["amount"] == 55


def test_bills_risk_silent_when_inflow_absent_leaves_baseline_already_short(monkeypatch):
    """Same scenario with the inflow removed: the baseline is already
    negative from the bill alone, so the causation gate correctly excludes
    it (this is NOT a demonstration of a bug, it documents that a
    pre-existing shortfall is out of `_bills_risk`'s scope by design;
    companion.py's own shortfall detection owns that case)."""
    bill = _bill("Council Tax", 5, 55.0, "hsbc", 10.0)
    result = _run_bills_risk(
        monkeypatch, [bill], [],
        total_excess=25.0, days_elapsed=5, days_left=3, salary_acct="hsbc",
    )
    assert result is None


# ── Lower priority: _detect_recurring has no account scoping on series_key ──

def test_series_key_collision_across_accounts_is_a_known_non_goal():
    """`_detect_recurring` (analytics.py) buckets purely by `series_key`,
    with no account scoping. Two DIFFERENT recurring internal transfers,
    from two DIFFERENT source accounts, that happen to share a generic
    description with no merchant_name (e.g. a bare "STANDING ORDER") will
    collide into one bucket and be treated as a single series with one
    learned destination. Not present in this user's real data (every real
    series carries a distinguishing reference), and out of scope for this
    fix: this test documents the behaviour rather than asserting it is
    correct, so a future reader does not have to rediscover it from
    scratch. `_learn_transfer_destinations` inherits whatever
    `_detect_recurring` already decided a series' identity is; it does not
    introduce this gap."""
    from app.routers.analytics import _detect_recurring

    def txn(day, amount, account_id):
        return {
            "merchant_name": None, "description": "STANDING ORDER",
            "amount": amount, "date": datetime(2026, 1, 1) + timedelta(days=day),
            "category": "Transfer", "custom_category": None, "account_id": account_id,
        }

    txns = [
        txn(0, 100.0, "barclays"),   # really: Barclays -> Savings A
        txn(30, 100.0, "barclays"),
        txn(2, 40.0, "natwest"),     # really: NatWest -> Savings B, unrelated
        txn(32, 40.0, "natwest"),
    ]
    # today pinned a few days after the last occurrence (2026-02-02) so the
    # staleness guard (analytics.py, added 2026-08-27) doesn't drop the
    # series purely because the real wall clock has moved on since this
    # fixture was written — see today_at()'s docstring in test_recurring.py
    # for the same fix applied there.
    results = _detect_recurring(txns, trusted_categories={"Transfer"}, today=date(2026, 2, 6))
    keys = {r["key"] for r in results}
    # Both unrelated transfers collapse into the SAME "STANDING ORDER" key,
    # confirming the collision is real and not already guarded against.
    assert keys == {"STANDING ORDER"}
