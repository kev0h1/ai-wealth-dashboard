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
from datetime import date, timedelta

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


# ── G355: weekday corrections ────────────────────────────────────────────────
# A model that works out a weekday itself gets it wrong ("29 Oct (Friday)" when
# 29 Oct 2026 is a Thursday). The calendar is not a judgement call, so this
# guard rewrites ONLY the weekday word that sits next to a date, and nothing
# else. It runs on every reply.

_WEEKDAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_WD = r"(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)"
_MON = r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
_DM = r"(\d{1,2})(?:st|nd|rd|th)?\s+" + _MON + r"(?:,?\s+(\d{4}))?"
_MONTH_NUM = {m: i + 1 for i, m in enumerate(("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}

# "29 Oct (Friday)", "Friday, 30 Oct 2026", "Fri 30 Oct", "Friday (30 Oct)"
_AFTER_RE = re.compile(r"(?<![A-Za-z])" + _DM + r"(\s*[(\[]\s*|\s+)" + _WD + r"(?![A-Za-z])")
_BEFORE_RE = re.compile(r"(?<![A-Za-z])" + _WD + r"(,?\s*\(?\s*)" + _DM + r"(?![A-Za-z0-9])")


NEAR_DAYS = 45


def _valid(day: str, mon: str, year: str | None) -> bool:
    """A real calendar day in at least one year (31 Feb is not a date)."""
    month = _MONTH_NUM.get(mon[:3].lower())
    if month is None:
        return False
    for y in ([int(year)] if year else [2024, 2025, 2026, 2027]):
        try:
            date(y, month, int(day))
            return True
        except ValueError:
            continue
    return False


def _candidates(day: str, month: int, today: date) -> list[date]:
    out = []
    for y in (today.year - 1, today.year, today.year + 1):
        try:
            out.append(date(y, month, int(day)))
        except ValueError:
            continue
    return out


def _real_weekday(day: str, mon: str, year: str | None, said: str, today: date) -> int | None:
    """The weekday index a claimed weekday should be corrected to, or None to leave
    the text alone. With a year the date is exact. Without one the year is unknown,
    so the guard is conservative: a date within NEAR_DAYS of today is read as its
    nearest year and corrected if the weekday is wrong; a farther date is corrected
    only when the claimed weekday fits no year from last year to next year, and then
    to the nearest year's weekday."""
    month = _MONTH_NUM.get(mon[:3].lower())
    if month is None:
        return None
    said_idx = next((i for i, n in enumerate(_WEEKDAY_NAMES) if n[:3].lower() == said[:3].lower()), None)
    if said_idx is None:
        return None
    if year:
        try:
            wd = date(int(year), month, int(day)).weekday()
        except ValueError:
            return None
        return wd if wd != said_idx else None
    cands = _candidates(day, month, today)
    if not cands:
        return None
    nearest = min(cands, key=lambda d: (abs((d - today).days), d.year != today.year))
    if abs((nearest - today).days) <= NEAR_DAYS:
        return nearest.weekday() if nearest.weekday() != said_idx else None
    if any(d.weekday() == said_idx for d in cands):
        return None
    return nearest.weekday()


def _same_style(original: str, real_full: str) -> str:
    if len(original) <= 3:
        return real_full[:3]
    return real_full


def fix_weekday_claims(reply: str, today: date) -> tuple[str, int]:
    """(reply, corrections). A weekday written next to a date that cannot be that
    date's weekday is replaced (see `_real_weekday` for the year rules: exact with
    a year, conservative without one). A weekday word that sits between two dates
    belongs to the one before it ("3 Nov Tue, 4 Nov")."""
    if not reply:
        return reply, 0
    claimed: list[tuple[int, int]] = []  # weekday spans already tied to a date
    edits: list[tuple[int, int, str]] = []

    def consider(span: tuple[int, int], said: str, real: int | None, valid: bool) -> None:
        if not valid or any(span[0] < b and a < span[1] for a, b in claimed):
            return
        claimed.append(span)
        if real is not None:
            edits.append((span[0], span[1], _same_style(said, _WEEKDAY_NAMES[real])))

    # A weekday immediately before a date belongs to that date, so those matches go first.
    after_spans = {m.span(5) for m in _AFTER_RE.finditer(reply)}
    for m in _BEFORE_RE.finditer(reply):
        if "," in m.group(2) and m.span(1) in after_spans:
            continue  # "3 Nov Tue, 4 Nov": the weekday is already tied to the date before it
        real = _real_weekday(m.group(3), m.group(4), m.group(5), m.group(1), today)
        consider(m.span(1), m.group(1), real, _valid(m.group(3), m.group(4), m.group(5)))
    for m in _AFTER_RE.finditer(reply):
        real = _real_weekday(m.group(1), m.group(2), m.group(3), m.group(5), today)
        consider(m.span(5), m.group(5), real, _valid(m.group(1), m.group(2), m.group(3)))
    if not edits:
        return reply, 0
    out = reply
    for a, b, new in sorted(edits, reverse=True):
        out = out[:a] + new + out[b:]
    return out, len(edits)


# ── G356: nothing is "set up" until the user confirms the card ───────────────

_SETUP_CLAIM_RE = re.compile(
    r"\b(plan|goal|schedule|challenge|contributions?)\b([^.!?]{0,60}?)\b(is|are|has been|have been|is now|are now)\s+"
    r"(?:now\s+|all\s+)?(?:set up|setup|created|saved|done|all set|in place)\b",
    re.I,
)
_SETUP_I_RE = re.compile(r"\bI(?:'ve| have)\s+(?:now\s+)?(?:set up|created|saved)\s+(your|the)\s+(plan|goal|schedule|challenge)\b", re.I)
_LEAD_FILLER_RE = re.compile(r"^\s*(?:perfect|done|all set|great|brilliant|lovely)[.!]+\s*", re.I)
READY_PHRASE = "ready to confirm"


def fix_premature_setup_claims(reply: str, created: bool) -> str:
    """When no proposal was created this turn, a sentence claiming the plan or goal
    "is set up" (or created, saved, done, all set) becomes "is ready to confirm",
    keeping the rest of the sentence. A leading "Perfect." or "Done." is dropped, but
    only when a claim was rewritten. Untouched when a proposal was created."""
    if created or not reply:
        return reply
    changed = False

    def claim(m: re.Match) -> str:
        nonlocal changed
        changed = True
        verb = "are" if m.group(3).lower().startswith(("are", "have")) else "is"
        return f"{m.group(1)}{m.group(2)}{verb} {READY_PHRASE}"

    def said_i(m: re.Match) -> str:
        nonlocal changed
        changed = True
        lead = m.group(1).capitalize() if m.start() == 0 else m.group(1).lower()
        return f"{lead} {m.group(2).lower()} is {READY_PHRASE}"

    out = _SETUP_CLAIM_RE.sub(claim, reply)
    out = _SETUP_I_RE.sub(said_i, out)
    if changed:
        stripped = _LEAD_FILLER_RE.sub("", out, count=1)
        if stripped.strip():
            out = stripped[:1].upper() + stripped[1:]
    return out
