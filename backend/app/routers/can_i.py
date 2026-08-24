"""Can-I-afford-X quick-fire Q&A endpoint.

Deterministic fact-gathering (safe-to-spend, cashflow, savings buffer,
upcoming bills, precomputed what-if arithmetic) feeds a short LLM call that
ONLY phrases the verdict — it never computes a figure itself. FCA doctrine
per grow.py: facts only, never "you should".
"""
import math
import re
import statistics
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import APP_URL, OPENROUTER_API_KEY, OPENROUTER_PROVIDER_PREFS
from app.core.subscription import check_ai_chat_limit, increment_ai_chat_usage
from app.db.collections import cashflow_cache_col, commitments_col, savings_goals_col
from app.routers.analytics import compute_safe_to_spend, _build_cashflow_response
from app.routers.savings import _cashflow, _current_savings
from app.routers.scenario import looks_like_scenario, parse_question
from app.services.categories import BUILTIN_CATEGORIES, get_category_kinds, is_discretionary
from app.services.region import get_user_region

router = APIRouter(tags=["can-i"])

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

# Deterministic category-mention detection for change_intents — replaces
# leaving "does this question relate to category X" to LLM judgement, which
# was inconsistent run-to-run. Conservative on purpose: no bare "food"/"eat"
# (over-matches groceries, etc). Extend sensibly, don't loosen.
CATEGORY_SYNONYMS: dict[str, list[str]] = {
    "Eating Out": [
        "dinner", "lunch", "brunch", "takeaway", "take-away", "restaurant",
        "meal", "eating out", "eat out", "food out",
    ],
    "Groceries": ["groceries", "supermarket", "food shop"],
    "Entertainment": ["cinema", "concert", "night out", "tickets"],
    "Shopping": ["shoes", "clothes", "trainers", "shopping"],
    "Transport": ["taxi", "uber", "train ticket"],
}


def _fmt_gbp(amount: float, decimals: int = 0) -> str:
    """£ format matching the app-wide convention: a Unicode minus (−), never
    a hyphen, for negative money (see SpendHeader.tsx / SafeToSpendCard.tsx)."""
    amount = amount or 0.0
    return f"−£{abs(amount):,.{decimals}f}" if amount < 0 else f"£{amount:,.{decimals}f}"


# House-style guardrail: extracted to app.services.copy_style so every
# surface phrasing LLM output shares exactly one em-dash/en-dash backstop
# (see that module's docstring for the full rationale). Kept as a thin
# local delegation, not a straight `from ... import house_style`, so this
# file's public behaviour (the name `_house_style` other code in this
# module already calls) stays byte-identical.
from app.services.copy_style import house_style as _house_style


def _round5(value: float) -> int:
    """Round to the nearest £5 — the "round" figure the chip-seeding rules ask
    for, never a jagged pence amount in a tappable suggestion."""
    return int(round(value / 5.0)) * 5


# ── Out-of-scope detection (deterministic, no LLM) ───────────────────────────
# A cheap keyword/amount classifier, not a Haiku call: scope must be a hard
# rule, not the model's free-form judgement, so the refusal text is never
# LLM-authored and never varies run-to-run. Errs toward IN scope (a false
# negative just means the existing envelope-and-ask path handles it) rather
# than refusing a real affordability question it doesn't recognise the
# phrasing of.
_SCOPE_KEYWORDS = {
    "afford", "affordable", "spend", "spending", "spent", "save", "saving",
    "savings", "budget", "buy", "buying", "book", "booking", "pay", "paying",
    "cost", "costs", "price", "priced", "weekend", "holiday", "trip", "gift",
    "treat", "takeaway", "take-away", "extra", "top up", "topup", "subscribe",
    "subscription", "upgrade", "session", "splurge", "indulge",
    "safe to spend", "free until", "this week",
    "this month", "payday", "afford it",
}
# Category vocabulary is also a scope signal, but "Other" is too generic a
# substring (matches "another", "mother", ...) to trust — excluded on purpose.
_SCOPE_CATEGORY_WORDS = {c.lower() for c in BUILTIN_CATEGORIES if c != "Other"} | {
    syn for syns in CATEGORY_SYNONYMS.values() for syn in syns
}

# "put toward Japan" was originally matched as the adjacent phrase "put
# toward", which misses "put MORE toward Japan" or "put toward the Japan
# pot" — anything with a word between "put" and its target. Token-level
# instead: "put" plus ANY of these words anywhere in the question is enough
# ("put", "aside", "£50" is a real sentence; the false-negative risk of a
# broader match is lower than refusing a real "put ... toward a goal"
# question).
_PUT_RE = re.compile(r"\bput\b")
_PUT_TARGET_RE = re.compile(r"\b(toward|towards|into|to|aside|by)\b")


def _is_out_of_scope(question: str, amount_asked: float | None, active_goal_names: list[str] | None = None) -> bool:
    """True when the question carries neither an extractable £ figure, any
    recognisable affordability/spend vocabulary, a "put ... toward/aside/..."
    contribution phrasing, nor a mention of one of the user's own active
    commitment/goal names — the engine has nothing to ground an answer in.
    """
    if amount_asked is not None:
        return False
    q = question.lower()
    if any(kw in q for kw in _SCOPE_KEYWORDS):
        return False
    if any(word in q for word in _SCOPE_CATEGORY_WORDS):
        return False
    if _PUT_RE.search(q) and _PUT_TARGET_RE.search(q):
        return False
    if active_goal_names:
        if any(name and name.lower() in q for name in active_goal_names):
            return False
    return True


async def _active_goals_summary(uid: str) -> list[dict]:
    """Name + amount + target_date for the user's own active commitments/
    goals. Two jobs: (1) a scope signal ("can I add to japan?", "more for
    the japan pot?" both name a real goal even though they carry no spend
    keyword) and (2) grounding CONTEXT for the LLM once a question is let
    through — without this, _is_out_of_scope correctly says "in scope" for
    "can I add to Japan?" but the LLM has no "Japan" fact anywhere and falls
    back to its OWN out-of-scope refusal anyway, which is a false refusal by
    a different route. One cheap projected query (no pot-ledger maths —
    that's a heavier read Chip C needs for an exact slice figure, not
    needed just to name-check a goal), same collection Chip C reads."""
    try:
        goals = []
        async for doc in commitments_col.find(
            {"user_id": uid, "status": "active"},
            {"name": 1, "amount": 1, "target_date": 1},
        ):
            name = str(doc.get("name") or "").strip()
            if name:
                goals.append({
                    "name": name,
                    "amount": doc.get("amount"),
                    "target_date": doc.get("target_date"),
                })
        return goals
    except Exception:
        return []


