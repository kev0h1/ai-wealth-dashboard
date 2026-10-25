"""H133: scripts/reset_all_users.py against in-memory fakes ONLY.

Nothing here touches a real database: every collection on app.db.collections
is replaced by a FakeCol (test_retention's pattern) before any script code
runs, and the guard tests call the guard function directly with fake names.
"""
import argparse
import asyncio
import importlib.util
from pathlib import Path

import pytest

import app.services.finexer_sync as finexer_sync_module
import app.services.retention as retention
from test_retention import (
    FakeCol as _BaseFakeCol, FakeFxClient, _patch_all_collections, _stub_cascade,
)

_SPEC = importlib.util.spec_from_file_location(
    "reset_all_users",
    Path(__file__).resolve().parents[1] / "scripts" / "reset_all_users.py",
)
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)

OWNER = "owner@example.com"
U1 = "tester.one@example.com"
U2 = "tester.two@example.com"
HOST = "cluster0.fake-host.example.net"
DB_NAME = "wealth_test_reset"


FakeCol = _BaseFakeCol


def _user_docs(uid, tag):
    return {
        "transactions_col": [{"_id": f"t-{tag}", "user_id": uid}],
        "preferences_col": [{"_id": uid}],
        "user_rules_col": [{"_id": f"r-{tag}", "uid": uid}],
        "challenges_col": [{"_id": f"c-{tag}", "uid": uid}],
        "upcoming_overrides_col": [{"_id": f"uo-{tag}", "uid": uid}],
        "upcoming_rules_col": [{"_id": f"ur-{tag}", "uid": uid}],
        "needle_history_col": [{"_id": f"{uid}:2026-10-01", "uid": uid}],
        "companion_items_col": [{"_id": f"ci-{tag}", "uid": uid}, {"_id": f"dismissed:{uid}"}],
        "merchant_categories_col": [{"_id": f"{uid}::tesco", "uid": uid}],
        "cycle_story_col": [{"_id": f"{uid}:2026-10-01:a:v1"}],
        "oauth_tokens_col": [{"_id": f"tok-{tag}", "uid": uid}],
        "oauth_codes_col": [{"_id": f"code-{tag}", "uid": uid}],
    }


def _build(monkeypatch, subs=None, fx_status=204):
    """Seed the owner and two testers plus global data; patch everything."""
    per_col: dict = {}
    for uid, tag in ((OWNER, "o"), (U1, "1"), (U2, "2")):
        for k, docs in _user_docs(uid, tag).items():
            per_col.setdefault(k, []).extend(docs)
    cols = {k: FakeCol(v) for k, v in per_col.items()}
    cols["user_profiles_col"] = FakeCol([{"_id": OWNER}, {"_id": U1}, {"_id": U2}])
    cols["finexer_consents_col"] = FakeCol([
        {"_id": "fx-1-test", "user_id": U1, "status": "authorized"},
        {"_id": "fx-2-test", "user_id": U2, "status": "authorized"},
        {"_id": "fx-3-test", "user_id": U2, "status": "authorized"},
    ])
    cols["connections_col"] = FakeCol()
    cols["accounts_col"] = FakeCol()
    cols["orphaned_revocations_col"] = FakeCol()
    cols["subscriptions_col"] = FakeCol(subs if subs is not None else [
        {"_id": "s1", "user_id": U1, "provider": "stripe", "status": "active", "managed_by": "manual"},
        {"_id": "s2", "user_id": U2, "provider": "stripe", "status": "active", "managed_by": "manual"},
    ])
    cols["broadcasts_col"] = FakeCol([
        {"_id": "b1", "recipient_ids": [U1, U2, OWNER], "created_by": OWNER},
    ])
    cols["allowed_signups_col"] = FakeCol([
        {"_id": "gen-a", "key": "ka", "email": U1, "status": "invited"},
        {"_id": "gen-b", "key": "kb", "email": U2, "status": "revoked"},
    ])
    cols["vendors_col"] = FakeCol([{"_id": "v1", "name": "Acme"}])
    cols["tip_research_col"] = FakeCol([{"_id": "tr1"}])
    cols["settings_col"] = FakeCol([{"_id": "s", "value": 1}])
    cols["settings_audit_col"] = FakeCol([{"_id": "sa", "actor": "someone"}])
    cols["bot_credentials_col"] = FakeCol([{"_id": "bc"}])
    cols["instrument_prices_col"] = FakeCol([{"_id": "ip"}])
    cols["merchant_categories_col"].docs["tesco"] = {"_id": "tesco"}

    _patch_all_collections(monkeypatch, cols)
    from app.db import collections as real
    real.db.name = DB_NAME  # the FakeDB installed by _patch_all_collections
    import app.core.config as config
    monkeypatch.setattr(config, "MONGO_URI", f"mongodb+srv://user:secret@{HOST}/?retryWrites=true")
    monkeypatch.setattr(config, "PRIMARY_EMAIL", OWNER)
    for name in ("connections_col", "accounts_col", "finexer_consents_col", "orphaned_revocations_col"):
        monkeypatch.setattr(retention, name, cols[name])
    _stub_cascade(monkeypatch, [])
    client = FakeFxClient(status_code=fx_status)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    return cols, client


