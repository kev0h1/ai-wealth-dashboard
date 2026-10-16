"""E6 slice 1: read-only host and build facts for /ops/health.

No secrets, no psutil: /proc, `os.getloadavg` and `shutil.disk_usage` only.
Every reader degrades to None on a platform without /proc rather than raising,
so the page shows a gap instead of failing.
"""
from __future__ import annotations

import os
import shutil
from urllib.parse import quote

from app.core.observability import resolve_environment, resolve_release


def _meminfo() -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="ascii") as fh:
            for line in fh:
                key, _, rest = line.partition(":")
                parts = rest.split()
                if parts and parts[0].isdigit():
                    out[key] = int(parts[0]) * 1024
    except OSError:
        pass
    return out


def memory() -> dict | None:
    info = _meminfo()
    total, avail = info.get("MemTotal"), info.get("MemAvailable")
    if not total or avail is None:
        return None
    used = total - avail
    return {
        "total_mb": round(total / 1048576),
        "available_mb": round(avail / 1048576),
        "used_pct": round(used / total * 100, 1),
    }


def disk(path: str = "/") -> dict | None:
    try:
        usage = shutil.disk_usage(path)
    except OSError:
        return None
    return {
        "total_gb": round(usage.total / 1073741824, 1),
        "free_gb": round(usage.free / 1073741824, 1),
        "used_pct": round(usage.used / usage.total * 100, 1) if usage.total else None,
    }


def load() -> dict | None:
    try:
        one, five, fifteen = os.getloadavg()
    except (OSError, AttributeError):
        return None
    return {"cpus": os.cpu_count() or 1, "load_1m": round(one, 2), "load_5m": round(five, 2), "load_15m": round(fifteen, 2)}


def uptime_hours() -> float | None:
    try:
        with open("/proc/uptime", encoding="ascii") as fh:
            return round(float(fh.read().split()[0]) / 3600, 1)
    except (OSError, ValueError, IndexError):
        return None


def sentry_links(env: dict | None = None) -> dict:
    """Issue-view links built from SENTRY_ORG and SENTRY_PROJECTS (comma
    separated project slugs). The DSN is never read here."""
    e = os.environ if env is None else env
    org = (e.get("SENTRY_ORG") or "").strip()
    environment = resolve_environment()
    if not org:
        return {"configured": False, "environment": environment, "links": []}
    slugs = [s.strip() for s in (e.get("SENTRY_PROJECTS") or "").split(",") if s.strip()]
    base = f"https://{quote(org, safe='')}.sentry.io/issues/"
    if not slugs:
        return {
            "configured": True,
            "environment": environment,
            "links": [{"label": "All issues", "url": f"{base}?environment={environment}&query=is%3Aunresolved"}],
        }
    return {
        "configured": True,
        "environment": environment,
        "links": [
            {
                "label": slug,
                "url": f"{base}?environment={environment}&query={quote('is:unresolved project:' + slug, safe='')}",
            }
            for slug in slugs
        ],
    }


def build_info() -> dict:
    release = resolve_release()
    return {
        "release": release,
        "release_short": release[:7] if release else None,
        "environment": resolve_environment(),
        "sentry_dsn_set": bool((os.getenv("SENTRY_DSN") or "").strip()),
    }


def snapshot() -> dict:
    return {
        "build": build_info(),
        "memory": memory(),
        "disk": disk(),
        "load": load(),
        "uptime_hours": uptime_hours(),
        "sentry": sentry_links(),
    }