_EMPTY_COMPLETION_FALLBACK = "Couldn't work that one out, try rephrasing with an amount."


def _parse_headline_reply(raw: str) -> tuple[str, str]:
    """Split the model's structured ``HEADLINE:``/``REPLY:`` output.

    Defensive: if the model didn't follow the format (rare at temperature 0,
    but never assume), the whole reply is used for both fields rather than
    surfacing a blank headline. If the completion itself was empty (provider
    hiccup — status 200 with no usable content), both fields fall back to a
    fixed, non-empty message rather than ever returning "".
    """
    headline: str | None = None
    reply_lines: list[str] = []
    mode: str | None = None
    for line in (raw or "").strip().splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("HEADLINE:"):
            headline = stripped.split(":", 1)[1].strip()
            mode = "headline"
            continue
        if stripped.upper().startswith("REPLY:"):
            reply_lines.append(stripped.split(":", 1)[1].strip())
            mode = "reply"
            continue
        if mode == "reply" and stripped:
            reply_lines.append(stripped)
    reply = " ".join(l for l in reply_lines if l).strip() or (raw or "").strip()
    if not reply:
        reply = _EMPTY_COMPLETION_FALLBACK
    if not headline:
        m = re.match(r"(.+?[.!?])(\s|$)", reply)
        headline = m.group(1).strip() if m else reply
    if not headline:
        headline = _EMPTY_COMPLETION_FALLBACK
    return headline, reply


_LEADING_VERDICT_CLAUSE_RE = re.compile(r"^(yes|no|tight),\s*", re.IGNORECASE)


def _strip_leading_verdict_clause(reply: str) -> str:
    """Belt-and-braces for the prompt clause telling the model resolved_verdict
    is final and not to be echoed: strip a leading "Yes,"/"No,"/"Tight," off
    the REPLY sentence and re-capitalise, rather than trust the prompt alone.
    Only ever called when a verdict was actually derived server-side, so a
    stray match here is always the model relapsing into its own guess, never
    a legitimate reply that happens to start with one of these words."""
    stripped = _LEADING_VERDICT_CLAUSE_RE.sub("", reply, count=1)
    if stripped and stripped != reply:
        stripped = stripped[0].upper() + stripped[1:]
    return stripped or reply


def _derive_verdict(what_ifs: dict, safe_to_spend: float) -> str | None:
    """Deterministic yes/tight/no from the SAME precomputed what-if arithmetic
    the facts card shows. The one word the user actually reads must never be
    left to the LLM once the arithmetic already answers it — that was the
    root cause of the golf-session bug: safe_to_spend is already net of
    bills_total (see compute_safe_to_spend in analytics.py, which walks the
    bill timeline before deriving the figure), but the model re-subtracted
    bills a second time and answered "No" over a genuinely positive £61.

    None (leave it to the LLM) in two cases:
    - no amount was asked at all — the "name a thing, no price" path.
    - months_until_target is set — a "save £2000 for Japan by December"
      question carries an amount but free_after_spend is a THIS-PAY-PERIOD
      figure; it is not what was asked. Answering a multi-month savings
      question with a this-period afford/refuse verdict produced a card
      with a "Not this one" headline sitting over "Saving at this pace,
      about £1,600 by December" — two answers to two different questions on
      one card. The offer/savable_by_target branch in _compose_facts owns
      this case instead; see there.

    "tight" carries both an absolute and a relative arm because either alone
    misses a case the other catches: a large safe_to_spend pot where 20%
    left over is still generous in proportion but the resulting per-day rate
    is unliveable, or a small pot where the per-day rate looks fine in
    isolation but the spend eats most of what's actually left.
    """
    if what_ifs.get("months_until_target"):
        return None
    amount = what_ifs.get("amount_asked")
    after = what_ifs.get("free_after_spend")
    if amount is None or after is None:
        return None
    if after < 0:
        return "no"
    per_day_after = what_ifs.get("per_day_after")
    if after < 0.2 * safe_to_spend or (per_day_after is not None and per_day_after < 5):
        return "tight"
    return "yes"


_VERDICT_HEADLINES = {
    # "Not this one" is aimed at the purchase, not the person — a bare "No"
    # reads as a rebuke. Exact strings, not composed, so this card can never
    # drift from the copy the product owner signed off.
    "no": "Not this one",
    "tight": "Yes, but it'll be tight",
    "yes": "Yes",
}


