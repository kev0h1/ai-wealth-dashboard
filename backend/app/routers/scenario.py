""""What if" life-simulator endpoints.

Two-step flow, deliberately split into a slot-extraction step and a
simulation step: `/scenario/parse` turns a natural-language question into
structured scenario items (an LLM call whose ONLY job is prose -> slots, it
never computes or opines) so the user can see and correct what was
understood BEFORE anything gets simulated; `/scenario/run` takes the
confirmed (possibly user-edited) slots, hands them to
`app.services.scenario.simulate` (the deterministic engine, owned by a
parallel workstream) and adds one short LLM-authored headline composed
strictly from the numbers `simulate` already produced.

Mirrors can_i.py's pattern throughout: deterministic scope/routing gate (no
free-form LLM judgement over whether a question is even in-scope), same
OpenRouter call shape, same house-style post-processing. FCA doctrine per
grow.py/can_i.py: facts only, hedged projections, never "you should", never
a promise about money actually moving.
"""
import json
import re
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat
from app.services.cashflow import monthly_cashflow_cached
from app.services.copy_style import house_style as _house_style
from app.services.region import get_user_region

router = APIRouter(tags=["scenario"])

# Duplicated from can_i.py rather than imported: can_i.py is owned by a
# different, already-shipped surface and this file must not create a
# coupling that breaks if can_i.py's internals move. Keep in sync by hand
# if the calendar ever needs a 13th "month".
MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

# House style (em-dash/en-dash backstop, hyphen-minus-before-£ normalisation)
# lives in app.services.copy_style, shared with can_i.py — see that module's
# docstring. Deliberately NOT duplicated here: unlike MONTH_NAMES above,
# this is a hard copy rule the user cares about specifically (an em-dash
# reads as AI-generated), so two independent copies is the wrong trade-off
# even at the cost of a little cross-file coupling.


# ── Deterministic routing classifier — no LLM, ever ─────────────────────────
# Whether a question is a "what if I take on/drop/change an ongoing money
# commitment" (this simulator) vs a one-off "can I afford £X" (can_i.py) has
# to be a hard rule: if it varied run to run, the same typed question could
# sometimes hijack the Can-I flow and sometimes not, which is far more
# confusing than occasionally missing a scenario question and falling
# through to Can-I (a safe default — Can-I still answers something sensible,
# just without the 24-month projection). Every pattern below is chosen to
# fire on an ONGOING or FUTURE-DATED change, never a single immediate spend.

# Cadence phrases: the clearest, lowest-risk signal — a question naming a
# recurring rate ("a month", "/mo", "weekly", ...) is describing a standing
# commitment almost by definition. No spend-shaped question asks "can I
# spend £45 a month this weekend" — cadence and one-off spend language don't
# co-occur in practice, so this check alone is safe to fire on regardless of
# anything else in the sentence.
_CADENCE_RE = re.compile(
    r"\b(per month|a month|/mo|/month|monthly|every month|each month|"
    r"per week|a week|/wk|/week|weekly|every week|each week|"
    r"per year|a year|/yr|/year|annually|yearly)\b"
)

# Commitment verbs: on their own these are too generic ("move to" a new
# flat could be a one-off removal cost, not a recurring one) — only trusted
# in combination with a future month/date reference below, per the brief.
_COMMITMENT_VERB_RE = re.compile(
    r"\b(start(?:ing)? paying|take on|taking on|takes on|move to|moving to|"
    r"sign(?:ing)? up for|signs up for|switch(?:ing)? to)\b"
)

# Income-change phrases. "raise" alone is genuinely ambiguous (could mean
# "raise money") but is kept per spec: false positives here just mean a
# scenario question gets modelled as a scenario, not a Can-I question wrongly
# hijacked — the asymmetric risk the brief asks us to tolerate.
_INCOME_CHANGE_RE = re.compile(
    r"\b(pay ?rise|a raise|get(?:ting)? a raise|raise|lose my job|lost my job|"
    r"losing my job|hours cut|redundant|redundancy|new job|pay cut|paycut)\b"
)

# Cancellation phrases. "drop" is broad by design (per spec) — same
# asymmetric-risk reasoning as "raise" above.
_CANCEL_RE = re.compile(
    r"\b(cancel(?:ling|led|ing)?|get rid of|stop paying|drop(?:ping)?)\b"
)


