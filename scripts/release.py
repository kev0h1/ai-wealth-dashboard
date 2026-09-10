#!/usr/bin/env python3
"""Production release tool. See docs/ops/RELEASE.md for the runbook this
implements.

Production = Vercel project `ai-wealth-dashboard` on branch `release` +
Railway project `gleaming-miracle` (services `ai-wealth-dashboard`,
`worker`), which must ALSO be set to deploy from `release`. Promoting
`main` (what the shared tree and UAT run) to `release` is the single
deliberate act this tool performs; everything else is a precondition
check or a read-only report.

Subcommands:

    scripts/release.py check
    scripts/release.py sync-vars NAME[,NAME...] [--from backend/.env]
    scripts/release.py deploy [--dry-run]
    scripts/release.py rollback <tag-or-sha>

Run with the venv:

    backend/.venv/bin/python scripts/release.py check

Every remote command (git fetch, railway, vercel, curl-equivalent HTTP,
DNS) has a timeout and reads no stdin. This script never prints a
variable's value.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

REPO_ROOT = Path("/root/ai-wealth-dashboard")
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import env_drift  # noqa: E402  (scripts/env_drift.py, same directory)

RAILWAY_SERVICES = ["ai-wealth-dashboard", "worker"]
VERCEL_PROJECT = "ai-wealth-dashboard"
PROD_WEB_URL = "https://wealth.auriqltd.co.uk"
PROD_API_HOST = "api.wealth.auriqltd.co.uk"
REMOTE_TIMEOUT = 30
HTTP_TIMEOUT = 15
DEPLOY_POLL_TIMEOUT_S = 15 * 60
DEPLOY_POLL_INTERVAL_S = 15

# The two names that must never be set in production until F7/A17 land.
MCP_RAILWAY_VAR = "MCP_CONNECTOR_ENABLED"
MCP_VERCEL_VAR = "NEXT_PUBLIC_MCP_CONNECTOR"

# C10: after a successful deploy, best-effort trigger the production
# TestFlight build via the Codemagic API. See docs/ops/ENV.md's "Release
# tooling" section for CODEMAGIC_API_TOKEN / CODEMAGIC_APP_ID and
# DEPLOY.md's "Release trigger" for the full behaviour.
CODEMAGIC_API_URL = "https://api.codemagic.io/builds"
CODEMAGIC_PROD_WORKFLOW = "ios-capacitor-prod"
CODEMAGIC_PROD_BRANCH = "release"

# Special-cased sync-vars sources: config.py falls back to these gitignored
# files on UAT rather than an env var (see backend/app/core/config.py's
# `_apns_key_file` / `_fcm_sa_file`); production has no persistent
# filesystem, so these need setting as the env var form instead.
SPECIAL_FILE_SOURCES = {
    "APNS_AUTH_KEY": REPO_ROOT / "backend" / ".apns_auth_key.p8",
    "FCM_SERVICE_ACCOUNT_JSON": REPO_ROOT / "backend" / ".fcm_service_account.json",
}


class RemoteError(RuntimeError):
    pass


def _run(cmd: list[str], timeout: int = REMOTE_TIMEOUT, cwd: Optional[Path] = None) -> str:
    """Run a command with a timeout and no stdin, never through a shell.
    Returns combined stdout+stderr; raises RemoteError on non-zero exit,
    timeout, or a missing binary."""
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RemoteError(f"{' '.join(cmd)} timed out after {timeout}s") from exc
    except FileNotFoundError as exc:
        raise RemoteError(f"{cmd[0]} not found") from exc
    if proc.returncode != 0:
        raise RemoteError(f"{' '.join(cmd)} exited {proc.returncode}: {proc.stdout.strip()[:400]}")
    return proc.stdout


def _run_ok(cmd: list[str], timeout: int = REMOTE_TIMEOUT, cwd: Optional[Path] = None) -> tuple[bool, str]:
    """Like _run but never raises; returns (ok, combined_output)."""
    try:
        return True, _run(cmd, timeout=timeout, cwd=cwd)
    except RemoteError as exc:
        return False, str(exc)


# ── Check items ──────────────────────────────────────────────────────────


@dataclass
class CheckItem:
    key: str
    label: str
    verdict: str  # "green" | "amber" | "red" | "skip"
    message: str = ""


_VERDICT_SYMBOL = {"green": "GREEN", "amber": "AMBER", "red": "RED", "skip": "SKIP"}


def has_red(items: list[CheckItem]) -> bool:
    return any(i.verdict == "red" for i in items)


def print_check_table(items: list[CheckItem]) -> None:
    rows = [[i.key, _VERDICT_SYMBOL.get(i.verdict, i.verdict.upper()), i.label, i.message] for i in items]
    headers = ["check", "verdict", "what", "detail"]
    widths = [
        max(len(h), *(len(r[idx]) for r in rows)) if rows else len(h) for idx, h in enumerate(headers)
    ]
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for r in rows:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))


# ── (a) repo state ───────────────────────────────────────────────────────


def verdict_repo_state(
    cwd_ok: bool, branch: Optional[str], clean: Optional[bool], local_sha: Optional[str], remote_sha: Optional[str]
) -> CheckItem:
    if not cwd_ok:
        return CheckItem("cwd", "working directory", "red", f"not running from {REPO_ROOT}")
    if branch != "main":
        return CheckItem("cwd", "working directory", "red", f"shared tree is on branch {branch!r}, expected main")
    if clean is False:
        return CheckItem("cwd", "working directory", "red", "shared tree has uncommitted changes")
    if local_sha is None or remote_sha is None:
        return CheckItem("cwd", "working directory", "red", "could not determine main / origin/main sha")
    if local_sha != remote_sha:
        return CheckItem(
            "cwd", "working directory", "red",
            f"main ({local_sha[:8]}) != origin/main ({remote_sha[:8]}), fetch/pull first",
        )
    return CheckItem("cwd", "working directory", "green", f"main clean at {local_sha[:8]}, matches origin/main")


def git_repo_state(repo_root: Path, timeout: int) -> tuple[Optional[str], Optional[bool], Optional[str], Optional[str]]:
    """(branch, clean, local main sha, origin/main sha) for `repo_root`,
    after fetching. Any piece that couldn't be determined is None."""
    branch = None
    ok, out = _run_ok(["git", "rev-parse", "--abbrev-ref", "HEAD"], timeout=timeout, cwd=repo_root)
    if ok:
        branch = out.strip()

    clean = None
    ok, out = _run_ok(["git", "status", "--porcelain"], timeout=timeout, cwd=repo_root)
    if ok:
        tracked_dirty = [ln for ln in out.splitlines() if not ln.startswith("??")]
        clean = len(tracked_dirty) == 0

    _run_ok(["git", "fetch", "origin"], timeout=timeout, cwd=repo_root)

    local_sha = None
    ok, out = _run_ok(["git", "rev-parse", "main"], timeout=timeout, cwd=repo_root)
    if ok:
        local_sha = out.strip()

    remote_sha = None
    ok, out = _run_ok(["git", "rev-parse", "origin/main"], timeout=timeout, cwd=repo_root)
    if ok:
        remote_sha = out.strip()

    return branch, clean, local_sha, remote_sha


