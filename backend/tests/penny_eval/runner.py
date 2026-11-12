"""G459: play one eval case through an agent function. Shared by the live script and the offline tests.

`agent_fn(uid, question, history, screen, context, last_result=...)` is `run_penny_agent` live, or a
stub in tests. The caller points `penny_agent.execute_tool` at `World.execute` (live) or does nothing
(stub). History is built with history.production_history, so the 300-character cut reproduces.
"""
import time

from .history import production_history
from .scoring import score_turn
from .world import World


def reply_text(result) -> tuple[str, bool, bool]:
    """(text, answered, is_proposal) from run_penny_agent's return value."""
    if not result or result.get("provider_error") or result.get("loop_failed") or result.get("consent_required"):
        return "", False, False
    if result.get("proposal"):
        p = result["proposal"]
        return f"{p.get('summary', '')} {p.get('consequence', '')}".strip(), True, True
    text = f"{result.get('headline', '')} {result.get('reply', '')}".strip()
    return text, bool(text), False


async def run_case(agent_fn, case: dict, uid: str, real_execute, *, install=None, before_turn=None, after_turn=None) -> list[dict]:
    world = World(real_execute, case.get("world"))
    if install:
        install(world)
    msgs: list[dict] = []
    thread: list[str] = []
    last_result = None
    records = []
    for i, turn in enumerate(case["turns"]):
        msgs.append({"role": "user", "content": turn["user"]})
        thread.append(turn["user"])
        if "checks" not in turn:  # scripted assistant answer
            if turn.get("kind") == "proposal":
                msgs.append({"role": "assistant", "kind": "proposal", "summary": turn["summary"], "status": turn.get("status", "pending")})
                thread.append(turn["summary"])
            else:
                msgs.append({"role": "assistant", "content": turn["reply"]})
                thread.append(turn["reply"])
            continue
        history = production_history(msgs[:-1])
        world.reset_turn()
        if before_turn:
            await before_turn()
        t0 = time.monotonic()
        result = await agent_fn(uid, turn["user"], history, case.get("screen"), "", last_result=last_result)
        latency = time.monotonic() - t0
        text, answered, is_proposal = reply_text(result)
        outcome = {"reply": text, "answered": answered, "tools": [n for n, _ in world.calls], "calls": list(world.calls),
                   "results": list(world.results), "thread_text": "\n".join(thread)}
        rows = score_turn(turn["checks"], outcome)
        rec = {"case": case["id"], "turn": i, "user": turn["user"], "reply": text, "answered": answered, "tools": outcome["tools"],
               "latency_s": round(latency, 2), "provider_error": bool(result and result.get("provider_error")), "history_chars": [len(h["content"]) for h in history], "checks": rows}
        if after_turn:
            await after_turn(rec)
        records.append(rec)
        if result and result.get("last_result"):
            last_result = result["last_result"]
        if is_proposal:
            msgs.append({"role": "assistant", "kind": "proposal", "summary": result["proposal"].get("summary", ""), "status": "pending"})
        else:
            msgs.append({"role": "assistant", "content": (result or {}).get("reply") or text})
        thread.append(text)
    return records