def looks_like_scenario(question: str) -> bool:
    """True when the question describes an ONGOING or FUTURE-DATED money
    change (a new standing cost, a cancellation, or an income change)
    rather than a single immediate spend. Deterministic and order-
    independent: any one signal is sufficient, no scoring, no LLM.

    Deliberately conservative in the one case that needs two signals at
    once — a commitment VERB plus a MONTH name — because a bare commitment
    verb or a bare month name is too weak alone (e.g. "move to" could just
    as easily be about a flat, and a month name shows up in ordinary
    Can-I questions like "can I afford Christmas in December"). Every
    other branch (cadence, income-change, cancellation) is trusted alone
    because none of those phrasings show up in a one-off "can I afford
    £X" question in practice.
    """
    q = question.lower()
    if _CADENCE_RE.search(q):
        return True
    if _INCOME_CHANGE_RE.search(q):
        return True
    if _CANCEL_RE.search(q):
        return True
    if _COMMITMENT_VERB_RE.search(q) and any(m in q for m in MONTH_NAMES):
        return True
    return False


# ── Deterministic relative-date resolution ──────────────────────────────────
# The model is told today's date as a FACT in the extraction prompt (below)
# so it can attempt this itself, but its answer is never trusted outright:
# LLMs are unreliable at "what's the next October from here" arithmetic,
# especially right around a year boundary, and a wrong year silently shifts
# a whole 24-month projection by a year. Resolved independently in Python
# from the question text and used to OVERRIDE the model's guess whenever we
# can derive an answer ourselves — mirrors can_i.py's own
# `_months_until_target`, which parses the question directly rather than
# asking the model to do date arithmetic.
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
_NEXT_YEAR_RE = re.compile(r"\bnext year\b")


def resolve_relative_start(question: str, today: date) -> str | None:
    """Deterministic override for a scenario item's `starts` date, or None
    if nothing in the question lets us derive one with confidence.

    Rules (both parsed straight from the question text, never from the
    model's own arithmetic):
      - A bare month name means its NEXT occurrence — this year if that
        month hasn't happened yet, otherwise next year. Matches
        can_i.py's `_months_until_target`: naming the CURRENT month is
        treated as "next year's version of this month", not "starting
        immediately", since "start paying in August" said mid-August reads
        as the next August, not the 3 days left in this one.
      - "next year" (with no month named) shifts today's own month
        forward exactly one year — there's nothing more specific to
        anchor to.
      - An explicit 4-digit year anywhere in the question ("October 2028")
        means the user gave more precision than we can safely
        second-guess — return None and let the model's own date (still
        re-validated downstream by `normalise_items`) stand.
    """
    q = question.lower()
    if _YEAR_RE.search(q):
        return None
    month_hits = [(q.index(m), i + 1) for i, m in enumerate(MONTH_NAMES) if m in q]
    if month_hits:
        _, month = min(month_hits)  # earliest-named month wins, not Jan->Dec order
        year = today.year
        if month <= today.month:
            year += 1
        if _NEXT_YEAR_RE.search(q):
            year += 1
        return date(year, month, 1).isoformat()
    if _NEXT_YEAR_RE.search(q):
        return date(today.year + 1, today.month, 1).isoformat()
    return None


def _valid_iso_date(value) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


async def _median_monthly_income(uid: str) -> float | None:
    """Best-effort median monthly income, used ONLY to prefill an
    income-change item's amount when the question gave no figure ("what if
    I lose my job"). Same helper (and 90-day cutoff) can_i.py's own
    monthly_surplus figure reads through, so a prefilled "your income" is
    never a different number from what the rest of the app would quote."""
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        data = await monthly_cashflow_cached(uid, region, cutoff)
        income = data.get("income")
        return round(float(income), 2) if income else None
    except Exception:
        return None


# ── Slot-extraction LLM call ─────────────────────────────────────────────
# The ONLY job of this call is turning prose into scenario items. It must
# never compute, compare, or opine — arithmetic is entirely
# app.services.scenario's job. Mirrors can_i.py's OpenRouter call shape
# exactly (client pattern, model tier, temperature 0, provider prefs).

_CLARIFY_MESSAGE = "Give me a rough monthly figure and I'll run it."

