"""E7 collector 4: model spend per pipeline and Tavily quota state.

Spend uses the same `llm_usage` aggregation as `GET /admin/llm-usage` (group
by pipeline over `year_month`, and over the last 7 days). Tavily calls sit in
that collection with model "tavily" (B48), so their month and week counts are
the research counters; the quota state is B44's backoff record
(`tips_research_health`, `worker_runs` document `savings_insights_research`).
An optional monthly budget (LLM_MONTHLY_BUDGET_USD) turns spend into a status;
without it spend is shown and stays ok.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Optional

from app.services.health.base import (
    CRIT, OK, WARN, Collector, env_float, iso, level, result, utc_now, worst,
)

BUDGET_WARN, BUDGET_CRIT = 0.75, 1.0
TAVILY = "tavily"


def _group(match: dict) -> list[dict]:
    return [
        {"$match": match},
        {"$group": {"_id": {"p": "$pipeline", "tavily": {"$eq": ["$model", TAVILY]}},
                    "cost_usd": {"$sum": "$cost_usd"}, "calls": {"$sum": 1}}},
    ]


def _fold(rows: list[dict]) -> tuple[list[dict], dict]:
    pipelines: dict[str, dict] = {}
    tavily = {"calls": 0, "by_pipeline": {}}
    for r in rows:
        key = r["_id"]
        name = key.get("p") or "unknown"
        if key.get("tavily"):
            tavily["calls"] += int(r.get("calls") or 0)
            tavily["by_pipeline"][name] = tavily["by_pipeline"].get(name, 0) + int(r.get("calls") or 0)
            continue
        p = pipelines.setdefault(name, {"pipeline": name, "cost_usd": 0.0, "calls": 0})
        p["cost_usd"] = round(p["cost_usd"] + float(r.get("cost_usd") or 0.0), 4)
        p["calls"] += int(r.get("calls") or 0)
    out = sorted(pipelines.values(), key=lambda p: -p["cost_usd"])
    return out, tavily


class LlmTavilyCollector(Collector):
    name = "llm_tavily"
    title = "Model spend and Tavily"
    # E8: numeric top-level values the alert evaluator reads from the trend store.
    sample_fields = {"tavily_backoff": "tavily_backoff", "budget_used_pct": "budget_used_pct"}

    def __init__(self, usage=None, research_loader=None):
        from app.db import collections as c
        from app.services import tips_research_health as trh
        self.usage = usage or c.llm_usage_col
        self.research_loader = research_loader or trh.load
        self.trh = trh

    async def collect(self) -> dict:
        now = utc_now()
        month = await self.usage.aggregate(_group({"year_month": now.strftime("%Y-%m")})).to_list(None)
        week = await self.usage.aggregate(_group({"ts": {"$gte": now - timedelta(days=7)}})).to_list(None)
        month_p, month_t = _fold(month)
        week_p, week_t = _fold(week)
        doc = await self.research_loader()
        naive_now = now.replace(tzinfo=None)

        research_status = (doc or {}).get("research_status") or "unknown"
        backoff = self.trh.backoff_active(doc, naive_now)
        tavily_status = OK
        if research_status == "failing":
            tavily_status = CRIT if backoff else WARN

        month_cost = round(sum(p["cost_usd"] for p in month_p), 4)
        week_cost = round(sum(p["cost_usd"] for p in week_p), 4)
        budget = env_float("LLM_MONTHLY_BUDGET_USD")
        spend_status = OK
        if budget and budget > 0:
            spend_status = level(month_cost / budget, BUDGET_WARN, BUDGET_CRIT)

        skip_until = (doc or {}).get("skip_until")
        values = {
            "tavily_backoff": 1 if backoff else 0,
            "budget_used_pct": round(month_cost / budget * 100, 1) if budget and budget > 0 else None,
            "month_cost_usd": month_cost, "week_cost_usd": week_cost,
            "budget_usd": budget, "month_by_pipeline": month_p[:10], "week_by_pipeline": week_p[:10],
            "tavily": {
                "calls_month": month_t["calls"], "calls_week": week_t["calls"],
                "by_pipeline_month": month_t["by_pipeline"],
                "research_status": research_status,
                "last_error_code": (doc or {}).get("last_error_code"),
                "backoff_active": backoff,
                "skip_until": iso(skip_until) if skip_until else None,
                "line": self.trh.status_line(doc),
            },
        }
        return result(self.name, status=worst(spend_status, tavily_status), values=values,
                      note=None if budget else "No monthly budget set (LLM_MONTHLY_BUDGET_USD), so spend is shown only.")
