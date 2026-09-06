"""Engine-owned chip registry — POST /penny/chip (app.routers.penny_chip).

Every per-screen "chip" a user can tap (the ones seeded on Home/Spend/
Planning/Tax, plus the personalised "Can I spend £40 this weekend?" chips
GET /can-i/suggestions already composes) answers here from the SAME
deterministic engines/read tools the screen itself and the Penny tool loop
(app.services.penny_tools) already use — never a fresh model call, never
counted against the Penny message cap (app.core.subscription.penny_allowance),
never written to llm_usage_col. A chip can therefore never disagree with the
screen it sits on: it is the screen's own numbers, phrased as one to four
short sentences, not a second opinion.

Three `kind`s on the returned dict:
- "engine": composed here in Python from one or more read tools/engine
  functions, a genuine answer, no model involved.
- "explain": the `explain(topic)` registry's own text, verbatim (see
  app.services.penny_tools's `_ALL_EXPLAIN_COPY`), also no model call.
- "llm": this chip has no registry entry and no engine figure to answer
  from honestly (see the tax chips below) — the caller gets `{"kind":
  "llm"}` with a 200, and the FRONTEND is the one that falls back to the
  ordinary /can-i model path for it, spending a real message. This module
  itself never invents copy to avoid that fallback.

Every "engine"/"explain" answer is run through `house_style` (the same
em-dash/en-dash and "N pounds" backstop the LLM-authored surfaces use) as a
belt-and-braces pass — the copy below is already written without dashes,
this just guards against a future edit slipping one in.
"""
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Awaitable, Callable

from app.services.affordability import check_affordability
from app.services.categorisation import canonical_merchant_key
from app.services.copy_style import house_style
from app.services.penny_tools import execute_tool

logger = logging.getLogger(__name__)

# ── Bill display names — never a raw bank/card descriptor ───────────────────
# home_payday_due used to print `b["name"]` verbatim (the recurring-series
# key, see app.services.categorisation.series_key), which for a real
# merchant is usually already clean ("Netflix", "EE Limited") but for a
# "movement" occurrence (a card repayment, a self-transfer) is the bank's
# own settlement narrative — "AMERICAN EXPRESS 3766-824849-32000", "KEVIN
# MAINGI CREDIT VIA MOBILE - PY" — an account-number-like fragment (or the
# user's own name) with nothing a customer would recognise as a bill name.
#
# `canonical_merchant_key` (app.services.categorisation) is the SAME
# merchant-identity transform the sync/categorisation pipeline already runs
# on every transaction (ENGINE.md "Identity" stage) — it strips processor
# prefixes, reference numbers, channel codes and country annotations, so
# reusing it here can never invent a name the engine doesn't already agree
# with. It returns a lowercase matching KEY, so this module Title-cases it
# for display only.
#
# A "movement" occurrence (card repayment, transfer to/from the user's own
# accounts) is never described by its settlement narrative even once
# cleaned — that text can still carry the user's own name or bank plumbing
# with no merchant identity to recover (the "KEVIN MAINGI CREDIT VIA MOBILE"
# case above cleans to "kevin maingi credit via mobile", not an improvement).
# It gets a fixed, honest, kind-based phrase instead.
_KIND_FALLBACK_LABEL = {
    "movement": "a card or account payment",
    "commitment": "a bill",
    "discretionary": "a payment",
}
_LONG_DIGIT_RUN_RE = re.compile(r"\d{6,}")
_REF_TOKEN_RE = re.compile(r"[*#]")


def _clean_bill_display_name(raw_name: str | None, kind: str | None) -> str:
    """A customer-readable name for one upcoming-bill occurrence — never the
    raw settlement narrative. See the module-level comment above this
    function for the doctrine."""
    if kind == "movement":
        return _KIND_FALLBACK_LABEL["movement"]
    key = canonical_merchant_key((raw_name or "").strip())
    display = key.title() if key else ""
    if not display or _LONG_DIGIT_RUN_RE.search(display) or _REF_TOKEN_RE.search(display):
        display = _KIND_FALLBACK_LABEL.get(kind, "a payment")
    return display