def _args(**over):
    base = dict(
        env_file=None, apply=True, yes=True, expect_host=HOST, confirm_db=DB_NAME,
        confirm="RESET PRODUCTION", backup_confirmed=True, include_owner=True, max_users=None,
    )
    base.update(over)
    return argparse.Namespace(**base)


def _snapshot(cols):
    return {k: {i: dict(d) for i, d in c.docs.items()} for k, c in cols.items()}


GOOD_ENV = {"ALLOW_DROP_PROD_DB": "1"}


def _run(args, env=GOOD_ENV):
    return asyncio.run(script.run(args, env=env))


def _assert_clean_output(text):
    assert "@" not in text
    for uid in (OWNER, U1, U2):
        assert uid not in text
        assert uid.split("@")[0] not in text
    assert "secret" not in text


# ── pure helpers ───────────────────────────────────────────────────────────

def test_host_from_uri_strips_credentials_and_handles_multi_host():
    assert script.host_from_uri("mongodb+srv://u:p%40ss@Cluster0.Example.net/?x=1") == "cluster0.example.net"
    assert script.host_from_uri("mongodb://u:p@h1:27017,h2:27017/db") == "h1"
    assert script.host_from_uri("mongodb://localhost:27017") == "localhost"


def test_paid_provider_classification():
    assert script.paid_provider({"status": "active", "stripe_subscription_id": "sub_1"}) == "stripe"
    assert script.paid_provider({"status": "trialing", "source": "stripe"}) == "stripe"
    assert script.paid_provider({"status": "active", "provider": "apple"}) == "apple"
    assert script.paid_provider({"status": "past_due", "provider": "google"}) == "google"
    assert script.paid_provider({"status": "active", "provider": "stripe", "managed_by": "manual"}) is None
    assert script.paid_provider({"status": "canceled", "provider": "apple"}) is None


def test_guard_function_direct_with_fake_db_objects():
    ok = script.check_apply_guards(_args(), DB_NAME, HOST, GOOD_ENV)
    assert ok == []
    assert script.check_apply_guards(_args(yes=False), DB_NAME, HOST, GOOD_ENV)
    assert script.check_apply_guards(_args(expect_host="other.example.net"), DB_NAME, HOST, GOOD_ENV)
    assert script.check_apply_guards(_args(confirm_db="nope"), DB_NAME, HOST, GOOD_ENV)
    assert script.check_apply_guards(_args(confirm="reset production"), DB_NAME, HOST, GOOD_ENV)
    assert script.check_apply_guards(_args(backup_confirmed=False), DB_NAME, HOST, GOOD_ENV)
    assert script.check_apply_guards(_args(), DB_NAME, HOST, {})
    assert script.check_apply_guards(_args(), DB_NAME, HOST, {"ALLOW_DROP_PROD_DB": "0"})
    # a non-test name with no env: the H96 guard itself refuses
    assert script.check_apply_guards(_args(confirm_db="wealth"), "wealth", HOST, {})