def _nearest_yes_amount(safe_to_spend: float) -> int | None:
    """Largest round-£5 amount that actually fits within safe_to_spend — the
    version of the ask that works, offered alongside a "Not this one" so the
    refusal isn't the end of the conversation. Never £0: at or below zero
    there IS no nearest yes, so this returns None and the caller emits
    nothing rather than a suggestion nobody can act on."""
    if safe_to_spend <= 0:
        return None
    amount = int(safe_to_spend // 5) * 5
    return amount if amount >= 5 else None


def _fmt_rate(amount: float) -> str:
    """£ string for a derived daily rate. "About" and pence can't both be
    true — implying audited, to-the-penny precision on a rounded rate reads
    as false confidence. Whole pounds from £5/day up; pence only below that,
    where the gap between e.g. £1.20 and £2 a day is a genuinely different
    lived experience, not rounding noise."""
    decimals = 0 if abs(amount) >= 5 else 2
    return _fmt_gbp(amount, decimals=decimals)


def _per_day_line(per_day: float) -> str:
    return f"That's about {_fmt_rate(per_day)} a day"


def _compose_facts(facts: dict, offer: dict | None) -> list[str]:
    """Server-composed grounding lines, from the SAME figures the verdict
    used — never re-derived, never LLM-authored. Normally 3 lines:
    free-until-payday, the per-day rate, then whichever precomputed what-if
    is most relevant to what was actually asked.

    When an amount was asked AND there's a material bill in the payday
    window, the bills line and the what-if line are BOTH shown: bills is the
    REASON, the what-if is the CONSEQUENCE, and letting one silently
    displace the other is exactly how the golf-session transcript ended up
    with "£100 leaves £61 free" reading like an approval under a "No". The
    same applies when a "Not this one" verdict adds a nearest-yes line, or a
    "tight" verdict adds the post-spend daily rate that's the actual reason
    it's tight — reason/consequence/next-step all outrank a derived
    PRE-spend rate once there's a concrete amount on the table, so per-day
    is what gets cut to make room (never bills, never the what-if, never
    nearest-yes/tight-rate), and the cap rises from 3 lines to 4.

    A multi-month savings question ("save £2000 for Japan by December") is
    NOT a this-pay-period affordability question even though it carries an
    amount — free_after_spend answers a different question than the one
    asked. months_until_target is the signal (not the `offer` dict, which is
    a derived UI artifact built in its own try/except and can fail to build
    even when the question genuinely named a future month): when it's set,
    this-period framing (bills-collision, the what-if line, nearest-yes) is
    suppressed entirely and the savings-pace line owns the card instead,
    exactly like the pre-existing behaviour this endpoint had before verdict
    derivation was added. _derive_verdict shares the same signal so the
    headline can never disagree with what the facts card is showing.
    """
    lines: list[str] = []
    free = facts.get("safe_to_spend") or 0.0
    next_payday = facts.get("next_payday")
    payday_label = None
    if next_payday:
        try:
            payday_label = date.fromisoformat(str(next_payday)[:10]).strftime("%a %-d %b")
        except ValueError:
            payday_label = None
    lines.append(
        f"{_fmt_gbp(free)} free until {payday_label}" if payday_label
        else f"{_fmt_gbp(free)} free until payday"
    )

    what_ifs = facts.get("what_ifs") or {}
    amount_asked = what_ifs.get("amount_asked")
    free_after_spend = what_ifs.get("free_after_spend")
    is_multi_month = bool(what_ifs.get("months_until_target"))
    bills_total = facts.get("bills_total")
    bills_material = bool(bills_total)  # falsy for None/0 — nothing to explain

    # safe_to_spend is already net of bills_total in the SAFETY sense (the
    # bill timeline is walked before the floor is taken), but that isn't
    # literally "subtracted from a balance you can point at" when income
    # arrives before the bill and covers it without the running balance ever
    # dipping — so this says "accounted for", not "taken off [a] figure",
    # which would be false for that path. "due", not "land": a bill hasn't
    # happened yet and this line must not read as a prediction that it will
    # clear via a specific payment rail on a specific day.
    bills_line = (
        f"{_fmt_gbp(bills_total)} of bills due before payday, already accounted for"
        if bills_material else None
    )

    # Multi-month savings question: the this-period what-if doesn't apply
    # (see docstring) — suppress it so it can't sit next to, or replace, the
    # savings-pace line below.
    whatif_line = None
    if not is_multi_month and amount_asked is not None and free_after_spend is not None:
        whatif_line = (
            f"£{amount_asked:,.0f} leaves {_fmt_gbp(free_after_spend)} free" if free_after_spend >= 0
            else f"£{amount_asked:,.0f} would take you {_fmt_gbp(free_after_spend)}"
        )

    # _derive_verdict already returns None for the multi-month case, so
    # nothing further needs to check is_multi_month explicitly below.
    verdict = _derive_verdict(what_ifs, free)

    nearest_yes_line = None
    if verdict == "no":
        nearest = _nearest_yes_amount(free)
        if nearest is not None:
            nearest_yes_line = f"{_fmt_gbp(nearest)} would work"

    tight_rate_line = None
    if verdict == "tight":
        per_day_after = what_ifs.get("per_day_after")
        if per_day_after is not None:
            tight_rate_line = f"That leaves about {_fmt_rate(per_day_after)} a day until payday"

    # Both-lines case: bills is material AND there's a spend consequence
    # (what-if, nearest-yes, or the tight-rate line) to put next to it.
    # Per-day is dropped here by design, not squeezed into a 4th slot
    # alongside it — see docstring. Judged this cleaner than always maxing
    # out at 4 lines: once the reader can see the exact bills figure and the
    # exact result of their spend, a derived pre-spend £/day rate is
    # redundant restatement, not new information.
    if bills_material and (whatif_line is not None or nearest_yes_line is not None):
        lines.append(bills_line)
        if whatif_line:
            lines.append(whatif_line)
        if tight_rate_line:
            lines.append(tight_rate_line)
        if nearest_yes_line:
            lines.append(nearest_yes_line)
        return lines[:4]

    per_day = facts.get("per_day")
    if per_day is not None:
        lines.append(_per_day_line(per_day))

    third: str | None = None

    # Multi-month savings pace — the offer/savable branch WINS whenever it
    # applies (see docstring): this is checked first, same priority it had
    # before verdict derivation existed, and whatif_line is already None in
    # this case so it can never be picked below instead.
    if offer and what_ifs.get("savable_by_target") is not None:
        try:
            target = date.fromisoformat(str(offer["target_date"])[:10])
            target_label = f"{MONTH_NAMES[target.month - 1].capitalize()} {target.year}"
        except (KeyError, ValueError, IndexError):
            target_label = None
        if target_label:
            third = f"Saving at this pace, about {_fmt_gbp(what_ifs['savable_by_target'])} by {target_label}"

    if third is None:
        third = whatif_line

    if third is None:
        mentioned = next(
            (ci for ci in facts.get("change_intents", []) if ci.get("mentioned_in_question")),
            None,
        )
        if mentioned and mentioned.get("usual_30d") is not None:
            third = f"{mentioned['category']} usual pace is about {_fmt_gbp(mentioned['usual_30d'])} this period"
        elif bills_line:
            third = bills_line

    if third:
        lines.append(third)

    # Tight-rate / standalone nearest-yes (bills weren't material, so no
    # collision branch above) still outrank nothing further at this point —
    # append whichever applies (mutually exclusive, since verdict is exactly
    # one of no/tight/yes) and only then allow the 4th slot.
    extra = tight_rate_line or nearest_yes_line
    if extra and extra not in lines:
        lines.append(extra)
        return lines[:4]
    return lines[:3]


def _extract_amount(question: str) -> float | None:
    """Largest plausible £ figure mentioned in the question, or None.

    A digit run immediately followed by a letter with no separator (a typo
    like "£2OO", an ordinal like "3rd", a unit like "50p"/"10am") is NOT a
    monetary figure — extracting the leading digits anyway (e.g. "£2OO" ->
    2) produces a confidently wrong verdict, which is worse than asking for
    the amount again. Rejected rather than best-effort parsed.
    """
    candidates = []
    for m in re.finditer(r"£?\s?(\d[\d,]*(?:\.\d{1,2})?)", question):
        end = m.end()
        if end < len(question) and question[end].isalpha():
            continue
        try:
            val = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        if 1 <= val <= 100_000:
            candidates.append(val)
    return max(candidates) if candidates else None


def _months_until_target(month_name: str, today: date) -> int:
    """1..12 — months from today to the NEXT occurrence of the named month."""
    target_idx = MONTH_NAMES.index(month_name) + 1  # 1..12
    delta = target_idx - today.month
    if delta <= 0:
        delta += 12
    return delta


# Words carrying no meaning for a commitment name — question scaffolding only.
_OFFER_STOPWORDS = {
    "can", "i", "afford", "spend", "on", "a", "an", "the", "in", "for", "to",
    "go", "get", "buy", "some", "new",
}


def _offer_name(question: str) -> str:
    """Heuristic commitment name from the question: strip £ amounts, month
    names and stopwords, title-case what remains. Fallback: "Big expense"."""
    text = re.sub(r"£?\s?\d[\d,]*(?:\.\d{1,2})?", " ", question)
    words = re.findall(r"[A-Za-z']+", text)
    kept = [
        w for w in words
        if w.lower() not in _OFFER_STOPWORDS and w.lower() not in MONTH_NAMES
    ]
    if not kept:
        return "Big expense"
    return " ".join(w.capitalize() for w in kept)[:40].strip()


@router.post("/can-i")
async def can_i(body: dict, user: dict = Depends(current_user)):
    question = (body.get("question") or "").strip()
    if not (3 <= len(question) <= 160):
        raise HTTPException(400, "question must be 3-160 characters")
    if not OPENROUTER_API_KEY:
        raise HTTPException(500, "AI not configured")

    # ── History — capped, validated, truncated (chat-with-a-cap) ────────
    raw_history = body.get("history") or []
    history: list[dict] = []
    if isinstance(raw_history, list):
        for entry in raw_history[-6:]:
            if not isinstance(entry, dict):
                continue
            role = entry.get("role")
            content = entry.get("content")
            if role not in ("user", "assistant") or not isinstance(content, str):
                continue
            history.append({"role": role, "content": content[:300]})

    uid = user["email"]
    await check_ai_chat_limit(uid)

    # ── Scenario short-circuit — deterministic routing, no LLM judgement ────
    # looks_like_scenario (app/routers/scenario.py) is a hard rule: an ONGOING
    # or FUTURE-DATED money change (a new standing cost, a cancellation, an
    # income change) routes to the scenario simulator's slot extraction
    # instead of this endpoint's own one-off affordability fact-gathering.
    # Runs BEFORE the out-of-scope gate and before any fact pack/LLM call
    # below, so a scenario-shaped question never falls into Can-I's own
    # verdict call. Shares parse_question with POST /scenario/parse rather
    # than a second copy of extraction (see that function's docstring).
    # check_ai_chat_limit is NOT called again here (already done just above,
    # exactly once for this request); parse_question calls
    # increment_ai_chat_usage itself, at most once, only if extraction
    # actually ran. This never simulates: the user confirms/edits slots via
    # the confirm card before /scenario/run is ever called.
    if looks_like_scenario(question):
        result = await parse_question(uid, question)
        items = result.get("items") or []
        clarify = result.get("clarify")
        if clarify:
            reply = clarify
            headline = "Tell me a bit more"
        elif len(items) == 1:
            subject = items[0].get("label") or "this change"
            reply = f"Got it, {subject}. Check the details below and I'll run the numbers."
            headline = "Here's what I understood"
        else:
            subject = f"these {len(items)} changes"
            reply = f"Got it, {subject}. Check the details below and I'll run the numbers."
            headline = "Here's what I understood"
        return {
            "scenario": True,
            "items": items,
            "rejected": result.get("rejected") or [],
            "prefilled": result.get("prefilled") or False,
            "clarify": clarify,
            "reply": _house_style(reply),
            "headline": _house_style(headline),
            "facts": [],
            "out_of_scope": False,
        }

    # ── Out-of-scope gate — deterministic, no free-form LLM judgement ───────
    # Two cheap projected reads (active goals for the scope check itself and
    # for LLM grounding below, then safe-to-spend for a live worked-example
    # figure) — never the full fact pack (change_intents, cashflow, upcoming
    # bills) below when the question turns out to be out of scope.
    amount_asked = _extract_amount(question)
    active_goals = await _active_goals_summary(uid)
    active_goal_names = [g["name"] for g in active_goals]
    if _is_out_of_scope(question, amount_asked, active_goal_names):
        example_amount = 50
        timeframe = _weekend_or_week()
        try:
            sts_preview = await compute_safe_to_spend(uid)
            if sts_preview.get("status") != "insufficient_data":
                preview_chip = _headroom_chip(float(sts_preview.get("safe_to_spend") or 0.0))
                if preview_chip:
                    m = re.search(r"£(\d+)", preview_chip["label"])
                    if m:
                        example_amount = int(m.group(1))
        except Exception:
            pass
        worked_example = f"Can I spend £{example_amount} {timeframe}?"
        return {
            "reply": f'I can answer spending questions, try "{worked_example}".',
            "headline": "That one's outside what I can work out from your numbers.",
            "facts": [
                "I answer spending and affordability questions from your live balances.",
                "For tax questions, the Tax tab has its own chat.",
                f"Try: {worked_example}",
            ],
            "out_of_scope": True,
        }

    # ── Deterministic fact pack ──────────────────────────────────────────
    sts = await compute_safe_to_spend(uid)
    if sts.get("status") == "insufficient_data":
        msg = "I don't have enough account data yet, connect an account and try again."
        return {"reply": msg, "headline": msg, "facts": [], "out_of_scope": False}

    facts: dict = {
        "safe_to_spend":     sts.get("safe_to_spend"),
        "days_until_payday": sts.get("days_until_payday"),
        "next_payday":       sts.get("next_payday"),
        "state":             sts.get("state"),
        "bills_total":       sts.get("bills_total"),
        "card_debt":         sts.get("card_debt"),
    }
    days_until_payday = sts.get("days_until_payday") or 1
    safe_to_spend = sts.get("safe_to_spend") or 0.0
    facts["per_day"] = round(safe_to_spend / max(1, days_until_payday), 2)
    # Named goals the user might ask about by name ("can I add to Japan?")
    # without ever saying "spend" or a price — fetched above for the scope
    # gate, reused here so the LLM has something to ground the answer in
    # instead of falling back to its own out-of-scope refusal.
    if active_goals:
        facts["active_goals"] = active_goals

    monthly_surplus = 0.0
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        monthly_income, monthly_spending, monthly_surplus = await _cashflow(uid, region, cutoff)
        facts["monthly_income"] = round(monthly_income, 2)
        facts["monthly_spending"] = round(monthly_spending, 2)
        facts["monthly_surplus"] = round(monthly_surplus, 2)
    except Exception:
        pass

    try:
        goal = await savings_goals_col.find_one({"_id": uid})
        facts["savings_buffer"] = round(await _current_savings(uid, goal), 2)
    except Exception:
        pass

    try:
        cached = await cashflow_cache_col.find_one({"_id": uid})
        if cached:
            resp = await _build_cashflow_response(cached, uid=uid)
            upcoming = [
                b for b in resp.get("upcoming_bills", [])
                if 0 <= b.get("days_away", 999) <= days_until_payday
            ]
            upcoming.sort(key=lambda b: -b.get("amount", 0))
            facts["upcoming_bills"] = [
                {"name": b.get("name"), "amount": round(b.get("amount", 0)), "in_days": b.get("days_away")}
                for b in upcoming[:3]
            ]
    except Exception:
        pass

    # ── Change intents (Mirror traits marked "change" → category pace) ──
    try:
        from app.db.collections import behaviour_portrait_col
        from app.services.checkpoints import (
            _pay_cfg,
            checkpoint_map_for_period,
            current_period,
        )
        from app.services.pace import (
            _BASELINE_DAYS,
            _read_cached_baseline,
            _total_baseline,
            _write_cached_baseline,
            load_spend_txns,
            shaped_fraction,
        )

        portrait = await behaviour_portrait_col.find_one({"_id": uid}) or {}
        change_cats: list[str] = []
        for trait in portrait.get("traits") or []:
            if not isinstance(trait, dict) or trait.get("choice") != "change":
                continue
            cat = trait.get("ref_category")
            if not cat:
                # Defensive fallback until ref_category ships: parse the title.
                title = trait.get("title") or ""
                if title.startswith("Your Signature: "):
                    cat = title[len("Your Signature: "):].strip()
            if cat and cat not in change_cats:
                change_cats.append(cat)

        if change_cats:
            # Same helper companion.py/pace.py resolve their pay period through
            # (preferences keyed by user_id) — a stray `_id`-keyed prefs doc
            # here previously caused this surface's period window (and
            # therefore spent_this_period) to silently diverge from the
            # companion's intent_pace figure for the same category/period.
            pay_cfg = await _pay_cfg(uid)
            period_start, period_end = await current_period(uid)
            period_days = (period_end - period_start).days + 1

            # Baseline: same cache key + fallback path pace/companion use.
            baseline_key = period_start.isoformat()
            cached_baseline = await _read_cached_baseline(uid, baseline_key)
            if cached_baseline is not None:
                baseline, baseline_months = cached_baseline
                spend_txns = await load_spend_txns(uid, period_start, period_end)
            else:
                spend_txns = await load_spend_txns(
                    uid, period_start - timedelta(days=_BASELINE_DAYS), period_end
                )
                baseline, baseline_months = _total_baseline(spend_txns, period_start)
                await _write_cached_baseline(uid, baseline_key, baseline, baseline_months)

            # Per-category spend this period (effective category = custom or raw,
            # debits only — load_spend_txns already normalises both).
            cat_spent: dict[str, float] = {}
            for t in spend_txns:
                if period_start <= t["date"] <= period_end:
                    cat_spent[t["category"]] = cat_spent.get(t["category"], 0.0) + t["amount"]

            thin_history = baseline_months < 2

            aim_map = await checkpoint_map_for_period(
                uid, period_start, period_end, cat_spent=cat_spent
            )

            question_lower = question.lower()
            change_intents: list[dict] = []
            for cat in change_cats:
                usual_30d = None if thin_history else baseline.get(cat)
                aim_doc = aim_map.get(cat)
                synonyms = CATEGORY_SYNONYMS.get(cat, [])
                mentioned_in_question = cat.lower() in question_lower or any(
                    syn in question_lower for syn in synonyms
                )
                pro_rata_usual = None
                if usual_30d:
                    # Shaped fraction (pace.py's shared S(f_now)) instead of
                    # the linear usual_30d/30*days_elapsed — so this never
                    # contradicts the shaped Spend page for the same
                    # category/period.
                    shaped_frac = await shaped_fraction(
                        uid, period_start, pay_cfg, category=cat
                    )
                    pro_rata_usual = round(
                        float(usual_30d) / 30 * period_days * shaped_frac, 2
                    )
                change_intents.append({
                    "category": cat,
                    "usual_30d": round(float(usual_30d), 2) if usual_30d else None,
                    "spent_this_period": round(cat_spent.get(cat, 0.0), 2),
                    "pro_rata_usual": pro_rata_usual,
                    "active_aim": (
                        round(float(aim_doc["aim_amount"]), 2)
                        if aim_doc and aim_doc.get("aim_amount") is not None
                        else None
                    ),
                    "mentioned_in_question": mentioned_in_question,
                })
            if change_intents:
                facts["change_intents"] = change_intents
    except Exception:
        pass

    # ── Deterministic what-ifs (LLM never does arithmetic) ──────────────
    # amount_asked was already extracted for the out-of-scope gate above.
    what_ifs: dict = {}
    if amount_asked is not None:
        free_after_spend = round(safe_to_spend - amount_asked)
        what_ifs["amount_asked"] = amount_asked
        what_ifs["free_after_spend"] = free_after_spend
        what_ifs["per_day_after"] = round(free_after_spend / max(1, days_until_payday), 2)
        what_ifs["goes_negative"] = free_after_spend < 0
        what_ifs["months_of_saving_needed"] = (
            round(amount_asked / monthly_surplus, 1) if monthly_surplus > 0 else None
        )
        # Precompute per-category "where would this take me" so the LLM never
        # has to add two figures itself.
        for ci in facts.get("change_intents", []):
            ci["would_take_to"] = round(ci["spent_this_period"] + amount_asked, 2)

    today = date.today()
    q_lower = question.lower()
    # Earliest-in-the-QUESTION match, not Jan->Dec iteration order — "save
    # for the December trip before November" must resolve November (the
    # month actually named first), not December just because it sorts
    # earlier in MONTH_NAMES.
    month_hits = [(q_lower.index(m), m) for m in MONTH_NAMES if m in q_lower]
    if month_hits:
        _, month_name = min(month_hits)
        months_until = _months_until_target(month_name, today)
        what_ifs["months_until_target"] = months_until
        what_ifs["savable_by_target"] = (
            round(monthly_surplus * months_until) if monthly_surplus > 0 else 0
        )

    facts["what_ifs"] = what_ifs

    # Derived BEFORE the LLM call (not just after, as a post-parse override)
    # so the prompt itself can tell the model the decision instead of asking
    # it to guess and then silently overwriting the headline it guessed —
    # the model's own REPLY sentence is never told the verdict otherwise,
    # and (being free-form, not overridden) it can flatly contradict a
    # headline it never saw. Injected into `facts` (LLM grounding only —
    # this dict is never the response payload, see `resp_body` below) as
    # `resolved_verdict` so it rides along in the same FACTS JSON block
    # every other precomputed figure already does.
    derived_verdict = _derive_verdict(what_ifs, safe_to_spend)
    if derived_verdict is not None:
        facts["resolved_verdict"] = _VERDICT_HEADLINES[derived_verdict]

    # ── Commitment hand-off offer (deterministic, never LLM-authored) ────
    # When the question carries both an amount and a target month, offer to
    # set the expense up as a commitment; the reply text already carries the
    # affordability verdict. The frontend renders this as a chip under
    # Penny's bubble.
    offer: dict | None = None
    try:
        if (
            what_ifs.get("amount_asked")
            and what_ifs.get("months_until_target")
        ):
            _months = int(what_ifs["months_until_target"])
            _amt = float(what_ifs["amount_asked"])
            _t_month0 = today.month - 1 + _months  # 0-indexed month arithmetic
            _t_year = today.year + _t_month0 // 12
            _t_month = _t_month0 % 12 + 1
            offer = {
                "name": _offer_name(question),
                "amount": _amt,
                "target_date": date(_t_year, _t_month, 1).isoformat(),
                "per_period": int(math.ceil(_amt / max(1, _months) / 5) * 5),
            }
    except Exception:
        offer = None

    # ── System prompt ─────────────────────────────────────────────────
    import json
    system_prompt = (
        "You are Penny, the AI inside a personal money app. The user asks quick-fire "
        "spending questions. Reply in AT MOST 2 short sentences: verdict first (Yes / "
        "yes but tight / not this one / or the number they asked for), then the "
        "single most important implication. Direct, never curt. No greetings, no "
        "caveats, no moralising, never 'you should'. Write to a person: every line is "
        "a phrase someone would actually say out loud, never a status or a fault "
        "report. British English. Every £ figure you write MUST be copied from "
        "the facts JSON below, rounded to whole pounds, NEVER compute, derive or "
        "invent a figure; the what_ifs are precomputed for you. safe_to_spend is "
        "ALREADY net of bills_total. The bills have been subtracted once, in the "
        "backend, before you ever see this figure; never subtract bills_total "
        "again from safe_to_spend or from free_after_spend. what_ifs.goes_negative "
        "is the precomputed, final answer to 'does this spend break the budget'; "
        "trust it over any mental arithmetic of your own. "
        "If FACTS.resolved_verdict is present, that verdict has ALREADY been "
        "decided by the backend and will be shown to the user as the headline "
        "verbatim, exactly as written, no matter what you write. Copy it EXACTLY "
        "as your HEADLINE line; do not choose a different verdict word, do not "
        "soften it, do not contradict it. Your REPLY must not restate, echo or "
        "re-derive the verdict either (do not open with your own 'Yes'/'No'/ "
        "'Tight'); write ONLY the single most important implication, as a "
        "sentence that assumes resolved_verdict is already true (for 'Yes, but "
        "it'll be tight', explain what makes it tight; for 'Not this one', "
        "explain what's in the way, never a second attempt at yes or no). If "
        "FACTS.resolved_verdict is ABSENT, decide the verdict yourself as "
        "instructed above. If they name a thing "
        "but no price and you'd need one, give the envelope from the facts (free "
        "until payday, or per-day rate) and ask for a number in the same sentence. "
        "active_goals (when present) lists the user's OWN active savings/commitment "
        "goals by name, with their target amount and target_date; a question naming "
        "one of these (e.g. 'can I add to Japan?', 'more for the japan pot?') IS a "
        "real affordability question about the user's own money, even with no "
        "spend/save verb and no price: treat it exactly like 'name a thing, no price' "
        "above (give the envelope, ask how much), NEVER as out of scope. "
        "For future-month questions use months_until_target and savable_by_target. "
        "Entries in change_intents with mentioned_in_question=true MUST be "
        "acknowledged in the answer, using ONLY the provided figures; when such "
        "an entry has would_take_to, that is the precomputed category total after "
        "this spend; copy it as-is (e.g. this £30 would take Eating Out to your "
        "would_take_to figure of your usual_30d usual pace, still inside the "
        "change you asked for). Entries without mentioned_in_question=true may be "
        "ignored unless clearly relevant. Never moralise. "
        "General cost knowledge may be used ONLY as a clearly rough range "
        "(say 'roughly'), never as their figure. Follow-up questions may reference "
        "earlier turns, use the conversation for context but ALWAYS ground figures "
        "in the current facts JSON. Write in plain, human punctuation: no em-dashes "
        "(—) or en-dashes (–); use a comma, a full stop, or a plain conjunction "
        "instead. A plain hyphen is fine only inside a compound word or a range.\n\n"
        "OUTPUT FORMAT: respond with EXACTLY two lines, nothing before or after:\n"
        "HEADLINE: <the verdict, under 8 words, phrased the way a person would "
        "actually say it out loud, not a status report. Good: 'Yes' / 'Yes, but "
        "it'll be tight' / 'Not this one' / 'How much are you thinking?' (only "
        "when no price was named). Bad: 'No price given, need a number.' / "
        "'Amount required' / any phrase with no subject.>\n"
        "REPLY: <your normal answer as instructed above, AT MOST 2 short sentences>\n"
        "If, despite everything above, this question truly is not about the user's "
        "own spending or affordability, respond with exactly:\n"
        "HEADLINE: That one's outside what I can work out from your numbers.\n"
        'REPLY: I can answer spending questions, try "Can I spend £50 this weekend?".\n\n'
        f"FACTS: {json.dumps(facts, default=str)}"
    )

    messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": question}]

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}", "HTTP-Referer": APP_URL},
            json={
                "model": "anthropic/claude-haiku-4-5",
                "max_tokens": 160,
                "temperature": 0,
                "messages": messages,
                "provider": OPENROUTER_PROVIDER_PREFS,
            },
        )
    if r.status_code != 200:
        raise HTTPException(500, "AI unavailable")

    try:
        raw_content = r.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError, TypeError):
        raise HTTPException(500, "AI unavailable")

    await increment_ai_chat_usage(uid)
    headline, reply_text = _parse_headline_reply(raw_content)
    # Belt-and-braces on top of the prompt injection above: `derived_verdict`
    # was already computed before the LLM call and told to the model as
    # resolved_verdict, but a temperature-0 model can still slip and echo
    # its own guess. Re-applied here (same value, not recomputed) as the
    # guarantee the card can never show a headline the arithmetic disagrees
    # with; when no amount was extracted (the "name a thing, no price" path,
    # or a multi-month savings question — see _derive_verdict's docstring)
    # derived_verdict is None and the model's own headline is left as-is.
    if derived_verdict is not None:
        headline = _VERDICT_HEADLINES[derived_verdict]
        reply_text = _strip_leading_verdict_clause(reply_text)
    resp_body: dict = {
        "reply": _house_style(reply_text),
        "headline": _house_style(headline),
        "facts": _compose_facts(facts, offer),
        "out_of_scope": False,
    }
    if offer:
        resp_body["offer"] = offer
    return resp_body


