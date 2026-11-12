"""G462: task_consent_watch must not nag about Finexer consents that own no
account or were superseded by a newer authorised consent for the same user
and provider. Pure fakes: no Mongo, no Redis, no real push."""
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import app.workers.sync_worker as sw

NOW = datetime.utcnow()
UID = "tester.person@example.com"


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
                if "$ne" in v:
                    if d.get(k) == v["$ne"]:
                        return False
                    continue
                return False
            if d.get(k) != v:
                return False
        return True

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._m(d, q)]

        class Cur:
            async def to_list(self, n):
                return rows
        return Cur()

    async def count_documents(self, q=None, limit=0):
        n = sum(1 for d in self.docs if self._m(d, q))
        return min(n, limit) if limit else n

    async def update_one(self, f, u, upsert=False):
        for d in self.docs:
            if self._m(d, f):
                d.update(u.get("$set") or {})
                return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)


def fx(_id, status, authed_days_ago, **kw):
    base = {"_id": _id, "user_id": UID, "status": status, "provider": "ob-chase",
            "authed_at": NOW - timedelta(days=authed_days_ago),
            "last_synced": NOW - timedelta(days=5),
            "expiry_date": NOW + timedelta(days=300)}
    base.update(kw)
    return base


def _run(monkeypatch, consents, accounts, tl_conns=None, tl_accounts=None):
    monkeypatch.setattr(sw, "finexer_consents_col", Col(consents))
    monkeypatch.setattr(sw, "connections_col", Col(tl_conns))
    monkeypatch.setattr(sw, "accounts_col", Col((accounts or []) + (tl_accounts or [])))
    pushes = []

    async def push(uid, title, body, url=None):
        pushes.append((uid, title, body))

    async def pref(uid, key):
        return True

    async def gate_on():
        return True
    monkeypatch.setattr(sw, "send_push_to_user", push)
    monkeypatch.setattr(sw, "notif_pref", pref)
    import app.services.finexer_consent as fc
    monkeypatch.setattr(fc, "reconfirm_enabled", gate_on)
    out = asyncio.run(sw.task_consent_watch({}))
    return out, pushes


def test_old_expired_consent_with_newer_authorized_sends_nothing(monkeypatch):
    # Even if the old consent still owns an account doc, the newer one wins.
    consents = [fx("old", "expired", 120), fx("new", "authorized", 2)]
    accounts = [{"_id": "a1", "connection_id": "old"}, {"_id": "a2", "connection_id": "new"}]
    out, pushes = _run(monkeypatch, consents, accounts)
    assert pushes == [] and out["nagged"] == 0 and out["reconfirm_nagged"] == 0


def test_superseded_authorized_consent_gets_no_reconfirmation(monkeypatch):
    consents = [fx("old", "authorized", 86), fx("new", "authorized", 1)]
    accounts = [{"_id": "a1", "connection_id": "old"}, {"_id": "a2", "connection_id": "new"}]
    out, pushes = _run(monkeypatch, consents, accounts)
    assert out["reconfirm_due"] == 0 and pushes == []


def test_consent_owning_no_accounts_sends_nothing(monkeypatch):
    consents = [fx("empty", "expired", 120), fx("empty_auth", "authorized", 86, provider="ob-other")]
    out, pushes = _run(monkeypatch, consents, [])
    assert pushes == [] and out["nagged"] == 0 and out["reconfirm_due"] == 0


def test_genuinely_dead_consent_with_accounts_still_nags(monkeypatch):
    consents = [fx("dead", "expired", 120)]
    out, pushes = _run(monkeypatch, consents, [{"_id": "a1", "connection_id": "dead"}])
    assert out["nagged"] == 1 and len(pushes) == 1
    assert pushes[0][1] == "Chase needs reconnecting" or "needs reconnecting" in pushes[0][1]


def test_dead_consent_nags_when_other_provider_is_authorized(monkeypatch):
    consents = [fx("dead", "expired", 120), fx("other", "authorized", 2, provider="ob-barclays")]
    accounts = [{"_id": "a1", "connection_id": "dead"}, {"_id": "a2", "connection_id": "other"}]
    out, pushes = _run(monkeypatch, consents, accounts)
    assert out["nagged"] == 1


def test_dead_consent_nags_when_the_authorized_one_is_another_user(monkeypatch):
    consents = [fx("dead", "expired", 120), fx("theirs", "authorized", 2, user_id="x@example.com")]
    accounts = [{"_id": "a1", "connection_id": "dead"}, {"_id": "a2", "connection_id": "theirs"}]
    out, pushes = _run(monkeypatch, consents, accounts)
    assert out["nagged"] == 1


def test_older_authorized_sibling_does_not_silence_newer_dead_consent(monkeypatch):
    consents = [fx("old_ok", "authorized", 200), fx("new_dead", "expired", 3)]
    accounts = [{"_id": "a1", "connection_id": "old_ok"}, {"_id": "a2", "connection_id": "new_dead"}]
    out, pushes = _run(monkeypatch, consents, accounts)
    assert out["nagged"] == 1


def test_truelayer_behaviour_unchanged(monkeypatch):
    tl = [{"_id": "tl_dead", "user_id": UID, "needs_reauth": True, "provider": "ob-barclays",
           "last_synced": NOW - timedelta(days=4)},
          {"_id": "tl_empty", "user_id": UID, "needs_reauth": True, "provider": "ob-barclays",
           "last_synced": NOW - timedelta(days=4)}]
    # A newer authorised Finexer consent for the same provider must not affect TrueLayer.
    consents = [fx("new", "authorized", 2, provider="ob-barclays")]
    out, pushes = _run(monkeypatch, consents, [{"_id": "f1", "connection_id": "new"}],
                       tl_conns=tl, tl_accounts=[{"_id": "t1", "connection_id": "tl_dead"}])
    assert out["nagged"] == 1 and len(pushes) == 1
