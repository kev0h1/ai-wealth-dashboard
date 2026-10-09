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
        _r("bc_orphan", "c1", "authorized", created="2026-10-06T00:00:00Z"),
        _r("bc_recent", "c1", "authorized", created="2026-10-07T23:30:00Z"),
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
    assert ids["recent_orphans"] == ["bc_recent"]
    assert ids["pending"] == ["bc_lpend", "bc_pend_new", "bc_pend_old"]
    rep = rc.build_report(g, NOW, "dry-run")
    assert rep["pending_summary"]["older_than_7_days"] == 1
    assert rep["pending_summary"]["close_local_candidates"] == 1


def test_other_environment_never_in_revoke_list_or_report_listing():
    g = _groups()
    assert all(e["id"] not in ("bc_foreign", "bc_ambig") for e in g["orphans"] + g["recent_orphans"])
    rep = rc.build_report(g, NOW, "dry-run")
    dumped = json.dumps(rep)
    assert "bc_foreign" not in dumped and "bc_ambig" not in dumped
    assert rep["counts"]["other_env"] == 1 and rep["counts"]["ambiguous"] == 1


def test_recent_orphan_never_in_revoke_list_and_old_one_is():
    g = _groups()
    assert [e["id"] for e in g["orphans"]] == ["bc_orphan"]  # 2 days old
    assert [e["id"] for e in g["recent_orphans"]] == ["bc_recent"]  # 0 days old
    assert g["recent_orphans"][0]["age_hours"] < 24
    # authed_at wins over created_at
    r = _r("bc_x", "c1", "authorized", created="2026-09-01T00:00:00Z")
    r["authed_at"] = "2026-10-07T23:00:00Z"
    g2 = rc.classify([r], {}, {"c1": [EMAIL]}, NOW)
    assert [e["id"] for e in g2["recent_orphans"]] == ["bc_x"]


def test_report_has_hashes_not_emails():
    rep = json.dumps(rc.build_report(_groups(), NOW, "dry-run"))
    assert EMAIL not in rep and "example.com" not in rep and "_uid" not in rep
    assert rc.user_hash(EMAIL) in rep


def test_dry_run_makes_no_write_end_to_end(monkeypatch, tmp_path):
    """Whole amain() dry run: the fake HTTP client raises on post/put/patch/delete."""
    import app.db.collections as colmod

    class ReadOnlyClient(PagedClient):
        def __init__(self, *a, **k):
            super().__init__({"/consents": {"data": [_r("bc_orphan", "c1", "authorized", created="2026-10-01T00:00:00Z")],
                                            "paging": {}}})

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def put(self, *a, **k):
            pytest.fail("write issued")

        patch = delete = put

    holder = {}

    def make(*a, **k):
        holder["c"] = ReadOnlyClient()
        return holder["c"]

    consents = FakeCol([{"_id": "bc_x", "user_id": EMAIL, "customer_id": "c1", "status": "authorized"}])
    monkeypatch.setattr(rc.httpx, "AsyncClient", make)
    monkeypatch.setattr(colmod, "finexer_consents_col", consents)
    monkeypatch.setattr(colmod, "finexer_customers_col", FakeCol([{"_id": EMAIL, "customer_id": "c1"}]))
    envf = tmp_path / "e.env"
    envf.write_text("FINEXER_API_KEY=test-key\n")
    monkeypatch.delenv("FINEXER_API_KEY", raising=False)
    report = tmp_path / "r.json"
    args = rc.argparse.Namespace(env_file=str(envf), mongo_uri=None, db=None, report=str(report),
                                 apply=False, yes=False, limit=25)
    assert asyncio.run(rc.amain(args)) == 0
    assert holder["c"].gets == ["/consents"]
    assert consents.update_calls == 0
    assert json.loads(report.read_text())["counts"]["orphans"] == 1


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
    assert res["revoked"] == 1 and res["revoke_failed"] == 0 and markers.docs == {}
    assert consents.docs["bc_stale"]["status"] == "revoked"
    assert consents.docs["bc_lpend"]["status"] == "canceled"
    assert consents.docs["bc_match"]["status"] == "authorized"


def test_apply_unconfirmed_revoke_counts_as_failed(monkeypatch):
    # POST says canceled, but the confirm GET keeps showing authorized (or not 200).
    for get in (_Resp(200, {"status": "authorized"}), _Resp(500)):
        res, *_ = _apply(monkeypatch, _Resp(200, {"status": "canceled"}), get)
        assert res["revoked"] == 0 and res["revoke_failed"] == 1
        assert "unconfirmed" not in res


def test_apply_local_flips_scoped_by_user(monkeypatch):
    g = _groups()
    consents = FakeCol([{"_id": "bc_stale", "user_id": "someone-else@example.com", "status": "authorized"}])

    async def nosleep(_):
        return None

    async def revoke(uid, cid):
        return None

    asyncio.run(rc.apply_changes(g, PagedClient({}), consents, revoke, 0, sleep=nosleep))
    assert consents.docs["bc_stale"]["status"] == "authorized"


def test_apply_failure_writes_marker(monkeypatch):
    res, fx, consents, markers = _apply(monkeypatch, _Resp(500), None)
    assert res["revoked"] == 0 and res["revoke_failed"] == 1
    m = markers.docs["bc_orphan"]
    assert m["last_error"] == "500" and m["user_hash"] and EMAIL not in json.dumps(m, default=str)


def test_apply_limit_caps_revokes(monkeypatch):
    res, fx, _, _ = _apply(monkeypatch, _Resp(200, {"status": "canceled"}), _Resp(200, {"status": "canceled"}), limit=0)
    assert [m for m, _ in fx.requests if m == "POST"] == [] and res["skipped_over_limit"] == 1