# ── GET /can-i/suggestions — personalised chip seeding ───────────────────────
# Every chip below is engine-owned and deterministic: no LLM call, no new
# heavy queries — Chip A reuses the cached safe-to-spend path Can-I already
# calls, Chip B reuses pace.load_spend_txns (the same helper the
# change_intents block above uses), Chip C reuses commitments.py's own
# pot-ledger/slice maths so a chip can never quote a number Planning would
# disagree with. Every chip's phrasing is answerable by the /can-i machinery
# above (an amount that _extract_amount can find, or a "name a thing, no
# price" question the envelope-and-ask path already handles).

_CHIP_B_LOOKBACK_DAYS = 90
_CHIP_B_MIN_COUNT = 3        # occurrences needed to call a category "recurring"
_CHIP_B_MAX_MAD_RATIO = 0.5  # median absolute deviation / median — the
                             # "stable typical amount" bar; Golf (~0.37 on
                             # real data) passes, Eating Out's long tail
                             # (~0.52) does not.
_CHIP_B_EXCLUDE = {"Subscriptions"}  # fixed recurring cost, not a spend
                                     # DECISION — "can I afford another
                                     # subscription" doesn't fit the
                                     # weekend-spend framing.
SESSION_STYLE_CATEGORIES = {
    "golf", "padel", "tennis", "squash", "gym", "yoga", "pilates",
    "swimming", "football", "climbing", "boxing", "spin", "crossfit",
}

