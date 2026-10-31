"""G376 external savings and investment destination contracts."""
import asyncio
from datetime import datetime

import pytest
from fastapi import HTTPException

import app.routers.transactions as transactions
import app.services.categorisation as categorisation
from tests.test_transfer_pairs import D0, FakeCol, UID, _run_apply_rules_bulk, _t


class _Rows:
    """Small exact-match collection fake for the resolution endpoint."""

    def __init__(self, docs=()):
        self.docs = [dict(doc) for doc in docs]

    async def find_one(self, query, *_args, **_kwargs):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return dict(doc)
        return None

    async def update_one(self, query, update, *_args, **_kwargs):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))
                for key in update.get("$unset", {}):
                    doc.pop(key, None)
                return


class _Events:
    def __init__(self):
        self.docs = []

    async def insert_one(self, doc):
        self.docs.append(dict(doc))


def _wire(monkeypatch, rows, events):
    monkeypatch.setattr(transactions, "transactions_col", rows)
    monkeypatch.setattr(transactions, "teaching_events_col", events)
    monkeypatch.setattr(transactions.response_cache, "invalidate", lambda *_args, **_kwargs: None)

    import app.routers.analytics as analytics
    import app.services.derived_caches as derived_caches

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(analytics, "compute_and_cache_cashflow", _noop)
    monkeypatch.setattr(derived_caches, "mark_stale", _noop)


@pytest.mark.parametrize(("resolution", "expected"), [
    ("mine-savings", "Savings"),
    ("mine-investment", "Investment"),
])
def test_external_destination_is_private_debit_movement_and_clears_old_links(monkeypatch, resolution, expected):
    rows = _Rows([{
        "_id": "tx-1", "user_id": "kevin@example.com", "transaction_type": "debit",
        "merchant_name": "FORIS MT LIMITED", "description": "FORIS MT LIMITED STO",
        "currency": "GBP", "amount": 25.0, "linked_goal_id": "old-goal",
        "linked_offline_account_id": "old-pot",
    }])
    events = _Events()
    _wire(monkeypatch, rows, events)

    result = asyncio.run(transactions.resolve_movement(
        "tx-1", {"resolution": resolution, "destination_name": "Crypto.com\x00"},
        {"email": "kevin@example.com"},
    ))

    saved = rows.docs[0]
    assert result["custom_category"] == expected
    assert result["destination_name"] == "Crypto.com"
    assert saved["custom_category"] == expected
    assert saved["currency"] == "GBP" and saved["amount"] == 25.0
    assert "linked_goal_id" not in saved and "linked_offline_account_id" not in saved
    assert events.docs == [{
        "user_id": "kevin@example.com",
        "type": "movement_mine_savings" if resolution == "mine-savings" else "movement_mine_investment",
        "transaction_id": "tx-1", "merchant_key": transactions.canonical_merchant_key("FORIS MT LIMITED", "FORIS MT LIMITED STO"),
        "payload": {"destination_name": "Crypto.com"},
        "created_at": events.docs[0]["created_at"],
    }]


def test_external_destination_never_allows_a_credit_or_another_users_row(monkeypatch):
    rows = _Rows([
        {"_id": "credit", "user_id": "kevin@example.com", "transaction_type": "credit"},
        {"_id": "other", "user_id": "other@example.com", "transaction_type": "debit"},
    ])
    events = _Events()
    _wire(monkeypatch, rows, events)

    with pytest.raises(HTTPException, match="outgoing payments"):
        asyncio.run(transactions.resolve_movement(
            "credit", {"resolution": "mine-savings"}, {"email": "kevin@example.com"},
        ))
    with pytest.raises(HTTPException, match="Transaction not found"):
        asyncio.run(transactions.resolve_movement(
            "other", {"resolution": "mine-investment"}, {"email": "kevin@example.com"},
        ))
    assert all("custom_category" not in row for row in rows.docs)
    assert not events.docs


def test_external_destination_rejects_a_non_text_name(monkeypatch):
    rows = _Rows([{"_id": "tx-1", "user_id": "kevin@example.com", "transaction_type": "debit"}])
    events = _Events()
    _wire(monkeypatch, rows, events)

    with pytest.raises(HTTPException, match="destination_name must be text"):
        asyncio.run(transactions.resolve_movement(
            "tx-1", {"resolution": "mine-savings", "destination_name": 42},
            {"email": "kevin@example.com"},
        ))
    assert "custom_category" not in rows.docs[0]


def test_external_destination_really_propagates_only_to_later_debits_and_undo_stops_it(monkeypatch):
    """Use the real structural pass, which keys manual intent by direction."""
    source = _t(
        "source", ttype="debit", amount=25.0, date=D0, account_id="a1",
        merchant="FORIS MT LIMITED", desc="FORIS MT LIMITED STO", category="Other",
        custom_category="Investment",
    )
    later_debit = _t(
        "later-debit", ttype="debit", amount=25.0, date=D0, account_id="a1",
        merchant="FORIS MT LIMITED", desc="FORIS MT LIMITED STO", category="Other",
    )
    incoming_credit = _t(
        "incoming-credit", ttype="credit", amount=12.0, date=D0, account_id="a1",
        merchant="FORIS MT LIMITED", desc="FORIS MT LIMITED STO", category="Other",
    )
    rows = [source, later_debit, incoming_credit]

    _run_apply_rules_bulk(monkeypatch, rows)
    assert later_debit["category"] == "Investment"
    # FORIS's STO narrative is already a Transfer under the built-in rules.
    # The important direction guarantee is that this credit never inherits
    # the user's private Investment decision.
    assert incoming_credit["category"] == "Transfer"

    # Undo removes the only explicit correction. Resetting the auto row is
    # what a newly fetched matching debit looks like on a later sync.
    source["custom_category"] = None
    later_debit["category"] = "Other"
    _run_apply_rules_bulk(monkeypatch, rows)
    # Without the user correction the existing STO baseline returns. This
    # proves undo does not leave the private Investment choice to revive on
    # a later sync.
    assert later_debit["category"] == "Transfer"
    assert incoming_credit["category"] == "Transfer"


@pytest.mark.parametrize("event_type", ["movement_mine_savings", "movement_mine_investment"])
def test_external_destination_event_uses_the_real_decision_time_registry(monkeypatch, event_type):
    monkeypatch.setattr(categorisation, "teaching_events_col", FakeCol([{
        "_id": "event", "user_id": UID, "type": event_type,
        "transaction_id": "old-payment", "created_at": datetime(2026, 10, 31),
    }]))
    times = asyncio.run(categorisation.teaching_decision_times(UID))
    assert times == {"old-payment": datetime(2026, 10, 31)}
