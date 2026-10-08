#!/usr/bin/env python3
"""Read-only host memory report and gate (H95 / H99).

This VPS has about 12 GB and no swap. Concurrent `next build`s plus many
resident Claude sessions get the OOM killer involved, which silently kills
builds (integrate used to report an empty "frontend build failed") and, on
2026-09-28, the agent session itself. This script never kills anything.

    scripts/host_memory.py                       # available MB + largest processes
    scripts/host_memory.py --require 2500        # exit 1 if available < 2500 MB
    scripts/host_memory.py --stale-sessions 48   # list Claude sessions older than 48h

As a library: `available_mb()`, `require_available(mb, what)` (raises
`MemoryGateError` with a one-line reason) and `main()`.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Optional

PROC = Path("/proc")
CLK_TCK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
PAGE_KB = (os.sysconf("SC_PAGE_SIZE") // 1024) if hasattr(os, "sysconf") else 4

# Defaults shared with frontend_build.py, session.sh and integrate.py.
BUILD_REQUIRED_MB = 2500
SUITE_REQUIRED_MB = 1500


class MemoryGateError(RuntimeError):
    """Not enough available memory to start something heavy."""


def available_mb(meminfo: Path = PROC / "meminfo") -> int:
    """MemAvailable in MB (falls back to MemFree + Cached)."""
    vals: dict[str, int] = {}
    for line in meminfo.read_text().splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts:
            vals[key] = int(parts[0])
    kb = vals.get("MemAvailable")
    if kb is None:
        kb = vals.get("MemFree", 0) + vals.get("Cached", 0)
    return kb // 1024


def total_mb(meminfo: Path = PROC / "meminfo") -> int:
    for line in meminfo.read_text().splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) // 1024
    return 0


def require_available(required_mb: int, what: str = "this step", avail: Optional[int] = None) -> int:
    """Return available MB, or raise MemoryGateError with a clear reason."""
    avail = available_mb() if avail is None else avail
    if avail < required_mb:
        raise MemoryGateError(
            f"refusing to run {what}: {avail} MB available, need {required_mb} MB. "
            "Close stale Claude sessions (see `scripts/host_memory.py --stale-sessions 48` "
            "and docs/ops/HOST.md) or wait for another build or suite to finish."
        )
    return avail


def _uptime_s() -> float:
    return float((PROC / "uptime").read_text().split()[0])


def list_processes() -> list[dict]:
    """[{pid, name, cmdline, age_s, rss_mb}] for every readable process."""
    out = []
    up = _uptime_s()
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / "stat").read_text()
            # comm is parenthesised and may contain spaces
            lp, rp = stat.index("("), stat.rindex(")")
            name = stat[lp + 1:rp]
            fields = stat[rp + 2:].split()
            start_ticks = int(fields[19])
            rss_pages = int(fields[21])
            try:
                cmd = (entry / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="replace").strip()
            except OSError:
                cmd = ""
        except (OSError, ValueError, IndexError):
            continue
        out.append({
            "pid": int(entry.name),
            "name": name,
            "cmdline": cmd,
            "age_s": max(0.0, up - start_ticks / CLK_TCK),
            "rss_mb": rss_pages * PAGE_KB // 1024,
        })
    return out


def fmt_age(seconds: float) -> str:
    h = seconds / 3600
    return f"{h / 24:.1f}d" if h >= 48 else f"{h:.1f}h"


def is_claude_session(p: dict) -> bool:
    cmd = p["cmdline"]
    return p["pid"] != os.getpid() and ("/claude/versions/" in cmd or p["name"] == "claude")


def _print_table(rows: list[dict]) -> None:
    print(f"{'PID':>8}  {'RSS MB':>7}  {'AGE':>7}  NAME")
    for p in rows:
        print(f"{p['pid']:>8}  {p['rss_mb']:>7}  {fmt_age(p['age_s']):>7}  {p['name']}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Read-only host memory report; never kills anything.")
    ap.add_argument("--require", type=int, metavar="MB", help="exit 1 unless at least MB is available")
    ap.add_argument("--stale-sessions", type=float, metavar="HOURS",
                    help="list Claude session processes older than HOURS for review (never kills)")
    ap.add_argument("--top", type=int, default=12, help="how many largest processes to show (default 12)")
    args = ap.parse_args(argv)

    avail = available_mb()
    if args.require is not None:
        try:
            require_available(args.require, "this step", avail)
        except MemoryGateError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
        print(f"ok: {avail} MB available (need {args.require} MB)")
        return 0

    print(f"memory: {avail} MB available of {total_mb()} MB total")
    procs = list_processes()
    if args.stale_sessions is not None:
        cutoff = args.stale_sessions * 3600
        stale = sorted((p for p in procs if is_claude_session(p) and p["age_s"] > cutoff),
                       key=lambda p: -p["age_s"])
        total = sum(p["rss_mb"] for p in stale)
        print(f"Claude sessions older than {args.stale_sessions:g}h: {len(stale)} holding {total} MB")
        _print_table(stale)
        print("Nothing was killed. Review the list and close idle sessions yourself "
              "(the session you are in is excluded from this list only by pid, so check the ages).")
        return 0
    print(f"largest {args.top} processes by resident memory:")
    _print_table(sorted(procs, key=lambda p: -p["rss_mb"])[: args.top])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
