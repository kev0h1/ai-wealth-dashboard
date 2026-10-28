"""G351: goals that follow a contribution schedule, built with Penny.

Two tools live here.

preview_goal_schedule (read) turns a plain description ("start at 4p and add
4p a day for a year") or explicit fields into a schedule with a small
deterministic parser, then asks the schedule engine (goal_schedule.py) for the
figures. The model never does any arithmetic: it quotes `summary` and the
figures verbatim. Anything the parser cannot read comes back in `needs`.

propose_create_scheduled_goal (propose) makes a `create_commitment` proposal
that carries the schedule and the account the money leaves from. The goal is
created only when the user confirms (B59). Converting a set-aside also pauses
that set-aside, but only on that same confirmation. propose_update_commitment
gains a `schedule` argument (see exec_propose_update_schedule).

Nothing here moves money.
"""
import logging
import re
from datetime import date, timedelta

from fastapi import HTTPException

from app.core import timeutil
from app.services import goal_schedule as gs

logger = logging.getLogger(__name__)

NOTHING_MOVES = "Nothing moves until you move it."
HISTORY_NOTE = "Progress starts from today; the set-aside's past fills stay where they are."

# ── Schemas ──────────────────────────────────────────────────────────────────

_FIELDS = {
    "description": {"type": "string", "description": "The user's own words describing the schedule, passed through unchanged. The server reads it."},
    "start_amount": {"type": "number", "description": "Optional explicit first amount in pounds (4p is 0.04)."},
    "step_amount": {"type": "number", "description": "Optional explicit amount the contribution rises by each step, in pounds (4p is 0.04). 0 for equal amounts."},
    "step_unit": {"type": "string", "enum": ["day", "week", "period"], "description": "How often the amount changes: day, week or pay period."},
    "count": {"type": "integer", "description": "Optional number of days, weeks or pay periods the schedule runs."},
    "end_date": {"type": "string", "description": "Optional ISO date (YYYY-MM-DD) the schedule ends."},
    "start_date": {"type": "string", "description": "Optional ISO date (YYYY-MM-DD) it starts; today when absent."},
    "percent": {"type": "number", "description": "Optional percentage of pay each pay period, for a percent-of-pay schedule."},
    "pay_amount": {"type": "number", "description": "Optional rough pay per pay period in pounds, needed to turn a percentage into pounds."},
    "amounts": {"type": "array", "items": {"type": "number"}, "description": "Optional list of pound amounts, one per pay period in order."},
}

_SOURCE_FIELDS = {
    "funding_pot": {"type": "string", "description": "Optional: the account or pot (id or name, from get_accounts) the money goes into."},
    "source_account_id_or_name": {"type": "string", "description": "Optional: the account the money leaves from (id or name), only when the user said so."},
}

PREVIEW_GOAL_SCHEDULE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "preview_goal_schedule",
        "description": (
            "Work out a goal contribution schedule that is not equal amounts, for example a challenge that "
            "starts at 4p and rises by 4p a day for a year, £1 the first week rising by £1 a week until "
            "December, fixed amounts per pay period, or a percentage of pay. Pass the user's words as "
            "`description` and the server reads them, or pass explicit fields. It returns the schedule, a "
            "plain-English `schedule_label`, the `total`, this pay period's amount, the next three pay "
            "periods, the end date, a `source` suggestion (the account the money leaves from) and a "
            "`summary` sentence. Quote `summary` and every figure verbatim and NEVER add up, multiply or "
            "round schedule figures yourself. If `needs` is not empty, ask the user for exactly those "
            "things. Every date comes with its real weekday, and `today` and `current_period` are in every "
            "result: copy them, never work out a weekday, a day number or an amount for a date yourself, "
            "pass `ask_date` instead. This only previews: it creates nothing and moves no money. After the "
            "user agrees, call propose_create_scheduled_goal."
        ),
        "parameters": {"type": "object", "properties": {**_FIELDS, **_SOURCE_FIELDS, "goal_ref": {"type": "string", "description": "Optional: an existing goal (id or name) whose stored source account should be reported."}, "ask_date": {"type": "string", "description": "Optional: a date (ISO, or a word such as today, tomorrow or Friday) to ask what the schedule asks for that day. The result's `on_date` has the real weekday, day number and amount; copy them, never work them out."}}, "required": []},
    },
}

