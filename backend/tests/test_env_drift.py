"""Tests for scripts/env_drift.py: the markdown-manifest parser, the
UAT/Railway/Vercel name collectors, the diff/verdict logic, and the CLI.

Everything here runs against fixture text or temp files under `tmp_path`;
nothing calls the real railway/vercel CLIs (--no-remote, or monkeypatched
fetch functions), and nothing reads the real backend/.env or
frontend/.env.local.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "env_drift.py"


def _load_env_drift_module():
    spec = importlib.util.spec_from_file_location("env_drift_script_under_test", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


env_drift = _load_env_drift_module()


# ── Markdown table parser ────────────────────────────────────────────────


def test_parse_markdown_tables_basic():
    text = """
Some prose before.

| A | B |
|---|---|
| 1 | 2 |
| 3 | 4 |

More prose after.
"""
    tables = env_drift.parse_markdown_tables(text)
    assert len(tables) == 1
    headers, rows = tables[0]
    assert headers == ["A", "B"]
    assert rows == [["1", "2"], ["3", "4"]]


def test_parse_markdown_tables_multiple_in_one_section():
    text = """
| X | Y |
|---|---|
| a | b |

not a table line

| P | Q |
| :--- | ---: |
| c | d |
"""
    tables = env_drift.parse_markdown_tables(text)
    assert len(tables) == 2
    assert tables[0][0] == ["X", "Y"]
    assert tables[1][0] == ["P", "Q"]
    assert tables[1][1] == [["c", "d"]]


def test_parse_markdown_tables_ignores_non_table_pipes():
    text = "This has a | pipe but no separator line after it\nand another line\n"
    tables = env_drift.parse_markdown_tables(text)
    assert tables == []


# ── Manifest parsing ─────────────────────────────────────────────────────


MANIFEST_FIXTURE = """# Environment configuration manifest

Preamble text.

## Backend

| Variable | Read in | UAT (VPS backend/.env) | Production (Railway, both services) | Notes |
|---|---|---|---|---|
| `MONGO_URI` | `core/config.py` | present | present | required; datastore. |
| `BOT_SECRET` | `core/config.py` | present | present (required, currently absent, see Known drift) | required in prod. |
| `OPEN_SIGNUP` | `core/config.py` | absent (default false) | absent (default false) | flag. |
| `API_PUBLIC_URL` | `core/config.py` | absent (default ok) | absent (default ok) | optional. |

### Present but not read by backend/app (legacy scripts)

| Variable | Read in | UAT (VPS backend/.env) | Production (Railway, both services) | Notes |
|---|---|---|---|---|
| `MONGO_DB` | nowhere | present | absent | vestigial. |

## Frontend

| Variable | Read in | UAT (frontend/.env.local, build-time) | Production (Vercel) | Notes |
|---|---|---|---|---|
| `BACKEND_URL` | `next.config.ts` | absent (default localhost ok) | present | required on Vercel. |
| `NEXT_PUBLIC_MCP_CONNECTOR` | `lib/featureFlags.ts` | present | absent | flag, must stay absent. |

## Known drift (2026-09-08)

- some prose, not a table.
"""


def test_parse_manifest_text_backend_and_frontend_sections():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)
    backend_names = {v.name for v in manifest["backend"]}
    frontend_names = {v.name for v in manifest["frontend"]}
    assert backend_names == {"MONGO_URI", "BOT_SECRET", "OPEN_SIGNUP", "API_PUBLIC_URL", "MONGO_DB"}
    assert frontend_names == {"BACKEND_URL", "NEXT_PUBLIC_MCP_CONNECTOR"}


def test_parse_manifest_text_presence_and_notes():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)
    by_name = {v.name: v for v in manifest["backend"]}
    assert by_name["MONGO_URI"].uat_expected == "present"
    assert by_name["MONGO_URI"].prod_expected == "present"
    assert by_name["BOT_SECRET"].prod_expected == "present"  # required, even though currently absent
    assert by_name["OPEN_SIGNUP"].uat_expected == "absent"
    assert by_name["API_PUBLIC_URL"].uat_expected == "optional" or by_name["API_PUBLIC_URL"].uat_expected == "absent"
    assert "required" in by_name["BOT_SECRET"].notes


def test_parse_manifest_text_no_matching_section_returns_empty():
    manifest = env_drift.parse_manifest_text("# Nothing here\n\nJust prose.\n")
    assert manifest["backend"] == []
    assert manifest["frontend"] == []


# ── Presence-cell parsing ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "cell,expected",
    [
        ("present", "present"),
        ("absent", "absent"),
        ("optional", "optional"),
        ("**absent**", "absent"),
        ("**absent, must stay absent**", "absent"),
        ("present (`true`, UAT testing)", "present"),
        ("present (required, currently absent, see Known drift)", "present"),
        ("some unparseable text", "optional"),
    ],
)
def test_presence_parsing(cell, expected):
    assert env_drift._presence(cell) == expected


# ── .env file name collector ─────────────────────────────────────────────


def test_parse_env_file_names_ignores_comments_and_blanks_and_never_keeps_values():
    text = """