_FALLBACK_CHIPS = [
    "How much can I spend on a gift?",
    "Can I afford a takeaway this week?",
    "How much could I put toward savings this month?",
]

# Below this, free is too tight (or negative) to suggest ANY new spend or
# top-up — a "£117 on health?" chip at −£144 free is temptation, not
# reassurance. Shared by every spend-shaped chip candidate (headroom,
# discretionary-vocabulary, commitment top-up, cold-start padding) so the
# gate can never drift between them.
_CHIP_SPEND_FLOOR = 20

# Below _CHIP_SPEND_FLOOR: no spend chip is offered at all. Both of these
# are answerable by the existing /can-i machinery with no amount needed
# (they're plain "payday" facts questions — safe_to_spend/per_day/bills_total
# are always in the fact pack) and both pass _is_out_of_scope on the
# "payday" keyword, so neither can produce a refusal.
_REASSURANCE_CHIPS = [
    "How am I doing until payday?",
    "What's still due before payday?",
]


def _weekend_or_week() -> str:
    """"this week" early in the pay-week (Mon-Wed), "this weekend" once it's
    close enough to be the natural next spend occasion (Thu-Sun)."""
    return "this week" if date.today().weekday() < 3 else "this weekend"


def _headroom_chip(free: float) -> dict | None:
    """Chip A — a round 15-25% (fixed at 20%) of current free, £5-rounded.
    Only offered when free > £20 (seeding rule)."""
    if free <= _CHIP_SPEND_FLOOR:
        return None
    amount = max(5, _round5(free * 0.20))
    return {"label": f"Can I spend £{amount} {_weekend_or_week()}?"}


