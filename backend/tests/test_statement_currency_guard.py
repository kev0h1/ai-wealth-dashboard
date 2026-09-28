"""A98: `POST /statement/upload` must never invent a currency.

Before A98 the parsed currency defaulted to "KES", which then tripped the
Kenya-only M-PESA guard, so "the statement does not say" and "this really is
KES" were rejected with the same misleading message (the A51 pentest run
recorded that as an incidental finding).

Removing the Kenya region made the obvious replacement -- default to "GBP" --
strictly worse than the bug: an unlabelled EUR/USD statement would import,
every row would be stored as GBP, and `analytics.get_kpis` (which sums only
accounts whose currency is GBP) would fold the balance into GBP net worth at
1:1 with nothing on screen saying anything had been assumed. A silently wrong
net worth is the one outcome a money app cannot ship, so an undeterminable
currency is now its own 422 and the genuine-KES rejection stays separate.

These tests drive the real handler with the LLM parse and the tier gate
stubbed, and fake collections in place of Mongo, so a rejection is proved to
happen BEFORE any write rather than merely to be reported.
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.statements as statements


class _FakeUpload:
    filename = "january.csv"

    def __init__(self, body: bytes = b"date,amount\n2026-01-02,10.00\n"):
        self._body = body

    async def read(self) -> bytes:
        return self._body


class _RecordingCol:
    """Records every write so a test can assert none happened."""

    def __init__(self):
        self.writes: list = []

    async def update_one(self, *a, **k):
        self.writes.append(("update_one", a, k))

    async def find_one(self, *a, **k):
        return None


def _patch(monkeypatch, parsed: dict):
    accounts = _RecordingCol()
    txns = _RecordingCol()
    uploads: list = []

    async def fake_gate(_uid):
        return None

    async def fake_parse(_text, _uid):
        return parsed

    async def fake_record(*a, **k):
        uploads.append((a, k))

    monkeypatch.setattr(statements, "check_statement_upload_allowed", fake_gate)
    monkeypatch.setattr(statements, "llm_parse_statement", fake_parse)
    monkeypatch.setattr(statements, "record_statement_upload", fake_record)
    monkeypatch.setattr(statements, "statement_accounts_col", accounts)
    monkeypatch.setattr(statements, "statement_transactions_col", txns)
    monkeypatch.setattr(statements, "rule_categorise", lambda *_a: "Other")
    return accounts, txns, uploads


def _run(monkeypatch, parsed):
    return asyncio.run(
        statements.statement_upload(
            file=_FakeUpload(), password="", user={"email": "user@example.com"}
        )
    )


_ROWS = [{"date": "2026-01-02T00:00:00", "type": "debit", "amount": 10.0,
          "description": "TESCO", "ref": "R1", "balance": 90.0}]


@pytest.mark.parametrize("missing", [None, "", "   ", "null", "NONE", "unknown"])
def test_undeterminable_currency_is_rejected_and_writes_nothing(monkeypatch, missing):
    accounts, txns, uploads = _patch(monkeypatch, {
        "bank_name": "Barclays", "account_number": "12345678",
        "currency": missing, "transactions": _ROWS,
    })

    with pytest.raises(HTTPException) as exc:
        _run(monkeypatch, None)

    assert exc.value.status_code == 422
    assert "could not work out the currency" in str(exc.value.detail)
    # The whole point: it must not fall back to GBP and import.
    assert "GBP" not in str(exc.value.detail)
    assert accounts.writes == [] and txns.writes == [] and uploads == []


def test_mpesa_statement_is_still_rejected_on_its_own_message(monkeypatch):
    accounts, txns, uploads = _patch(monkeypatch, {
        "bank_name": "M-PESA", "account_number": "254700000000",
        "currency": "KES", "transactions": _ROWS,
    })

    with pytest.raises(HTTPException) as exc:
        _run(monkeypatch, None)

    assert exc.value.status_code == 422
    assert exc.value.detail == "M-PESA and KES statements are not supported."
    assert accounts.writes == [] and txns.writes == [] and uploads == []


def test_kes_currency_alone_is_rejected_even_from_a_bank_named_statement(monkeypatch):
    accounts, txns, uploads = _patch(monkeypatch, {
        "bank_name": "Equity Bank", "account_number": "12345678",
        "currency": "kes", "transactions": _ROWS,
    })

    with pytest.raises(HTTPException) as exc:
        _run(monkeypatch, None)

    assert exc.value.detail == "M-PESA and KES statements are not supported."
    assert accounts.writes == [] and txns.writes == [] and uploads == []


@pytest.mark.parametrize("code,expected", [("GBP", "GBP"), ("eur", "EUR"), ("USD", "USD")])
def test_a_stated_currency_is_kept_verbatim_and_never_coerced_to_gbp(monkeypatch, code, expected):
    """A EUR/USD statement still imports when it SAYS so -- the rejection
    above is about not knowing, not about refusing every non-GBP statement."""
    accounts, txns, uploads = _patch(monkeypatch, {
        "bank_name": "Revolut", "account_number": "12345678",
        "currency": code, "transactions": _ROWS,
    })

    result = _run(monkeypatch, None)

    assert result["inserted"] == 1
    assert len(uploads) == 1
    stored_txn = txns.writes[0][1][1]["$set"]
    assert stored_txn["currency"] == expected
    stored_acc = accounts.writes[0][1][1]["$set"]
    assert stored_acc["currency"] == expected
    # A98 stamps the region literally so these docs keep matching the
    # `region: "UK"` filter GET /accounts has always applied to them.
    assert stored_acc["region"] == "UK"
