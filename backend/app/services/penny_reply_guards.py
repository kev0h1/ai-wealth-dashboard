"""G336: pure reply guards for Penny's move answers.

Two guards, both pure (no I/O, no logging of amounts):

* `guard_consolidation_reply`: when plan_consolidation ran, every pound figure
  in the model's reply must be one the tool returned. A stray figure (a raw
  balance, an invented total) replaces the whole reply with the tool's own
  `summary`, which is already the exact answer.
* `fix_unchanged_claim`: moving money between the user's own accounts never
  changes left to spend, so a sentence saying it rises or falls because of a
  move is replaced with the one true sentence. Independent of tools.
"""
import re

UNCHANGED_SENTENCE = "Moving money between your own accounts does not change your left to spend."

_AMOUNT_RE = re.compile(r"[−-]?\s?£\s?(\d[\d,]*(?:\.\d+)?)")
_SENTENCE_RE = re.compile(r".+?(?:[.!?]+(?=\s|$)|$)\s*", re.S)
_LTS_RE = re.compile(r"left[\s-]+to[\s-]+spend|safe[\s-]+to[\s-]+spend", re.I)
_DIRECTION_RE = re.compile(
    r"\b(?:would|will|could|can|may|should)\s+(?:rise|go\s+up|go\s+down|fall|increase|decrease|drop|grow|shrink)\b"
    r"|\b(?:rises|rise|rose|risen|goes\s+up|goes\s+down|falls|fell|fallen|increases|decreases|drops|dropped|climbed|climbs|jumps|jumped|jump|grows|shrinks)\b"
    r"|\b(?:increase|decrease)\b",
    re.I,
)
_MOVE_RE = re.compile(
    r"\b(?:move|moves|moved|moving|transfer|transfers|transferred|transferring)\b"
    r"|\bonce\s+moved\b|\bafter\s+the\s+move\b",
    re.I,
)


def extract_amounts(text: str) -> list[float]:
    """Every £ figure in the text, as a positive float rounded to pence."""
    out = []
    for m in _AMOUNT_RE.finditer(text or ""):
        try:
            out.append(round(float(m.group(1).replace(",", "")), 2))
        except ValueError:
            continue
    return out


def _raw(v) -> float | None:
    if isinstance(v, dict):
        v = v.get("raw")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return abs(round(float(v), 2))


def _raw_values(node, out: set[float]) -> None:
    """Every numeric `raw` value anywhere in a tool result."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "raw":
                n = _raw(v)
                if n is not None:
                    out.add(n)
            else:
                _raw_values(v, out)
    elif isinstance(node, list):
        for v in node:
            _raw_values(v, out)


FLOOR_AMOUNT = 5.0


def allowed_amounts(results: list[dict], all_results: list[dict] | None = None) -> set[float]:
    """Every figure a plan_consolidation result vouches for: legs, keeps,
    total, pool, requested, shortfall, the target's own headroom, and any
    figure written in its own summary."""
    allowed: set[float] = {FLOOR_AMOUNT}
    for res in all_results or []:
        _raw_values(res, allowed)
    for res in results or []:
        if not isinstance(res, dict):
            continue
        candidates = [res.get("total"), res.get("pool"), res.get("requested"), res.get("shortfall")]
        candidates.append((res.get("target") or {}).get("own_headroom"))
        for leg in res.get("legs") or []:
            if isinstance(leg, dict):
                candidates += [leg.get("amount"), leg.get("keeps")]
        for c in candidates:
            v = _raw(c)
            if v is not None:
                allowed.add(v)
        allowed.update(extract_amounts(str(res.get("summary") or "")))
    return allowed


def guard_consolidation_reply(reply: str, results: list[dict], all_results: list[dict] | None = None) -> tuple[str, int]:
    """(reply, stray_figure_count). A stray figure swaps the reply for the
    summary of the last result that has one (`all_results`: every tool result of
    the turn, whose raw figures and the £5 floor are also allowed); with no summary to fall back on
    the reply stands."""
    results = [r for r in results or [] if isinstance(r, dict)]
    summary = next((r["summary"] for r in reversed(results) if isinstance(r.get("summary"), str) and r["summary"].strip()), None)
    if summary is None:
        return reply, 0
    allowed = allowed_amounts(results, all_results)
    stray = [a for a in extract_amounts(reply) if a not in allowed]
    if not stray:
        return reply, 0
    return summary, len(stray)


def fix_unchanged_claim(reply: str) -> tuple[str, bool]:
    """Replace any sentence claiming left to spend rises or falls because of a
    move or transfer (the move word must be in that same sentence). Returns
    (reply, changed)."""
    if not reply:
        return reply, False
    sentences = _SENTENCE_RE.findall(reply)
    changed = False
    out: list[str] = []
    for s in sentences:
        if _LTS_RE.search(s) and _DIRECTION_RE.search(s) and _MOVE_RE.search(s):
            changed = True
            out.append(UNCHANGED_SENTENCE + (" " if s.endswith((" ", "\n")) else ""))
        else:
            out.append(s)
    if not changed:
        return reply, False
    # One copy of the sentence only.
    seen = False
    final = []
    for s in out:
        if s.strip() == UNCHANGED_SENTENCE:
            if seen:
                continue
            seen = True
        final.append(s)
    text = "".join(final).strip()
    return text, True
