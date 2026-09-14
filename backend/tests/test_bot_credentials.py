"""A28/A32: app.core.bot_credentials (the replacement for the single static
BOT_SECRET) plus its two integration points in app.core.auth
(`current_user`, `auth_middleware`); also app.main's
`_migrate_bot_credential_expiry` and scripts_bot_credential.py's `create`
(A32: expiry + the unresolved-token audit trail).

Same conventions as tests/test_oauth_server.py: plain `asyncio.run`, a
small in-memory fake standing in for the Motor collections
(`bot_credentials_col`, `bot_credential_uses_col`,
`bot_credential_unknown_col`), module-level names monkeypatched directly.
No TestClient, no real Mongo, no real Redis — a bot credential's own
collections carry no user financial data, but this still follows the
repo-wide convention of never touching the real "wealth" Mongo database
from a unit test (see tests/conftest.py's `_mongo_cleanup_allowed`
docstring for why: there is no separate test database by default).
"""
import asyncio
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.core.auth as auth_mod
import app.core.bot_credentials as bot_credentials
import app.db.collections as db_collections_module
import app.main as main_module
import app.routers.admin as admin_router
import app.routers.subscription as subscription_router
import scripts_bot_credential


def _run(coro):
    return asyncio.run(coro)


def _matches(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if isinstance(v, dict) and "$exists" in v:
            if (k in doc) != v["$exists"]:
                return False
            continue
        if doc.get(k) != v:
            return False
    return True


class _FakeResult:
    def __init__(self, modified_count, upserted_id=None):
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class _FakeCollection:
    """Stands in for a Motor collection: enough surface for
    bot_credentials.py's own lookups (find_one, insert_one, update_one,
    update_many) plus the upsert/$inc/$setOnInsert shape A32's
    record_unknown_attempt needs (bot_credential_unknown_col) and the
    $exists filter A32's legacy-backfill migration needs
    (bot_credentials_col)."""

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

    @staticmethod
    def _apply(doc: dict, update: dict, *, is_insert: bool) -> None:
        if is_insert:
            doc.update(update.get("$setOnInsert", {}))
        doc.update(update.get("$set", {}))
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs.values():
            if _matches(doc, query):
                self._apply(doc, update, is_insert=False)
                return _FakeResult(1)
        if upsert:
            # Real Mongo derives the new doc's non-operator fields from the
            # query (an equality-only query here, e.g. {"_id": "..."}) plus
            # whatever the update sets — good enough for the equality-only
            # queries record_unknown_attempt actually issues.
            new_doc = {k: v for k, v in query.items() if not isinstance(v, dict)}
            self._apply(new_doc, update, is_insert=True)
            new_doc.setdefault("_id", f"generated-{len(self.docs)}")
            self.docs[new_doc["_id"]] = new_doc
            return _FakeResult(0, upserted_id=new_doc["_id"])
        return _FakeResult(0)

    async def update_many(self, query, update):
        count = 0
        for doc in self.docs.values():
            if _matches(doc, query):
                self._apply(doc, update, is_insert=False)
                count += 1
        return _FakeResult(count)


class _FakeRequest:
    class _URL:
        def __init__(self, path):
            self.path = path

    def __init__(self, token: str | None, method: str = "GET", path: str = "/"):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.method = method
        self.url = self._URL(path)


_UNSET = object()


def _seed_credential(
    col: _FakeCollection, *, name="test-bot", scopes=("admin:usage",), revoked=False,
    expires_at=_UNSET,
) -> str:
    """`expires_at=_UNSET` (the default) omits the field entirely — the
    pre-A32 legacy shape, still exercised by every test written before A32
    added expiry, so none of them had to change. Pass an explicit
    datetime (or None, which also omits the field) to control expiry."""
    token = bot_credentials.mint_token()
    doc = {
        "_id": bot_credentials.hash_token(token),
        "name": name,
        "scopes": list(scopes),
        "created_at": datetime.now(timezone.utc),
        "created_by": "kevin.maingi12@gmail.com",
        "revoked_at": datetime.now(timezone.utc) if revoked else None,
        "last_used_at": None,
        "last_used_path": None,
    }
    if expires_at is not _UNSET and expires_at is not None:
        doc["expires_at"] = expires_at
    col.docs[bot_credentials.hash_token(token)] = doc
    return token


@pytest.fixture(autouse=True)
def _fake_cols(monkeypatch):
    creds = _FakeCollection()
    uses = _FakeCollection()
    unknown = _FakeCollection()
    monkeypatch.setattr(bot_credentials, "bot_credentials_col", creds)
    monkeypatch.setattr(bot_credentials, "bot_credential_uses_col", uses)
    # A32: patched here too (autouse) rather than in a separate fixture, so
    # every existing test — including ones written before A32 that only
    # destructure this fixture's return as `creds, uses = _fake_cols` —
    # keeps working unchanged; tests that care about the unknown-attempt
    # audit read it back via `bot_credentials.bot_credential_unknown_col`
    # directly instead of a third return value.
    monkeypatch.setattr(bot_credentials, "bot_credential_unknown_col", unknown)
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


# ═══════════════════════════════════════════════════════════════════════
# A32: expiry
# ═══════════════════════════════════════════════════════════════════════

# ── default_expiry ────────────────────────────────────────────────────

def test_default_expiry_uses_configured_ttl(monkeypatch):
    """Flag-reading discipline: monkeypatch the module-level constant
    bot_credentials imported at load time, never the ambient environment
    (os.getenv already ran once at import, so setting os.environ here
    would have no effect on the already-bound name)."""
    monkeypatch.setattr(bot_credentials, "BOT_CREDENTIAL_DEFAULT_TTL_DAYS", 5)
    before = datetime.now(timezone.utc)
    expiry = bot_credentials.default_expiry()
    after = datetime.now(timezone.utc)
    assert before + timedelta(days=5) <= expiry <= after + timedelta(days=5)


def test_default_expiry_accepts_explicit_override(monkeypatch):
    monkeypatch.setattr(bot_credentials, "BOT_CREDENTIAL_DEFAULT_TTL_DAYS", 90)
    expiry = bot_credentials.default_expiry(days=3)
    now = datetime.now(timezone.utc)
    assert now + timedelta(days=2, hours=23) <= expiry <= now + timedelta(days=3, minutes=1)


# ── resolve_bot_credential: valid before expiry, rejected after ────────

def test_resolve_bot_credential_accepts_token_before_expiry(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, name="usage-dashboard", scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) + timedelta(days=1),
    )
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred == {"bot_name": "usage-dashboard", "scopes": {"admin:usage"}}