# ── (b) backlog in-progress items ────────────────────────────────────────


def verdict_backlog_skip() -> CheckItem:
    return CheckItem(
        "backlog", "in-progress items with unmerged branches", "skip",
        "not enforced by this tool (H17 spec: not required); check docs/ops/go-live manually if unsure",
    )


# ── (c) env_drift ────────────────────────────────────────────────────────


def verdict_env_drift(failures: list[tuple[str, str]]) -> CheckItem:
    if failures:
        names = sorted({n for n, _ in failures})
        return CheckItem(
            "env_drift", "production env vars", "red",
            f"missing required production variable(s): {', '.join(names)} (see scripts/env_drift.py)",
        )
    return CheckItem("env_drift", "production env vars", "green", "no required production variable missing")


def run_env_drift(repo_root: Path, timeout: int) -> list[tuple[str, str]]:
    manifest = env_drift.parse_manifest(repo_root / "docs" / "ops" / "ENV.md")
    uat_actual = env_drift.read_env_file_names(repo_root / "backend" / ".env")
    railway_actual = {}
    for service in env_drift.RAILWAY_SERVICES:
        try:
            railway_actual[service] = env_drift.fetch_railway_names(service, timeout=timeout)
        except env_drift.RemoteError:
            railway_actual[service] = None
    rows = env_drift.build_backend_rows(manifest["backend"], uat_actual, railway_actual)
    return env_drift.required_production_failures(rows)


# ── (d) Railway deploy branch ────────────────────────────────────────────


def parse_railway_deployment_list(json_text: str) -> list[dict]:
    """`railway deployment list --service X --json` output, newest first.
    Tolerant of an empty list; raises on genuinely malformed JSON."""
    data = json.loads(json_text)
    if not isinstance(data, list):
        return []
    return data


def latest_deployment(deployments: list[dict]) -> Optional[dict]:
    return deployments[0] if deployments else None


def verdict_railway_branch(service: str, branch: Optional[str], confirmed: bool = False) -> CheckItem:
    key = f"railway_branch_{service}"
    label = f"Railway {service} deploy branch"
    if branch == "release":
        return CheckItem(key, label, "green", "deploys from release")
    if confirmed:
        branch_desc = branch if branch is not None else "an unknown branch"
        return CheckItem(
            key, label, "amber",
            f"latest deployment came from {branch_desc}; operator confirmed the service now deploys from "
            "release (dashboard), will be verified after the push",
        )
    if branch is None:
        return CheckItem(key, label, "amber", "could not determine latest deployment's branch")
    if branch == "main":
        return CheckItem(
            key, label, "red",
            f"Railway service {service} deploys from main: in the Railway dashboard open the service, "
            "Settings, Source, set Branch to release, then rerun check",
        )
    return CheckItem(key, label, "amber", f"deploys from unexpected branch {branch!r}")


def railway_deployment_matches(dep: Optional[dict], sha: Optional[str], require_release_branch: bool) -> bool:
    """True if `dep` (a Railway deployment dict, or None) counts as the
    release having landed on that service: SUCCESS, commitHash starting
    with `sha`, and, only when `require_release_branch` is set,
    meta.branch == "release". Without that requirement, a deployment at
    the right sha counts even if the service still nominally builds from
    `main` (the pre-branch-switch tolerance)."""
    if not dep:
        return False
    if dep.get("status") != "SUCCESS":
        return False
    meta = dep.get("meta") or {}
    commit = meta.get("commitHash", "")
    if not commit.startswith(sha or "\0"):
        return False
    if require_release_branch and meta.get("branch") != "release":
        return False
    return True