PROPOSE_CREATE_SCHEDULED_GOAL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "propose_create_scheduled_goal",
        "description": (
            "Propose creating a goal that follows a contribution schedule (see preview_goal_schedule), "
            "the same goal Planning shows, with a confirmation card the user must tap. Call it only after "
            "the user has seen the preview and asked you to set it up. It needs a name and the account "
            "the money leaves from: pass `source_account_id_or_name` when the user named it, or "
            "`use_detected_source` true when the user agreed to the detected account in the preview. "
            "Without a source it returns `needs` and creates nothing. `convert_from_set_aside` (an id or "
            "name from get_set_asides) offers to replace that set-aside with the goal: it is paused only "
            "when the user confirms the card, and its past fills are not carried over. The totals and "
            "periods come from the server, never from you."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "A short label for the goal (40 characters or fewer)."},
                **_FIELDS,
                **_SOURCE_FIELDS,
                "use_detected_source": {"type": "boolean", "description": "True when the user agreed to the account the preview detected."},
                "convert_from_set_aside": {"type": "string", "description": "Optional: a set-aside's id or name this goal replaces."},
            },
            "required": [],
        },
    },
}

UPDATE_SCHEDULE_PROPERTIES = {
    k: _FIELDS[k] for k in ("description", "start_amount", "step_amount", "step_unit", "count", "end_date", "start_date", "percent", "pay_amount", "amounts")
}


def add_schedule_to_update_schema(schema: dict) -> None:
    """Teach propose_update_commitment the schedule fields (appended post-hoc)."""
    fn = schema["function"]
    fn["description"] += (
        " To change a goal's contribution schedule instead, pass `description` or the explicit schedule "
        "fields (see preview_goal_schedule); the server works out the totals and the amount and date "
        "then follow the schedule."
    )
    fn["parameters"]["properties"].update(UPDATE_SCHEDULE_PROPERTIES)


# ── Money and dates ──────────────────────────────────────────────────────────

def _money2(pence: int) -> dict:
    return {"raw": round(pence / 100, 2), "formatted": gs.fmt_money(pence)}


