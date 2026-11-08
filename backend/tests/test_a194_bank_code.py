"""A194 phase 1: Finexer's bank_code, status and bank transaction id are stored
on insert and on re-sync, are optional (a payload with no metadata stores
nothing), are exposed by the transactions API model, and bank_code is counted
in the per-provider field-count log. Invented values only."""
import asyncio
import logging
from datetime import datetime

import app.services.finexer_sync as fs
import app.services.own_account_transfers as oat
from app.routers.transactions import _doc_to_tx
from tests import test_a176_bank_sync as h
from tests.test_a183_counterparty import FakeAccounts, FakeTxns, OWN, UID

# Shaped like the raw HSBC row: signed amount, lowercase currency, null
# reference/merchant/category, status booked and a metadata object.
HSBC_ROW = {
    "id": "ftx_0001", "object": "transaction", "timestamp": "2026-11-05T09:30:00Z", "amount": -42.5,
    "currency": "gbp", "type": "debit", "reference": None, "description": "ACME UTILITIES DD",
    "category": None, "category_group": None, "balance": 1000.0, "merchant": None, "status": "booked",
    "metadata": {"bank_code": "DD", "mutability": "mutable", "id": "bank-777"},
}
NO_META_ROW = {"id": "ftx_0002", "amount": -5, "timestamp": "2026-11-05T09:30:00Z", "description": "CAFE"}


def _walk(store, txns, monkeypatch):
    monkeypatch.setattr(fs, "transactions_col", store)
    monkeypatch.setattr(oat, "accounts_col", FakeAccounts(OWN))
    asyncio.run(fs._upsert_finexer_walk(txns, "cur", UID, None, {"changed": False}))


def test_all_three_fields_stored_on_insert(monkeypatch):
    store = FakeTxns()
    _walk(store, [HSBC_ROW], monkeypatch)
    row = store.docs["ftx_0001"]
    assert (row["bank_code"], row["bank_txn_id"], row["status"]) == ("DD", "bank-777", "booked")


def test_resync_fills_fields_on_existing_row_and_keeps_user_fields(monkeypatch):
    store = FakeTxns()
    old = {k: v for k, v in HSBC_ROW.items() if k != "metadata" and k != "status"}
    _walk(store, [old], monkeypatch)
    store.docs["ftx_0001"]["custom_category"] = "Bills"
    assert "bank_code" not in store.docs["ftx_0001"]
    _walk(store, [HSBC_ROW], monkeypatch)
    row = store.docs["ftx_0001"]
    assert (row["bank_code"], row["bank_txn_id"], row["status"]) == ("DD", "bank-777", "booked")
    assert row["custom_category"] == "Bills"
    # a changed code is updated; a later payload without metadata blanks nothing
    changed = {**HSBC_ROW, "metadata": {**HSBC_ROW["metadata"], "bank_code": "fp"}}
    _walk(store, [changed], monkeypatch)
    assert store.docs["ftx_0001"]["bank_code"] == "FP"
    _walk(store, [{**HSBC_ROW, "metadata": None, "status": None}], monkeypatch)
    assert store.docs["ftx_0001"]["bank_code"] == "FP"


def test_payload_without_metadata_stores_nothing_and_does_not_crash(monkeypatch):
    store = FakeTxns()
    _walk(store, [NO_META_ROW, {**NO_META_ROW, "id": "ftx_0003", "metadata": "oops"}], monkeypatch)
    for tid in ("ftx_0002", "ftx_0003"):
        row = store.docs[tid]
        assert "bank_code" not in row and "bank_txn_id" not in row and "status" not in row


def test_top_level_id_is_never_taken_as_the_bank_id():
    f = fs._txn_fields({"id": "finexer-own-id", "metadata": {"bank_code": "cr"}})
    assert f == {"bank_code": "CR"}


def test_api_model_exposes_bank_code_and_status(monkeypatch):
    store = FakeTxns()
    _walk(store, [HSBC_ROW], monkeypatch)
    doc = {"_id": "ftx_0001", **store.docs["ftx_0001"]}
    out = _doc_to_tx(doc).model_dump()
    assert out["bank_code"] == "DD" and out["status"] == "booked"
    bare = _doc_to_tx({"_id": "x", "account_id": "a", "date": datetime(2026, 11, 5), "amount": 1,
                       "currency": "GBP", "description": "d", "transaction_type": "debit"}).model_dump()
    assert bare["bank_code"] is None and bare["status"] is None


def test_count_fields_includes_bank_code():
    c = fs._count_fields([HSBC_ROW, NO_META_ROW])
    assert c["bank_code"] == 1 and c["rows"] == 2


def test_sync_log_line_includes_bank_code_count_and_no_values(monkeypatch, caplog):
    h._wire_sync(monkeypatch, h.Col([]), None)

    async def _upsert(txns, account_id, user_id, identity=None):
        return [], []

    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    client = h.Client(booked=[HSBC_ROW, NO_META_ROW])
    monkeypatch.setattr(fs, "_client", lambda: client)
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        asyncio.run(fs.sync_finexer_consent(h.CONSENT, h.UID))
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Finexer transaction fields:")]
    assert len(lines) == 1 and "with_bank_code=1" in lines[0]
    assert "bank-777" not in lines[0]
