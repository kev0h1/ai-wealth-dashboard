"""app.core.pending_login: the mobile OAuth hand-off store used by
/auth/google/mobile-callback (writer) and /auth/mobile/poll (reader).
Covers the Redis-backed path (with a tiny fake async client) and the
in-process fallback used when Redis is unavailable."""
import asyncio
import time

import pytest

from app.core import pending_login
import hashlib

from app.core.pending_login import _pop_pending, _store_pending, redeem_pending, store_challenge


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, tuple[str, float]] = {}

    async def set(self, key, value, ex=None, nx=False):
        if nx:
            entry = self.store.get(key)
            if entry and (entry[1] is None or entry[1] >= time.time()):
                return None  # redis-py returns None when NX loses
        expires_at = time.time() + ex if ex else None
        self.store[key] = (value, expires_at)
        return True

    async def get(self, key):
        entry = self.store.get(key)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at is not None and expires_at < time.time():
            return None
        return value

    async def getdel(self, key):
        entry = self.store.pop(key, None)
        if not entry:
            return None
        value, expires_at = entry
        if expires_at is not None and expires_at < time.time():
            return None
        return value


@pytest.fixture(autouse=True)
def _clear_local():
    for d in (pending_login._pending, pending_login._replay, pending_login._challenges):
        d.clear()
    yield
    for d in (pending_login._pending, pending_login._replay, pending_login._challenges):
        d.clear()


@pytest.fixture
def fake_redis(monkeypatch):
    client = _FakeRedis()

    async def _ok():
        return True

    monkeypatch.setattr(pending_login, "redis_ok", _ok)
    monkeypatch.setattr(pending_login, "get_redis", lambda: client)
    return client


def test_store_then_pop_returns_value_once(fake_redis):
    asyncio.run(_store_pending("state-1", "token:abc"))
    assert asyncio.run(_pop_pending("state-1")) == "token:abc"


def test_second_pop_of_an_error_is_none(fake_redis):
    asyncio.run(_store_pending("state-2", "error:invite_only"))
    assert asyncio.run(_pop_pending("state-2")) == "error:invite_only"
    assert asyncio.run(_pop_pending("state-2")) is None


def test_token_is_replayable_within_grace_then_gone(fake_redis, monkeypatch):
    # A133: a client that lost/failed the first response can poll again.
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(_store_pending("state-r", "token:abc"))
    assert asyncio.run(_pop_pending("state-r")) == "token:abc"
    current[0] += 10
    assert asyncio.run(_pop_pending("state-r")) == "token:abc"
    current[0] += 25  # 35s after the first read, past the 30s grace
    assert asyncio.run(_pop_pending("state-r")) is None


def test_unknown_state_is_none(fake_redis):
    assert asyncio.run(_pop_pending("never-stored")) is None


def test_expired_entry_is_none(fake_redis, monkeypatch):
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(_store_pending("state-3", "token:abc"))
    current[0] += 301  # past the 300s TTL
    assert asyncio.run(_pop_pending("state-3")) is None


def test_fallback_path_when_redis_unavailable(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    asyncio.run(_store_pending("state-4", "token:xyz"))
    assert asyncio.run(_pop_pending("state-4")) == "token:xyz"
    # A133: replayable within the grace window, then gone.
    assert asyncio.run(_pop_pending("state-4")) == "token:xyz"
    pending_login._replay["state-4"] = ("token:xyz", time.time() - 1)
    assert asyncio.run(_pop_pending("state-4")) is None


def test_fallback_error_is_single_read(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    asyncio.run(_store_pending("state-5", "error:auth_failed"))
    assert asyncio.run(_pop_pending("state-5")) == "error:auth_failed"
    assert asyncio.run(_pop_pending("state-5")) is None


GOOD = "m" + "a1" * 16


def test_state_validator():
    assert pending_login.is_valid_mobile_state(GOOD)
    for bad in ["", None, "m123", "m" + "a" * 31, "x" + "a" * 32, "m" + "A" * 32,
                "m" + "a" * 65, "m" + "g" * 32, "mabc_123", "mabc_" + "1" * 15, "m" + "a" * 17 + "_1700000000000", "mAbC_1700000000000", "mabc_1700000000000x", "../" + GOOD]:
        assert not pending_login.is_valid_mobile_state(bad), bad


SECRET = "5e" * 16
CHALLENGE = hashlib.sha256(SECRET.encode()).hexdigest()


def test_poll_rejects_malformed_state_like_unknown(fake_redis):
    from app.routers.auth import MobilePollBody, mobile_poll, mobile_poll_secret
    # A short state that was somehow stored is never served.
    asyncio.run(_store_pending("short", "token:abc"))
    assert asyncio.run(mobile_poll("short")) == {"status": "pending"}
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state="short", poll_secret=SECRET))) == {"status": "pending"}
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD, poll_secret=SECRET))) == {"status": "pending"}  # unknown


