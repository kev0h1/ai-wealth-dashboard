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


def _disconnect(monkeypatch, client, consent_id="fx-1"):
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
    assert "fx-1" not in consents.docs
    m = markers.docs["fx-1"]
    assert m["attempts"] == 1 and m["last_error"] == "500" and m["failed_at"].tzinfo is not None


def test_remote_timeout_writes_marker_then_deletes_locally(monkeypatch):
    consents, markers = _disconnect(
        monkeypatch, FakeFxClient(raise_exc=httpx.ReadTimeout("secret body")))
    assert "fx-1" not in consents.docs
    assert markers.docs["fx-1"]["last_error"] == "ReadTimeout"


def test_remote_404_writes_no_marker(monkeypatch):
    consents, markers = _disconnect(monkeypatch, FakeFxClient(status_code=404))
    assert "fx-1" not in consents.docs and markers.docs == {}


def test_marker_holds_no_uid_email_or_token(monkeypatch):
    _, markers = _disconnect(monkeypatch, FakeFxClient(status_code=503))
    blob = json.dumps(markers.docs["fx-1"], default=str)
    assert UID not in blob and "@" not in blob
    assert markers.docs["fx-1"]["user_hash"] == retention._hash_uid(UID)


def test_record_helper_never_raises(monkeypatch):
    class Boom:
        async def update_one(self, *a, **k):
            raise RuntimeError("down")
    monkeypatch.setattr(retention, "orphaned_revocations_col", Boom())
    asyncio.run(retention.record_orphaned_revocation(UID, "fx-1", "500"))


def test_sweep_clears_on_200_204_404_keeps_and_increments_on_500(monkeypatch):
    markers = FakeCol([
        {"_id": c, "consent_id": c, "failed_at": NOW, "attempts": 1} for c in ("a", "b", "c", "d")
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxMultiClient(responses={
        "/consents/a": 200, "/consents/b": 204, "/consents/c": 404, "/consents/d": 500})
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert set(markers.docs) == {"d"}
    assert markers.docs["d"]["attempts"] == 2 and markers.docs["d"]["last_error"] == "500"
    assert res["orphaned_cleared"] == 3 and res["orphaned_still_pending"] == 1


def test_sweep_batch_bound_oldest_first(monkeypatch):
    from datetime import timedelta
    n = retention._ORPHAN_BATCH + 5
    markers = FakeCol([
        {"_id": f"c{i:03d}", "consent_id": f"c{i:03d}",
         "failed_at": NOW + timedelta(minutes=i), "attempts": 1} for i in range(n)
    ])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = FakeFxClient(status_code=204)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert res["orphaned_retried"] == retention._ORPHAN_BATCH
    assert sorted(markers.docs) == [f"c{i:03d}" for i in range(retention._ORPHAN_BATCH, n)]


def test_sweep_success_revokes_still_authorised_local_doc(monkeypatch):
    markers = FakeCol([{"_id": "fx-1", "consent_id": "fx-1", "failed_at": NOW, "attempts": 1}])
    consents = FakeCol([{"_id": "fx-1", "user_id": UID, "status": "authorized"}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", consents)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: FakeFxClient(status_code=200))
    asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert consents.docs["fx-1"]["status"] == "revoked" and markers.docs == {}


def _downgrade(monkeypatch, flag, client):
    import app.db.collections as cols
    consents = FakeCol([{"_id": "fx-1", "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    monkeypatch.setattr(cols, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(config, "REVOKE_CONSENT_ON_DOWNGRADE", flag)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(lifecycle.on_landed_on_statements(UID))
    return res, consents, markers


def test_downgrade_flag_on_failure_records_marker_and_keeps_consent(monkeypatch):
    res, consents, markers = _downgrade(monkeypatch, True, FakeFxClient(status_code=500))
    assert res["failed"] == 1 and consents.docs["fx-1"]["status"] == "authorized"
    assert markers.docs["fx-1"]["last_error"] == "500"
    assert markers.docs["fx-1"]["user_hash"] == retention._hash_uid(UID)


def test_downgrade_flag_on_timeout_records_class_name(monkeypatch):
    _, _, markers = _downgrade(monkeypatch, True, FakeFxClient(raise_exc=httpx.ConnectTimeout("x")))
    assert markers.docs["fx-1"]["last_error"] == "ConnectTimeout"


def test_downgrade_flag_on_success_writes_no_marker(monkeypatch):
    res, consents, markers = _downgrade(monkeypatch, True, FakeFxClient(status_code=204))
    assert res["revoked"] == 1 and consents.docs["fx-1"]["status"] == "revoked" and markers.docs == {}


def test_downgrade_flag_off_does_nothing(monkeypatch):
    client = FakeFxClient(status_code=500)
    res, consents, markers = _downgrade(monkeypatch, False, client)
    assert res == {"revoke": "off"} and client.calls == [] and markers.docs == {}
