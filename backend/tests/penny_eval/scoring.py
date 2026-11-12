"""G459: pure, offline scoring of one Penny turn against its declared checks.

A check is a dict {rubric, name, kind, ...}. Rubrics: grounding, context, tools, arithmetic,
needless_question. `outcome` is {reply, tools, calls, results, answered, allowed}.
Kinds:
  tools_all / tools_any / tools_none   names=[...]
  no_propose_tool                       the turn calls no propose_* tool (the capability does not exist)
  first_tool                            tool=...
  max_tool_calls                        n=...
  regex_all / regex_any / regex_none    patterns=[...]   (case-insensitive, on headline + reply)
  figures                               no £ figure (or 2dp number) in the reply that is absent from the
                                        tool results, the thread's own numbers or `extra`
  no_question                           the reply asks nothing
  any_of                                checks=[...]     passes when any sub-check passes
"""
import re

RUBRICS = ("grounding", "context", "tools", "arithmetic", "needless_question")
_FIG = re.compile(r"(?:£\s?(\d[\d,]*(?:\.\d+)?))|(?<![\w.£])(\d[\d,]*\.\d{2})(?![\d.])")
_NUM = re.compile(r"-?\d[\d,]*\.?\d*")


def _numbers_in(obj, out: set):
    if isinstance(obj, bool) or obj is None:
        return
    if isinstance(obj, (int, float)):
        out.add(round(abs(float(obj)), 2))
    elif isinstance(obj, str):
        for m in _NUM.findall(obj):
            try:
                out.add(round(abs(float(m.replace(",", ""))), 2))
            except ValueError:
                pass
    elif isinstance(obj, dict):
        for v in obj.values():
            _numbers_in(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _numbers_in(v, out)


def allowed_numbers(outcome: dict, extra=()) -> set:
    out: set = set()
    _numbers_in(outcome.get("results") or [], out)
    _numbers_in(outcome.get("thread_text") or "", out)
    _numbers_in(list(extra), out)
    return out


def figures_in(text: str) -> list[float]:
    vals = []
    for m in _FIG.finditer(text or ""):
        raw = (m.group(1) or m.group(2)).replace(",", "")
        try:
            vals.append(round(float(raw), 2))
        except ValueError:
            pass
    return vals


def ungrounded_figures(text: str, allowed: set) -> list[float]:
    bad = []
    for v in figures_in(text):
        if v in allowed:
            continue
        # a whole-pound rounding of an allowed figure ("£1,098" for 1,098.20) is not an invention
        if float(v).is_integer() and any(round(a) == v for a in allowed):
            continue
        bad.append(v)
    return bad


def _rx(patterns, text, mode):
    hits = [bool(re.search(p, text, re.I | re.S)) for p in patterns]
    return all(hits) if mode == "all" else any(hits)


def run_check(check: dict, outcome: dict, extra=()) -> tuple[bool, str]:
    kind = check["kind"]
    text = outcome.get("reply") or ""
    tools = outcome.get("tools") or []
    if not outcome.get("answered", True) and kind != "any_of":
        return False, "no usable answer"
    if kind == "tools_all":
        miss = [n for n in check["names"] if n not in tools]
        return not miss, f"missing {miss}" if miss else "ok"
    if kind == "tools_any":
        return any(n in tools for n in check["names"]), f"called {tools}"
    if kind == "tools_none":
        hit = [n for n in check["names"] if n in tools]
        return not hit, f"called {hit}" if hit else "ok"
    if kind == "no_propose_tool":
        hit = [n for n in tools if n.startswith("propose_")]
        return not hit, f"proposed via {hit}" if hit else "ok"
    if kind == "first_tool":
        return bool(tools) and tools[0] == check["tool"], f"first {tools[:1]}"
    if kind == "max_tool_calls":
        return len(tools) <= check["n"], f"{len(tools)} calls"
    if kind == "regex_all":
        return _rx(check["patterns"], text, "all"), "pattern missing" if not _rx(check["patterns"], text, "all") else "ok"
    if kind == "regex_any":
        ok = _rx(check["patterns"], text, "any")
        return ok, "no expected phrase" if not ok else "ok"
    if kind == "regex_none":
        hit = [p for p in check["patterns"] if re.search(p, text, re.I | re.S)]
        return not hit, f"forbidden phrase {hit}" if hit else "ok"
    if kind == "figures":
        bad = ungrounded_figures(text, allowed_numbers(outcome, list(extra) + list(check.get("extra") or [])))
        return not bad, f"ungrounded figures {bad}" if bad else "ok"
    if kind == "no_question":
        return "?" not in text, "asks a question" if "?" in text else "ok"
    if kind == "any_of":
        results = [run_check(c, outcome, extra) for c in check["checks"]]
        return any(r[0] for r in results), "; ".join(r[1] for r in results)
    raise ValueError(f"unknown check kind {kind}")


def score_turn(checks: list[dict], outcome: dict, extra=()) -> list[dict]:
    rows = []
    for c in checks:
        ok, detail = run_check(c, outcome, extra)
        rows.append({"rubric": c["rubric"], "name": c["name"], "passed": bool(ok), "detail": detail})
    return rows


def pass_rates(rows: list[dict]) -> dict:
    out = {}
    for r in RUBRICS:
        sel = [x for x in rows if x["rubric"] == r]
        out[r] = {"passed": sum(x["passed"] for x in sel), "total": len(sel),
                  "rate": round(sum(x["passed"] for x in sel) / len(sel), 3) if sel else None}
    allp = sum(x["passed"] for x in rows)
    out["overall"] = {"passed": allp, "total": len(rows), "rate": round(allp / len(rows), 3) if rows else None}
    return out