_EXTRACTION_SYSTEM_PROMPT_TEMPLATE = """You turn a user's plain-English "what if" money question into structured \
scenario items. You NEVER compute, compare, judge affordability, or add commentary \
- that is a different system's job. Your only output is JSON.

Today's date is {today}. Use it only to make a best-effort guess at absolute \
dates; a separate deterministic step in the app will independently re-derive \
and may override any date you produce, so approximate is fine.

Return STRICT JSON only, no markdown code fence, no prose before or after:
{{"items": [
  {{"label": "<=40 chars, short plain description e.g. 'Car finance'",
   "amount": <positive number, or null ONLY if the question is an income \
change (a job loss, redundancy, hours cut) that names no figure - never \
invent a number>,
   "direction": "out" if money leaves the user (a new cost, or an income \
CUT) else "in" if money arrives (a cancellation freeing up money, or a pay \
RISE),
   "cadence": "monthly" | "weekly" | "annual" | "one_off" (default to \
"monthly" for an unspecified recurring cost/income change, "one_off" only \
for a clearly single event),
   "starts": "YYYY-MM-DD" best guess, or null if you cannot tell,
   "ends": "YYYY-MM-DD" or null (null unless the question states an end),
   "kind": "new_outgoing" | "removal" | "income_change",
   "category": a short category word if obvious (e.g. "Transport", \
"Subscriptions") else null}}
]}}

If the question describes more than one distinct change, return multiple \
items (rare - most questions are one item). If you cannot extract anything \
usable at all, return {{"items": []}}. Never wrap the JSON in markdown, \
never add explanation, never output anything except the JSON object."""


def _strip_code_fence(text: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"```$", "", text).strip()
    return text


def _parse_json_items(raw: str) -> list[dict] | None:
    """Defensive parse of the extraction reply. Returns None (never raises)
    on anything that isn't the expected `{"items": [...]}` shape — a
    malformed or non-JSON reply must fall through to the clarify response,
    not a 500."""
    text = _strip_code_fence(raw)
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    items = data.get("items")
    if not isinstance(items, list):
        return None
    return [i for i in items if isinstance(i, dict)]


async def _extract_items_llm(question: str, today: date, uid: str) -> list[dict] | None:
    """Returns None on ANY failure (network, non-200, malformed reply) so
    the caller can degrade to a clarify response rather than a 500 — the
    extraction step is allowed to fail softly since nothing has been
    simulated yet."""
    system_prompt = _EXTRACTION_SYSTEM_PROMPT_TEMPLATE.format(today=today.isoformat())
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await openrouter_chat(
                {
                    "model": "anthropic/claude-haiku-4-5",
                    "max_tokens": 500,
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question},
                    ],
                },
                user_id=uid, pipeline="scenario", client=client,
            )
    except Exception:
        return None
    if r.status_code != 200:
        return None
    try:
        raw_content = r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError, TypeError):
        return None
    return _parse_json_items(raw_content)


async def parse_question(uid: str, question: str) -> dict:
    """Prose -> confirmable scenario slots. The single home for slot
    extraction: both POST /scenario/parse below and the deterministic
    scenario short-circuit in can_i.py's /can-i call this, rather than each
    keeping its own copy (two copies of extraction logic would drift the
    moment one side changed a prompt or a post-processing rule).

    Deliberately does NOT simulate: the user (or the UI on their behalf)
    confirms/edits the extracted items first, then calls /scenario/run.
    """
    today = date.today()
    raw_items = await _extract_items_llm(question, today, uid)
    if raw_items is None:
        # Extraction call itself failed (network/non-200/unparsable reply)
        # — nothing was actually delivered.
        return {"items": [], "rejected": [], "prefilled": False, "clarify": _CLARIFY_MESSAGE}

    if not raw_items:
        return {"items": [], "rejected": [], "prefilled": False, "clarify": _CLARIFY_MESSAGE}

    # ── Deterministic post-processing the model is NOT trusted with ────
    resolved_start = resolve_relative_start(question, today)
    prefilled = False
    for item in raw_items:
        if resolved_start:
            # Always prefer our own question-derived date over the model's
            # guess when we can derive one — see resolve_relative_start's
            # docstring for why the model's own date arithmetic isn't
            # trusted. When we can't derive one (no month/"next year"
            # phrase, or an explicit year was given), leave the model's
            # value in place; normalise_items re-validates its format.
            item["starts"] = resolved_start
        if item.get("kind") == "income_change" and not item.get("amount"):
            median_income = await _median_monthly_income(uid)
            if median_income:
                item["amount"] = median_income
                prefilled = True

    from app.services.scenario import normalise_items
    items, rejected = normalise_items(raw_items)

    if not items:
        return {"items": [], "rejected": rejected, "prefilled": False, "clarify": _CLARIFY_MESSAGE}

    return {"items": items, "rejected": rejected, "prefilled": prefilled, "clarify": None}


