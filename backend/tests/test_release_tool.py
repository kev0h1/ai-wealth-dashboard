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
        release.SmokeCheck("mcp", "https://x/api/mcp", "404", "200", False),
    ]
    table = release.format_smoke_table(checks)
    assert "PASS" in table
    assert "FAIL" in table
    assert "health" in table and "mcp" in table


def test_format_smoke_table_empty():
    table = release.format_smoke_table([])
    assert "check" in table  # header still prints


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
