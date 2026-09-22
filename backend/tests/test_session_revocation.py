"""A84: app.core.session_revocation, plus its call sites —
app.core.auth.current_user and app.routers.auth.validate_session (the two
session-token read sides, every session-branch request and every app-load
validity check respectively), app.routers.profile.delete_account, and
app.services.retention.sweep_dormant_users (the two write sites).

A84 rework: also app.routers.mcp.resolve_mcp_principal and
app.routers.oauth._handle_refresh_token_grant, the two OAuth-token read
sides revoke_sessions' new belt-and-braces treatment covers — see
session_revocation.py's own module docstring for why the OAuth surface
needed its own fix (oauth_tokens_col keys the user as `uid`, which
erase_user's sweep never matches).

Same convention as tests/test_bot_credentials.py / test_auth_middleware_
catch_all.py: router/dependency functions called directly via asyncio.run,
tiny in-memory fakes standing in for `session_tombstones_col` /
`oauth_tokens_col` / `oauth_codes_col`, no TestClient, no real Mongo.
"""
import asyncio
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.core.auth as auth_mod
import app.core.session_revocation as session_revocation
import app.db.collections as db_collections
import app.routers.auth as auth_router
import app.routers.mcp as mcp_router
import app.routers.oauth as oauth_router
import app.routers.profile as profile_router
import app.services.retention as retention
from app.core.config import serializer


def _run(coro):
    return asyncio.run(coro)


# ── fakes ────────────────────────────────────────────────────────────────

class _FakeResult:
    def __init__(self, modified_count=0):
        self.modified_count = modified_count


class _FakeTombstoneCol:
    """Stand-in for `session_tombstones_col`: only the find_one/update_one
    (with `$max`, upsert) shape session_revocation.py actually issues."""

    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, query):
        doc = self.docs.get(query.get("_id"))
        return dict(doc) if doc is not None else None

    async def update_one(self, query, update, upsert=False):
        _id = query.get("_id")
        doc = self.docs.get(_id)
        if doc is None:
            if not upsert:
                return _FakeResult(0)
            doc = {"_id": _id}
            self.docs[_id] = doc
        for k, v in update.get("$max", {}).items():
            if k not in doc or doc[k] is None or v > doc[k]:
                doc[k] = v
        for k, v in update.get("$set", {}).items():
            doc[k] = v
        return _FakeResult(1)


class _RaisingTombstoneCol:
    """Simulates a Mongo/network failure on read, to prove `current_user`
    fails CLOSED rather than treating an error as "not revoked"."""

    async def find_one(self, query):
        raise RuntimeError("mongo unreachable")

    async def update_one(self, *a, **kw):
        raise RuntimeError("mongo unreachable")


class _FakeURL:
    def __init__(self, path):
        self.path = path


class _FakeRequest:
    def __init__(self, token: str | None, path: str = "/profile"):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.url = _FakeURL(path)
        self.method = "GET"


class _FakeBearerRequest:
    """Minimal stand-in for a FastAPI Request whose only use is the
    Authorization header — enough for mcp.resolve_mcp_principal, which
    reads nothing else off it on the OAuth-token branch."""

    def __init__(self, token: str | None):
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}


class _FakeFormRequest:
    """Stands in for a FastAPI Request whose only use is `.form()` — same
    shape as test_oauth_server.py's own fake."""

    def __init__(self, data: dict):
        self._data = data

    async def form(self):
        return self._data


