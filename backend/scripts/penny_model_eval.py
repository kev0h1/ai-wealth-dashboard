"""G243 — LIVE (OpenRouter) model comparison for Penny's tool loop. Never run in CI.

Runs the REAL `run_penny_agent` loop (real system prompt, real tool catalogue,
real `calculate` and `explain`) with `penny_agent._MODEL` replaced by
`--model`, against a SYNTHETIC fixture world: G241's arithmetic corpus plus
`tests/penny_routing_corpus.py` (about 33 questions, one correct tool each for
the routing rows). Every data tool other than calculate/explain is answered
from fixtures, so no real user data is read or written.

Safety (same as penny_live_eval.py, which this imports for its scratch-DB and
key handling): the key is read from the UAT .env into this process only and is
never printed; MONGO_DB is a generated `wealth_test_<epoch>_<hex>` database
dropped at the end through app.db.guard.guarded_drop_database; every request
carries provider.data_collection = deny (OPENROUTER_PROVIDER_PREFS, merged in
by app.core.llm.openrouter_chat).

Spend rules: the per-model estimate is printed BEFORE any call. A run with no
--limit is refused unless --confirm-full-run is passed, an estimate above
--budget-usd is refused, an estimate above 3 USD is refused outright, and the
run stops as soon as actual usage.cost reaches --budget-usd.

Per question it logs: tool calls (names, in order), served model (the response
`model` field, recorded by the metering row), rounds, tool-selection and
answer correctness, wrongful refusal, latency and usage.cost.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_model_eval.py --model anthropic/claude-haiku-4-5 --limit 3 --out /tmp/g243/proof-haiku45.json
    PYTHONPATH=. .venv/bin/python scripts/penny_model_eval.py --model google/gemini-3.8-flash --confirm-full-run --budget-usd 2 --out /tmp/g243/full-gemini38.json
    --pre-fix   simulate pre-fix behaviour (search_transactions finds no Padel merchant); only
                meaningful on code from before the G243 commit, where it is the default.
    --reasoning-none   send reasoning.effort = none (G239 did this for every model).
"""
import argparse
import asyncio
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

import penny_live_eval as live  # sets the scratch MONGO_DB and the key BEFORE app imports

import penny_arithmetic_corpus as g241  # noqa: E402
import penny_routing_corpus as routing  # noqa: E402
from app.db.collections import db, llm_usage_col  # noqa: E402
from app.db.guard import guarded_drop_database  # noqa: E402
from app.services import penny_agent, penny_tools  # noqa: E402

MAX_ESTIMATE_USD = 3.0
EST_ROUNDS = 2.5          # rounds per question, conservative (observed 2 to 3)
EST_PROMPT_TOKENS = 19000  # per round, uncached (G243 trace: 18.2k to 19.2k)
EST_COMPLETION_TOKENS = 150
FALLBACK_PRICE = (1e-6, 5e-6)  # haiku 4.5 rates, used when /models reports -1 (routers)


def _models_info(model_id: str):
    req = urllib.request.Request("https://openrouter.ai/api/v1/models")
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)["data"]
    by_id = {m["id"]: m for m in data}
    m = by_id.get(model_id) or by_id.get(model_id.replace("-4-5", "-4.5"))
    return m


def _estimate(model_info, n_questions: int):
    price_note = ""
    if model_info is None:
        p_in, p_out = FALLBACK_PRICE
        price_note = "not in /models, fallback haiku-4.5 rates"
    else:
        pr = model_info.get("pricing") or {}
        try:
            p_in, p_out = float(pr.get("prompt")), float(pr.get("completion"))
        except (TypeError, ValueError):
            p_in = p_out = -1
        if p_in < 0 or p_out < 0:
            p_in, p_out = FALLBACK_PRICE
            price_note = "router, /models reports -1, fallback haiku-4.5 rates"
    per_q = EST_ROUNDS * (EST_PROMPT_TOKENS * p_in + EST_COMPLETION_TOKENS * p_out)
    return per_q, per_q * n_questions, price_note


def _figure_ok(case, reply: str):
    exp = case.get("expect_any")
    if not exp:
        return True
    return any(x in reply for x in exp)


def _required_tools(case):
    if "required" in case:
        return list(case["required"])
    req = list(case.get("tools") or [])
    if case["kind"] != "control" and case.get("must_calc", True) and "calculate" not in req:
        req.append("calculate")
    return req


