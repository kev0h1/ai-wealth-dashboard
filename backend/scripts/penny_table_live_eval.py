"""G251 - LIVE (OpenRouter) check of the two table questions. Never run in CI.

Drives the REAL `run_penny_agent` loop (real system prompt, real tool catalogue,
real table attachment) against a SYNTHETIC fixture world: the data tools are
answered from the fixtures below through the REAL table builders, so no real
user data is read or written.

Safety: the API key is read from the UAT .env into this process only and is
never printed; MONGO_DB is forced to a disposable generated `wealth_test_*`
database BEFORE the app is imported (so llm_usage rows land there) and dropped
in a finally; every case runs under its own synthetic user id.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_table_live_eval.py --out /tmp/g251/live.json
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
FX_DOCS = [
    {"amount": 20.0, "currency": "USD", "date": datetime(2026, 10, 4), "description": "OPENROUTER INC",
     "merchant_name": "OpenRouter", "transaction_type": "debit", "category": "Software",
     "amount_gbp": 15.1, "fx_rate": 1.3245, "fee": 0.45},
    {"amount": 10.0, "currency": "USD", "date": datetime(2026, 9, 28), "description": "OPENROUTER INC",
     "merchant_name": "OpenRouter", "transaction_type": "debit", "category": "Software",
     "amount_gbp": 7.48, "fx_rate": 1.3369},
    {"amount": 5.0, "currency": "GBP", "date": datetime(2026, 9, 12), "description": "OPENROUTER TOPUP",
     "merchant_name": "OpenRouter", "transaction_type": "debit", "category": "Software"},
]
EAT_DOCS = [
    {"amount": 41.2, "currency": "GBP", "date": datetime(2026, 10, 3), "merchant_name": "Pret"},
    {"amount": 63.0, "currency": "GBP", "date": datetime(2026, 9, 14), "merchant_name": "Nando's"},
    {"amount": 28.5, "currency": "GBP", "date": datetime(2026, 7, 21), "merchant_name": "Wagamama"},
]

CASES = [
    dict(id="table-01-openrouter", question="Tabulate my OpenRouter transactions", screen="spend",
         tool="search_transactions"),
    dict(id="table-02-eating-out-by-month", question="Tabulate my eating out by month", screen="spend",
         tool="get_category_spend"),
]
SEEN: dict[str, list] = {}


async def _fake_execute(uid, name, args):
    SEEN.setdefault(uid, []).append((name, dict(args or {})))
    want = bool((args or {}).get("as_table")) and (args or {}).get("_table_ok") is True
    if name == "search_transactions":
        total = sum(d["amount"] for d in FX_DOCS)
        res = {"count": len(FX_DOCS), "match_kind": "text", "matched_count": len(FX_DOCS),
               "matched_spent": penny_tools._money(total, 2), "matched_received": penny_tools._money(0, 2),
               "truncated": False,
               "transactions": [{"description": d["merchant_name"], "date": d["date"].date().isoformat(),
                                 "amount": penny_tools._money(d["amount"], 2)} for d in FX_DOCS]}
        if want:
            res["_table"] = penny_tools._transactions_table(FX_DOCS, None, {"matched_count": len(FX_DOCS)})
        return res
    if name == "get_category_spend":
        months = int((args or {}).get("months") or (6 if want else 0))
        res = {"category": "Eating Out", "period": {"start": "2026-09-18", "end": "2026-10-17"},
               "this_period": {"spent": penny_tools._money(41.2), "payments_count": 1}, "top_merchants": []}
        if months:
            tot = sum(d["amount"] for d in EAT_DOCS)
            res["last_n_months"] = {"months": months, "spent": penny_tools._money(tot), "payments_count": len(EAT_DOCS),
                                    "window": {"from": "2026-04-13", "to": "2026-10-10", "days": 180},
                                    "average_per_week": penny_tools._money(tot / (180 / 7), 2)}
        if want and months:
            res["_table"] = penny_tools._category_months_table("Eating Out", EAT_DOCS, date(2026, 4, 13), TODAY)
        return res
    return {"error": "no data available for that in this evaluation"}


def _judge(case, result, seen):
    if result is None:
        return "refused"
    calls = [a for n, a in seen if n == case["tool"]]
    if not calls:
        return "wrong_tool"
    if not calls[0].get("as_table"):
        return "no_as_table"
    if not result.get("table"):
        return "no_table_attached"
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if "|" in reply or "\n" in (result.get("reply") or ""):
        return "typed_a_table"
    if case["tool"] == "get_category_spend" and not calls[0].get("months"):
        return "ok_no_months"
    return "ok"


async def _run(out):
    penny_agent.execute_tool = _fake_execute
    penny_agent.timeutil.user_today = lambda: TODAY
    rows = []
    for case in CASES:
        uid = f"g251-eval-{case['id']}"
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
               "table_rows": len(((result or {}).get("table") or {}).get("rows") or [])}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False, default=str))
    total = round(sum(r["cost_usd"] for r in rows), 4)
    print("TOTAL_COST_USD", total)
    if out:
        Path(out).write_text(json.dumps({"total_cost_usd": total, "rows": rows}, indent=1, ensure_ascii=False, default=str))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    try:
        await _run(args.out)
    finally:
        await db.client.drop_database(_SCRATCH_DB)


if __name__ == "__main__":
    asyncio.run(main())
