"""A182 part 1: the 90-day reconfirmation (renewed_at, next_reconfirm_by,
POST /auth/finexer/consents/{id}/reconfirm, task_consent_watch)."""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.finexer as finexer_module
import app.services.finexer_consent as fc
import app.services.finexer_sync as fs
import app.workers.sync_worker as sw

NOW = datetime(2026, 11, 1, 9, 0, 0)
EMAIL = "tester.person@example.com"
OTHER = "someone.else@example.com"


class Col:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _m(d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict):
                if "$exists" in v:
                    if (k in d) != v["$exists"]:
                        return False
                    continue
                return False
            if d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._m(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._m(d, q)]

        class Cur:
            def __init__(s, r):
                s.r = r

            def __aiter__(s):
                async def gen():
                    for x in s.r:
                        yield x
                return gen()

            async def to_list(s, n):
                return s.r
        return Cur(rows)

    async def update_one(self, f, u, upsert=False):
        for d in self.docs:
            if self._m(d, f):
                d.update(u.get("$set") or {})
                for k in (u.get("$unset") or {}):
                    d.pop(k, None)
                return
        if upsert:
            self.docs.append({**f, **(u.get("$set") or {})})


class Resp:
    def __init__(self, status, body=None, headers=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = str(self._body)
        self.headers = headers or {}

    def json(self):
        return self._body


class Client:
    def __init__(self, resp=None, exc=None):
        self.resp, self.exc, self.sent = resp, exc, []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None):
        self.sent.append((url, dict(data or {})))
        if self.exc:
            raise self.exc
        return self.resp


def consent(**kw):
    base = {"_id": "cst_1", "user_id": EMAIL, "status": "authorized", "provider": "ob-barclays",
            "authed_at": NOW - timedelta(days=80), "expiry_date": NOW + timedelta(days=200)}
    base.update(kw)
    return base


@pytest.fixture
def env(monkeypatch):
    col = Col([consent(), consent(_id="cst_other", user_id=OTHER)])
    monkeypatch.setattr("app.db.collections.finexer_consents_col", col)
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)

    async def bump(now=None, **inc):
        return None
    monkeypatch.setattr("app.services.finexer_webhooks.bump_daily_counters", bump)
    return col


def _client(monkeypatch, client):
    monkeypatch.setattr(fs, "_client", lambda: client)


# ── date maths ───────────────────────────────────────────────────────────
def test_next_reconfirm_by_uses_renewed_at_else_authed_at():
    authed = NOW - timedelta(days=10)
    exp = NOW + timedelta(days=300)
    assert fc.next_reconfirm_by(authed, None, exp) == authed + timedelta(days=90)
    renewed = NOW - timedelta(days=1)
    assert fc.next_reconfirm_by(authed, renewed, exp) == renewed + timedelta(days=90)


def test_no_reconfirmation_when_consent_ends_within_90_days_or_unknown():
    authed = NOW - timedelta(days=10)
    assert fc.next_reconfirm_by(authed, None, authed + timedelta(days=90)) is None
    assert fc.next_reconfirm_by(None, None, NOW + timedelta(days=300)) is None


def test_prompt_window_opens_14_days_before_and_stays_open_when_overdue():
    doc = consent(authed_at=NOW - timedelta(days=75))  # due in 15 days
    assert not fc.reconfirm_prompt_due(doc, NOW)
    assert fc.reconfirm_prompt_due(consent(authed_at=NOW - timedelta(days=76)), NOW)
    assert fc.reconfirm_prompt_due(consent(authed_at=NOW - timedelta(days=120)), NOW)
    assert not fc.reconfirm_prompt_due(consent(status="expired"), NOW)


# ── the call ─────────────────────────────────────────────────────────────
def test_reconfirm_writes_renewed_at_and_never_touches_expiry(monkeypatch, env):
    client = Client(Resp(200, {"id": "cst_1", "renewed_at": "2026-11-01T09:00:00Z",
                               "expiry_date": "2030-01-01T00:00:00Z"}))
    _client(monkeypatch, client)
    before_expiry = env.docs[0]["expiry_date"]
    out = asyncio.run(finexer_module.finexer_reconfirm("cst_1", user={"email": EMAIL}))
    url, data = client.sent[0]
    assert url == "/consents/cst_1"
    assert set(data) == {"renewed_at"} and data["renewed_at"].endswith("Z")
    doc = env.docs[0]
    assert doc["renewed_at"] == datetime(2026, 11, 1, 9, 0, 0)
    assert doc["expiry_date"] == before_expiry
    assert doc["next_reconfirm_by"] == datetime(2026, 11, 1, 9, 0, 0) + timedelta(days=90)
    assert out["ok"] is True and out["next_reconfirm_by"].endswith("Z")


