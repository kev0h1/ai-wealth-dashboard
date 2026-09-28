"""Unit tests for GET /connections (app.routers.accounts::list_connections),
backlog A83.

Finding: the route queried connections_col (TrueLayer) only, so a user with
a live Finexer consent and no TrueLayer connection got back `[]` — the exact
live failure PT-A hit during A50's API-15 pass. Fix makes it query both
collections, the same both-providers pattern list_accounts/sync_all already
use in this file.

Same in-memory FakeCol approach as tests/test_retention.py (no mongomock in
this environment): every collection list_connections touches is replaced
with a FakeCol, monkeypatched onto the actual module-level names
app.routers.accounts imports them under (`connections_col`, `accounts_col`,
`_finexer_consents_col` — the Finexer collection is aliased on import).
"""
import asyncio

import app.routers.accounts as accounts_router


# ── fakes (trimmed copy of test_retention.py's FakeCol — only find/
# count_documents are needed here since list_connections is read-only) ──────

def _matches(doc: dict, filt: dict) -> bool:
    for key, cond in filt.items():
        if doc.get(key) != cond:
            return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class FakeCol:
    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}

    def find(self, filt, proj=None):
        return _FakeCursor([dict(d) for d in self.docs.values() if _matches(d, filt)])

    async def count_documents(self, filt, limit=None):
        n = sum(1 for d in self.docs.values() if _matches(d, filt))
        return min(n, limit) if limit is not None else n


def _patch(monkeypatch, connections=None, accounts=None, finexer_consents=None):
    monkeypatch.setattr(accounts_router, "connections_col", connections or FakeCol())
    monkeypatch.setattr(accounts_router, "accounts_col", accounts or FakeCol())
    monkeypatch.setattr(accounts_router, "_finexer_consents_col", finexer_consents or FakeCol())


def _run_list(user_email: str):
    return asyncio.run(accounts_router.list_connections(user={"email": user_email}))


# ── tests ────────────────────────────────────────────────────────────────

def test_truelayer_and_finexer_both_listed_with_right_providers_and_counts(monkeypatch):
    connections = FakeCol([
        # expires_at is the OAuth access-token expiry (refreshed hourly);
        # consent_expires_at is the bank consent expiry — the row's
        # "expires_at" key must report the latter, not the former.
        {"_id": "conn-tl-1", "user_id": "u1",
         "expires_at": "2026-10-01T00:00:00Z",
         "consent_expires_at": "2026-09-01T00:00:00Z",
         "access_token": "tl-secret", "refresh_token": "tl-refresh"},
    ])
    fx_consents = FakeCol([
        {"_id": "conn-fx-1", "user_id": "u1", "status": "authorized",
         "expiry_date": "2026-12-01T00:00:00Z", "token": "fx-secret"},
    ])
    accounts = FakeCol([
        {"_id": "acc-1", "user_id": "u1", "connection_id": "conn-tl-1"},
        {"_id": "acc-2", "user_id": "u1", "connection_id": "conn-tl-1"},
        {"_id": "acc-3", "user_id": "u1", "connection_id": "conn-fx-1"},
    ])
    _patch(monkeypatch, connections, accounts, fx_consents)

    result = _run_list("u1")

    assert len(result) == 2
    by_provider = {r["provider"]: r for r in result}

    tl = by_provider["truelayer"]
    assert tl["connection_id"] == "conn-tl-1"
    assert tl["accounts"] == 2
    # Must be the consent expiry, not the access-token expiry.
    assert tl["expires_at"] == "2026-09-01T00:00:00Z"
    assert tl["expires_at"] != "2026-10-01T00:00:00Z"
    assert tl["status"] == "authorized"

    fx = by_provider["finexer"]
    assert fx["connection_id"] == "conn-fx-1"
    assert fx["accounts"] == 1
    assert fx["status"] == "authorized"
    assert fx["expires_at"] == "2026-12-01T00:00:00Z"


def test_finexer_only_user_no_longer_gets_empty_list(monkeypatch):
    """This is the exact live failure: a user with only a Finexer consent
    and no TrueLayer connection used to get back []."""
    fx_consents = FakeCol([
        {"_id": "conn-fx-9", "user_id": "u2", "status": "authorized",
         "expiry_date": None},
    ])
    accounts = FakeCol([
        {"_id": "acc-9", "user_id": "u2", "connection_id": "conn-fx-9"},
    ])
    _patch(monkeypatch, connections=FakeCol(), accounts=accounts, finexer_consents=fx_consents)

    result = _run_list("u2")

    assert len(result) == 1
    assert result[0]["provider"] == "finexer"
    assert result[0]["connection_id"] == "conn-fx-9"
    assert result[0]["accounts"] == 1
    assert result[0]["expires_at"] is None


def test_another_users_consent_is_never_listed(monkeypatch):
    fx_consents = FakeCol([
        {"_id": "conn-fx-mine", "user_id": "u3", "status": "authorized"},
        {"_id": "conn-fx-theirs", "user_id": "someone-else@example.com", "status": "authorized"},
    ])
    connections = FakeCol([
        {"_id": "conn-tl-mine", "user_id": "u3"},
        {"_id": "conn-tl-theirs", "user_id": "someone-else@example.com"},
    ])
    accounts = FakeCol([
        # Caller's own account on their TrueLayer connection.
        {"_id": "acc-mine", "user_id": "u3", "connection_id": "conn-tl-mine"},
        # Another user's account that happens to carry the SAME
        # connection_id string as the caller's connection (e.g. a stale/
        # reused id) — must not be counted into the caller's row.
        {"_id": "acc-theirs-same-conn-id", "user_id": "someone-else@example.com",
         "connection_id": "conn-tl-mine"},
    ])
    _patch(monkeypatch, connections=connections, accounts=accounts, finexer_consents=fx_consents)

    result = _run_list("u3")

    ids = {r["connection_id"] for r in result}
    assert ids == {"conn-tl-mine", "conn-fx-mine"}

    tl_mine = next(r for r in result if r["connection_id"] == "conn-tl-mine")
    assert tl_mine["accounts"] == 1


def test_token_and_secret_fields_never_appear_in_response(monkeypatch):
    connections = FakeCol([
        {"_id": "conn-tl-1", "user_id": "u4", "access_token": "tl-secret-abc",
         "refresh_token": "tl-refresh-xyz"},
    ])
    fx_consents = FakeCol([
        {"_id": "conn-fx-1", "user_id": "u4", "status": "authorized",
         "token": "fx-token-abc", "secret": "fx-secret-xyz", "customer_id": "cust-1"},
    ])
    _patch(monkeypatch, connections=connections, accounts=FakeCol(), finexer_consents=fx_consents)

    result = _run_list("u4")

    blob = repr(result)
    for leaked in ("tl-secret-abc", "tl-refresh-xyz", "fx-token-abc", "fx-secret-xyz"):
        assert leaked not in blob
    for row in result:
        assert set(row.keys()) == {"connection_id", "provider", "status", "expires_at", "accounts"}
