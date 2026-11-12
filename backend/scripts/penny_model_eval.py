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

G459 adds `--multi-turn`: the multi-turn eval set in tests/penny_eval (scripted user turns, history built
exactly as production builds it, fixtures served by penny_eval.world.World, automatic per-rubric scoring),
`--runs N` repeats to show noise. The estimate there is cache-aware (`--cache-share`, default 0.8, the UAT trace share) and the
no-cache upper bound is printed beside it; the 3 USD ceiling applies to the expected estimate and the run
stops as soon as actual cost reaches --budget-usd.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/penny_model_eval.py --multi-turn --model anthropic/claude-haiku-4-5 --runs 3 --budget-usd 2 --confirm-full-run --out /tmp/g459/haiku45.json
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
from penny_eval import cases as eval_cases  # noqa: E402
from penny_eval import runner as eval_runner  # noqa: E402
from penny_eval import scoring as eval_scoring  # noqa: E402
from penny_eval import world as eval_world  # noqa: E402
import penny_routing_corpus as routing  # noqa: E402
from app.db.collections import db, llm_usage_col, preferences_col  # noqa: E402
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


EST_MT_PROMPT_TOKENS = 22000  # G459: UAT trace mean prompt tokens per round (22.3k)
EST_MT_ROUNDS = 2.3           # UAT trace: 98 of 130 messages took 2 rounds, 12 took 3, 1 took 4


def _mt_estimate(model_info, n_messages: int, cache_share: float):
    pr = (model_info or {}).get("pricing") or {}
    try:
        p_in, p_out = float(pr.get("prompt")), float(pr.get("completion"))
        p_cr = float(pr.get("input_cache_read") or p_in)
    except (TypeError, ValueError):
        p_in, p_out = FALLBACK_PRICE
        p_cr = p_in / 10
    if p_in < 0 or p_out < 0:
        p_in, p_out = FALLBACK_PRICE
        p_cr = p_in / 10
    per_round_nocache = EST_MT_PROMPT_TOKENS * p_in + EST_COMPLETION_TOKENS * p_out
    per_round = EST_MT_PROMPT_TOKENS * ((1 - cache_share) * p_in + cache_share * p_cr) + EST_COMPLETION_TOKENS * p_out
    return EST_MT_ROUNDS * per_round * n_messages, EST_MT_ROUNDS * per_round_nocache * n_messages


def _pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))] if xs else None


def _mt_summary(model, n_cases, msg_rows, all_rows, reasoning_none, expected, upper, stopped):
    scored = [m for m in msg_rows if not m.get("provider_error")]
    lat = [r["latency_s"] for r in scored]
    rounds = [r for m in scored for r in m["finish_reasons"]]
    repairs = sum(max(0, sum(1 for f in m["finish_reasons"] if f != "tool_calls") - 1) for m in scored)
    running = sum(m["cost_usd"] for m in msg_rows)
    per_run = {}
    for run in sorted({r["run"] for r in all_rows}):
        per_run[run] = eval_scoring.pass_rates([r for r in all_rows if r["run"] == run])
    per_case = {}
    for r in all_rows:
        d = per_case.setdefault(r["case"], {"passed": 0, "total": 0})
        d["total"] += 1
        d["passed"] += int(r["passed"])
    return {
        "model": model, "runs": len(per_run), "cases": n_cases, "messages": len(msg_rows), "reasoning_none": reasoning_none,
        "pass_rates": eval_scoring.pass_rates(all_rows), "per_run_pass_rates": per_run, "per_case": per_case,
        "rounds_per_message": round(sum(m["rounds"] for m in scored) / len(scored), 2) if scored else None,
        "provider_errors_excluded": len(msg_rows) - len(scored),
        "unanswered_messages": sum(1 for m in scored if not m["answered"]),
        "format_repair_rounds": repairs,
        "latency_p50_s": _pct(lat, 0.5), "latency_p95_s": _pct(lat, 0.95),
        "cost_per_message_usd": round(sum(m["cost_usd"] for m in scored) / len(scored), 5) if scored else None, "total_cost_usd": round(running, 4),
        "truncated_rounds": sum(1 for f in rounds if f == "length"), "total_rounds": len(rounds),
        "truncation_rate": round(sum(1 for f in rounds if f == "length") / len(rounds), 4) if rounds else None,
        "served_models": sorted({m for r in msg_rows for m in r.get("served_models", [])}),
        "estimate_expected_usd": expected, "estimate_upper_usd": upper, "stopped_on_budget": stopped,
    }


