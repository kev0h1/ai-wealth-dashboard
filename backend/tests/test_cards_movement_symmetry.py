"""Coverage for G24 (2026-09-10): the cards-story movement block must be
symmetric across debits and credits (app/routers/cards.py, `cards_story`).

Before this fix, `moved_between_cards` named the movement-kind PORTION of
card debits (a balance transfer received onto a card), but there was no
equivalent field for the movement-kind portion of card credits (a balance
paid down by transfer, e.g. a "PAYMENT - THANK YOU" categorised Transfer) —
so a caller could see "£877 moved onto this card" but had no way to see the
mirror fact ("£123 of what looks like a payment was actually money moved off
the card by transfer") without re-deriving it from raw transactions.

`delta` (full debits minus full credits, unconditional on category) was
already the TRUE net balance change — `_abs_amounts` never filtered credits
by category — so this file also locks that down as an explicit regression
guard, per the G24 backlog item's ask, even though it was not actually
broken: a period containing both a movement-kind debit AND a movement-kind
credit must report `delta == total_debits - total_credits` exactly, and
`new_spend` must exclude both.

No mongomock is available in this environment, so this file reuses the same
fake-collection / monkeypatch pattern established in
test_cards_story_outlook.py / test_cards_drivers_reconcile.py.
"""
import asyncio
from datetime import date, datetime

import app.routers.cards as cards
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS


UID = "kevin"
D1 = date(2026, 9, 5)


class _FixedDate(date):
    _fixed = date(2026, 9, 9)

    @classmethod
    def today(cls):
        return cls._fixed


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    async def to_list(self, n):
        return list(self._docs[: n if n is not None else len(self._docs)])


class FakeCol:
    """Stand-in for a Motor collection — only the handful of methods
    cards_story's dependencies actually call are implemented."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor(self.docs)

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None


def _acc(account_id, name, provider, balance):
    return {"account_id": account_id, "name": name, "provider": provider, "balance": balance}


def _txn(account_id, amount, on_date, ttype, category, desc="Payee"):
    return {
        "account_id": account_id,
        "amount": amount,
        "date": datetime(on_date.year, on_date.month, on_date.day),
        "transaction_type": ttype,
        "category": category,
        "custom_category": None,
        "description": desc,
    }


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


def _run(monkeypatch, accounts, cc_ids, txns, *, which="current"):
    monkeypatch.setattr(cards, "date", _FixedDate)
    monkeypatch.setattr(cards, "preferences_col", FakeCol([]))
    monkeypatch.setattr(cards, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(cards, "account_rates_col", FakeCol([]))
    monkeypatch.setattr(cards, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(cards, "needle_history_col", FakeCol([]))
    monkeypatch.setattr(cards, "get_category_kinds", _fake_get_category_kinds)

    async def _fake_cc_ids(uid):
        return set(cc_ids)

    async def _fake_txns_for_period(uid, start, end, account_ids=None):
        return txns

    monkeypatch.setattr(cards, "_credit_card_account_ids", _fake_cc_ids)
    monkeypatch.setattr(cards, "_txns_for_period", _fake_txns_for_period)

    async def _fake_get_debt_plan_cached(uid):
        return {"cards": [], "extra_to_clear": None}

    monkeypatch.setattr(cards, "get_debt_plan_cached", _fake_get_debt_plan_cached)

    return asyncio.run(cards.cards_story(user={"email": UID}, which=which))


# A period with a movement-kind DEBIT (balance transfer received, £461.02 —
# Kevin's real NatWest BT000254 amount), a movement-kind CREDIT (a card
# paid down by transfer, £806.00 — the M&S "PAYMENT - THANK YOU" scenario
# the G24 backlog item names), a genuine spend debit (£50 Groceries), and a
# genuine spend/refund credit (£10 Shopping refund) so every quadrant of the
# debit/credit x spend/movement matrix is covered in one fixture.
_SPEND_DEBIT = 50.0
_MOVEMENT_DEBIT = 461.02
_SPEND_CREDIT = 10.0
_MOVEMENT_CREDIT = 806.00


def _mixed_direction_fixture():
    accounts = [_acc("cc_a", "NatWest Mastercard", "natwest", -900.0)]
    cc_ids = {"cc_a"}
    txns = [
        _txn("cc_a", _SPEND_DEBIT, D1, "debit", "Groceries"),
        _txn("cc_a", _MOVEMENT_DEBIT, D1, "debit", "Transfer", desc="BALANCE TRANSFER BT000254"),
        _txn("cc_a", _SPEND_CREDIT, D1, "credit", "Shopping", desc="Refund"),
        _txn("cc_a", _MOVEMENT_CREDIT, D1, "credit", "Transfer", desc="PAYMENT - THANK YOU"),
    ]
    return accounts, cc_ids, txns


def test_delta_is_symmetric_true_net_change_across_both_kinds(monkeypatch):
    accounts, cc_ids, txns = _mixed_direction_fixture()
    story = _run(monkeypatch, accounts, cc_ids, txns)
    movement = story["movement"]

    total_debits = round(_SPEND_DEBIT + _MOVEMENT_DEBIT, 2)
    total_credits = round(_SPEND_CREDIT + _MOVEMENT_CREDIT, 2)

    # The core regression guard the G24 backlog item asked for: delta must
    # equal ALL debits minus ALL credits, regardless of category — a
    # movement-kind credit must offset a movement-kind debit exactly like a
    # movement-kind debit is already counted, not be silently dropped.
    assert movement["delta"] == round(total_debits - total_credits, 2)

    # new_spend stays spend-only: neither the movement debit nor the
    # movement credit (nor the spend credit/refund, which new_spend has
    # never netted off — it is a debit-only figure) enters it.
    assert movement["new_spend"] == _SPEND_DEBIT

    # moved_between_cards is unaffected: still exactly the movement debit.
    assert movement["moved_between_cards"] == _MOVEMENT_DEBIT

    # movement_in (G24's new field) is exactly the movement-kind credit —
    # previously nameable nowhere on this payload.
    assert movement["movement_in"] == _MOVEMENT_CREDIT

    # payments keeps its historical meaning: every credit, unconditional on
    # category (movement_in is a named SUBSET of it, not an addition).
    assert movement["payments"] == total_credits


def test_movement_in_zero_when_no_movement_kind_credits(monkeypatch):
    accounts = [_acc("cc_a", "NatWest Mastercard", "natwest", -100.0)]
    cc_ids = {"cc_a"}
    txns = [
        _txn("cc_a", 50.0, D1, "debit", "Groceries"),
        _txn("cc_a", 10.0, D1, "credit", "Shopping", desc="Refund"),
    ]
    story = _run(monkeypatch, accounts, cc_ids, txns)
    movement = story["movement"]

    assert movement["movement_in"] == 0.0
    assert movement["payments"] == 10.0
    assert movement["delta"] == 40.0
