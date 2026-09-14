"""A28: app.core.bot_credentials (the replacement for the single static
BOT_SECRET) plus its two integration points in app.core.auth
(`current_user`, `auth_middleware`).

Same conventions as tests/test_oauth_server.py: plain `asyncio.run`, a
small in-memory fake standing in for the Motor collections
(`bot_credentials_col`, `bot_credential_uses_col`), module-level names
monkeypatched directly. No TestClient, no real Mongo, no real Redis — a
bot credential's own collections carry no user financial data, but this
still follows the repo-wide convention of never touching the real "wealth"
Mongo database from a unit test (see tests/conftest.py's
`_mongo_cleanup_allowed` docstring for why: there is no separate test
database by default).
"""
import asyncio
import hashlib
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.core.auth as auth_mod
import app.core.bot_credentials as bot_credentials
import app.routers.admin as admin_router
import app.routers.subscription as subscription_router


def _run(coro):
    return asyncio.run(coro)


def _matches(doc: dict, query: dict) -> bool:
    return all(doc.get(k) == v for k, v in query.items())


class _FakeResult:
    def __init__(self, modified_count):
        self.modified_count = modified_count


class _FakeCollection:
    """Stands in for a Motor collection: enough surface for
    bot_credentials.py's own lookups (find_one, insert_one, update_one)."""

    def __init__(self, seed=None):
        self.docs: dict = {}
        for d in (seed or []):
            self.docs[d["_id"]] = dict(d)

    async def insert_one(self, doc):
        # Real Mongo auto-generates _id when absent (bot_credential_uses_col
        # rows never set one explicitly) — mimic that rather than requiring
        # every caller to supply one.
        doc = dict(doc)
        doc.setdefault("_id", f"generated-{len(self.docs)}")
        self.docs[doc["_id"]] = doc

    async def find_one(self, query):
        for doc in self.docs.values():
            if _matches(doc, query):
                return dict(doc)
        return None

    async def update_one(self, query, update):
        for doc in self.docs.values():
            if _matches(doc, query):
                doc.update(update.get("$set", {}))
                return _FakeResult(1)
        return _FakeResult(0)


class _FakeRequest:
    class _URL:
        def __init__(self, path):
            self.path = path

    def __init__(self, token: str | None, method: str = "GET", path: str = "/"):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.method = method
        self.url = self._URL(path)


def _seed_credential(col: _FakeCollection, *, name="test-bot", scopes=("admin:usage",), revoked=False) -> str:
    token = bot_credentials.mint_token()
    col.docs[bot_credentials.hash_token(token)] = {
        "_id": bot_credentials.hash_token(token),
        "name": name,
        "scopes": list(scopes),
        "created_at": datetime.now(timezone.utc),
        "created_by": "kevin.maingi12@gmail.com",
        "revoked_at": datetime.now(timezone.utc) if revoked else None,
        "last_used_at": None,
        "last_used_path": None,
    }
    return token


@pytest.fixture(autouse=True)
def _fake_cols(monkeypatch):
    creds = _FakeCollection()
    uses = _FakeCollection()
    monkeypatch.setattr(bot_credentials, "bot_credentials_col", creds)
    monkeypatch.setattr(bot_credentials, "bot_credential_uses_col", uses)
    return creds, uses


# ── mint_token / hash_token ─────────────────────────────────────────────


def test_mint_token_has_expected_prefix_and_is_unique():
    a = bot_credentials.mint_token()
    b = bot_credentials.mint_token()
    assert a.startswith("sorted_bot_")
    assert b.startswith("sorted_bot_")
    assert a != b


def test_hash_token_is_sha256_hex():
    token = "sorted_bot_abc"
    assert bot_credentials.hash_token(token) == hashlib.sha256(token.encode()).hexdigest()


# ── required_scope: the route allow-list ────────────────────────────────


@pytest.mark.parametrize("method,path,scope", [
    ("POST", "/admin/sync-all", "admin:sync"),
    ("GET", "/admin/llm-usage", "admin:usage"),
    ("GET", "/admin/sync-stats", "admin:usage"),
    ("POST", "/admin/finexer/providers/refresh", "admin:usage"),
    ("PATCH", "/subscription/admin/set-tier", "subscription:admin"),
    ("POST", "/subscription/admin/topup", "subscription:admin"),
    ("POST", "/admin/broadcast/preview", "admin:broadcast"),
    ("POST", "/admin/broadcast/abc123/send", "admin:broadcast"),
    ("GET", "/admin/broadcast", "admin:broadcast"),
    ("GET", "/admin/broadcast/abc123", "admin:broadcast"),
    ("GET", "/admin/allowlist", "admin:allowlist"),
    ("POST", "/admin/allowlist", "admin:allowlist"),
    ("DELETE", "/admin/allowlist/some-key", "admin:allowlist"),
])
def test_required_scope_known_routes(method, path, scope):
    assert bot_credentials.required_scope(method, path) == scope


