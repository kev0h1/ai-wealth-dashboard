"""E6: the Sentry scrubber removes every class of PII, init is a no-op
without a DSN, and no test here ever constructs a client or touches the
network."""
import asyncio
import json
import os

import pytest
from fastapi import HTTPException

import app.core.observability as obs
from app.core.observability import (
    FILTERED, hash_user_id, init_sentry, resolve_traces_sample_rate, scrub_breadcrumb, scrub_event, scrub_string,
)

RAW = {
    "email": "kevin.maingi12@gmail.com",
    "bearer": "Bearer abcdef1234567890abcdef",
    "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlMTIz",
    "card": "4929 1234 5678 9012",
    "sort": "20-12-34",
    "acct": "12345678",
    "iban": "GB29 NWBK 6016 1331 9268 19",
    "amount": "£1,234.56",
    "neg": "−£42.10",
}


def _event():
    return {
        "event_id": "a" * 32,
        "release": "9f8e7d6c5b4a3928a706f5e4d3c2b1a0b9c8d7e6",
        "environment": "uat",
        "server_name": "vps-1",
        "user": {"id": "user-123", "email": "kevin.maingi12@gmail.com", "username": "Kevin Maingi", "ip_address": "1.2.3.4"},
        "request": {
            "method": "POST",
            "url": "https://x.test/transactions?merchant=TESCO&token=abc",
            "query_string": "merchant=TESCO",
            "cookies": {"session": "s3cret"},
            "data": {"amount": 12.5, "merchant": "TESCO"},
            "headers": {"Authorization": "Bearer abcdef1234567890", "Cookie": "a=b", "Content-Type": "application/json", "X-Api-Key": "k"},
            "env": {"REMOTE_ADDR": "1.2.3.4"},
        },
        "exception": {"values": [{
            "type": "ValueError",
            "value": f"bad row for {RAW['email']} paid {RAW['amount']} card {RAW['card']} {RAW['bearer']}",
            "stacktrace": {"frames": [{"filename": "a.py", "function": "f", "lineno": 3, "vars": {"merchant": "TESCO"}, "context_line": "x = 1"}]},
        }]},
        "extra": {"merchant_name": "TESCO", "balance": 100, "note": f"sort {RAW['sort']} acct {RAW['acct']} iban {RAW['iban']}"},
        "tags": {"account_number": "12345678", "route": "/spend"},
        "breadcrumbs": {"values": [
            {"category": "query", "message": "db.transactions.find({merchant: 'TESCO'})"},
            {"category": "httplib", "message": f"GET https://x.test/a?email={RAW['email']}", "data": {"url": "https://x.test/a?email=k@x.com", "body": "secret", "status_code": 200}},
        ]},
    }


def _dump(x) -> str:
    return json.dumps(x)


def test_strings_each_class_removed():
    for name, value in RAW.items():
        out = scrub_string(f"prefix {value} suffix")
        assert value not in out, name
    assert "kevin" not in scrub_string(RAW["email"]).lower()


def test_safe_identifiers_survive():
    sha = "0123456789abcdef0123456789abcdef01234567"
    assert scrub_string(sha) == sha
    ev = scrub_event({"release": sha, "event_id": "b" * 32, "contexts": {"trace": {"trace_id": "c" * 32, "span_id": "d" * 16}}})
    assert ev["release"] == sha and ev["contexts"]["trace"]["trace_id"] == "c" * 32


def test_event_has_no_pii_anywhere():
    out = scrub_event(_event(), {})
    blob = _dump(out)
    for needle in (
        "kevin.maingi12", "Kevin Maingi", "TESCO", "s3cret", "abcdef1234567890", "4929", "20-12-34", "12345678",
        "NWBK", "1,234.56", "1.2.3.4", "k@x.com", "x = 1", "vps-1", "merchant=", "token=abc",
    ):
        assert needle not in blob, needle
    assert out["user"] == {"id": hash_user_id("user-123")}
    assert len(out["user"]["id"]) == 16 and "user-123" not in blob
    assert out["request"]["url"] == "https://x.test/transactions"
    assert set(out["request"]) <= {"method", "url", "headers"}
    assert set(k.lower() for k in out["request"]["headers"]) == {"content-type"}
    assert "vars" not in out["exception"]["values"][0]["stacktrace"]["frames"][0]
    assert out["extra"]["balance"] == FILTERED and out["extra"]["merchant_name"] == FILTERED
    assert out["tags"]["route"] == "/spend"
    assert "server_name" not in out
    assert out["release"] == _event()["release"]


def test_breadcrumbs_scrubbed_and_db_dropped():
    out = scrub_event(_event(), {})
    crumbs = out["breadcrumbs"]["values"]
    assert len(crumbs) == 1 and crumbs[0]["category"] == "httplib"
    assert "body" not in crumbs[0]["data"]
    assert crumbs[0]["data"]["url"] == "https://x.test/a"
    assert crumbs[0]["data"]["status_code"] == 200
    assert "kevin" not in _dump(crumbs[0]).lower()


