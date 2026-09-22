"""A84: app.core.session_revocation, plus its call sites —
app.core.auth.current_user and app.routers.auth.validate_session (the two
read sides, every session-branch request and every app-load validity check
respectively), app.routers.profile.delete_account, and
app.services.retention.sweep_dormant_users (the two write sites).

Same convention as tests/test_bot_credentials.py / test_auth_middleware_
catch_all.py: router/dependency functions called directly via asyncio.run,
a tiny in-memory fake standing in for `session_tombstones_col`, no
TestClient, no real Mongo.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.core.auth as auth_mod
import app.core.session_revocation as session_revocation
import app.db.collections as db_collections
import app.routers.auth as auth_router
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


@pytest.fixture(autouse=True)
def _fake_tombstones(monkeypatch):
    # revoke_sessions/is_revoked look `session_tombstones_col` up fresh from
    # app.db.collections on each call (see that module's docstrings), so
    # the fake is installed there, not on app.core.session_revocation's own
    # (unused) namespace.
    col = _FakeTombstoneCol()
    monkeypatch.setattr(db_collections, "session_tombstones_col", col)
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
