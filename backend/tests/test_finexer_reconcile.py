"""A156: Finexer consent reconciliation script. Fakes only: no network, no DB."""
import asyncio
import importlib.util
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

import app.services.finexer_sync as finexer_sync_module
import app.services.retention as retention
from tests.test_finexer_revoke_contract import ContractClient, _Resp
from tests.test_retention import FakeCol

_spec = importlib.util.spec_from_file_location(
    "finexer_reconcile_consents", Path(__file__).resolve().parents[1] / "scripts" / "finexer_reconcile_consents.py")
rc = importlib.util.module_from_spec(_spec)
sys.modules["finexer_reconcile_consents"] = rc
_spec.loader.exec_module(rc)

NOW = datetime(2026, 10, 8, tzinfo=timezone.utc)
EMAIL = "someone@example.com"
OTHER = "stranger@example.com"


def _r(cid, customer, status, created="2026-10-01T00:00:00Z", provider="chase"):
    return {"id": cid, "customer": customer, "provider": provider, "status": status,
            "created_at": created, "authed_at": None, "expiry_date": None}


class PagedClient:
    def __init__(self, pages):
        self.pages, self.gets = pages, []

    async def get(self, path, **kw):
        self.gets.append(path)
        body = self.pages[path]
        return _Resp(200, body)

    async def post(self, *a, **k):
        pytest.fail("POST in a read-only path")


def test_paging_followed_until_exhausted():
    pages = {
        "/consents": {"data": [_r("bc_1", "c1", "authorized")], "paging": {"next": "https://api.finexer.com/consents?after=bc_1"}},
        "https://api.finexer.com/consents?after=bc_1": {"data": [_r("bc_2", "c1", "pending")], "paging": {"next": None}},
    }
    c = PagedClient(pages)
    out = asyncio.run(rc.fetch_all_consents(c))
    assert [x["id"] for x in out] == ["bc_1", "bc_2"] and len(c.gets) == 2


def test_paging_refuses_foreign_host_and_loops():
    c = PagedClient({"/consents": {"data": [], "paging": {"next": "https://evil.example/x"}}})
    with pytest.raises(rc.ReconcileError):
        asyncio.run(rc.fetch_all_consents(c))
    c = PagedClient({"/consents": {"data": [], "paging": {"next": "/consents"}}})
    with pytest.raises(rc.ReconcileError):
        asyncio.run(rc.fetch_all_consents(c))


def _groups():
    local = {
        "bc_match": {"_id": "bc_match", "user_id": EMAIL, "customer_id": "c1", "status": "authorized"},
        "bc_stale": {"_id": "bc_stale", "user_id": EMAIL, "customer_id": "c1", "status": "authorized"},
        "bc_lpend": {"_id": "bc_lpend", "user_id": EMAIL, "customer_id": "c1", "status": "pending"},
    }
    cust = {"c1": [EMAIL], "c2": [EMAIL, "dup@example.com"]}
    remote = [
        _r("bc_match", "c1", "authorized"),
        _r("bc_stale", "c1", "canceled"),
        _r("bc_lpend", "c1", "canceled"),
        _r("bc_orphan", "c1", "authorized"),
        _r("bc_ambig", "c2", "authorized"),
        _r("bc_foreign", "c9", "authorized"),
        _r("bc_pend_old", "c1", "pending", created="2026-09-01T00:00:00Z"),
        _r("bc_pend_new", "c1", "pending", created="2026-10-07T00:00:00Z"),
    ]
    return rc.classify(remote, local, cust, NOW)


def test_grouping_each_case():
    g = _groups()
    ids = {k: sorted(e["id"] for e in v) for k, v in g.items()}
    assert ids["orphans"] == ["bc_orphan"]
    assert ids["stale_local"] == ["bc_stale"]
    assert ids["matched"] == ["bc_match"]
    assert ids["other_env"] == ["bc_foreign"]
    assert ids["ambiguous"] == ["bc_ambig"]
    assert ids["pending"] == ["bc_lpend", "bc_pend_new", "bc_pend_old"]
    rep = rc.build_report(g, NOW, "dry-run")
    assert rep["pending_summary"]["older_than_7_days"] == 1
    assert rep["pending_summary"]["close_local_candidates"] == 1


