"""A182 parts 2 and 3: retro_date on consent creation, FINEXER_RETRO_MONTHS,
and the deliberate absence of `scopes`."""
import asyncio
from datetime import datetime

import pytest

import app.routers.finexer as finexer_module
import app.services.finexer_consent as fc
import app.services.finexer_sync as fs
from app.services import runtime_settings

EMAIL = "tester.person@example.com"


class Resp:
    def __init__(self, status, body=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = str(self._body)
        self.headers = {}

    def json(self):
        return self._body


class Client:
    def __init__(self, posts):
        self.posts = list(posts)
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None):
        self.sent.append((url, dict(data or {})))
        return self.posts.pop(0)


@pytest.fixture
def env(monkeypatch):
    async def bump(now=None, **inc):
        return None
    monkeypatch.setattr("app.services.finexer_webhooks.bump_daily_counters", bump)

    def set_months(n):
        async def months():
            return n
        monkeypatch.setattr(fc, "retro_months_setting", months)
    set_months(12)
    return set_months


def _use(monkeypatch, client):
    monkeypatch.setattr(fs, "_client", lambda: client)


def test_retro_date_for_months_clamps_and_zero_sends_none():
    assert fc.retro_date_for(12, datetime(2026, 11, 1)) == "2025-11-01"
    assert fc.retro_date_for(1, datetime(2026, 3, 31)) == "2026-02-28"
    assert fc.retro_date_for(3, datetime(2026, 1, 15)) == "2025-10-15"
    assert fc.retro_date_for(0) is None
    assert fc.retro_date_for(-1) is None


def test_create_consent_sends_retro_date(monkeypatch, env):
    client = Client([Resp(200, {"id": "cst_1"})])
    _use(monkeypatch, client)
    out = asyncio.run(fs.create_consent(EMAIL, "cus_1", "amex", "st"))
    url, data = client.sent[0]
    assert url == "/consents"
    assert data["retro_date"] == fc.retro_date_for(12)
    assert out == {"id": "cst_1"}
    assert out.retro_date_requested == data["retro_date"]


def test_zero_months_sends_no_retro_date(monkeypatch, env):
    env(0)
    client = Client([Resp(200, {"id": "cst_1"})])
    _use(monkeypatch, client)
    out = asyncio.run(fs.create_consent(EMAIL, "cus_1", "amex", "st"))
    assert "retro_date" not in client.sent[0][1]
    assert out.retro_date_requested is None


def test_retro_date_rejected_retries_once_without_it(monkeypatch, env):
    rejected = Resp(400, {"error": {"type": "invalid_request_error", "code": "invalid_parameter",
                                    "message": "retro_date is too far in the past", "param": "retro_date"}})
    client = Client([rejected, Resp(200, {"id": "cst_2"})])
    _use(monkeypatch, client)
    out = asyncio.run(fs.create_consent(EMAIL, "cus_1", "amex", "st"))
    assert "retro_date" in client.sent[0][1] and "retro_date" not in client.sent[1][1]
    assert out == {"id": "cst_2"} and out.retro_date_requested is None


def test_unrelated_400_does_not_retry_without_retro(monkeypatch, env):
    client = Client([Resp(400, {"error": {"code": "invalid_url", "message": "return_url bad", "param": "return_url"}})])
    _use(monkeypatch, client)
    with pytest.raises(fs.FinexerConsentError):
        asyncio.run(fs.create_consent(EMAIL, "cus_1", "amex", "st"))
    assert len(client.sent) == 1


class Col:
    def __init__(self):
        self.docs = []

    async def update_one(self, f, u, upsert=False):
        self.docs.append({**f, **(u.get("$set") or {})})


def test_link_stores_requested_retro_date(monkeypatch):
    col = Col()
    monkeypatch.setattr(finexer_module, "FINEXER_API_KEY", "k")
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)

    async def ok(email):
        return None

    async def cust(user):
        return "cus_1"

    async def create(user_id, customer_id, provider, state, user=None):
        out = fs.ConsentDict({"id": "cst_1", "redirect": {"consent_url": "https://x.example/c"}})
        out.retro_date_requested = "2025-11-01"
        return out
    monkeypatch.setattr(finexer_module, "check_connection_limit", ok)
    monkeypatch.setattr(finexer_module, "check_open_banking_allowed", ok)
    monkeypatch.setattr(finexer_module, "get_or_create_customer", cust)
    monkeypatch.setattr(finexer_module, "create_consent", create)

    async def no_template():
        return False
    monkeypatch.setattr(finexer_module, "_template_setting", no_template)
    asyncio.run(finexer_module.finexer_link(provider="amex", user={"email": EMAIL}))
    assert col.docs[0]["retro_date_requested"] == "2025-11-01"


def test_setting_is_registered_with_default_12_and_bounds():
    spec = runtime_settings.REGISTRY["FINEXER_RETRO_MONTHS"]
    assert spec.default == 12 and spec.min == 0 and spec.max == 60
    assert runtime_settings.validate("FINEXER_RETRO_MONTHS", 24) == 24
    with pytest.raises(runtime_settings.SettingError):
        runtime_settings.validate("FINEXER_RETRO_MONTHS", 61)
