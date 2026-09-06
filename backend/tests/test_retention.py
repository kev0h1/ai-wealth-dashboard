"""Unit tests for app.services.retention (backlog A3).

No mongomock in this environment (see tests/conftest.py's own note) — every
collection retention.py touches is replaced with a tiny in-memory FakeCol,
monkeypatched at the SOURCE modules retention.py actually reads from at call
time:

  - `app.services.retention`'s own module-level names (connections_col,
    accounts_col, finexer_consents_col, user_profiles_col, plus the imported
    cascade_account_deletion/purge_user_exclusions functions) for
    sweep_expired_connections / disconnect_connection.

  - `app.db.collections` itself for erase_user, which deliberately does a
    FRESH `from app.db import collections as _cols` and walks every live
    `*_col` attribute on that module (mirroring the original
    routers/profile.py::delete_account it was moved out of) — patching only
    retention's own bound names would leave the other ~70 collections
    pointing at the real Motor client, and erase_user would issue real
    delete_many calls against production Mongo. _patch_all_collections below
    replaces EVERY `*_col` attribute on the real module with a FakeCol so
    that can never happen, then overrides the ones a given test cares about.
"""
import asyncio
from datetime import datetime, timedelta

import app.services.retention as retention
import app.services.finexer_sync as finexer_sync_module


# ── fakes ────────────────────────────────────────────────────────────────

def _matches(doc: dict, filt: dict) -> bool:
    """Tiny subset-of-Mongo query matcher covering exactly what
    retention.py's own queries use: plain equality, $exists, $ne, $in."""
    for key, cond in filt.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            ok = True
            if "$exists" in cond:
                exists = key in doc and doc.get(key) is not None
                ok = ok and (exists == cond["$exists"])
            if "$ne" in cond:
                ok = ok and (val != cond["$ne"])
            if "$in" in cond:
                ok = ok and (val in cond["$in"])
            if not ok:
                return False
        else:
            if val != cond:
                return False
    return True


class _DeleteResult:
    def __init__(self, count):
        self.deleted_count = count


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n):
        return list(self._docs)


class FakeCol:
    """Stand-in for a Motor collection: `_id`-keyed, supports the subset of
    ops retention.py/erase_user actually perform."""

    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}
        self.update_calls = 0

    async def find_one(self, filt, proj=None):
        for d in self.docs.values():
            if _matches(d, filt):
                return dict(d)
        return None

    def find(self, filt, proj=None):
        return _FakeCursor([dict(d) for d in self.docs.values() if _matches(d, filt)])

    async def delete_many(self, filt):
        to_del = [k for k, d in self.docs.items() if _matches(d, filt)]
        for k in to_del:
            del self.docs[k]
        return _DeleteResult(len(to_del))

    async def delete_one(self, filt):
        for k, d in list(self.docs.items()):
            if _matches(d, filt):
                del self.docs[k]
                return _DeleteResult(1)
        return _DeleteResult(0)

    async def count_documents(self, filt, limit=None):
        n = sum(1 for d in self.docs.values() if _matches(d, filt))
        return min(n, limit) if limit is not None else n

    async def update_one(self, filt, update, upsert=False):
        self.update_calls += 1
        target = None
        for d in self.docs.values():
            if _matches(d, filt):
                target = d
                break
        if target is None:
            if not upsert:
                return
            target = {"_id": filt.get("_id")}
            self.docs[target["_id"]] = target
        for k, v in (update.get("$set") or {}).items():
            target[k] = v
        for k in (update.get("$unset") or {}):
            target.pop(k, None)


def _patch_all_collections(monkeypatch, overrides: dict) -> None:
    """Replace EVERY `*_col` attribute on the real app.db.collections module
    with a FakeCol (empty by default), except names in `overrides`."""
    from app.db import collections as _real_cols
    for name in dir(_real_cols):
        if not name.endswith("_col"):
            continue
        monkeypatch.setattr(_real_cols, name, overrides.get(name, FakeCol()))


