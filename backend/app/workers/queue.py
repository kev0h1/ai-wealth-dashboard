"""The single choke point for arq enqueues from the API process (H148).

After E18 merged, the backend test suite reached the real enqueue path through
GET /cashflow and Penny's cashflow loader and queued ``recompute:<fake-uid>``
jobs on the shared UAT Redis queue. Every API-process enqueue now goes through
``enqueue`` here (``scripts``/tests assert this statically), and a process that
is a test run never opens a Redis connection:

* a test run is detected by ``pytest`` being imported, ``PYTEST_CURRENT_TEST``,
  or ``MONGO_DB`` matching the H96 guard's ``wealth_test_*`` predicate;
* in that case ``get_pool`` returns a ``RecordingPool`` test double, and the
  call is appended to ``recorded_jobs`` for tests to read;
* in production and UAT runtime none of those hold, so behaviour is unchanged.

``FORBID_LIVE_QUEUE=1`` makes the real pool factory raise, so a run can prove
nothing reaches Redis. Worker-side enqueues (``app/workers``, which use the
worker's own ``ctx["redis"]``) are out of scope.
"""
from __future__ import annotations

import logging
import os
import sys
from typing import Any

from app.db.guard import TEST_DB_NAME_RE

logger = logging.getLogger(__name__)

FORBID_ENV = "FORBID_LIVE_QUEUE"

# Every enqueue made while in test mode: (job_name, args, kwargs incl. _job_id).
recorded_jobs: list[tuple[str, tuple, dict]] = []

_pool: Any = None


class LiveQueueForbidden(RuntimeError):
    pass


def is_test_process() -> bool:
    if "pytest" in sys.modules or os.environ.get("PYTEST_CURRENT_TEST"):
        return True
    return bool(TEST_DB_NAME_RE.match(os.environ.get("MONGO_DB") or ""))


class RecordingPool:
    """Test double with the slice of ArqRedis the API process uses."""

    async def enqueue_job(self, name: str, *args: Any, **kwargs: Any):
        recorded_jobs.append((name, args, dict(kwargs)))
        logger.debug("test mode: recorded arq job %s (not sent to Redis)", name)
        return object()

    async def set(self, *a: Any, **k: Any) -> bool:
        return True

    async def delete(self, *a: Any, **k: Any) -> int:
        return 0

    async def aclose(self) -> None:
        return None


async def _create_real_pool():
    if os.environ.get(FORBID_ENV) == "1":
        raise LiveQueueForbidden("live arq/Redis access is forbidden (FORBID_LIVE_QUEUE=1)")
    from arq import create_pool
    from arq.connections import RedisSettings
    from app.core.config import REDIS_URL
    return await create_pool(RedisSettings.from_dsn(REDIS_URL))


async def get_pool(*, shared: bool = True):
    """The arq pool: shared and cached by default; ``shared=False`` returns a
    fresh pool the caller must ``aclose``. A RecordingPool in test mode."""
    global _pool
    if is_test_process():
        return RecordingPool()
    if not shared:
        return await _create_real_pool()
    if _pool is None:
        _pool = await _create_real_pool()
    return _pool


def reset_pool() -> None:
    """Forget the cached pool after a connection failure."""
    global _pool
    _pool = None


async def enqueue(job_name: str, *args: Any, job_id: str | None = None, shared: bool = True, pool: Any = None, **kwargs: Any):
    """Enqueue ``job_name``. ``job_id`` becomes arq's ``_job_id``; other
    underscore options (``_defer_by``) pass through in kwargs. ``pool`` lets a
    caller reuse a pool it already holds (it is never closed here)."""
    own = pool is None
    if own:
        pool = await get_pool(shared=shared)
    if job_id is not None:
        kwargs["_job_id"] = job_id
    try:
        return await pool.enqueue_job(job_name, *args, **kwargs)
    finally:
        if own and not shared:
            await pool.aclose()