# ── £/date formatting — twin of app.routers.can_i._fmt_gbp /
# app.services.penny_tools._fmt_gbp / app.services.affordability._fmt_gbp
# (see penny_tools.py's own "IMPORT RULE" docstring for why every module in
# this family copies this tiny helper rather than importing it across a
# router/service boundary): same Unicode minus (−), never a hyphen. ────────
def _fmt_gbp(amount, decimals: int = 0) -> str:
    amount = float(amount or 0.0)
    return f"−£{abs(amount):,.{decimals}f}" if amount < 0 else f"£{amount:,.{decimals}f}"


def _fmt_date_short(value) -> str:
    """"Fri 12 Sep" from an ISO date/datetime string, or "" for anything
    unparseable — never lets a malformed stored date blow up a chip
    answer."""
    if not value:
        return ""
    try:
        d = date.fromisoformat(str(value)[:10])
    except ValueError:
        return ""
    return d.strftime("%a %-d %b")


def _period_range_text(period: dict | None) -> str:
    """"12 Sep to 20 Sep" from a period dict's start/end ISO dates, or ""
    when either bound is missing/unparseable."""
    period = period or {}
    start, end = period.get("start"), period.get("end")
    if not start or not end:
        return ""
    try:
        s = date.fromisoformat(str(start)[:10]).strftime("%-d %b")
        e = date.fromisoformat(str(end)[:10]).strftime("%-d %b")
    except ValueError:
        return ""
    return f"{s} to {e}"


