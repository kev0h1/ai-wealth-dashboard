"""G265 - LIVE (OpenRouter) check of the multi-month and period-label questions.
Never run in CI.

Drives the REAL `run_penny_agent` loop (real system prompt, real tool catalogue)
and the REAL `get_category_spend` executor over a SYNTHETIC fixture world (the
one in tests/test_penny_multi_month.py), so no real user data is read or
written. For each case it records what the model asked for, the table or chart
title the tool built, the reply the model wrote BEFORE the period guard and the
reply the user would see.

Safety: the API key is read from the UAT .env into this process only and is
never printed; MONGO_DB is forced to a disposable generated `wealth_test_*`
database BEFORE the app is imported and dropped in a finally; every case runs
under its own synthetic user id.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_period_live_eval.py --out /tmp/g265/live.json
"""
import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from datetime import date
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

_SCRATCH_DB = f"wealth_test_{int(time.time())}_{uuid.uuid4().hex[:8]}"
os.environ["MONGO_DB"] = _SCRATCH_DB

from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values("/root/ai-wealth-dashboard/backend/.env")
os.environ["OPENROUTER_API_KEY"] = _env.get("OPENROUTER_API_KEY", "")
del _env

import app.services.categories as categories_module  # noqa: E402
import app.services.penny_agent as penny_agent  # noqa: E402
import app.services.penny_tools as penny_tools  # noqa: E402
import app.services.spend_verdict as spend_verdict  # noqa: E402
from app.core import timeutil  # noqa: E402
from app.db.collections import db, llm_usage_col  # noqa: E402
from app.services import penny_period  # noqa: E402
from tests.test_penny_category_routing import _Col  # noqa: E402
from tests.test_penny_multi_month import LABEL, PAY_LABEL, TODAY, _world_rows, UID as FIXTURE_UID  # noqa: E402

CASES = [
    dict(id="period-01-aggregate-6-months", question="Can you aggregate my spending over the last 6 months",
         tool="get_category_spend", months=6, category=False, label=LABEL, title_prefix="Spending by category", table=True),
    dict(id="period-02-by-category-this-period", question="Tabulate what I have spent in each category this pay period",
         tool="get_category_spend", months=None, category=False, label=PAY_LABEL, title_prefix="Top spending", table=True),
    dict(id="period-03-single-category-6-months", question="How much did I spend on travel over the last 6 months",
         tool="get_category_spend", months=6, category=True, label=LABEL, title_prefix=None),
    dict(id="period-04-chart-6-months", question="Chart my spending by category over the last 6 months",
         tool="get_category_spend", months=6, category=False, label=LABEL, title_prefix="Spending by category", chart=True),
    dict(id="period-05-stacked-by-month", question="Show how my spending by category changed month by month over the last 6 months, as a stacked bar chart",
         tool="get_category_spend", months=6, category=False, label=LABEL, title_prefix="Spending by month", chart=True,
         chart_type="stacked_bar"),
]
SEEN: dict[str, list] = {}
RAW: dict[str, list] = {}
TITLES: dict[str, list] = {}


def _install_world():
    rows = _world_rows()
    for name in ("transactions_col", "yapily_transactions_col"):
        col = _Col(rows if name == "transactions_col" else [])
        setattr(spend_verdict, name, col)
        setattr(penny_tools, name, _Col(rows if name == "transactions_col" else []))
    categories_module.user_categories_col = _Col(
        [{"user_id": FIXTURE_UID, "categories": [{"name": "Padel", "kind": "discretionary"}]}])
    timeutil.user_today = lambda: TODAY

    async def verdict(uid, offset=0):
        return {"period": {"start": "2026-09-25", "end": "2026-10-29"}, "notables": [],
                "majority": [{"category": "Mortgage", "spent": 1124.44, "payments_count": 1},
                             {"category": "Travel", "spent": 879.98, "payments_count": 1},
                             {"category": "Groceries", "spent": 30.0, "payments_count": 1}]}

    penny_tools.compute_spend_verdict = verdict
    real_exec = penny_tools.execute_tool

    async def exec_as_fixture(uid, name, args):
        SEEN.setdefault(uid, []).append((name, dict(args or {})))
        res = await real_exec(FIXTURE_UID, name, args)
        if isinstance(res, dict):
            block = res.get("_table") or res.get("_chart")
            if isinstance(block, dict):
                TITLES.setdefault(uid, []).append(block.get("title"))
        return res

    penny_agent.execute_tool = exec_as_fixture
    real_guard = penny_period.guard_reply

    def recording_guard(headline, reply, periods, uid=""):
        RAW.setdefault(uid, []).append({"headline": headline, "reply": reply})
        return real_guard(headline, reply, periods, uid)

    penny_period.guard_reply = recording_guard


def _judge(case, result, uid):
    if result is None:
        return "refused"
    calls = [a for n, a in SEEN.get(uid, []) if n == case["tool"]]
    if not calls:
        return "wrong_tool"
    first = calls[0]
    if case["months"] and int(first.get("months") or 0) != case["months"]:
        return f"wrong_months:{first.get('months')}"
    if not case["months"] and first.get("months"):
        return f"unexpected_months:{first.get('months')}"
    if bool(first.get("category")) != case["category"]:
        return f"category_mismatch:{first.get('category')}"
    if case.get("chart"):
        if not result.get("chart"):
            return "no_chart_attached"
    elif case.get("table") and not result.get("table"):
        return "no_table_attached"
    block = result.get("chart") or result.get("table")
    if block:
        title = block.get("title") or ""
        if case["label"] not in title:
            return f"title_lacks_label:{title}"
        if case.get("chart_type") and block.get("type") != case["chart_type"]:
            return f"wrong_chart_type:{block.get('type')}"
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if "|" in reply:
        return "typed_a_table"
    if case["label"] in reply:
        return "ok"
    raw = (RAW.get(uid) or [{}])[-1]
    if raw.get("reply") == result.get("reply"):
        return "ok_no_period_phrase"
    return "ok_after_guard_rewrite"


async def _run(out, only=None):
    _install_world()
    rows = []
    for case in [c for c in CASES if not only or c["id"] == only]:
        uid = f"g265-eval-{case['id']}"
        t0 = time.monotonic()
        result = await penny_agent.run_penny_agent(uid, case["question"], [], "spend", "")
        dt = time.monotonic() - t0
        usage = await llm_usage_col.find({"user_id": uid}).to_list(50)
        cost = sum(float(u.get("cost_usd") or 0) for u in usage)
        row = {"id": case["id"], "question": case["question"], "outcome": _judge(case, result, uid),
               "rounds": len(usage), "cost_usd": round(cost, 5), "seconds": round(dt, 1),
               "calls": SEEN.get(uid, []), "tools_used": (result or {}).get("tools_used"),
               "block_titles": TITLES.get(uid, []), "raw_reply": (RAW.get(uid) or [{}])[-1].get("reply"),
               "headline": (result or {}).get("headline"), "reply": ((result or {}).get("reply") or "")[:500]}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False, default=str))
    total = round(sum(r["cost_usd"] for r in rows), 4)
    print("TOTAL_COST_USD", total)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps({"total_cost_usd": total, "rows": rows}, indent=1, ensure_ascii=False, default=str))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    try:
        await _run(args.out, args.only)
    finally:
        await db.client.drop_database(_SCRATCH_DB)


if __name__ == "__main__":
    asyncio.run(main())