def railway_branch_mismatch_message(service: str, branch: Optional[str], pre_release_sha: Optional[str]) -> str:
    """The RED message printed when --railway-branch-confirmed was given but,
    after the push, a service's newest matching-sha deployment still isn't on
    release. Directs the operator straight at the rollback command."""
    branch_desc = branch or "main"
    return (
        f"Railway {service} did not deploy from release; it still builds from {branch_desc}. "
        f"Production backend is unchanged at {pre_release_sha}. Vercel HAS deployed the new frontend. "
        f"Roll back with: backend/.venv/bin/python scripts/release.py rollback {pre_release_sha}"
    )


def fetch_railway_latest_deployment(service: str, timeout: int) -> Optional[dict]:
    out = _run(
        ["railway", "deployment", "list", "--service", service, "--json"], timeout=timeout, cwd=REPO_ROOT
    )
    return latest_deployment(parse_railway_deployment_list(out))


# ── (e) Vercel production deployment age ─────────────────────────────────


_VERCEL_ROW_RE = re.compile(
    r"^(?P<age>\S+)\s+(?P<project>\S+)\s+(?P<url>https?://\S+)\s+"
    r"[^\w]*\s*(?P<status>Ready|Building|Error|Queued|Canceled)\s+"
    r"(?P<environment>\S+)\s+(?P<duration>\S+)\s+(?P<username>\S+)\s*$"
)


def parse_vercel_prod_list(text: str) -> list[dict]:
    """`vercel ls --prod` table output, newest first (as printed). Each
    row: age, project, url, status, environment, duration, username. Skips
    any line that doesn't match the full row shape (banners, blank lines,
    the header, the trailing bare-URL list)."""
    rows = []
    for line in text.splitlines():
        m = _VERCEL_ROW_RE.match(line.strip())
        if m:
            rows.append(m.groupdict())
    return rows


def verdict_vercel_age(rows: list[dict]) -> CheckItem:
    if not rows:
        return CheckItem("vercel_age", "Vercel production deployment", "amber", "no production deployment found")
    top = rows[0]
    return CheckItem(
        "vercel_age", "Vercel production deployment", "green",
        f"latest is {top['age']} old, status {top['status']} ({top['url']})",
    )


def fetch_vercel_prod_rows(workdir: Path, timeout: int) -> list[dict]:
    out = _run(["vercel", "ls", "--prod"], timeout=timeout, cwd=workdir)
    return parse_vercel_prod_list(out)


# ── (f) DNS ──────────────────────────────────────────────────────────────


def verdict_dns(resolved: bool) -> CheckItem:
    if resolved:
        return CheckItem("dns", f"DNS for {PROD_API_HOST}", "green", "resolves")
    return CheckItem(
        "dns", f"DNS for {PROD_API_HOST}", "amber",
        "A18: no DNS record, prod reachable only via the Vercel /api rewrite",
    )


def dns_resolves(host: str, timeout: int = HTTP_TIMEOUT) -> bool:
    socket.setdefaulttimeout(timeout)
    try:
        socket.gethostbyname(host)
        return True
    except OSError:
        return False
    finally:
        socket.setdefaulttimeout(None)


# ── (g) baseline health ──────────────────────────────────────────────────


def http_status(url: str, timeout: int = HTTP_TIMEOUT) -> Optional[int]:
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except Exception:
        return None


def verdict_health(status: Optional[int]) -> CheckItem:
    if status == 200:
        return CheckItem("health", "baseline prod health", "green", "/api/health is 200 right now")
    return CheckItem("health", "baseline prod health", "red", f"/api/health returned {status!r}, expected 200")


# ── (h) release ancestor of main ─────────────────────────────────────────


def verdict_release_ancestor(exists: bool, is_ancestor: Optional[bool]) -> CheckItem:
    if not exists:
        return CheckItem(
            "ancestor", "release is an ancestor of main", "amber",
            "origin/release doesn't exist yet, deploy will create it",
        )
    if is_ancestor:
        return CheckItem("ancestor", "release is an ancestor of main", "green", "origin/release is behind or at main")
    return CheckItem(
        "ancestor", "release is an ancestor of main", "red",
        "origin/release has commits not on main; refusing to fast-forward over them (never force)",
    )


def release_ancestor_state(repo_root: Path, timeout: int) -> tuple[bool, Optional[bool]]:
    ok, _ = _run_ok(["git", "rev-parse", "--verify", "origin/release"], timeout=timeout, cwd=repo_root)
    if not ok:
        return False, None
    ok2, _ = _run_ok(
        ["git", "merge-base", "--is-ancestor", "origin/release", "origin/main"], timeout=timeout, cwd=repo_root
    )
    return True, ok2


# ── (i) MCP flag absent in production ────────────────────────────────────


def verdict_mcp_flag(railway_present: dict, vercel_present: Optional[bool]) -> CheckItem:
    offenders = [s for s, present in railway_present.items() if present]
    if vercel_present:
        offenders.append("vercel")
    if offenders:
        return CheckItem(
            "mcp_flag", "MCP connector stays absent in prod", "red",
            f"{MCP_RAILWAY_VAR}/{MCP_VERCEL_VAR} set on: {', '.join(offenders)}; "
            "the connector must stay absent in production until F7 lands",
        )
    return CheckItem("mcp_flag", "MCP connector stays absent in prod", "green", "absent everywhere, as required")


# ── check orchestration ──────────────────────────────────────────────────


