"""G39: the one-time backfill that moves existing Bills/Other transactions
into the new Mortgage/Car finance categories once their trigger keywords are
recognised (app.services.categorisation.migrate_mortgage_car_finance_categories,
wired into app.main's startup migrations the same way migrate_category_kinds
is). No real Mongo involved -- a minimal fake collection stands in for
transactions_col, following the same pattern other tests in this suite use
(see tests/test_notifications.py's FakeTxnCol)."""
import asyncio

import app.services.categorisation as categorisation


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeUpdateResult:
    def __init__(self, modified_count):
        self.modified_count = modified_count


class _FakeTxnCol:
    """Only supports the exact shapes migrate_mortgage_car_finance_categories
    uses: find() ignores its query/projection args (the fixture is already
    pre-filtered to the candidate set the real query would return -- Bills/
    Other, custom_category None), update_one() applies the $set only when
    the filter's custom_category:None guard still holds against the CURRENT
    stored doc, mirroring Mongo's real read-then-conditionally-write
    semantics for that guard."""

    def __init__(self, docs):
        self.docs = {d["_id"]: d for d in docs}
        self.updates = []

    def find(self, query, projection=None):
        return _FakeCursor(list(self.docs.values()))

    async def update_one(self, filt, update):
        doc = self.docs.get(filt["_id"])
        if doc is None or doc.get("custom_category") != filt.get("custom_category"):
            return _FakeUpdateResult(0)
        doc.update(update["$set"])
        self.updates.append((filt["_id"], update["$set"]))
        return _FakeUpdateResult(1)


def _txn(_id, user_id, category, merchant="", description="", custom_category=None):
    return {
        "_id": _id, "user_id": user_id, "category": category,
        "custom_category": custom_category,
        "merchant_name": merchant, "description": description,
    }


def _run(coro):
    return asyncio.run(coro)


def test_migrates_bills_mortgage_payment_to_mortgage_category(monkeypatch):
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Bills", merchant="NATIONWIDE BS", description="MORTGAGE PAYMENT"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats == {"scanned": 1, "updated": 1, "user_ids": ["kevin"]}
    assert col.docs["t1"]["category"] == "Mortgage"


def test_migrates_other_car_finance_payment_to_car_finance_category(monkeypatch):
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Other", description="BLACK HORSE FINANCE DD"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats["updated"] == 1
    assert col.docs["t1"]["category"] == "Car finance"


def test_leaves_unrelated_bills_transactions_untouched(monkeypatch):
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Bills", merchant="BRITISH GAS", description="ENERGY DD"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats["updated"] == 0
    assert col.docs["t1"]["category"] == "Bills"


def test_never_overwrites_a_users_own_correction(monkeypatch):
    """User-correction precedence: a transaction the user has already
    corrected (custom_category set) must never be touched, even if its
    engine `category` still reads Bills and its text matches a trigger."""
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Bills", merchant="NATIONWIDE", description="MORTGAGE PAYMENT",
             custom_category="House stuff"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats["updated"] == 0
    assert col.docs["t1"]["category"] == "Bills"
    assert col.docs["t1"]["custom_category"] == "House stuff"


def test_idempotent_second_run_is_a_no_op(monkeypatch):
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Bills", merchant="NATIONWIDE", description="MORTGAGE PAYMENT"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    _run(categorisation.migrate_mortgage_car_finance_categories())
    assert col.docs["t1"]["category"] == "Mortgage"
    # Second pass: category is now "Mortgage", not in the Bills/Other scan
    # set any more in a real query -- our fake ignores the query, so this
    # also proves the `cat == t.get("category")` short-circuit is real.
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats["updated"] == 0


def test_tracks_user_ids_of_every_affected_user(monkeypatch):
    col = _FakeTxnCol([
        _txn("t1", "kevin", "Bills", description="MORTGAGE PAYMENT"),
        _txn("t2", "alice", "Other", description="CAR FINANCE PAYMENT"),
        _txn("t3", "bob", "Bills", merchant="BRITISH GAS"),
    ])
    monkeypatch.setattr(categorisation, "transactions_col", col)
    stats = _run(categorisation.migrate_mortgage_car_finance_categories())
    assert stats["updated"] == 2
    assert stats["user_ids"] == ["alice", "kevin"]
