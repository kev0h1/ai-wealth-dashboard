"""A183 part 3: a booked row replaces the pending row it settles, matched by
amount, account, counterparty (or merchant) and a short date window, never by
id. A176's wholesale replace already clears the stored set when both walks
succeed; the handover rule covers what it cannot: a booked twin arriving while
the pending walk fails, and a bank that still lists the pending row alongside."""
import asyncio
from datetime import datetime

import app.services.finexer_sync as fs
import app.services.own_account_transfers as oat
import app.services.pending_transactions as pt
from tests.test_a183_counterparty import FakeAccounts, FakeTxns, UID

ACC = "cur"
D = datetime(2026, 10, 30, 9)


def p(**kw):
    return {"transaction_type": "debit", "amount": 12.5, "date": D, "merchant_key": "tesco", **kw}


def test_same_amount_merchant_and_date_window_matches():
    assert pt.booked_replaces_pending(p(), p(date=datetime(2026, 11, 2)))
    assert pt.booked_replaces_pending(p(), p(date=datetime(2026, 10, 29)))


def test_outside_window_amount_direction_or_merchant_differences_do_not_match():
    assert not pt.booked_replaces_pending(p(), p(date=datetime(2026, 11, 6)))
    assert not pt.booked_replaces_pending(p(), p(date=datetime(2026, 10, 28)))
    assert not pt.booked_replaces_pending(p(), p(amount=12.51))
    assert not pt.booked_replaces_pending(p(), p(transaction_type="credit"))
    assert not pt.booked_replaces_pending(p(), p(merchant_key="asda"))


def test_no_identity_on_either_side_never_matches():
    assert not pt.booked_replaces_pending(p(merchant_key=None), p(merchant_key=None))


def test_counterparty_account_beats_merchant_text():
    a = p(merchant_key="x", party_sort_code="040004", party_number="12345678")
    b = p(merchant_key="y", party_sort_code="04-00-04", party_number="12345678")
    assert pt.booked_replaces_pending(a, b)
    c = p(merchant_key="x", party_sort_code="040004", party_number="87654321")
    assert not pt.booked_replaces_pending(a, c)


def test_one_booked_row_settles_only_one_of_two_identical_pending_rows():
    kept, handed = pt.drop_handed_over([p(), p()], [p()])
    assert len(kept) == 1 and len(handed) == 1


class FakePending:
    def __init__(self):
        self.docs = {}

    async def find_one(self, flt, projection=None):
        return next((d for d in self.docs.values() if all(d.get(k) == v for k, v in flt.items())), None)

    async def update_one(self, flt, update, upsert=False):
        doc = self.docs.setdefault(flt["_id"], {"_id": flt["_id"], **(update.get("$setOnInsert") or {})})
        doc.update(update["$set"])

    def find(self, flt, projection=None):
        rows = [dict(d) for d in self.docs.values() if all(d.get(k) == v for k, v in flt.items())]

        class Cur:
            async def to_list(self, n):
                return rows
        return Cur()

    async def delete_many(self, flt):
        def clause(k, d, c):
            idc = c.get("_id")
            if isinstance(idc, dict) and "$nin" in idc:
                return k not in idc["$nin"]
            if isinstance(idc, dict) and "$in" in idc:
                return k in idc["$in"]
            if "first_seen" in c:
                return d["first_seen"] < c["first_seen"]["$lt"]
            return False

        for k in list(self.docs):
            d = self.docs[k]
            if any(d.get(f) != flt[f] for f in ("account_id", "user_id", "provider") if f in flt):
                continue
            clauses = flt.get("$or") or [{"_id": flt["_id"]}]
            if any(clause(k, d, c) for c in clauses):
                del self.docs[k]


def _setup(monkeypatch):
    pend = FakePending()
    monkeypatch.setattr(pt, "pending_transactions_col", pend)
    monkeypatch.setattr(fs, "transactions_col", FakeTxns())
    monkeypatch.setattr(oat, "accounts_col", FakeAccounts([]))
    return pend


def _walk(rows):
    return asyncio.run(fs._upsert_finexer_walk(rows, ACC, UID, None, {"changed": False}))


def _store_pending(pending_rows):
    asyncio.run(pt.replace_pending_for_account(pending_rows, ACC, UID, provider="Finexer", account_currency="GBP"))


