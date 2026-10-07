"""A106 follow-up coverage: the shared record_orphaned_revocation helper, the
swept batch bound, and the B45 downgrade path routing failures through it.
Fakes only, no real DB (fixtures reused from tests/test_retention.py)."""
import asyncio
import json

import httpx

import app.services.billing_lifecycle as lifecycle
import app.services.finexer_sync as finexer_sync_module
import app.services.retention as retention
from app.core import config
from tests.test_retention import (
    NOW, FakeCol, FakeFxClient, FakeFxMultiClient, _stub_cascade,
)

UID = "someone@example.com"


def _disconnect(monkeypatch, client, consent_id="fx-1-test"):
    _stub_cascade(monkeypatch, [])
    consents = FakeCol([{"_id": consent_id, "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    monkeypatch.setattr(retention, "connections_col", FakeCol())
    monkeypatch.setattr(retention, "accounts_col", FakeCol())
    monkeypatch.setattr(retention, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    asyncio.run(retention.disconnect_connection(UID, consent_id))
    return consents, markers


def test_remote_500_writes_marker_then_deletes_locally(monkeypatch):
    consents, markers = _disconnect(monkeypatch, FakeFxClient(status_code=500))
    assert "fx-1-test" not in consents.docs
    m = markers.docs["fx-1-test"]
    assert m["attempts"] == 1 and m["last_error"] == "500" and m["failed_at"].tzinfo is not None


def test_remote_timeout_writes_marker_then_deletes_locally(monkeypatch):
    consents, markers = _disconnect(
        monkeypatch, FakeFxClient(raise_exc=httpx.ReadTimeout("secret body")))
    assert "fx-1-test" not in consents.docs
    assert markers.docs["fx-1-test"]["last_error"] == "ReadTimeout"


def test_remote_404_writes_no_marker(monkeypatch):
    consents, markers = _disconnect(monkeypatch, FakeFxClient(status_code=404))
    assert "fx-1-test" not in consents.docs and markers.docs == {}


def test_marker_holds_no_uid_email_or_token(monkeypatch):
    _, markers = _disconnect(monkeypatch, FakeFxClient(status_code=503))
    blob = json.dumps(markers.docs["fx-1-test"], default=str)
    assert UID not in blob and "@" not in blob
    assert markers.docs["fx-1-test"]["user_hash"] == retention._hash_uid(UID)


def test_record_helper_never_raises(monkeypatch):
    class Boom:
        async def update_one(self, *a, **k):
            raise RuntimeError("down")
    monkeypatch.setattr(retention, "orphaned_revocations_col", Boom())
    asyncio.run(retention.record_orphaned_revocation(UID, "fx-1-test", "500"))


def test_sweep_clears_on_200_204_404_keeps_and_increments_on_500(monkeypatch):
    markers = FakeCol([
        {"_id": c, "consent_id": c, "failed_at": NOW, "attempts": 1} for c in ("aaaaaa", "bbbbbb", "cccccc", "dddddd")
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxMultiClient(responses={
        "/consents/aaaaaa": 200, "/consents/bbbbbb": 204, "/consents/cccccc": 404, "/consents/dddddd": 500})
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert set(markers.docs) == {"dddddd"}
    assert markers.docs["dddddd"]["attempts"] == 2 and markers.docs["dddddd"]["last_error"] == "500"
    assert res["orphaned_cleared"] == 3 and res["orphaned_still_pending"] == 1


def test_sweep_batch_bound_oldest_first(monkeypatch):
    from datetime import timedelta
    n = retention._ORPHAN_BATCH + 5
    markers = FakeCol([
        {"_id": f"cons{i:03d}", "consent_id": f"cons{i:03d}",
         "failed_at": NOW + timedelta(minutes=i), "attempts": 1} for i in range(n)
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert res["orphaned_retried"] == retention._ORPHAN_BATCH
    assert sorted(markers.docs) == [f"cons{i:03d}" for i in range(retention._ORPHAN_BATCH, n)]


def test_sweep_success_revokes_still_authorised_local_doc(monkeypatch):
    markers = FakeCol([{"_id": "fx-1-test", "consent_id": "fx-1-test", "failed_at": NOW, "attempts": 1}])
    consents = FakeCol([{"_id": "fx-1-test", "user_id": UID, "status": "authorized"}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", consents)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: FakeFxClient(status_code=200))
    asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert consents.docs["fx-1-test"]["status"] == "revoked" and markers.docs == {}


def _downgrade(monkeypatch, flag, client):
    import app.db.collections as cols
    consents = FakeCol([{"_id": "fx-1-test", "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    monkeypatch.setattr(cols, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(config, "REVOKE_CONSENT_ON_DOWNGRADE", flag)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(lifecycle.on_landed_on_statements(UID))
    return res, consents, markers


def test_downgrade_flag_on_failure_records_marker_and_keeps_consent(monkeypatch):
    res, consents, markers = _downgrade(monkeypatch, True, FakeFxClient(status_code=500))
    assert res["failed"] == 1 and consents.docs["fx-1-test"]["status"] == "authorized"
    assert markers.docs["fx-1-test"]["last_error"] == "500"
    assert markers.docs["fx-1-test"]["user_hash"] == retention._hash_uid(UID)


def test_downgrade_flag_on_timeout_records_class_name(monkeypatch):
    _, _, markers = _downgrade(monkeypatch, True, FakeFxClient(raise_exc=httpx.ConnectTimeout("x")))
    assert markers.docs["fx-1-test"]["last_error"] == "ConnectTimeout"


def test_downgrade_flag_on_success_writes_no_marker(monkeypatch):
    res, consents, markers = _downgrade(monkeypatch, True, FakeFxClient(status_code=204))
    assert res["revoked"] == 1 and consents.docs["fx-1-test"]["status"] == "revoked" and markers.docs == {}


def test_downgrade_flag_off_does_nothing(monkeypatch):
    client = FakeFxClient(status_code=500)
    res, consents, markers = _downgrade(monkeypatch, False, client)
    assert res == {"revoke": "off"} and client.calls == [] and markers.docs == {}


# ── review minors ───────────────────────────────────────────────────────────
from datetime import timedelta  # noqa: E402


def test_valid_consent_id_regex():
    assert retention.valid_consent_id("fx-123_ABC")
    for bad in ("short", "has/slash123", "../../x12345", "a" * 129, "", None, "sp ace123"):
        assert not retention.valid_consent_id(bad)


def test_disconnect_malformed_id_never_requested(monkeypatch):
    client = FakeFxClient(status_code=204)
    _, markers = _disconnect(monkeypatch, client, consent_id="bad/id/../x")
    assert client.calls == [] and markers.docs["bad/id/../x"]["last_error"] == "bad_id"


def test_sweep_skips_malformed_marker_id(monkeypatch):
    markers = FakeCol([{"_id": "x/../y", "consent_id": "x/../y", "failed_at": NOW, "attempts": 1}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert client.calls == [] and markers.docs["x/../y"]["last_error"] == "bad_id"


def test_downgrade_malformed_id_never_requested(monkeypatch):
    import app.db.collections as cols
    consents = FakeCol([{"_id": "bad id", "user_id": UID, "status": "authorized"}])
    monkeypatch.setattr(cols, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", FakeCol())
    monkeypatch.setattr(config, "REVOKE_CONSENT_ON_DOWNGRADE", True)
    client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(lifecycle.on_landed_on_statements(UID))
    assert client.calls == [] and res["failed"] == 1


def test_sweep_orders_by_last_attempt_nulls_first(monkeypatch):
    markers = FakeCol([
        {"_id": "recent-aaa", "failed_at": NOW, "last_attempt_at": NOW, "attempts": 3},
        {"_id": "never-bbbb", "failed_at": NOW, "attempts": 1, "last_attempt_at": None},
        {"_id": "older-cccc", "failed_at": NOW, "last_attempt_at": NOW - timedelta(days=1), "attempts": 3},
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    monkeypatch.setattr(retention, "_ORPHAN_BATCH", 2)
    client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert client.calls == ["/consents/never-bbbb", "/consents/older-cccc"]


def test_marker_past_90_days_deleted_with_error_log(monkeypatch, caplog):
    import logging
    markers = FakeCol([{"_id": "old-consent-1", "user_hash": "HASHVALUE",
                        "failed_at": NOW - timedelta(days=91), "attempts": 20}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxClient(status_code=500)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    with caplog.at_level(logging.ERROR, logger="app.services.retention"):
        res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert markers.docs == {} and client.calls == [] and res["orphaned_expired"] == 1
    errs = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("old-consent-1" in m for m in errs) and not any("HASHVALUE" in m for m in errs)


def _delete_route(monkeypatch, client, consent_id="fx-acct-1"):
    import app.routers.accounts as acc
    acc_col = FakeCol([{"_id": "acct1", "user_id": UID, "connection_id": consent_id}])
    consents = FakeCol([{"_id": consent_id, "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    for name, col in (("accounts_col", acc_col), ("connections_col", FakeCol()),
                      ("yapily_accounts_col", FakeCol()), ("excluded_accounts_col", FakeCol()),
                      ("_finexer_consents_col", consents)):
        monkeypatch.setattr(acc, name, col)
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(acc, "cascade_account_deletion", _noop)
    monkeypatch.setattr(acc, "purge_user_exclusions", _noop)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    return acc, acc_col, consents, markers


def _call(acc, acc_col):
    async def fake_count(filt):
        return 0
    acc_col.count_documents = fake_count
    return asyncio.run(acc.delete_account("acct1", {"email": UID}))


def test_last_account_delete_500_marker_then_local_delete(monkeypatch):
    acc, acc_col, consents, markers = _delete_route(monkeypatch, FakeFxClient(status_code=500))
    _call(acc, acc_col)
    assert "fx-acct-1" not in consents.docs and markers.docs["fx-acct-1"]["last_error"] == "500"


def test_last_account_delete_404_no_marker(monkeypatch):
    acc, acc_col, consents, markers = _delete_route(monkeypatch, FakeFxClient(status_code=404))
    _call(acc, acc_col)
    assert "fx-acct-1" not in consents.docs and markers.docs == {}
