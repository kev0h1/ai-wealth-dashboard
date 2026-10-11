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
    for d in (pl._pending, pl._replay, pl._challenges, pl._starts, pl._codes):
        d.clear()
    yield
    for d in (pl._pending, pl._replay, pl._challenges, pl._starts, pl._codes):
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


def _finish(client, state, error=True):
    """Drive the callback for an issued state; returns the code in the page."""
    import re as _re
    r = client.get("/auth/google/mobile-callback", params={"error": "x", "state": state})
    m = _re.search(r"wealthdash://auth-done\?code=([0-9a-f]{32})", r.text)
    return r, (m.group(1) if m else None)


def test_challenge_in_url_cannot_rebind_issued_state(client):
    d = _start(client, "c" * 32)
    client.get("/auth/google/mobile", params={"state": d["state"], "challenge": _sha("evil" * 8)})
    _, code = _finish(client, d["state"])
    assert code
    assert asyncio.run(pl.redeem_code(code, "evil" * 8)) is None
    assert asyncio.run(pl.redeem_code(code, "c" * 32)) == "error:auth_failed"


def test_callback_mints_code_and_stores_nothing_pollable(client):
    d = _start(client, "d" * 32)
    r, code = _finish(client, d["state"])
    assert code and r.status_code == 200
    assert asyncio.run(pl._pop_pending(d["state"])) is None  # nothing under the state
    assert d["state"] not in pl._pending and d["state"] not in pl._replay


def test_poll_never_releases_an_issued_state(client):
    d = _start(client, "1" * 32)
    _finish(client, d["state"])
    # attacker holds state, poll secret AND verifier: still nothing
    body = {"state": d["state"], "poll_secret": d["poll_secret"], "code_verifier": "1" * 32}
    for _ in range(2):
        assert client.post("/auth/mobile/poll", json=body).json() == {"status": "pending"}
    # even with the legacy flag on
    cfg.MOBILE_LOGIN_LEGACY_STATE = True
    try:
        assert client.post("/auth/mobile/poll", json=body).json() == {"status": "pending"}
    finally:
        cfg.MOBILE_LOGIN_LEGACY_STATE = False


def test_redeem_needs_code_and_matching_verifier(client):
    d = _start(client, "e" * 32)
    _, code = _finish(client, d["state"])
    nf = client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "9" * 32})
    assert nf.status_code == 404 and nf.json() == {"detail": "Not Found"}
    assert client.post("/auth/mobile/redeem", json={"code": code}).status_code == 404
    assert client.post("/auth/mobile/redeem", json={"code": "0" * 32, "code_verifier": "e" * 32}).status_code == 404
    assert client.post("/auth/mobile/redeem", json={"code": "zz", "code_verifier": "e" * 32}).json() == {"detail": "Not Found"}
    # wrong guesses consumed nothing
    ok = client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "e" * 32})
    assert ok.status_code == 200 and ok.json() == {"status": "error", "error": "auth_failed"}


def test_foreign_flow_code_is_useless_to_the_receiving_device(client):
    """The attack: attacker starts (holds the verifier), victim completes the
    flow. The code goes to the VICTIM's device, which has no verifier."""
    d = _start(client, "a1" * 16)
    _, code = _finish(client, d["state"])  # delivered to the victim's browser
    # victim's app (no verifier / its own verifier) cannot redeem it
    assert client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "b2" * 16}).status_code == 404
    # the attacker never receives the code; polling gives nothing
    assert client.post("/auth/mobile/poll", json={"state": d["state"], "poll_secret": d["poll_secret"], "code_verifier": "a1" * 16}).json() == {"status": "pending"}


def test_code_is_single_use(client):
    d = _start(client, "2" * 32)
    _, code = _finish(client, d["state"])
    assert client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "2" * 32}).status_code == 200
    assert client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "2" * 32}).status_code == 404
    # the state is closed too: no second authorise, no second code
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code == 404
    _, again = _finish(client, d["state"])
    assert again is None


def test_token_outcome_rides_the_code(client):
    d = _start(client, "3" * 32)
    code = asyncio.run(pl.complete_issued(d["state"], asyncio.run(pl.get_start(d["state"])), "token:SESSION"))
    assert asyncio.run(pl.redeem_code(code, "3" * 32)) == "token:SESSION"
    assert asyncio.run(pl.redeem_code(code, "3" * 32)) is None


def test_code_ttl_expiry(client, monkeypatch):
    d = _start(client, "4" * 32)
    _, code = _finish(client, d["state"])
    real = pl.time.time
    monkeypatch.setattr(pl.time, "time", lambda: real() + pl.CODE_TTL + 5)
    assert client.post("/auth/mobile/redeem", json={"code": code, "code_verifier": "4" * 32}).status_code == 404


def test_code_ttl_is_five_minutes_and_start_outlives_it():
    assert pl.CODE_TTL == 300
    d = asyncio.run(pl.issue_start(_sha("t" * 32), "203.0.113.5"))
    rec = asyncio.run(pl.get_start(d["state"]))
    asyncio.run(pl.complete_issued(d["state"], rec, "token:x"))
    exp = pl._starts[d["state"]][1]
    code_exp = max(e for _, e in pl._codes.values())
    assert exp - code_exp >= 4.5


def test_code_return_never_says_close_this_window(client):
    d = _start(client, "5" * 32)
    ok = asyncio.run(pl.complete_issued(d["state"], asyncio.run(pl.get_start(d["state"])), "token:x"))
    from app.core.signin_handoff import signin_handoff_html
    page = signin_handoff_html(True, code=ok)
    assert "Tap Return to Sorted to finish signing in." in page
    assert "close this window" not in page.lower()
    assert 'data-done="Tap Return' in page
    assert "!" not in "Tap Return to Sorted to finish signing in." and "\u2014" not in page
    # legacy (no code) return keeps the old hint
    assert "You can close this window and return to Sorted." in signin_handoff_html(True)


def test_code_return_url_keeps_frozen_path():
    from app.core.deep_links import signin_return_url
    assert signin_return_url() == "wealthdash://auth-done"
    assert signin_return_url("a" * 32) == "wealthdash://auth-done?code=" + "a" * 32


def test_ttl_expiry(client, monkeypatch):
    d = _start(client, "3" * 32)
    real = pl.time.time
    monkeypatch.setattr(pl.time, "time", lambda: real() + pl.START_TTL + 5)
    assert client.get("/auth/google/mobile", params={"state": d["state"]}).status_code == 404
    _, code = _finish(client, d["state"])
    assert code is None  # an expired start completes nothing


def test_callback_stores_nothing_for_client_chosen_state_when_legacy_off(client):
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
    assert rules["/auth/mobile/redeem"] == (20, 60)
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
