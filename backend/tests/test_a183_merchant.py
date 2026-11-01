"""A183 part 2: Finexer's clean `merchant` is the stored display name
(merchant_name, which every list reads before the raw description), ahead of
the vendor directory and any description cleaning. Description stays raw."""
import asyncio

import app.services.finexer_sync as fs
import app.services.own_account_transfers as oat
from tests.test_a183_counterparty import FakeAccounts, FakeTxns, UID


def _walk(txns, monkeypatch):
    store = FakeTxns()
    monkeypatch.setattr(fs, "transactions_col", store)
    monkeypatch.setattr(oat, "accounts_col", FakeAccounts([]))
    out = asyncio.run(fs._upsert_finexer_walk(txns, "cur", UID, None, {"changed": False}))
    return store.docs, out


def row(id_, **extra):
    return {"id": id_, "amount": -4.5, "date": "2026-10-30T10:00:00Z", **extra}


def test_merchant_is_the_display_name_and_description_stays_raw(monkeypatch):
    docs, _ = _walk([row("t1", description="CRD 1234 TESCO STORES 5521 LONDON", merchant="Tesco")], monkeypatch)
    assert docs["t1"]["merchant_name"] == "Tesco"
    assert docs["t1"]["description"] == "CRD 1234 TESCO STORES 5521 LONDON"


def test_merchant_wins_over_legacy_names(monkeypatch):
    docs, _ = _walk([row("t1", description="X", merchant="Pret A Manger", merchant_name="PRET 77", counterparty_name="PRET LTD")], monkeypatch)
    assert docs["t1"]["merchant_name"] == "Pret A Manger"


def test_object_and_nested_merchant_are_read(monkeypatch):
    docs, _ = _walk([
        row("t1", description="X", merchant={"name": "Greggs"}),
        row("t2", description="Y", metadata={"merchant": "Costa"}),
    ], monkeypatch)
    assert docs["t1"]["merchant_name"] == "Greggs"
    assert docs["t2"]["merchant_name"] == "Costa"


def test_no_merchant_leaves_merchant_name_empty_and_party_name_is_not_borrowed(monkeypatch):
    docs, _ = _walk([row("t1", description="FASTER PAYMENT TO J SMITH", party_name="J Smith")], monkeypatch)
    assert docs["t1"]["merchant_name"] is None
    assert docs["t1"]["description"] == "FASTER PAYMENT TO J SMITH"


def test_pending_rows_carry_merchant_too(monkeypatch):
    _, (new, pending) = _walk([row("p1", description="RAW", merchant="Tesco", status="pending")], monkeypatch)
    assert new == [] and pending[0]["merchant_name"] == "Tesco"