@pytest.mark.parametrize("method,path", [
    # The core of A28: routes that resolve to "the caller's own account"
    # must never have a bot scope, however plausible one might look.
    ("GET", "/accounts"),
    ("GET", "/transactions"),
    ("GET", "/mcp/audit"),
    ("POST", "/mcp"),
    ("POST", "/admin/fix-card-transactions"),
    ("GET", "/ops/go-live"),
    ("GET", "/offers"),
    # Wrong method on an otherwise-known path.
    ("DELETE", "/admin/sync-all"),
    ("GET", "/subscription/admin/set-tier"),
])
def test_required_scope_closed_routes(method, path):
    assert bot_credentials.required_scope(method, path) is None


# ── resolve_bot_credential ───────────────────────────────────────────────


def test_resolve_bot_credential_accepts_valid_token(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"])
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred == {"bot_name": "usage-dashboard", "scopes": {"admin:usage"}}


def test_resolve_bot_credential_rejects_unknown_token(_fake_cols):
    cred = _run(bot_credentials.resolve_bot_credential("sorted_bot_" + "x" * 40))
    assert cred is None


def test_resolve_bot_credential_rejects_revoked_token(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"], revoked=True)
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred is None


# ── check_bot_request: scope enforcement ────────────────────────────────


def test_check_bot_request_ok_when_scope_matches(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])
    ok, cred = _run(bot_credentials.check_bot_request("GET", "/admin/llm-usage", token))
    assert ok is True
    assert cred["bot_name"] == "test-bot"


def test_check_bot_request_rejects_wrong_scope(_fake_cols):
    """The heart of the ticket: an unscoped/under-scoped credential must be
    rejected on a route outside its granted scope, even though the route
    itself IS bot-eligible."""
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])  # no admin:sync
    ok, cred = _run(bot_credentials.check_bot_request("POST", "/admin/sync-all", token))
    assert ok is False
    assert cred is not None  # credential is real, just not scoped for this route


def test_check_bot_request_rejects_revoked(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"], revoked=True)
    ok, cred = _run(bot_credentials.check_bot_request("GET", "/admin/llm-usage", token))
    assert ok is False
    assert cred is None


def test_check_bot_request_rejects_user_data_route_regardless_of_scopes(_fake_cols):
    """A bot principal cannot reach a user-data route — not even a
    credential scoped with EVERY known scope."""
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=list(bot_credentials.SCOPES))
    for method, path in [("GET", "/accounts"), ("GET", "/transactions"), ("GET", "/mcp/audit")]:
        ok, cred = _run(bot_credentials.check_bot_request(method, path, token))
        assert ok is False, f"{method} {path} should be closed to bot credentials"


# ── record_use: audit trail ──────────────────────────────────────────────


def test_record_use_writes_audit_row_and_stamps_last_used(_fake_cols):
    creds, uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"])
    _run(bot_credentials.record_use("usage-dashboard", "GET", "/admin/llm-usage", True, token=token))

    assert len(uses.docs) == 1
    row = next(iter(uses.docs.values()))
    assert row["bot_name"] == "usage-dashboard"
    assert row["method"] == "GET"
    assert row["path"] == "/admin/llm-usage"
    assert row["ok"] is True
    # The secret itself is never written anywhere in the audit row.
    assert token not in str(row)

    stored = creds.docs[bot_credentials.hash_token(token)]
    assert stored["last_used_at"] is not None
    assert stored["last_used_path"] == "/admin/llm-usage"


def test_record_use_never_raises_when_collections_fail(monkeypatch, _fake_cols):
    class _Boom:
        async def insert_one(self, *a, **k):
            raise RuntimeError("mongo down")

        async def update_one(self, *a, **k):
            raise RuntimeError("mongo down")

    monkeypatch.setattr(bot_credentials, "bot_credential_uses_col", _Boom())
    monkeypatch.setattr(bot_credentials, "bot_credentials_col", _Boom())
    # Must not raise.
    _run(bot_credentials.record_use("x", "GET", "/y", True, token="sorted_bot_z"))