def run_check(
    repo_root: Path = REPO_ROOT,
    allow_worktree: bool = False,
    timeout: int = REMOTE_TIMEOUT,
    railway_branch_confirmed: bool = False,
) -> list[CheckItem]:
    items: list[CheckItem] = []

    cwd_ok = allow_worktree or (Path.cwd() == repo_root)
    branch, clean, local_sha, remote_sha = git_repo_state(repo_root, timeout)
    items.append(verdict_repo_state(cwd_ok, branch, clean, local_sha, remote_sha))

    items.append(verdict_backlog_skip())

    try:
        failures = run_env_drift(repo_root, timeout)
        items.append(verdict_env_drift(failures))
    except Exception as exc:  # noqa: BLE001 - surface any failure as a red check row, not a crash
        items.append(CheckItem("env_drift", "production env vars", "red", f"env_drift failed: {exc}"))

    for service in RAILWAY_SERVICES:
        try:
            dep = fetch_railway_latest_deployment(service, timeout)
            branch_name = (dep or {}).get("meta", {}).get("branch")
        except RemoteError as exc:
            if railway_branch_confirmed:
                items.append(CheckItem(
                    f"railway_branch_{service}", f"Railway {service} deploy branch", "amber",
                    f"latest deployment came from an unknown branch (Railway CLI error: {exc}); operator "
                    "confirmed the service now deploys from release (dashboard), will be verified after the push",
                ))
            else:
                items.append(CheckItem(f"railway_branch_{service}", f"Railway {service} deploy branch", "amber", str(exc)))
            continue
        items.append(verdict_railway_branch(service, branch_name, confirmed=railway_branch_confirmed))

    try:
        workdir = link_vercel(timeout)
        rows = fetch_vercel_prod_rows(workdir, timeout)
        items.append(verdict_vercel_age(rows))
    except RemoteError as exc:
        items.append(CheckItem("vercel_age", "Vercel production deployment", "amber", str(exc)))

    items.append(verdict_dns(dns_resolves(PROD_API_HOST)))
    items.append(verdict_health(http_status(f"{PROD_WEB_URL}/api/health")))

    exists, is_ancestor = release_ancestor_state(repo_root, timeout)
    items.append(verdict_release_ancestor(exists, is_ancestor))

    railway_mcp_present = {}
    for service in RAILWAY_SERVICES:
        try:
            names = env_drift.fetch_railway_names(service, timeout=timeout)
            railway_mcp_present[service] = MCP_RAILWAY_VAR in names
        except env_drift.RemoteError:
            railway_mcp_present[service] = False
    vercel_mcp_present = None
    try:
        workdir = link_vercel(timeout)
        vercel_names = env_drift.fetch_vercel_names("production", workdir, timeout=timeout)
        vercel_mcp_present = MCP_VERCEL_VAR in vercel_names
    except env_drift.RemoteError:
        vercel_mcp_present = False
    items.append(verdict_mcp_flag(railway_mcp_present, vercel_mcp_present))

    return items


def link_vercel(timeout: int = REMOTE_TIMEOUT) -> Path:
    """Link a scratch directory to the Vercel project, never `frontend/`."""
    workdir = Path(tempfile.mkdtemp(prefix="release_vlink_"))
    _run(["vercel", "link", "--yes", "--project", VERCEL_PROJECT], timeout=timeout, cwd=workdir)
    return workdir


# ── sync-vars ────────────────────────────────────────────────────────────


def extract_env_value(text: str, name: str) -> Optional[str]:
    """The value of `name` from `.env`-style text (last definition wins,
    matching normal shell/dotenv semantics), stripping one layer of
    matching quotes. None if not defined."""
    value = None
    pattern = re.compile(rf"^(?:export\s+)?{re.escape(name)}\s*=(.*)$")
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = pattern.match(s)
        if m:
            v = m.group(1).strip()
            if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            value = v
    return value


def resolve_sync_value(name: str, env_path: Path) -> Optional[str]:
    special = SPECIAL_FILE_SOURCES.get(name)
    if special is not None:
        return special.read_text() if special.exists() else None
    if not env_path.exists():
        return None
    return extract_env_value(env_path.read_text(), name)


def build_railway_set_args(name: str, value: str, service: str, skip_deploys: bool = True) -> list[str]:
    """Argv for `railway variable set`: the value travels as one argv
    element (`KEY=VALUE`), never through a shell string, and this function
    never logs or prints it."""
    cmd = ["railway", "variable", "set", f"{name}={value}", "--service", service]
    if skip_deploys:
        cmd.append("--skip-deploys")
    return cmd


Runner = Callable[..., str]


def sync_vars(
    names: list[str],
    env_path: Path,
    value_pairs: list[str],
    generate_names: list[str],
    services: list[str] = RAILWAY_SERVICES,
    runner: Runner = _run,
    timeout: int = REMOTE_TIMEOUT,
) -> tuple[int, list[str], list[str]]:
    """Resolve every requested name to a value and set it on every
    service. Returns (exit_code, names_set, error_messages). Never
    returns or logs a value; `runner` is injectable so tests never touch
    the real Railway CLI."""
    pairs: dict[str, str] = {}
    errors: list[str] = []

    for name in names:
        name = name.strip()
        if not name:
            continue
        val = resolve_sync_value(name, env_path)
        if val is None:
            errors.append(f"no value found for {name} (checked {env_path} / its special-cased file)")
        else:
            pairs[name] = val

    for kv in value_pairs:
        name, sep, val = kv.partition("=")
        if not sep:
            errors.append(f"--value must be NAME=VALUE, got {kv!r}")
            continue
        pairs[name.strip()] = val

    for name in generate_names:
        pairs[name.strip()] = secrets.token_urlsafe(32)

    if errors:
        return 1, [], errors

    if not pairs:
        return 1, [], ["nothing to set"]

    set_names: list[str] = []
    for name, value in pairs.items():
        for service in services:
            cmd = build_railway_set_args(name, value, service)
            try:
                runner(cmd, timeout=timeout, cwd=REPO_ROOT)
            except RemoteError as exc:
                errors.append(f"{name} on {service}: {exc}")
        set_names.append(name)

    return (1 if errors else 0), set_names, errors