def test_resolve_bot_credential_rejects_token_after_expiry(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, name="usage-dashboard", scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred is None


def test_resolve_bot_credential_rejects_token_exactly_at_expiry(_fake_cols):
    """`<=`, not `<`: the instant expires_at is reached the credential is
    dead, it doesn't get one more successful call."""
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, name="usage-dashboard", scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc),
    )
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred is None


def test_resolve_bot_credential_handles_naive_expires_at(_fake_cols):
    """A real Mongo driver can hand back a naive datetime for a value that
    was always meant as UTC (same class of issue app.routers.oauth's
    as_utc handles for code/token expiry) — must not raise comparing
    naive to aware."""
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, name="usage-dashboard", scopes=["admin:usage"],
        expires_at=datetime.utcnow() - timedelta(seconds=1),  # naive, in the past
    )
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred is None


def test_resolve_bot_credential_expired_is_indistinguishable_from_revoked(_fake_cols):
    """The actual acceptance criterion: an expired credential must be
    rejected EXACTLY as a revoked one is — same return value, same shape,
    so a caller (or an attacker probing) cannot tell the two apart."""
    creds, _uses = _fake_cols
    expired_token = _seed_credential(
        creds, name="expired-bot", scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    revoked_token = _seed_credential(creds, name="revoked-bot", scopes=["admin:usage"], revoked=True)
    assert _run(bot_credentials.resolve_bot_credential(expired_token)) is None
    assert _run(bot_credentials.resolve_bot_credential(revoked_token)) is None


def test_resolve_bot_credential_missing_expires_at_is_not_expired(_fake_cols):
    """A32's legacy decision: a credential minted before this field
    existed (expires_at absent entirely, the _seed_credential default) is
    NOT treated as expired — see resolve_bot_credential's own docstring
    for why (instant lockout vs. the migration's bounded grace window)."""
    creds, _uses = _fake_cols
    token = _seed_credential(creds, name="legacy-bot", scopes=["admin:usage"])  # no expires_at
    assert "expires_at" not in creds.docs[bot_credentials.hash_token(token)]
    cred = _run(bot_credentials.resolve_bot_credential(token))
    assert cred == {"bot_name": "legacy-bot", "scopes": {"admin:usage"}}


def test_check_bot_request_rejects_expired_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    ok, cred = _run(bot_credentials.check_bot_request("GET", "/admin/llm-usage", token))
    assert ok is False
    assert cred is None  # same shape as the existing revoked-credential test


# ── current_user / auth_middleware: expired treated exactly like revoked ─

def test_current_user_rejects_expired_bot_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, name="usage-dashboard", scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(req))
    assert exc.value.status_code == 401
    assert exc.value.detail == "Invalid or revoked credential"