def test_callback_does_not_store_under_malformed_state(fake_redis):
    from app.routers.auth import google_mobile_callback
    asyncio.run(google_mobile_callback(error="denied", state="short"))
    assert fake_redis.store == {} and pending_login._pending == {}
    # A new-format state with no registered challenge is not stored either.
    asyncio.run(google_mobile_callback(error="denied", state=GOOD))
    assert fake_redis.store == {} and pending_login._pending == {}
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(google_mobile_callback(error="denied", state=GOOD))
    assert f"auth:pending:{GOOD}" in fake_redis.store


def test_callback_page_tells_iphone_users_to_close_the_window(fake_redis):
    from app.routers.auth import google_mobile_callback
    html = asyncio.run(google_mobile_callback(error="denied", state=GOOD)).body.decode()
    assert "wealthdash://auth-done" in html and "Return to Sorted" in html
    assert "You can close this window and return to Sorted." in html
    assert "\u2014" not in html


LEGACY = "m" + "k3j9x0q2a1z" + "_" + "1790000000000"


def test_legacy_state_accepted_and_new_still_valid():
    assert pending_login.is_valid_mobile_state(LEGACY)
    assert pending_login.is_legacy_mobile_state(LEGACY)
    assert not pending_login.is_legacy_mobile_state(GOOD)


def test_legacy_state_completes_callback_and_poll(fake_redis):
    from app.routers.auth import google_mobile_callback, mobile_poll
    asyncio.run(google_mobile_callback(error="denied", state=LEGACY))
    assert asyncio.run(mobile_poll(LEGACY)) == {"status": "error", "error": "auth_failed"}
    asyncio.run(_store_pending(LEGACY, "token:abc"))
    assert asyncio.run(mobile_poll(LEGACY)) == {"status": "token", "token": "abc"}


def test_legacy_token_is_not_replayable_redis(fake_redis):
    asyncio.run(_store_pending(LEGACY, "token:abc"))
    assert asyncio.run(_pop_pending(LEGACY)) == "token:abc"
    assert asyncio.run(_pop_pending(LEGACY)) is None
    assert not any(k.startswith("auth:pending-replay:") for k in fake_redis.store)


def test_legacy_token_is_not_replayable_fallback(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    asyncio.run(_store_pending(LEGACY, "token:abc"))
    assert asyncio.run(_pop_pending(LEGACY)) == "token:abc"
    assert asyncio.run(_pop_pending(LEGACY)) is None


@pytest.fixture(params=["redis", "fallback"])
def backend(request, monkeypatch):
    if request.param == "redis":
        client = _FakeRedis()

        async def _ok():
            return True

        monkeypatch.setattr(pending_login, "redis_ok", _ok)
        monkeypatch.setattr(pending_login, "get_redis", lambda: client)
        return client

    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    return None


def test_challenge_is_stored_in_both_backends(backend):
    assert asyncio.run(store_challenge(GOOD, CHALLENGE)) is True
    if backend is not None:
        assert backend.store[f"auth:challenge:{GOOD}"][0] == CHALLENGE
    else:
        assert pending_login._challenges[GOOD][0] == CHALLENGE


def test_challenge_rejected_for_bad_shapes(backend):
    assert asyncio.run(store_challenge(GOOD, "short")) is False
    assert asyncio.run(store_challenge(GOOD, "A" * 64)) is False
    assert asyncio.run(store_challenge("short", CHALLENGE)) is False
    assert asyncio.run(store_challenge(LEGACY, CHALLENGE)) is False


def test_correct_secret_releases_and_replays_within_window(backend, monkeypatch):
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"
    current[0] += pending_login._REPLAY_TTL - 1
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"
    current[0] += 2
    assert asyncio.run(redeem_pending(GOOD, SECRET)) is None


def test_wrong_or_missing_secret_gets_nothing_and_burns_nothing(backend):
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, None)) is None
    assert asyncio.run(redeem_pending(GOOD, "")) is None
    assert asyncio.run(redeem_pending(GOOD, "00" * 16)) is None
    assert asyncio.run(redeem_pending(GOOD, "not-hex")) is None
    assert asyncio.run(redeem_pending(GOOD, CHALLENGE)) is None  # the hash is not the secret
    # none of that consumed the token or created a replay copy
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"


def test_wrong_secret_after_release_gets_no_replay(backend):
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"
    assert asyncio.run(redeem_pending(GOOD, "00" * 16)) is None
    assert asyncio.run(redeem_pending(GOOD, None)) is None


def test_new_state_without_challenge_is_never_released(backend):
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, SECRET)) is None


def test_legacy_state_is_single_read_no_secret_no_replay(backend):
    asyncio.run(_store_pending(LEGACY, "token:abc"))
    assert asyncio.run(redeem_pending(LEGACY, None)) == "token:abc"
    assert asyncio.run(redeem_pending(LEGACY, None)) is None


def test_malformed_state_rejected_by_redeem(backend):
    asyncio.run(_store_pending("short", "token:abc"))
    assert asyncio.run(redeem_pending("short", SECRET)) is None


