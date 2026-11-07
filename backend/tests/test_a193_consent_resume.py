"""A193: bank consent on Android battery saver.

The phone can close Sorted while the user is at the bank, reload the consent
page, or follow the return link twice. Covers: every link call creates a fresh
consent (a retry never reuses an old one), a repeated callback never repeats the
sync or undoes an authorised consent, the server-side pending lookup, and the
callback error path. No real Finexer calls: create_consent is mocked.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.finexer as finexer_module


class _FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict) and "$gte" in v:
                if not (d.get(k) is not None and d[k] >= v["$gte"]):
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, query=None, projection=None, sort=None):
        hits = [d for d in self.docs if self._match(d, query)]
        if sort:
            key, direction = sort[0]
            hits.sort(key=lambda d: d.get(key) or datetime.min, reverse=direction < 0)
        return hits[0] if hits else None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


async def _noop(email):
    return None


USER = {"email": "kevin@example.com"}


def _setup_link(monkeypatch):
    monkeypatch.setattr(finexer_module, "FINEXER_API_KEY", "test-key")
    monkeypatch.setattr(finexer_module, "check_connection_limit", _noop)
    monkeypatch.setattr(finexer_module, "check_open_banking_allowed", _noop)
    col = _FakeCol()
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)
    created = []

    async def fake_customer(user):
        return "cus_1"

    async def fake_template():
        return False

    async def fake_create_consent(user_id, customer_id, provider, state, user=None):
        n = len(created) + 1
        created.append({"provider": provider, "state": state})
        return {"id": f"cst_{n}", "redirect": {"consent_url": f"https://consent.example/{n}"}}

    monkeypatch.setattr(finexer_module, "get_or_create_customer", fake_customer)
    monkeypatch.setattr(finexer_module, "create_consent", fake_create_consent)
    monkeypatch.setattr(finexer_module, "_template_setting", fake_template)
    return col, created


def test_retry_creates_a_fresh_consent_never_reuses_the_old_url(monkeypatch):
    col, created = _setup_link(monkeypatch)
    first = asyncio.run(finexer_module.finexer_link(provider="chase", native=True, user=USER))
    second = asyncio.run(finexer_module.finexer_link(provider="chase", native=True, user=USER))
    assert first["auth_url"] != second["auth_url"]
    assert first["connection_id"] != second["connection_id"]
    assert len(created) == 2
    assert created[0]["state"] != created[1]["state"]
    assert {d["_id"] for d in col.docs} == {"cst_1", "cst_2"}


def _consent(**kw):
    doc = {"_id": "cst_1", "user_id": USER["email"], "provider": "chase", "state": "s1",
           "status": "pending", "native": True, "created_at": datetime.utcnow()}
    doc.update(kw)
    return doc


def test_pending_lookup_returns_the_latest_recent_consent_for_this_user(monkeypatch):
    now = datetime.utcnow()
    col = _FakeCol([
        _consent(_id="old", created_at=now - timedelta(minutes=5), status="canceled"),
        _consent(_id="new", created_at=now - timedelta(minutes=1)),
        _consent(_id="other", user_id="someone@else.com"),
        _consent(_id="stale", created_at=now - timedelta(hours=3)),
    ])
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)
    out = asyncio.run(finexer_module.finexer_pending(user=USER))
    assert out == {"connection_id": "new", "status": "pending", "provider": "chase"}


def test_pending_lookup_ignores_old_and_other_users_consents(monkeypatch):
    col = _FakeCol([
        _consent(_id="stale", created_at=datetime.utcnow() - timedelta(hours=3)),
        _consent(_id="other", user_id="someone@else.com"),
    ])
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)
    out = asyncio.run(finexer_module.finexer_pending(user=USER))
    assert out["connection_id"] is None


def _setup_callback(monkeypatch, doc):
    col = _FakeCol([doc])
    monkeypatch.setattr(finexer_module, "finexer_consents_col", col)
    syncs = []

    def fake_pipeline(consent_id, user_id, **kwargs):
        syncs.append(consent_id)

        async def _n():
            return None

        return _n()

    monkeypatch.setattr(finexer_module, "finexer_sync_pipeline", fake_pipeline)
    return col, syncs


def test_second_callback_does_not_resync_or_change_an_authorised_consent(monkeypatch):
    col, syncs = _setup_callback(monkeypatch, _consent())
    first = asyncio.run(finexer_module.finexer_callback(fx_consent="cst_1", state="s1"))
    authed_at = col.docs[0]["authed_at"]
    second = asyncio.run(finexer_module.finexer_callback(fx_consent="cst_1", state="s1"))
    assert first.status_code == second.status_code == 200
    assert syncs == ["cst_1"]
    assert col.docs[0]["authed_at"] == authed_at


def test_late_error_callback_does_not_cancel_an_authorised_consent(monkeypatch):
    col, syncs = _setup_callback(monkeypatch, _consent(status="authorized"))
    out = asyncio.run(finexer_module.finexer_callback(fx_consent="cst_1", state="s1", error="access_denied"))
    assert col.docs[0]["status"] == "authorized"
    assert out.status_code == 200
    assert syncs == []


def test_error_callback_on_a_pending_native_consent_hands_back_an_error_page(monkeypatch):
    col, syncs = _setup_callback(monkeypatch, _consent())
    out = asyncio.run(finexer_module.finexer_callback(fx_consent="cst_1", state="s1", error="access_denied"))
    assert col.docs[0]["status"] == "canceled"
    assert out.status_code == 200
    assert b"status=error" in out.body
    assert syncs == []
