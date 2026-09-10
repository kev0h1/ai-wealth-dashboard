"""Coverage for G20/G25 (2026-09-10): the cards page "What drove it" section
must always reconcile with "New spend" (app/routers/cards.py, `cards_story`),
and must show real categories only.

G20's original bug: `movement.new_spend` summed EVERY debit on the cards
(including a Transfer-categorised balance transfer), while the `drivers`
list separately dropped a hardcoded `{Transfer, Debt}` set and then
truncated to the top five categories with no accounting for the rest — so
the two headline numbers on the same page silently disagreed by however
much fell into a movement category or past the fifth driver.

G20's fix (category kind resolved through `app.services.categories`, not a
hardcoded set) solved the movement-category half of that, but reintroduced
the truncation half under a different name: it kept the top-five cut and
folded the remainder into an invented "Other categories" row — not a
category that exists anywhere else in the app — which is exactly the same
"a real category silently vanishes" bug the fix claimed to close, just
renamed. Kevin's real report: "Other categories £18.25" was exactly one
real category, Eating Out.

G25's fix: no cap, no synthetic bucket. Every real spend-kind category this
period is returned, so `sum(drivers) == new_spend` holds with nothing
invented and nothing hidden.

No mongomock is available in this environment, so this file reuses the same
fake-collection / monkeypatch pattern already established in
test_cards_story_outlook.py.
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


# Six spend categories (real card debits), one Transfer (a balance transfer —
# movement, not spend) and a payment. Eating Out is deliberately the smallest
# so it's the one that used to be pushed into "Other categories" after the
# top-five cut, matching Kevin's real report (Eating Out at £18.25 silently
# vanishing). It must now appear in `drivers` BY NAME.
_TRANSFER_AMOUNT = 876.76
_SPEND = [
    ("Groceries", 200.00),
    ("Bills", 150.00),
    ("Shopping", 40.18),
    ("Entertainment", 25.50),
    ("Transport", 20.00),
    ("Eating Out", 18.25),
]
_PAYMENT_AMOUNT = 100.0


def _seven_txn_fixture():
    accounts = [_acc("cc_a", "Amex Platinum", "amex", -1298.68)]
    cc_ids = {"cc_a"}
    txns = [_txn("cc_a", _TRANSFER_AMOUNT, D1, "debit", "Transfer")]
    for cat, amt in _SPEND:
        txns.append(_txn("cc_a", amt, D1, "debit", cat))
    txns.append(_txn("cc_a", _PAYMENT_AMOUNT, D1, "credit", "Transfer"))
    return accounts, cc_ids, txns


def test_drivers_show_every_real_category_no_truncation_no_synthetic_bucket(monkeypatch):
    accounts, cc_ids, txns = _seven_txn_fixture()
    story = _run(monkeypatch, accounts, cc_ids, txns)
    movement = story["movement"]
    drivers = story["drivers"]

    # All six real spend categories come back, nothing capped, nothing
    # invented to stand in for a cut-off remainder.
    assert len(drivers) == 6
    names = [d["category"] for d in drivers]
    assert "Transfer" not in names
    assert "Other categories" not in names
    assert set(names) == {cat for cat, _ in _SPEND}

    # The category that used to be silently folded into "Other categories"
    # now appears by its own real name, for its own real amount.
    eating_out_row = next(d for d in drivers if d["category"] == "Eating Out")
    assert eating_out_row["total"] == 18.25

    # new_spend is spend-only: the six category amounts, not the transfer.
    expected_new_spend = round(sum(amt for _, amt in _SPEND), 2)
    assert movement["new_spend"] == expected_new_spend

    # Drivers always sum to new_spend exactly — no synthetic bucket means no
    # rounding slack is needed to make that true.
    drivers_sum = round(sum(d["total"] for d in drivers), 2)
    assert drivers_sum == movement["new_spend"]

    # The transfer is isolated in moved_between_cards, not folded into
    # new_spend and not counted as a driver.
    assert movement["moved_between_cards"] == _TRANSFER_AMOUNT

    # delta still reflects the FULL balance movement (every debit minus the
    # payment), not the narrower spend-only new_spend.
    total_debits = round(_TRANSFER_AMOUNT + sum(amt for _, amt in _SPEND), 2)
    expected_delta = round(total_debits - _PAYMENT_AMOUNT, 2)
    assert movement["delta"] == expected_delta
    # Confirms delta is NOT computed from the narrower new_spend: if it were,
    # it would equal new_spend - payments, which is £700-odd less than the
    # true balance movement here because the transfer is excluded from
    # new_spend.
    assert movement["delta"] != round(movement["new_spend"] - movement["payments"], 2)
    assert movement["payments"] == _PAYMENT_AMOUNT


def test_drivers_reconcile_with_more_than_five_real_categories(monkeypatch):
    """G25 regression guard: more than five spend categories in one period
    must not trigger truncation or a synthetic row — this is the exact
    shape (six categories, one below-the-fold) Kevin's real report hit."""
    accounts = [_acc("cc_a", "Amex Platinum", "amex", -500.0)]
    cc_ids = {"cc_a"}
    txns = []
    eight_spend = _SPEND + [("Health", 12.00), ("Software", 9.99)]
    for cat, amt in eight_spend:
        txns.append(_txn("cc_a", amt, D1, "debit", cat))

    story = _run(monkeypatch, accounts, cc_ids, txns)
    drivers = story["drivers"]

    assert len(drivers) == 8
    assert all(d["category"] != "Other categories" for d in drivers)
    names = [d["category"] for d in drivers]
    assert set(names) == {cat for cat, _ in eight_spend}

    expected_new_spend = round(sum(amt for _, amt in eight_spend), 2)
    assert story["movement"]["new_spend"] == expected_new_spend
    drivers_sum = round(sum(d["total"] for d in drivers), 2)
    assert drivers_sum == expected_new_spend


def test_drivers_reconcile_when_five_or_fewer_spend_categories(monkeypatch):
    accounts = [_acc("cc_a", "Amex Platinum", "amex", -500.0)]
    cc_ids = {"cc_a"}
    txns = [_txn("cc_a", _TRANSFER_AMOUNT, D1, "debit", "Transfer")]
    five_spend = _SPEND[:5]
    for cat, amt in five_spend:
        txns.append(_txn("cc_a", amt, D1, "debit", cat))

    story = _run(monkeypatch, accounts, cc_ids, txns)
    drivers = story["drivers"]

    assert len(drivers) == 5
    assert all(d["category"] != "Other categories" for d in drivers)
    assert all(d["category"] != "Transfer" for d in drivers)

    expected_new_spend = round(sum(amt for _, amt in five_spend), 2)
    assert story["movement"]["new_spend"] == expected_new_spend
    drivers_sum = round(sum(d["total"] for d in drivers), 2)
    assert drivers_sum == expected_new_spend
