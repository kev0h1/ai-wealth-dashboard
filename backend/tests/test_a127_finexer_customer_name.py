"""Tests for backlog A127: the Finexer customer record's `name` field must
never be the user's email address.

Before this, `get_or_create_customer` (app/services/finexer_sync.py) did
`name = user.get("name") or user["email"]`. D7 (2026-09-28) made an empty
session `name` the normal case for Apple sign-in and Google accounts with
no provider-supplied display name, so that fallback started sending real
email addresses to Finexer as customer names far more often than before.

Covers `_resolve_customer_name`'s priority order (profile full_name ->
non-email-shaped session name -> opaque "Sorted customer #<hash>"
placeholder) and `get_or_create_customer`'s outgoing POST /customers
payload end to end, plus that an already-known customer is never renamed
on a later lookup (unchanged behaviour, preserved here).

Fakes follow this codebase's existing finexer test conventions
(tests/test_finexer_rate_limit.py, tests/test_finexer_provider_cache.py,
tests/test_finexer_link.py): a tiny dispatch-by-path stand-in for the
async-context-managed httpx client (`_client()`), and a minimal
find_one/update_one stand-in for the Mongo collections, called directly
via asyncio.run rather than through the ASGI stack.
"""
import asyncio
import hashlib

import pytest

import app.services.finexer_sync as finexer_sync


# ── fakes ────────────────────────────────────────────────────────────────

class FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


class FakeCol:
    """Minimal find_one/update_one stand-in, matching
    test_finexer_rate_limit.py's own FakeCol."""

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


class PostCapturingClient:
    """Stand-in for finexer_sync._client()'s async-context-managed httpx
    client: captures every POST /customers call's kwargs and returns a
    fixed response, same dispatch-by-path convention as
    test_finexer_malformed_upstream.py's FxClient."""

    def __init__(self, response):
        self._response = response
        self.post_calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None):
        self.post_calls.append({"url": url, "data": data})
        return self._response


def _must_not_open_client():
    raise AssertionError("_client() must not be called for an already-known customer")


def _wire(monkeypatch, *, customers_docs=None, profile_docs=None, response=None):
    customers = FakeCol(customers_docs)
    profiles = FakeCol(profile_docs)
    monkeypatch.setattr(finexer_sync, "finexer_customers_col", customers)
    monkeypatch.setattr(finexer_sync, "user_profiles_col", profiles)
    client = PostCapturingClient(response or FakeResp(201, {"id": "cus_new_1"}))
    monkeypatch.setattr(finexer_sync, "_client", lambda: client)
    return customers, profiles, client


# ── _resolve_customer_name priority order ────────────────────────────────

def test_profile_full_name_is_used_when_present(monkeypatch):
    _wire(monkeypatch, profile_docs=[{"_id": "kevin@example.com", "full_name": "Kevin Maingi"}])
    name = asyncio.run(finexer_sync._resolve_customer_name(
        {"email": "kevin@example.com", "name": ""},
    ))
    assert name == "Kevin Maingi"


def test_profile_beats_a_valid_session_name(monkeypatch):
    _wire(monkeypatch, profile_docs=[{"_id": "kevin@example.com", "full_name": "Kevin Maingi"}])
    name = asyncio.run(finexer_sync._resolve_customer_name(
        {"email": "kevin@example.com", "name": "Someone Else"},
    ))
    assert name == "Kevin Maingi"


def test_session_name_used_when_no_profile_and_not_email_shaped(monkeypatch):
    _wire(monkeypatch, profile_docs=[])
    name = asyncio.run(finexer_sync._resolve_customer_name(
        {"email": "kevin@example.com", "name": "Kevin M"},
    ))
    assert name == "Kevin M"


def test_session_name_equal_to_email_is_rejected(monkeypatch):
    """A session token issued before D7 could still carry the raw email as
    its `name` (the exact bug this ticket closes one layer up)."""
    _wire(monkeypatch, profile_docs=[])
    name = asyncio.run(finexer_sync._resolve_customer_name(
        {"email": "kevin@example.com", "name": "kevin@example.com"},
    ))
    assert name != "kevin@example.com"
    assert name.startswith("Sorted customer #")


