"""C43: the Apple App Review demo sign-in and its isolation from bank providers.

No Mongo and no network: routes are awaited directly via asyncio.run(), the
convention of tests/test_apple_auth.py. The demo identity's password is a
throwaway generated per run.
"""
import asyncio
import secrets
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import app.core.config as config
import app.core.identity as identity_module
import app.routers.auth as auth_module
from app.core import demo, ratelimit
from app.core.config import serializer

DEMO_EMAIL = "appreview@auriqltd.co.uk"
_PASSWORD = secrets.token_urlsafe(18)
_HASH = demo.hash_password(_PASSWORD)


def _run(coro):
    return asyncio.run(coro)


class _Req:
    def __init__(self, path="/auth/demo/login", method="POST", ip="203.0.113.90", headers=None):
        self.url = SimpleNamespace(path=path)
        self.method = method
        self.headers = headers or {}
        self.client = SimpleNamespace(host=ip)


@pytest.fixture(autouse=True)
def _demo_on(monkeypatch):
    monkeypatch.setattr(config, "DEMO_LOGIN_ENABLED", True)
    monkeypatch.setattr(config, "DEMO_LOGIN_EMAIL", DEMO_EMAIL)
    monkeypatch.setattr(config, "DEMO_PASSWORD_HASH", _HASH)

    async def _not_ok():
        return False
    monkeypatch.setattr(ratelimit, "redis_ok", _not_ok)
    ratelimit._hits.clear()
    yield
    ratelimit._hits.clear()


# ---- password hashing -------------------------------------------------------

def test_hash_round_trip_and_wrong_password():
    assert _HASH.startswith("scrypt$")
    assert _PASSWORD not in _HASH
    assert demo.verify_password(_PASSWORD, _HASH)
    assert not demo.verify_password(_PASSWORD + "x", _HASH)
    assert not demo.verify_password("", _HASH)


def test_hashes_are_salted():
    assert demo.hash_password("same") != demo.hash_password("same")


@pytest.mark.parametrize("bad", ["", "plaintext", "scrypt$x$y", "bcrypt$14$8$1$AA==$AA==", "scrypt$99$8$1$AA==$AA=="])
def test_malformed_hash_never_verifies_and_never_raises(bad):
    assert demo.verify_password(_PASSWORD, bad) is False


# ---- the login route --------------------------------------------------------

def _login(username, password):
    return _run(auth_module.demo_login(auth_module.DemoLoginBody(username=username, password=password), _Req()))


def test_login_success_mints_the_normal_session_token():
    out = _login(DEMO_EMAIL, _PASSWORD)
    assert out["ok"] is True
    data = serializer.loads(out["session_token"])
    assert data["email"] == DEMO_EMAIL


def test_username_is_case_insensitive_and_trimmed():
    assert _login("  AppReview@AuriqLtd.co.uk ", _PASSWORD)["ok"] is True


@pytest.mark.parametrize("user,pw", [
    (DEMO_EMAIL, "wrong"), ("someone@else.com", _PASSWORD), ("", ""), (DEMO_EMAIL, ""),
])
def test_every_failure_is_the_same_generic_401(user, pw):
    with pytest.raises(HTTPException) as exc:
        _login(user, pw)
    assert exc.value.status_code == 401
    assert exc.value.detail == "Those details didn't work."


def test_disabled_flag_is_404(monkeypatch):
    monkeypatch.setattr(config, "DEMO_LOGIN_ENABLED", False)
    with pytest.raises(HTTPException) as exc:
        _login(DEMO_EMAIL, _PASSWORD)
    assert exc.value.status_code == 404


def test_no_hash_configured_is_404_and_never_authenticates(monkeypatch):
    monkeypatch.setattr(config, "DEMO_PASSWORD_HASH", "")
    with pytest.raises(HTTPException) as exc:
        _login(DEMO_EMAIL, "")
    assert exc.value.status_code == 404
    assert demo.check_demo_credentials(DEMO_EMAIL, "") is False


def test_enabled_status_endpoint(monkeypatch):
    assert _run(auth_module.demo_login_enabled_status()) == {"enabled": True}
    monkeypatch.setattr(config, "DEMO_LOGIN_ENABLED", False)
    assert _run(auth_module.demo_login_enabled_status()) == {"enabled": False}


def test_flag_defaults_off():
    assert config._parse_flag(None) is False
    assert config._parse_flag("") is False
    assert config._parse_flag("true") is True