def test_before_breadcrumb_directly():
    assert scrub_breadcrumb({"category": "mongo", "message": "find"}) is None
    c = scrub_breadcrumb({"category": "console", "message": f"user {RAW['email']} paid {RAW['amount']}", "data": {"authorization": "x", "ok": 1}})
    assert RAW["email"] not in _dump(c) and RAW["amount"] not in _dump(c)
    assert c["data"]["authorization"] == FILTERED and c["data"]["ok"] == 1
    assert scrub_breadcrumb(None) is None


def test_user_without_id_is_dropped():
    ev = _event()
    ev["user"] = {"email": "a@b.co"}
    assert "user" not in scrub_event(ev, {})


def test_expected_4xx_ignored_but_5xx_kept():
    assert scrub_event(_event(), {"exc_info": (HTTPException, HTTPException(404, "nope"), None)}) is None
    assert scrub_event(_event(), {"exc_info": (HTTPException, HTTPException(401, "nope"), None)}) is None
    assert scrub_event(_event(), {"exc_info": (HTTPException, HTTPException(500, "boom"), None)}) is not None
    assert scrub_event(_event(), {"exc_info": (RuntimeError, RuntimeError("x"), None)}) is not None
    assert scrub_event(_event(), {"exc_info": (asyncio.CancelledError, asyncio.CancelledError(), None)}) is None


def test_transaction_spans_lose_descriptions():
    ev = {"type": "transaction", "transaction": "/spend", "spans": [{"op": "db", "description": "SELECT merchant", "data": {"a": 1}, "start_timestamp": 1.0}]}
    out = scrub_event(ev, {})
    assert out["spans"] == [{"op": "db", "start_timestamp": 1.0}]
    assert out["transaction"] == "/spend"


def test_init_is_noop_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    import sentry_sdk
    monkeypatch.setattr(sentry_sdk, "init", lambda *a, **k: pytest.fail("init must not run without a DSN"))
    assert init_sentry() is False
    monkeypatch.setenv("SENTRY_DSN", "   ")
    assert init_sentry() is False


def test_init_passes_strict_options_with_a_dsn(monkeypatch):
    import sentry_sdk
    seen = {}
    monkeypatch.setattr(sentry_sdk, "init", lambda **k: seen.update(k))
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    monkeypatch.setenv("APP_ENV", "uat")
    monkeypatch.setenv("RELEASE_SHA", "abc1234")
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "1.0")
    assert init_sentry() is True
    assert seen["send_default_pii"] is False
    assert seen["traces_sample_rate"] == 0.1
    assert seen["environment"] == "uat" and seen["release"] == "abc1234"
    assert seen["before_send"] is scrub_event and seen["before_breadcrumb"] is scrub_breadcrumb
    assert seen["include_local_variables"] is False and seen["max_request_body_size"] == "never"
    assert seen["profiles_sample_rate"] == 0.0


def test_traces_rate_clamped(monkeypatch):
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "0.05")
    assert resolve_traces_sample_rate() == 0.05
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "nonsense")
    assert resolve_traces_sample_rate() == 0.1
    monkeypatch.setenv("SENTRY_TRACES_SAMPLE_RATE", "-1")
    assert resolve_traces_sample_rate() == 0.0


def test_environment_and_release_resolution(monkeypatch):
    monkeypatch.setenv("APP_ENV", "prod")
    assert obs.resolve_environment() == "production"
    monkeypatch.setenv("APP_ENV", "uat")
    assert obs.resolve_environment() == "uat"
    monkeypatch.delenv("APP_ENV")
    monkeypatch.setenv("SENTRY_ENV", "vps")
    assert obs.resolve_environment() == "uat"
    monkeypatch.setenv("RELEASE_SHA", "deadbeef")
    assert obs.resolve_release() == "deadbeef"


def test_host_metrics_and_sentry_links_never_expose_the_dsn(monkeypatch):
    from app.services import host_metrics
    monkeypatch.setenv("SENTRY_DSN", "https://secretkey@example.invalid/1")
    monkeypatch.setenv("SENTRY_ORG", "auriq")
    monkeypatch.setenv("SENTRY_PROJECTS", "sorted-backend,sorted-web")
    monkeypatch.setenv("APP_ENV", "uat")
    snap = host_metrics.snapshot()
    assert "secretkey" not in _dump(snap)
    assert snap["build"]["sentry_dsn_set"] is True
    assert [l["label"] for l in snap["sentry"]["links"]] == ["sorted-backend", "sorted-web"]
    assert all(l["url"].startswith("https://auriq.sentry.io/issues/") for l in snap["sentry"]["links"])
    assert host_metrics.sentry_links({})["configured"] is False
    assert snap["disk"] is None or snap["disk"]["used_pct"] is not None


def test_ops_health_is_owner_only():
    import app.routers.ops as ops
    with pytest.raises(HTTPException) as ei:
        asyncio.run(ops.ops_health({"email": "someone@else.co"}))
    assert ei.value.status_code == 403
