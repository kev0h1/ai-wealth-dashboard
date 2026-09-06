"""Tests for the Statements-tier gates added in app.core.subscription:
open banking is off for that tier, and statement/M-Pesa uploads are capped
at `statement_uploads_per_month` (None = unlimited on every other tier).
Follows the fake-collection monkeypatch pattern in tests/test_tiers.py."""
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.db.collections as collections_module
from app.core.subscription import (
    check_open_banking_allowed,
    check_statement_upload_allowed,
    record_statement_upload,
)


class _FakeFindOneCollection:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, query):
        return self.doc


class _FakeUploadsCollection:
    """Stores docs in a plain list and answers count_documents/insert_one
    with simple exact-match filtering, close enough to Mongo's behaviour
    for these tests (each query only ever pins user_id + year_month)."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.inserted = []

    async def count_documents(self, query):
        return sum(
            1 for d in self.docs
            if all(d.get(k) == v for k, v in query.items())
        )

    async def insert_one(self, doc):
        self.inserted.append(doc)
        self.docs.append(doc)
        return doc


def _set_tier(monkeypatch, tier_name):
    monkeypatch.setattr(
        collections_module, "subscriptions_col",
        _FakeFindOneCollection({"tier": tier_name, "status": "active"}),
    )


def _current_ym() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


# --- check_open_banking_allowed -------------------------------------------

def test_open_banking_gate_raises_402_for_statements_tier(monkeypatch):
    _set_tier(monkeypatch, "statements")

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check_open_banking_allowed("statements-user@example.com"))

    assert exc_info.value.status_code == 402
    detail = exc_info.value.detail
    assert detail["code"] == "OPEN_BANKING_NOT_IN_TIER"
    assert detail["current_tier"] == "statements"
    assert detail["kind"] == "open_banking"


@pytest.mark.parametrize("tier_name", ["lite", "standard", "connect", "max"])
def test_open_banking_gate_is_noop_for_paid_tiers(monkeypatch, tier_name):
    _set_tier(monkeypatch, tier_name)
    asyncio.run(check_open_banking_allowed(f"{tier_name}-user@example.com"))


# --- check_statement_upload_allowed ---------------------------------------

def test_statement_upload_gate_allows_third_upload_in_month(monkeypatch):
    _set_tier(monkeypatch, "statements")
    ym = _current_ym()
    fake = _FakeUploadsCollection([
        {"user_id": "capped@example.com", "year_month": ym} for _ in range(2)
    ])
    monkeypatch.setattr(collections_module, "statement_uploads_col", fake)

    asyncio.run(check_statement_upload_allowed("capped@example.com"))


def test_statement_upload_gate_raises_402_on_fourth_upload(monkeypatch):
    _set_tier(monkeypatch, "statements")
    ym = _current_ym()
    fake = _FakeUploadsCollection([
        {"user_id": "capped@example.com", "year_month": ym} for _ in range(3)
    ])
    monkeypatch.setattr(collections_module, "statement_uploads_col", fake)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(check_statement_upload_allowed("capped@example.com"))

    assert exc_info.value.status_code == 402
    detail = exc_info.value.detail
    assert detail["code"] == "STATEMENT_UPLOAD_LIMIT_REACHED"
    assert detail["current_tier"] == "statements"
    assert detail["limit"] == 3
    assert detail["used"] == 3
    assert detail["kind"] == "statement_uploads"
    assert "resets_on" in detail


def test_statement_upload_gate_counts_only_current_month(monkeypatch):
    _set_tier(monkeypatch, "statements")
    ym = _current_ym()
    # Three uploads logged against a different month must not count
    # against this month's cap of 3.
    fake = _FakeUploadsCollection([
        {"user_id": "seasonal@example.com", "year_month": "2000-01"} for _ in range(3)
    ] + [
        {"user_id": "seasonal@example.com", "year_month": ym} for _ in range(1)
    ])
    monkeypatch.setattr(collections_module, "statement_uploads_col", fake)

    # 1 used this month, limit 3 — must not raise.
    asyncio.run(check_statement_upload_allowed("seasonal@example.com"))


def test_statement_upload_gate_is_noop_when_limit_none(monkeypatch):
    _set_tier(monkeypatch, "lite")
    fake = _FakeUploadsCollection([
        {"user_id": "unlimited@example.com", "year_month": _current_ym()} for _ in range(999)
    ])
    monkeypatch.setattr(collections_module, "statement_uploads_col", fake)

    asyncio.run(check_statement_upload_allowed("unlimited@example.com"))


# --- record_statement_upload -----------------------------------------------

def test_record_statement_upload_writes_expected_doc(monkeypatch):
    fake = _FakeUploadsCollection()
    monkeypatch.setattr(collections_module, "statement_uploads_col", fake)

    asyncio.run(record_statement_upload(
        "writer@example.com", kind="pdf", filename="jan-statement.pdf",
        region="UK", account_id="statement-writer@example.com-hsbc-1234",
    ))

    assert len(fake.inserted) == 1
    doc = fake.inserted[0]
    assert doc["user_id"] == "writer@example.com"
    assert doc["kind"] == "pdf"
    assert doc["filename"] == "jan-statement.pdf"
    assert doc["region"] == "UK"
    assert doc["account_id"] == "statement-writer@example.com-hsbc-1234"
    assert doc["year_month"] == _current_ym()
    assert isinstance(doc["uploaded_at"], datetime)
