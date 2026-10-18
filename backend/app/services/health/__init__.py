"""E7: /ops/health metrics collectors (see base.py for the interface)."""
from __future__ import annotations

from app.services.health.base import BUDGET_S, Collector, result, run_all, run_collector
from app.services.health.external import RailwayCollector, VercelCollector
from app.services.health.latency import ApiLatencyCollector
from app.services.health.llm import LlmTavilyCollector
from app.services.health.mongo import MongoCollector
from app.services.health.push import PushDeliveryCollector
from app.services.health.sync import FinexerSyncCollector
from app.services.health.vps import VpsCollector
from app.services.health.worker import WorkerQueueCollector

__all__ = ["BUDGET_S", "Collector", "default_collectors", "result", "run_all", "run_collector"]


def default_collectors() -> list[Collector]:
    """Order is the order the page shows them in."""
    return [
        ApiLatencyCollector(), FinexerSyncCollector(), WorkerQueueCollector(), LlmTavilyCollector(),
        MongoCollector(), VpsCollector(), RailwayCollector(), VercelCollector(), PushDeliveryCollector(),
    ]
