#!/usr/bin/env python3
"""Diff docs/ops/ENV.md's environment-variable manifest against what UAT
(backend/.env, frontend/.env.local), Railway (both services) and Vercel
actually have, by name only.

This script never reads or prints a variable's *value*: every collector
below discards the right-hand side of a `KEY=value` line the moment it has
extracted the name, and the printed table never contains a `=`.

Run from the shared tree with its venv:

    backend/.venv/bin/python scripts/env_drift.py
    backend/.venv/bin/python scripts/env_drift.py --json
    backend/.venv/bin/python scripts/env_drift.py --no-remote   # offline / tests

See docs/ops/ENV.md for what each variable is for and why it's expected
present/absent/optional in each environment.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

REPO_ROOT = Path("/root/ai-wealth-dashboard")
DEFAULT_MANIFEST = REPO_ROOT / "docs" / "ops" / "ENV.md"
DEFAULT_UAT_BACKEND_ENV = REPO_ROOT / "backend" / ".env"
DEFAULT_UAT_FRONTEND_ENV = REPO_ROOT / "frontend" / ".env.local"
RAILWAY_SERVICES = ["ai-wealth-dashboard", "worker"]
RAILWAY_SHORT_NAME = {"ai-wealth-dashboard": "web", "worker": "worker"}
VERCEL_PROJECT = "ai-wealth-dashboard"
REMOTE_TIMEOUT = 30

PRESENCE_RE = re.compile(r"^\**\s*(present|absent|optional)\b", re.IGNORECASE)
NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")


# ── Manifest (docs/ops/ENV.md) parsing ──────────────────────────────────────


@dataclass
class ManifestVar:
    name: str
    read_in: str
    uat_expected: str  # "present" | "absent" | "optional"
    prod_expected: str
    notes: str = ""


def parse_markdown_tables(text: str) -> list[tuple[list[str], list[list[str]]]]:
    """Small tolerant pipe-table parser. Returns a list of (headers, rows)
    for every markdown table in `text`, in document order.

    A "table" is any line starting with `|` immediately followed by a
    `|---|---|`-style separator line (dashes/colons/pipes only). Every
    subsequent line starting with `|` is a data row; the table ends at the
    first line after that which doesn't start with `|` (or end of text).
    Cell counts aren't required to match the header, short rows just
    leave later columns unavailable to the caller.
    """
    lines = text.splitlines()
    tables: list[tuple[list[str], list[list[str]]]] = []
    sep_re = re.compile(r"^\s*\|?[\s:|-]+\|?\s*$")
    n = len(lines)
    i = 0

    def split_row(line: str) -> list[str]:
        s = line.strip()
        if s.startswith("|"):
            s = s[1:]
        if s.endswith("|"):
            s = s[:-1]
        return [c.strip() for c in s.split("|")]

    while i < n:
        line = lines[i]
        if (
            line.strip().startswith("|")
            and i + 1 < n
            and sep_re.match(lines[i + 1])
            and "-" in lines[i + 1]
        ):
            headers = split_row(line)
            rows: list[list[str]] = []
            j = i + 2
            while j < n and lines[j].strip().startswith("|"):
                rows.append(split_row(lines[j]))
                j += 1
            tables.append((headers, rows))
            i = j
        else:
            i += 1
    return tables


def _col_index(headers: list[str], *needles: str) -> Optional[int]:
    for idx, h in enumerate(headers):
        low = h.lower()
        if all(needle in low for needle in needles):
            return idx
    return None


def _clean_name(cell: str) -> str:
    return cell.strip().strip("`").strip()


def _presence(cell: str) -> str:
    m = PRESENCE_RE.match(cell.strip())
    return m.group(1).lower() if m else "optional"


def parse_manifest_section(text: str, section_keyword: str) -> list[ManifestVar]:
    """Parse every markdown table under the first `## <heading>` whose
    heading contains `section_keyword` (case-insensitive), stopping at the
    next `## ` heading (subheadings like `### ...` don't end the section,
    so a second table under the same `## ` heading, e.g. ENV.md's
    "legacy scripts" table under "## Backend", is included too).
    """
    lines = text.splitlines()
    start: Optional[int] = None
    end = len(lines)
    for idx, line in enumerate(lines):
        if line.startswith("## "):
            if start is None and section_keyword.lower() in line.lower():
                start = idx
            elif start is not None:
                end = idx
                break
    if start is None:
        return []
    section_text = "\n".join(lines[start:end])

    out: list[ManifestVar] = []
    for headers, rows in parse_markdown_tables(section_text):
        name_i = _col_index(headers, "variable")
        read_i = _col_index(headers, "read")
        uat_i = _col_index(headers, "uat")
        prod_i = _col_index(headers, "production")
        notes_i = _col_index(headers, "notes")
        if name_i is None or uat_i is None or prod_i is None:
            continue  # not a variable table
        for row in rows:
            if len(row) <= max(name_i, uat_i, prod_i):
                continue
            name = _clean_name(row[name_i])
            if not name or not NAME_RE.match(name):
                continue
            out.append(
                ManifestVar(
                    name=name,
                    read_in=row[read_i].strip() if read_i is not None and read_i < len(row) else "",
                    uat_expected=_presence(row[uat_i]),
                    prod_expected=_presence(row[prod_i]),
                    notes=row[notes_i].strip() if notes_i is not None and notes_i < len(row) else "",
                )
            )
    return out


def parse_manifest(path: Path = DEFAULT_MANIFEST) -> dict[str, list[ManifestVar]]:
    text = path.read_text(encoding="utf-8")
    return parse_manifest_text(text)


def parse_manifest_text(text: str) -> dict[str, list[ManifestVar]]:
    return {
        "backend": parse_manifest_section(text, "Backend"),
        "frontend": parse_manifest_section(text, "Frontend"),
    }


# ── Actual-state collectors (each takes raw text, so each is independently
#    unit-testable with a fixture; the CLI-calling wrappers just fetch that
#    text and hand it to the parser). ─────────────────────────────────────


def parse_env_file_names(text: str) -> set[str]:
    """Names defined in a `.env`-style file: `KEY=value` per line, `#`
    comments and blank lines ignored, optional leading `export `. Only the
    name is ever kept.

    Matches only `UPPER_SNAKE_CASE` names (every real variable in this
    codebase is one, see docs/ops/ENV.md) so a multi-line PEM/JSON value
    stored with real embedded newlines can't have one of its own
    continuation lines mistaken for a `NAME=` line, see the longer
    explanation on `parse_railway_kv_names`."""
    names: set[str] = set()
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r"^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=", s)
        if m:
            names.add(m.group(1))
    return names


def read_env_file_names(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return parse_env_file_names(path.read_text(encoding="utf-8"))


def parse_railway_kv_names(text: str) -> set[str]:
    """Names from `railway variables --service X --kv` output (one
    `KEY=value` per line, in principle). Drops `RAILWAY_*`
    (platform-injected, not app config) and, like every collector here,
    keeps only the name.

    A multi-line value (a PEM stored with real newlines rather than
    `\\n`-escaped, e.g. `VAPID_PRIVATE_KEY`) puts its own continuation
    lines through this same per-line scan; a base64 continuation line
    that happens to end in `=` padding looks exactly like `NAME=` to a
    naive `[A-Za-z_][A-Za-z0-9_]*=` match, which would leak a fragment of
    the secret into the "name" column. Every real variable in this
    codebase is `UPPER_SNAKE_CASE` (see docs/ops/ENV.md), so requiring an
    all-uppercase match is what actually filters those out: PEM/base64
    body lines are mixed-case, real names never are.
    """
    names: set[str] = set()
    for line in text.splitlines():
        s = line.strip()
        m = re.match(r"^([A-Z][A-Z0-9_]*)=", s)
        if m:
            name = m.group(1)
            if not name.startswith("RAILWAY_"):
                names.add(name)
    return names


def parse_vercel_env_ls(text: str) -> set[str]:
    """Names from `vercel env ls <target>` table output: the first column
    of each data row. Skips the header row, blank lines, CLI banner/hint
    lines and the "Common next commands" footer. Vercel's table shows
    `Encrypted`/`Plain` rather than the value itself, but this parser only
    ever looks at column 1 regardless. Requires the name to be
    `UPPER_SNAKE_CASE` (also filters out the lowercase `name` header row
    without a special case for it)."""
    names: set[str] = set()
    skip_prefixes = (
        "vercel cli",
        "retrieving",
        "environment variables found",
        "common next",
        "-",
        "`",
        ">",
        "no environment variables found",
    )
    for line in text.splitlines():
        s = line.strip()
        if not s or s.lower().startswith(skip_prefixes):
            continue
        m = re.match(r"^([A-Z][A-Z0-9_]*)\s+\S", s)
        if m:
            names.add(m.group(1))
    return names


class RemoteError(RuntimeError):
    pass


def _run(cmd: list[str], timeout: int = REMOTE_TIMEOUT, cwd: Optional[Path] = None) -> str:
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
        raise RemoteError(f"{' '.join(cmd)} exited {proc.returncode}: {proc.stdout.strip()[:300]}")
    return proc.stdout


def fetch_railway_names(service: str, timeout: int = REMOTE_TIMEOUT) -> set[str]:
    # The Railway CLI's project link is scoped to the directory it was run
    # from; only the shared tree (REPO_ROOT) is linked, worktrees aren't.
    # Always run from there regardless of this script's own cwd.
    out = _run(["railway", "variables", "--service", service, "--kv"], timeout=timeout, cwd=REPO_ROOT)
    return parse_railway_kv_names(out)


def link_vercel(timeout: int = REMOTE_TIMEOUT) -> Path:
    """Link a scratch directory to the Vercel project, never `frontend/`
    (frontend/.vercel must never exist, see CLAUDE.md). Returns the linked
    directory; caller is responsible for nothing further, the scratch dir
    lives under the system temp dir."""
    workdir = Path(tempfile.mkdtemp(prefix="env_drift_vlink_"))
    _run(["vercel", "link", "--yes", "--project", VERCEL_PROJECT], timeout=timeout, cwd=workdir)
    return workdir


def fetch_vercel_names(target: str, workdir: Path, timeout: int = REMOTE_TIMEOUT) -> set[str]:
    out = _run(["vercel", "env", "ls", target], timeout=timeout, cwd=workdir)
    return parse_vercel_env_ls(out)


# ── Diffing ──────────────────────────────────────────────────────────────


def verdict_for(expected: str, actual_present: Optional[bool]) -> str:
    """`actual_present` of None means "not checked" (--no-remote, or a
    remote fetch failed) -> always "ok", since we have nothing to compare
    against and shouldn't fail the run over infrastructure we skipped."""
    if actual_present is None:
        return "ok"
    if expected == "optional":
        return "ok"
    if expected == "present":
        return "ok" if actual_present else "missing"
    if expected == "absent":
        return "ok" if not actual_present else "unexpected"
    return "ok"