# ── dry run ────────────────────────────────────────────────────────────────

def test_dry_run_deletes_nothing_and_prints_counts_only(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    before = _snapshot(cols)
    code = _run(_args(apply=False, yes=False, expect_host=None, confirm_db=None,
                      confirm=None, backup_confirmed=False), env={})
    out = capsys.readouterr()
    assert code == 0
    assert _snapshot(cols) == before
    assert client.calls == []
    _assert_clean_output(out.out + out.err)
    assert "users discovered: 3" in out.out
    assert "finexer consents to revoke: 3 live of 3 total" in out.out
    assert "allow-list entries kept: 2" in out.out
    assert "Expect 0 before applying; a non-zero count means earlier revoke failures are still pending." in out.out
    assert "live PAID subscriptions: 0" in out.out
    assert f"database: {DB_NAME}" in out.out
    assert f"host: {HOST}" in out.out
    assert "needle_history_id_prefix" in out.out


# ── refusals ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("over,env", [
    ({"yes": False}, GOOD_ENV),
    ({"expect_host": None}, GOOD_ENV),
    ({"expect_host": "wrong.example.net"}, GOOD_ENV),
    ({"confirm_db": None}, GOOD_ENV),
    ({"confirm_db": "wealth_test_other"}, GOOD_ENV),
    ({"confirm": "reset production"}, GOOD_ENV),
    ({"confirm": None}, GOOD_ENV),
    ({"backup_confirmed": False}, GOOD_ENV),
    ({}, {}),
    ({}, {"ALLOW_DROP_PROD_DB": "yes"}),
])
def test_apply_refused_and_db_untouched(monkeypatch, capsys, over, env):
    cols, client = _build(monkeypatch)
    before = _snapshot(cols)
    code = _run(_args(**over), env=env)
    out = capsys.readouterr()
    assert code == 2
    assert "refusing before any change" in out.err
    assert _snapshot(cols) == before
    assert client.calls == []
    _assert_clean_output(out.out + out.err)


def test_live_paid_stripe_subscription_refuses_but_manual_seed_does_not(monkeypatch, capsys):
    paid = [
        {"_id": "s1", "user_id": U1, "provider": "stripe", "status": "active", "managed_by": "manual"},
        {"_id": "s2", "user_id": U2, "provider": None, "source": "stripe", "status": "active",
         "stripe_subscription_id": "sub_123"},
    ]
    cols, client = _build(monkeypatch, subs=paid)
    before = _snapshot(cols)
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 2
    assert "live PAID subscriptions: 1" in out.out
    assert "  stripe: 1" in out.out
    assert _snapshot(cols) == before
    assert client.calls == []
    # dry run still reports and exits 0
    assert _run(_args(apply=False)) == 0


def test_manual_seed_subscriptions_do_not_refuse(monkeypatch, capsys):
    cols, _ = _build(monkeypatch)
    assert _run(_args()) == 0


# ── apply ──────────────────────────────────────────────────────────────────

