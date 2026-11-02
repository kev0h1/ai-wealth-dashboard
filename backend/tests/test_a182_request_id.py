"""A182 part 5: the fx-request-id response header is logged on every Finexer
error path, masked only when it looks like a secret."""
import asyncio
import logging

import pytest

import app.routers.finexer as finexer_module
import app.services.finexer_consent as fc
import app.services.finexer_sync as fs

KEY = "sk_live_abcdef1234567890SECRET"


class Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = str(self._body)
        self.headers = headers if headers is not None else {}

    def json(self):
        return self._body


class Client:
    def __init__(self, get=None, post=None):
        self._get, self._post = get, list(post or [])

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        return self._get

    async def post(self, url, data=None):
        return self._post.pop(0)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(fs, "FINEXER_API_KEY", KEY)

    async def bump(now=None, **inc):
        return None
    monkeypatch.setattr("app.services.finexer_webhooks.bump_daily_counters", bump)


def _lines(caplog):
    return [r.getMessage() for r in caplog.records if "fx-request-id" in r.getMessage()]


def test_get_error_logs_request_id(caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    client = Client(get=Resp(500, headers={"fx-request-id": "req_8f2a91c4"}))
    resp = asyncio.run(fs._get(client, "/consents/cst_1"))
    assert resp.status_code == 500
    lines = _lines(caplog)
    assert len(lines) == 1 and "status=500" in lines[0] and "fx-request-id=req_8f2a91c4" in lines[0]
    assert "/consents/cst_1" in lines[0]


def test_get_success_logs_nothing(caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    asyncio.run(fs._get(Client(get=Resp(200, headers={"fx-request-id": "req_ok"})), "/x"))
    assert _lines(caplog) == []


def test_post_error_logs_request_id(caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    client = Client(post=[Resp(429, headers={"fx-request-id": "req_429"})])
    asyncio.run(fs._post(client, "/bank_accounts/ba_1/sync"))
    assert "fx-request-id=req_429" in _lines(caplog)[0]


def test_missing_header_logs_none_and_never_raises(caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    asyncio.run(fs._get(Client(get=Resp(502)), "/x"))
    assert "fx-request-id=None" in _lines(caplog)[0]
    fs.log_finexer_error(object(), "weird")  # no status, no headers: silent no-op


@pytest.mark.parametrize("value", [KEY, "sk_live_abcdef123456", "tok_abcdefgh1234", f"prefix-{KEY}"])
def test_secret_looking_value_is_masked(caplog, value):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    asyncio.run(fs._get(Client(get=Resp(500, headers={"fx-request-id": value})), "/x"))
    text = "\n".join(_lines(caplog))
    assert "[redacted]" in text and "abcdef123456" not in text and "SECRET" not in text


def test_create_customer_and_consent_errors_log_request_id(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    boom = Resp(500, {"error": {"message": "x"}}, {"fx-request-id": "req_cust"})
    monkeypatch.setattr(fs, "_client", lambda: Client(post=[boom]))
    with pytest.raises(fs.FinexerConsentError):
        asyncio.run(fs._create_customer({"email": "a@example.com", "name": "A"}))
    assert any("POST /customers" in l and "req_cust" in l for l in _lines(caplog))

    async def months():
        return 12
    monkeypatch.setattr(fc, "retro_months_setting", months)
    bad = Resp(500, {"error": {"message": "x"}}, {"fx-request-id": "req_cons"})
    monkeypatch.setattr(fs, "_client", lambda: Client(post=[bad]))
    with pytest.raises(fs.FinexerConsentError):
        asyncio.run(fs.create_consent("a@example.com", "cus_1", "amex", "st"))
    assert any("POST /consents" in l and "req_cons" in l for l in _lines(caplog))


def test_reconfirm_error_logs_request_id(monkeypatch, caplog):
    caplog.set_level(logging.WARNING, logger=fs.logger.name)
    bad = Resp(503, {}, {"fx-request-id": "req_reconf"})
    monkeypatch.setattr(fs, "_client", lambda: Client(post=[bad]))
    with pytest.raises(fc.ReconfirmError):
        asyncio.run(fc.reconfirm_consent("cst_1"))
    assert any("req_reconf" in l for l in _lines(caplog))