@router.post("/scenario/parse")
async def scenario_parse(body: dict, user: dict = Depends(current_user)):
    """Prose -> confirmable scenario slots. Deliberately does NOT simulate:
    the user (or the UI on their behalf) confirms/edits the extracted items
    first, then calls /scenario/run."""
    question = (body.get("question") or "").strip()
    if not (3 <= len(question) <= 200):
        raise HTTPException(400, "question must be 3-200 characters")
    if not OPENROUTER_API_KEY:
        raise HTTPException(500, "AI not configured")

    uid = user["email"]

    return await parse_question(uid, question)


# ── Headline composition for /scenario/run ──────────────────────────────
# The LLM here is given ONLY the already-computed figures from simulate()
# and is explicitly forbidden from introducing any number that isn't
# already in them — it is phrasing, never arithmetic. If it fails for any
# reason the endpoint falls back to a server-composed template headline:
# the maths is the product, the phrasing is decoration.
#
# BUG THIS SECTION FIXES: handing the model the raw payload (a bare
# `recurring_delta` next to a bare `cash.per_month` array) forbids it from
# INVENTING a new number, but it does nothing to stop it inventing a new
# RELATIONSHIP between two real ones. Verified live on an annual £1,200/yr
# cancellation: the model wrote "removing this would improve two months'
# surplus by about £100 each" — every figure real (£100 is the steady
# monthly-equivalent that applies to ALL 24 months, "two months" correctly
# names the anniversary months), but welded into a claim that's true of
# neither number. `_build_headline_facts` below fixes this by never handing
# over a bare figure: every key states its own scope in the label itself
# (e.g. "..._applies_to_every_month" vs "..._applies_ONLY_in_these_months").
# `_is_lumpy_scenario` below additionally routes the whole class of
# scenario where this failure mode is most likely (annual/one_off-dominated)
# away from the LLM entirely, per the coordinator's fix #3.

_HEADLINE_SYSTEM_PROMPT = """You are Penny, the AI inside a personal money app. The user just ran a "what \
if" scenario simulation. Compose ONE short headline sentence (max 22 words) \
summarising its impact, using ONLY the figures in the FACTS JSON below. You \
may NOT introduce, compute, or estimate any number that is not already \
present in FACTS. Every fact's label states EXACTLY which time period it \
applies to - a label containing "applies_to_every_month" is a STEADY figure \
true of every single month in the horizon; a label containing "ONLY_in_" \
or naming specific months is true ONLY in those exact named months and \
nowhere else. You may NOT attach any figure to a time period other than \
the one its own label states, and you may NOT combine two differently-\
scoped figures into a single claim (for example: never say a steady \
every-month figure is what happens "in" a specific spike month, and never \
say a specific-month spike figure is the steady monthly rate - state each \
fact only for the period its own label gives it, and if you mention two \
different figures, keep them as two separate, separately-scoped statements \
rather than one blended one). You may NOT say "you should" or give an \
instruction - facts only, never advice. Hedge every projected figure \
("expected", "about", "around") - never promise a specific external money \
movement will happen. Always write a currency figure with the £ symbol, \
NEVER the word "pounds". British English, plain punctuation only: no \
em-dash (—) or en-dash (–), use a comma or full stop instead. Output ONLY \
the sentence, nothing before or after it.

FACTS: {facts}"""


def _human_month_offset(i: int, today: date) -> str:
    """'Mon YYYY' for the i-th month after today's month (0-indexed).

    A tiny duplicate of the same date arithmetic app.services.scenario
    keeps its own private copy of (`_add_months`/`_human_month`) — this
    codebase's own stated convention for trivial calendar helpers rather
    than importing another module's private functions (see that module's
    comment on why it duplicates `_median` instead of sharing cashflow.py's
    copy).
    """
    total = today.year * 12 + (today.month - 1) + i
    year, month = divmod(total, 12)
    return date(year, month + 1, 1).strftime("%b %Y")


