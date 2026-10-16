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

@pytest.fixture(autouse=True)
def _salt(monkeypatch):
    monkeypatch.setenv("SENTRY_USER_HASH_SALT", "test-salt")


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
        "user": {"id": hash_user_id("kevin@example.com"), "email": "kevin.maingi12@gmail.com", "username": "Kevin Maingi", "ip_address": "1.2.3.4"},
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
    assert out["user"] == {"id": hash_user_id("kevin@example.com")}
    assert len(out["user"]["id"]) == 16
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
    ev["user"] = {"id": "kevin@example.com"}  # a raw id is dropped, never re-hashed
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


def test_url_query_stripped_inside_strings_and_user_hash_helper(monkeypatch):
    assert scrub_string("GET https://x.test/a/b?merchant=TESCO&x=1#frag ok") == "GET https://x.test/a/b ok"
    import sentry_sdk
    calls = []
    monkeypatch.setattr(sentry_sdk, "set_user", lambda u: calls.append(u))
    obs.set_sentry_user("Kevin@Example.com")  # no client active in tests: no-op
    assert calls == []
    monkeypatch.setattr(sentry_sdk.get_client().__class__, "is_active", lambda self: True)
    obs.set_sentry_user("Kevin@Example.com")
    assert calls == [{"id": hash_user_id("kevin@example.com")}]
    assert hash_user_id("kevin@example.com") == hash_user_id("kevin@example.com") and len(hash_user_id("a")) == 16


def test_unset_salt_means_no_hash_no_user_no_uid_hash(monkeypatch, caplog):
    import sentry_sdk
    monkeypatch.delenv("SENTRY_USER_HASH_SALT")
    assert hash_user_id("kevin@example.com") is None
    calls = []
    monkeypatch.setattr(sentry_sdk, "set_user", lambda u: calls.append(u))
    monkeypatch.setattr(sentry_sdk.get_client().__class__, "is_active", lambda self: True)
    obs.set_sentry_user("kevin@example.com")
    assert calls == []
    ev = _event()
    ev["user"] = {"id": "0123456789abcdef"}
    assert scrub_event(ev, {})["user"] == {"id": "0123456789abcdef"}  # already a hash: kept
    # the startup warning, once, when a DSN is set without a salt
    monkeypatch.setattr(sentry_sdk, "init", lambda **k: None)
    monkeypatch.setenv("SENTRY_DSN", "https://public@example.invalid/1")
    with caplog.at_level("WARNING"):
        assert init_sentry() is True
    assert sum("SENTRY_USER_HASH_SALT" in r.getMessage() for r in caplog.records) == 1


def test_event_user_id_matches_validate_uid_hash(monkeypatch):
    import sentry_sdk
    from app.routers import auth as auth_router  # noqa: F401
    uid = hash_user_id("kevin@example.com")
    seen = {}
    monkeypatch.setattr(sentry_sdk, "set_user", lambda u: seen.update(u))
    monkeypatch.setattr(sentry_sdk.get_client().__class__, "is_active", lambda self: True)
    obs.set_sentry_user("Kevin@Example.com")
    ev = _event()
    ev["user"] = dict(seen)
    assert scrub_event(ev, {})["user"]["id"] == uid


def test_free_text_keys_filtered():
    ev = _event()
    ev["extra"] = {"note": "paid TESCO", "counterparty": "TESCO", "prompt": "p", "title": "t", "text": "x"}
    ev["breadcrumbs"]["values"][1]["data"].update({"narrative": "TESCO", "content": "c", "notes": "n"})
    out = scrub_event(ev, {})
    assert "TESCO" not in _dump(out)
    assert out["extra"]["note"] == FILTERED
    assert out["breadcrumbs"]["values"][0]["data"]["narrative"] == FILTERED


def test_release_git_fallback_is_cached(monkeypatch):
    monkeypatch.delenv("RELEASE_SHA", raising=False)
    monkeypatch.delenv("RAILWAY_GIT_COMMIT_SHA", raising=False)
    obs._git_sha.cache_clear()
    calls = []
    real = obs.subprocess.run
    monkeypatch.setattr(obs.subprocess, "run", lambda *a, **k: (calls.append(1), real(*a, **k))[1])
    obs.resolve_release(); obs.resolve_release(); obs.resolve_release()
    assert len(calls) == 1


DUP = 'E11000 duplicate key error collection: wealth.rules index: u dup key: { merchant: "Greggs" }, full error: {"keyValue": {"merchant": "Greggs"}}'


def test_db_error_reduced_to_class_and_code():
    ev = {"exception": {"values": [{"type": "DuplicateKeyError", "module": "pymongo.errors", "value": DUP}]},
          "logentry": {"message": DUP}, "message": DUP}
    out = scrub_event(ev, {})
    assert out["exception"]["values"][0]["value"] == "DuplicateKeyError (code 11000)"
    assert "Greggs" not in _dump(out)
    # Even without a recognised class, the dup-key text is cut.
    out2 = scrub_event({"exception": {"values": [{"type": "RuntimeError", "value": f"wrapped: {DUP}"}]}}, {})
    assert "Greggs" not in _dump(out2)


def test_upstream_http_error_reduced_to_status():
    ev = {"exception": {"values": [{"type": "HTTPStatusError",
          "value": "Client error '402 Payment Required' for url 'https://openrouter.ai/api?merchant=Greggs'\nbody: Greggs 4.50"}]}}
    out = scrub_event(ev, {})
    assert out["exception"]["values"][0]["value"] == "HTTPStatusError (status 402)"


def test_bare_amounts_after_money_words():
    for text in ("amount 250", "balance: 1,234.56", "Total=99", "paid -12.5", "price −20"):
        out = scrub_string(text)
        assert "[amount]" in out and not any(ch.isdigit() for ch in out), (text, out)


def test_no_raise_or_error_log_formats_upstream_text():
    """Pins finding 1: no raise or error-level log in app/ puts an upstream
    body (`.text`, `.json()`) into the message."""
    import re
    from pathlib import Path
    root = Path(__file__).resolve().parents[1] / "app"
    bad = re.compile(r"(raise\s.*|logger\.(error|exception|critical)\(.*)(\.text\b|\.json\(\))")
    hits = []
    for path in root.rglob("*.py"):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if bad.search(line) and "debug" not in line:
                hits.append(f"{path.relative_to(root)}:{n}")
    assert not hits, hits
