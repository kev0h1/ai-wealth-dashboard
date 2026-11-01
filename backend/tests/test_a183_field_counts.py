"""A183 part 5: per provider, per sync, counts (never values) of rows carrying
counterparty and merchant fields, so production shows which banks populate them."""
import asyncio
import logging

import app.services.finexer_sync as fs
from tests import test_a176_bank_sync as h

ROWS = [
    {"id": "1", "amount": -5, "merchant": "Tesco", "party_name": "SECRET PAYEE NAME", "party_sort_code": "04-00-04",
     "party_number": "12345678", "category_group": "groceries"},
    {"id": "2", "amount": -5, "party_name": "Somebody"},
    {"id": "3", "amount": -5, "party_sort_code": "040004"},
    {"id": "4", "amount": -5},
]


def test_count_fields_counts_presence_only():
    c = fs._count_fields(ROWS)
    assert c == {"rows": 4, "party": 3, "party_account": 1, "merchant": 1, "category_group": 1}


def test_sync_logs_one_line_per_provider_with_counts_and_no_values(monkeypatch, caplog):
    h._wire_sync(monkeypatch, h.Col([]), None)

    async def _upsert(txns, account_id, user_id, identity=None):
        return [], []

    async def _providers(counter=None):
        return []

    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    monkeypatch.setattr(fs, "list_providers", _providers)
    client = h.Client(booked=ROWS, pending=[{"id": "p1", "party_name": "X", "merchant": "Y"}])
    monkeypatch.setattr(fs, "_client", lambda: client)
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        asyncio.run(fs.sync_finexer_consent(h.CONSENT, h.UID))
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("Finexer transaction fields:")]
    assert lines == [
        "Finexer transaction fields: provider=monzo rows=5 with_party=4 with_party_account=1 with_merchant=2 with_category_group=1"
    ]
    assert all("SECRET" not in r.getMessage() and "12345678" not in r.getMessage() for r in caplog.records
               if r.getMessage().startswith("Finexer transaction fields"))