def _scaled_fallback_chip(free: float) -> dict | None:
    """Cold-start padding chip — same shape as Chip A. Gated behind the same
    _CHIP_SPEND_FLOOR as every other spend-shaped chip: a tight or negative
    `free` gets a reassurance chip instead of a floored-at-£10 spend
    suggestion (see BLOCKER 2 — a spend chip at negative headroom is
    temptation, not reassurance)."""
    if free <= _CHIP_SPEND_FLOOR:
        return None
    amount = max(10, _round5(free * 0.20))
    return {"label": f"Can I spend £{amount} {_weekend_or_week()}?"}


async def _discretionary_chip_candidate(uid: str, kind_map) -> tuple[str, float] | None:
    """Chip B's "their vocabulary" source: the top discretionary category by
    recent recurrence whose amounts are stable enough to call "typical".
    Ranks by (count desc, stability asc) so the most frequent stable category
    wins outright, and the tightest-spread category wins any count tie."""
    from app.services.pace import load_spend_txns

    end = date.today()
    start = end - timedelta(days=_CHIP_B_LOOKBACK_DAYS)
    txns = await load_spend_txns(uid, start, end, kind_map=kind_map)

    by_cat: dict[str, list[float]] = {}
    for t in txns:
        if t["amount"] <= 0:
            continue  # refunds/credits net negative — not a spend occurrence
        cat = t["category"]
        if cat in _CHIP_B_EXCLUDE or not is_discretionary(kind_map, cat):
            continue
        by_cat.setdefault(cat, []).append(t["amount"])

    best: tuple[str, float] | None = None
    best_key: tuple[int, float] | None = None
    for cat, amounts in by_cat.items():
        if len(amounts) < _CHIP_B_MIN_COUNT:
            continue
        med = statistics.median(amounts)
        if med <= 0:
            continue
        mad = statistics.median([abs(a - med) for a in amounts])
        ratio = mad / med
        if ratio > _CHIP_B_MAX_MAD_RATIO:
            continue
        key = (-len(amounts), ratio)
        if best_key is None or key < best_key:
            best_key, best = key, (cat, round(med))
    return best


