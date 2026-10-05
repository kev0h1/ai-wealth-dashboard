"""Tests for scripts/release.py: verdict logic, parsers (Railway JSON,
Vercel `ls` table), smoke-check table formatting, sync-vars argument
construction, and the ancestor/git helpers (against a real temp git repo,
never the real one).

Nothing here calls the real railway/vercel CLIs or touches network; every
remote-calling function is either given fixture text directly, or called
with a fake `runner` that just records what it would have run.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "release.py"


def _load_release_module():
    spec = importlib.util.spec_from_file_location("release_script_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


release = _load_release_module()


# ── verdict_repo_state ───────────────────────────────────────────────────


def test_verdict_repo_state_green():
    item = release.verdict_repo_state(True, "main", True, "abc123", "abc123")
    assert item.verdict == "green"


def test_verdict_repo_state_wrong_cwd():
    item = release.verdict_repo_state(False, "main", True, "abc123", "abc123")
    assert item.verdict == "red"


def test_verdict_repo_state_wrong_branch():
    item = release.verdict_repo_state(True, "feature-x", True, "abc", "abc")
    assert item.verdict == "red"


def test_verdict_repo_state_dirty():
    item = release.verdict_repo_state(True, "main", False, "abc", "abc")
    assert item.verdict == "red"


def test_verdict_repo_state_sha_mismatch():
    item = release.verdict_repo_state(True, "main", True, "abc123", "def456")
    assert item.verdict == "red"
    assert "fetch" in item.message.lower()


# ── Railway deployment JSON parsing ──────────────────────────────────────


RAILWAY_JSON_FIXTURE = """
[
  {
    "id": "dep-1",
    "status": "SUCCESS",
    "createdAt": "2026-09-08T09:28:35.968Z",
    "meta": {"branch": "main", "commitHash": "84007379a49d5c3900c81653d4c58036c2e18c56"}
  },
  {
    "id": "dep-0",
    "status": "SUCCESS",
    "createdAt": "2026-09-07T09:28:35.968Z",
    "meta": {"branch": "main", "commitHash": "aaaaaaa"}
  }
]
"""


def test_parse_railway_deployment_list():
    deployments = release.parse_railway_deployment_list(RAILWAY_JSON_FIXTURE)
    assert len(deployments) == 2
    assert deployments[0]["id"] == "dep-1"


def test_parse_railway_deployment_list_empty():
    assert release.parse_railway_deployment_list("[]") == []


def test_latest_deployment():
    deployments = release.parse_railway_deployment_list(RAILWAY_JSON_FIXTURE)
    latest = release.latest_deployment(deployments)
    assert latest["meta"]["branch"] == "main"


def test_latest_deployment_empty_list():
    assert release.latest_deployment([]) is None


def test_verdict_railway_branch_release_is_green():
    item = release.verdict_railway_branch("ai-wealth-dashboard", "release")
    assert item.verdict == "green"


def test_verdict_railway_branch_main_is_red_with_dashboard_instructions():
    item = release.verdict_railway_branch("ai-wealth-dashboard", "main")
    assert item.verdict == "red"
    assert "Settings" in item.message and "release" in item.message


def test_verdict_railway_branch_unknown_is_amber():
    item = release.verdict_railway_branch("worker", None)
    assert item.verdict == "amber"


def test_verdict_railway_branch_main_confirmed_is_amber_with_operator_note():
    item = release.verdict_railway_branch("ai-wealth-dashboard", "main", confirmed=True)
    assert item.verdict == "amber"
    assert "operator confirmed" in item.message
    assert "release (dashboard)" in item.message


def test_verdict_railway_branch_unknown_confirmed_is_amber():
    item = release.verdict_railway_branch("worker", None, confirmed=True)
    assert item.verdict == "amber"


def test_verdict_railway_branch_already_release_confirmed_is_still_green():
    item = release.verdict_railway_branch("worker", "release", confirmed=True)
    assert item.verdict == "green"


def test_verdict_railway_branch_main_unconfirmed_still_red():
    item = release.verdict_railway_branch("worker", "main", confirmed=False)
    assert item.verdict == "red"


# ── railway_deployment_matches ────────────────────────────────────────────


def test_railway_deployment_matches_main_branch_only_without_require():
    dep = {"status": "SUCCESS", "meta": {"commitHash": "abc123def", "branch": "main"}}
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=False) is True
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=True) is False


def test_railway_deployment_matches_release_branch():
    dep = {"status": "SUCCESS", "meta": {"commitHash": "abc123def", "branch": "release"}}
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=False) is True
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=True) is True


def test_railway_deployment_matches_none_dep():
    assert release.railway_deployment_matches(None, "abc123", require_release_branch=False) is False
    assert release.railway_deployment_matches(None, "abc123", require_release_branch=True) is False


def test_railway_deployment_matches_not_success():
    dep = {"status": "BUILDING", "meta": {"commitHash": "abc123def", "branch": "release"}}
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=False) is False
    assert release.railway_deployment_matches(dep, "abc123", require_release_branch=True) is False


# ── railway_branch_mismatch_message ───────────────────────────────────────


def test_railway_branch_mismatch_message_contents():
    msg = release.railway_branch_mismatch_message("worker", "main", "abc123")
    assert "worker" in msg
    assert "main" in msg
    assert "abc123" in msg
    assert "rollback abc123" in msg


# ── Vercel `ls --prod` parsing ────────────────────────────────────────────


VERCEL_LS_FIXTURE = """
Vercel CLI 55.0.0 (Node.js 22.22.0)
Retrieving project...
Fetching deployments in kev0h1s-projects
> Production deployments for kev0h1s-projects/ai-wealth-dashboard [268ms]

  Age     Project                                  Deployment                                                            Status      Environment     Duration     Username
  42d     kev0h1s-projects/ai-wealth-dashboard     https://ai-wealth-dashboard-hb298eoes-kev0h1s-projects.vercel.app     ● Ready     Production      39s          kev0h1
  43d     kev0h1s-projects/ai-wealth-dashboard     https://ai-wealth-dashboard-ekrzqnhsb-kev0h1s-projects.vercel.app     ● Ready     Production      36s          kev0h1