class FakeFxResponse:
    def __init__(self, status_code):
        self.status_code = status_code


class FakeFxClient:
    """Stand-in for finexer_sync._client()'s async-context-managed httpx
    client — only `.delete()` is exercised by disconnect_connection."""

    def __init__(self, status_code=204, raise_exc=None):
        self.status_code = status_code
        self.raise_exc = raise_exc
        self.calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def delete(self, path):
        self.calls.append(path)
        if self.raise_exc:
            raise self.raise_exc
        return FakeFxResponse(self.status_code)


def _stub_cascade(monkeypatch, calls: list):
    async def fake_cascade(uid, account_ids, **kwargs):
        calls.append(("cascade", uid, list(account_ids)))
        return {}

    async def fake_purge(uid, account_ids):
        calls.append(("purge", uid, list(account_ids)))
        return 0

    monkeypatch.setattr(retention, "cascade_account_deletion", fake_cascade)
    monkeypatch.setattr(retention, "purge_user_exclusions", fake_purge)


NOW = datetime(2026, 9, 6, 3, 30, 0)


# ── sweep_expired_connections: TrueLayer ────────────────────────────────────

def test_sweep_truelayer_expired_connection_removed_with_accounts(monkeypatch):
    calls: list = []
    _stub_cascade(monkeypatch, calls)

    connections = FakeCol([
        # expired 31 days ago via consent_expires_at -> removed
        {"_id": "conn-a", "user_id": "u1", "consent_expires_at": NOW - timedelta(days=31)},
        # only 10 days past expiry -> kept
        {"_id": "conn-b", "user_id": "u1", "consent_expires_at": NOW - timedelta(days=10)},
        # no timestamp at all -> kept (fail safe)
        {"_id": "conn-c", "user_id": "u1"},
        # dead (needs_reauth) with a stamp 40 days old -> removed
        {"_id": "conn-d", "user_id": "u1", "needs_reauth": True, "needs_reauth_at": NOW - timedelta(days=40)},
        # dead but never stamped -> kept (fail safe)
        {"_id": "conn-e", "user_id": "u1", "needs_reauth": True},
    ])
    accounts = FakeCol([
        {"_id": "acc-1", "connection_id": "conn-a"},
        {"_id": "acc-2", "connection_id": "conn-a"},
    ])
    monkeypatch.setattr(retention, "connections_col", connections)
    monkeypatch.setattr(retention, "accounts_col", accounts)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())

    result = asyncio.run(retention.sweep_expired_connections(now=NOW))

    assert result["connections_removed"] == 2
    assert set(connections.docs.keys()) == {"conn-b", "conn-c", "conn-e"}
    # conn-a's cascade call carried its two accounts; conn-d owned none.
    cascade_calls = [(c[1], sorted(c[2])) for c in calls if c[0] == "cascade"]
    assert ("u1", ["acc-1", "acc-2"]) in cascade_calls
    assert ("u1", []) in cascade_calls


# ── sweep_expired_connections: Finexer ──────────────────────────────────────

def test_sweep_finexer_canceled_consent_removed_and_revoke_attempted(monkeypatch):
    calls: list = []
    _stub_cascade(monkeypatch, calls)

    consents = FakeCol([
        {"_id": "fx-a", "user_id": "u2", "status": "canceled", "canceled_at": NOW - timedelta(days=31)},
        {"_id": "fx-b", "user_id": "u2", "status": "canceled", "canceled_at": NOW - timedelta(days=10)},
        {"_id": "fx-c", "user_id": "u2", "status": "canceled"},  # no timestamp -> kept
        {"_id": "fx-d", "user_id": "u2", "status": "authorized"},  # never swept regardless
    ])
    monkeypatch.setattr(retention, "connections_col", FakeCol())
    monkeypatch.setattr(retention, "accounts_col", FakeCol())
    monkeypatch.setattr(retention, "finexer_consents_col", consents)

    fake_client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: fake_client)

    result = asyncio.run(retention.sweep_expired_connections(now=NOW))

    assert result["connections_removed"] == 1
    assert set(consents.docs.keys()) == {"fx-b", "fx-c", "fx-d"}
    assert fake_client.calls == ["/consents/fx-a"]


