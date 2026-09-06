"""Bot/owner-only cost dashboard.

`GET /admin/llm-usage?month=YYYY-MM` aggregates `llm_usage_col` (see
app.core.llm's module docstring for the doc shape every OpenRouter call
site writes there) by pipeline and by user for one calendar month, so
real per-user AI cost replaces the estimate in
docs/pricing/tiering-unit-economics-mcp-2026-09.md's "Usage metering"
section.

Two aggregation queries total, no per-user loop over Mongo:
- `by_pipeline`: one `$group` by pipeline, sorted by cost desc. Totals are
  summed from this in Python rather than a third query, since by_pipeline
  is already a complete partition of the month's docs.
- `by_user`: a two-stage `$group` (first by {user_id, pipeline} to get
  per-pipeline cost/calls/message_ids, then by user_id, pushing each
  user's per-pipeline rows into an array) so `top_pipeline` and distinct
  Penny message counts can be picked out in Python without a second
  round trip. The per-user subscription tier lookup (`get_subscription`)
  IS one call per user, but that list is bounded by how many users had
  any LLM usage this month, not the whole user base.
"""
import math
import re
import statistics
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import PRIMARY_EMAIL, mask_email
from app.core.subscription import get_subscription
from app.db.collections import llm_usage_col

router = APIRouter(tags=["admin"])

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


def _require_admin(user: dict) -> None:
    """Bot (BOT_SECRET bearer) or the account owner's own session — same
    admin-or-owner pairing as app.routers.ops._require_owner /
    app.routers.subscription.admin_set_tier, merged into one gate since
    this endpoint is read by both the bot's nightly report and Kevin's own
    ops pages."""
    if user.get("name") == "Bot":
        return
    if (user.get("email") or "").strip().lower() == PRIMARY_EMAIL:
        return
    raise HTTPException(403, "Admin only")


def _validate_month(month: str) -> str:
    if not _MONTH_RE.match(month or ""):
        raise HTTPException(400, "month must be YYYY-MM")
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "month must be YYYY-MM")
    return month


def _percentile(sorted_values: list, pct: float) -> float:
    """Nearest-rank percentile over an ascending-sorted list (`pct` in
    0-100). Empty input returns 0.0. Deterministic and dependency-free —
    no interpolation, which keeps this trivial to assert exact values for
    in tests."""
    n = len(sorted_values)
    if n == 0:
        return 0.0
    idx = max(0, min(n - 1, math.ceil(pct / 100 * n) - 1))
    return sorted_values[idx]


@router.get("/admin/llm-usage")
async def admin_llm_usage(month: str | None = None, user: dict = Depends(current_user)):
    _require_admin(user)
    ym = _validate_month(month) if month else datetime.now(timezone.utc).strftime("%Y-%m")

    match = {"year_month": ym}

    by_pipeline_rows = await llm_usage_col.aggregate([
        {"$match": match},
        {"$group": {
            "_id": "$pipeline",
            "cost_usd": {"$sum": "$cost_usd"},
            "calls": {"$sum": 1},
            "prompt_tokens": {"$sum": "$prompt_tokens"},
            "cached_tokens": {"$sum": "$cached_tokens"},
            "completion_tokens": {"$sum": "$completion_tokens"},
            "avg_latency_ms": {"$avg": "$latency_ms"},
        }},
        {"$sort": {"cost_usd": -1}},
    ]).to_list(None)

    by_user_rows = await llm_usage_col.aggregate([
        {"$match": match},
        {"$group": {
            "_id": {"user_id": "$user_id", "pipeline": "$pipeline"},
            "cost_usd": {"$sum": "$cost_usd"},
            "calls": {"$sum": 1},
            "message_ids": {"$addToSet": "$message_id"},
        }},
        {"$group": {
            "_id": "$_id.user_id",
            "cost_usd": {"$sum": "$cost_usd"},
            "calls": {"$sum": "$calls"},
            "pipelines": {"$push": {
                "pipeline": "$_id.pipeline",
                "cost_usd": "$cost_usd",
                "calls": "$calls",
                "message_ids": "$message_ids",
            }},
        }},
    ]).to_list(None)

    by_pipeline = []
    total_cost = 0.0
    total_calls = 0
    total_prompt = 0
    total_cached = 0
    total_completion = 0
    has_penny_pipeline = False
    for row in by_pipeline_rows:
        pipeline_name = row["_id"]
        if pipeline_name == "penny":
            has_penny_pipeline = True
        cost = float(row.get("cost_usd") or 0.0)
        calls = int(row.get("calls") or 0)
        prompt = int(row.get("prompt_tokens") or 0)
        cached = int(row.get("cached_tokens") or 0)
        completion = int(row.get("completion_tokens") or 0)
        by_pipeline.append({
            "pipeline": pipeline_name,
            "cost_usd": round(cost, 4),
            "calls": calls,
            "prompt_tokens": prompt,
            "cached_tokens": cached,
            "completion_tokens": completion,
            "avg_latency_ms": round(float(row.get("avg_latency_ms") or 0.0), 1),
        })
        total_cost += cost
        total_calls += calls
        total_prompt += prompt
        total_cached += cached
        total_completion += completion

    by_user = []
    all_message_ids: set = set()
    for row in by_user_rows:
        user_id = row["_id"]
        cost = float(row.get("cost_usd") or 0.0)
        calls = int(row.get("calls") or 0)
        top_pipeline = None
        top_cost = None
        penny_messages = 0
        for sub in row.get("pipelines") or []:
            sub_cost = float(sub.get("cost_usd") or 0.0)
            if top_cost is None or sub_cost > top_cost:
                top_cost = sub_cost
                top_pipeline = sub.get("pipeline")
            if sub.get("pipeline") == "penny":
                ids = {m for m in (sub.get("message_ids") or []) if m}
                penny_messages = len(ids)
                all_message_ids |= ids

        try:
            sub_info = await get_subscription(user_id)
            tier_name = sub_info.tier_name
        except Exception:
            tier_name = None

        by_user.append({
            "user": mask_email(user_id or ""),
            "user_id": user_id,
            "tier": tier_name,
            "cost_usd": round(cost, 4),
            "calls": calls,
            "penny_messages": penny_messages,
            "top_pipeline": top_pipeline,
        })

    by_user.sort(key=lambda r: r["cost_usd"], reverse=True)

    user_costs = sorted(r["cost_usd"] for r in by_user)
    cost_per_user = {
        "mean": round(statistics.fmean(user_costs), 4) if user_costs else 0.0,
        "median": round(statistics.median(user_costs), 4) if user_costs else 0.0,
        "p90": round(_percentile(user_costs, 90), 4) if user_costs else 0.0,
    }

    totals = {
        "cost_usd": round(total_cost, 4),
        "calls": total_calls,
        "prompt_tokens": total_prompt,
        "cached_tokens": total_cached,
        "completion_tokens": total_completion,
        "users": len(by_user_rows),
    }
    if has_penny_pipeline:
        totals["penny_messages"] = len(all_message_ids)

    return {
        "month": ym,
        "totals": totals,
        "by_pipeline": by_pipeline,
        "by_user": by_user,
        "cost_per_user_usd": cost_per_user,
        "estimates_note": (
            'Per-user cost, call and token figures here supersede the estimate in '
            'docs/pricing/tiering-unit-economics-mcp-2026-09.md, section "Usage metering".'
        ),
    }
