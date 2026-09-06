"""Tests for backend/app/routers/finexer.py's `/auth/finexer/link` and
`/auth/finexer/providers` endpoints.

Follows the direct-call convention already used for router-level unit tests
in this codebase (see test_ops.py's own docstring / test_finexer_webhook.py):
call the async route function directly with a plain-dict `user`, rather than
going through TestClient + dependency_overrides, since nothing here needs the
full ASGI stack. DB-touching collections are replaced with a tiny in-memory
fake collection, `_FakeCol`, matching test_finexer_webhook.py's own.

Covers:
  1. GET /auth/finexer/link?provider=amex passes provider="amex" through to
     create_consent and stores it on the consent doc; the response's
     auth_url comes from the consent's redirect.consent_url.
  2. Without ?provider, None is passed through instead.
  3. GET /auth/finexer/providers returns the provider list sorted by name
     (case-insensitively), and list_providers is only called once across
     two requests inside the cache TTL (module-level cache).
"""
import asyncio

import pytest

import app.routers.finexer as finexer_module


class _FakeCol:
    """Minimal find_one/update_one stand-in, matching test_finexer_webhook.py."""

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


async def _noop_check_connection_limit(email):
    return None


async def _noop_check_open_banking_allowed(email):
    return None


def _setup(monkeypatch, captured_consent_calls=None, consent_url="https://consent.finexer.example/abc"):
    monkeypatch.setattr(finexer_module, "FINEXER_API_KEY", "test-key")
    monkeypatch.setattr(finexer_module, "check_connection_limit", _noop_check_connection_limit)
    monkeypatch.setattr(finexer_module, "check_open_banking_allowed", _noop_check_open_banking_allowed)

    fake_consents = _FakeCol()
    monkeypatch.setattr(finexer_module, "finexer_consents_col", fake_consents)

    async def fake_get_or_create_customer(user):
        return "cus_test_1"

    async def fake_create_consent(user_id, customer_id, provider, state):
        if captured_consent_calls is not None:
            captured_consent_calls.append({
                "user_id": user_id,
                "customer_id": customer_id,
                "provider": provider,
                "state": state,
            })
        return {
            "id": "cst_test_1",
            "redirect": {"consent_url": consent_url},
        }

    monkeypatch.setattr(finexer_module, "get_or_create_customer", fake_get_or_create_customer)
    monkeypatch.setattr(finexer_module, "create_consent", fake_create_consent)

    return fake_consents


@pytest.fixture(autouse=True)
def _reset_providers_cache():
    """The providers cache is module-level state — reset it before and after
    every test so tests don't leak into each other."""
    finexer_module._providers_cache = []
    finexer_module._providers_cache_at = 0.0
    yield
    finexer_module._providers_cache = []
    finexer_module._providers_cache_at = 0.0


# ── GET /auth/finexer/link ──────────────────────────────────────────────


def test_link_with_provider_passes_it_through_and_stores_it(monkeypatch):
    calls = []
    fake_consents = _setup(monkeypatch, captured_consent_calls=calls, consent_url="https://consent.finexer.example/amex")

    result = asyncio.run(finexer_module.finexer_link(
        provider="amex", user={"email": "kevin@example.com"},
    ))

    assert len(calls) == 1
    assert calls[0]["provider"] == "amex"
    assert result["auth_url"] == "https://consent.finexer.example/amex"
    assert result["connection_id"] == "cst_test_1"

    stored = fake_consents.docs[0]
    assert stored["provider"] == "amex"
    assert stored["user_id"] == "kevin@example.com"
    assert stored["status"] == "pending"


def test_link_without_provider_passes_none(monkeypatch):
    calls = []
    fake_consents = _setup(monkeypatch, captured_consent_calls=calls)

    result = asyncio.run(finexer_module.finexer_link(
        provider="", user={"email": "kevin@example.com"},
    ))

    assert len(calls) == 1
    assert calls[0]["provider"] is None
    assert fake_consents.docs[0]["provider"] is None
    assert result["auth_url"]


# ── GET /auth/finexer/providers ─────────────────────────────────────────


def test_providers_sorted_by_name_and_cached_across_requests(monkeypatch):
    call_count = {"n": 0}
    unsorted = [
        {"id": "amex", "name": "American Express", "logo": "", "bg_colors": []},
        {"id": "monzo", "name": "monzo", "logo": "", "bg_colors": []},
        {"id": "barclays", "name": "Barclays", "logo": "", "bg_colors": []},
    ]

    async def fake_list_providers():
        call_count["n"] += 1
        return unsorted

    monkeypatch.setattr(finexer_module, "list_providers", fake_list_providers)

    result1 = asyncio.run(finexer_module.finexer_providers(user={"email": "kevin@example.com"}))
    result2 = asyncio.run(finexer_module.finexer_providers(user={"email": "kevin@example.com"}))

    assert [p["name"] for p in result1] == ["American Express", "Barclays", "monzo"]
    assert result1 == result2
    assert call_count["n"] == 1


def test_empty_provider_list_is_not_cached(monkeypatch):
    call_count = {"n": 0}

    async def fake_list_providers():
        call_count["n"] += 1
        return []

    monkeypatch.setattr(finexer_module, "list_providers", fake_list_providers)

    asyncio.run(finexer_module.finexer_providers(user={"email": "kevin@example.com"}))
    asyncio.run(finexer_module.finexer_providers(user={"email": "kevin@example.com"}))

    assert call_count["n"] == 2
