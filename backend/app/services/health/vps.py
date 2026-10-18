"""E7 collector 6: this host's memory, disk, load, CPU count and uptime.

Reuses `host_metrics` (/proc, shutil, os.getloadavg). Percent thresholds
match the slice 1 page (amber at 75, red at 90); low available memory is
also flagged because this box has been OOM-killed under parallel builds (H95).
"""
from __future__ import annotations

import asyncio

from app.services import host_metrics
from app.services.health.base import Collector, level, result, worst

PCT_WARN, PCT_CRIT = 75.0, 90.0
AVAIL_WARN_MB, AVAIL_CRIT_MB = 1500, 700


class VpsCollector(Collector):
    name = "vps"
    title = "This server"
    sample_fields = {
        "memory_used_pct": "memory_used_pct", "memory_available_mb": "memory_available_mb",
        "disk_used_pct": "disk_used_pct",
    }

    def __init__(self, metrics=host_metrics):
        self.m = metrics

    async def collect(self) -> dict:
        mem, disk, load, uptime = await asyncio.gather(
            asyncio.to_thread(self.m.memory), asyncio.to_thread(self.m.disk),
            asyncio.to_thread(self.m.load), asyncio.to_thread(self.m.uptime_hours),
        )
        status = "ok"
        values: dict = {"uptime_hours": uptime}
        if mem:
            values.update(memory_used_pct=mem["used_pct"], memory_available_mb=mem["available_mb"], memory_total_mb=mem["total_mb"])
            status = worst(status, level(mem["used_pct"], PCT_WARN, PCT_CRIT))
            if mem["available_mb"] < AVAIL_CRIT_MB:
                status = worst(status, "crit")
            elif mem["available_mb"] < AVAIL_WARN_MB:
                status = worst(status, "warn")
        if disk:
            values.update(disk_used_pct=disk["used_pct"], disk_free_gb=disk["free_gb"], disk_total_gb=disk["total_gb"])
            status = worst(status, level(disk["used_pct"], PCT_WARN, PCT_CRIT))
        if load:
            per_cpu = round(load["load_5m"] / load["cpus"] * 100, 1)
            values.update(cpus=load["cpus"], load_1m=load["load_1m"], load_5m=load["load_5m"], load_15m=load["load_15m"], load_pct=per_cpu)
            status = worst(status, level(per_cpu, PCT_WARN, PCT_CRIT))
        if not (mem or disk or load):
            return result(self.name, state="omitted", note="Host metrics are not readable on this platform.")
        return result(self.name, status=status, values=values)
