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
2. A content hash of every `.py` under `app/`: deterministic across
   processes and environments, changes if and only if the backend's own
   code changes, and always resolves (so this mechanism can never silently
   no-op for lack of a fallback).

A prior version of this file preferred `git rev-parse HEAD` (and, before
that, `RAILWAY_GIT_COMMIT_SHA`) over the source hash. Both were dropped by
the G159 review: `git rev-parse HEAD` identifies a moment the *checkout*
was at, not a version of *this package*'s code — on UAT, where both
systemd units run straight from the shared tree, HEAD moves on every board
commit (`scripts/backlog.py`) and every frontend-only integrate, neither of
which touches `backend/` at all. A worker restart after either kind of
commit — for any reason, not just a deploy — read a new HEAD and
recomputed the entire user population for nothing, and a lone
`systemctl restart wealth-api` (or a board commit landing between
integrate's two service restarts) could leave the API and the worker
holding two DIFFERENT stamps, after which they spent the next four hours
recomputing each other's docs with `reason="engine_build"` until the next
backend integrate happened to realign them. `RAILWAY_GIT_COMMIT_SHA` was
never confirmed to actually behave better in practice (see docs/ops/ENV.md)
and shares the same shape of risk if Railway ever redeploys on a change
outside `backend/`, so it was dropped too rather than kept as a
now-untested middle rung. The source hash has neither failure mode: it
depends only on this package's own `.py` bytes, so two processes with
identical backend code always agree regardless of which commit, branch or
platform produced them, and a restart with no code change is always a
true no-op.

The value is resolved once per process and cached: it is read on every
recompute and every reconcile tick, and hashing every file per call would
be silly. A restart without a deploy therefore produces the same value and
the deploy-time pass (see `derived_caches.refresh_stale_cashflow_caches`)
finds nothing to do — on Railway and on UAT alike.
"""
import hashlib
import logging
import os
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
    value = (os.getenv("ENGINE_BUILD_ID") or "").strip()
    if value:
        return value
    return _source_hash()


def engine_build() -> str:
    """The running engine build's identity, resolved once per process."""
    global _cached
    if _cached is None:
        _cached = _detect()
        logger.info("engine build %s", _cached)
    return _cached
