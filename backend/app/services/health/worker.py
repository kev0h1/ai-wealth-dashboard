"""E7 collector 3: arq queue depth and failed jobs, read-only from Redis.

Keys read (arq defaults): the queue sorted set `arq:queue` (one member per
waiting job, score = due time in ms), `arq:in-progress:*` (one per running
job), `arq:result:*` (finished jobs, kept for `keep_result`, one hour by
default, so failures are counted over what Redis still retains, not a full
24 hours; the trend store keeps the history) and the worker heartbeat
`arq:queue:health-check`. Nothing is written; the client is created from
REDIS_URL with short timeouts and closed afterwards.
"""
from __future__ import annotations

import time
from typing import Awaitable, Callable, Optional

from app.services.health.base import CRIT, OK, WARN, Collector, level, result, worst

QUEUE_KEY = "arq:queue"
RESULT_PREFIX = "arq:result:"
INPROGRESS_PREFIX = "arq:in-progress:"
HEARTBEAT_KEY = "arq:queue:health-check"
DEPTH_WARN, DEPTH_CRIT = 50, 200
AGE_WARN_S, AGE_CRIT_S = 600.0, 3600.0
FAILED_WARN, FAILED_CRIT = 1, 10
SCAN_LIMIT = 500


def _make_client():
    import redis.asyncio as redis
    from app.core.config import REDIS_URL
    return redis.Redis.from_url(REDIS_URL, socket_timeout=1.0, socket_connect_timeout=1.0)


def _failed(raw: bytes) -> Optional[bool]:
    """True when a stored arq result is a failure. arq pickles results; it is
    our own Redis and arq's own decoder, and an unreadable value is skipped."""
    try:
        from arq.jobs import deserialize_result
        return not deserialize_result(raw).success
    except Exception:
        return None


class WorkerQueueCollector(Collector):
    name = "worker"
    title = "Worker queue"
    sample_fields = {"queue_depth": "queue_depth", "failed_recent": "failed_recent"}

    def __init__(self, client_factory: Callable = _make_client, decode: Callable[[bytes], Optional[bool]] = _failed,
                 now: Callable[[], float] = time.time):
        self.client_factory = client_factory
        self.decode = decode
        self.now = now

    async def collect(self) -> dict:
        client = self.client_factory()
        try:
            depth = int(await client.zcard(QUEUE_KEY))
            oldest = await client.zrange(QUEUE_KEY, 0, 0, withscores=True)
            oldest_age = None
            if oldest:
                oldest_age = max(0.0, round(self.now() - float(oldest[0][1]) / 1000.0, 1))
            running = 0
            async for _ in client.scan_iter(match=f"{INPROGRESS_PREFIX}*", count=100):
                running += 1
                if running >= SCAN_LIMIT:
                    break
            failed = finished = 0
            async for key in client.scan_iter(match=f"{RESULT_PREFIX}*", count=100):
                raw = await client.get(key)
                finished += 1
                if raw is not None and self.decode(raw) is True:
                    failed += 1
                if finished >= SCAN_LIMIT:
                    break
            heartbeat = bool(await client.exists(HEARTBEAT_KEY))
        finally:
            try:
                await client.aclose()
            except Exception:
                pass
        status = worst(
            level(depth, DEPTH_WARN, DEPTH_CRIT),
            level(oldest_age, AGE_WARN_S, AGE_CRIT_S),
            level(failed, FAILED_WARN, FAILED_CRIT),
            # A dead worker with an empty queue must not read ok.
            (CRIT if depth > 0 else WARN) if not heartbeat else OK,
        )
        return result(
            self.name, status=status,
            values={
                "queue_depth": depth, "oldest_queued_age_s": oldest_age, "running": running,
                "failed_recent": failed, "finished_recent": finished, "heartbeat_present": heartbeat,
            },
            note="Failures counted over results arq still retains (about the last hour).",
        )