def test_sweep_finexer_remote_revoke_failure_is_non_fatal(monkeypatch):
    calls: list = []
    _stub_cascade(monkeypatch, calls)

    consents = FakeCol([
        {"_id": "fx-x", "user_id": "u3", "status": "revoked", "status_changed_at": NOW - timedelta(days=40)},
    ])
    monkeypatch.setattr(retention, "connections_col", FakeCol())
    monkeypatch.setattr(retention, "accounts_col", FakeCol())
    monkeypatch.setattr(retention, "finexer_consents_col", consents)

    fake_client = FakeFxClient(raise_exc=RuntimeError("Finexer is down"))
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: fake_client)

    result = asyncio.run(retention.sweep_expired_connections(now=NOW))

    # The consent is still gone locally even though the remote revoke blew up
    # (disconnect_connection swallows that failure as non-fatal, so it never
    # even reaches sweep_expired_connections's own error counter).
    assert result["connections_removed"] == 1
    assert result["connection_errors"] == 0
    assert consents.docs == {}
    assert fake_client.calls == ["/consents/fx-x"]


# ── sweep_dormant_users / erase_user ────────────────────────────────────────

def test_sweep_dormant_users_erases_across_collections(monkeypatch):
    dormant_uid = "dormant@example.com"
    recent_uid = "recent@example.com"
    unstamped_uid = "never-stamped@example.com"

    profiles = FakeCol([
        {"_id": dormant_uid, "last_active_at": NOW - timedelta(days=366)},
        {"_id": recent_uid, "last_active_at": NOW - timedelta(days=200)},
        {"_id": unstamped_uid},
    ])
    transactions = FakeCol([
        {"_id": "t1", "user_id": dormant_uid},
        {"_id": "t2", "user_id": dormant_uid},
        {"_id": "t3", "user_id": recent_uid},
    ])
    accounts = FakeCol([
        {"_id": "a1", "user_id": dormant_uid},
        {"_id": "a2", "user_id": recent_uid},
    ])

    _patch_all_collections(monkeypatch, {
        "user_profiles_col": profiles,
        "transactions_col": transactions,
        "accounts_col": accounts,
    })
    # sweep_dormant_users reads through retention's OWN bound name, which
    # must be the identical fake object erase_user's dir()-loop will also
    # find via app.db.collections.
    monkeypatch.setattr(retention, "user_profiles_col", profiles)

    result = asyncio.run(retention.sweep_dormant_users(now=NOW))

    assert result["users_erased"] == 1
    # Dormant user's docs are gone from every collection...
    assert dormant_uid not in profiles.docs
    assert all(d["user_id"] != dormant_uid for d in transactions.docs.values())
    assert all(d["user_id"] != dormant_uid for d in accounts.docs.values())
    # ...but the 200-day-old user and the never-stamped user are untouched.
    assert recent_uid in profiles.docs
    assert unstamped_uid in profiles.docs
    assert any(d["user_id"] == recent_uid for d in transactions.docs.values())
    assert any(d["user_id"] == recent_uid for d in accounts.docs.values())


def test_erase_user_never_touches_real_motor_collections(monkeypatch):
    """Sanity check on the safety net itself: erase_user's dir()-based loop
    must only ever see FakeCol instances once _patch_all_collections has
    run, for an id that matches nothing."""
    _patch_all_collections(monkeypatch, {})
    removed = asyncio.run(retention.erase_user("nobody@example.com"))
    assert removed == {}