def _build_headline_facts(payload: dict) -> dict:
    """Curated, EXPLICITLY-LABELLED subset of simulate()'s payload for the
    headline LLM call — never a bare number the model has to guess the
    scope of. See the block comment above this section for the concrete
    failure this replaces.
    """
    baseline = payload.get("baseline") or {}
    facts: dict = {"horizon_months": payload.get("horizon_months")}

    surplus_now = baseline.get("monthly_surplus")
    if surplus_now is not None:
        facts["current_monthly_surplus_before_this_scenario"] = surplus_now

    recurring_delta = payload.get("recurring_delta")
    if recurring_delta is not None:
        facts["steady_monthly_equivalent__applies_to_every_month_in_the_horizon"] = recurring_delta

    cash = payload.get("cash") or {}
    per_month = cash.get("per_month") or []
    if per_month and surplus_now is not None and recurring_delta is not None:
        # Months whose ACTUAL figure differs meaningfully from the steady
        # monthly-equivalent above (an annual item's anniversary month, a
        # one_off's single month) get their own separately-labelled fact,
        # naming exactly which months it applies to and nowhere else.
        today = date.today()
        spikes = {
            _human_month_offset(i, today): round(v - surplus_now, 2)
            for i, v in enumerate(per_month)
            if abs(round(v - surplus_now, 2) - recurring_delta) > 0.5
        }
        if spikes:
            facts["months_with_a_spike__this_exact_figure_applies_ONLY_in_these_named_months_nowhere_else"] = spikes

    if cash.get("surplus_after") is not None:
        facts["surplus_after_this_scenario__steady_state"] = cash["surplus_after"]
    if cash.get("first_tight_month"):
        facts["first_month_surplus_goes_negative"] = cash["first_tight_month"]

    for key in ("debt", "plans", "grow", "absorb"):
        block = payload.get(key)
        if block:
            facts[f"{key}_block"] = block

    return facts


async def _compose_headline_llm(payload: dict, uid: str) -> str | None:
    if not OPENROUTER_API_KEY:
        return None
    facts = _build_headline_facts(payload)
    system_prompt = _HEADLINE_SYSTEM_PROMPT.format(facts=json.dumps(facts, default=str))
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await openrouter_chat(
                {
                    "model": "anthropic/claude-haiku-4-5",
                    "max_tokens": 120,
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": "Summarise this scenario's impact in one sentence."},
                    ],
                },
                user_id=uid, pipeline="scenario", client=client,
            )
        if r.status_code != 200:
            return None
        content = r.json()["choices"][0]["message"]["content"]
    except Exception:
        return None
    headline = (content or "").strip().splitlines()[0].strip() if content else ""
    return headline or None


def _is_lumpy_scenario(payload: dict) -> bool:
    """True when simulate()'s own `lumpy` flag says this scenario is
    annual/one_off-dominated — exactly the shape of scenario where a steady
    monthly-equivalent figure and a specific-month spike figure sit side by
    side, which is what the model welded into one false claim during
    verification. Routed away from the LLM entirely rather than trusted to
    phrase correctly even with the labelled facts above: a template cannot
    invent a false relationship between two numbers because it never
    improvises one.

    Reads `payload["lumpy"]` directly rather than string-matching the
    assumption prose the way this used to work: that approach silently
    desynced the moment a copy edit touched the matched string, with no
    test failing. `simulate()` is the single source of truth for this flag
    (see app/services/scenario.py) — every payload it returns MUST carry
    it, so a missing key here is a programming error upstream, not
    something to guess a default for.
    """
    return payload["lumpy"]


def _fmt_money(value: float) -> str:
    """£ format for the lumpy headline composer: whole-pound figures print
    with no decimals ("£1,200"), anything else keeps 2dp ("£1,532.95").
    Amounts here are always positive (validated by normalise_items) and the
    steady monthly-equivalent is always shown via abs() before formatting,
    so this never needs to express a negative — direction is carried by
    the surrounding sentence's wording ("frees up"/"costs"), not a sign."""
    value = float(value)
    if value == int(value):
        return f"£{int(value):,}"
    return f"£{value:,.2f}"


