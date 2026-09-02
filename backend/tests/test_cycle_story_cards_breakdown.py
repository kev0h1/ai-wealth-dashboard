"""Coverage for the cards chapter's per-card breakdown (`compute_cycle_story`,
app/services/cycle_story.py).

Contract under test: `chapters.cards.breakdown` — one row per credit card
account the user has (ALL of them, including dormant cards with no new
spend this cycle), sorted new_spend descending so dormant cards rank last,
amounts absolute, direction carried by the sign of `delta` (positive =
balance grew). See PENNY_TOOLS.md / the cycle-story task brief for the full
shape.

No mongomock is available in this environment (see test_internal_inflows.py's
own note), so DB-touching collections and the needle/behaviour helpers that
compute_cycle_story pulls in are replaced with tiny fakes, following the same
pattern test_internal_inflows.py already established. compute_cycle_story is
exercised directly (not through get_cycle_story) so these tests don't need to
fake the pay-period cache or the needle "close" chapter.
"""
import asyncio
from datetime import date, datetime

import app.services.cycle_story as cycle_story
from app.services.cycle_story import compute_cycle_story
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS


UID = "kevin"
# A period that has NOT yet closed (period_end in the future relative to
# "today"), so compute_cycle_story skips its close-chapter branch entirely —
# that branch reads needle_history_col / compute_needle, which this file
# does not fake, matching this suite's narrow-scope convention of faking
# only what the code path under test actually touches.
PERIOD_START = date(2026, 8, 1)
PERIOD_END = date(2026, 8, 31)


class _FixedDate(date):
    """A `date` subclass whose `.today()` always returns a chosen calendar
    day, so `compute_cycle_story`'s `period_end < today` close-chapter
    branch (app/services/cycle_story.py) stays on the "period hasn't
    closed yet" path regardless of when this suite actually runs — without
    this, once the real wall clock passes 31 Aug 2026, `today` moves past
    PERIOD_END and compute_cycle_story takes the close-chapter branch,
    which reads needle_history_col / compute_needle (not faked here, see
    the note above). Patched in for the module-level `date` name
    `app.services.cycle_story` imports (`from datetime import date`),
    matching the pattern established in test_home_suppression_registry.py
    / test_scenario.py. Pinned mid-period (15 Aug) so it's safely inside
    [PERIOD_START, PERIOD_END] with no reliance on the current date."""

    _fixed: date = date(2026, 8, 15)

    @classmethod
    def today(cls):
        return cls._fixed