_VERDICT_PRIORITY = {"missing": 3, "unexpected": 2, "not-in-manifest": 1, "ok": 0}


def _worst(verdicts: list[str]) -> str:
    return max(verdicts, key=lambda v: _VERDICT_PRIORITY.get(v, 0)) if verdicts else "ok"


@dataclass
class DriftRow:
    name: str
    uat_expected: str
    uat_actual: Optional[bool]
    prod_expected: str
    prod_actual: dict  # service/target -> Optional[bool]
    verdict: str
    notes: str = ""


def build_backend_rows(
    manifest_vars: list[ManifestVar],
    uat_actual: set[str],
    railway_actual: Optional[dict],
) -> list[DriftRow]:
    rows: list[DriftRow] = []
    seen = set()
    for mv in manifest_vars:
        seen.add(mv.name)
        uat_present = mv.name in uat_actual
        prod_actual: dict = {}
        for service in RAILWAY_SERVICES:
            names = railway_actual.get(service) if railway_actual else None
            prod_actual[service] = (mv.name in names) if names is not None else None
        v_uat = verdict_for(mv.uat_expected, uat_present)
        v_prod = _worst([verdict_for(mv.prod_expected, prod_actual[s]) for s in RAILWAY_SERVICES])
        rows.append(
            DriftRow(
                name=mv.name,
                uat_expected=mv.uat_expected,
                uat_actual=uat_present,
                prod_expected=mv.prod_expected,
                prod_actual=prod_actual,
                verdict=_worst([v_uat, v_prod]),
                notes=mv.notes,
            )
        )
    extra = sorted(uat_actual - seen)
    if railway_actual:
        for service_names in railway_actual.values():
            if service_names is not None:
                extra += [n for n in sorted(service_names - seen) if n not in extra]
    for name in sorted(set(extra)):
        prod_actual = {}
        for service in RAILWAY_SERVICES:
            names = railway_actual.get(service) if railway_actual else None
            prod_actual[service] = (name in names) if names is not None else None
        rows.append(
            DriftRow(
                name=name,
                uat_expected="-",
                uat_actual=name in uat_actual,
                prod_expected="-",
                prod_actual=prod_actual,
                verdict="not-in-manifest",
                notes="present in an environment but not in docs/ops/ENV.md",
            )
        )
    return rows