def rescore_multi_turn(paths):
    """Re-apply the CURRENT regex/tool checks to saved replies, no model calls. `figures` checks need the tool
    results, which are not saved, so they keep their saved verdict."""
    by_id = {c["id"]: c for c in eval_cases.CASES}
    for p in paths:
        d = json.loads(Path(p).read_text())
        old = {(r["case"], r["run"], r["turn"], r["name"]): r for r in d["checks"]}
        new_checks = []
        for m in d["messages"]:
            if m.get("provider_error"):
                continue
            turn = by_id[m["case"]]["turns"][m["turn"]]
            outcome = {"reply": m["reply"], "answered": m["answered"], "tools": m["tools"], "results": [], "thread_text": ""}
            for c in turn["checks"]:
                kept = old.get((m["case"], m["run"], m["turn"], c["name"]))
                if c["kind"] == "figures" and kept:
                    new_checks.append(kept)
                    continue
                ok, detail = eval_scoring.run_check(c, outcome)
                new_checks.append({"rubric": c["rubric"], "name": c["name"], "passed": bool(ok), "detail": detail,
                                   "case": m["case"], "run": m["run"], "turn": m["turn"]})
            m["checks"] = [{k: x[k] for k in ("rubric", "name", "passed", "detail")} for x in new_checks if x["case"] == m["case"] and x["run"] == m["run"] and x["turn"] == m["turn"]]
        d["checks"] = new_checks
        sm = d["summary"]
        d["summary"] = _mt_summary(sm["model"], sm["cases"], d["messages"], new_checks, sm["reasoning_none"],
                                   sm["estimate_expected_usd"], sm["estimate_upper_usd"], sm["stopped_on_budget"])
        Path(p).write_text(json.dumps(d, indent=1, ensure_ascii=False))
        print("RESCORED", p, d["summary"]["pass_rates"]["overall"])


def merge_runs(paths, out):
    msgs, checks, est, up, model, red, stopped, n_cases = [], [], 0.0, 0.0, None, False, False, 0
    for p in paths:
        d = json.loads(Path(p).read_text())
        msgs += d["messages"]
        checks += d["checks"]
        sm = d["summary"]
        est += sm["estimate_expected_usd"]
        up += sm["estimate_upper_usd"]
        model, red, n_cases = sm["model"], sm["reasoning_none"], sm["cases"]
        stopped = stopped or sm["stopped_on_budget"]
    summary = _mt_summary(model, n_cases, msgs, checks, red, round(est, 3), round(up, 3), stopped)
    print("MERGED", json.dumps(summary, ensure_ascii=False))
    Path(out).write_text(json.dumps({"summary": summary, "messages": msgs, "checks": checks}, indent=1, ensure_ascii=False))


