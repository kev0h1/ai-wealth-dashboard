"""Shared helpers for the G224 AI intro tooling. Never prints the API key."""
import os
import re
import sys
from pathlib import Path

import requests

BASE = "https://openrouter.ai/api/v1"
FLOOR = 47.33  # hard balance floor (USD), Kevin 2026-10-06
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
REEL = Path("/tmp/reel/sorted-reel.mp4")


def _env_file() -> Path:
    for p in [Path("/root/ai-wealth-dashboard/backend/.env")] + [a / "backend" / ".env" for a in HERE.parents]:
        if p.exists():
            return p
    sys.exit("backend/.env not found")


def key() -> str:
    k = os.environ.get("OPENROUTER_API_KEY")
    if k:
        return k
    for line in _env_file().read_text().splitlines():
        m = re.match(r"\s*OPENROUTER_API_KEY\s*=\s*(.*)", line)
        if m:
            return m.group(1).strip().strip("'\"")
    sys.exit("OPENROUTER_API_KEY not set")


def headers() -> dict:
    return {"Authorization": f"Bearer {key()}", "Content-Type": "application/json"}


def balance() -> float:
    r = requests.get(f"{BASE}/credits", headers=headers(), timeout=30)
    r.raise_for_status()
    d = r.json()["data"]
    return round(d["total_credits"] - d["total_usage"], 4)


def guard(estimated_cost: float) -> float:
    """Abort unless balance - estimate stays at or above the floor."""
    bal = balance()
    if bal - estimated_cost < FLOOR:
        sys.exit(f"ABORT: balance ${bal:.2f} - est ${estimated_cost:.2f} would drop below floor ${FLOOR:.2f}")
    return bal