# ── run_retention_sweep wiring ───────────────────────────────────────────

def test_run_retention_sweep_calls_both_sweeps(monkeypatch):
    calls: list = []

    async def fake_conn_sweep(now=None):
        calls.append("connections")
        return {"connections_removed": 0}

    async def fake_user_sweep(now=None):
        calls.append("users")
        return {"users_erased": 0}

    async def fake_relay_sweep(now=None):
        calls.append("relay")
        return {"relay_orphans_removed": 0, "relay_orphans_skipped": 0}

    monkeypatch.setattr(retention, "sweep_expired_connections", fake_conn_sweep)
    monkeypatch.setattr(retention, "sweep_dormant_users", fake_user_sweep)
    monkeypatch.setattr(retention, "sweep_orphaned_relay_accounts", fake_relay_sweep)

    result = asyncio.run(retention.run_retention_sweep(now=NOW))

    assert calls == ["connections", "users", "relay"]
    assert result == {
        "connections_removed": 0, "users_erased": 0,
        "relay_orphans_removed": 0, "relay_orphans_skipped": 0,
    }


# ── account_has_data / erase_orphaned_relay_account (D3) ───────────────────

RELAY = "abc123@privaterelay.appleid.com"


def test_account_has_data_true_when_any_data_collection_matches(monkeypatch):
    accounts = FakeCol([{"_id": "a1", "user_id": RELAY}])
    _patch_all_collections(monkeypatch, {"accounts_col": accounts})
    assert asyncio.run(retention.account_has_data(RELAY)) is True


def test_account_has_data_false_when_nothing_matches(monkeypatch):
    _patch_all_collections(monkeypatch, {})
    assert asyncio.run(retention.account_has_data(RELAY)) is False


def test_erase_orphaned_relay_account_refuses_non_relay_address(monkeypatch):
    identities = FakeCol([{"_id": "email:real@example.com", "provider": "email", "user_id": "real@example.com"}])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.erase_orphaned_relay_account("real@example.com", claimed_by="someone@example.com"))

    assert result is None
    assert "email:real@example.com" in identities.docs