def _chip_b_label(category: str, typical_amount: float) -> str:
    cat_lower = category.strip().lower()
    if cat_lower in SESSION_STYLE_CATEGORIES:
        return f"Can I book another {cat_lower} session?"
    return f"Can I spend £{typical_amount:,.0f} on {cat_lower}?"


async def _commitment_chip_candidate(uid: str) -> tuple[str, float] | None:
    """Chip C's "their plan" source: the oldest active commitment's name and
    a round ~20-30% (fixed at 25%) top-up on its per_period_slice, floored at
    £10. Reuses commitments.py's own pot-ledger + slice maths (a single-doc
    ledger is exact for that one doc) so this can never disagree with what
    Planning shows for the same plan."""
    from app.routers.commitments import (
        _pay_cfg as _commitments_pay_cfg,
        _pot_progress_and_slice,
        compute_pot_ledger,
    )

    doc = await commitments_col.find_one(
        {"user_id": uid, "status": "active"}, sort=[("created_at", 1)]
    )
    if not doc:
        return None
    cfg = await _commitments_pay_cfg(uid)
    ledger = await compute_pot_ledger(uid, docs=[doc])
    info = await _pot_progress_and_slice(doc, cfg, ledger, date.today())
    slice_amount = float(info.get("per_period_slice") or 0)
    if slice_amount <= 0:
        return None
    top_up = max(10, _round5(slice_amount * 0.25))
    name = str(doc.get("name") or "").strip() or "your plan"
    return name, top_up


