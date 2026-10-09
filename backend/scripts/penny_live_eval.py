"""G241 — LIVE (OpenRouter) runner for the arithmetic corpus. Never run in CI.

Drives the REAL `run_penny_agent` loop (real system prompt, real tool
catalogue, real `calculate`) against a SYNTHETIC fixture world from
`tests/penny_arithmetic_corpus.py`; every data tool other than `calculate`
is answered from fixtures, so no real user data is read or written.

Safety:
* the API key is read from the UAT .env into this process only and is never
  printed or logged;
* MONGO_DB is forced to a disposable, generated `wealth_test_<epoch>_<hex>`
  database BEFORE the app is imported (so the llm_usage metering rows the
  loop writes land there, never in `wealth`), and that database is dropped at
  the end;
* every case runs under its own synthetic user id.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_live_eval.py --label before --out /tmp/g241/before.json
    ... --only calc-01-literal-minus,calc-05-goal-gap
Cost per case is read back from the metering rows (cost_usd).
"""
import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

_SCRATCH_DB = f"wealth_test_{int(time.time())}_{uuid.uuid4().hex[:8]}"
os.environ["MONGO_DB"] = _SCRATCH_DB

from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values("/root/ai-wealth-dashboard/backend/.env")
os.environ["OPENROUTER_API_KEY"] = _env.get("OPENROUTER_API_KEY", "")
del _env

import penny_arithmetic_corpus as corpus  # noqa: E402
from app.services import penny_agent  # noqa: E402
from app.services import penny_tools  # noqa: E402
from app.db.collections import db, llm_usage_col  # noqa: E402


async def _fake_execute(uid, name, args):
    if name == "calculate":
        return await penny_tools.execute_tool(uid, name, args)
    if name == "get_spend_verdict":
        return corpus.VERDICT_BY_OFFSET.get(int((args or {}).get("period_offset") or 0), corpus.VERDICT_BY_OFFSET[0])
    if name in corpus.FIXTURES:
        return corpus.FIXTURES[name]
    return {"error": "no data available for that in this evaluation"}


def _classify(case, result):
    if result is None:
        return "declined" if (case.get("expect_declined") or case.get("declined_ok")) else "refused"
    if result.get("provider_error"):
        return "provider_error"
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if case.get("expect_declined"):
        return "wrong"
    if case.get("expect_no_any"):
        low = reply.lower()
        return "wrong" if any(x.lower() in low for x in case["expect_no_any"]) else "answered"
    if case["kind"] != "control" and case.get("must_calc", True) and "calculate" not in (result.get("tools_used") or []):
        # Right figure or not, rule 1 says arithmetic goes through `calculate`.
        return "mental_maths"
    ok = any(x in reply for x in case.get("expect_any", [])) if case.get("expect_any") else True
    if case.get("expect_hedge"):
        ok = ok and any(h.lower() in reply.lower() for h in case["expect_hedge"])
    if result.get("scenario"):
        ok = False  # G246: the simulator card path no longer exists
    if case.get("expect_all"):
        ok = ok and all(x in reply for x in case["expect_all"])
    return "answered" if ok else "wrong"


async def _run():
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", default="run")
    ap.add_argument("--out", default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--reclassify", default=None, help="re-score a saved JSON with the current rules, no model calls")
    args = ap.parse_args()
    if args.reclassify:
        saved = json.loads(Path(args.reclassify).read_text())
        by_id = {c["id"]: c for c in corpus.CASES}
        tally = {}
        for r in saved["rows"]:
            res = None if r["outcome"] in ("refused", "declined") else {"headline": "", "headline": r.get("headline") or "", "reply": r["reply"], "tools_used": r["tools_used"]}
            r["outcome"] = _classify(by_id[r["id"]], res)
            tally[r["outcome"]] = tally.get(r["outcome"], 0) + 1
        print("TALLY", tally)
        for r in saved["rows"]:
            print(r["id"], r["outcome"])
        return
    only = set(args.only.split(",")) if args.only else None
    penny_agent.execute_tool = _fake_execute
    penny_agent.timeutil.user_today = lambda: __import__("datetime").date.fromisoformat(corpus.TODAY)

    rows = []
    for case in corpus.CASES:
        if only and case["id"] not in only:
            continue
        uid = f"g241-eval-{case['id']}"
        t0 = time.monotonic()
        result = await penny_agent.run_penny_agent(uid, case["question"], [], case["screen"], "")
        dt = time.monotonic() - t0
        usage = await llm_usage_col.find({"user_id": uid}).to_list(50)
        cost = sum(float(u.get("cost_usd") or 0) for u in usage)
        ptoks = sum(int(u.get("prompt_tokens") or 0) for u in usage)
        ctoks = sum(int(u.get("completion_tokens") or 0) for u in usage)
        cached = sum(int(u.get("cached_tokens") or 0) for u in usage)
        outcome = _classify(case, result)
        row = {
            "id": case["id"], "kind": case["kind"], "question": case["question"],
            "outcome": outcome, "rounds": len(usage), "cost_usd": round(cost, 5),
            "prompt_tokens": ptoks, "cached_tokens": cached, "completion_tokens": ctoks,
            "seconds": round(dt, 1),
            "tools_used": (result or {}).get("tools_used"),
            "headline": (result or {}).get("headline"),
            "reply": ((result or {}).get("reply") or "")[:400],
        }
        rows.append(row)
        print(json.dumps({k: row[k] for k in ("id", "outcome", "rounds", "cost_usd", "tools_used", "headline", "reply")}, ensure_ascii=False))
    total = round(sum(r["cost_usd"] for r in rows), 4)
    tally = {}
    for r in rows:
        tally[r["outcome"]] = tally.get(r["outcome"], 0) + 1
    print("TALLY", tally, "TOTAL_COST_USD", total)
    if args.out:
        Path(args.out).write_text(json.dumps({"label": args.label, "tally": tally, "total_cost_usd": total, "rows": rows}, indent=1, ensure_ascii=False))


async def main():
    try:
        await _run()
    finally:
        # Always drop the scratch wealth_test_* database, even after a
        # mid-run crash (same guarded client the app uses, no bare drop).
        await db.client.drop_database(_SCRATCH_DB)


if __name__ == "__main__":
    asyncio.run(main())
