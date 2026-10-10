"""G252 - LIVE (OpenRouter) check of the three chart questions. Never run in CI.

Drives the REAL `run_penny_agent` loop (real system prompt, real tool catalogue,
real chart attachment) against a SYNTHETIC fixture world: the data tools are
answered from the fixtures below through the REAL table builders, so no real
user data is read or written.

Safety: the API key is read from the UAT .env into this process only and is
never printed; MONGO_DB is forced to a disposable generated `wealth_test_*`
database BEFORE the app is imported (so llm_usage rows land there) and dropped
in a finally; every case runs under its own synthetic user id.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_chart_live_eval.py --out /tmp/g252/live.json
"""
import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from datetime import date, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

_SCRATCH_DB = f"wealth_test_{int(time.time())}_{uuid.uuid4().hex[:8]}"
os.environ["MONGO_DB"] = _SCRATCH_DB

from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values("/root/ai-wealth-dashboard/backend/.env")
os.environ["OPENROUTER_API_KEY"] = _env.get("OPENROUTER_API_KEY", "")
del _env

from app.services import penny_agent, penny_tools  # noqa: E402
from app.db.collections import db, llm_usage_col  # noqa: E402

TODAY = date(2026, 10, 10)
EAT_DOCS = [
    {"amount": 41.2, "currency": "GBP", "date": datetime(2026, 10, 3), "merchant_name": "Pret"},
    {"amount": 63.0, "currency": "GBP", "date": datetime(2026, 9, 14), "merchant_name": "Nando's"},
    {"amount": 28.5, "currency": "GBP", "date": datetime(2026, 7, 21), "merchant_name": "Wagamama"},
]
CATS = [("Bills", 840.0), ("Groceries", 342.0), ("Eating Out", 128.2), ("Transport", 96.0), ("Shopping", 74.5),
        ("Subscriptions", 41.97), ("Entertainment", 38.0), ("Health", 22.0), ("Cash", 14.0), ("Charity", 10.0)]
MONZO = [
    {"amount": 1500.0, "currency": "GBP", "date": datetime(2026, 8, 28), "transaction_type": "credit", "merchant_name": "Salary", "category": "Income"},
    {"amount": 220.0, "currency": "GBP", "date": datetime(2026, 9, 3), "transaction_type": "debit", "merchant_name": "Rent pot", "category": "Bills"},
    {"amount": 60.0, "currency": "GBP", "date": datetime(2026, 9, 9), "transaction_type": "debit", "merchant_name": "Tesco", "category": "Groceries"},
    {"amount": 1500.0, "currency": "GBP", "date": datetime(2026, 9, 28), "transaction_type": "credit", "merchant_name": "Salary", "category": "Income"},
    {"amount": 310.0, "currency": "GBP", "date": datetime(2026, 10, 2), "transaction_type": "debit", "merchant_name": "Rent pot", "category": "Bills"},
]

CASES = [
    dict(id="chart-01-eating-out-bar", question="Show my eating out by month as a bar chart", screen="spend",
         tool="get_category_spend", types=("bar",)),
    dict(id="chart-02-pie-of-spend", question="Pie of where my money went this month", screen="spend",
         tool="get_category_spend", types=("donut",)),
    dict(id="chart-03-monzo-balance", question="Chart my Monzo balance over the last 3 months", screen="spend",
         tool="search_transactions", types=("line", "bar")),
]
SEEN: dict[str, list] = {}


async def _fake_execute(uid, name, args):
    SEEN.setdefault(uid, []).append((name, dict(args or {})))
    chart = penny_tools._chart_request(args or {})
    if name == "get_category_spend":
        if (args or {}).get("category"):
            months = int((args or {}).get("months") or 6)
            tot = sum(d["amount"] for d in EAT_DOCS)
            res = {"category": "Eating Out", "period": {"start": "2026-09-18", "end": "2026-10-17"},
                   "this_period": {"spent": penny_tools._money(41.2), "payments_count": 1}, "top_merchants": [],
                   "last_n_months": {"months": months, "spent": penny_tools._money(tot), "payments_count": len(EAT_DOCS)}}
            if chart:
                table = penny_tools._category_months_table("Eating Out", EAT_DOCS, date(2026, 4, 13), TODAY)
                res.update(penny_tools._chart_or_table(table, chart, "month", ["spent"], series_names=["Eating Out"],
                                                       title="Eating Out by month", time_x=True))
            return res
        res = {"period": {"start": "2026-09-18", "end": "2026-10-17"},
               "top_categories": [{"category": c, "spent": penny_tools._money(v), "payments_count": 3} for c, v in CATS[:5]]}
        if chart:
            table = {"title": "Spending by category this pay period", "columns": [
                {"key": "category", "label": "Category", "kind": "text", "align": "left"},
                {"key": "spent", "label": "Spent", "kind": "money", "align": "right"}],
                "rows": [{"category": c, "spent": {"amount": v, "currency": "GBP"}} for c, v in CATS]}
            res.update(penny_tools._chart_or_table(table, chart, "category", ["spent"], series_names=["Spent"],
                                                   title="Spending by category this pay period"))
        return res
    if name == "search_transactions":
        res = {"count": len(MONZO), "match_kind": "text", "matched_count": len(MONZO),
               "transactions": [{"description": d["merchant_name"], "date": d["date"].date().isoformat(),
                                 "amount": penny_tools._money(d["amount"], 2)} for d in MONZO]}
        if chart and chart["type"]:
            built = penny_tools._transactions_chart(MONZO, chart, "monzo", None, {"matched_count": len(MONZO)})
            if built:
                res["_chart"] = built
        return res
    return {"error": "no data available for that in this evaluation"}


def _judge(case, result, seen):
    if result is None:
        return "refused"
    calls = [a for n, a in seen if n == case["tool"]]
    if not calls:
        return "wrong_tool"
    if calls[0].get("as_chart") not in case["types"]:
        return f"wrong_type:{calls[0].get('as_chart')}"
    if not result.get("chart"):
        return "no_chart_attached"
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if "|" in reply or "\n" in (result.get("reply") or ""):
        return "typed_a_table"
    return "ok"


async def _run(out, only=None):
    penny_agent.execute_tool = _fake_execute
    penny_agent.timeutil.user_today = lambda: TODAY
    rows = []
    for case in [c for c in CASES if not only or c["id"] == only]:
        uid = f"g252-eval-{case['id']}"
        t0 = time.monotonic()
        result = await penny_agent.run_penny_agent(uid, case["question"], [], case["screen"], "")
        dt = time.monotonic() - t0
        usage = await llm_usage_col.find({"user_id": uid}).to_list(50)
        cost = sum(float(u.get("cost_usd") or 0) for u in usage)
        outcome = _judge(case, result, SEEN.get(uid, []))
        row = {"id": case["id"], "question": case["question"], "outcome": outcome, "rounds": len(usage),
               "cost_usd": round(cost, 5), "seconds": round(dt, 1),
               "calls": SEEN.get(uid, []), "tools_used": (result or {}).get("tools_used"),
               "headline": (result or {}).get("headline"), "reply": ((result or {}).get("reply") or "")[:400],
               "chart": {k: ((result or {}).get("chart") or {}).get(k) for k in ("type", "title", "note", "summary")}}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False, default=str))
    total = round(sum(r["cost_usd"] for r in rows), 4)
    print("TOTAL_COST_USD", total)
    if out:
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