class _FakeOAuthCollection:
    """Stands in for `oauth_tokens_col` / `oauth_codes_col`: just enough
    Motor surface for session_revocation.revoke_sessions' new
    update_many/delete_many calls, plus the direct find_one/
    find_one_and_update/update_one lookups mcp.resolve_mcp_principal and
    oauth._handle_refresh_token_grant/token_endpoint issue when this file
    drives them directly (same shape as test_oauth_server.py's own
    _FakeCollection, with delete_many added for A84's pending-code
    cleanup)."""

    def __init__(self):
        self.docs: dict = {}

    def _matches(self, doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)

    async def find_one(self, query):
        for doc in self.docs.values():
            if self._matches(doc, query):
                return dict(doc)
        return None

    async def update_one(self, query, update):
        for doc in self.docs.values():
            if self._matches(doc, query):
                doc.update(update.get("$set", {}))
                return _FakeResult(1)
        return _FakeResult(0)

    async def update_many(self, query, update):
        count = 0
        for doc in self.docs.values():
            if self._matches(doc, query):
                doc.update(update.get("$set", {}))
                count += 1
        return _FakeResult(count)

    async def delete_many(self, query):
        to_delete = [k for k, d in self.docs.items() if self._matches(d, query)]
        for k in to_delete:
            del self.docs[k]
        return _FakeResult(len(to_delete))

    async def find_one_and_update(self, query, update):
        for doc in self.docs.values():
            if self._matches(doc, query):
                before = dict(doc)
                doc.update(update.get("$set", {}))
                return before
        return None

    def find(self, query):
        rows = [dict(d) for d in self.docs.values() if self._matches(d, query)]

        class _Cursor:
            def __aiter__(self):
                return self._gen()

            async def _gen(self):
                for r in rows:
                    yield r
        return _Cursor()


def _seed_oauth_pair(email: str, *, client_id: str = "claude-1", created_at: datetime | None = None) -> tuple[str, str]:
    """Inserts an access+refresh token pair directly into
    `db_collections.oauth_tokens_col` (already patched to the fake by
    `_fake_tombstones` below), the way oauth._issue_token_pair would after
    a real grant, without going through the whole authorize/consent/code-
    exchange dance."""
    now = created_at or datetime.now(timezone.utc)
    pair_id = "pair-" + secrets.token_hex(4)
    access_raw = "sorted_at_" + secrets.token_urlsafe(16)
    refresh_raw = "sorted_rt_" + secrets.token_urlsafe(16)
    common = {
        "client_id": client_id, "client_name": "Claude", "uid": email,
        "scopes": ["accounts:read"], "created_at": now, "last_used_at": None,
        "revoked_at": None, "pair_id": pair_id, "origin_code_hash": "x",
    }
    access_hash = hashlib.sha256(access_raw.encode()).hexdigest()
    refresh_hash = hashlib.sha256(refresh_raw.encode()).hexdigest()
    db_collections.oauth_tokens_col.docs[access_hash] = {
        **common, "_id": access_hash, "kind": "access",
        "expires_at": now + timedelta(hours=1), "rotated_from": None,
    }
    db_collections.oauth_tokens_col.docs[refresh_hash] = {
        **common, "_id": refresh_hash, "kind": "refresh",
        "expires_at": now + timedelta(days=29), "rotated_from": None,
    }
    return access_raw, refresh_raw


@pytest.fixture(autouse=True)
def _fake_tombstones(monkeypatch):
    # revoke_sessions/is_revoked look `session_tombstones_col` up fresh from
    # app.db.collections on each call (see that module's docstrings), so
    # the fake is installed there, not on app.core.session_revocation's own
    # (unused) namespace.
    col = _FakeTombstoneCol()
    monkeypatch.setattr(db_collections, "session_tombstones_col", col)
    # A84 rework: revoke_sessions now also writes to oauth_tokens_col
    # (update_many) and oauth_codes_col (delete_many), looked up fresh
    # from app.db.collections the same way session_tombstones_col is —
    # faked here for every test in this file so a call reaches the fake,
    # never the real Motor client. mcp.py and oauth.py each import these
    # names directly into their own module namespace at import time
    # (`from app.db.collections import ... oauth_tokens_col`), so the SAME
    # fake instance is also patched onto those two modules, letting
    # resolve_mcp_principal / the refresh grant see writes revoke_sessions
    # makes via the db_collections binding, and vice versa.
    tokens = _FakeOAuthCollection()
    codes = _FakeOAuthCollection()
    monkeypatch.setattr(db_collections, "oauth_tokens_col", tokens)
    monkeypatch.setattr(db_collections, "oauth_codes_col", codes)
    monkeypatch.setattr(mcp_router, "oauth_tokens_col", tokens)
    monkeypatch.setattr(oauth_router, "oauth_tokens_col", tokens)
    monkeypatch.setattr(oauth_router, "oauth_codes_col", codes)
    # stamp_activity (called at the end of current_user) writes to
    # user_profiles_col — stub it out so these tests don't need a fake for
    # that collection too; it already swallows its own errors, but a bare
    # AttributeError from a real Motor client hitting no DB would still be
    # noisy.
    async def _noop_stamp(*a, **kw):
        return None
    monkeypatch.setattr(retention, "stamp_activity", _noop_stamp)
    yield col


