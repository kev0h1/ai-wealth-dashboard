"""A136: server-issued mobile sign-in state (fixes native sign-in state
fixation, docs/security/A136-native-state-fixation.md)."""
import asyncio
import hashlib
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import config as cfg
from app.core import pending_login as pl
from app.core.ratelimit import RULES
from app.routers import auth


def _sha(x: str) -> str:
    return hashlib.sha256(x.encode()).hexdigest()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    async def no_redis():
        return False

    monkeypatch.setattr(pl, "redis_ok", no_redis)
    monkeypatch.setattr(auth, "GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setattr(cfg, "MOBILE_LOGIN_LEGACY_STATE", False)
    monkeypatch.setattr(cfg, "MOBILE_LOGIN_NET_BIND", "log")
    for d in (pl._pending, pl._replay, pl._challenges, pl._starts):
        d.clear()
    yield
    for d in (pl._pending, pl._replay, pl._challenges, pl._starts):
        d.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(auth.router)
    return TestClient(app, follow_redirects=False)


def _start(client, verifier="a" * 32):
    r = client.post("/auth/mobile/start", json={"challenge": _sha(verifier)})
    assert r.status_code == 200
    return r.json()


def test_start_returns_state_secret_and_expiry(client):
    d = _start(client)
    assert d["state"].startswith("m") and len(d["state"]) == 33
    assert len(d["poll_secret"]) == 32
    assert d["expires_at"].endswith("+00:00")
    assert _start(client)["state"] != d["state"]


def test_start_rejects_bad_challenge(client):
    assert client.post("/auth/mobile/start", json={"challenge": "nope"}).status_code == 400
    assert client.post("/auth/mobile/start", json={}).status_code == 400


def test_authorise_requires_issued_state_when_legacy_off(client):
    d = _start(client)
    ok = client.get("/auth/google/mobile", params={"state": d["state"]})
    assert ok.status_code in (302, 307)
    assert "accounts.google.com" in ok.headers["location"]
    # A client-chosen state, in the old format, with a challenge: rejected.
    chosen = "m" + "b" * 32
    bad = client.get("/auth/google/mobile", params={"state": chosen, "challenge": _sha("x" * 32)})
    assert bad.status_code == 404
    # Unknown and malformed states look identical.
    other = client.get("/auth/google/mobile", params={"state": "zzz"})
    assert other.status_code == 404 and other.json() == bad.json()
    assert not asyncio.run(pl.has_challenge(chosen))  # nothing was registered


def test_challenge_in_url_cannot_rebind_issued_state(client):
    d = _start(client, "c" * 32)
    client.get("/auth/google/mobile", params={"state": d["state"], "challenge": _sha("evil" * 8)})
    asyncio.run(pl._store_pending(d["state"], "token:victim"))
    # attacker's own secret and verifier do not open it
    assert asyncio.run(pl.redeem_issued(d["state"], "e" * 32, "evil" * 8)) is None
    assert asyncio.run(pl.redeem_issued(d["state"], d["poll_secret"], "c" * 32)) == "token:victim"


def test_redeem_needs_poll_secret_and_verifier(client):
    d = _start(client, "d" * 32)
    asyncio.run(pl._store_pending(d["state"], "token:abc"))
    st = d["state"]
    assert asyncio.run(pl.redeem_issued(st, None, "d" * 32)) is None
    assert asyncio.run(pl.redeem_issued(st, d["poll_secret"], None)) is None
    assert asyncio.run(pl.redeem_issued(st, "f" * 32, "d" * 32)) is None
    assert asyncio.run(pl.redeem_issued(st, d["poll_secret"], "9" * 32)) is None
    # wrong guesses consumed nothing
    assert asyncio.run(pl.redeem_issued(st, d["poll_secret"], "d" * 32)) == "token:abc"


def test_poll_endpoint_issued_flow(client):
    d = _start(client, "1" * 32)
    asyncio.run(pl._store_pending(d["state"], "token:xyz"))
    body = {"state": d["state"], "poll_secret": d["poll_secret"]}
    assert client.post("/auth/mobile/poll", json=body).json() == {"status": "pending"}
    body["code_verifier"] = "1" * 32
    assert client.post("/auth/mobile/poll", json=body).json() == {"status": "token", "token": "xyz"}


def test_state_is_single_use(client, monkeypatch):
    d = _start(client, "2" * 32)
    asyncio.run(pl._store_pending(d["state"], "token:once"))
    assert asyncio.run(pl.redeem_issued(d["state"], d["poll_secret"], "2" * 32)) == "token:once"
    # once released, the state can no longer be authorised or complete a login
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code == 404
    client.get("/auth/google/mobile-callback", params={"error": "x", "state": d["state"]})
    assert asyncio.run(pl._pop_pending(d["state"])) in (None, "token:once")  # only the replay copy
    # and after the grace window nothing is left
    pl._replay.clear()
    pl._starts.clear()
    assert asyncio.run(pl.redeem_issued(d["state"], d["poll_secret"], "2" * 32)) is None


def test_ttl_expiry(client, monkeypatch):
    d = _start(client, "3" * 32)
    real = pl.time.time
    monkeypatch.setattr(pl.time, "time", lambda: real() + pl.START_TTL + 5)
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code == 404
    assert asyncio.run(pl.redeem_issued(d["state"], d["poll_secret"], "3" * 32)) is None


def test_callback_stores_only_for_issued_state_when_legacy_off(client):
    d = _start(client)
    client.get("/auth/google/mobile-callback", params={"error": "x", "state": d["state"]})
    assert asyncio.run(pl._pop_pending(d["state"])) == "error:auth_failed"
    chosen = "m" + "a" * 32
    asyncio.run(pl.store_challenge(chosen, _sha("s" * 32)))
    client.get("/auth/google/mobile-callback", params={"error": "x", "state": chosen})
    assert asyncio.run(pl._pop_pending(chosen)) is None


def test_legacy_flag_on_keeps_old_flow_and_logs(client, monkeypatch, caplog):
    monkeypatch.setattr(cfg, "MOBILE_LOGIN_LEGACY_STATE", True)
    chosen = "m" + "a" * 32
    secret = "5" * 32
    with caplog.at_level(logging.INFO, logger=auth.__name__):
        r = client.get("/auth/google/mobile", params={"state": chosen, "challenge": _sha(secret)})
        assert r.status_code in (302, 307)
        client.get("/auth/google/mobile-callback", params={"error": "x", "state": chosen})
    assert "legacy state used" in caplog.text
    assert chosen not in caplog.text
    body = {"state": chosen, "poll_secret": secret}
    assert client.post("/auth/mobile/poll", json=body).json() == {"status": "error", "error": "auth_failed"}
    # pre-A133 format over the GET poll
    legacy = "mabc123_1700000000000"
    client.get("/auth/google/mobile", params={"state": legacy})
    client.get("/auth/google/mobile-callback", params={"error": "x", "state": legacy})
    assert client.get("/auth/mobile/poll", params={"state": legacy}).json()["status"] == "error"


def test_legacy_polls_closed_when_flag_off(client):
    asyncio.run(pl._store_pending("mabc123_1700000000000", "token:t"))
    assert client.get("/auth/mobile/poll", params={"state": "mabc123_1700000000000"}).json() == {"status": "pending"}


def test_net_bind_enforce_rejects_other_network(client, monkeypatch):
    monkeypatch.setattr(cfg, "MOBILE_LOGIN_NET_BIND", "enforce")
    d = _start(client)
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code in (302, 307)
    rec = asyncio.run(pl.get_start(d["state"]))
    rec["net"] = "203.0.113.0/24"
    asyncio.run(pl._start_put(d["state"], rec, 60))
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code == 404


def test_network_prefix():
    assert pl.network_prefix("203.0.113.77") == "203.0.113.0/24"
    assert pl.network_prefix("2001:db8:1:2:3:4:5:6") == "2001:db8:1:2::/64"
    assert pl.network_prefix("unknown") == ""


def test_start_has_its_own_rate_limit_rule():
    rules = {p: (n, w) for p, n, w in RULES}
    assert rules["/auth/mobile/start"] == (10, 60)
    prefixes = [p for p, _, _ in RULES]
    assert prefixes.index("/auth/mobile/start") < prefixes.index("/auth/")


def test_start_is_rate_limited_per_ip():
    from starlette.requests import Request
    from app.core import ratelimit

    async def no_redis():
        return False

    ratelimit._hits.clear()
    scope = {"type": "http", "method": "POST", "path": "/auth/mobile/start", "headers": [],
             "client": ("198.51.100.9", 1234), "query_string": b""}

    async def run():
        results = [await ratelimit.check_rate_limit(Request(scope)) for _ in range(12)]
        return results

    import app.core.ratelimit as rl
    orig = rl.redis_ok
    rl.redis_ok = no_redis
    try:
        results = asyncio.run(run())
    finally:
        rl.redis_ok = orig
        ratelimit._hits.clear()
    assert all(r is None for r in results[:10])
    assert results[10] is not None and results[10].status_code == 429