def _count_ceiling(monkeypatch, tripped):
    calls = []

    async def _limit(key, limit, window):
        calls.append((key, limit, window))
        return 42 if tripped else None
    monkeypatch.setattr(ratelimit, "check_keyed_limit", _limit)
    return calls


def test_tripped_ceiling_still_lets_the_right_password_in(monkeypatch):
    calls = _count_ceiling(monkeypatch, tripped=True)
    assert _login(DEMO_EMAIL, _PASSWORD)["ok"] is True
    assert calls == [], "a success never touches the ceiling"


def test_tripped_ceiling_429s_a_wrong_password_and_warns_once_per_window(monkeypatch, caplog):
    import logging
    calls = _count_ceiling(monkeypatch, tripped=True)
    monkeypatch.setattr(auth_module, "_demo_ceiling_warned_window", -1)
    with caplog.at_level(logging.WARNING):
        for _ in range(3):
            with pytest.raises(HTTPException) as exc:
                _login(DEMO_EMAIL, "wrong")
            assert exc.value.status_code == 429
    warned = [r for r in caplog.records if "ceiling reached" in r.getMessage()]
    assert len(warned) == 1
    assert _PASSWORD not in caplog.text and "wrong" not in caplog.text.replace("Demo sign-in", "")
    assert calls and calls[0][0] == "demo-login-failures" and calls[0][1] == 60


def test_only_failures_consume_the_ceiling(monkeypatch):
    calls = _count_ceiling(monkeypatch, tripped=False)
    for _ in range(4):
        _login(DEMO_EMAIL, _PASSWORD)
    assert calls == []
    with pytest.raises(HTTPException) as exc:
        _login(DEMO_EMAIL, "nope")
    assert exc.value.status_code == 401 and len(calls) == 1


# ---- logout ------------------------------------------------------------------

def _logout(email, monkeypatch):
    seen = {"revoked": [], "push": []}

    async def _revoke(e):
        seen["revoked"].append(e)

    async def _drop(e):
        seen["push"].append(e)
    monkeypatch.setattr(auth_module, "revoke_sessions", _revoke)
    monkeypatch.setattr(auth_module, "drop_user_push_registrations", _drop)
    out = _run(auth_module.logout(user={"email": email, "name": "x"}))
    return out, seen


def test_demo_logout_succeeds_without_signing_other_reviewers_out(monkeypatch):
    out, seen = _logout(DEMO_EMAIL, monkeypatch)
    assert out == {"ok": True}
    assert seen == {"revoked": [], "push": []}
    second = serializer.dumps({"email": DEMO_EMAIL, "name": "App Review"})
    assert serializer.loads(second)["email"] == DEMO_EMAIL, "a second demo session is untouched"


def test_normal_logout_still_revokes_everything(monkeypatch):
    out, seen = _logout("someone.real@example.com", monkeypatch)
    assert out == {"ok": True}
    assert seen == {"revoked": ["someone.real@example.com"], "push": ["someone.real@example.com"]}


def test_per_ip_rule_is_tighter_than_the_generic_auth_rule():
    rules = [r for r in ratelimit.RULES if r[0] == "/auth/demo/login"]
    assert rules and rules[0][1] <= 5
    assert ratelimit.RULES.index(rules[0]) < ratelimit.RULES.index(("/auth/", 30, 60))
    ip = "203.0.113.91"
    for _ in range(5):
        assert _run(ratelimit.check_rate_limit(_Req(ip=ip))) is None
    limited = _run(ratelimit.check_rate_limit(_Req(ip=ip)))
    assert limited is not None and limited.status_code == 429


# ---- identity: nobody else can become the demo user --------------------------

def test_google_and_apple_sign_in_can_never_resolve_to_the_demo_identity():
    for provider in ("google-native", "google-web", "google-mobile"):
        assert _run(identity_module.resolve_signin_email(provider, DEMO_EMAIL)) is None
    assert _run(identity_module.resolve_signin_email("apple-native", DEMO_EMAIL.upper(), subject="s", relay=False)) is None


# ---- isolation: the central block list --------------------------------------