def test_erase_orphaned_relay_account_refuses_self_claim(monkeypatch):
    identities = FakeCol([{"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY}])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.erase_orphaned_relay_account(RELAY, claimed_by=RELAY))

    assert result is None
    assert f"email:{RELAY}" in identities.docs


def test_erase_orphaned_relay_account_refuses_when_still_linked(monkeypatch):
    identities = FakeCol([
        {"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY},
        {"_id": "apple:sub-1", "provider": "apple", "user_id": RELAY, "auto": True},
    ])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.erase_orphaned_relay_account(RELAY, claimed_by="real@example.com"))

    assert result is None
    assert f"email:{RELAY}" in identities.docs


def test_erase_orphaned_relay_account_refuses_when_it_has_data(monkeypatch):
    identities = FakeCol([{"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY}])
    connections = FakeCol([{"_id": "conn-1", "user_id": RELAY}])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities, "connections_col": connections})

    result = asyncio.run(retention.erase_orphaned_relay_account(RELAY, claimed_by="real@example.com"))

    assert result is None
    assert f"email:{RELAY}" in identities.docs


def test_erase_orphaned_relay_account_erases_the_empty_placeholder(monkeypatch):
    identities = FakeCol([
        {"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY},
        {"_id": "apple:sub-1", "provider": "apple", "user_id": "real@example.com", "auto": False},
    ])
    profiles = FakeCol([{"_id": RELAY, "last_active_at": NOW}])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities, "user_profiles_col": profiles})

    result = asyncio.run(retention.erase_orphaned_relay_account(RELAY, claimed_by="real@example.com"))

    assert result is not None
    assert f"email:{RELAY}" not in identities.docs
    assert "apple:sub-1" in identities.docs
    assert RELAY not in profiles.docs


# ── sweep_orphaned_relay_accounts ───────────────────────────────────────────

def test_sweep_orphaned_relay_removes_reclaimed_placeholder(monkeypatch):
    identities = FakeCol([
        {"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY},
        {"_id": "apple:sub-1", "provider": "apple", "user_id": "real@example.com", "auto": False},
    ])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.sweep_orphaned_relay_accounts())

    assert result == {"relay_orphans_removed": 1, "relay_orphans_skipped": 0}
    assert f"email:{RELAY}" not in identities.docs
    assert "apple:sub-1" in identities.docs


def test_sweep_orphaned_relay_keeps_still_linked_account(monkeypatch):
    identities = FakeCol([
        {"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY},
        {"_id": "apple:sub-1", "provider": "apple", "user_id": RELAY, "auto": True},
    ])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.sweep_orphaned_relay_accounts())

    assert result == {"relay_orphans_removed": 0, "relay_orphans_skipped": 1}
    assert f"email:{RELAY}" in identities.docs


def test_sweep_orphaned_relay_keeps_account_with_data(monkeypatch):
    identities = FakeCol([{"_id": f"email:{RELAY}", "provider": "email", "user_id": RELAY}])
    accounts = FakeCol([{"_id": "acc-1", "user_id": RELAY}])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities, "accounts_col": accounts})

    result = asyncio.run(retention.sweep_orphaned_relay_accounts())

    assert result == {"relay_orphans_removed": 0, "relay_orphans_skipped": 1}
    assert f"email:{RELAY}" in identities.docs


def test_sweep_orphaned_relay_ignores_non_relay_email_docs(monkeypatch):
    identities = FakeCol([
        {"_id": "email:someone@gmail.com", "provider": "email", "user_id": "someone@gmail.com"},
    ])
    monkeypatch.setattr(retention, "linked_identities_col", identities)
    _patch_all_collections(monkeypatch, {"linked_identities_col": identities})

    result = asyncio.run(retention.sweep_orphaned_relay_accounts())

    assert result == {"relay_orphans_removed": 0, "relay_orphans_skipped": 0}
    assert "email:someone@gmail.com" in identities.docs


# ── stamp_activity throttling ───────────────────────────────────────────────

def test_stamp_activity_throttles_within_six_hours(monkeypatch):
    retention._last_stamped.clear()
    fake_profiles = FakeCol()
    monkeypatch.setattr(retention, "user_profiles_col", fake_profiles)

    async def go():
        await retention.stamp_activity("kevin@example.com", now=NOW)
        await retention.stamp_activity("kevin@example.com", now=NOW + timedelta(minutes=1))
        await retention.stamp_activity("kevin@example.com", now=NOW + timedelta(hours=5, minutes=59))

    asyncio.run(go())
    assert fake_profiles.update_calls == 1
    assert fake_profiles.docs["kevin@example.com"]["last_active_at"] == NOW


def test_stamp_activity_writes_again_after_six_hours(monkeypatch):
    retention._last_stamped.clear()
    fake_profiles = FakeCol()
    monkeypatch.setattr(retention, "user_profiles_col", fake_profiles)

    async def go():
        await retention.stamp_activity("kevin@example.com", now=NOW)
        await retention.stamp_activity("kevin@example.com", now=NOW + timedelta(hours=6, minutes=1))

    asyncio.run(go())
    assert fake_profiles.update_calls == 2
    assert fake_profiles.docs["kevin@example.com"]["last_active_at"] == NOW + timedelta(hours=6, minutes=1)


def test_stamp_activity_swallows_db_errors(monkeypatch):
    retention._last_stamped.clear()

    class ExplodingCol:
        async def update_one(self, *a, **kw):
            raise RuntimeError("mongo hiccup")

    monkeypatch.setattr(retention, "user_profiles_col", ExplodingCol())
    # Must not raise.
    asyncio.run(retention.stamp_activity("kevin@example.com", now=NOW))