def build_frontend_rows(
    manifest_vars: list[ManifestVar],
    uat_actual: set[str],
    vercel_actual: Optional[set[str]],
) -> list[DriftRow]:
    rows: list[DriftRow] = []
    seen = set()
    for mv in manifest_vars:
        seen.add(mv.name)
        uat_present = mv.name in uat_actual
        prod_present = (mv.name in vercel_actual) if vercel_actual is not None else None
        v_uat = verdict_for(mv.uat_expected, uat_present)
        v_prod = verdict_for(mv.prod_expected, prod_present)
        rows.append(
            DriftRow(
                name=mv.name,
                uat_expected=mv.uat_expected,
                uat_actual=uat_present,
                prod_expected=mv.prod_expected,
                prod_actual={"vercel": prod_present},
                verdict=_worst([v_uat, v_prod]),
                notes=mv.notes,
            )
        )
    extra = sorted(uat_actual - seen)
    if vercel_actual is not None:
        extra += [n for n in sorted(vercel_actual - seen) if n not in extra]
    for name in sorted(set(extra)):
        rows.append(
            DriftRow(
                name=name,
                uat_expected="-",
                uat_actual=name in uat_actual,
                prod_expected="-",
                prod_actual={"vercel": (name in vercel_actual) if vercel_actual is not None else None},
                verdict="not-in-manifest",
                notes="present in an environment but not in docs/ops/ENV.md",
            )
        )
    return rows