_BLOCKED = [
    ("GET", "/auth/finexer/link"), ("GET", "/auth/finexer/providers"), ("GET", "/auth/finexer/pending"),
    ("POST", "/auth/finexer/consents/abc/reconfirm"),
    ("GET", "/auth/truelayer/link"), ("GET", "/auth/truelayer/providers"),
    ("DELETE", "/account"),
    ("POST", "/billing/checkout"), ("POST", "/billing/portal"),
    ("POST", "/billing/apple/verify"), ("POST", "/billing/play/purchase"),
    ("POST", "/accounts/sync"), ("POST", "/accounts/sync-history"), ("POST", "/accounts/acc1/refresh"),
    ("GET", "/penny/conversations/export"), ("POST", "/auth/identities/apple"), ("DELETE", "/auth/identities/apple"),
    ("POST", "/subscription/select-free"), ("DELETE", "/connections/c1"), ("POST", "/oauth/decision"),
    ("DELETE", "/account/"),
]


@pytest.mark.parametrize("method,path", _BLOCKED)
def test_blocked_routes_are_refused_for_the_demo_user_only(method, path):
    assert demo.demo_blocked(DEMO_EMAIL, method, path) is True
    assert demo.demo_blocked("kevin.maingi12@gmail.com", method, path) is False


@pytest.mark.parametrize("method,path", _BLOCKED)
def test_current_user_refuses_a_demo_session_on_blocked_routes(method, path):
    import app.core.auth as auth_mod
    token = serializer.dumps({"email": DEMO_EMAIL, "name": "App Review"})
    req = _Req(path=path, method=method, headers={"Authorization": f"Bearer {token}"})
    with pytest.raises(HTTPException) as exc:
        _run(auth_mod.current_user(req))
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "DEMO_RESTRICTED"


def test_everyday_routes_are_not_blocked_for_the_demo_user():
    for method, path in [("GET", "/accounts"), ("GET", "/safe-to-spend"), ("DELETE", "/accounts/a1"), ("GET", "/auth/identities"),
                         ("GET", "/auth/session/validate"), ("POST", "/penny/chat")]:
        assert demo.demo_blocked(DEMO_EMAIL, method, path) is False


def test_is_demo_user_edges():
    assert demo.is_demo_user(DEMO_EMAIL) and demo.is_demo_user(DEMO_EMAIL.upper())
    assert not demo.is_demo_user(None) and not demo.is_demo_user("") and not demo.is_demo_user("x@y.com")
    assert not demo.is_demo_user("appreview@auriqltd.co.uk.evil.com")


# ---- isolation: service-level guards ----------------------------------------

def test_check_open_banking_allowed_refuses_demo():
    from app.core.subscription import check_open_banking_allowed
    with pytest.raises(HTTPException) as exc:
        _run(check_open_banking_allowed(DEMO_EMAIL))
    assert exc.value.status_code == 403


def test_finexer_consent_and_customer_creation_refuse_demo():
    from app.services import finexer_sync as fs
    with pytest.raises(HTTPException) as exc:
        _run(fs.get_or_create_customer({"email": DEMO_EMAIL}))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _run(fs.create_consent(DEMO_EMAIL, "cust", None, "state"))
    assert exc.value.status_code == 403


def test_link_routes_refuse_demo():
    from app.routers import finexer as fx_router, truelayer as tl_router
    user = {"email": DEMO_EMAIL}
    with pytest.raises(HTTPException) as exc:
        _run(fx_router.finexer_link(user=user))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _run(fx_router.finexer_reconfirm("c1", user=user))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _run(tl_router.truelayer_link(user=user))
    assert exc.value.status_code == 403


def test_delete_account_refuses_demo():
    from app.routers import profile
    with pytest.raises(HTTPException) as exc:
        _run(profile.delete_account({"confirm": "DELETE"}, user={"email": DEMO_EMAIL}))
    assert exc.value.status_code == 403


def test_sync_entry_points_skip_demo_without_touching_a_bank():
    from app.services import finexer_sync as fs, truelayer_sync as tl
    assert _run(fs.sync_finexer_consent("c1", DEMO_EMAIL)) == ([], 0)
    assert _run(fs.finexer_sync_pipeline("c1", DEMO_EMAIL)) == {"ok": False, "skipped": "demo"}
    assert _run(tl.sync_connection("conn1", DEMO_EMAIL)) == ([], 0)


def test_worker_sync_tasks_skip_demo():
    from app.workers import sync_worker
    assert _run(sync_worker.task_sync_finexer({}, "c1", DEMO_EMAIL)) == {"skipped": "demo"}
    assert _run(sync_worker.task_sync_truelayer({}, "conn1", DEMO_EMAIL)) == {"skipped": "demo"}