# a comment
FOO=bar
export BAZ=qux

QUUX = with spaces
# ANOTHER=commented_out
"""
    names = env_drift.parse_env_file_names(text)
    assert names == {"FOO", "BAZ", "QUUX"}


def test_parse_env_file_names_ignores_multiline_value_continuation_lines():
    text = """MONGO_URI=mongodb://secret-host/db
VAPID_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----
IqIXGNWVU5d35gCKSmBKDG9Uar8YnCn67g4vN2poWs=
-----END EC PRIVATE KEY-----
"""
    names = env_drift.parse_env_file_names(text)
    assert names == {"MONGO_URI", "VAPID_PRIVATE_KEY"}


def test_read_env_file_names_missing_file_returns_empty(tmp_path):
    assert env_drift.read_env_file_names(tmp_path / "nope.env") == set()


def test_read_env_file_names_real_file(tmp_path):
    p = tmp_path / ".env"
    p.write_text("A=1\nB=2\n")
    assert env_drift.read_env_file_names(p) == {"A", "B"}


# ── Railway / Vercel collectors ──────────────────────────────────────────


def test_parse_railway_kv_names_drops_railway_prefixed():
    text = """MONGO_URI=mongodb://secret-host/db
RAILWAY_SERVICE_NAME=ai-wealth-dashboard
RAILWAY_ENVIRONMENT=production
BOT_SECRET=super-secret-value
"""
    names = env_drift.parse_railway_kv_names(text)
    assert names == {"MONGO_URI", "BOT_SECRET"}


def test_parse_railway_kv_names_ignores_multiline_pem_continuation_lines():
    """Regression: a PEM value stored on Railway with real embedded
    newlines (rather than \\n-escaped) puts each continuation line
    through the same per-line scan. A base64 body line that happens to be
    all-alnum and end in `=` padding must NOT be mistaken for a `NAME=`
    line, or a fragment of the secret leaks into the parsed "name" set."""
    text = """MONGO_URI=mongodb://secret-host/db
VAPID_PRIVATE_KEY=-----BEGIN EC PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg
IqIXGNWVU5d35gCKSmBKDG9Uar8YnCn67g4vN2poWs=
-----END EC PRIVATE KEY-----
BOT_SECRET=super-secret-value
"""
    names = env_drift.parse_railway_kv_names(text)
    assert names == {"MONGO_URI", "VAPID_PRIVATE_KEY", "BOT_SECRET"}
    # The would-be false positive must never appear as a parsed name.
    assert "IqIXGNWVU5d35gCKSmBKDG9Uar8YnCn67g" not in names


def test_parse_vercel_env_ls_first_column_only():
    text = """
Vercel CLI 55.0.0 (Node.js 22.22.0)
Retrieving project...
> Environment Variables found for kev0h1s-projects/ai-wealth-dashboard [339ms]

 name               value               environments                created
 BACKEND_URL        Encrypted           Production, Preview         50d ago

