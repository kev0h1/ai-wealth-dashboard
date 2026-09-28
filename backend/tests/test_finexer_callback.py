"""Tests for backend/app/routers/finexer.py's `/auth/finexer/callback`
endpoint (A88).

State verification is mandatory: a missing `state` query parameter used to
slip through the old `if state and doc.get("state") and state != ...` check
(which only rejected a *mismatched* state, never an absent one), letting the
callback mark the consent authorised and trigger a sync. Confirmed live
against a real production consent, 2026-09-20 (FIN-03, run
A57-2026-09-20). Fixed to require `state` unconditionally, using
`hmac.compare_digest` for the comparison.

Follows the direct-call convention already used for this route's sibling
tests (test_finexer_link.py, test_finexer_webhook.py): call the async route
function directly with a plain-dict-backed fake collection, rather than
going through TestClient + dependency_overrides.
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.finexer as finexer_module


class _FakeCol:
    """Minimal find_one/update_one stand-in, matching test_finexer_link.py."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


def _setup(monkeypatch, consent_doc, sync_calls):
    fake_consents = _FakeCol([dict(consent_doc)])
    monkeypatch.setattr(finexer_module, "finexer_consents_col", fake_consents)

    def fake_finexer_sync_pipeline(consent_id, user_id):
        # Record the call synchronously (before the coroutine it returns is
        # ever scheduled/awaited), matching what `asyncio.create_task`
        # needs from us to prove a sync either was or wasn't triggered.
        sync_calls.append((consent_id, user_id))

        async def _noop():
            return None

        return _noop()

    monkeypatch.setattr(finexer_module, "finexer_sync_pipeline", fake_finexer_sync_pipeline)
    return fake_consents


def _base_doc():
    return {
        "_id": "cst_test_1",
        "user_id": "kevin@example.com",
        "customer_id": "cus_test_1",
        "provider": "barclays",
        "state": "the-real-state-value",
        "status": "pending",
    }


def test_missing_state_is_rejected_and_consent_not_authorised(monkeypatch):
    sync_calls = []
    fake_consents = _setup(monkeypatch, _base_doc(), sync_calls)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(finexer_module.finexer_callback(fx_consent="cst_test_1", state=""))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "State mismatch"
    assert fake_consents.docs[0]["status"] == "pending"
    assert "authed_at" not in fake_consents.docs[0]
    assert sync_calls == []


def test_missing_stored_state_is_rejected_and_consent_not_authorised(monkeypatch):
    sync_calls = []
    doc = _base_doc()
    doc["state"] = None
    fake_consents = _setup(monkeypatch, doc, sync_calls)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(finexer_module.finexer_callback(
            fx_consent="cst_test_1", state="whatever-the-caller-sends",
        ))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "State mismatch"
    assert fake_consents.docs[0]["status"] == "pending"
    assert sync_calls == []


def test_mismatched_state_is_rejected_and_consent_not_authorised(monkeypatch):
    sync_calls = []
    fake_consents = _setup(monkeypatch, _base_doc(), sync_calls)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(finexer_module.finexer_callback(
            fx_consent="cst_test_1", state="deliberately-wrong-state-value",
        ))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "State mismatch"
    assert fake_consents.docs[0]["status"] == "pending"
    assert sync_calls == []


def test_matching_state_still_succeeds(monkeypatch):
    sync_calls = []
    fake_consents = _setup(monkeypatch, _base_doc(), sync_calls)

    result = asyncio.run(finexer_module.finexer_callback(
        fx_consent="cst_test_1", state="the-real-state-value",
    ))

    assert result.status_code == 200
    assert b"Bank connected!" in result.body
    assert fake_consents.docs[0]["status"] == "authorized"
    assert "authed_at" in fake_consents.docs[0]
    assert sync_calls == [("cst_test_1", "kevin@example.com")]