def test_other_environment_never_in_revoke_list_or_report_listing():
    g = _groups()
    assert all(e["id"] != "bc_foreign" for e in g["orphans"] + g["ambiguous"])
    rep = rc.build_report(g, NOW, "dry-run")
    assert "bc_foreign" not in json.dumps(rep)
    assert rep["counts"]["other_env"] == 1


def test_report_has_hashes_not_emails():
    rep = json.dumps(rc.build_report(_groups(), NOW, "dry-run"))
    assert EMAIL not in rep and "example.com" not in rep and "_uid" not in rep
    assert rc.user_hash(EMAIL) in rep


def test_dry_run_makes_no_post(monkeypatch, tmp_path):
    # Whole CLI dry run with a fake HTTP client that fails on any POST.
    cols = {"consents": FakeCol([{"_id": "bc_x", "user_id": EMAIL, "customer_id": "c1", "status": "authorized"}]),
            "customers": FakeCol([{"_id": EMAIL, "customer_id": "c1"}])}
    client = PagedClient({"/consents": {"data": [_r("bc_orphan", "c1", "authorized")], "paging": {}}})
    remote = asyncio.run(rc.fetch_all_consents(client))
    local, cust = asyncio.run(rc.load_local(cols["consents"], cols["customers"]))
    g = rc.classify(remote, local, cust, NOW)
    assert [e["id"] for e in g["orphans"]] == ["bc_orphan"]
    assert client.gets == ["/consents"]


def test_apply_without_yes_refuses(capsys):
    assert rc.main(["--apply"]) == 2
    assert "--yes" in capsys.readouterr().err


def _apply(monkeypatch, post_resp, get_resp, limit=25):
    g = _groups()
    consents = FakeCol([{"_id": "bc_stale", "user_id": EMAIL, "status": "authorized"},
                        {"_id": "bc_lpend", "user_id": EMAIL, "status": "pending"},
                        {"_id": "bc_match", "user_id": EMAIL, "status": "authorized"}])
    markers = FakeCol()
    fx = ContractClient(post_resp, get_resp)
    monkeypatch.setattr(retention, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: fx)

    async def nosleep(_):
        return None

    res = asyncio.run(rc.apply_changes(g, fx, consents, retention.revoke_finexer_consent, limit, sleep=nosleep))
    return res, fx, consents, markers


def test_apply_revokes_through_helper_and_confirms(monkeypatch):
    res, fx, consents, markers = _apply(
        monkeypatch, _Resp(200, {"status": "canceled"}), _Resp(200, {"status": "canceled"}))
    assert ("POST", "/consents/bc_orphan/revoke") in fx.requests
    # ambiguous, other-env and matched consents are never touched
    assert [p for m, p in fx.requests if m == "POST"] == ["/consents/bc_orphan/revoke"]
    assert res["revoked"] == 1 and res["confirmed"] == 1 and markers.docs == {}
    assert consents.docs["bc_stale"]["status"] == "revoked"
    assert consents.docs["bc_lpend"]["status"] == "canceled"
    assert consents.docs["bc_match"]["status"] == "authorized"


def test_apply_failure_writes_marker(monkeypatch):
    res, fx, consents, markers = _apply(monkeypatch, _Resp(500), None)
    assert res["revoked"] == 0 and res["revoke_failed"] == 1
    m = markers.docs["bc_orphan"]
    assert m["last_error"] == "500" and m["user_hash"] and EMAIL not in json.dumps(m, default=str)


def test_apply_limit_caps_revokes(monkeypatch):
    res, fx, _, _ = _apply(monkeypatch, _Resp(200, {"status": "canceled"}), _Resp(200, {"status": "canceled"}), limit=0)
    assert [m for m, _ in fx.requests if m == "POST"] == [] and res["skipped_over_limit"] == 1