def required_production_failures(rows: list[DriftRow]) -> list[tuple[str, str]]:
    """(name, service) pairs where the manifest expects the variable
    present in production and it's actually missing on that Railway
    service. This is the sole exit-code-1 condition."""
    failures = []
    for row in rows:
        if row.prod_expected != "present":
            continue
        for service in RAILWAY_SERVICES:
            if row.prod_actual.get(service) is False:
                failures.append((row.name, service))
    return failures


# ── Output ───────────────────────────────────────────────────────────────


def _fmt_bool(v: Optional[bool]) -> str:
    if v is None:
        return "skipped"
    return "present" if v else "absent"


def _fmt_prod_actual_backend(row: DriftRow) -> str:
    parts = []
    for service in RAILWAY_SERVICES:
        short = RAILWAY_SHORT_NAME.get(service, service)
        parts.append(f"{short}={_fmt_bool(row.prod_actual.get(service))}")
    return " ".join(parts)


def _fmt_prod_actual_frontend(row: DriftRow) -> str:
    return _fmt_bool(row.prod_actual.get("vercel"))


def print_table(title: str, rows: list[DriftRow], prod_fmt) -> None:
    print(f"\n{title}")
    headers = ["variable", "expected uat", "actual uat", "expected prod", "actual prod", "verdict"]
    data = [
        [
            row.name,
            row.uat_expected,
            _fmt_bool(row.uat_actual),
            row.prod_expected,
            prod_fmt(row),
            row.verdict,
        ]
        for row in rows
    ]
    widths = [max(len(h), *(len(r[i]) for r in data)) if data else len(h) for i, h in enumerate(headers)]
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for r in data:
        print("  ".join(c.ljust(w) for c, w in zip(r, widths)))