EMAIL = "a84-test@example.com"


def _mint(email=EMAIL) -> str:
    return serializer.dumps({"email": email, "name": "Test"})


# ── is_revoked / revoke_sessions ────────────────────────────────────────

def test_token_issued_before_revoke_is_rejected():
    token = _mint()
    _run(session_revocation.revoke_sessions(EMAIL))
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(_FakeRequest(token)))
    assert exc.value.status_code == 401


def test_token_issued_after_revoke_is_accepted():
    # A real few-second gap, not just "the next line of Python" — itsdangerous
    # truncates a signed timestamp to whole seconds, so a token minted in
    # the SAME wall-clock second as revoke_sessions() could otherwise look
    # earlier than a `not_before` that carries microsecond precision.
    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    _run(session_revocation.revoke_sessions(EMAIL, now=past))
    token = _mint()  # minted AFTER the tombstone — issued_at is later than not_before
    user = _run(auth_mod.current_user(_FakeRequest(token)))
    assert user["email"] == EMAIL


def test_revoke_sessions_keeps_the_later_not_before():
    early = datetime(2026, 1, 1, tzinfo=timezone.utc)
    late = datetime(2026, 6, 1, tzinfo=timezone.utc)
    _run(session_revocation.revoke_sessions(EMAIL, now=late))
    _run(session_revocation.revoke_sessions(EMAIL, now=early))  # must not move it earlier
    key = session_revocation._key(EMAIL)
    stored = db_collections.session_tombstones_col.docs[key]["not_before"]
    assert stored == late


def test_tombstone_key_is_hashed_not_the_raw_email():
    _run(session_revocation.revoke_sessions(" " + EMAIL.upper() + " "))
    key = session_revocation._key(EMAIL)
    assert key in db_collections.session_tombstones_col.docs
    assert EMAIL not in db_collections.session_tombstones_col.docs


def test_tombstone_read_failure_yields_503_not_200(monkeypatch):
    token = _mint()
    monkeypatch.setattr(db_collections, "session_tombstones_col", _RaisingTombstoneCol())
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(_FakeRequest(token)))
    assert exc.value.status_code == 503


# ── POST /auth/session/validate ──────────────────────────────────────────
# This handler decodes the token itself (it predates current_user's
# session branch being the only reader) rather than depending on
# current_user, so it needed the same revocation check applied separately —
# the review that found this named it a live bypass, since AuthProvider.tsx
# calls this on every app load to decide whether to render the
# authenticated shell.

def test_session_validate_rejects_revoked_token():
    old_token = _mint()
    _run(session_revocation.revoke_sessions(EMAIL))
    with pytest.raises(HTTPException) as exc:
        _run(auth_router.validate_session(_FakeRequest(old_token)))
    assert exc.value.status_code == 401

    # A token minted well after the tombstone must still validate. A
    # separate email sidesteps revoke_sessions' `$max` semantics (a second,
    # earlier `now` on the SAME email would not move `not_before` back
    # down), so this isn't just re-testing the first assertion.
    email2 = "a84-test-2@example.com"
    past = datetime.now(timezone.utc) - timedelta(seconds=5)
    _run(session_revocation.revoke_sessions(email2, now=past))
    new_token = _mint(email2)
    result = _run(auth_router.validate_session(_FakeRequest(new_token)))
    assert result == {"valid": True, "name": "Test", "email": email2, "owner": False}