@router.get("/can-i/suggestions")
async def can_i_suggestions(user: dict = Depends(current_user)):
    uid = user["email"]
    sts = await compute_safe_to_spend(uid)
    if sts.get("status") == "insufficient_data":
        return {
            "chips": [
                {"label": "Can I spend £50 this weekend?"},
                {"label": "How much can I spend on a gift?"},
            ],
            "context_line": "Connect an account to see your numbers",
        }

    free = float(sts.get("safe_to_spend") or 0.0)
    days_left = int(sts.get("days_until_payday") or 0)
    context_line = f"{_fmt_gbp(free)} free · {days_left} day{'s' if days_left != 1 else ''} left"

    chips: list[dict] = []

    if free > _CHIP_SPEND_FLOOR:
        # ── Comfortable headroom — the normal spend-shaped chip set ─────────
        headroom = _headroom_chip(free)
        if headroom:
            chips.append(headroom)

        try:
            kind_map = await get_category_kinds(uid)
            candidate = await _discretionary_chip_candidate(uid, kind_map)
            if candidate:
                cat, typical = candidate
                chips.append({"label": _chip_b_label(cat, typical)})
        except Exception:
            pass

        try:
            commitment = await _commitment_chip_candidate(uid)
            if commitment:
                name, top_up = commitment
                chips.append({"label": f"Can I put £{top_up:,.0f} extra toward {name}?"})
        except Exception:
            pass

        # ── Cold start — pad with neutral, assumption-free fallbacks ────────
        if len(chips) < 2:
            seen = {c["label"] for c in chips}
            fallback_chip = _scaled_fallback_chip(free)
            pool = ([fallback_chip["label"]] if fallback_chip else []) + _FALLBACK_CHIPS
            for label in pool:
                if len(chips) >= 2:
                    break
                if label in seen:
                    continue
                chips.append({"label": label})
                seen.add(label)
    else:
        # ── Tight or negative headroom — reassurance, never temptation ──────
        # BLOCKER 2: no headroom/discretionary/commitment-top-up chip below
        # the floor — those all suggest NEW spend or an extra commitment
        # contribution, which is exactly wrong when the user is already
        # short. Both reassurance chips are answerable from the always-present
        # safe_to_spend/per_day/bills_total facts, no amount required.
        for label in _REASSURANCE_CHIPS:
            chips.append({"label": label})

    return {"chips": chips[:3], "context_line": context_line}