# ── smoke checks ─────────────────────────────────────────────────────────


@dataclass
class SmokeCheck:
    name: str
    url: str
    expected: str
    actual: str = ""
    passed: bool = False


def format_smoke_table(checks: list[SmokeCheck]) -> str:
    headers = ["check", "url", "expected", "actual", "result"]
    rows = [
        [c.name, c.url, c.expected, c.actual, "PASS" if c.passed else "FAIL"] for c in checks
    ]
    widths = [max(len(h), *(len(r[i]) for r in rows)) if rows else len(h) for i, h in enumerate(headers)]
    lines = ["  ".join(h.ljust(w) for h, w in zip(headers, widths))]
    lines.append("  ".join("-" * w for w in widths))
    for r in rows:
        lines.append("  ".join(c.ljust(w) for c, w in zip(r, widths)))
    return "\n".join(lines)


def run_smoke_checks(base_url: str = PROD_WEB_URL, timeout: int = HTTP_TIMEOUT) -> list[SmokeCheck]:
    checks: list[SmokeCheck] = []

    def add(name: str, path: str, expected_codes: set[int], expected_label: str) -> None:
        url = f"{base_url}{path}"
        status = http_status(url, timeout=timeout)
        passed = status in expected_codes
        checks.append(SmokeCheck(name, url, expected_label, str(status), passed))

    add("health", "/api/health", {200}, "200")
    add("subscription (auth required)", "/api/subscription", {401}, "401")
    # F2/F11/F12: the auth middleware (app/core/auth.py) runs BEFORE
    # routing and returns 401 for any path that isn't on its open list,
    # whether or not a route exists behind it, so a bare 404 from /api/mcp
    # is unreachable and can never prove the connector is absent (an
    # unauthenticated hit on any made-up /api/* path also gets 401). The
    # connector's own unauthenticated discovery endpoint is only added to
    # that open list when MCP_CONNECTOR_ENABLED is true, so it is the one
    # signal that actually distinguishes "connector present" from
    # "connector absent": 401 (gated, or 404 if even further unreachable)
    # means absent as required; 200 means it is mounted and its OAuth
    # metadata is being served to anyone, which is the failure case here.
    add(
        "mcp connector not publicly discoverable",
        "/api/.well-known/oauth-authorization-server",
        {401, 404},
        "401 or 404 (200 would mean the connector is mounted and its OAuth discovery document is publicly served, i.e. NOT absent)",
    )
    add("accounts (auth required)", "/api/accounts", {401}, "401")

    homepage_status = http_status(base_url, timeout=timeout)
    homepage_ok = homepage_status == 200
    homepage_has_title = False
    if homepage_ok:
        try:
            with urllib.request.urlopen(base_url, timeout=timeout) as resp:
                body = resp.read(20000).decode("utf-8", errors="ignore")
                homepage_has_title = "<title>" in body.lower()
        except Exception:
            homepage_has_title = False
    checks.append(
        SmokeCheck(
            "homepage",
            base_url,
            "200 with <title>",
            f"{homepage_status}{' +title' if homepage_has_title else ''}",
            homepage_ok and homepage_has_title,
        )
    )

    add("terms", "/terms", {200}, "200")
    add("privacy", "/privacy", {200}, "200")
    return checks


# ── git helpers for deploy/rollback ──────────────────────────────────────


def git_rev_parse(repo_root: Path, ref: str, timeout: int) -> Optional[str]:
    ok, out = _run_ok(["git", "rev-parse", ref], timeout=timeout, cwd=repo_root)
    return out.strip() if ok else None


def is_ancestor(repo_root: Path, ancestor: str, descendant: str, timeout: int) -> bool:
    ok, _ = _run_ok(["git", "merge-base", "--is-ancestor", ancestor, descendant], timeout=timeout, cwd=repo_root)
    return ok


def is_tag_from_this_tool(repo_root: Path, ref: str, timeout: int) -> bool:
    ok, out = _run_ok(["git", "tag", "--list", ref], timeout=timeout, cwd=repo_root)
    return ok and ref in out.split()