def test_session_validate_fails_closed_on_tombstone_error(monkeypatch):
    token = _mint()
    monkeypatch.setattr(db_collections, "session_tombstones_col", _RaisingTombstoneCol())
    with pytest.raises(HTTPException) as exc:
        _run(auth_router.validate_session(_FakeRequest(token)))
    assert exc.value.status_code == 503


# ── DELETE /account ──────────────────────────────────────────────────────

def test_delete_account_revokes_before_erasing(monkeypatch):
    calls: list = []

    async def fake_revoke(email, now=None):
        calls.append(("revoke", email))

    async def fake_erase(uid):
        calls.append(("erase", uid))
        return {}

    monkeypatch.setattr(profile_router, "revoke_sessions", fake_revoke)
    monkeypatch.setattr(profile_router, "erase_user", fake_erase)

    result = _run(profile_router.delete_account(
        {"confirm": "DELETE"}, user={"email": EMAIL, "name": "Test"},
    ))

    assert result["deleted"] is True
    assert calls == [("revoke", EMAIL), ("erase", EMAIL)]


def test_old_token_rejected_after_delete_account_before_any_profile_write(monkeypatch):
    """The live-observed write path from A84's incident: an old token must
    not be able to reach PUT /profile's upsert after DELETE /account, since
    current_user (the dependency FastAPI runs before the route body) now
    rejects it. Proven against the real revoke_sessions; erase_user is
    monkeypatched here only to avoid touching real collections (same
    doctrine test_retention.py's _patch_all_collections follows) — only the
    revoke-then-block behaviour is under test."""
    old_token = _mint()

    async def fake_erase(uid):
        return {}
    monkeypatch.setattr(profile_router, "erase_user", fake_erase)

    _run(profile_router.delete_account(
        {"confirm": "DELETE"}, user={"email": EMAIL, "name": "Test"},
    ))
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(_FakeRequest(old_token)))
    assert exc.value.status_code == 401


# ── sweep_dormant_users ───────────────────────────────────────────────────

def test_sweep_dormant_users_revokes_before_erasing_each_user(monkeypatch):
    calls: list = []
    now = datetime(2026, 9, 22, tzinfo=timezone.utc)

    class _FakeCursor:
        def __init__(self, docs):
            self._docs = docs

        async def to_list(self, n):
            return list(self._docs)

    class _FakeProfilesCol:
        def __init__(self, docs):
            self.docs = {d["_id"]: dict(d) for d in docs}

        def find(self, filt, proj=None):
            return _FakeCursor([
                dict(d) for d in self.docs.values() if "last_active_at" in d
            ])

    dormant_a = "dormant-a@example.com"
    dormant_b = "dormant-b@example.com"
    profiles = _FakeProfilesCol([
        {"_id": dormant_a, "last_active_at": now - timedelta(days=400)},
        {"_id": dormant_b, "last_active_at": now - timedelta(days=500)},
    ])

    async def fake_revoke(email, now=None):
        calls.append(("revoke", email))

    async def fake_erase(uid):
        calls.append(("erase", uid))
        return {}

    monkeypatch.setattr(retention, "user_profiles_col", profiles)
    monkeypatch.setattr(retention, "revoke_sessions", fake_revoke)
    monkeypatch.setattr(retention, "erase_user", fake_erase)

    result = _run(retention.sweep_dormant_users(now=now))

    assert result["users_erased"] == 2
    # Each user's revoke must happen before that same user's erase.
    seen = {}
    for kind, uid in calls:
        if kind == "revoke":
            assert uid not in seen  # revoke comes first
            seen[uid] = "revoked"
        else:
            assert seen.get(uid) == "revoked"
            seen[uid] = "erased"
    assert seen == {dormant_a: "erased", dormant_b: "erased"}


