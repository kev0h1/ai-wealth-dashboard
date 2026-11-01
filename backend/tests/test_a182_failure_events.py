"""A182 part 4: consent failure codes and the consent.failed / opened /
initiated webhook events."""
import asyncio
from datetime import datetime

import pytest

import app.routers.webhooks as wh
import app.services.finexer_consent as fc
import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw
from test_finexer_webhook_a167 import env, _post, _Req, _consent_event  # noqa: F401  (shared fixture)


def _failed(evt, code=None, message=None, status="failed"):
    ev = _consent_event(evt, "consent.failed", status)
    if code:
        ev["data"]["object"]["failure_code"] = code
    if message:
        ev["data"]["object"]["failure_message"] = message
    return ev


def test_action_table_maps_the_three_new_events():
    t = fxw.event_actions("")
    assert t["consent.failed"] == fxw.ACTION_CONSENT_FAILED
    assert t["consent.opened"] == fxw.ACTION_CONSENT_AUDIT
    assert t["consent.initiated"] == fxw.ACTION_CONSENT_AUDIT
    assert t["consent.created"] == fxw.ACTION_RECORD_ONLY
    assert fxw.resolve_action("consent.failed") == fxw.ACTION_CONSENT_FAILED


def test_consent_failed_stores_code_and_message_and_flags_accounts(env, monkeypatch):
    marked = []

    async def mark(cid):
        marked.append(cid)
    monkeypatch.setattr(wh, "_mark_accounts_expired", mark)
    env["consents"].docs[0]["last_connection_nag"] = datetime(2026, 1, 1)
    _post(_Req(_failed("evt_f1", "consent_revoked_by_bank", "The bank revoked it", status="revoked")))
    c = env["consents"].docs[0]
    assert c["status"] == "revoked"
    assert c["failure_code"] == "consent_revoked_by_bank"
    assert c["failure_message"] == "The bank revoked it"
    assert "last_connection_nag" not in c
    assert marked == ["c1"]
    assert env["events"].docs[0]["status"] == "noted" and env["calls"] == []


def test_consent_failed_without_status_or_code_marks_failed(env, monkeypatch):
    async def mark(cid):
        return None
    monkeypatch.setattr(wh, "_mark_accounts_expired", mark)
    ev = _consent_event("evt_f2", "consent.failed", "failed")
    ev["data"]["object"].pop("status", None)
    _post(_Req(ev))
    c = env["consents"].docs[0]
    assert c["status"] == "failed" and "failure_code" not in c


@pytest.mark.parametrize("typ", ["consent.opened", "consent.initiated"])
def test_opened_and_initiated_are_audit_only(env, monkeypatch, typ):
    async def boom(cid):
        raise AssertionError("must not touch accounts")
    monkeypatch.setattr(wh, "_mark_accounts_expired", boom)
    _post(_Req(_consent_event("evt_o_" + typ, typ, "pending")))
    c = env["consents"].docs[0]
    assert c["status"] == "authorized"  # untouched
    assert c["last_consent_event"] == typ and c["last_consent_event_at"]
    assert env["events"].docs[0]["status"] == "noted" and env["calls"] == []


def test_failure_fields_extraction_and_scrubbing():
    out = fc.consent_failure_fields({"failure_code": "Access_Denied", "failure_message": "no sk_live_abcdef123456 here"})
    assert out["failure_code"] == "access_denied"
    assert "sk_live" not in out["failure_message"]
    assert fc.consent_failure_fields({"failure_code": "has spaces and bad!"}) == {}
    assert fc.consent_failure_fields({}) == {}
    assert fc.consent_failure_fields(None) == {}


def test_plain_reason_one_sentence_per_known_code_and_a_generic_one():
    sentences = {c: fc.plain_failure_reason({"failure_code": c}) for c in fc.FAILURE_REASONS}
    assert len(set(sentences.values())) == 3 and all(sentences.values())
    generic = fc.plain_failure_reason({"failure_code": "something_new"})
    assert generic == fc.plain_failure_reason({"status": "failed"})
    assert generic not in sentences.values()
    assert fc.plain_failure_reason({"status": "authorized"}) is None
    for text in [*sentences.values(), generic]:
        assert "—" not in text and "!" not in text
    # the raw bank message is never the user-facing reason
    assert "secret words" not in fc.plain_failure_reason({"failure_code": "access_denied", "failure_message": "secret words"})


# ── the sync's GET /consents/{id} carries them too ──────────────────────
def test_sync_fields_store_failure_and_clear_it_when_healthy():
    local = {"authed_at": datetime(2026, 8, 1)}
    failed = fc.consent_sync_fields(
        {"status": "revoked", "failure_code": "consent_limit_reached", "failure_message": "limit",
         "expiry_date": "2027-01-01T00:00:00Z"}, local)
    assert failed["failure_code"] == "consent_limit_reached" and failed["failure_message"] == "limit"
    healthy = fc.consent_sync_fields(
        {"status": "authorized", "expiry_date": "2027-01-01T00:00:00Z", "renewed_at": "2026-10-01T00:00:00Z"}, local)
    assert healthy["failure_code"] is None and healthy["failure_message"] is None
    assert healthy["next_reconfirm_by"] == datetime(2026, 12, 30)
    # a non-authorised consent with no failure fields leaves them alone
    assert "failure_code" not in fc.consent_sync_fields({"status": "expired"}, local)


def test_ops_consent_health_lists_reason_history_and_reconfirm_without_ids(monkeypatch):
    from datetime import timedelta
    now = datetime(2026, 11, 1, 9, 0)
    docs = [
        {"_id": "secret_id_1", "user_id": "u@example.com", "provider": "ob-barclays", "status": "authorized",
         "authed_at": now - timedelta(days=88), "expiry_date": now + timedelta(days=200),
         "retro_date_requested": "2025-11-01"},
        {"_id": "secret_id_2", "user_id": "v@example.com", "provider": "ob-monzo", "status": "revoked",
         "failure_code": "access_denied", "failure_message": "Denied"},
    ]

    class Col:
        def find(self, q=None, projection=None):
            async def gen():
                for d in docs:
                    yield {k: v for k, v in d.items() if not projection or k in projection or k == "_id"}
            return gen()
    monkeypatch.setattr("app.db.collections.finexer_consents_col", Col())
    out = asyncio.run(fc.consent_health(now))
    assert out["reconfirm_due"] == 1 and out["failed"] == 1
    flat = repr(out)
    assert "secret_id" not in flat and "@example.com" not in flat
    barclays = next(r for r in out["consents"] if r["bank"] == "ob-barclays")
    assert barclays["history_requested_from"] == "2025-11-01" and barclays["next_reconfirm_by"]
    monzo = next(r for r in out["consents"] if r["bank"] == "ob-monzo")
    assert monzo["failure_code"] == "access_denied" and monzo["next_reconfirm_by"] is None