def test_auth_middleware_blocks_expired_bot_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, scopes=["admin:usage"],
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    resp, hit = _run(_call_middleware(req))
    assert hit is False
    assert resp.status_code == 401


def test_current_user_accepts_bot_credential_with_no_expires_at(_fake_cols):
    """The behavioural decision under test, end to end: a pre-A32
    credential with no expires_at field keeps working exactly as it did
    before this item, not eternally by accident but because the
    migration is what's responsible for giving it a bound, not this
    validation path."""
    creds, uses = _fake_cols
    token = _seed_credential(creds, name="legacy-bot", scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    user = _run(auth_mod.current_user(req))
    assert user["bot_name"] == "legacy-bot"


# ═══════════════════════════════════════════════════════════════════════
# A32: unknown-token audit trail (record_unknown_attempt)
# ═══════════════════════════════════════════════════════════════════════

def test_record_unknown_attempt_writes_one_row(_fake_cols):
    _run(bot_credentials.record_unknown_attempt("GET", "/admin/llm-usage", "203.0.113.5"))
    unknown = bot_credentials.bot_credential_unknown_col
    assert len(unknown.docs) == 1
    row = next(iter(unknown.docs.values()))
    assert row["source_ip"] == "203.0.113.5"
    assert row["last_method"] == "GET"
    assert row["last_path"] == "/admin/llm-usage"
    assert row["count"] == 1
    assert row["first_seen"] is not None
    assert row["last_seen"] is not None


def test_record_unknown_attempt_never_stores_the_presented_token(_fake_cols):
    """The row must contain no token material at all — not the raw
    token, not a hash, not a truncated prefix. This test's fixture never
    even hands record_unknown_attempt a token (its signature doesn't take
    one — see the function's own docstring for why), so this is really
    asserting the contract stays that way: nothing in the written row
    should ever look like sorted_bot_ material."""
    guessed_token = "sorted_bot_" + "x" * 43
    _run(bot_credentials.record_unknown_attempt("POST", "/admin/sync-all", "203.0.113.5"))
    unknown = bot_credentials.bot_credential_unknown_col
    row = next(iter(unknown.docs.values()))
    assert guessed_token not in str(row)
    assert "sorted_bot_" not in str(row)
    assert bot_credentials.hash_token(guessed_token) not in str(row)


def test_record_unknown_attempt_aggregates_same_day_same_ip(_fake_cols):
    """The flood-bound test: 500 attempts from the same source on the
    same day must produce exactly ONE row, with an accurate count, not
    500 rows."""
    for i in range(500):
        _run(bot_credentials.record_unknown_attempt("GET", f"/admin/probe-{i}", "203.0.113.5"))
    unknown = bot_credentials.bot_credential_unknown_col
    assert len(unknown.docs) == 1
    row = next(iter(unknown.docs.values()))
    assert row["count"] == 500
    # Only the MOST RECENT path/method are kept, not a growing list —
    # otherwise the flood bound on row COUNT would just become an
    # unbounded field on one row instead.
    assert row["last_path"] == "/admin/probe-499"


def test_record_unknown_attempt_separate_rows_for_separate_ips(_fake_cols):
    _run(bot_credentials.record_unknown_attempt("GET", "/admin/llm-usage", "203.0.113.5"))
    _run(bot_credentials.record_unknown_attempt("GET", "/admin/llm-usage", "198.51.100.9"))
    unknown = bot_credentials.bot_credential_unknown_col
    assert len(unknown.docs) == 2


def test_record_unknown_attempt_never_raises_when_collection_fails(monkeypatch, _fake_cols):
    class _Boom:
        async def update_one(self, *a, **k):
            raise RuntimeError("mongo down")

    monkeypatch.setattr(bot_credentials, "bot_credential_unknown_col", _Boom())
    _run(bot_credentials.record_unknown_attempt("GET", "/x", "203.0.113.5"))  # must not raise


# ── integration: unknown-token attempts get audited, resolved uses don't ─

def test_current_user_audits_unknown_bot_token(_fake_cols):
    req = _FakeRequest("sorted_bot_" + "x" * 43, method="GET", path="/admin/llm-usage")
    with pytest.raises(HTTPException):
        _run(auth_mod.current_user(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 1


def test_current_user_audits_revoked_bot_token_as_unknown(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"], revoked=True)
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    with pytest.raises(HTTPException):
        _run(auth_mod.current_user(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 1


def test_current_user_audits_expired_bot_token_as_unknown(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(
        creds, scopes=["admin:usage"], expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    with pytest.raises(HTTPException):
        _run(auth_mod.current_user(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 1


def test_current_user_does_not_audit_unknown_attempt_for_valid_credential(_fake_cols):
    """A resolved credential (even one rejected for wrong scope) is NOT
    an "unknown token" — it goes through record_use instead, with a real
    bot_name, not the anonymous aggregation path."""
    creds, uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    _run(auth_mod.current_user(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 0
    assert len(uses.docs) == 1


def test_current_user_does_not_audit_unknown_attempt_for_wrong_scope(_fake_cols):
    creds, uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])  # no admin:sync
    req = _FakeRequest(token, method="POST", path="/admin/sync-all")
    with pytest.raises(HTTPException):
        _run(auth_mod.current_user(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 0
    assert len(uses.docs) == 1  # still audited via record_use — the credential IS real


def test_auth_middleware_audits_unknown_bot_token(_fake_cols):
    """This is the branch that actually fires in real traffic — the
    middleware, not current_user, is what a real request hits first (see
    auth_middleware's own A32 comment)."""
    req = _FakeRequest("sorted_bot_" + "y" * 43, method="GET", path="/admin/llm-usage")
    resp, hit = _run(_call_middleware(req))
    assert hit is False
    assert resp.status_code == 401
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 1


def test_auth_middleware_does_not_audit_unknown_attempt_for_resolved_credential(_fake_cols):
    creds, _uses = _fake_cols
    token = _seed_credential(creds, scopes=["admin:usage"])
    req = _FakeRequest(token, method="GET", path="/admin/llm-usage")
    _run(_call_middleware(req))
    assert len(bot_credentials.bot_credential_unknown_col.docs) == 0


# ═══════════════════════════════════════════════════════════════════════
# A32: app.main._migrate_bot_credential_expiry
# ═══════════════════════════════════════════════════════════════════════

def test_migrate_bot_credential_expiry_backfills_missing_field(monkeypatch):
    creds = _FakeCollection(seed=[
        {"_id": "legacy-1", "name": "legacy-1", "scopes": ["admin:usage"], "revoked_at": None},
        {"_id": "legacy-2", "name": "legacy-2", "scopes": ["admin:sync"], "revoked_at": None},
    ])
    monkeypatch.setattr(main_module, "bot_credentials_col", creds)

    before = datetime.now(timezone.utc)
    _run(main_module._migrate_bot_credential_expiry())
    after = datetime.now(timezone.utc)

    from app.core.config import BOT_CREDENTIAL_DEFAULT_TTL_DAYS
    for doc_id in ("legacy-1", "legacy-2"):
        expires_at = creds.docs[doc_id]["expires_at"]
        assert before + timedelta(days=BOT_CREDENTIAL_DEFAULT_TTL_DAYS) <= expires_at
        assert expires_at <= after + timedelta(days=BOT_CREDENTIAL_DEFAULT_TTL_DAYS, minutes=1)


def test_migrate_bot_credential_expiry_is_idempotent_and_does_not_touch_existing_values(monkeypatch):
    """A credential minted AFTER A32 (already has its own expires_at, set
    at mint time) must not have that value overwritten by the migration —
    the $exists: False filter is what guarantees that."""
    already_set = datetime.now(timezone.utc) + timedelta(days=3)
    creds = _FakeCollection(seed=[
        {"_id": "fresh-1", "name": "fresh-1", "scopes": ["admin:usage"], "revoked_at": None,
         "expires_at": already_set},
    ])
    monkeypatch.setattr(main_module, "bot_credentials_col", creds)

    _run(main_module._migrate_bot_credential_expiry())

    assert creds.docs["fresh-1"]["expires_at"] == already_set


def test_migrate_bot_credential_expiry_handles_zero_credentials(monkeypatch):
    """As of 2026-09-14 there are zero rows in bot_credentials_col on the
    live database (checked read-only), so this is the actual current-state
    case — must be a no-op, not an error."""
    creds = _FakeCollection()
    monkeypatch.setattr(main_module, "bot_credentials_col", creds)
    _run(main_module._migrate_bot_credential_expiry())  # must not raise
    assert creds.docs == {}


# ═══════════════════════════════════════════════════════════════════════
# A32: scripts_bot_credential.py create() — expiry at mint time
# ═══════════════════════════════════════════════════════════════════════

@pytest.fixture(autouse=True)
def _fake_script_col(monkeypatch, _fake_cols):
    """scripts_bot_credential.py imports bot_credentials_col directly
    (not via app.core.bot_credentials), so it needs its own monkeypatch
    target — point it at the SAME fake `_fake_cols` already installed so
    a test can seed/read through either name."""
    creds, _uses = _fake_cols
    monkeypatch.setattr(scripts_bot_credential, "bot_credentials_col", creds)
    return creds


def test_create_sets_default_expiry(_fake_script_col):
    before = datetime.now(timezone.utc)
    token, expires_at = _run(scripts_bot_credential.create("new-bot", ["admin:usage"], "kevin.maingi12@gmail.com"))
    after = datetime.now(timezone.utc)
    from app.core.config import BOT_CREDENTIAL_DEFAULT_TTL_DAYS
    assert before + timedelta(days=BOT_CREDENTIAL_DEFAULT_TTL_DAYS) <= expires_at
    assert expires_at <= after + timedelta(days=BOT_CREDENTIAL_DEFAULT_TTL_DAYS, minutes=1)
    stored = _fake_script_col.docs[bot_credentials.hash_token(token)]
    assert stored["expires_at"] == expires_at


def test_create_respects_custom_expires_days(_fake_script_col):
    _token, expires_at = _run(scripts_bot_credential.create(
        "short-lived-bot", ["admin:usage"], "kevin.maingi12@gmail.com", expires_days=7,
    ))
    now = datetime.now(timezone.utc)
    assert now + timedelta(days=6, hours=23) <= expires_at <= now + timedelta(days=7, minutes=1)


def test_create_rejects_non_positive_expires_days(_fake_script_col):
    with pytest.raises(SystemExit):
        _run(scripts_bot_credential.create("bad-bot", ["admin:usage"], "kevin.maingi12@gmail.com", expires_days=0))
    with pytest.raises(SystemExit):
        _run(scripts_bot_credential.create("bad-bot", ["admin:usage"], "kevin.maingi12@gmail.com", expires_days=-1))
