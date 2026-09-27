"""Identify the running build of the forecast engine (G159).

`app.routers.analytics.compute_and_cache_cashflow` stamps every
cashflow_cache_col doc it writes with `engine_build`, and
`app.services.derived_caches` compares that stamp with the running build to
decide whether a doc was produced by older code. That is what lets a merged
engine fix reach every user's forecast without waiting for new transactions
to happen to arrive (the `has_new` gate) or for someone to remember to bump
`PATTERNS_VERSION` by hand (G158 shipped without one and sat invisible
behind the cache for the rest of the evening).

Resolution order, first non-empty wins:

1. `ENGINE_BUILD_ID` env: an explicit operator override, also what a test
   sets to pin the value.
2. `RAILWAY_GIT_COMMIT_SHA` env: platform-injected on both Railway services
   (production). The backend image has no `.git` (see backend/Dockerfile),
   so this is the only build identity available there.
3. `git rev-parse HEAD` on the checkout this package is imported from: UAT,
   where both systemd units run from /root/ai-wealth-dashboard/backend, and
   any worktree.
4. A content hash of every `.py` under `app/`: never changes on a restart
   without a code change, always changes with one, so the mechanism can
   never silently no-op in an environment with neither an env stamp nor
   git.

The value is resolved once per process and cached: it is read on every
recompute and every reconcile tick, and a subprocess per call would be
silly. A restart without a deploy therefore produces the same value and
the deploy-time pass (see `derived_caches.refresh_stale_cashflow_caches`)
finds nothing to do.
"""
import hashlib
import logging
import os
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

_APP_DIR = Path(__file__).resolve().parent.parent
_cached: str | None = None


def _source_hash() -> str:
    h = hashlib.sha1()
    for path in sorted(_APP_DIR.rglob("*.py")):
        try:
            h.update(path.relative_to(_APP_DIR).as_posix().encode())
            h.update(path.read_bytes())
        except OSError:
            continue
    return "src-" + h.hexdigest()[:16]


def _detect() -> str:
    for name in ("ENGINE_BUILD_ID", "RAILWAY_GIT_COMMIT_SHA"):
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    try:
        out = subprocess.run(
            ["git", "-C", str(_APP_DIR), "rev-parse", "HEAD"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        sha = (out.stdout or "").strip()
        if out.returncode == 0 and sha:
            return sha
    except Exception:
        pass
    return _source_hash()


def engine_build() -> str:
    """The running engine build's identity, resolved once per process."""
    global _cached
    if _cached is None:
        _cached = _detect()
        logger.info("engine build %s", _cached)
    return _cached