# ── A84 rework: MCP OAuth access/refresh tokens survive account deletion ──
#
# `oauth_tokens_col` keys the user as `uid`, not `user_id`/`_id`, so
# `erase_user`'s dir()-based sweep never matched it — a `sorted_at_...`
# access token kept authenticating at /mcp, and a `sorted_rt_...` refresh
# token kept minting fresh pairs (resetting its own 30-day TTL on every
# redemption), indefinitely past account deletion. Fixed two ways: (1) the
# belt, `revoke_sessions` now revokes every active oauth_tokens_col doc for
# the identity directly and deletes its pending oauth_codes_col docs; (2)
# the braces, `mcp.resolve_mcp_principal` and `oauth._handle_refresh_token_
# grant` each also consult `is_revoked` against the token's own `uid`/
# `created_at`, so a token the belt didn't (or couldn't, race) flag is
# still refused via the identity-wide tombstone.

async def _delete_account(monkeypatch, email=EMAIL):
    async def fake_erase(uid):
        return {}
    monkeypatch.setattr(profile_router, "erase_user", fake_erase)
    return await profile_router.delete_account(
        {"confirm": "DELETE"}, user={"email": email, "name": "Test"},
    )


def test_mcp_access_token_rejected_after_delete_account(monkeypatch):
    """(a) An MCP access token issued before deletion is refused at /mcp."""
    access_raw, _ = _seed_oauth_pair(EMAIL)
    _run(_delete_account(monkeypatch))
    with pytest.raises(HTTPException) as exc:
        _run(mcp_router.resolve_mcp_principal(_FakeBearerRequest(access_raw)))
    assert exc.value.status_code == 401


def test_mcp_refresh_grant_invalid_grant_and_mints_no_new_pair_after_delete_account(monkeypatch):
    """(b) Its refresh token gets invalid_grant and no new pair is minted."""
    _, refresh_raw = _seed_oauth_pair(EMAIL, client_id="claude-1")
    _run(_delete_account(monkeypatch))
    before = len(db_collections.oauth_tokens_col.docs)

    resp = _run(oauth_router.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": refresh_raw, "client_id": "claude-1",
    })))
    body = json.loads(resp.body)
    assert body["error"] == "invalid_grant"
    assert len(db_collections.oauth_tokens_col.docs) == before  # no new pair minted


def test_oauth_tokens_col_shows_every_doc_for_that_uid_revoked(monkeypatch):
    """(c) oauth_tokens_col shows every doc for that uid revoked."""
    _seed_oauth_pair(EMAIL)
    _seed_oauth_pair(EMAIL, client_id="chatgpt-1")  # a second connection, same uid
    _run(_delete_account(monkeypatch))
    docs = [d for d in db_collections.oauth_tokens_col.docs.values() if d["uid"] == EMAIL]
    assert len(docs) == 4  # two access/refresh pairs
    assert all(d["revoked_at"] is not None for d in docs)


def test_oauth_token_for_a_different_user_is_untouched(monkeypatch):
    """(d) A token issued for a DIFFERENT user is untouched."""
    other_email = "a84-other@example.com"
    other_access, _ = _seed_oauth_pair(other_email)
    _run(_delete_account(monkeypatch, email=EMAIL))

    docs = [d for d in db_collections.oauth_tokens_col.docs.values() if d["uid"] == other_email]
    assert docs and all(d["revoked_at"] is None for d in docs)
    principal = _run(mcp_router.resolve_mcp_principal(_FakeBearerRequest(other_access)))
    assert principal["uid"] == other_email


def test_oauth_token_issued_after_resignup_with_same_email_still_works(monkeypatch):
    """(e) A token created after a later re-signup with the same email
    works (issued after `not_before`)."""
    _run(_delete_account(monkeypatch))
    # Re-signup: a fresh OAuth grant minted well after the tombstone's
    # not_before (a real few-second gap — see test_token_issued_after_
    # revoke_is_accepted above for why this needs real separation).
    later = datetime.now(timezone.utc) + timedelta(seconds=5)
    new_access, _ = _seed_oauth_pair(EMAIL, created_at=later)
    principal = _run(mcp_router.resolve_mcp_principal(_FakeBearerRequest(new_access)))
    assert principal["uid"] == EMAIL