_MONTHS = {m: i + 1 for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"))}
_MONTH_RE = r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_WORDS = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
          "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12}
_N_RE = r"(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)"
_MONEY_RE = r"(?:£\s?(\d[\d,]*(?:\.\d{1,2})?)|(?<![\w.])(\d+(?:\.\d+)?)\s?(?:p|pence)\b)"
_UNIT_RE = r"(day|week|month|pay\s?period|period|fortnight)"


def _month_number(token: str) -> int:
    return _MONTHS[token[:3]]


def _add_months(d: date, n: int) -> date:
    total = d.month - 1 + n
    year, month = d.year + total // 12, total % 12 + 1
    import calendar
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _pence(m: re.Match) -> int:
    if m.group(1) is not None:
        return round(float(m.group(1).replace(",", "")) * 100)
    return round(float(m.group(2)))


def _money_tokens(text: str) -> list[tuple[int, int, int]]:
    return [(m.start(), m.end(), _pence(m)) for m in re.finditer(_MONEY_RE, text)]


def _parse_date(text: str, today: date, *, end_of_month: bool = False) -> date | None:
    """A day-month[-year], month-day[-year] or month[-year] date, else None."""
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH_RE + r"(?:,?\s+(\d{4}))?\b", text)
    if m:
        try:
            return date(int(m.group(3)) if m.group(3) else today.year, _month_number(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    m = re.search(_MONTH_RE + r"\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b", text)
    if m:
        try:
            return date(int(m.group(3)) if m.group(3) else today.year, _month_number(m.group(1)), int(m.group(2)))
        except ValueError:
            return None
    m = re.search(r"\b" + _MONTH_RE + r"(?:\s+(\d{4}))?\b", text)
    if m:
        year = int(m.group(2)) if m.group(2) else today.year
        first = date(year, _month_number(m.group(1)), 1)
        return _add_months(first, 1) - timedelta(days=1) if end_of_month else first
    return None


def _unit_of(word: str) -> tuple[str, str | None]:
    """(engine step unit, assumption sentence or None) for a unit word."""
    word = re.sub(r"\s+", "", word)
    if word == "day":
        return "day", None
    if word == "week":
        return "week", None
    if word == "month":
        return "period", "I have read each month as one pay period."
    if word == "fortnight":
        return "period", "I have read each fortnight as one pay period."
    return "period", None


# ── The parser ───────────────────────────────────────────────────────────────

def parse_description(text: str, today: date) -> dict:
    """Read common phrasings into schedule fields. Returns {"fields", "assumptions",
    "suggested_name"}. Unreadable parts are simply absent: `build` reports them as needs."""
    t = " ".join(str(text or "").lower().replace("’", "'").split())
    fields: dict = {}
    assumptions: list[str] = []
    name = None

    pct = re.search(r"(\d+(?:\.\d+)?)\s?(?:%|per ?cent\b|percent\b)", t)
    tokens = _money_tokens(t)
    challenge = re.search(_MONEY_RE + r"\s+challenge", t)

    # Dates. "since 1 January 2026", "starting 1 jan", "from today".
    start = None
    for sm in re.finditer(r"\b(?:since|starting(?:\s+on|\s+from)?|started(?:\s+on)?|starts?(?:\s+on)?|from|beginning(?:\s+on)?|began(?:\s+on)?)\s+(.+?)(?:\s+(?:and|with|at|for|until|till|by|rising|adding|going)\b|[,.]|$)", t):
        chunk = sm.group(1)
        if chunk.startswith("today"):
            start = today
        elif chunk.startswith("tomorrow"):
            start = today + timedelta(days=1)
        elif chunk.startswith("next month"):
            start = _add_months(date(today.year, today.month, 1), 1)
        else:
            start = _parse_date(chunk, today)
        if start:
            break
    if start:
        fields["start_date"] = start.isoformat()
    base_start = start or today

    # End: "until December", "by 31 Dec 2026".
    em = re.search(r"\b(?:until|till|through|by(?:\s+the\s+end\s+of)?|to\s+the\s+end\s+of)\s+(?!£|\d+\s?p\b)(.+?)(?:[,.]|$)", t)
    if em and re.search(_MONTH_RE, em.group(1)):
        whole_month = not re.search(r"\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?" + _MONTH_RE + r"|" + _MONTH_RE + r"\s+\d{1,2}\b", em.group(1))
        end = _parse_date(em.group(1), base_start, end_of_month=whole_month)
        if end and end < base_start and not re.search(r"\d{4}", em.group(1)):
            end = date(end.year + 1, end.month, end.day) if not whole_month else _add_months(end + timedelta(days=1), 12) - timedelta(days=1)
        if end:
            fields["end_date"] = end.isoformat()

    # Unit: after the step amount, then after the start amount, then anywhere.
    step_m = re.search(r"(?:add(?:ing|s)?|rising by|rises by|rise by|going up by|goes up by|go up by|increas(?:ing|es|e) by|up by|increment(?:ing|s)? by|plus|extra)\s*(?:another\s+)?" + _MONEY_RE, t)
    step_pence = None
    step_end = None
    if step_m:
        money_in_step = re.search(_MONEY_RE, step_m.group(0))
        step_pence = _pence(money_in_step)
        step_end = step_m.end()

    # Amount roles.
    start_pence = None
    start_end = None
    if challenge:
        start_pence = _pence(challenge)
        name = f"{gs.fmt_pence(start_pence)} challenge"
        if step_pence is None:
            step_pence = start_pence
            assumptions.append(f"I have read a {gs.fmt_pence(start_pence)} challenge as {gs.fmt_pence(start_pence)} on day one, rising by {gs.fmt_pence(start_pence)} each day.")
        start_end = challenge.end()
    if start_pence is None:
        m1 = re.search(r"(?:start(?:ing|s)?|begin(?:ning|s)?)\s*(?:at|with|from|on)?\s*" + _MONEY_RE, t)
        m2 = re.search(_MONEY_RE + r"\s+(?:on|for|in)?\s*(?:the\s+)?first\s+(?:day|week|month|period)", t)
        m = m1 or m2
        if m:
            inner = re.search(_MONEY_RE, m.group(0))
            start_pence = _pence(inner)
            start_end = m.end()
    if start_pence is None and not pct:
        for s0, e0, p0 in tokens:
            if step_m and step_m.start() <= s0 < step_m.end():
                continue
            start_pence, start_end = p0, e0
            break

    unit_word = None
    for anchor in (step_end, start_end):
        if anchor is not None:
            um = re.match(r"\s*(?:a|per|each|every|/)\s*" + _UNIT_RE, t[anchor:])
            if um:
                unit_word = um.group(1)
                break
    if unit_word is None:
        um = re.search(r"\b(?:a|per|each|every)\s+" + _UNIT_RE + r"\b|\b(daily|weekly|monthly)\b", t)
        if um:
            unit_word = um.group(1) or {"daily": "day", "weekly": "week", "monthly": "month"}[um.group(2)]
    if unit_word is None and challenge:
        unit_word = "day"
    step_unit = None
    if unit_word:
        step_unit, note = _unit_of(unit_word)
        if note:
            assumptions.append(note)

    # Length: "for a year", "over the next three months", "for 365 days".
    length = re.search(r"\b(?:for|over)\s+(?:the\s+next\s+)?" + _N_RE + r"\s+" + _UNIT_RE.replace("(day|week|month|", "(year|day|week|month|") + r"s?\b", t)
    if length and "end_date" not in fields:
        n = _WORDS.get(length.group(1)) or int(length.group(1))
        what = re.sub(r"\s+", "", length.group(2))
        eff_unit = step_unit or ("period" if pct else None)
        if what == "year":
            if eff_unit == "day":
                fields["count"] = 365 * n
                assumptions.append("I have used 365 days for a year.")
            elif eff_unit == "week":
                fields["count"] = 52 * n
            elif eff_unit == "period":
                fields["count"] = 12 * n
                assumptions.append("I have used 12 pay periods for a year.")
        elif what == "month":
            if eff_unit == "period":
                fields["count"] = n
            elif eff_unit in ("day", "week"):
                fields["end_date"] = (_add_months(base_start, n) - timedelta(days=1)).isoformat()
        elif what == "week":
            if eff_unit == "day":
                fields["count"] = 7 * n
            elif eff_unit == "week":
                fields["count"] = n
        elif what == "day":
            if eff_unit == "day":
                fields["count"] = n
            elif eff_unit == "week":
                fields["count"] = -(-n // 7)
        elif what in ("period", "payperiod", "fortnight"):
            if eff_unit == "period":
                fields["count"] = n
    if challenge and "count" not in fields and "end_date" not in fields:
        fields["count"] = 365
        assumptions.append("I have used 365 days, the usual length of a challenge like this.")

    if pct:
        fields["percent"] = float(pct.group(1))
        pay = re.search(_MONEY_RE + r"(?=[^.]{0,30}\b(?:pay|salary|wage|wages|income|take-home)\b)|\b(?:pay|salary|wage|wages|income|take-home)\b[^.£\d]{0,20}" + _MONEY_RE, t)
        if pay:
            inner = re.search(_MONEY_RE, pay.group(0))
            fields["expected_pay_pence"] = _pence(inner)
    elif start_pence is not None:
        # Two or more amounts and no step reads as a list, one per pay period.
        listed = [p for _s, _e, p in tokens]
        if step_pence is None and not challenge and len(listed) >= 2 and not unit_word:
            fields["amounts_pence"] = listed
        else:
            fields["start_pence"] = start_pence
            if step_pence is not None:
                fields["step_pence"] = step_pence
            if step_unit:
                fields["step_unit"] = step_unit
    return {"fields": fields, "assumptions": assumptions, "suggested_name": name}


# ── From fields to a schedule ────────────────────────────────────────────────

def _pence_arg(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return None
    return round(float(value) * 100)


def fields_from_schedule(sched: dict | None) -> dict:
    """The editable fields of a stored schedule, as the parser would produce them."""
    if not gs.is_scheduled(sched):
        return {}
    out = {k: v for k, v in sched.items() if k != "type"}
    out["kind"] = sched["type"]
    return out


def merge_fields(args: dict, today: date, base: dict | None = None) -> dict:
    """Parse `description`, then let explicit fields win. Returns the parse result
    with the merged "fields"."""
    parsed = parse_description(args.get("description") or "", today) if args.get("description") else {
        "fields": {}, "assumptions": [], "suggested_name": None}
    fields = dict(base or {})
    fields.update(parsed["fields"])
    explicit = {
        "start_pence": _pence_arg(args.get("start_amount")),
        "step_pence": _pence_arg(args.get("step_amount")),
        "step_unit": args.get("step_unit") if args.get("step_unit") in ("day", "week", "period") else None,
        "count": args.get("count") if isinstance(args.get("count"), int) and not isinstance(args.get("count"), bool) else None,
        "end_date": str(args["end_date"])[:10] if args.get("end_date") else None,
        "start_date": str(args["start_date"])[:10] if args.get("start_date") else None,
        "percent": float(args["percent"]) if isinstance(args.get("percent"), (int, float)) and not isinstance(args.get("percent"), bool) else None,
        "expected_pay_pence": _pence_arg(args.get("pay_amount")),
    }
    for key, value in explicit.items():
        if value is not None:
            fields[key] = value
    amounts = args.get("amounts")
    if isinstance(amounts, list) and amounts:
        fields["amounts_pence"] = [_pence_arg(a) for a in amounts]
    parsed["fields"] = fields
    return parsed


def build_schedule(fields: dict, today: date) -> tuple[dict | None, list[str]]:
    """(raw schedule, needs). The schedule is None when something is missing."""
    needs: list[str] = []
    start = fields.get("start_date") or today.isoformat()
    if fields.get("amounts_pence"):
        if any(a is None for a in fields["amounts_pence"]):
            return None, ["amounts"]
        return {"type": "fixed", "start_date": start, "amounts_pence": list(fields["amounts_pence"]), "unit": "period"}, []
    if fields.get("percent") is not None:
        if not fields.get("expected_pay_pence"):
            needs.append("pay_amount")
        if fields.get("count") is None and not fields.get("end_date"):
            needs.append("length")
        if needs:
            return None, needs
        return {"type": "percent_of_pay", "percent": fields["percent"], "start_date": start,
                "expected_pay_pence": fields["expected_pay_pence"], "count": fields.get("count"),
                "end_date": fields.get("end_date")}, []
    if fields.get("start_pence") is None:
        needs.append("start_amount")
    if not fields.get("step_unit"):
        needs.append("step_unit")
    if fields.get("count") is None and not fields.get("end_date"):
        needs.append("length")
    if needs:
        return None, needs
    return {"type": "arithmetic", "start_pence": fields["start_pence"], "step_pence": fields.get("step_pence") or 0,
            "step_unit": fields["step_unit"], "start_date": start, "count": fields.get("count"),
            "end_date": fields.get("end_date")}, []


def _check(schedule: dict) -> tuple[dict | None, str | None]:
    """(clean schedule, None) or (None, an authored message from the engine)."""
    try:
        return gs.validate(schedule), None
    except ValueError as exc:
        return None, str(exc)


def _dated(iso: str | None) -> dict:
    """{"date", "weekday", "label"} for an ISO date: the weekday always comes from
    the server, so the model never works one out."""
    if not iso:
        return {}
    d = date.fromisoformat(str(iso)[:10])
    return {"date": d.isoformat(), "weekday": gs.weekday_name(d), "label": gs.fmt_date_wd(d)}


def today_and_period(today: date, cfg: dict) -> dict:
    """`today` and the live pay period with their weekdays, for every preview."""
    ps, pe = _period_bounds(today, cfg)
    return {
        "today": _dated(today.isoformat()),
        "current_period": {"start": ps.isoformat(), "end": pe.isoformat(),
                           "start_weekday": gs.weekday_name(ps), "end_weekday": gs.weekday_name(pe),
                           "weekday_end": gs.weekday_name(pe), "end_label": gs.fmt_date_wd(pe)},
    }


def _figures(clean: dict, cfg: dict, today: date) -> dict:
    total = gs.total_pence(clean, cfg)
    end = gs.end_date(clean, cfg)
    ps, pe = _period_bounds(today, cfg)
    this_period = gs.period_amount(clean, ps, pe, cfg)
    nxt = gs.next_periods(clean, today, cfg, 3)
    label = gs.schedule_label(clean)
    label_wd = gs.schedule_label(clean, weekdays=True)
    start = date.fromisoformat(clean["start_date"])
    if this_period > 0:
        lead = f"This pay period it asks for {gs.fmt_money(this_period)}"
    elif start > pe:
        lead = f"Nothing is due this pay period, because it starts on {gs.fmt_date_wd(start)}"
    else:
        lead = "Nothing is due this pay period"
    if nxt:
        lead += ", then " + ", ".join(gs.fmt_money(n["amount"]) for n in nxt) + " over the next pay periods"
    summary = f"{label_wd[:1].upper()}{label_wd[1:]} comes to {gs.fmt_money(total)} in total, finishing {gs.fmt_date_wd(end) if end else 'later'}. {lead}, on your current pay periods."
    return {
        "schedule": clean, "schedule_label": label, "total": _money2(total),
        "this_period_amount": _money2(this_period),
        "next_periods": [
            {"start": n["start"], "start_weekday": gs.weekday_name(date.fromisoformat(n["start"])),
             "end": n["end"], "end_weekday": gs.weekday_name(date.fromisoformat(n["end"])),
             "amount": _money2(n["amount"])}
            for n in nxt
        ],
        "start_date": start.isoformat(), "start_weekday": gs.weekday_name(start), "start_label": gs.fmt_date_wd(start),
        "end_date": end.isoformat() if end else None,
        "end_weekday": gs.weekday_name(end) if end else None,
        "end_label": gs.fmt_date_wd(end) if end else None,
        "periods_count": gs.periods_count(clean, cfg),
        "summary": summary,
        "estimated": clean["type"] == "percent_of_pay",
        "_total_pence": total, "_this_period_pence": this_period,
    }


_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_WEEKDAY_INDEX = {**{n: i for i, n in enumerate(_WEEKDAYS)}, **{n[:3]: i for i, n in enumerate(_WEEKDAYS)},
                  "tues": 1, "weds": 2, "thur": 3, "thurs": 3}


def parse_ask_date(text, today: date) -> date | None:
    """An ISO date, "today", "tomorrow", a weekday word ("Friday", "next Friday",
    "on fri": the next such day, today included unless "next" is said) or a
    day-month date. None when it cannot be read."""
    t = " ".join(str(text or "").lower().replace(",", " ").split())
    if not t:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t[:10]) if len(t) >= 10 else None
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    if t in ("today", "now"):
        return today
    if t == "tomorrow":
        return today + timedelta(days=1)
    words = t.split()
    for w in words:
        i = _WEEKDAY_INDEX.get(w)
        if i is not None:
            ahead = (i - today.weekday()) % 7
            if ahead == 0 and "next" in words:
                ahead = 7
            return today + timedelta(days=ahead)
    return _parse_date(t, today)


def on_date_figures(clean: dict, cfg: dict, ask: date, today: date) -> dict:
    """What the schedule asks for on one day, with its weekday and day number."""
    found = gs.amount_on(clean, ask, cfg)
    out = {**_dated(ask.isoformat())}
    if found is None:
        start = date.fromisoformat(clean["start_date"])
        out["amount"] = None
        out["note"] = ("Nothing is due on that day, because the schedule has not started." if ask < start
                       else "Nothing is due on that day.")
        return out
    out.update({"day_number": found["day_number"], "of_total": found["of_total"],
                "days_left": found["days_left"], "amount": _money2(found["amount_pence"])})
    return out


def _period_bounds(today: date, cfg: dict) -> tuple[date, date]:
    from app.services.pay_period import get_pay_period_for_date
    return get_pay_period_for_date(today, cfg)


async def build(uid: str, args: dict, *, base: dict | None = None) -> dict:
    """Shared by both tools: the parsed schedule and its figures, or `needs`/`error`."""
    from app.routers.commitments import _pay_cfg

    today = timeutil.user_today()
    parsed = merge_fields(args, today, base)
    raw, needs = build_schedule(parsed["fields"], today)
    assumptions = list(parsed["assumptions"])
    if not parsed["fields"].get("start_date"):
        assumptions.append("I have taken today as the start date.")
    out: dict = {"assumptions": assumptions, "suggested_name": parsed["suggested_name"]}
    if raw is None:
        if not parsed["fields"]:
            needs = ["description"]
        out["needs"] = needs
        out["parsed"] = {k: v for k, v in parsed["fields"].items() if v is not None}
        return out
    clean, problem = _check(raw)
    if clean is None:
        out["error"] = problem
        return out
    cfg = await _pay_cfg(uid)
    if gs.total_pence(clean, cfg) <= 0 or (gs.end_date(clean, cfg) or today) < today:
        out["error"] = "That schedule has already finished. Choose a later start or a longer run."
        return out
    out.update(_figures(clean, cfg, today))
    return out


# ── Source account ───────────────────────────────────────────────────────────

async def _resolve(uid: str, ref):
    from app.services.penny_tools import _resolve_account_for_propose
    return await _resolve_account_for_propose(uid, ref)


async def _account_view(uid: str, account) -> dict:
    from app.routers.commitments import _source_display_name
    return {"account_id": account.id, "name": await _source_display_name(uid, {"name": account.name, "provider": account.provider})}


async def suggest_source(uid: str, *, source_ref=None, goal_ref=None, pot_ref=None, set_aside: dict | None = None) -> dict:
    """The account the money would leave from, with how we know. Returns
    {"source": {...} | None, "into": {...} | None, "needs": [...], "ambiguous"?: ...}."""
    from app.services.account_plan_sources import owned_account_map
    from app.services.account_kinds import is_current_account
    from app.services.companion import infer_plan_sources_batch

    out: dict = {"source": None, "into": None, "needs": []}
    pot = None
    if pot_ref:
        res = await _resolve(uid, pot_ref)
        if res.get("ambiguous") or res.get("error"):
            return {**out, "blocked": res}
        pot = res.get("account")
        if pot is not None:
            out["into"] = await _account_view(uid, pot)
    if source_ref:
        res = await _resolve(uid, source_ref)
        if res.get("ambiguous") or res.get("error"):
            return {**out, "blocked": res}
        if res.get("account") is not None:
            out["source"] = {**await _account_view(uid, res["account"]), "basis": "stated"}
            return out
    if goal_ref:
        from app.services.penny_tools import _resolve_commitment_for_propose
        res = await _resolve_commitment_for_propose(uid, str(goal_ref))
        goal = res.get("commitment")
        if goal and goal.get("source_account_id"):
            out["source"] = {"account_id": goal["source_account_id"], "name": goal.get("source_name") or goal.get("source_account_name"),
                             "basis": "recent-transfers" if goal.get("source_assumed") else "stored"}
            return out
    if set_aside and set_aside.get("source_account_id"):
        out["source"] = {"account_id": str(set_aside["source_account_id"]), "name": set_aside.get("source_name"), "basis": "stored"}
        return out
    try:
        account_map = await owned_account_map(uid)
    except Exception:
        logger.exception("penny_goal_schedule: account lookup failed for %s", uid)
        account_map = {}
    if pot is not None and account_map:
        try:
            found = (await infer_plan_sources_batch(uid, {"draft": [pot.id]}, account_map)).get("draft")
        except Exception:
            logger.exception("penny_goal_schedule: source detection failed for %s", uid)
            found = None
        if found and found in account_map and found != pot.id:
            from app.routers.commitments import _source_display_name
            out["source"] = {"account_id": found, "name": await _source_display_name(uid, account_map[found]), "basis": "recent-transfers"}
            return out
    currents = [
        (aid, doc) for aid, doc in account_map.items()
        if not doc.get("_account_plan_manual") and is_current_account(doc) and doc.get("include_in_safe_to_spend") is not False
        and (pot is None or aid != pot.id)
    ]
    if len(currents) == 1:
        from app.routers.commitments import _source_display_name
        aid, doc = currents[0]
        out["source"] = {"account_id": aid, "name": await _source_display_name(uid, doc), "basis": "assumed"}
        return out
    out["needs"] = ["source_account"]
    return out


# ── Tools ────────────────────────────────────────────────────────────────────

def _public(built: dict) -> dict:
    return {k: v for k, v in built.items() if not k.startswith("_")}


async def _add_calendar(uid: str, out: dict, built: dict, args: dict) -> None:
    """G355: today, the live pay period and (when asked) one day's amount, all
    from the server, on every preview result."""
    from app.routers.commitments import _pay_cfg

    today = timeutil.user_today()
    cfg = await _pay_cfg(uid)
    out.update(today_and_period(today, cfg))
    ask = args.get("ask_date")
    if ask:
        asked = parse_ask_date(ask, today)
        if asked is None:
            out["on_date"] = {"error": "I could not read that date. Ask for a date such as 30 Oct 2026 or a weekday."}
        elif built.get("schedule"):
            out["on_date"] = on_date_figures(built["schedule"], cfg, asked, today)
        else:
            out["on_date"] = {**_dated(asked.isoformat()), "note": "Needs the schedule first."}


async def exec_preview_goal_schedule(uid: str, args: dict) -> dict:
    try:
        built = await build(uid, args)
        out = _public(built)
        await _add_calendar(uid, out, built, args)
        if built.get("schedule"):
            found = await suggest_source(uid, source_ref=args.get("source_account_id_or_name"), goal_ref=args.get("goal_ref"), pot_ref=args.get("funding_pot"))
            if found.get("blocked"):
                out["source_problem"] = found["blocked"]
            out["source"] = found.get("source")
            out["into"] = found.get("into")
            if found.get("source"):
                out["source_basis"] = found["source"]["basis"]
            elif not found.get("blocked"):
                out["needs"] = [*out.get("needs", []), *found["needs"]]
            if found.get("source"):
                src = found["source"]
                how = {"stated": "as you said", "stored": "as already set on this goal", "recent-transfers": "from recent transfers, so please check it", "assumed": "assumed because it is your only current account, so please check it"}[src["basis"]]
                out["source_sentence"] = f"The money would leave from {src['name']} ({how}). {NOTHING_MOVES}"
        return out
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception:
        logger.exception("penny_goal_schedule: preview failed for %s", uid)
        return {"error": "schedule preview failed"}


async def _resolve_set_aside(uid: str, ref: str) -> dict:
    from app.routers.allocations import list_allocations

    resp = await list_allocations(user={"email": uid})
    items = [a for a in resp.get("items") or [] if a.get("active", True)]
    target = next((a for a in items if a.get("id") == ref), None)
    if target is None:
        from app.services.penny_tools import _name_matches
        matches = [a for a in items if _name_matches(ref, a.get("name") or "")]
        if len(matches) > 1:
            return {"ambiguous": True, "matches": [{"id": a["id"], "name": a.get("name")} for a in matches]}
        target = matches[0] if matches else None
    if target is None:
        return {"error": f"no active set-aside matching '{ref}'", "available": [a.get("name") for a in items]}
    return {"set_aside": target}


async def exec_propose_create_scheduled_goal(uid: str, args: dict) -> dict:
    from app.routers.commitments import _pay_cfg, _validate_name
    from app.services.penny_tools import _create_proposal

    try:
        built = await build(uid, args)
        if built.get("error"):
            return {"error": built["error"]}
        if built.get("needs"):
            return {"needs": built["needs"], "assumptions": built.get("assumptions", []), "parsed": built.get("parsed")}
        raw_name = args.get("name") or built.get("suggested_name")
        if not raw_name or not str(raw_name).strip():
            return {"needs": ["name"], "summary": built["summary"]}
        try:
            name = _validate_name(raw_name)
        except HTTPException as e:
            return {"error": str(e.detail)}

        set_aside = None
        if args.get("convert_from_set_aside"):
            res = await _resolve_set_aside(uid, str(args["convert_from_set_aside"]).strip())
            if res.get("ambiguous") or res.get("error"):
                return res
            set_aside = res["set_aside"]

        pot_ref = args.get("funding_pot")
        if not pot_ref and set_aside:
            pot_ref = set_aside.get("fill_account_id") or set_aside.get("destination_account_id")
        found = await suggest_source(
            uid, source_ref=args.get("source_account_id_or_name"), pot_ref=pot_ref, set_aside=set_aside,
        )
        if found.get("blocked"):
            return found["blocked"]
        source = found.get("source")
        if source is None or (source["basis"] in ("recent-transfers", "assumed") and not args.get("use_detected_source")
                              and not args.get("source_account_id_or_name")):
            # A detected account is only a suggestion until the user agrees to it.
            return {"needs": ["source_account"], "suggested_source": source, "into": found.get("into"),
                    "summary": built["summary"]}

        pots = []
        into = found.get("into")
        if into:
            pots = [{"account_id": into["account_id"], "count_existing": False}]
        total = built["total"]["formatted"]
        this_period = built["this_period_amount"]["formatted"]
        label = built["schedule_label"]
        into_text = f" into {into['name']}" if into else ""
        summary = f"Start the '{name}' goal: {label}, from {source['name']}{into_text}, total {total}"
        consequence = f"Creates the goal and reserves this period's {this_period}. {NOTHING_MOVES}"
        params: dict = {
            "name": name,
            "schedule": built["schedule"],
            "schedule_preview": gs.preview(built["schedule"], await _pay_cfg(uid), timeutil.user_today()),
            "funding_pots": pots,
            "source_account_id": source["account_id"],
            "source_account_name": source["name"],
            "destination_names": [into["name"]] if into else [],
        }
        if set_aside:
            params["deactivate_allocation_id"] = set_aside["id"]
            params["deactivate_allocation_name"] = set_aside.get("name")
            summary += f", replacing the '{set_aside.get('name')}' set-aside"
            consequence += f" Confirming also pauses the '{set_aside.get('name')}' set-aside. {HISTORY_NOTE}"
        after = f"Total {total}, from {source['name']}"  # the card caps this line at 80 characters
        return await _create_proposal(
            uid, "create_commitment", params, summary, consequence,
            before="No goal", after=after, entity=name,
        )
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception:
        logger.exception("penny_goal_schedule: propose_create_scheduled_goal failed for %s", uid)
        return {"error": "scheduled goal proposal failed"}


async def exec_propose_update_schedule(uid: str, args: dict) -> dict:
    """propose_update_commitment with a schedule: change how an existing goal is paid in."""
    from app.services.penny_tools import _create_proposal, _resolve_commitment_for_propose

    try:
        ref = args.get("commitment_ref")
        if not ref or not str(ref).strip():
            return {"error": "commitment_ref required"}
        resolved = await _resolve_commitment_for_propose(uid, str(ref).strip())
        if resolved.get("ambiguous"):
            return resolved
        if resolved.get("error"):
            return {"error": resolved["error"]}
        doc = resolved["commitment"]
        base = fields_from_schedule(doc.get("schedule"))
        built = await build(uid, args, base=base)
        if built.get("error"):
            return {"error": built["error"]}
        if built.get("needs"):
            return {"needs": built["needs"], "assumptions": built.get("assumptions", [])}
        before = doc.get("schedule_label") or "Equal amounts each pay period"
        total = built["total"]["formatted"]
        after = f"Total {total}: {built['schedule_label']}"  # the card caps this line at 80 characters
        summary = f"Change the {doc['name']} goal to {built['schedule_label']}, total {total}"
        consequence = f"This period's amount becomes {built['this_period_amount']['formatted']}, and each later period follows the schedule. {NOTHING_MOVES}"
        return await _create_proposal(
            uid, "update_commitment", {"commitment_id": doc["id"], "schedule": built["schedule"]}, summary, consequence,
            before=before, after=after, entity=doc.get("name"),
        )
    except HTTPException as e:
        return {"error": str(e.detail)}
    except Exception:
        logger.exception("penny_goal_schedule: update schedule failed for %s", uid)
        return {"error": "schedule change proposal failed"}


def goals_with_schedules(goals: list[dict], items: list[dict]) -> list[dict]:
    """get_goals: add the source and, for a scheduled goal, the server's own sentence
    and figures. Quote them, never work them out."""
    for goal, g in zip(goals, items):
        goal["source_account_id"] = g.get("source_account_id")
        goal["source_name"] = g.get("source_name")
        goal["source_assumed"] = bool(g.get("source_assumed")) if g.get("source_name") else None
        if g.get("schedule_label"):
            goal["schedule_label"] = g["schedule_label"]
            goal["this_period_amount"] = _money2(round(float(g.get("this_period_amount") or 0) * 100))
            goal["next_periods"] = [
                {"start": n.get("start"), "end": n.get("end"), "amount": _money2(round(float(n.get("amount") or 0) * 100))}
                for n in (g.get("next_periods") or [])
            ]
    return goals
