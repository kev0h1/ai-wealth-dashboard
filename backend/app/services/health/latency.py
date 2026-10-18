"""E7 collector 1: API latency and error rate per route over the last hour.

An in-process ring buffer (`RING`) is fed by `LatencyMiddleware` (a pure ASGI
middleware, registered outermost in `app.main.build_app`) with one sample per
HTTP request: (timestamp, method, route template, status, duration ms). No
paths with ids, query strings, headers, bodies or user ids are recorded, and
the buffer is a bounded deque (10 000 samples, oldest dropped), so memory is
fixed. It is per process and resets on restart; aggregation happens on read.
"""
from __future__ import annotations

import math
import time
from collections import deque
from typing import Optional

from app.services.health.base import (
    CRIT, OK, WARN, Collector, level, result, worst,
)

MAX_SAMPLES = 10_000
WINDOW_S = 3600
MIN_SAMPLES = 20           # below this an error rate is noise, never warn on it
P95_WARN_MS, P95_CRIT_MS = 1500.0, 3000.0
ERR_WARN, ERR_CRIT = 0.02, 0.10   # 5xx share of requests
UNMATCHED = "(unmatched)"


class RingBuffer:
    def __init__(self, maxlen: int = MAX_SAMPLES):
        self._buf: deque = deque(maxlen=maxlen)

    def record(self, route: str, method: str, status: int, duration_ms: float, ts: Optional[float] = None) -> None:
        self._buf.append((time.time() if ts is None else ts, method, route, int(status), float(duration_ms)))

    def __len__(self) -> int:
        return len(self._buf)

    def clear(self) -> None:
        self._buf.clear()

    def samples(self, since: float) -> list[tuple]:
        return [s for s in list(self._buf) if s[0] >= since]


RING = RingBuffer()


def _percentile(sorted_values: list[float], pct: float) -> float:
    n = len(sorted_values)
    if not n:
        return 0.0
    return sorted_values[max(0, min(n - 1, math.ceil(pct / 100 * n) - 1))]


def aggregate(samples: list[tuple], top: int = 12) -> dict:
    """Overall and per-route p50/p95/error rate from raw samples."""
    by_route: dict[str, list[tuple]] = {}
    for s in samples:
        by_route.setdefault(f"{s[1]} {s[2]}", []).append(s)

    def stats(rows: list[tuple]) -> dict:
        durs = sorted(r[4] for r in rows)
        errs = sum(1 for r in rows if r[3] >= 500)
        return {
            "count": len(rows),
            "p50_ms": round(_percentile(durs, 50), 1),
            "p95_ms": round(_percentile(durs, 95), 1),
            "error_rate": round(errs / len(rows), 4) if rows else 0.0,
        }

    routes = [{"route": k, **stats(v)} for k, v in by_route.items()]
    routes.sort(key=lambda r: (-r["p95_ms"], -r["count"]))
    return {"overall": stats(samples), "routes": routes[:top], "route_count": len(routes)}


class ApiLatencyCollector(Collector):
    name = "api_latency"
    title = "API latency"
    sample_fields = {"p95_ms": "p95_ms", "error_rate": "error_rate"}

    def __init__(self, ring: RingBuffer = RING, now=time.time):
        self.ring = ring
        self.now = now

    async def collect(self) -> dict:
        now = self.now()
        data = aggregate(self.ring.samples(now - WINDOW_S))
        o = data["overall"]
        if o["count"] == 0:
            return result(self.name, values={"count": 0, "routes": [], "p50_ms": None, "p95_ms": None, "error_rate": None},
                          note="No requests seen by this process in the last hour (buffer resets on restart).")
        status = level(o["p95_ms"], P95_WARN_MS, P95_CRIT_MS)
        if o["count"] >= MIN_SAMPLES:
            status = worst(status, level(o["error_rate"], ERR_WARN, ERR_CRIT))
        return result(
            self.name, status=status,
            values={**o, "routes": data["routes"], "route_count": data["route_count"]},
            note="Last hour, this process only; 5xx counted as errors.",
        )


class LatencyMiddleware:
    """Pure ASGI: cheap, never touches the body, never raises into a request."""

    def __init__(self, app, ring: RingBuffer = RING):
        self.app = app
        self.ring = ring

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        start = time.perf_counter()
        status = {"code": 500}

        async def send_wrapper(message):
            if message.get("type") == "http.response.start":
                status["code"] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            try:
                route = scope.get("route")
                template = getattr(route, "path", None)
                if template is None and status["code"] == 401:
                    return   # unauthenticated short-circuit: not a route, would inflate (unmatched)
                template = template or UNMATCHED
                self.ring.record(template, scope.get("method", "GET"), status["code"],
                                 (time.perf_counter() - start) * 1000)
            except Exception:
                pass