https://ai-wealth-dashboard-hb298eoes-kev0h1s-projects.vercel.app
https://ai-wealth-dashboard-ekrzqnhsb-kev0h1s-projects.vercel.app
"""


def test_parse_vercel_prod_list():
    rows = release.parse_vercel_prod_list(VERCEL_LS_FIXTURE)
    assert len(rows) == 2
    assert rows[0]["age"] == "42d"
    assert rows[0]["status"] == "Ready"
    assert rows[0]["url"].startswith("https://")


def test_parse_vercel_prod_list_no_deployments():
    assert release.parse_vercel_prod_list("No deployments found.\n") == []


def test_verdict_vercel_age_reports_age():
    rows = release.parse_vercel_prod_list(VERCEL_LS_FIXTURE)
    item = release.verdict_vercel_age(rows)
    assert item.verdict == "green"
    assert "42d" in item.message


def test_verdict_vercel_age_empty_is_amber():
    item = release.verdict_vercel_age([])
    assert item.verdict == "amber"


# ── DNS / health / ancestor / MCP-flag verdicts ──────────────────────────


def test_verdict_dns_resolved():
    assert release.verdict_dns(True).verdict == "green"


def test_verdict_dns_unresolved_is_amber_a18():
    item = release.verdict_dns(False)
    assert item.verdict == "amber"
    assert "A18" in item.message


def test_verdict_health_200():
    assert release.verdict_health(200).verdict == "green"


def test_verdict_health_not_200():
    assert release.verdict_health(500).verdict == "red"
    assert release.verdict_health(None).verdict == "red"


def test_verdict_release_ancestor_green():
    assert release.verdict_release_ancestor(True, True).verdict == "green"


def test_verdict_release_ancestor_red_never_force():
    item = release.verdict_release_ancestor(True, False)
    assert item.verdict == "red"
    assert "never force" in item.message.lower()


def test_verdict_release_ancestor_missing_branch_is_amber():
    item = release.verdict_release_ancestor(False, None)
    assert item.verdict == "amber"


def test_verdict_mcp_flag_absent_everywhere_is_green():
    item = release.verdict_mcp_flag({"ai-wealth-dashboard": False, "worker": False}, False)
    assert item.verdict == "green"


def test_verdict_mcp_flag_present_on_railway_is_red():
    item = release.verdict_mcp_flag({"ai-wealth-dashboard": True, "worker": False}, False)
    assert item.verdict == "red"
    assert "ai-wealth-dashboard" in item.message


def test_verdict_mcp_flag_present_on_vercel_is_red():
    item = release.verdict_mcp_flag({"ai-wealth-dashboard": False, "worker": False}, True)
    assert item.verdict == "red"
    assert "vercel" in item.message


# ── A67: TrueLayer stays absent in production ──────────────────────────────
# Same shape as the MCP flag checks above, one question wider: four Railway
# credential names rather than one flag, plus the Vercel picker flag.


def test_verdict_truelayer_absent_everywhere_is_green():
    item = release.verdict_truelayer_absent({"ai-wealth-dashboard": [], "worker": []}, False)
    assert item.verdict == "green"


def test_verdict_truelayer_credentials_on_railway_is_red():
    item = release.verdict_truelayer_absent(
        {"ai-wealth-dashboard": ["TRUELAYER_CLIENT_ID"], "worker": []}, False
    )
    assert item.verdict == "red"
    assert "ai-wealth-dashboard" in item.message
    assert "TRUELAYER_CLIENT_ID" in item.message


def test_verdict_truelayer_names_every_offending_variable():
    item = release.verdict_truelayer_absent(
        {"ai-wealth-dashboard": list(release.TRUELAYER_RAILWAY_VARS), "worker": []}, False
    )
    assert item.verdict == "red"
    for name in release.TRUELAYER_RAILWAY_VARS:
        assert name in item.message


def test_verdict_truelayer_picker_flag_on_vercel_is_red():
    item = release.verdict_truelayer_absent({"ai-wealth-dashboard": [], "worker": []}, True)
    assert item.verdict == "red"
    assert "vercel" in item.message
    assert release.TRUELAYER_VERCEL_VAR in item.message


def test_verdict_truelayer_unknown_remote_state_is_not_red():
    """A failed Railway/Vercel lookup gives empty lists and None, the same
    "nothing to judge" shape verdict_mcp_flag treats as clean — an
    infrastructure blip must not masquerade as a policy breach."""
    item = release.verdict_truelayer_absent({"ai-wealth-dashboard": [], "worker": []}, None)
    assert item.verdict == "green"


def test_truelayer_railway_vars_are_the_four_from_the_manifest():
    assert sorted(release.TRUELAYER_RAILWAY_VARS) == [
        "TRUELAYER_CLIENT_ID",
        "TRUELAYER_CLIENT_SECRET",
        "TRUELAYER_REDIRECT_URI",
        "TRUELAYER_WEBHOOK_SECRET",
    ]


def test_verdict_env_drift_clean():
    assert release.verdict_env_drift([]).verdict == "green"


def test_verdict_env_drift_missing():
    item = release.verdict_env_drift([("BOT_SECRET", "ai-wealth-dashboard"), ("BOT_SECRET", "worker")])
    assert item.verdict == "red"
    assert "BOT_SECRET" in item.message


def test_verdict_backlog_skip_is_always_skip():
    assert release.verdict_backlog_skip().verdict == "skip"


def test_has_red():
    green = release.CheckItem("a", "a", "green")
    red = release.CheckItem("b", "b", "red")
    assert release.has_red([green]) is False
    assert release.has_red([green, red]) is True


def test_print_check_table_runs_without_error(capsys):
    items = [
        release.CheckItem("a", "thing a", "green", "fine"),
        release.CheckItem("b", "thing b", "red", "broken"),
    ]
    release.print_check_table(items)
    out = capsys.readouterr().out
    assert "thing a" in out and "thing b" in out and "RED" in out


# ── Smoke-check table formatting ─────────────────────────────────────────


def test_format_smoke_table_pass_fail():
    checks = [
        release.SmokeCheck("health", "https://x/api/health", "200", "200", True),
        release.SmokeCheck("mcp", "https://x/api/.well-known/oauth-authorization-server", "401 or 404", "200", False),
    ]
    table = release.format_smoke_table(checks)
    assert "PASS" in table
    assert "FAIL" in table
    assert "health" in table and "mcp" in table


def test_format_smoke_table_empty():
    table = release.format_smoke_table([])
    assert "check" in table  # header still prints


# ── run_smoke_checks: mcp connector discovery endpoint ───────────────────
#
# The old check curled /api/mcp expecting 404. That is unreachable: the
# auth middleware (backend/app/core/auth.py) returns 401 for ANY path
# outside its open list before routing ever runs, so an unregistered route
# 401s exactly like a registered-but-gated one. These tests fake
# release.http_status per URL (never touch the network) and exercise the
# connector's own unauthenticated discovery endpoint, which is the one
# signal that actually distinguishes "connector absent" from "connector
# present": it is only added to the middleware's open-path list when
# MCP_CONNECTOR_ENABLED is true.


def _fake_http_status(status_map):
    def fake(url, timeout=15):
        return status_map.get(url, 599)

    return fake


def _base_status_map(base, discovery_status):
    return {
        f"{base}/api/health": 200,
        f"{base}/api/subscription": 401,
        f"{base}/api/.well-known/oauth-authorization-server": discovery_status,
        f"{base}/api/accounts": 401,
        base: 500,  # homepage: non-200 so the <title> fetch is skipped, no network
        f"{base}/terms": 200,
        f"{base}/privacy": 200,
    }


def test_run_smoke_checks_mcp_discovery_401_when_connector_off_passes(monkeypatch):
    base = "https://x.test"
    monkeypatch.setattr(release, "http_status", _fake_http_status(_base_status_map(base, 401)))
    checks = release.run_smoke_checks(base_url=base)
    check = {c.name: c for c in checks}["mcp connector not publicly discoverable"]
    assert check.passed is True
    assert check.actual == "401"


def test_run_smoke_checks_mcp_discovery_404_when_connector_off_passes(monkeypatch):
    base = "https://x.test"
    monkeypatch.setattr(release, "http_status", _fake_http_status(_base_status_map(base, 404)))
    checks = release.run_smoke_checks(base_url=base)
    check = {c.name: c for c in checks}["mcp connector not publicly discoverable"]
    assert check.passed is True
    assert check.actual == "404"


def test_run_smoke_checks_mcp_discovery_200_when_connector_on_fails(monkeypatch):
    base = "https://x.test"
    monkeypatch.setattr(release, "http_status", _fake_http_status(_base_status_map(base, 200)))
    checks = release.run_smoke_checks(base_url=base)
    check = {c.name: c for c in checks}["mcp connector not publicly discoverable"]
    assert check.passed is False
    assert check.actual == "200"
    # The row's "expected" label is the only place the failure is explained
    # (the table has no separate per-row message column), so it must say
    # why 200 is bad, not just what was wanted.
    assert "connector is mounted" in check.expected


# ── sync-vars: value resolution + arg construction ───────────────────────


def test_extract_env_value_basic():
    text = "FOO=bar\nBAZ = 'quoted value'\n# comment\nQUX=\"double\"\n"
    assert release.extract_env_value(text, "FOO") == "bar"
    assert release.extract_env_value(text, "BAZ") == "quoted value"
    assert release.extract_env_value(text, "QUX") == "double"
    assert release.extract_env_value(text, "MISSING") is None


def test_extract_env_value_last_definition_wins():
    text = "FOO=first\nFOO=second\n"
    assert release.extract_env_value(text, "FOO") == "second"


def test_resolve_sync_value_from_env_file(tmp_path):
    p = tmp_path / ".env"
    p.write_text("BOT_SECRET=uat-value\n")
    assert release.resolve_sync_value("BOT_SECRET", p) == "uat-value"


def test_resolve_sync_value_missing_file_returns_none(tmp_path):
    assert release.resolve_sync_value("BOT_SECRET", tmp_path / "nope.env") is None


def test_resolve_sync_value_special_file_source(tmp_path, monkeypatch):
    fake_p8 = tmp_path / ".apns_auth_key.p8"
    fake_p8.write_text("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n")
    monkeypatch.setitem(release.SPECIAL_FILE_SOURCES, "APNS_AUTH_KEY", fake_p8)
    value = release.resolve_sync_value("APNS_AUTH_KEY", tmp_path / "irrelevant.env")
    assert "BEGIN PRIVATE KEY" in value


def test_build_railway_set_args_never_uses_shell_string():
    cmd = release.build_railway_set_args("BOT_SECRET", "super-secret", "ai-wealth-dashboard")
    assert isinstance(cmd, list)
    assert cmd == [
        "railway", "variable", "set", "BOT_SECRET=super-secret",
        "--service", "ai-wealth-dashboard", "--skip-deploys",
    ]


def test_sync_vars_with_fake_runner_records_correct_calls(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("GOOGLE_CLIENT_ID=abc123\n")

    calls = []

    def fake_runner(cmd, timeout=30, cwd=None):
        calls.append(cmd)
        return ""

    exit_code, set_names, errors = release.sync_vars(
        names=["GOOGLE_CLIENT_ID"],
        env_path=env_file,
        value_pairs=[],
        generate_names=[],
        services=["ai-wealth-dashboard", "worker"],
        runner=fake_runner,
    )
    assert exit_code == 0
    assert errors == []
    assert set_names == ["GOOGLE_CLIENT_ID"]
    assert len(calls) == 2  # one per service
    assert calls[0][3] == "GOOGLE_CLIENT_ID=abc123"
    assert calls[1][3] == "GOOGLE_CLIENT_ID=abc123"
    assert {c[5] for c in calls} == {"ai-wealth-dashboard", "worker"}


def test_sync_vars_generate_produces_distinct_tokens(tmp_path):
    calls = []

    def fake_runner(cmd, timeout=30, cwd=None):
        calls.append(cmd)
        return ""

    exit_code, set_names, errors = release.sync_vars(
        names=[],
        env_path=tmp_path / "unused.env",
        value_pairs=[],
        generate_names=["BOT_SECRET"],
        services=["ai-wealth-dashboard", "worker"],
        runner=fake_runner,
    )
    assert exit_code == 0
    assert set_names == ["BOT_SECRET"]
    web_value = calls[0][3].split("=", 1)[1]
    worker_value = calls[1][3].split("=", 1)[1]
    assert web_value == worker_value  # same generated value set on both services
    assert len(web_value) > 20


def test_sync_vars_value_flag():
    calls = []

    def fake_runner(cmd, timeout=30, cwd=None):
        calls.append(cmd)
        return ""

    exit_code, set_names, errors = release.sync_vars(
        names=[],
        env_path=Path("/nonexistent"),
        value_pairs=["APPLE_SERVICES_ID=co.uk.auriqltd.sorted.web"],
        generate_names=[],
        services=["ai-wealth-dashboard"],
        runner=fake_runner,
    )
    assert exit_code == 0
    assert set_names == ["APPLE_SERVICES_ID"]
    assert calls[0][3] == "APPLE_SERVICES_ID=co.uk.auriqltd.sorted.web"


def test_sync_vars_missing_value_is_an_error_not_a_partial_apply():
    calls = []

    def fake_runner(cmd, timeout=30, cwd=None):
        calls.append(cmd)
        return ""

    exit_code, set_names, errors = release.sync_vars(
        names=["DOES_NOT_EXIST_ANYWHERE"],
        env_path=Path("/nonexistent"),
        value_pairs=[],
        generate_names=[],
        runner=fake_runner,
    )
    assert exit_code == 1
    assert set_names == []
    assert calls == []  # nothing was ever set
    assert errors


def test_sync_vars_never_returns_a_printed_value_string():
    """The names_set return value must be names only; assert no value
    text ever appears in it."""
    calls = []

    def fake_runner(cmd, timeout=30, cwd=None):
        calls.append(cmd)
        return ""

    exit_code, set_names, errors = release.sync_vars(
        names=[],
        env_path=Path("/nonexistent"),
        value_pairs=["BOT_SECRET=totally-secret-token-xyz"],
        generate_names=[],
        services=["ai-wealth-dashboard"],
        runner=fake_runner,
    )
    assert set_names == ["BOT_SECRET"]
    assert "totally-secret-token-xyz" not in set_names
    assert all("totally-secret-token-xyz" not in e for e in errors)


# ── ancestor / tag helpers against a real temp git repo ──────────────────


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=True
    )
    return proc.stdout


@pytest.fixture
def temp_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    (repo / "a.txt").write_text("1\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-q", "-m", "first")
    _git(repo, "branch", "-M", "main")
    _git(repo, "branch", "release")  # release == main initially
    (repo / "a.txt").write_text("2\n")
    _git(repo, "add", "a.txt")
    _git(repo, "commit", "-q", "-m", "second")  # main now ahead of release
    return repo


def test_is_ancestor_true_when_release_behind_main(temp_repo):
    assert release.is_ancestor(temp_repo, "release", "main", timeout=10) is True


def test_is_ancestor_false_when_release_has_diverged(temp_repo):
    _git(temp_repo, "checkout", "-q", "release")
    (temp_repo / "b.txt").write_text("only on release\n")
    _git(temp_repo, "add", "b.txt")
    _git(temp_repo, "commit", "-q", "-m", "diverge")
    _git(temp_repo, "checkout", "-q", "main")
    assert release.is_ancestor(temp_repo, "release", "main", timeout=10) is False


def test_git_rev_parse(temp_repo):
    sha = release.git_rev_parse(temp_repo, "main", timeout=10)
    assert sha is not None
    assert len(sha) == 40


def test_git_rev_parse_unknown_ref_returns_none(temp_repo):
    assert release.git_rev_parse(temp_repo, "does-not-exist", timeout=10) is None


def test_is_tag_from_this_tool(temp_repo):
    sha = release.git_rev_parse(temp_repo, "main", timeout=10)
    _git(temp_repo, "tag", "release-20260101-0000", sha)
    assert release.is_tag_from_this_tool(temp_repo, "release-20260101-0000", timeout=10) is True
    assert release.is_tag_from_this_tool(temp_repo, "not-a-real-tag", timeout=10) is False


def test_utc_release_tag_format():
    from datetime import datetime, timezone

    tag = release.utc_release_tag(datetime(2026, 9, 8, 14, 5, tzinfo=timezone.utc))
    assert tag == "release-20260908-1405"


# ── trigger_codemagic_prod_build (C10) ────────────────────────────────────


def test_trigger_codemagic_missing_credentials_skips_without_failing():
    ok, msg = release.trigger_codemagic_prod_build(None, None)
    assert ok is False
    assert "not set" in msg
    assert "skipping" in msg


def test_trigger_codemagic_missing_app_id_only_skips():
    ok, msg = release.trigger_codemagic_prod_build(None, "tok123")
    assert ok is False
    assert "skipping" in msg


def test_trigger_codemagic_missing_token_only_skips():
    ok, msg = release.trigger_codemagic_prod_build("app123", None)
    assert ok is False
    assert "skipping" in msg


def test_trigger_codemagic_dry_run_prints_request_without_calling_poster():
    calls = []

    def poster(url, payload):
        calls.append((url, payload))
        return 200, '{"_id": "should-not-be-called"}'

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", dry_run=True, poster=poster)
    assert ok is True
    assert "[dry-run]" in msg
    assert release.CODEMAGIC_API_URL in msg
    assert "ios-capacitor-prod" in msg
    assert "release" in msg
    assert calls == []  # dry-run never actually posts


def test_trigger_codemagic_success_reports_build_id():
    def poster(url, payload):
        assert url == release.CODEMAGIC_API_URL
        assert payload == {"appId": "app123", "workflowId": "ios-capacitor-prod", "branch": "release"}
        return 200, '{"_id": "build-abc123"}'

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", poster=poster)
    assert ok is True
    assert "build-abc123" in msg


def test_trigger_codemagic_accepts_buildId_key_too():
    def poster(url, payload):
        return 201, '{"buildId": "build-xyz"}'

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", poster=poster)
    assert ok is True
    assert "build-xyz" in msg


def test_trigger_codemagic_non_2xx_is_a_warning_not_an_exception():
    def poster(url, payload):
        return 401, "unauthorized"

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", poster=poster)
    assert ok is False
    assert "401" in msg


def test_trigger_codemagic_malformed_json_response_still_reports_ok():
    def poster(url, payload):
        return 200, "not json"

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", poster=poster)
    assert ok is True
    assert "build id ?" in msg


def test_trigger_codemagic_poster_exception_is_failure_tolerant():
    def poster(url, payload):
        raise RuntimeError("network unreachable")

    ok, msg = release.trigger_codemagic_prod_build("app123", "tok123", poster=poster)
    assert ok is False
    assert "network unreachable" in msg


def test_trigger_codemagic_custom_workflow_and_branch():
    def poster(url, payload):
        assert payload["workflowId"] == "ios-capacitor"
        assert payload["branch"] == "main"
        return 200, "{}"

    ok, msg = release.trigger_codemagic_prod_build(
        "app123", "tok123", branch="main", workflow_id="ios-capacitor", poster=poster
    )
    assert ok is True
    assert "ios-capacitor" in msg


# ── H108: poll window, late-SUCCESS re-check, tag-only, Vercel rollback verify ──


def test_timeout_minutes_flag_parsing():
    parser = release.build_parser()
    assert parser.parse_args(["deploy"]).timeout_minutes == 30
    assert parser.parse_args(["deploy", "--timeout-minutes", "45"]).timeout_minutes == 45
    assert parser.parse_args(["--timeout-minutes", "20", "rollback", "abc1234"]).timeout_minutes == 20
    assert parser.parse_args(["rollback", "abc1234", "--timeout-minutes", "12"]).timeout_minutes == 12
    assert release.timeout_seconds(30) == 1800
    assert release.timeout_seconds(None) == release.DEPLOY_POLL_TIMEOUT_S == 1800
    with pytest.raises(SystemExit):
        parser.parse_args(["deploy", "--timeout-minutes", "0"])
    with pytest.raises(SystemExit):
        parser.parse_args(["deploy", "--timeout-minutes", "soon"])


def test_final_recheck_decision_is_pure():
    assert release.final_recheck_decision({"a": True, "b": True}) == "continue"
    assert release.final_recheck_decision({"a": True, "b": False}) == "fail"
    assert release.final_recheck_decision({}) == "fail"


def _dep(status, sha="abc12345"):
    return {"status": status, "meta": {"commitHash": sha, "branch": "release"}}


def test_poll_railway_late_success_caught_by_final_recheck():
    # The API service reaches SUCCESS only on the read taken after the window closed.
    clock = {"t": 0.0}
    reads = {"ai-wealth-dashboard": 0, "worker": 0}

    def fetch(service):
        reads[service] += 1
        if service == "worker" or reads[service] >= 3:
            return _dep("SUCCESS")
        return _dep("BUILDING")

    def sleep(n):
        clock["t"] += n

    done, _ = release.poll_railway_services(
        "abc12345", False, 30, 15, fetch, sleep=sleep, clock=lambda: clock["t"],
    )
    assert reads["ai-wealth-dashboard"] == 3  # two in-window reads + the final re-check
    assert release.final_recheck_decision(done) == "continue"


def test_poll_railway_still_pending_after_final_recheck_fails():
    clock = {"t": 0.0}

    def sleep(n):
        clock["t"] += n

    done, _ = release.poll_railway_services(
        "abc12345", False, 30, 15, lambda s: _dep("BUILDING"), sleep=sleep, clock=lambda: clock["t"],
    )
    assert release.final_recheck_decision(done) == "fail"


def test_tag_only_argument_validation():
    assert release.validate_tag_only_args("cd663f1f", "2026-10-05") == ("release-20261005-0000", None)
    assert release.validate_tag_only_args("cd663f1f", "2026-10-05", "0930")[0] == "release-20261005-0930"
    assert release.validate_tag_only_args(None, "2026-10-05")[1]
    assert release.validate_tag_only_args("not-a-sha!", "2026-10-05")[1]
    assert "--date" in release.validate_tag_only_args("cd663f1f", None)[1]
    assert release.validate_tag_only_args("cd663f1f", "05/10/2026")[1]
    assert release.validate_tag_only_args("cd663f1f", "2026-02-30")[1]
    assert release.validate_tag_only_args("cd663f1f", "2026-10-05", "2575")[1]


def test_tag_only_cli_rejects_missing_date_and_subcommand_mix(monkeypatch):
    # Validation fails before any git or network call.
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: pytest.fail("network"))
    assert release.main(["--tag-only", "cd663f1f"]) == 1
    with pytest.raises(SystemExit):
        release.main(["--tag-only", "cd663f1f", "--date", "2026-10-05", "check"])
    with pytest.raises(SystemExit):
        release.main([])


def _link(tmp_path):
    (tmp_path / ".vercel").mkdir()
    (tmp_path / ".vercel" / "project.json").write_text('{"projectId": "prj_1", "orgId": "team_1"}')
    return tmp_path


def _fake_vercel(state):
    """Stub of the documented endpoints only; records every call."""
    calls = state.setdefault("calls", [])

    def http(method, url, token, timeout):
        calls.append((method, url))
        if method == "POST":
            if state.get("promote_fails"):
                raise release.RemoteError("promote refused")
            state["live"] = "d_target"
            return {}
        if "/v4/aliases" in url:
            return {"aliases": [
                {"alias": "other.example.com", "deploymentId": "d_other"},
                {"alias": release.PROD_DOMAIN, "deploymentId": state["live"]},
            ]}
        if "/v13/deployments/" in url:
            dep_id = url.split("/v13/deployments/")[1].split("?")[0]
            sha = "aaaa1111bbbb" if dep_id == "d_target" else "cccc2222"
            if state.get("git_source_only"):
                return {"gitSource": {"sha": sha}}
            if state.get("no_sha"):
                return {"meta": {}}
            return {"meta": {"githubCommitSha": sha}}
        if "/v7/deployments" in url:
            assert "state=READY" in url and "target=production" in url and "sha=aaaa1111" in url
            return {"deployments": [{"uid": "d_target", "meta": {"githubCommitSha": "aaaa1111bbbb"}}]}
        raise AssertionError(url)

    return http


def test_vercel_deployment_sha_fallbacks():
    assert release.vercel_deployment_sha({"meta": {"githubCommitSha": "a"}, "gitSource": {"sha": "b"}}) == "a"
    assert release.vercel_deployment_sha({"gitSource": {"sha": "b"}}) == "b"
    assert release.vercel_deployment_sha({"meta": {}}) is None


def test_verify_vercel_rollback_promotes_when_live_is_wrong(tmp_path):
    state = {"live": "d_other"}
    ok, msg = release.verify_vercel_rollback(
        _link(tmp_path), "aaaa1111", 5, http=_fake_vercel(state), token="t", sleep=lambda n: None, settle_checks=2,
    )
    assert ok and "promoted" in msg
    assert any(m == "POST" and "/promote/d_target" in u for m, u in state["calls"])
    assert not any("/v6/" in u for _, u in state["calls"])


def test_verify_vercel_rollback_no_promote_when_already_live(tmp_path):
    state = {"live": "d_target"}
    ok, _ = release.verify_vercel_rollback(
        _link(tmp_path), "aaaa1111", 5, http=_fake_vercel(state), token="t", sleep=lambda n: None,
    )
    assert ok and not any(m == "POST" for m, _ in state["calls"])


def test_verify_vercel_rollback_fails_closed_without_sha_field(tmp_path):
    state = {"live": "d_other", "no_sha": True}
    ok, msg = release.verify_vercel_rollback(
        _link(tmp_path), "aaaa1111", 5, http=_fake_vercel(state), token="t", sleep=lambda n: None,
    )
    assert not ok and "meta.githubCommitSha" in msg and "gitSource.sha" in msg
    assert not any(m == "POST" for m, _ in state["calls"])


def test_resolve_live_uses_git_source_fallback():
    state = {"live": "d_target", "git_source_only": True}
    dep_id, sha = release.resolve_live_vercel_deployment(_fake_vercel(state), "t", "prj_1", "team_1", 5)
    assert (dep_id, sha) == ("d_target", "aaaa1111bbbb")


def test_vercel_check_mode_is_read_only_and_prints(monkeypatch, tmp_path, capsys):
    state = {"live": "d_other"}
    fake = _fake_vercel(state)
    monkeypatch.setattr(release, "vercel_cli_token", lambda *a, **k: "t")
    monkeypatch.setattr(release, "link_vercel", lambda timeout=30: _link(tmp_path))
    monkeypatch.setattr(release, "vercel_rest", fake)
    assert release.main(["--vercel-check", "--sha", "aaaa1111"]) == 0
    out = capsys.readouterr().out
    assert "d_other" in out and "cccc2222" in out and "promote candidate for aaaa1111: d_target" in out
    assert all(m == "GET" for m, _ in state["calls"])
    with pytest.raises(SystemExit):
        release.main(["--vercel-check", "check"])


def test_vercel_rest_non_json_body_raises_remote_error(monkeypatch):
    class Resp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b"<html>gateway</html>"

    monkeypatch.setattr(release.urllib.request, "urlopen", lambda *a, **k: Resp())
    with pytest.raises(release.RemoteError):
        release.vercel_rest("GET", "https://api.vercel.com/x", "t", 5)


def _rollback_args(**kw):
    import argparse
    ns = argparse.Namespace(target="aaaa1111", allow_worktree=True, timeout=5, timeout_minutes=1)
    ns.__dict__.update(kw)
    return ns


def test_rollback_exits_1_when_promote_fails(monkeypatch, tmp_path):
    state = {"live": "d_other", "promote_fails": True}
    fake = _fake_vercel(state)
    monkeypatch.setattr(release, "_run_ok", lambda *a, **k: (True, "aaaa1111bbbb\n"))
    monkeypatch.setattr(release, "_run", lambda *a, **k: "")
    monkeypatch.setattr(release, "is_ancestor", lambda *a, **k: True)
    monkeypatch.setattr(release, "poll_vercel_ready", lambda *a, **k: (True, []))
    monkeypatch.setattr(release, "poll_railway_services", lambda *a, **k: ({s: True for s in release.RAILWAY_SERVICES}, {}))
    monkeypatch.setattr(release, "link_vercel", lambda timeout=30: _link(tmp_path))
    monkeypatch.setattr(release, "vercel_cli_token", lambda *a, **k: "t")
    monkeypatch.setattr(release, "vercel_rest", fake)
    monkeypatch.setattr(release.time, "sleep", lambda n: None)
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: [])
    assert release.cmd_rollback(_rollback_args()) == 1


def _tag_args(**kw):
    import argparse
    ns = argparse.Namespace(tag_only="cd663f1f", date="2026-10-05", time="0000", allow_worktree=True, timeout=5)
    ns.__dict__.update(kw)
    return ns


def test_tag_only_refuses_sha_not_in_origin_release(monkeypatch):
    cmds = []
    monkeypatch.setattr(release, "_run", lambda cmd, **k: cmds.append(cmd) or "")
    monkeypatch.setattr(release, "_run_ok", lambda *a, **k: (True, "cd663f1fdeadbeef\n"))
    monkeypatch.setattr(release, "is_ancestor", lambda *a, **k: False)
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: pytest.fail("network"))
    assert release.cmd_tag_only(_tag_args()) == 1
    assert cmds[0][:4] == ["git", "fetch", "origin", "release"] and "--tags" in cmds[0]
    assert not any(c[:2] == ["git", "tag"] for c in cmds)


def test_tag_only_refuses_existing_tag(monkeypatch):
    cmds = []
    monkeypatch.setattr(release, "_run", lambda cmd, **k: cmds.append(cmd) or "")
    monkeypatch.setattr(release, "_run_ok", lambda *a, **k: (True, "cd663f1fdeadbeef\n"))
    monkeypatch.setattr(release, "is_ancestor", lambda *a, **k: True)
    monkeypatch.setattr(release, "is_tag_from_this_tool", lambda *a, **k: True)
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: pytest.fail("network"))
    assert release.cmd_tag_only(_tag_args()) == 1
    assert not any(c[:2] == ["git", "tag"] for c in cmds)


# ── H108 round 2: strict promote match, early stop, readiness, bounds, tag-only, deploy-level ──


def _v7_http(items, v13=None):
    calls = []

    def http(method, url, token, timeout):
        calls.append((method, url))
        if "/v7/deployments" in url:
            return {"deployments": items}
        if "/v13/deployments/" in url:
            uid = url.split("/v13/deployments/")[1].split("?")[0]
            return (v13 or {}).get(uid, {"meta": {}})
        raise AssertionError(url)

    http.calls = calls
    return http


def test_promote_candidate_resolves_missing_sha_via_v13():
    http = _v7_http([{"uid": "d1"}], {"d1": {"meta": {"githubCommitSha": "aaaa1111bbbb"}}})
    assert release.find_promote_candidate(http, "t", "p", "team_1", "aaaa1111", 5) == "d1"
    assert any("/v13/deployments/d1" in u for _, u in http.calls)


def test_promote_candidate_no_sha_anywhere_never_promotes(tmp_path):
    http = _v7_http([{"uid": "d1"}], {"d1": {"meta": {}}})
    assert release.find_promote_candidate(http, "t", "p", "team_1", "aaaa1111", 5) is None
    state = {"live": "d_other"}
    base = _fake_vercel(state)

    def h(method, url, token, timeout):
        if "/v7/deployments" in url:
            return {"deployments": [{"uid": "d1"}]}
        if "/v13/deployments/d1" in url:
            return {"meta": {}}
        return base(method, url, token, timeout)

    ok, msg = release.verify_vercel_rollback(
        _link(tmp_path), "aaaa1111", 5, http=h, token="t", sleep=lambda n: None,
    )
    assert not ok and not any(m == "POST" for m, _ in state["calls"])


def test_promote_candidate_mismatched_sha_ignored():
    http = _v7_http([{"uid": "d1", "meta": {"githubCommitSha": "ffff0000"}}])
    assert release.find_promote_candidate(http, "t", "p", None, "aaaa1111", 5) is None


def test_promote_candidate_same_sha_picks_newest_and_different_full_sha_fails_closed():
    same = _v7_http([
        {"uid": "old", "createdAt": 1, "meta": {"githubCommitSha": "aaaa1111bbbb"}},
        {"uid": "new", "createdAt": 9, "meta": {"githubCommitSha": "aaaa1111bbbb"}},
    ])
    assert release.find_promote_candidate(same, "t", "p", None, "aaaa1111", 5) == "new"
    differ = _v7_http([
        {"uid": "x", "meta": {"githubCommitSha": "aaaa1111bbbb"}},
        {"uid": "y", "meta": {"githubCommitSha": "aaaa1111cccc"}},
    ])
    with pytest.raises(release.RemoteError):
        release.find_promote_candidate(differ, "t", "p", None, "aaaa1111", 5)


def test_poll_railway_stops_early_on_failed_service():
    clock = {"t": 0.0}
    reads = {"n": 0}

    def fetch(service):
        reads["n"] += 1
        return _dep("FAILED") if service == "worker" else _dep("SUCCESS")

    failed = set()
    done, _ = release.poll_railway_services(
        "abc12345", False, 1800, 15, fetch, sleep=lambda n: clock.__setitem__("t", clock["t"] + n),
        clock=lambda: clock["t"], failed_out=failed,
    )
    assert failed == {"worker"} and done["worker"] is False and clock["t"] == 0.0 and reads["n"] == 2


def test_vercel_ready_requires_sha_and_newer_than_push():
    dep = {"readyState": "READY", "createdAt": 2_000_000, "meta": {"githubCommitSha": "aaaa1111bbbb"}}
    assert release.vercel_ready_for_push(dep, "aaaa1111", 2000.0)
    assert not release.vercel_ready_for_push(dep, "ffff0000", 2000.0)
    assert not release.vercel_ready_for_push(dep, "aaaa1111", 5000.0)
    assert not release.vercel_ready_for_push({**dep, "readyState": "BUILDING"}, "aaaa1111", 2000.0)


def test_timeout_minutes_bounds():
    parser = release.build_parser()
    for bad in ("0", "-5", "nan", "inf", "181", "1.5", "x"):
        with pytest.raises(SystemExit):
            parser.parse_args(["deploy", "--timeout-minutes", bad])
    assert parser.parse_args(["deploy", "--timeout-minutes", "180"]).timeout_minutes == 180


def _tag_stubs(monkeypatch, *, points_at="", live_sha="cd663f1fdeadbeef", live_err=None):
    cmds = []
    monkeypatch.setattr(release, "_run", lambda cmd, **k: cmds.append(cmd) or "")

    def run_ok(cmd, **k):
        if cmd[:3] == ["git", "tag", "--points-at"]:
            return True, points_at
        return True, "cd663f1fdeadbeef\n"

    monkeypatch.setattr(release, "_run_ok", run_ok)
    monkeypatch.setattr(release, "is_ancestor", lambda *a, **k: True)
    monkeypatch.setattr(release, "is_tag_from_this_tool", lambda *a, **k: False)

    def live(timeout, http=None):
        if live_err:
            raise release.RemoteError(live_err)
        return "d_live", {"meta": {"githubCommitSha": live_sha}}

    monkeypatch.setattr(release, "live_vercel_deployment", live)
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: [])
    return cmds


def test_tag_only_refuses_sha_with_existing_release_tag(monkeypatch):
    cmds = _tag_stubs(monkeypatch, points_at="release-20260101-1200\n")
    assert release.cmd_tag_only(_tag_args()) == 1
    assert not any(c[:2] == ["git", "tag"] and "-a" in c for c in cmds)


def test_tag_only_live_check_fail_closed_mismatch_and_skip(monkeypatch):
    cmds = _tag_stubs(monkeypatch, live_err="no token")
    assert release.cmd_tag_only(_tag_args()) == 1
    cmds = _tag_stubs(monkeypatch, live_sha="ffff0000")
    assert release.cmd_tag_only(_tag_args()) == 1
    assert not any("-a" in c for c in cmds)
    cmds = _tag_stubs(monkeypatch, live_err="no token")
    assert release.cmd_tag_only(_tag_args(skip_live_check=True)) == 0
    assert any(c[:3] == ["git", "tag", "-a"] for c in cmds)
    cmds = _tag_stubs(monkeypatch)
    assert release.cmd_tag_only(_tag_args()) == 0
    assert any(c[:3] == ["git", "tag", "-a"] for c in cmds)


def _deploy_env(monkeypatch, fetch):
    import argparse
    cmds = []
    clock = {"t": 0.0}
    monkeypatch.chdir(release.REPO_ROOT)
    monkeypatch.setattr(release, "run_check", lambda *a, **k: [])
    monkeypatch.setattr(release, "has_red", lambda items: False)
    monkeypatch.setattr(release, "print_check_table", lambda items: None)
    monkeypatch.setattr(release, "git_rev_parse", lambda root, ref, timeout: "abc12345" if "main" in ref else "prev0000")
    monkeypatch.setattr(release, "is_ancestor", lambda *a, **k: True)
    monkeypatch.setattr(release, "_run", lambda cmd, **k: cmds.append(cmd) or "")
    monkeypatch.setattr(release, "fetch_railway_latest_deployment", lambda svc, timeout: fetch(svc))
    monkeypatch.setattr(release, "poll_vercel_ready", lambda *a, **k: (True, [{"url": "u", "age": "1m", "status": "Ready"}]))
    orig = release.poll_railway_services
    monkeypatch.setattr(
        release, "poll_railway_services",
        lambda *a, **k: orig(*a, sleep=lambda n: clock.__setitem__("t", clock["t"] + n), clock=lambda: clock["t"], **k),
    )
    monkeypatch.setattr(release, "run_smoke_checks", lambda *a, **k: [])
    monkeypatch.setattr(release, "trigger_codemagic_prod_build", lambda *a, **k: (True, "stub"))
    args = argparse.Namespace(dry_run=False, allow_worktree=False, timeout=5, timeout_minutes=1, railway_branch_confirmed=False)
    return args, cmds


def test_deploy_late_success_reaches_smoke_and_tag(monkeypatch):
    reads = {}

    def fetch(svc):
        reads[svc] = reads.get(svc, 0) + 1
        if svc == "worker" or reads[svc] >= 6:  # SUCCESS only on the final re-check
            return _dep("SUCCESS")
        return _dep("BUILDING")

    args, cmds = _deploy_env(monkeypatch, fetch)
    assert release.cmd_deploy(args) == 0
    assert any(c[:2] == ["git", "tag"] for c in cmds)
    assert any(c[:3] == ["git", "push", "origin"] and c[3].startswith("release-") for c in cmds)


def test_deploy_failed_service_produces_no_tag(monkeypatch):
    args, cmds = _deploy_env(monkeypatch, lambda svc: _dep("FAILED") if svc == "worker" else _dep("SUCCESS"))
    assert release.cmd_deploy(args) == 1
    assert not any(c[:2] == ["git", "tag"] for c in cmds)