def test_reconfirm_clears_the_nag_throttle(monkeypatch, env):
    env.docs[0]["last_reconfirm_nag"] = NOW
    _client(monkeypatch, Client(Resp(200, {"renewed_at": "2026-11-01T09:00:00Z"})))
    asyncio.run(finexer_module.finexer_reconfirm("cst_1", user={"email": EMAIL}))
    assert "last_reconfirm_nag" not in env.docs[0]


@pytest.mark.parametrize("resp,exc", [
    (Resp(500, {"error": {"message": "boom"}}), None),
    (Resp(400, {"error": {"code": "invalid_parameter"}}), None),
    (None, RuntimeError("network down")),
])
def test_finexer_failure_fails_closed_and_leaves_record_unchanged(monkeypatch, env, resp, exc):
    _client(monkeypatch, Client(resp, exc))
    before = dict(env.docs[0])
    with pytest.raises(HTTPException) as ei:
        asyncio.run(finexer_module.finexer_reconfirm("cst_1", user={"email": EMAIL}))
    assert ei.value.status_code == 502
    assert ei.value.detail["message"] == "We could not confirm just now. Try again later."
    assert env.docs[0] == before


def test_only_the_owner_can_reconfirm(monkeypatch, env):
    client = Client(Resp(200, {}))
    _client(monkeypatch, client)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(finexer_module.finexer_reconfirm("cst_other", user={"email": EMAIL}))
    assert ei.value.status_code == 404
    with pytest.raises(HTTPException) as ei2:
        asyncio.run(finexer_module.finexer_reconfirm("missing", user={"email": EMAIL}))
    assert ei2.value.status_code == 404
    assert client.sent == []


def test_inactive_consent_cannot_be_reconfirmed(monkeypatch, env):
    env.docs[0]["status"] = "expired"
    client = Client(Resp(200, {}))
    _client(monkeypatch, client)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(finexer_module.finexer_reconfirm("cst_1", user={"email": EMAIL}))
    assert ei.value.status_code == 409 and client.sent == []


# ── callback and /connections ────────────────────────────────────────────
def test_callback_stores_next_reconfirm_by(monkeypatch, env):
    env.docs[0].update({"status": "pending", "state": "st", "expiry_date": datetime.utcnow() + timedelta(days=365)})
    monkeypatch.setattr(finexer_module, "finexer_sync_pipeline", lambda *a, **k: asyncio.sleep(0))
    asyncio.run(finexer_module.finexer_callback(consent="cst_1", state="st"))
    doc = env.docs[0]
    assert doc["status"] == "authorized"
    assert doc["next_reconfirm_by"] == doc["authed_at"] + timedelta(days=90)


def test_connections_row_carries_reconfirm_fields(monkeypatch, env):
    import app.routers.accounts as acc

    class Empty(Col):
        async def count_documents(self, *a, **k):
            return 0
    monkeypatch.setattr(acc, "_finexer_consents_col", env)
    monkeypatch.setattr(acc, "connections_col", Empty())
    monkeypatch.setattr(acc, "accounts_col", Empty())
    rows = asyncio.run(acc.list_connections(user={"email": EMAIL}))
    row = next(r for r in rows if r["connection_id"] == "cst_1")
    assert row["next_reconfirm_by"] is not None
    assert "reconfirm_prompt" in row and "renewed_at" in row


# ── task_consent_watch ───────────────────────────────────────────────────
def test_watch_flags_and_pushes_for_consents_due_within_seven_days(monkeypatch):
    now = datetime.utcnow()
    due_soon = consent(_id="a", authed_at=now - timedelta(days=85))
    not_due = consent(_id="b", authed_at=now - timedelta(days=10))
    col = Col([due_soon, not_due])
    monkeypatch.setattr(sw, "finexer_consents_col", col)
    monkeypatch.setattr(sw, "connections_col", Col())
    monkeypatch.setattr(sw, "accounts_col", Col())
    pushes = []

    async def push(uid, title, body, url=None):
        pushes.append((uid, title, body))

    async def pref(uid, key):
        return True
    monkeypatch.setattr(sw, "send_push_to_user", push)
    monkeypatch.setattr(sw, "notif_pref", pref)
    out = asyncio.run(sw.task_consent_watch({}))
    assert out["reconfirm_due"] == 1 and out["reconfirm_nagged"] == 1
    assert pushes[0][1] == "Still OK for Sorted to read your Barclays data?"
    a = next(d for d in col.docs if d["_id"] == "a")
    assert a["last_reconfirm_nag"] and a["reconfirm_due_flagged_at"] and a["next_reconfirm_by"]
    assert "reconfirm_due_flagged_at" not in next(d for d in col.docs if d["_id"] == "b")
    # throttled on a second run within 72 hours
    out2 = asyncio.run(sw.task_consent_watch({}))
    assert out2["reconfirm_due"] == 1 and out2["reconfirm_nagged"] == 0
    assert len(pushes) == 1
