"""G254 - LIVE (OpenRouter) run of Kevin's five-question DigitalOcean thread.
Never run in CI.

Drives the REAL `run_penny_agent` loop (real system prompt, real tool catalogue,
real search_transactions executor) over the SYNTHETIC fixture in
tests/penny_thread_fixture.py, carrying history and `last_result` between turns
the way /can-i and the client do. No real user data is read or written.

Safety: the API key is read from the UAT .env into this process only and is
never printed; MONGO_DB is forced to a disposable `wealth_test_*` database
BEFORE the app is imported (llm_usage rows land there) and dropped in a
finally; a hard spend cap aborts the run.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_thread_live_eval.py --out /tmp/g254/live.json
"""
import argparse
import asyncio
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

_SCRATCH_DB = f"wealth_test_{int(time.time())}_{uuid.uuid4().hex[:8]}"
os.environ["MONGO_DB"] = _SCRATCH_DB

from dotenv import dotenv_values  # noqa: E402

_env = dotenv_values("/root/ai-wealth-dashboard/backend/.env")
os.environ["OPENROUTER_API_KEY"] = _env.get("OPENROUTER_API_KEY", "")
del _env

from app.db.collections import db, llm_usage_col  # noqa: E402
from app.services import penny_agent, penny_tools  # noqa: E402
from tests import penny_thread_fixture as fx  # noqa: E402

COST_CAP_USD = 0.5
REFUSAL = re.compile(r"outside what i can work out|answer from your live numbers", re.I)
NO_RATE = re.compile(r"(no|not|n't|without|neither|none)[^.]{0,80}\b(rate|fx|exchange)|\b(rate|fx|exchange)[^.]{0,80}(not|n't|no |none|missing|absent)", re.I)
SEEN: list = []


async def _execute(uid, name, args):
    out = await _real_execute(uid, name, args)
    SEEN.append({"tool": name, "args": {k: v for k, v in (args or {}).items() if not str(k).startswith("_")},
                 "ids": sorted(r["id"] for r in (out.get("transactions") or []) if isinstance(r, dict) and r.get("id")),
                 "match_kind": out.get("match_kind"), "fx_fields": out.get("fx_fields")})
    return out


def _judge(turn, result, call):
    if result is None:
        return "refused"
    if result.get("loop_failed"):
        return "loop_failed"
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if REFUSAL.search(reply):
        return "canned_refusal_text"
    if call is None:
        return "no_search_call"
    if sorted(call["ids"]) != sorted(turn["expect_ids"]):
        return f"wrong_rows:{call['ids']}"
    if turn.get("honest_no_rate") and not NO_RATE.search(reply):
        return "did_not_say_no_rate"
    return "ok"


async def _run(out):
    global _real_execute
    _real_execute = penny_tools.execute_tool
    penny_agent.execute_tool = _execute
    fx.install(penny_tools, setattr)
    penny_agent.timeutil.user_today = lambda: fx.TODAY
    uid = fx.UID
    history: list[dict] = []
    last_result = None
    rows = []
    spent = 0.0
    for turn in fx.THREAD:
        n0 = len(SEEN)
        kwargs = {"last_result": last_result} if last_result else {}
        t0 = time.monotonic()
        result = await penny_agent.run_penny_agent(uid, turn["q"], history[-6:], "spend", "", **kwargs)
        dt = time.monotonic() - t0
        usage = await llm_usage_col.find({"user_id": uid}).to_list(200)
        cost = sum(float(u.get("cost_usd") or 0) for u in usage)
        call = SEEN[n0] if len(SEEN) > n0 else None
        outcome = _judge(turn, result, call)
        row = {"question": turn["q"], "outcome": outcome, "calls": SEEN[n0:], "seconds": round(dt, 1),
               "cumulative_cost_usd": round(cost, 5),
               "prose_fallback": bool((result or {}).get("prose_fallback")),
               "headline": (result or {}).get("headline"), "reply": ((result or {}).get("reply") or "")[:500]}
        rows.append(row)
        print(json.dumps(row, ensure_ascii=False, default=str))
        if result and not result.get("loop_failed"):
            history += [{"role": "user", "content": turn["q"]},
                        {"role": "assistant", "content": ((result.get("reply") or result.get("headline") or ""))[:300]}]
            last_result = result.get("last_result") or last_result
        spent = cost
        if spent > COST_CAP_USD:
            print("COST CAP HIT, stopping")
            break
    rounds = len(await llm_usage_col.find({"user_id": uid}).to_list(500))
    print("TOTAL_COST_USD", round(spent, 4), "ROUNDS", rounds)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(json.dumps({"total_cost_usd": round(spent, 4), "rounds": rounds, "rows": rows},
                                        indent=1, ensure_ascii=False, default=str))


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