def test_session_name_equal_to_email_local_part_is_rejected(monkeypatch):
    """A pre-D7 Apple session for a Hide My Email relay address carried the
    local part alone (e.g. "jjdk4") as the session name."""
    _wire(monkeypatch, profile_docs=[])
    name = asyncio.run(finexer_sync._resolve_customer_name(
        {"email": "jjdk4@privaterelay.appleid.com", "name": "jjdk4"},
    ))
    assert name != "jjdk4"
    assert name.startswith("Sorted customer #")


def test_empty_name_and_no_profile_uses_placeholder_never_email(monkeypatch):
    _wire(monkeypatch, profile_docs=[])
    email = "kevin.maingi12@gmail.com"
    name = asyncio.run(finexer_sync._resolve_customer_name({"email": email, "name": ""}))
    assert name != email
    assert email not in name
    assert name.startswith("Sorted customer #")
    digest = hashlib.sha256(email.lower().encode()).hexdigest()[:8].upper()
    assert name == f"Sorted customer #{digest}"


def test_placeholder_is_deterministic_per_user(monkeypatch):
    """Same user resolved twice gets the same placeholder — important so a
    later re-resolution (e.g. after a lookup that finds no cached
    customer_id yet) is stable rather than random."""
    _wire(monkeypatch, profile_docs=[])
    email = "someone@example.com"
    name1 = asyncio.run(finexer_sync._resolve_customer_name({"email": email, "name": ""}))
    name2 = asyncio.run(finexer_sync._resolve_customer_name({"email": email, "name": ""}))
    assert name1 == name2


def test_placeholder_differs_across_users(monkeypatch):
    _wire(monkeypatch, profile_docs=[])
    name_a = asyncio.run(finexer_sync._resolve_customer_name({"email": "a@example.com", "name": ""}))
    name_b = asyncio.run(finexer_sync._resolve_customer_name({"email": "b@example.com", "name": ""}))
    assert name_a != name_b


# ── get_or_create_customer: outgoing payload never carries the email as a name ──

def test_new_customer_payload_uses_profile_name_not_email(monkeypatch):
    customers, profiles, client = _wire(
        monkeypatch,
        customers_docs=[],
        profile_docs=[{"_id": "kevin@example.com", "full_name": "Kevin Maingi"}],
    )
    customer_id = asyncio.run(finexer_sync.get_or_create_customer(
        {"email": "kevin@example.com", "name": ""},
    ))
    assert customer_id == "cus_new_1"
    assert len(client.post_calls) == 1
    payload = client.post_calls[0]["data"]
    assert payload["name"] == "Kevin Maingi"
    # The email field itself is by design (Finexer needs a contact email) —
    # only the *name* field must never carry it.
    assert payload["email"] == "kevin@example.com"
    assert "kevin@example.com" != payload["name"]


def test_new_customer_payload_placeholder_never_contains_email(monkeypatch):
    email = "someone.new@example.com"
    customers, profiles, client = _wire(monkeypatch, customers_docs=[], profile_docs=[])
    asyncio.run(finexer_sync.get_or_create_customer({"email": email, "name": ""}))
    payload = client.post_calls[0]["data"]
    assert email not in payload["name"]
    assert payload["name"].startswith("Sorted customer #")
    # The email field is still correctly the real email (separate, intended
    # channel for Finexer to have a contact address).
    assert payload["email"] == email
    assert payload["metadata[app_user]"] == email


def test_existing_customer_is_not_renamed_on_a_later_sync(monkeypatch):
    """Preserves existing behaviour: get_or_create_customer only ever POSTs
    /customers on first creation. A name that changes later (e.g. a
    profile save) must not retroactively rename an already-known Finexer
    customer, and no HTTP call should happen at all for a cache hit."""
    customers = FakeCol([{"_id": "kevin@example.com", "customer_id": "cus_existing_1"}])
    profiles = FakeCol([{"_id": "kevin@example.com", "full_name": "Kevin Maingi"}])
    monkeypatch.setattr(finexer_sync, "finexer_customers_col", customers)
    monkeypatch.setattr(finexer_sync, "user_profiles_col", profiles)
    monkeypatch.setattr(finexer_sync, "_client", _must_not_open_client)

    customer_id = asyncio.run(finexer_sync.get_or_create_customer(
        {"email": "kevin@example.com", "name": ""},
    ))
    assert customer_id == "cus_existing_1"