def _spike_month_occurrences(item: dict, today: date, horizon: int) -> list[str]:
    """'Month YYYY' labels for every occurrence of a lumpy (annual/one_off)
    item's amount landing within the horizon.

    Mirrors `app.services.scenario.build_delta_series`'s own annual/one_off
    cadence logic exactly (annual: the anniversary month, then every 12
    months; one_off: a single month) but computed directly from the ITEM,
    not read back off the cash block. The cash block is `None` under thin
    transaction history, so deriving spike months from it would silently
    drop this composer's only source of a month name in exactly the case
    where a useful headline matters most (a new user with little history
    asking "what if" is a realistic, not edge, case).
    """
    try:
        start_d = date.fromisoformat(str(item.get("starts")))
    except (ValueError, TypeError):
        return []
    today_idx = today.year * 12 + today.month
    start_i = (start_d.year * 12 + start_d.month) - today_idx
    end_i = horizon
    ends_raw = item.get("ends")
    if ends_raw:
        try:
            end_d = date.fromisoformat(str(ends_raw))
            end_i = (end_d.year * 12 + end_d.month) - today_idx
        except (ValueError, TypeError):
            end_i = horizon
    hi = min(horizon, end_i)

    def _label(i: int) -> str:
        total = today.year * 12 + (today.month - 1) + i
        year, month = divmod(total, 12)
        return date(year, month + 1, 1).strftime("%B %Y")

    if item.get("cadence") == "one_off":
        return [_label(start_i)] if 0 <= start_i < hi else []

    months: list[str] = []
    i = start_i
    while i < hi:
        if i >= 0:
            months.append(_label(i))
        i += 12
    return months


def _lumpy_headline(items: list[dict], payload: dict, today: date | None = None) -> str:
    """Deterministic, server-composed headline for a lumpy (annual/one_off-
    dominated) scenario. A DIFFERENT composer from `_template_headline`,
    which stays exactly as it was and remains reserved for the genuine
    LLM-failure path.

    Routing a lumpy scenario away from the LLM entirely was the right call
    (a template cannot invent a false relationship between two numbers,
    which is exactly the bug this whole mechanism exists to prevent) — but
    live review found that falling back to `_template_headline` here made
    every lumpy scenario (an annual insurance bill, an annual subscription,
    a one-off deposit) produce a headline that names no figure, no month
    and no direction. Safe and useless isn't the target: the product claim
    is that the app already knows the user's numbers. This composer states
    the steady monthly-equivalent and the specific spike month(s) as two
    separate, clearly-scoped clauses (never blended, which is the original
    bug) using only figures already present in `items`/`payload`.

    `today` is an optional override purely for deterministic testing; the
    real call site always uses the default (today's actual date).
    """
    today = today or date.today()
    from app.services.scenario import HORIZON_MONTHS

    lumpy_items = [it for it in items if it.get("cadence") in ("annual", "one_off")]
    if not lumpy_items:
        # Shouldn't happen (only ever called when _is_lumpy_scenario said
        # true), but a mismatched call site must still degrade to SOME
        # headline rather than raising out of a response-building path.
        return _template_headline(items)

    # Only the first lumpy item is narrated by name — with _MAX_ITEMS=3 and
    # this being a single-question feature in practice, a multi-item
    # scenario with more than one lumpy item is rare; naming just the
    # dominant one keeps the sentence a single clean headline rather than
    # a run-on list. The full per-item breakdown is already in the payload
    # for anyone who wants it.
    item = lumpy_items[0]
    label = str(item.get("label") or "This change").strip()
    amount = float(item.get("amount") or 0.0)
    direction = item.get("direction")
    kind = item.get("kind")
    amt_str = _fmt_money(amount)
    occurrences = _spike_month_occurrences(item, today, HORIZON_MONTHS)

    if item.get("cadence") == "one_off":
        month_str = occurrences[0] if occurrences else "the stated month"
        verb = "brings in" if direction == "in" else "costs"
        sentence = (
            f"{label} {verb} about {amt_str} in {month_str}, a one-off rather "
            f"than an ongoing change."
        )
        return _house_style(sentence)

    # Annual: the steady monthly-equivalent comes straight from the
    # engine's own recurring_delta when simulate() provided one (it's
    # computed even when the cash block itself is None under thin
    # history); amount/12 is the same honest fallback
    # app.services.scenario's own steady_monthly_delta formula uses for a
    # pure annual item, so this can never disagree with the engine.
    recurring_delta = payload.get("recurring_delta") if isinstance(payload, dict) else None
    steady = abs(recurring_delta) if recurring_delta is not None else round(amount / 12, 2)
    steady_str = _fmt_money(steady)

    if occurrences:
        # An annual item always recurs in the SAME calendar month every
        # year, so there is only ever one distinct month name to say -
        # naming it once ("October") already fully states the pattern
        # without an "and October and October" list. "each year" is added
        # only when the horizon actually contains more than one
        # occurrence, so a single-occurrence case doesn't overclaim a
        # recurrence the horizon hasn't shown yet.
        month_name = occurrences[0].split(" ")[0]
        month_phrase = f"{month_name} each year" if len(occurrences) > 1 else month_name
    else:
        month_phrase = "the anniversary month"

    if direction == "in":
        lead = f"Cancelling {label}" if kind == "removal" else label
        verb = "frees up" if kind == "removal" else "adds"
        sentence = (
            f"{lead} {verb} about {steady_str} a month on average, "
            f"with the full {amt_str} landing in {month_phrase}."
        )
    else:
        sentence = (
            f"{label} costs about {steady_str} a month on average, "
            f"with the full {amt_str} leaving in {month_phrase}."
        )
    return _house_style(sentence)