def utc_release_tag(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    return now.strftime("release-%Y%m%d-%H%M")


# ── Codemagic release trigger ─────────────────────────────────────────────

# (app_id, api_token, payload) -> (http_status, response_body). Injectable so
# tests never make a real HTTP call.
CodemagicPoster = Callable[[str, str, dict], tuple[int, str]]


def _codemagic_post(url: str, api_token: str, payload: dict, timeout: int) -> tuple[int, str]:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-auth-token": api_token},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode("utf-8", errors="ignore")


def trigger_codemagic_prod_build(
    app_id: Optional[str],
    api_token: Optional[str],
    branch: str = CODEMAGIC_PROD_BRANCH,
    workflow_id: str = CODEMAGIC_PROD_WORKFLOW,
    dry_run: bool = False,
    timeout: int = HTTP_TIMEOUT,
    poster: Optional[Callable[[str, dict], tuple[int, str]]] = None,
) -> tuple[bool, str]:
    """Best-effort trigger of the production TestFlight workflow after a
    successful release. Never raises: `ok=False` means "warn, don't fail the
    deploy" to the caller, it never means the deploy itself failed. `poster`
    (if given) is called as `poster(url, payload) -> (status, body)`, so
    tests never need a real api_token or network access; the default POSTs
    to the real Codemagic API with `api_token`.
    """
    if not app_id or not api_token:
        return False, (
            "CODEMAGIC_API_TOKEN and/or CODEMAGIC_APP_ID not set, skipping the "
            f"Codemagic {workflow_id} trigger (start it by hand from the Codemagic UI)"
        )

    payload = {"appId": app_id, "workflowId": workflow_id, "branch": branch}

    if dry_run:
        return True, f"[dry-run] would POST {CODEMAGIC_API_URL} {json.dumps(payload)}"

    try:
        if poster is not None:
            status, body = poster(CODEMAGIC_API_URL, payload)
        else:
            status, body = _codemagic_post(CODEMAGIC_API_URL, api_token, payload, timeout)
    except Exception as exc:  # noqa: BLE001 - a trigger failure must never fail the deploy
        return False, f"Codemagic {workflow_id} trigger failed: {exc}"

    if status not in (200, 201):
        return False, f"Codemagic {workflow_id} trigger returned HTTP {status}: {body[:200]}"

    build_id = "?"
    try:
        data = json.loads(body)
        build_id = data.get("buildId") or data.get("_id") or "?"
    except Exception:  # noqa: BLE001 - a malformed response body still isn't a deploy failure
        pass
    return True, f"Codemagic {workflow_id} build triggered on {branch}: build id {build_id}"


# ── deploy ───────────────────────────────────────────────────────────────


def cmd_check(args: argparse.Namespace) -> int:
    items = run_check(
        REPO_ROOT, allow_worktree=args.allow_worktree, timeout=args.timeout,
        railway_branch_confirmed=args.railway_branch_confirmed,
    )
    print_check_table(items)
    return 1 if has_red(items) else 0


def cmd_sync_vars(args: argparse.Namespace) -> int:
    names = [n for n in (args.names.split(",") if args.names else []) if n.strip()]
    exit_code, set_names, errors = sync_vars(
        names,
        env_path=args.from_file,
        value_pairs=args.value or [],
        generate_names=args.generate or [],
        timeout=args.timeout,
    )
    if set_names:
        print(f"Set on Railway ({', '.join(RAILWAY_SERVICES)}): {', '.join(set_names)}")
    for err in errors:
        print(f"[error] {err}", file=sys.stderr)
    return exit_code


def cmd_deploy(args: argparse.Namespace) -> int:
    if args.dry_run:
        # A dry-run mutates nothing, so it may run from a worktree, but
        # only when explicitly allowed; without the flag it holds to the
        # same shared-tree requirement as a real deploy.
        if not (args.allow_worktree or Path.cwd() == REPO_ROOT):
            print(f"deploy --dry-run must run from {REPO_ROOT}, or pass --allow-worktree", file=sys.stderr)
            return 1
    elif Path.cwd() != REPO_ROOT:
        # A real deploy always refuses outside the shared tree, no override.
        print(f"deploy must run from {REPO_ROOT} (the shared tree), refusing", file=sys.stderr)
        return 1

    print("Running preconditions (scripts/release.py check)...")
    items = run_check(
        REPO_ROOT, allow_worktree=args.allow_worktree, timeout=args.timeout,
        railway_branch_confirmed=args.railway_branch_confirmed,
    )
    print_check_table(items)
    if has_red(items):
        print("\nA check item is red, aborting.", file=sys.stderr)
        return 1

    pre_release_sha = git_rev_parse(REPO_ROOT, "origin/release", timeout=args.timeout)
    main_sha = git_rev_parse(REPO_ROOT, "origin/main", timeout=args.timeout)
    pre_railway = {}
    for service in RAILWAY_SERVICES:
        try:
            pre_railway[service] = fetch_railway_latest_deployment(service, args.timeout)
        except RemoteError:
            pre_railway[service] = None

    print(f"\nPrevious release sha: {pre_release_sha}")
    print(f"main sha to release:  {main_sha}")
    for service, dep in pre_railway.items():
        commit = ((dep or {}).get("meta") or {}).get("commitHash", "?")
        status = (dep or {}).get("status", "?")
        print(f"Railway {service} before: {status} at {commit[:8] if commit != '?' else commit}")

    if not is_ancestor(REPO_ROOT, "origin/release", "origin/main", args.timeout) and pre_release_sha:
        print("\norigin/release is not an ancestor of origin/main, refusing to push (never force).", file=sys.stderr)
        return 1

    if args.dry_run:
        print("\n[dry-run] would run: git push origin main:release")
        print("[dry-run] would poll Vercel (up to 15 minutes) for a Ready production deployment newer than the push")
        if args.railway_branch_confirmed:
            print("[dry-run] would poll Railway (both services) until latest deployment is SUCCESS at "
                  f"{main_sha[:8] if main_sha else '?'} AND meta.branch == release (operator-confirmed dashboard "
                  "switch); would verify Railway deployments carry branch=release")
        else:
            print("[dry-run] would poll Railway (both services) until latest deployment is SUCCESS at "
                  f"{main_sha[:8] if main_sha else '?'} (or, if still deploying from main, treat the current "
                  "SUCCESS deployment at that sha as done)")
        print("[dry-run] would run smoke checks: /api/health (200), /api/subscription (401), "
              "/api/.well-known/oauth-authorization-server (401 or 404, connector must not be publicly "
              "discoverable), /api/accounts (401), homepage (200 + <title>), /terms (200), /privacy (200)")
        print(f"[dry-run] would tag {utc_release_tag()} on {main_sha}, push it, and print the summary")
        _, codemagic_msg = trigger_codemagic_prod_build(
            os.environ.get("CODEMAGIC_APP_ID"), os.environ.get("CODEMAGIC_API_TOKEN"),
            dry_run=True, timeout=args.timeout,
        )
        print(f"[dry-run] {codemagic_msg}")
        return 0

    push_time = time.time()
    _run(["git", "push", "origin", "main:release"], timeout=args.timeout, cwd=REPO_ROOT)
    print("\nPushed main -> release. Polling Vercel and Railway (up to 15 minutes)...")

    deadline = time.time() + DEPLOY_POLL_TIMEOUT_S
    vercel_ready = False
    rows: list[dict] = []
    while time.time() < deadline and not vercel_ready:
        try:
            workdir = link_vercel(args.timeout)
            rows = fetch_vercel_prod_rows(workdir, args.timeout)
            if rows and rows[0]["status"] == "Ready":
                vercel_ready = True
        except RemoteError:
            pass
        if not vercel_ready:
            time.sleep(DEPLOY_POLL_INTERVAL_S)
    if not vercel_ready:
        print("Vercel did not show a Ready production deployment within 15 minutes.", file=sys.stderr)
        return 1

    railway_done = {s: False for s in RAILWAY_SERVICES}
    railway_last_branch: dict[str, Optional[str]] = {s: None for s in RAILWAY_SERVICES}
    while time.time() < deadline and not all(railway_done.values()):
        for service in RAILWAY_SERVICES:
            if railway_done[service]:
                continue
            try:
                dep = fetch_railway_latest_deployment(service, args.timeout)
            except RemoteError:
                continue
            if dep:
                railway_last_branch[service] = (dep.get("meta") or {}).get("branch")
            if railway_deployment_matches(dep, main_sha, require_release_branch=args.railway_branch_confirmed):
                railway_done[service] = True
        if not all(railway_done.values()):
            time.sleep(DEPLOY_POLL_INTERVAL_S)
    if not all(railway_done.values()):
        pending = [s for s, ok in railway_done.items() if not ok]
        if args.railway_branch_confirmed:
            for service in pending:
                print(railway_branch_mismatch_message(service, railway_last_branch.get(service), pre_release_sha), file=sys.stderr)
        else:
            # Without confirmation we cannot tell a same-sha `main` deployment
            # (branch switch not done, or still propagating) from a genuine
            # `release` deploy, so we keep the pre-existing commit-only
            # tolerance and this generic message as the default behaviour.
            print(f"Railway service(s) not at the released sha within 15 minutes: {', '.join(pending)}", file=sys.stderr)
        return 1

    smoke = run_smoke_checks()
    print("\nSmoke checks:")
    print(format_smoke_table(smoke))
    if any(not c.passed for c in smoke):
        print("\nOne or more smoke checks failed after deploy.", file=sys.stderr)
        return 1

    tag = utc_release_tag()
    _run(["git", "tag", tag, main_sha], timeout=args.timeout, cwd=REPO_ROOT)
    _run(["git", "push", "origin", tag], timeout=args.timeout, cwd=REPO_ROOT)

    # Best-effort: never fail the deploy if this doesn't work, the release
    # has already fully landed by this point. See docs/ops/ENV.md's
    # "Release tooling" section and DEPLOY.md's "Release trigger".
    codemagic_ok, codemagic_msg = trigger_codemagic_prod_build(
        os.environ.get("CODEMAGIC_APP_ID"), os.environ.get("CODEMAGIC_API_TOKEN"), timeout=args.timeout,
    )
    if codemagic_ok:
        print(f"\n{codemagic_msg}")
    else:
        print(f"\n[warn] {codemagic_msg}", file=sys.stderr)

    print("\nDeploy summary:")
    print(f"  tag: {tag}")
    print(f"  sha: {main_sha}")
    print(f"  previous release sha: {pre_release_sha}")
    if rows:
        print(f"  Vercel deployment: {rows[0]['url']} ({rows[0]['age']} -> now Ready)")
    for service in RAILWAY_SERVICES:
        print(f"  Railway {service}: deployed at {main_sha[:8] if main_sha else '?'}")
    print(f"  push time: {datetime.fromtimestamp(push_time, tz=timezone.utc).isoformat()}")
    print(f"  Codemagic {CODEMAGIC_PROD_WORKFLOW} trigger: {codemagic_msg}")
    return 0


def cmd_rollback(args: argparse.Namespace) -> int:
    if not args.allow_worktree and Path.cwd() != REPO_ROOT:
        print(f"rollback must run from {REPO_ROOT} (the shared tree), refusing", file=sys.stderr)
        return 1

    target = args.target
    ok, out = _run_ok(["git", "rev-parse", "--verify", target], timeout=args.timeout, cwd=REPO_ROOT)
    if not ok:
        print(f"{target!r} does not resolve to a commit: {out}", file=sys.stderr)
        return 1
    sha = out.strip()

    is_our_tag = is_tag_from_this_tool(REPO_ROOT, target, args.timeout) or bool(
        re.match(r"^release-\d{8}-\d{4}$", target)
    )
    ancestor_ok = is_ancestor(REPO_ROOT, sha, "origin/main", args.timeout)
    if not (is_our_tag or ancestor_ok):
        print(
            f"{target!r} ({sha[:8]}) is neither a release-* tag nor an ancestor of main; refusing.",
            file=sys.stderr,
        )
        return 1

    print(f"Rolling release back to {target} ({sha[:8]})...")
    _run(["git", "push", "--force-with-lease", "origin", f"{sha}:release"], timeout=args.timeout, cwd=REPO_ROOT)

    print("Polling Vercel and Railway (up to 15 minutes)...")
    deadline = time.time() + DEPLOY_POLL_TIMEOUT_S
    vercel_ready = False
    rows: list[dict] = []
    while time.time() < deadline and not vercel_ready:
        try:
            workdir = link_vercel(args.timeout)
            rows = fetch_vercel_prod_rows(workdir, args.timeout)
            if rows and rows[0]["status"] == "Ready":
                vercel_ready = True
        except RemoteError:
            pass
        if not vercel_ready:
            time.sleep(DEPLOY_POLL_INTERVAL_S)

    railway_done = {s: False for s in RAILWAY_SERVICES}
    while time.time() < deadline and not all(railway_done.values()):
        for service in RAILWAY_SERVICES:
            if railway_done[service]:
                continue
            try:
                dep = fetch_railway_latest_deployment(service, args.timeout)
            except RemoteError:
                continue
            if not dep:
                continue
            commit = (dep.get("meta") or {}).get("commitHash", "")
            if dep.get("status") == "SUCCESS" and commit.startswith(sha):
                railway_done[service] = True
        if not all(railway_done.values()):
            time.sleep(DEPLOY_POLL_INTERVAL_S)

    smoke = run_smoke_checks()
    print("\nSmoke checks:")
    print(format_smoke_table(smoke))
    if not vercel_ready or not all(railway_done.values()) or any(not c.passed for c in smoke):
        print("\nRollback did not fully verify within the poll window.", file=sys.stderr)
        return 1
    print(f"\nRolled back to {sha}.")
    return 0


# ── CLI ──────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Production release tool. See docs/ops/RELEASE.md.")
    parser.add_argument("--timeout", type=int, default=REMOTE_TIMEOUT, help="Timeout (seconds) per remote call.")
    parser.add_argument("--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p_check = sub.add_parser("check", help="Run every precondition, print a red/amber/green table.")
    p_check.add_argument("--allow-worktree", action="store_true", help="Allow running from a worktree, not just the shared tree.")
    p_check.add_argument(
        "--railway-branch-confirmed", action="store_true",
        help="Downgrade the two Railway deploy-branch check items to AMBER; the operator is asserting both "
        "services were switched to release in the Railway dashboard. deploy then verifies it for real after "
        "the push.",
    )
    p_check.set_defaults(func=cmd_check)

    p_sync = sub.add_parser("sync-vars", help="Set one or more variables on both Railway services.")
    p_sync.add_argument("names", nargs="?", default="", help="Comma-separated variable names to read from --from.")
    p_sync.add_argument("--from", dest="from_file", type=Path, default=REPO_ROOT / "backend" / ".env")
    p_sync.add_argument("--value", action="append", default=[], help="NAME=VALUE, for a fresh value not read from a file.")
    p_sync.add_argument("--generate", action="append", default=[], help="NAME to generate a fresh 32-byte urlsafe token for.")
    p_sync.set_defaults(func=cmd_sync_vars)

    p_deploy = sub.add_parser("deploy", help="Check, then fast-forward release, poll, smoke-check, tag.")
    p_deploy.add_argument("--dry-run", action="store_true")
    p_deploy.add_argument("--allow-worktree", action="store_true", help="Allow check-only parts to run from a worktree (dry-run only; a real deploy always refuses outside the shared tree).")
    p_deploy.add_argument(
        "--railway-branch-confirmed", action="store_true",
        help="Downgrade the two Railway deploy-branch check items to AMBER; the operator is asserting both "
        "services were switched to release in the Railway dashboard. deploy then verifies it for real after "
        "the push.",
    )
    p_deploy.set_defaults(func=cmd_deploy)

    p_rollback = sub.add_parser("rollback", help="Force-with-lease release back to a known-good tag or sha.")
    p_rollback.add_argument("target", help="A release-YYYYMMDD-HHMM tag, or a sha that is an ancestor of main.")
    p_rollback.add_argument("--allow-worktree", action="store_true")
    # Accepted here for CLI symmetry with check/deploy, but currently has no
    # effect: cmd_rollback never calls run_check, so there is no precondition
    # table for it to downgrade.
    p_rollback.add_argument(
        "--railway-branch-confirmed", action="store_true",
        help="Downgrade the two Railway deploy-branch check items to AMBER; the operator is asserting both "
        "services were switched to release in the Railway dashboard. deploy then verifies it for real after "
        "the push.",
    )
    p_rollback.set_defaults(func=cmd_rollback)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