class FakeCol:
    """Stand-in for a Motor collection — only `.find()`/`.find_one()` are
    exercised by compute_cycle_story's dependencies in this test file."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


def _acc(account_id, name, provider, is_cc=True):
    return {
        "account_id": account_id,
        "name": name,
        "provider": provider,
        "type": "credit" if is_cc else "current",
    }


def _txn(account_id, amount, on_date, ttype, category="Shopping", desc="Payee"):
    """Build a raw transaction doc matching what _txns_for_period would return."""
    return {
        "account_id": account_id,
        "amount": amount,
        "date": datetime(on_date.year, on_date.month, on_date.day),
        "transaction_type": ttype,
        "category": category,
        "custom_category": None,
        "description": desc,
    }


def _run_compute(monkeypatch, accounts, cc_ids, txns, *, current_ids=None):
    monkeypatch.setattr(cycle_story, "date", _FixedDate)
    monkeypatch.setattr(cycle_story, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(cycle_story, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(cycle_story, "get_category_kinds", _fake_get_category_kinds)

    async def _fake_txns_for_period(uid, start, end, account_ids=None):
        return txns

    async def _fake_cc_ids(uid):
        return set(cc_ids)

    async def _fake_current_ids(uid):
        return current_ids or []

    monkeypatch.setattr(cycle_story, "_txns_for_period", _fake_txns_for_period)
    monkeypatch.setattr(cycle_story, "_credit_card_account_ids", _fake_cc_ids)
    monkeypatch.setattr(cycle_story, "_current_account_ids", _fake_current_ids)

    return asyncio.run(compute_cycle_story(UID, PERIOD_START, PERIOD_END))


D1 = date(2026, 8, 5)
D2 = date(2026, 8, 12)


def test_breakdown_sorted_descending(monkeypatch):
    accounts = [
        _acc("cc_small", "Small Card", "Amex"),
        _acc("cc_big", "Big Card", "Barclaycard"),
        _acc("cc_mid", "Mid Card", "HSBC"),
    ]
    cc_ids = {"cc_small", "cc_big", "cc_mid"}
    txns = [
        _txn("cc_small", 40.0, D1, "debit"),
        _txn("cc_big", 500.0, D1, "debit"),
        _txn("cc_mid", 200.0, D1, "debit"),
    ]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    breakdown = facts["cards"]["breakdown"]
    assert [row["account_id"] for row in breakdown] == ["cc_big", "cc_mid", "cc_small"]
    assert [row["new_spend"] for row in breakdown] == [500.0, 200.0, 40.0]


def test_zero_spend_card_included_ranked_last(monkeypatch):
    accounts = [
        _acc("cc_active", "Active Card", "Amex"),
        _acc("cc_dormant", "Dormant Card", "Barclaycard"),
    ]
    cc_ids = {"cc_active", "cc_dormant"}
    txns = [
        _txn("cc_active", 75.0, D1, "debit"),
        # Dormant card: only a payment (credit), no new spend this cycle.
        # It's still one of the user's cards, so it shows up as a £0 row
        # ranked last, not filtered out.
        _txn("cc_dormant", 30.0, D1, "credit"),
    ]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    breakdown = facts["cards"]["breakdown"]
    assert len(breakdown) == 2
    assert [row["account_id"] for row in breakdown] == ["cc_active", "cc_dormant"]
    dormant_row = breakdown[1]
    assert dormant_row["new_spend"] == 0.0
    # No new spend, but a £30 payment landed: balance shrank by 30.
    assert dormant_row["delta"] == -30.0


def test_breakdown_sum_reconciles_with_aggregate_new_spend(monkeypatch):
    accounts = [
        _acc("cc_a", "Card A", "Amex"),
        _acc("cc_b", "Card B", "Barclaycard"),
        _acc("cc_c", "Card C", "HSBC"),
        _acc("cc_dormant", "Dormant Card", "Monzo"),
    ]
    cc_ids = {"cc_a", "cc_b", "cc_c", "cc_dormant"}
    txns = [
        _txn("cc_a", 123.45, D1, "debit"),
        _txn("cc_a", 10.0, D2, "debit"),
        _txn("cc_b", 67.89, D1, "debit"),
        _txn("cc_c", 5.0, D1, "debit"),
        # Payments (credits) should not count towards new_spend on either side.
        _txn("cc_a", 50.0, D2, "credit"),
        # cc_dormant has no transactions at all this cycle — a £0 row that
        # must contribute nothing to either sum below.
    ]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    dormant_row = next(r for r in facts["cards"]["breakdown"] if r["account_id"] == "cc_dormant")
    assert dormant_row["new_spend"] == 0.0
    assert dormant_row["delta"] == 0.0
    aggregate_new_spend = facts["cards"]["new_spend"]
    breakdown_sum = round(sum(row["new_spend"] for row in facts["cards"]["breakdown"]), 2)
    # The aggregate rounds the sum of all cc debits once; the breakdown rounds
    # each account's sub-total to 2dp first and sums those. Both start from
    # the same 2dp GBP inputs, but the different rounding order means exact
    # float equality isn't guaranteed in general (classic summation-order
    # float drift) — so tolerate the full penny the comment/intent describes,
    # not the stricter-than-stated `< 0.01` the assertion previously used.
    assert abs(breakdown_sum - aggregate_new_spend) <= 0.01, (
        f"breakdown sum {breakdown_sum} does not reconcile with aggregate new_spend {aggregate_new_spend}"
    )

    aggregate_payments = facts["cards"]["payments"]
    breakdown_delta_sum = round(sum(row["delta"] for row in facts["cards"]["breakdown"]), 2)
    expected_delta = round(aggregate_new_spend - aggregate_payments, 2)
    assert abs(breakdown_delta_sum - expected_delta) <= 0.01


def test_breakdown_delta_sign_reflects_balance_direction(monkeypatch):
    accounts = [_acc("cc_a", "Card A", "Amex")]
    cc_ids = {"cc_a"}
    # New spend 100, payments 130: balance shrank this cycle -> negative delta.
    txns = [
        _txn("cc_a", 100.0, D1, "debit"),
        _txn("cc_a", 130.0, D2, "credit"),
    ]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    row = facts["cards"]["breakdown"][0]
    assert row["new_spend"] == 100.0
    assert row["delta"] == -30.0


def test_empty_breakdown_when_no_credit_cards(monkeypatch):
    accounts = [_acc("current_1", "Current Account", "Monzo", is_cc=False)]
    cc_ids: set = set()
    txns = [_txn("current_1", 20.0, D1, "debit")]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    assert facts["cards"]["present"] is False
    assert facts["cards"]["breakdown"] == []


def test_breakdown_row_for_card_missing_from_accounts_col(monkeypatch):
    """A card can be in cc_ids (the accounts_col + yapily_accounts_col union,
    see _credit_card_account_ids) but absent from raw_accounts (accounts_col
    only, see compute_cycle_story). Regression coverage for the contract lie
    this used to emit: name/provider are typed non-null on both
    shared/src/types.ts and frontend/lib/api.ts, so the missing-doc row must
    still satisfy that, not silently emit None."""
    accounts = [_acc("cc_known", "Known Card", "Amex")]
    # cc_orphan is credit-card-classified (present in cc_ids, e.g. because it
    # only lives in yapily_accounts_col) but there is no matching doc in
    # `accounts`, so acc_by_id.get("cc_orphan") misses.
    cc_ids = {"cc_known", "cc_orphan"}
    txns = [
        _txn("cc_known", 40.0, D1, "debit"),
        _txn("cc_orphan", 150.0, D1, "debit"),
        _txn("cc_orphan", 20.0, D2, "credit"),
    ]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    breakdown = facts["cards"]["breakdown"]

    # Sorts correctly alongside a normal card (150 > 40).
    assert [row["account_id"] for row in breakdown] == ["cc_orphan", "cc_known"]

    orphan_row = breakdown[0]
    assert orphan_row["name"] is not None and orphan_row["name"] != ""
    assert orphan_row["provider"] is not None and orphan_row["provider"] != ""
    assert isinstance(orphan_row["name"], str)
    assert isinstance(orphan_row["provider"], str)
    assert orphan_row["new_spend"] == 150.0
    assert orphan_row["delta"] == 130.0

    # Reconciles with the aggregate exactly like a normal card would.
    aggregate_new_spend = facts["cards"]["new_spend"]
    breakdown_sum = round(sum(row["new_spend"] for row in breakdown), 2)
    assert breakdown_sum == aggregate_new_spend


def test_dormant_only_card_still_appears_as_zero_row(monkeypatch):
    accounts = [
        _acc("cc_a", "Card A", "Amex"),
        _acc("current_1", "Current Account", "Monzo", is_cc=False),
    ]
    cc_ids = {"cc_a"}
    # cc_a has no transactions this cycle (dormant); an unrelated current-
    # account debit keeps raw_txns non-empty so compute_cycle_story doesn't
    # short-circuit into its {"status": "no_data"} early return. cc_a is
    # still one of the user's cards, so it shows up as a single £0 row
    # rather than an empty breakdown.
    txns = [_txn("current_1", 20.0, D1, "debit")]
    facts = _run_compute(monkeypatch, accounts, cc_ids, txns)
    assert facts["cards"]["present"] is True
    breakdown = facts["cards"]["breakdown"]
    assert len(breakdown) == 1
    assert breakdown[0]["account_id"] == "cc_a"
    assert breakdown[0]["new_spend"] == 0.0
    assert breakdown[0]["delta"] == 0.0