def _template_headline(items: list[dict]) -> str:
    """Deterministic, server-composed fallback headline used only when the
    LLM phrasing call is unavailable or fails. Written defensively against
    `app.services.scenario`'s own payload shape (owned by a parallel
    workstream) — it never inspects `simulate`'s return value, only the
    already-validated `items` this endpoint was given, so it can never
    error regardless of how that payload is shaped."""
    from app.services.scenario import HORIZON_MONTHS
    if len(items) == 1:
        subject = items[0].get("label") or "this change"
    else:
        subject = f"these {len(items)} changes"
    return (
        f"Ran {subject} over the next {HORIZON_MONTHS} months, see the numbers "
        f"below for the expected effect on your cash, debt and savings."
    )


@router.post("/scenario/run")
async def scenario_run(body: dict, user: dict = Depends(current_user)):
    """Confirmed (possibly user-edited) scenario items -> full projection.
    Validates via normalise_items (never re-implements that validation),
    calls the deterministic simulate() engine, and adds one short
    LLM-authored headline composed strictly from simulate()'s own numbers.
    """
    raw_items = body.get("items")
    if not isinstance(raw_items, list) or not raw_items:
        raise HTTPException(400, "items required")
    if len(raw_items) > 10:
        raise HTTPException(400, "too many items")

    uid = user["email"]

    # This is the single validation point for the request body: normalise
    # here, against the RAW client-submitted items, and pass the clean
    # result straight through to simulate(). simulate() also calls
    # normalise_items internally on its own input (it has to, since it's a
    # public function other callers may hit directly) — that internal call
    # is harmless but redundant here, because by the time it runs the items
    # are already clean, so its own `rejected` output is always `[]`. Do
    # NOT swap the order below: `rejected` (this router's list, built from
    # the items the client actually sent) is deliberately what gets
    # returned to the caller, not whatever simulate() computed against an
    # already-validated list — that one carries no information.
    from app.services.scenario import normalise_items, simulate
    items, rejected = normalise_items(raw_items)
    if not items:
        raise HTTPException(400, "no valid scenario items")

    payload = await simulate(uid, items)

    if isinstance(payload, dict) and _is_lumpy_scenario(payload):
        # Skip the LLM entirely for a lumpy (annual/one_off-dominated)
        # scenario — see _is_lumpy_scenario's docstring. Uses the DEDICATED
        # lumpy composer (real figures, two clearly-scoped clauses), not
        # _template_headline (that generic sentence stays reserved for the
        # genuine LLM-failure path below — a lumpy scenario is a legitimate
        # question, not an error).
        headline = _lumpy_headline(items, payload)
    else:
        headline = await _compose_headline_llm(payload, uid)
        if headline:
            headline = _house_style(headline)
        else:
            headline = _template_headline(items)

    resp: dict = dict(payload) if isinstance(payload, dict) else {"result": payload}
    resp["headline"] = headline
    resp["rejected"] = rejected  # ours (see comment above), not payload's own (always empty)
    return resp