PEND = {"id": "pend-1", "amount": -12.5, "date": "2026-10-30T09:00:00Z", "status": "pending",
        "description": "CRD TESCO", "merchant": "Tesco"}
BOOK = {"id": "book-9", "amount": -12.5, "date": "2026-11-01T09:00:00Z", "description": "TESCO STORES 123", "merchant": "Tesco"}


def test_pending_then_booked_leaves_one_row_when_both_walks_succeed(monkeypatch):
    pend = _setup(monkeypatch)
    _, pending_rows = _walk([PEND])
    _store_pending(pending_rows)
    assert len(pend.docs) == 1
    new, pending_rows = _walk([BOOK])
    kept, handed = pt.drop_handed_over(pending_rows + [], new)
    # The bank still lists the pending row alongside its booked twin.
    kept, handed = pt.drop_handed_over(_walk([PEND])[1], new)
    assert kept == [] and len(handed) == 1
    _store_pending(kept)
    assert pend.docs == {}


def test_booked_arrives_while_pending_walk_fails_removes_the_stored_pending_row(monkeypatch):
    pend = _setup(monkeypatch)
    _store_pending(_walk([PEND])[1])
    assert len(pend.docs) == 1
    new, _ = _walk([BOOK])
    removed = asyncio.run(pt.remove_handed_over_pending(new, ACC, UID, "Finexer"))
    assert removed == 1 and pend.docs == {}


def test_unrelated_booked_row_leaves_the_pending_row(monkeypatch):
    pend = _setup(monkeypatch)
    _store_pending(_walk([PEND])[1])
    other = {**BOOK, "id": "book-2", "amount": -3.0}
    new, _ = _walk([other])
    assert asyncio.run(pt.remove_handed_over_pending(new, ACC, UID, "Finexer")) == 0
    assert len(pend.docs) == 1


def test_party_fields_survive_onto_the_stored_pending_row(monkeypatch):
    pend = _setup(monkeypatch)
    _store_pending(_walk([{**PEND, "party_sort_code": "04-00-04", "party_number": "12345678", "party_name": "Tesco Ltd"}])[1])
    doc = next(iter(pend.docs.values()))
    assert (doc["party_sort_code"], doc["party_number"]) == ("040004", "12345678")


# ── wiring inside the consent sync ────────────────────────────────────────

def _sync_harness(monkeypatch, client, booked_new, pending_rows):
    from tests import test_a176_bank_sync as h
    sink: list = []
    h._wire_sync(monkeypatch, h.Col([]), None)

    async def _upsert(txns, account_id, user_id, identity=None):
        if any(t.get("status") == "pending" for t in txns):
            return [], list(pending_rows)
        return list(booked_new), []

    async def _replace(rows, account_id, user_id, provider=None, account_currency=None):
        sink.append(list(rows))

    removed: list = []

    async def _remove(booked, account_id, user_id, provider):
        removed.append(list(booked))
        return 1

    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    monkeypatch.setattr(fs, "replace_pending_for_account", _replace)
    monkeypatch.setattr(fs, "remove_handed_over_pending", _remove)
    monkeypatch.setattr(fs, "_client", lambda: client)
    return sink, removed


def test_sync_drops_a_pending_row_its_booked_twin_replaced(monkeypatch):
    from tests import test_a176_bank_sync as h
    booked_new = [p()]
    pending_rows = [{**p(), "transaction_id": "pend-1"}, {**p(amount=99), "transaction_id": "pend-2"}]
    client = h.Client(booked=[{"id": "b1"}], pending=[{"id": "pend-1", "status": "pending"}])
    sink, removed = _sync_harness(monkeypatch, client, booked_new, pending_rows)
    asyncio.run(fs.sync_finexer_consent(h.CONSENT, h.UID))
    assert [r["transaction_id"] for r in sink[0]] == ["pend-2"]
    assert removed == []


def test_sync_removes_stored_pending_when_pending_walk_fails(monkeypatch):
    from tests import test_a176_bank_sync as h
    client = h.Client(booked=[{"id": "b1"}], pending=[], pending_status=500)
    sink, removed = _sync_harness(monkeypatch, client, [p()], [])
    asyncio.run(fs.sync_finexer_consent(h.CONSENT, h.UID))
    assert sink == [] and len(removed) == 1