def test_endpoints_use_secret_in_body_and_legacy_get_cannot_read_new_state(backend):
    from app.routers.auth import MobilePollBody, mobile_poll, mobile_poll_secret
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(mobile_poll(GOOD)) == {"status": "pending"}  # GET has no secret
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD))) == {"status": "pending"}
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD, poll_secret=SECRET))) == {"status": "token", "token": "abc"}


def test_secret_compare_is_constant_time():
    import inspect
    src = inspect.getsource(pending_login._secret_matches)
    assert "hmac.compare_digest" in src
    assert pending_login._secret_matches(SECRET, CHALLENGE) is True
    assert pending_login._secret_matches("00" * 16, CHALLENGE) is False
    assert pending_login._secret_matches(None, CHALLENGE) is False
    assert pending_login._secret_matches(SECRET, None) is False


def test_fallback_replay_copy_expires(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"
    current[0] += pending_login._REPLAY_TTL + 1
    assert asyncio.run(redeem_pending(GOOD, SECRET)) is None


def test_start_endpoint_stores_challenge_and_keeps_it_out_of_the_google_redirect(backend, monkeypatch):
    from app.routers import auth as auth_router
    monkeypatch.setattr(auth_router, "GOOGLE_CLIENT_ID", "cid")
    resp = asyncio.run(auth_router.google_auth_mobile(state=GOOD, challenge=CHALLENGE))
    assert asyncio.run(pending_login.has_challenge(GOOD)) is True
    # only the (non-secret) state goes to Google; never the challenge or secret
    assert CHALLENGE not in resp.headers["location"] and SECRET not in resp.headers["location"]
    # a malformed challenge is ignored, legacy needs none
    asyncio.run(auth_router.google_auth_mobile(state="m" + "b2" * 16, challenge="nothex"))
    assert asyncio.run(pending_login.has_challenge("m" + "b2" * 16)) is False


OTHER_SECRET = "9c" * 16
OTHER_CHALLENGE = hashlib.sha256(OTHER_SECRET.encode()).hexdigest()


def test_challenge_is_write_once_first_secret_wins(backend):
    assert asyncio.run(store_challenge(GOOD, CHALLENGE)) is True
    # a log reader replays the start URL with their own challenge
    assert asyncio.run(store_challenge(GOOD, OTHER_CHALLENGE)) is False
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, OTHER_SECRET)) is None
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"


def test_second_start_through_the_endpoint_does_not_overwrite(backend, monkeypatch):
    from app.routers import auth as auth_router
    monkeypatch.setattr(auth_router, "GOOGLE_CLIENT_ID", "cid")
    first = asyncio.run(auth_router.google_auth_mobile(state=GOOD, challenge=CHALLENGE))
    second = asyncio.run(auth_router.google_auth_mobile(state=GOOD, challenge=OTHER_CHALLENGE))
    assert first.headers["location"] == second.headers["location"]  # no oracle
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, OTHER_SECRET)) is None
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"


def test_expired_challenge_can_be_registered_again(monkeypatch):
    async def _not_ok():
        return False

    monkeypatch.setattr(pending_login, "redis_ok", _not_ok)
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    assert asyncio.run(store_challenge(GOOD, CHALLENGE)) is True
    current[0] += pending_login._CHALLENGE_TTL + 1
    assert asyncio.run(store_challenge(GOOD, OTHER_CHALLENGE)) is True


def test_challenge_outlives_the_pending_ttl(backend):
    assert pending_login._CHALLENGE_TTL > pending_login._PENDING_TTL


def test_wrong_secret_poll_does_not_consume_the_token_via_endpoint(backend):
    from app.routers.auth import MobilePollBody, mobile_poll_secret
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD, poll_secret=OTHER_SECRET))) == {"status": "pending"}
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD))) == {"status": "pending"}
    assert asyncio.run(mobile_poll_secret(MobilePollBody(state=GOOD, poll_secret=SECRET))) == {"status": "token", "token": "abc"}


def test_wrong_secret_poll_leaves_pending_untouched_even_past_the_replay_window(backend, monkeypatch):
    # Popping before the compare would move the token into the 30s replay copy,
    # which then expires: the legitimate client would lose it. So a wrong
    # secret must leave the pending entry in place and create no replay copy.
    current = [1_000_000.0]
    monkeypatch.setattr(pending_login.time, "time", lambda: current[0])
    asyncio.run(store_challenge(GOOD, CHALLENGE))
    asyncio.run(_store_pending(GOOD, "token:abc"))
    assert asyncio.run(redeem_pending(GOOD, OTHER_SECRET)) is None
    if backend is not None:
        assert f"auth:pending:{GOOD}" in backend.store
        assert not any(k.startswith("auth:pending-replay:") for k in backend.store)
    else:
        assert GOOD in pending_login._pending and GOOD not in pending_login._replay
    current[0] += pending_login._REPLAY_TTL + 5  # beyond any replay window
    assert asyncio.run(redeem_pending(GOOD, SECRET)) == "token:abc"