def rows_to_json(rows: list[DriftRow]) -> list[dict]:
    out = []
    for row in rows:
        out.append(
            {
                "name": row.name,
                "expected_uat": row.uat_expected,
                "actual_uat": row.uat_actual,
                "expected_prod": row.prod_expected,
                "actual_prod": row.prod_actual,
                "verdict": row.verdict,
            }
        )
    return out


# ── CLI ──────────────────────────────────────────────────────────────────


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--uat-env", type=Path, default=DEFAULT_UAT_BACKEND_ENV,
        help="Path to the UAT backend/.env file (default: the shared tree's).",
    )
    parser.add_argument(
        "--uat-frontend-env", type=Path, default=DEFAULT_UAT_FRONTEND_ENV,
        help="Path to the UAT frontend/.env.local file (default: the shared tree's).",
    )
    parser.add_argument(
        "--no-remote", action="store_true",
        help="Skip Railway and Vercel CLI calls (offline / tests). No production var can then be flagged missing.",
    )
    parser.add_argument("--json", action="store_true", help="Machine-readable output instead of tables.")
    parser.add_argument("--timeout", type=int, default=REMOTE_TIMEOUT, help="Timeout (seconds) per Railway/Vercel call.")
    parser.add_argument("--verbose", action="store_true", help="Print remote-fetch warnings to stderr.")
    args = parser.parse_args(argv)

    manifest = parse_manifest(args.manifest)
    uat_backend_actual = read_env_file_names(args.uat_env)
    uat_frontend_actual = read_env_file_names(args.uat_frontend_env)

    railway_actual: Optional[dict] = None
    vercel_actual: Optional[set] = None
    remote_errors: list[str] = []

    if not args.no_remote:
        railway_actual = {}
        for service in RAILWAY_SERVICES:
            try:
                railway_actual[service] = fetch_railway_names(service, timeout=args.timeout)
            except RemoteError as exc:
                remote_errors.append(f"railway/{service}: {exc}")
                railway_actual[service] = None
        try:
            workdir = link_vercel(timeout=args.timeout)
            vercel_actual = fetch_vercel_names("production", workdir, timeout=args.timeout)
        except RemoteError as exc:
            remote_errors.append(f"vercel: {exc}")
            vercel_actual = None

    backend_rows = build_backend_rows(manifest["backend"], uat_backend_actual, railway_actual)
    frontend_rows = build_frontend_rows(manifest["frontend"], uat_frontend_actual, vercel_actual)

    failures = required_production_failures(backend_rows)
    exit_code = 1 if failures else 0

    if args.json:
        print(
            json.dumps(
                {
                    "backend": rows_to_json(backend_rows),
                    "frontend": rows_to_json(frontend_rows),
                    "required_production_failures": [
                        {"name": n, "service": s} for n, s in failures
                    ],
                    "remote_errors": remote_errors,
                },
                indent=2,
            )
        )
    else:
        print_table("Backend (Railway: ai-wealth-dashboard=web, worker=worker)", backend_rows, _fmt_prod_actual_backend)
        print_table("Frontend (Vercel production)", frontend_rows, _fmt_prod_actual_frontend)
        if failures:
            print("\nRequired production variables missing:")
            for name, service in failures:
                print(f"  {name} missing on Railway service {service}")
        if remote_errors:
            for e in remote_errors:
                print(f"[warn] {e}", file=sys.stderr)
        print(f"\nexit code: {exit_code}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
