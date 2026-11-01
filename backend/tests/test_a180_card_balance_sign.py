"""A180: Finexer passes each bank's own sign through for card balances; the app
stores negative = owed for credit cards. Finexer is mocked; no network, no DB."""
import asyncio
import logging

from tests.test_a176_bank_sync import Client, Resp, IDLE, CONSENT, UID, Col, _wire_sync
from tests.test_a179_account_refresh import (  # noqa: F401  (fixtures)
    TwoAccountClient, AccCol, _quiet, recomputes, _finexer_world, _call,
)
import app.services.finexer_sync as fs


def _client(klass, current, available):
    class C(TwoAccountClient):
        async def get(self, url, params=None):
            if url == "/bank_accounts":
                return Resp(200, {"data": [{"id": "acc1", "class": klass, "provider": "barclays"}]})
            if url.endswith("/balance"):
                return Resp(200, {"data": [{"type": "actual", "current": current, "available": available}]})
            return await super().get(url, params)
    return C(post_responses=[Resp(200, IDLE)])


def _doc(accts):
    return next(x for x in accts.docs if x["_id"] == "acc1")


def test_positive_reporting_card_stores_negative(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", 123.45, 1000.0))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -123.45
    assert d["available"] == 1000.0
    assert d["card_current_sign"] == "positive"


def test_negative_reporting_card_stores_negative_same_magnitude(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", -123.45, -50.0))
    _call("acc1")
    d = _doc(accts)
    assert d["balance"] == -123.45
    assert d["available"] == -50.0
    assert d["card_current_sign"] == "negative"


def test_zero_card_stays_zero(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("credit_card", 0, 500.0))
    _call("acc1")
    assert _doc(accts)["balance"] == 0


def test_current_account_sign_unchanged(monkeypatch, recomputes):
    accts, _ = _finexer_world(monkeypatch, client=_client("current", 123.45, 100.0))
    _call("acc1")
    assert _doc(accts)["balance"] == 123.45 and _doc(accts)["available"] == 100.0
    accts2, _ = _finexer_world(monkeypatch, client=_client("current", -123.45, -100.0))
    _call("acc1")
    assert _doc(accts2)["balance"] == -123.45


def test_log_line_records_raw_sign_before_flip(monkeypatch, recomputes, caplog):
    _finexer_world(monkeypatch, client=_client("credit_card", 123.45, -1.0))
    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        _call("acc1")
    line = next(r.getMessage() for r in caplog.records if "card balance shape" in r.getMessage())
    assert "raw_current_sign=positive" in line and "available_sign=negative" in line
    assert "123" not in line


def test_full_consent_path_applies_the_flip(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    monkeypatch.setattr(fs, "_client", lambda: _client("credit_card", 987.60, 100.0))
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    d = _doc(accts)
    assert d["balance"] == -987.60 and d["available"] == 100.0
    assert d["card_current_sign"] == "positive"