def _plural(n, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


# ── explain-registry topic map — the three explain-backed chips ─────────────
# Each of these three chip ids has an EXACT match (verbatim, per the brief)
# in penny_tools.py's `_ALL_EXPLAIN_COPY` registry: `categorisation` (the
# "how does the engine file my transactions" topic explainer) for "how do
# categories work", `saving_vs_investing` (same name, same copy) for the
# planning save-vs-invest chip, and `lisa` (the Money Basics Lifetime ISA
# card) for the planning Lifetime ISA chip. No new registry entries were
# needed or added — see this module's own docstring for the "never invent"
# doctrine that governs when a new key WOULD be warranted.
_EXPLAIN_CHIP_TOPICS = {
    "spend_how_categories_work":   "categorisation",
    "planning_saving_vs_investing": "saving_vs_investing",
    "planning_lifetime_isa":        "lisa",
}


ChipHandler = Callable[[str, dict | None], Awaitable[dict]]


@dataclass(frozen=True)
class ChipSpec:
    handler: ChipHandler


def _engine_result(chip_id: str, answer: str, facts: dict | None = None) -> dict:
    return {"chip_id": chip_id, "kind": "engine", "answer": house_style(answer.strip()), "facts": facts or {}}


def _llm_fallback(chip_id: str) -> dict:
    return {"chip_id": chip_id, "kind": "llm"}


# ── home_payday_status — "How am I doing until payday?" ─────────────────────
def _home_sts_state(sts: dict) -> tuple[str, bool]:
    """Twin of frontend/components/SafeToSpendCard.tsx's own state/label
    derivation (its `state`/`isCardsShort`/`stateLabel` constants) — this
    chip's status word must never disagree with the Home hero it sits
    under, so it is computed here the SAME way, from the SAME cached
    result, rather than re-deriving a fresh judgement from `sts["state"]`
    alone. A backend "short" reading within a penny of zero
    (`free_amount > -1`) reads as "comfortable" on the card too — the same
    rounding tolerance is applied here."""
    raw_state = sts.get("state") or ""
    short_reason = sts.get("short_reason")
    free_amount = float(sts.get("safe_to_spend") or 0.0)
    is_cards_short = raw_state == "short" and short_reason == "cards"
    state = "comfortable" if (raw_state == "short" and not is_cards_short and free_amount > -1) else raw_state
    return state, is_cards_short


async def _chip_home_payday_status(uid: str, params: dict | None) -> dict:
    from app.routers.analytics import get_cached_safe_to_spend

    sts = await get_cached_safe_to_spend(uid)
    if sts.get("status") != "ok":
        return _engine_result(
            "home_payday_status",
            "I don't have enough account data connected yet to work out where you stand until payday.",
            sts,
        )

    free_amount = float(sts.get("safe_to_spend") or 0.0)
    state, is_cards_short = _home_sts_state(sts)
    days = sts.get("days_until_payday")
    payday_label = _fmt_date_short(sts.get("next_payday"))
    days_text = _plural(days, "day") if isinstance(days, int) else "some days"
    when = f", with {days_text} to payday" + (f" on {payday_label}" if payday_label else "") if days is not None else ""

    # Wording matches the Home Safe-to-Spend card's own framing exactly
    # (SafeToSpendCard.tsx): a genuine shortfall is never phrased as a
    # negative "safe to spend" figure, it is "short of covering this pay
    # period" against the positive gap amount — the card itself relabels
    # this figure "Final safety position", never "Safe to spend", for the
    # same reason.
    if state == "comfortable":
        sentence1 = f"You're on track: about {_fmt_gbp(free_amount)} safe to spend{when}."
    elif state == "tight":
        sentence1 = f"You're tight: about {_fmt_gbp(free_amount)} safe to spend{when}."
    elif is_cards_short:
        # Bills ARE covered here (see app.services.affordability's own
        # `_nothing_spare_line`, the same cards-vs-bills distinction) — the
        # card shows £0 free rather than a negative figure for this case,
        # never "short of covering this pay period" (that phrase is
        # reserved for a genuine bills shortfall, below).
        sentence1 = f"Bills are covered, but cards have used up what's spare{when}."
    else:
        gap = abs(free_amount)
        sentence1 = f"You're about {_fmt_gbp(gap)} short of covering this pay period{when}."

    lowest = sts.get("lowest_projected_balance")
    sentence2 = ""
    if sts.get("calculation_status") == "degraded":
        sentence2 = "Part of this figure couldn't be worked out just now, so treat it as a cautious estimate."
    elif lowest is not None:
        sentence2 = f"Your balance is projected to dip to about {_fmt_gbp(lowest)} before then."

    return _engine_result("home_payday_status", f"{sentence1} {sentence2}", sts)


# ── home_payday_due — "What's still due before payday?" ─────────────────────
async def _chip_home_payday_due(uid: str, params: dict | None) -> dict:
    from app.routers.analytics import get_cached_safe_to_spend

    sts = await get_cached_safe_to_spend(uid)
    if sts.get("status") != "ok":
        return _engine_result(
            "home_payday_due",
            "I don't have enough account data connected yet to see what's due before payday.",
            sts,
        )

    days_until_payday = sts.get("days_until_payday") or 0
    bills_result = await execute_tool(uid, "get_upcoming_bills", {})
    bills = bills_result.get("upcoming_bills") or []
    due = sorted(
        (b for b in bills if isinstance(b.get("days_away"), int) and b["days_away"] < days_until_payday),
        key=lambda b: b["days_away"],
    )

    if not due:
        return _engine_result(
            "home_payday_due", "Nothing else is expected to land before payday.", {"bills": []},
        )

    count = len(due)
    total = sum((b.get("amount") or {}).get("raw") or 0.0 for b in due)
    named = []
    for b in due[:3]:
        name = _clean_bill_display_name(b.get("name"), b.get("kind"))
        amt = (b.get("amount") or {}).get("formatted") or ""
        days_away = b.get("days_away")
        day_text = f"in {_plural(days_away, 'day')}" if isinstance(days_away, int) else "soon"
        named.append(f"{name} ({amt}, expected {day_text})")

    sentence1 = f"{_plural(count, 'more expected payment')} before payday, about {_fmt_gbp(total)} in total."
    sentence2 = f"Next up: {', '.join(named)}." if named else ""

    return _engine_result(
        "home_payday_due", f"{sentence1} {sentence2}", {"bills": due, "count": count, "total": total},
    )


# ── spend_where_money_went — "Where did my money go this month?" ────────────
async def _chip_spend_where_money_went(uid: str, params: dict | None) -> dict:
    from app.services.spend_verdict import compute_spend_verdict

    verdict = await compute_spend_verdict(uid, offset=0)
    period = verdict.get("period") or {}
    total_out = float((verdict.get("pills") or {}).get("spent") or 0.0)

    if total_out <= 0:
        return _engine_result(
            "spend_where_money_went", "No spending recorded for this pay period yet.", verdict,
        )

    rows = (verdict.get("notables") or []) + (verdict.get("majority") or [])
    top = sorted(rows, key=lambda r: -(r.get("spent") or 0))[:3]
    parts = []
    for r in top:
        spent = float(r.get("spent") or 0.0)
        share = round((spent / total_out) * 100) if total_out else 0
        parts.append(f"{r.get('category')} at {_fmt_gbp(spent)} ({share}%)")

    date_range = _period_range_text(period)
    sentence1 = f"You've spent {_fmt_gbp(total_out)} this pay period" + (f" ({date_range})" if date_range else "") + "."
    sentence2 = f"The biggest are {', '.join(parts)}." if parts else ""

    return _engine_result(
        "spend_where_money_went", f"{sentence1} {sentence2}",
        {"total_out": total_out, "top_categories": top, "period": period},
    )


# ── spend_more_than_usual — "Am I spending more than usual?" ────────────────
async def _chip_spend_more_than_usual(uid: str, params: dict | None) -> dict:
    from app.services.spend_verdict import compute_spend_verdict

    verdict = await compute_spend_verdict(uid, offset=0)
    period = verdict.get("period") or {}
    reading = verdict.get("reading") or (
        "I don't have enough spending history yet to compare this against your usual pace."
    )
    date_range = _period_range_text(period)
    sentence2 = f"This covers {date_range}." if date_range else ""

    return _engine_result(
        "spend_more_than_usual", f"{reading} {sentence2}", {"reading": reading, "period": period},
    )


# ── grow_saving_enough — "Am I saving enough?" ───────────────────────────────
def _period_short_subline(surplus_monthly: float) -> str:
    """Twin of frontend/app/planning/GrowPanel.tsx's own `periodShortSubline`
    — same three branches, same wording, so this chip's context sentence
    can never disagree with what the Planning hero shows for the identical
    `surplus_monthly` figure. "about" replaces the UI's "~" prefix (house
    style keeps the tilde out of spoken-style prose)."""
    if surplus_monthly > 0:
        return f"In a typical month you run about {_fmt_gbp(surplus_monthly)} ahead. This is timing, not trend."
    if surplus_monthly < 0:
        return f"Your typical month also runs about {_fmt_gbp(abs(surplus_monthly))} behind, this isn't only timing."
    return "Your typical month has been about even, this is timing, not trend."


async def _chip_grow_saving_enough(uid: str, params: dict | None) -> dict:
    from app.routers.grow import grow_view

    try:
        grow_result = await grow_view(user={"email": uid})
    except Exception:
        logger.exception("penny_chips: grow_saving_enough failed for %s", uid)
        return _engine_result(
            "grow_saving_enough", "I can't work out your saving position from your numbers right now.",
        )

    verdict = grow_result.get("verdict") or {}
    period_gate = grow_result.get("period_gate") or {}
    surplus_monthly = float(grow_result.get("surplus_monthly") or 0.0)

    # This chip sits on Planning, so it quotes PLANNING's own hero
    # (GrowPanel.tsx) verbatim — figure AND wording — never Home's
    # differently-scoped safe-to-spend gap. Both period_gate.to_cover here
    # and Home's safe-to-spend shortfall trace back to the identical
    # `abs(safe_to_spend)` arithmetic (app.routers.grow's `_period_gate`),
    # so the two normally agree; when they don't on a live screen, it is a
    # cache-staleness gap between GET /grow's 6h cache and GET
    # /safe-to-spend's 90s cache, not a second, disagreeing engine — this
    # chip mirrors whichever figure Planning is ACTUALLY showing right now
    # by reading through the exact same GET /grow cache Planning itself
    # renders from.
    if period_gate.get("short"):
        to_cover = period_gate.get("to_cover")
        sentence1 = f"This period needs you first, {_fmt_gbp(to_cover)} to cover before payday."
        sentence2 = _period_short_subline(surplus_monthly)
    else:
        sentence1 = verdict.get("headline") or ""
        sentence2 = verdict.get("sub") or ""

    return _engine_result(
        "grow_saving_enough", f"{sentence1} {sentence2}",
        {"verdict": verdict, "period_gate": period_gate, "surplus_monthly": surplus_monthly},
    )


# ── tax_self_assessment — the one tax chip with a real engine figure
# (income, already exposed by get_tax_position) to personalise the fixed,
# already-vetted UK mechanics fact (self-assessment mandatory above
# £100,000 income this tax year — the same fact app.services.penny_agent's
# own system prompt rule 9 states for the model). The other three tax
# chips below (carry-forward, salary sacrifice, gift aid) have NEITHER a
# registry key NOR an engine-tracked figure specific to them — the app
# never records prior years' unused pension allowance, whether a
# contribution was made via salary sacrifice, or gift-aid donations — so
# composing prose for them here would mean inventing facts this module's
# own doctrine forbids. Those three fall back to the model instead (see
# `_llm_fallback` and CHIPS below). ─────────────────────────────────────────
async def _chip_tax_self_assessment(uid: str, params: dict | None) -> dict:
    tax = await execute_tool(uid, "get_tax_position", {})
    if tax.get("insufficient_data"):
        return _engine_result(
            "tax_self_assessment",
            "Self-assessment is generally mandatory once income passes £100,000 this tax year. "
            "Your own income isn't on file yet, add it in Settings to see where you stand.",
            tax,
        )
    income_fmt = (tax.get("income") or {}).get("formatted") or ""
    income_raw = float((tax.get("income") or {}).get("raw") or 0.0)
    if income_raw > 100_000:
        text = (
            f"Self-assessment is mandatory once income passes £100,000 this tax year, and your "
            f"income on file is {income_fmt}, so you're likely to need to file one."
        )
    else:
        text = (
            f"Self-assessment is mandatory once income passes £100,000 this tax year. Your income "
            f"on file is {income_fmt}, below that threshold."
        )
    return _engine_result("tax_self_assessment", text, tax)


# ── can_i_amount — the personalised "Can I spend £X this weekend?" chips
# from GET /can-i/suggestions, params: {amount, occasion}. Computes the
# EXACT deterministic verdict app.services.affordability.check_affordability
# gives the tool loop for the same question, and composes the answer from
# its own already-house-styled facts, no model call. ────────────────────────
async def _chip_can_i_amount(uid: str, params: dict | None) -> dict:
    params = params or {}
    try:
        amount = float(params.get("amount"))
    except (TypeError, ValueError):
        return _engine_result("can_i_amount", "I need a specific amount to check that against your numbers.")

    result = await check_affordability(uid, amount, None)
    if result.get("insufficient_data"):
        return _engine_result(
            "can_i_amount", "I don't have enough account data connected yet to check that.", result,
        )

    verdict_word = result.get("verdict_word")
    verdict_line = result.get("verdict") or ""
    sentence1 = verdict_line if verdict_line.endswith(".") else f"{verdict_line}."

    if result.get("months_until_target"):
        months = result["months_until_target"]
        savable_fmt = (result.get("savable_by_target") or {}).get("formatted")
        sentence2 = (
            f"At your usual saving pace you could have about {savable_fmt} put by in {_plural(months, 'month')}."
            if savable_fmt else ""
        )
    elif verdict_word == "yes":
        sentence2 = "That's comfortably within what's free before payday."
    elif verdict_word == "tight":
        per_day_fmt = (result.get("per_day") or {}).get("formatted")
        sentence2 = (
            f"It'll be tight, only about {per_day_fmt} a day left until payday."
            if per_day_fmt else "It'll be tight for the rest of this pay period."
        )
    elif verdict_word == "no":
        nearest = result.get("nearest_yes_amount")
        sentence2 = (
            f"{nearest['formatted']} is the largest amount that still fits before payday."
            if nearest else "There's nothing spare for this right now."
        )
    else:
        sentence2 = ""

    return _engine_result("can_i_amount", f"{sentence1} {sentence2}", result)


def _make_llm_fallback_chip(chip_id: str) -> ChipHandler:
    async def _handler(uid: str, params: dict | None) -> dict:
        return _llm_fallback(chip_id)

    return _handler


def _make_explain_chip(chip_id: str, topic: str) -> ChipHandler:
    async def _handler(uid: str, params: dict | None) -> dict:
        result = await execute_tool(uid, "explain", {"topic": topic})
        text = result.get("text")
        if not text:
            # Should be unreachable — `topic` above is pinned to a real key
            # in penny_tools._ALL_EXPLAIN_COPY — but never invent copy if
            # the registry ever drifts out from under this mapping.
            logger.error("penny_chips: explain topic '%s' missing for chip '%s'", topic, chip_id)
            raise LookupError(f"explain topic '{topic}' not found for chip '{chip_id}'")
        return {"chip_id": chip_id, "kind": "explain", "answer": house_style(text), "facts": result}

    return _handler


CHIPS: dict[str, ChipSpec] = {
    "home_payday_status":     ChipSpec(handler=_chip_home_payday_status),
    "home_payday_due":        ChipSpec(handler=_chip_home_payday_due),
    "spend_where_money_went": ChipSpec(handler=_chip_spend_where_money_went),
    "spend_more_than_usual":  ChipSpec(handler=_chip_spend_more_than_usual),
    "grow_saving_enough":     ChipSpec(handler=_chip_grow_saving_enough),
    "tax_self_assessment":    ChipSpec(handler=_chip_tax_self_assessment),
    "tax_pension_carry_forward": ChipSpec(handler=_make_llm_fallback_chip("tax_pension_carry_forward")),
    "tax_salary_sacrifice":      ChipSpec(handler=_make_llm_fallback_chip("tax_salary_sacrifice")),
    "tax_gift_aid":              ChipSpec(handler=_make_llm_fallback_chip("tax_gift_aid")),
    "can_i_amount":           ChipSpec(handler=_chip_can_i_amount),
    **{
        chip_id: ChipSpec(handler=_make_explain_chip(chip_id, topic))
        for chip_id, topic in _EXPLAIN_CHIP_TOPICS.items()
    },
}


async def answer_chip(uid: str, chip_id: str, params: dict | None = None) -> dict:
    """Dispatch one chip to its handler. Raises `LookupError` for an
    unknown chip id — app.routers.penny_chip turns that into the 404
    contract; never raises for a KNOWN chip whose engine call itself fails
    (each handler above catches its own engine's exceptions and degrades to
    an honest 'I can't work this out right now' sentence, matching every
    other read tool's failure doctrine in app.services.penny_tools)."""
    spec = CHIPS.get(chip_id)
    if spec is None:
        raise LookupError(f"unknown chip '{chip_id}'")
    return await spec.handler(uid, params)
