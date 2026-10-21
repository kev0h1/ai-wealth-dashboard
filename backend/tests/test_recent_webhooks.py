"""E9: GET /ops/webhooks/recent (owner-only recent webhooks read model).

Called at the handler level against a small fake that applies the Mongo
projection, sort and limit it is given, so a field the code forgot to
exclude from its projection would show up in the response.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import app.db.collections as collections
import app.routers.ops as ops
from app.core.config import PRIMARY_EMAIL
from app.services import recent_webhooks as rw

NOW = datetime(2026, 10, 21, 12, 0, 0, tzinfo=timezone.utc)
SECRETS = ["PAYLOADSECRET", "consent-abc", "acct-123", "user-xyz", "kev@example.com", "99.99", "https://secret.test/x", "order-777"]


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, key, direction):
        self.docs = sorted(self.docs, key=lambda d: d.get(key) or datetime.min, reverse=direction < 0)
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Col:
    def __init__(self, docs):
        self.docs = docs
        self.calls = []

    def find(self, query, projection):
        self.calls.append(projection)
        out = [d for d in self.docs if all(d.get(k) is not None and d[k] >= v["$gte"] for k, v in query.items())]
        keep = [k for k, v in projection.items() if v == 1]
        projected = []
        for d in out:
            p = {}
            for k in keep:
                head, _, tail = k.partition(".")
                if head in d:
                    p[head] = {tail: d[head].get(tail)} if tail and isinstance(d[head], dict) else d[head]
            projected.append(p)
        return _Cursor(projected)


def _naive(minutes_ago):
    return (NOW - timedelta(minutes=minutes_ago)).replace(tzinfo=None)


def _wh(minutes_ago, provider="finexer", status="queued", etype="bank_account.synced", **extra):
    return {
        "received_at": _naive(minutes_ago), "provider": provider, "event_type": etype, "status": status,
        "payload": {"secret": "PAYLOADSECRET"}, "consent_id": "consent-abc", "resolved_consent_id": "acct-123",
        "user_id": "user-xyz", "event_id": "evt-1", "connection_id": "acct-123", **extra,
    }


def _bill(minutes_ago, provider, etype, processed=True, handled=True, **extra):
    return {
        "received_at": _naive(minutes_ago), "provider": provider, "type": etype,
        "processed_at": _naive(minutes_ago - 1) if processed else None,
        "result": {"handled": handled, "uid": "user-xyz", "reason": "kev@example.com 99.99 https://secret.test/x"},
        "event_id": "stripe:order-777", "transaction_id": "order-777", "user_id": "user-xyz", **extra,
    }


@pytest.fixture()
def cols(monkeypatch):
    wh, bill = _Col([]), _Col([])
    monkeypatch.setattr(collections, "webhook_events_col", wh)
    monkeypatch.setattr(collections, "billing_events_col", bill)
    monkeypatch.setattr(rw, "_utcnow", lambda: NOW)
    return wh, bill


def _call(email=PRIMARY_EMAIL):
    return asyncio.run(ops.ops_recent_webhooks({"email": email}))


def test_non_owner_gets_403(cols):
    with pytest.raises(HTTPException) as ei:
        _call("someone@else.co")
    assert ei.value.status_code == 403


def test_response_contains_no_identifiers_payload_or_amounts(cols):
    wh, bill = cols
    wh.docs = [_wh(5), _wh(6, status="skipped", skip_reason="consent_not_found"), _wh(7, "truelayer", "noted", "transaction.created")]
    bill.docs = [_bill(8, "stripe", "invoice.paid"), _bill(9, "apple", "DID_RENEW"), _bill(10, "google", "subscriptionNotification")]
    res = _call()
    blob = json.dumps(res)
    for s in SECRETS:
        assert s not in blob
    allowed = {"received_at", "provider", "event_type", "outcome", "reason"}
    assert all(set(r) <= allowed for r in res["recent_webhooks"])
    for call in wh.calls + bill.calls:
        assert not ({"payload", "consent_id", "user_id", "connection_id", "event_id", "result", "transaction_id"} & set(call))
    assert set(wh.calls[0]) <= {"_id", "received_at", "provider", "event_type", "status", "skip_reason"}
    assert set(bill.calls[0]) <= {"_id", "received_at", "provider", "type", "processed_at", "result.handled"}


def test_unknown_event_types_become_other(cols):
    wh, bill = cols
    wh.docs = [_wh(1, etype="consent.authorized.user-xyz"), _wh(2, etype="bank_account.synced")]
    bill.docs = [_bill(3, "apple", "SOMETHING_acct-123")]
    types = [r["event_type"] for r in _call()["recent_webhooks"]]
    assert types == ["other", "bank_account.synced", "other"]


def test_merge_order_newest_first_across_collections(cols):
    wh, bill = cols
    wh.docs = [_wh(30), _wh(10), _wh(50)]
    bill.docs = [_bill(20, "stripe", "invoice.paid"), _bill(5, "apple", "DID_RENEW"), _bill(40, "google", "testNotification")]
    res = _call()["recent_webhooks"]
    assert [r["received_at"] for r in res] == sorted([r["received_at"] for r in res], reverse=True)
    assert [r["provider"] for r in res] == ["apple", "finexer", "stripe", "finexer", "google", "finexer"]
    assert res[0]["received_at"].endswith("+00:00")


def test_outcome_mapping_per_provider(cols):
    wh, bill = cols
    wh.docs = [
        _wh(1, status="queued"), _wh(2, status="coalesced"), _wh(3, status="noted"), _wh(4, status="ignored"),
        _wh(5, status="pending"), _wh(6, status="failed"), _wh(7, status="revoked"),
        _wh(8, status="skipped", skip_reason="no user_id"),
        _wh(9, status="skipped", skip_reason="free text with user-xyz"),
        _wh(10, "truelayer", "skipped", "transaction.updated", skip_reason="connection_not_found"),
    ]
    bill.docs = [
        _bill(11, "stripe", "invoice.paid"),
        _bill(12, "apple", "TEST", handled=False),
        _bill(13, "google", "subscriptionNotification", processed=False),
        _bill(60, "google", "subscriptionNotification", processed=False),
    ]
    by_age = {i: r for i, r in enumerate(_call()["recent_webhooks"], start=1)}
    got = [(r["provider"], r["outcome"], r.get("reason")) for r in by_age.values()]
    assert got == [
        ("finexer", "queued", None), ("finexer", "coalesced", None), ("finexer", "noted", None),
        ("finexer", "ignored", None), ("finexer", "queued", None), ("finexer", "failed", "enqueue_failed"),
        ("finexer", "noted", None), ("finexer", "skipped", "no_user"), ("finexer", "skipped", "other"),
        ("truelayer", "skipped", "connection_not_found"),
        ("stripe", "processed", None), ("apple", "ignored", None), ("google", "queued", None),
        ("google", "failed", "unfinished"),
    ]


def test_counts_24h_and_cap_at_50(cols):
    wh, bill = cols
    wh.docs = [_wh(i) for i in range(1, 61)] + [_wh(60 * 25, status="failed")]
    bill.docs = [_bill(30, "stripe", "invoice.paid"), _bill(31, "apple", "TEST", handled=False), _bill(24 * 60 + 5, "stripe", "invoice.paid")]
    res = _call()
    assert len(res["recent_webhooks"]) == 50
    assert res["webhook_counts_24h"] == {"finexer": {"queued": 60}, "stripe": {"processed": 1}, "apple": {"ignored": 1}}
    assert res["counts_truncated"] is False