def test_pending_oauth_code_deleted_after_delete_account(monkeypatch):
    """Belt also covers a pending (unredeemed) authorization code — deleted
    outright rather than tombstoned, since a code was never going to
    outlive this call anyway (5 minute TTL)."""
    db_collections.oauth_codes_col.docs["codehash1"] = {
        "_id": "codehash1", "client_id": "claude-1", "uid": EMAIL,
        "redirect_uri": "https://claude.ai/cb", "scopes": ["accounts:read"],
        "code_challenge": "chal", "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5), "used_at": None,
    }
    _run(_delete_account(monkeypatch))
    assert "codehash1" not in db_collections.oauth_codes_col.docs


def test_resolve_mcp_principal_still_rejects_via_tombstone_when_token_not_itself_flagged_revoked(monkeypatch):
    """Braces, isolated from the belt: even if an access token's own
    `revoked_at` were never set (an older token minted before this fix, or
    a belt write that lost a race), the identity-wide tombstone alone must
    still block it."""
    access_raw, _ = _seed_oauth_pair(EMAIL)
    access_hash = hashlib.sha256(access_raw.encode()).hexdigest()
    _run(_delete_account(monkeypatch))
    # Undo the belt's own write to isolate the braces check.
    db_collections.oauth_tokens_col.docs[access_hash]["revoked_at"] = None

    with pytest.raises(HTTPException) as exc:
        _run(mcp_router.resolve_mcp_principal(_FakeBearerRequest(access_raw)))
    assert exc.value.status_code == 401


def test_refresh_grant_still_invalid_via_tombstone_when_token_not_itself_flagged_revoked(monkeypatch):
    """Same isolation as above, for the refresh-grant braces check."""
    _, refresh_raw = _seed_oauth_pair(EMAIL, client_id="claude-1")
    refresh_hash = hashlib.sha256(refresh_raw.encode()).hexdigest()
    _run(_delete_account(monkeypatch))
    db_collections.oauth_tokens_col.docs[refresh_hash]["revoked_at"] = None

    resp = _run(oauth_router.token_endpoint(_FakeFormRequest({
        "grant_type": "refresh_token", "refresh_token": refresh_raw, "client_id": "claude-1",
    })))
    assert json.loads(resp.body)["error"] == "invalid_grant"


def test_resolve_mcp_principal_fails_closed_on_tombstone_read_error(monkeypatch):
    """Fail-closed contract (same as current_user's own): a tombstone
    lookup error on the OAuth-token branch must 503, not silently pass
    the token through as unrevoked."""
    access_raw, _ = _seed_oauth_pair(EMAIL)
    monkeypatch.setattr(db_collections, "session_tombstones_col", _RaisingTombstoneCol())
    with pytest.raises(HTTPException) as exc:
        _run(mcp_router.resolve_mcp_principal(_FakeBearerRequest(access_raw)))
    assert exc.value.status_code == 503


def test_refresh_grant_fails_closed_on_tombstone_read_error(monkeypatch):
    """Same contract on the token endpoint: a tombstone lookup error must
    not let a refresh redemption succeed. No dedicated internal-error
    shape exists on this endpoint today (an unhandled exception from,
    say, oauth_tokens_col.find_one already propagates as-is), so the
    tombstone check matches that by not catching it either — the request
    simply never reaches a success response."""
    _, refresh_raw = _seed_oauth_pair(EMAIL, client_id="claude-1")
    monkeypatch.setattr(db_collections, "session_tombstones_col", _RaisingTombstoneCol())
    with pytest.raises(RuntimeError):
        _run(oauth_router.token_endpoint(_FakeFormRequest({
            "grant_type": "refresh_token", "refresh_token": refresh_raw, "client_id": "claude-1",
        })))