Common next commands:
- `vercel env add`
- `vercel env rm`
"""
    names = env_drift.parse_vercel_env_ls(text)
    assert names == {"BACKEND_URL"}


def test_parse_vercel_env_ls_no_vars_found():
    text = "No Environment Variables found for kev0h1s-projects/ai-wealth-dashboard [200ms]\n"
    assert env_drift.parse_vercel_env_ls(text) == set()


# ── Verdict logic ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "expected,actual,verdict",
    [
        ("present", True, "ok"),
        ("present", False, "missing"),
        ("absent", False, "ok"),
        ("absent", True, "unexpected"),
        ("optional", True, "ok"),
        ("optional", False, "ok"),
        ("present", None, "ok"),  # not checked (--no-remote) never fails
        ("absent", None, "ok"),
    ],
)
def test_verdict_for(expected, actual, verdict):
    assert env_drift.verdict_for(expected, actual) == verdict


# ── Row building + exit-code logic ───────────────────────────────────────


def test_build_backend_rows_flags_missing_required_production_var():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)["backend"]
    uat_actual = {"MONGO_URI", "BOT_SECRET"}
    railway_actual = {
        "ai-wealth-dashboard": {"MONGO_URI"},  # BOT_SECRET missing here
        "worker": {"MONGO_URI", "BOT_SECRET"},
    }
    rows = env_drift.build_backend_rows(manifest, uat_actual, railway_actual)
    by_name = {r.name: r for r in rows}
    assert by_name["BOT_SECRET"].verdict == "missing"
    assert by_name["MONGO_URI"].verdict == "ok"

    failures = env_drift.required_production_failures(rows)
    assert failures == [("BOT_SECRET", "ai-wealth-dashboard")]


def test_build_backend_rows_all_present_is_clean():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)["backend"]
    uat_actual = {"MONGO_URI", "BOT_SECRET", "MONGO_DB"}
    railway_actual = {
        "ai-wealth-dashboard": {"MONGO_URI", "BOT_SECRET"},
        "worker": {"MONGO_URI", "BOT_SECRET"},
    }
    rows = env_drift.build_backend_rows(manifest, uat_actual, railway_actual)
    failures = env_drift.required_production_failures(rows)
    assert failures == []


def test_build_backend_rows_not_in_manifest():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)["backend"]
    uat_actual = {"MONGO_URI", "SOME_NEW_VAR"}
    railway_actual = {"ai-wealth-dashboard": {"MONGO_URI"}, "worker": {"MONGO_URI"}}
    rows = env_drift.build_backend_rows(manifest, uat_actual, railway_actual)
    extra = [r for r in rows if r.name == "SOME_NEW_VAR"]
    assert len(extra) == 1
    assert extra[0].verdict == "not-in-manifest"


def test_build_backend_rows_no_remote_never_flags_missing():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)["backend"]
    uat_actual = {"MONGO_URI", "BOT_SECRET"}  # present on UAT; only production is unchecked here
    rows = env_drift.build_backend_rows(manifest, uat_actual, railway_actual=None)
    by_name = {r.name: r for r in rows}
    assert by_name["BOT_SECRET"].verdict == "ok"
    assert env_drift.required_production_failures(rows) == []


def test_build_frontend_rows_flags_unexpected_flag_present_in_prod():
    manifest = env_drift.parse_manifest_text(MANIFEST_FIXTURE)["frontend"]
    uat_actual = {"NEXT_PUBLIC_MCP_CONNECTOR"}
    vercel_actual = {"BACKEND_URL", "NEXT_PUBLIC_MCP_CONNECTOR"}  # should be absent in prod
    rows = env_drift.build_frontend_rows(manifest, uat_actual, vercel_actual)
    by_name = {r.name: r for r in rows}
    assert by_name["NEXT_PUBLIC_MCP_CONNECTOR"].verdict == "unexpected"
    assert by_name["BACKEND_URL"].verdict == "ok"


# ── CLI (main()) ──────────────────────────────────────────────────────────


def _write_manifest(tmp_path: Path) -> Path:
    p = tmp_path / "ENV.md"
    p.write_text(MANIFEST_FIXTURE)
    return p


def test_main_no_remote_exit_zero(tmp_path, capsys):
    manifest = _write_manifest(tmp_path)
    uat_env = tmp_path / "backend.env"
    uat_env.write_text("MONGO_URI=mongodb://localhost/db\n")
    uat_frontend = tmp_path / "frontend.env.local"
    uat_frontend.write_text("NEXT_PUBLIC_MCP_CONNECTOR=on\n")

    code = env_drift.main(
        [
            "--manifest", str(manifest),
            "--uat-env", str(uat_env),
            "--uat-frontend-env", str(uat_frontend),
            "--no-remote",
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert "MONGO_URI" in out
    assert "BOT_SECRET" in out


def test_main_json_output_is_valid_json(tmp_path, capsys):
    manifest = _write_manifest(tmp_path)
    uat_env = tmp_path / "backend.env"
    uat_env.write_text("MONGO_URI=mongodb://localhost/db\n")
    uat_frontend = tmp_path / "frontend.env.local"
    uat_frontend.write_text("")

    code = env_drift.main(
        [
            "--manifest", str(manifest),
            "--uat-env", str(uat_env),
            "--uat-frontend-env", str(uat_frontend),
            "--no-remote",
            "--json",
        ]
    )
    assert code == 0
    payload = json.loads(capsys.readouterr().out)
    assert "backend" in payload and "frontend" in payload
    names = {row["name"] for row in payload["backend"]}
    assert "MONGO_URI" in names


def test_main_never_prints_secret_values(tmp_path, capsys):
    """The UAT env fixture carries an obviously secret-looking value; the
    printed table (values are never collected past the collector
    functions, but this is the end-to-end guarantee) must not contain it."""
    manifest = _write_manifest(tmp_path)
    uat_env = tmp_path / "backend.env"
    secret_value = "sk-super-secret-value-should-never-appear"
    uat_env.write_text(f"MONGO_URI=mongodb://localhost/db\nBOT_SECRET={secret_value}\n")
    uat_frontend = tmp_path / "frontend.env.local"
    uat_frontend.write_text("")

    code = env_drift.main(
        [
            "--manifest", str(manifest),
            "--uat-env", str(uat_env),
            "--uat-frontend-env", str(uat_frontend),
            "--no-remote",
        ]
    )
    assert code == 0
    out = capsys.readouterr().out
    assert secret_value not in out
    # No "NAME=value" pattern anywhere in the output.
    import re

    assert re.search(r"[A-Z_]+=\S", out) is None