async def multi_turn(args):
    import datetime as _dt

    cases = list(eval_cases.CASES)
    if args.only:
        keep = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in keep]
    n_live = sum(1 for c in cases for t in c["turns"] if t.get("checks"))
    info = _models_info(args.model)
    n_msgs = n_live * args.runs
    expected, upper = _mt_estimate(info, n_msgs, args.cache_share)
    print(f"MODEL {args.model} | /models listed={info is not None}")
    print(f"ESTIMATE {len(cases)} cases, {n_live} live messages x {args.runs} runs = {n_msgs} messages: expected ~${expected:.2f} "
          f"(cache share {args.cache_share}), no-cache upper bound ~${upper:.2f} (budget ${args.budget_usd:.2f}, hard ceiling ${MAX_ESTIMATE_USD:.2f})")
    if expected > MAX_ESTIMATE_USD:
        sys.exit("REFUSED: expected estimate above the 3 USD ceiling; reduce --runs")
    if expected > args.budget_usd:
        sys.exit("REFUSED: expected estimate above --budget-usd; reduce --runs")
    if not args.confirm_full_run and not args.only:
        sys.exit("REFUSED: pass --confirm-full-run (or --only for a proof)")
    if args.estimate_only:
        return

    penny_agent._MODEL = args.model
    penny_agent.timeutil.user_today = lambda: _dt.date.fromisoformat(eval_world.TODAY)
    real_execute = penny_tools.execute_tool
    state = {"rounds": []}
    orig_chat = penny_agent.openrouter_chat

    async def chat(body, **kw):
        if args.reasoning_none:
            body = dict(body, reasoning={"effort": "none"})
        r = await orig_chat(body, **kw)
        try:
            ch = (r.json().get("choices") or [{}])[0]
            state["rounds"].append({"finish": ch.get("finish_reason"), "tool_calls": len((ch.get("message") or {}).get("tool_calls") or [])})
        except Exception:
            state["rounds"].append({"finish": "unparsed"})
        return r

    penny_agent.openrouter_chat = chat
    all_rows, msg_rows, running, stopped = [], [], 0.0, False
    try:
        for run in range(args.run_start, args.run_start + args.runs):
            for case in cases:
                if running >= args.budget_usd:
                    stopped = True
                    print(f"STOPPED: actual cost ${running:.4f} reached --budget-usd")
                    break
                uid = f"g459-r{run}-{case['id']}"
                await preferences_col.insert_one({"user_id": uid, "penny_agent_consent": True})
                await db.user_categories.insert_one({"user_id": uid, "categories": [{"name": n, "kind": "discretionary"} for n in eval_world.CUSTOM_CATEGORIES]})
                seen = {"n": 0}

                def install(world):
                    penny_agent.execute_tool = world.execute

                async def before():
                    state["rounds"] = []

                async def after(rec):
                    usage = await llm_usage_col.find({"user_id": uid}).sort("ts", 1).to_list(200)
                    new = usage[seen["n"]:]
                    seen["n"] = len(usage)
                    rec["rounds"] = len(new)
                    rec["cost_usd"] = round(sum(float(u.get("cost_usd") or 0) for u in new), 6)
                    rec["prompt_tokens"] = sum(int(u.get("prompt_tokens") or 0) for u in new)
                    rec["cached_tokens"] = sum(int(u.get("cached_tokens") or 0) for u in new)
                    rec["completion_tokens"] = sum(int(u.get("completion_tokens") or 0) for u in new)
                    rec["served_models"] = sorted({u.get("model") for u in new if u.get("model")})
                    rec["finish_reasons"] = [r.get("finish") for r in state["rounds"]]
                    rec["run"] = run

                recs = await eval_runner.run_case(penny_agent.run_penny_agent, case, uid, real_execute,
                                                  install=install, before_turn=before, after_turn=after)
                for rec in recs:
                    running += rec["cost_usd"]
                    msg_rows.append(rec)
                    if not rec["provider_error"]:  # an OpenRouter connection failure is not a model answer
                        all_rows.extend(dict(c, case=rec["case"], run=run, turn=rec["turn"]) for c in rec["checks"])
                    bad = [c["name"] for c in rec["checks"] if not c["passed"]]
                    print(f"run{run} {rec['case']}#{rec['turn']} tools={rec['tools']} rounds={rec['rounds']} {rec['latency_s']}s "
                          f"${rec['cost_usd']:.4f} fail={bad} running=${running:.4f}")
            if stopped:
                break

        summary = _mt_summary(args.model, len(cases), msg_rows, all_rows, args.reasoning_none, expected, upper, stopped)
        print("SUMMARY", json.dumps(summary, ensure_ascii=False))
        if args.out:
            Path(args.out).parent.mkdir(parents=True, exist_ok=True)
            Path(args.out).write_text(json.dumps({"summary": summary, "messages": msg_rows, "checks": all_rows}, indent=1, ensure_ascii=False))
    finally:
        await guarded_drop_database(db.client, live._SCRATCH_DB)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only", default=None)
    ap.add_argument("--confirm-full-run", action="store_true")
    ap.add_argument("--budget-usd", type=float, default=1.5)
    ap.add_argument("--out", default=None)
    ap.add_argument("--pre-fix", action="store_true")
    ap.add_argument("--reasoning-none", action="store_true")
    ap.add_argument("--estimate-only", action="store_true")
    ap.add_argument("--multi-turn", action="store_true", help="G459: run tests/penny_eval multi-turn cases")
    ap.add_argument("--runs", type=int, default=1, help="G459: repeats of the multi-turn set (noise)")
    ap.add_argument("--run-start", type=int, default=1, help="G459: first run number (so separate invocations get distinct users)")
    ap.add_argument("--rescore-mt", default=None, help="G459: comma-separated multi-turn result JSONs to re-score with the current checks, no model calls")
    ap.add_argument("--merge", default=None, help="G459: comma-separated multi-turn result JSONs to merge, no model calls (needs --out)")
    ap.add_argument("--cache-share", type=float, default=0.8, help="G459: assumed share of prompt tokens read from cache in the estimate")
    ap.add_argument("--rescore", default=None, help="re-apply the declined_ok scoring fix to a saved run JSON, no model calls")
    args = ap.parse_args()
    if not args.model and not args.merge and not args.rescore and not args.rescore_mt:
        sys.exit("--model is required")
    if args.rescore_mt:
        return rescore_multi_turn(args.rescore_mt.split(","))
    if args.merge:
        return merge_runs(args.merge.split(","), args.out)
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

    if args.multi_turn:
        return await multi_turn(args)

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