def _score(case, result, used):
    """(tool_ok, answer_ok, refused, wrongful_refusal)"""
    declines_ok = bool(case.get("expect_declined") or case.get("declined_ok"))
    if result is None or result.get("provider_error"):
        refused = result is None
        if case.get("expect_declined") or (refused and case.get("declined_ok")):
            return True, True, refused, False
        return False, False, refused, refused and not declines_ok
    reply = f"{result.get('headline', '')} {result.get('reply', '')}"
    if case.get("expect_declined"):
        return False, False, False, False
    if case.get("expect_no_any"):
        bad = any(x.lower() in reply.lower() for x in case["expect_no_any"])
        return True, not bad, False, False
    required = _required_tools(case)
    tool_ok = set(required) <= set(used)
    if case.get("first"):
        tool_ok = tool_ok and bool(used) and used[0] == case["first"]
    return tool_ok, _figure_ok(case, reply), False, False


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--confirm-full-run", action="store_true")
    ap.add_argument("--budget-usd", type=float, default=1.5)
    ap.add_argument("--out", default=None)
    ap.add_argument("--pre-fix", action="store_true")
    ap.add_argument("--reasoning-none", action="store_true")
    ap.add_argument("--estimate-only", action="store_true")
    ap.add_argument("--rescore", default=None, help="re-apply the declined_ok scoring fix to a saved run JSON, no model calls")
    args = ap.parse_args()
    if args.rescore:
        saved = json.loads(Path(args.rescore).read_text())
        by_id = {c["id"]: c for c in g241.CASES}
        for r in saved["rows"]:
            c = by_id.get(r["id"])
            if c and c.get("declined_ok") and r["refused"]:
                r["tool_ok"] = r["answer_ok"] = True
        s = saved["summary"]
        s["tool_selection_ok"] = sum(r["tool_ok"] for r in saved["rows"])
        s["answer_ok"] = sum(r["answer_ok"] for r in saved["rows"])
        Path(args.rescore).write_text(json.dumps(saved, indent=1, ensure_ascii=False))
        print("RESCORED", args.rescore, s["tool_selection_ok"], s["answer_ok"])
        return

    cases = [dict(c) for c in g241.CASES] + [dict(c, kind="routing") for c in routing.ROUTING_CASES]
    if args.only:
        keep = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in keep]
    if args.limit:
        # Proof subset: one Padel row, one literal arithmetic row, one non-category routing row.
        pick = [c for c in cases if c["id"] in ("route-01-padel-custom-category", "calc-01-literal-minus", "route-06-goal-remaining")]
        cases = (pick + [c for c in cases if c not in pick])[: args.limit]
    info = _models_info(args.model)
    per_q, total_est, note = _estimate(info, len(cases))
    supported = (info or {}).get("supported_parameters") or []
    print(f"MODEL {args.model} | /models listed={info is not None} tools={'tools' in supported} tool_choice={'tool_choice' in supported}")
    print(f"ESTIMATE {len(cases)} questions x {EST_ROUNDS} rounds x {EST_PROMPT_TOKENS} prompt tokens: ~${per_q:.4f}/question, ~${total_est:.2f} total {note} (budget ${args.budget_usd:.2f}, hard ceiling ${MAX_ESTIMATE_USD:.2f})")
    if total_est > MAX_ESTIMATE_USD:
        sys.exit("REFUSED: estimate above the 3 USD single-model ceiling")
    if not args.limit and not args.confirm_full_run:
        sys.exit("REFUSED: unbounded run; pass --limit N for a proof or --confirm-full-run")
    if total_est > args.budget_usd:
        sys.exit("REFUSED: estimate above --budget-usd")
    if args.estimate_only:
        return

    penny_agent._MODEL = args.model
    category_fallback = hasattr(penny_tools, "_resolve_user_category") and not args.pre_fix
    print(f"fixture search mode: {'category fallback' if category_fallback else 'pre-fix (merchant text only)'}")
    state = {"calls": [], "rounds": []}

    async def recording_execute(uid, name, a):
        state["calls"].append(name)
        return await fake(uid, name, a)

    real = penny_tools.execute_tool
    fake = routing.fake_execute_factory(real, g241.FIXTURES, g241.VERDICT_BY_OFFSET, category_fallback)
    penny_agent.execute_tool = recording_execute
    penny_agent.timeutil.user_today = lambda: __import__("datetime").date.fromisoformat(g241.TODAY)

    orig_chat = penny_agent.openrouter_chat

    async def chat(body, **kw):
        if args.reasoning_none:
            body = dict(body, reasoning={"effort": "none"})
        r = await orig_chat(body, **kw)
        try:
            d = r.json()
            ch = (d.get("choices") or [{}])[0]
            msg = ch.get("message") or {}
            state["rounds"].append({
                "status": r.status_code, "finish": ch.get("finish_reason"),
                "tool_calls": len(msg.get("tool_calls") or []), "content_len": len(msg.get("content") or ""),
                "served": d.get("model"),
            })
        except Exception:
            state["rounds"].append({"status": r.status_code})
        return r

    penny_agent.openrouter_chat = chat

    try:
        rows, running = [], 0.0
        for case in cases:
            if running >= args.budget_usd:
                print(f"STOPPED: actual cost ${running:.4f} reached --budget-usd")
                break
            uid = f"g243-eval-{case['id']}"
            await db.user_categories.insert_one({"user_id": uid, "categories": [{"name": n, "kind": "discretionary"} for n in routing.CUSTOM_CATEGORIES]})
            state["calls"], state["rounds"] = [], []
            t0 = time.monotonic()
            result = await penny_agent.run_penny_agent(uid, case["question"], [], case["screen"], "")
            dt = time.monotonic() - t0
            usage = await llm_usage_col.find({"user_id": uid}).to_list(50)
            cost = sum(float(u.get("cost_usd") or 0) for u in usage)
            running += cost
            served = sorted({u.get("model") for u in usage if u.get("model")})
            used = list(state["calls"])
            tool_ok, answer_ok, refused, wrongful = _score(case, result, used)
            row = {
                "id": case["id"], "kind": case["kind"], "question": case["question"],
                "tools_called": used, "tool_ok": tool_ok, "answer_ok": answer_ok and tool_ok or answer_ok,
                "refused": refused, "wrongful_refusal": wrongful,
                "provider_error": bool(result and result.get("provider_error")),
                "rounds": len(usage), "served_models": served, "latency_s": round(dt, 2), "cost_usd": round(cost, 6),
                "prompt_tokens": sum(int(u.get("prompt_tokens") or 0) for u in usage),
                "completion_tokens": sum(int(u.get("completion_tokens") or 0) for u in usage),
                "round_detail": list(state["rounds"]),
                "reply": ((result or {}).get("reply") or "")[:300],
            }
            rows.append(row)
            print(json.dumps({k: row[k] for k in ("id", "tools_called", "tool_ok", "answer_ok", "refused", "rounds", "served_models", "latency_s", "cost_usd")}, ensure_ascii=False), f"running=${running:.4f}")

        n = len(rows)
        lat = sorted(r["latency_s"] for r in rows)
        summary = {
            "model": args.model, "questions": n, "prefix_mode": not category_fallback, "reasoning_none": args.reasoning_none,
            "tool_selection_ok": sum(r["tool_ok"] for r in rows), "answer_ok": sum(r["answer_ok"] for r in rows),
            "wrongful_refusals": sum(r["wrongful_refusal"] for r in rows), "provider_errors": sum(r["provider_error"] for r in rows),
            "median_latency_s": statistics.median(lat) if lat else None,
            "p95_latency_s": lat[min(n - 1, int(round(0.95 * (n - 1))))] if lat else None,
            "total_cost_usd": round(running, 5), "cost_per_question_usd": round(running / n, 5) if n else None,
            "served_models": {m: sum(1 for r in rows if m in r["served_models"]) for m in sorted({m for r in rows for m in r["served_models"]})},
            "no_tool_calls_anywhere": all(not r["tools_called"] for r in rows),
            "estimate_usd": round(total_est, 4),
        }
        req_rows = [r for r in rows if r["kind"] != "control"]
        summary["verdict_cannot_run_loop"] = bool(req_rows) and all(not r["tools_called"] for r in req_rows) and n >= 3
        print("SUMMARY", json.dumps(summary, ensure_ascii=False))
        if args.out:
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            Path(args.out).write_text(json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False))
    finally:
        await guarded_drop_database(db.client, live._SCRATCH_DB)


if __name__ == "__main__":
    asyncio.run(main())