# ── rotation: revoke takes effect on the very next lookup, no caching ────


def test_revoking_a_credential_takes_effect_immediately(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"])
    assert _run(bot_credentials.resolve_bot_credential(token)) is not None

    # Simulate `scripts_bot_credential.py revoke` — a plain Mongo write,
    # no process restart, no cache to invalidate.
    creds.docs[bot_credentials.hash_token(token)]["revoked_at"] = datetime.now(timezone.utc)

    assert _run(bot_credentials.resolve_bot_credential(token)) is None


def test_minting_a_new_credential_is_usable_immediately(_fake_cols):
    creds, _uses = _fake_cols
    # Nothing seeded yet.
    assert len(creds.docs) == 0
    token = _seed_credential(creds, name="fresh", scopes=["admin:sync"])
    ok, cred = _run(bot_credentials.check_bot_request("POST", "/admin/sync-all", token))
    assert ok is True
    assert cred["bot_name"] == "fresh"


# ── app.core.auth.current_user integration ───────────────────────────────


def test_current_user_accepts_scoped_bot_credential(_fake_cols):
    creds, uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    user = _run(auth_mod.current_user(req))
    assert user == {"name": "Bot", "email": None, "bot_name": "usage-dashboard", "scopes": {"admin:usage"}}
    assert len(uses.docs) == 1  # audited exactly once


def test_current_user_rejects_bot_credential_on_user_data_route(_fake_cols):
    """This is the actual A28 defect, closed: a valid credential must not
    be able to read/write a real user's own data."""
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=list(bot_credentials.SCOPES))
    req = _FakeRequest(token, method="GET", path="/accounts")
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(req))
    assert exc.value.status_code == 403


def test_current_user_rejects_revoked_bot_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="usage-dashboard", scopes=["admin:usage"], revoked=True)
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(req))
    assert exc.value.status_code == 401


# ── app.core.auth.auth_middleware integration ────────────────────────────


async def _call_middleware(req, *, will_call_next=True):
    called = {"hit": False}

    async def call_next(_request):
        called["hit"] = True

        class _Resp:
            status_code = 200

        return _Resp()

    resp = await auth_mod.auth_middleware(req, call_next)
    return resp, called["hit"]


def test_auth_middleware_passes_scoped_bot_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    resp, hit = _run(_call_middleware(req))
    assert hit is True
    assert resp.status_code == 200


def test_auth_middleware_blocks_bot_credential_on_closed_route(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=list(bot_credentials.SCOPES))
    req = _FakeRequest(token, method="GET", path="/accounts")
    resp, hit = _run(_call_middleware(req))
    assert hit is False
    assert resp.status_code == 401


def test_auth_middleware_blocks_revoked_bot_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"], revoked=True)
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    resp, hit = _run(_call_middleware(req))
    assert hit is False
    assert resp.status_code == 401


def test_auth_middleware_does_not_double_audit(_fake_cols):
    """The middleware validates but must not itself write an audit row —
    `current_user` (invoked once the route's own dependency runs) is the
    single place a use is logged, see auth_middleware's own comment."""
    creds, uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    _run(_call_middleware(req))
    assert len(uses.docs) == 0


# ── router-level bot-or-owner gates (break-glass) ────────────────────────


def test_admin_sync_all_rejects_ordinary_signed_in_user():
    with pytest.raises(HTTPException) as exc:
        _run(admin_router.admin_sync_all(user={"email": "someone.else@example.com", "name": ""}))
    assert exc.value.status_code == 403


def test_admin_sync_all_accepts_owner_session_break_glass(monkeypatch):
    """Kevin's own real session (not a bot credential) must still be able
    to trigger this even if every bot credential were revoked."""
    from app.core.config import PRIMARY_EMAIL

    class _Cursor:
        async def to_list(self, n):
            return []

    def _fake_find(*a, **k):
        return _Cursor()

    monkeypatch.setattr(admin_router.connections_col, "find", _fake_find)
    result = _run(admin_router.admin_sync_all(user={"email": PRIMARY_EMAIL, "name": ""}))
    assert result == {"connections": 0, "total_accounts": 0, "users": 0}


def test_subscription_admin_set_tier_rejects_ordinary_signed_in_user():
    with pytest.raises(HTTPException) as exc:
        _run(subscription_router.admin_set_tier(
            {"email": "target@example.com", "tier": "lite"},
            user={"email": "someone.else@example.com", "name": ""},
        ))
    assert exc.value.status_code == 403