def test_apply_erases_everyone_and_keeps_shared_data(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    kept = ("allowed_signups_col", "vendors_col", "tip_research_col", "settings_col",
            "settings_audit_col", "bot_credentials_col", "instrument_prices_col")
    kept_before = {k: _snapshot({k: cols[k]})[k] for k in kept}
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 0, out.err
    _assert_clean_output(out.out + out.err)

    users = (OWNER, U1, U2)
    for name in ("transactions_col", "preferences_col", "user_rules_col", "challenges_col",
                 "upcoming_overrides_col", "upcoming_rules_col", "needle_history_col",
                 "companion_items_col", "cycle_story_col", "oauth_tokens_col",
                 "oauth_codes_col", "finexer_consents_col"):
        assert cols[name].docs == {}, name
    # global bare-key merchant row survives, per-user rows gone
    assert set(cols["merchant_categories_col"].docs) == {"tesco"}
    assert set(cols["user_profiles_col"].docs) == set()
    assert cols["subscriptions_col"].docs == {}
    # broadcast kept, recipients pulled
    assert cols["broadcasts_col"].docs["b1"]["recipient_ids"] == []
    # one revoke per consent
    assert sorted(client.calls) == ["/consents/fx-1-test", "/consents/fx-2-test", "/consents/fx-3-test"]
    # shared data untouched
    for k in kept:
        assert _snapshot({k: cols[k]})[k] == kept_before[k], k
    assert "kept: allowed_signups: 2" in out.out
    assert cols["orphaned_revocations_col"].docs == {}
    assert "_seed_subscriptions" in out.out
    assert "summary:" in out.out
    assert users  # users referred to only by hash in output


def test_failed_finexer_revoke_completes_with_marker_and_exit_1(monkeypatch, capsys):
    cols, client = _build(monkeypatch, fx_status=500)
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 1
    assert len(cols["orphaned_revocations_col"].docs) == 3
    assert "Finexer revokes that failed: 3" in out.out
    assert "Local consents are already removed." in out.out
    assert "nightly retry_orphaned_revocations job retries these markers" in out.out
    assert "Re-run this script only if a user is listed as failed." in out.out
    _assert_clean_output(out.out + out.err)
    # the rest of the erasure still completed
    assert cols["transactions_col"].docs == {}
    assert cols["allowed_signups_col"].docs  # kept


def test_second_apply_deletes_nothing(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    assert _run(_args()) == 0
    capsys.readouterr()
    for c in cols.values():
        c.deleted_total = 0
    calls_before = len(client.calls)
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 0
    assert all(getattr(c, "deleted_total", 0) == 0 for c in cols.values())
    assert len(client.calls) == calls_before
    assert "users discovered: 0" in out.out


def test_max_users_stops_after_one(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    code = _run(_args(max_users=1))
    out = capsys.readouterr()
    assert code == 0
    assert out.out.count(": erased (") == 1
    # sorted order: the owner goes first, both testers remain
    assert set(cols["user_profiles_col"].docs) == {U1, U2}


def test_exclude_owner_keeps_owner_data(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    code = _run(_args(include_owner=False))
    capsys.readouterr()
    assert code == 0
    assert set(cols["user_profiles_col"].docs) == {OWNER}
    assert {d["user_id"] for d in cols["transactions_col"].docs.values()} == {OWNER}


def test_changed_shared_collection_is_reported(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    orig = retention.erase_user

    async def sneaky(uid):
        await cols["vendors_col"].delete_many({"_id": "v1"})
        return await orig(uid)

    monkeypatch.setattr(retention, "erase_user", sneaky)
    code = _run(_args(max_users=1))
    out = capsys.readouterr()
    assert code == 1
    assert "vendors" in out.err


def test_script_never_names_a_drop_call():
    src = (Path(script.__file__)).read_text()
    for banned in ("drop_database(", "drop_collection(", ".drop()", "guarded_drop"):
        assert banned not in src


def test_stale_marker_cleared_during_apply_is_not_a_mismatch(monkeypatch, capsys):
    cols, client = _build(monkeypatch)
    cols["orphaned_revocations_col"].docs["stale-marker-1"] = {"_id": "stale-marker-1"}
    orig = retention.erase_user

    async def clearing(uid):
        cols["orphaned_revocations_col"].docs.pop("stale-marker-1", None)
        return await orig(uid)

    monkeypatch.setattr(retention, "erase_user", clearing)
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 0, out.err
    assert "new markers 0" in out.out
    assert "stale-marker-1" not in out.out + out.err


def test_new_marker_ids_alongside_a_preexisting_one_are_reported(monkeypatch, capsys):
    cols, client = _build(monkeypatch, fx_status=500)
    cols["orphaned_revocations_col"].docs["stale-marker-1"] = {"_id": "stale-marker-1"}
    code = _run(_args())
    out = capsys.readouterr()
    assert code == 1
    assert "new markers 3" in out.out
    assert "Finexer revokes that failed: 3" in out.out
    assert "stale-marker-1" not in out.out + out.err
    assert "fx-1-test" not in out.out + out.err
