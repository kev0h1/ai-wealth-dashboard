"""Ground-up loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md) —
the deterministic "can I afford X" arithmetic, extracted verbatim (same
formulas, same rounding, same guard-rails) out of the pre-rebuild
`app.routers.can_i`'s own `/can-i` endpoint tail. That endpoint used to build
this fact pack and verdict itself, on the main request path, for every
question; now it is `app.services.penny_tools`'s `check_affordability` tool,
called only when the Penny agent loop (`app.services.penny_agent`) decides an
affordability question needs it, with `amount`/`timeframe` supplied by the
MODEL (extracted from the question) rather than by regex over the raw
question text — see `_parse_timeframe` below for the one place that old
regex-extraction machinery survives, now applied to the model's own short
`timeframe` string instead of the whole sentence.

Doctrine unchanged: this module decides EVERY figure and the verdict word,
the LLM downstream (penny_agent's system prompt) only phrases prose around
whatever this returns, and is instructed to reproduce `verdict` verbatim as
its HEADLINE — never a fresh Yes/No/Tight guess of its own (see the
2026-08-25 owner decision below `_whatif_delta_line` for why a bare verdict
word is banned from user-facing copy).

IMPORT RULE: mirrors app.services.penny_tools's own rule (see that module's
docstring) — this module must NEVER import from app.routers.can_i (that
router doesn't need anything from here directly; only penny_tools.py, via
`check_affordability`, does).
"""
import logging
import re
from datetime import date, datetime, timedelta

from app.routers.analytics import compute_safe_to_spend
from app.routers.savings import _cashflow
from app.services.region import get_user_region

logger = logging.getLogger(__name__)

MONTH_NAMES = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]


# ── £ formatting — twin of app.routers.can_i._fmt_gbp / app.services.
# penny_tools._fmt_gbp (see the IMPORT RULE above for why this is copied
# rather than imported): same Unicode minus (−), never a hyphen, for
# negative money. ────────────────────────────────────────────────────────
def _fmt_gbp(amount: float, decimals: int = 0) -> str:
    amount = amount or 0.0
    return f"−£{abs(amount):,.{decimals}f}" if amount < 0 else f"£{amount:,.{decimals}f}"


def _money(amount) -> dict:
    """Same raw+formatted shape penny_tools._money already hands the model
    for every other tool — one convention, so `check_affordability`'s result
    looks like every sibling tool's."""
    val = float(amount or 0.0)
    return {"raw": round(val, 2), "formatted": _fmt_gbp(val)}


def _fmt_rate(amount: float) -> str:
    """£ string for a derived daily rate. "About" and pence can't both be
    true — implying audited, to-the-penny precision on a rounded rate reads
    as false confidence. Whole pounds from £5/day up; pence only below that."""
    decimals = 0 if abs(amount) >= 5 else 2
    return _fmt_gbp(amount, decimals=decimals)


def _per_day_line(per_day: float) -> str:
    return f"That's about {_fmt_rate(per_day)} a day"


# Owner-approved fix (2026-08) — safe_to_spend is net of unpaid card growth
# and can land at or below zero (a "short" pot); the two `short_reason`
# cases read differently on purpose (see the original can_i.py comment this
# was lifted from): "bills" is a genuine risk, "cards" means bills ARE
# covered and the shortfall is purely card-funded spending.
def _nothing_spare_line(payday_label: str | None, short_reason: str | None) -> str:
    until = f"until {payday_label}" if payday_label else "until payday"
    if short_reason == "cards":
        return f"Bills are covered, but nothing spare {until}, it's gone on cards"
    return f"Nothing spare {until}, bills come first"


# ── Timeframe parsing — applied to the MODEL-supplied `timeframe` string,
# never the raw question ─────────────────────────────────────────────────
# The pre-rebuild ladder ran this same month/year extraction over the whole
# question text, guarding against bare numbers/years being misread as money
# (the "Japan 2027" bug class). That guarding is no longer needed here: the
# model already separated `amount` from `timeframe` as two distinct tool
# arguments, so `timeframe` is a short, already-disambiguated phrase like
# "December", "October 2027" or "next year" — this only needs to turn THAT
# into a months-until-target count, not defend against a year being mistaken
# for a price in the first place (rule 1 of penny_agent's system prompt
# already tells the model never to invent a figure; a wildly malformed
# `timeframe` string just fails to match anything below and is treated as
# "no timeframe understood", same graceful-miss discipline as everywhere
# else in this codebase).
_YEAR_RANGE_LOW, _YEAR_RANGE_HIGH = 2020, 2039
_MONTH_YEAR_RE = re.compile(
    r"\b(" + "|".join(MONTH_NAMES) + r")\b\s*(?:of\s+)?(\d{4})\b", re.IGNORECASE,
)
_YEAR_TIME_CONTEXT_RE = re.compile(r"\b(?:in|by|until|before|during)?\s*(20\d{2})\b", re.IGNORECASE)
_NEXT_YEAR_RE = re.compile(r"\bnext\s+year\b", re.IGNORECASE)


def _months_until_target(month_name: str, today: date) -> int:
    """1..12 — months from today to the NEXT occurrence of the named month."""
    target_idx = MONTH_NAMES.index(month_name) + 1
    delta = target_idx - today.month
    if delta <= 0:
        delta += 12
    return delta


def _months_until_month_year(month_name: str, year: int, today: date) -> int:
    """Exact months from today to the 1st of the given month/year pair. Can
    be zero or negative (the pairing is already in the past) — the caller
    only ever acts on a positive result."""
    target_idx = MONTH_NAMES.index(month_name) + 1
    return (year - today.year) * 12 + (target_idx - today.month)


def _months_until_horizon_year(target_year: int, today: date) -> int:
    """Months from today to January of `target_year` — a bare year names no
    specific month, so anchoring on the earliest possible month gives the
    smallest, most conservative months-until figure. Can be 0 or negative;
    the caller only acts on a positive result."""
    return (target_year - today.year) * 12 + (1 - today.month)


def _parse_timeframe(timeframe: str, today: date) -> int | None:
    """months_until_target for the model-supplied `timeframe` string, or
    None if it names no usable future point at all (an empty string, "this
    week", or anything else this parser doesn't recognise — treated as "no
    timeframe", never a guess). Tried in the same specificity order the
    pre-rebuild ladder used: an explicit "Month Year" pairing first (most
    specific), then a bare month name (assumed to be its next occurrence),
    then a bare/"in"/"by" year or the literal "next year".
    """
    text = (timeframe or "").strip()
    if not text:
        return None
    m = _MONTH_YEAR_RE.search(text)
    if m:
        year = int(m.group(2))
        if _YEAR_RANGE_LOW <= year <= _YEAR_RANGE_HIGH:
            return _months_until_month_year(m.group(1).lower(), year, today)
    text_lower = text.lower()
    for month_name in MONTH_NAMES:
        if re.search(r"\b" + month_name + r"\b", text_lower):
            return _months_until_target(month_name, today)
    if _NEXT_YEAR_RE.search(text_lower):
        return _months_until_horizon_year(today.year + 1, today)
    m = _YEAR_TIME_CONTEXT_RE.search(text_lower)
    if m:
        year = int(m.group(1))
        if _YEAR_RANGE_LOW <= year <= _YEAR_RANGE_HIGH:
            return _months_until_horizon_year(year, today)
    return None


# ── Verdict arithmetic — the golf-session-bug fix, unchanged ────────────────
def _derive_verdict(what_ifs: dict, safe_to_spend: float) -> str | None:
    """Deterministic yes/tight/no from the SAME precomputed what-if
    arithmetic the returned facts carry. None (leave the multi-month case to
    the FIT headline below instead) whenever `months_until_target` is set —
    a "save £2000 for Japan by December" question carries an amount but
    `free_after_spend` is a THIS-PAY-PERIOD figure, not what was asked.
    "tight" carries both an absolute and a relative arm because either alone
    misses a case the other catches (see the original can_i.py `_derive_
    verdict` docstring this was lifted from for the full worked rationale)."""
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


# Owner decision, 2026-08-25: "Yes" / "Yes, but it'll be tight" / "Not this
# one" read as a VERDICT, a recommendation on what the user should do, even
# though every figure behind them came straight from the user's own numbers.
# A factual statement about those numbers is not advice, so the delta
# arithmetic below IS the verdict shown to the user, never a translated
# verdict word. `_derive_verdict`'s own yes/tight/no is still computed and
# returned (as `verdict_word`, see `check_affordability` below) so the model
# knows which consequence to lean on (the nearest-yes suggestion on "no",
# the per-day rate on "tight") — it must never be shown to the user as the
# headline itself.
def _whatif_delta_line(amount_asked: float, free_after_spend: float) -> str:
    return (
        f"£{amount_asked:,.0f} leaves {_fmt_gbp(free_after_spend)} free" if free_after_spend >= 0
        else f"£{amount_asked:,.0f} would take you {_fmt_gbp(free_after_spend)}"
    )


def _multimonth_fit_headline(savable_by_target: float, amount_asked: float) -> str:
    """Fallback headline for the one amount-bearing branch with no per-period
    delta to use: a multi-month savings question. Only binary ("That fits" /
    "That doesn't fit") — a softened factual-conditional pair, not a verdict
    word either."""
    return "That fits" if savable_by_target >= amount_asked else "That doesn't fit"


def _nearest_yes_amount(safe_to_spend: float) -> int | None:
    """Largest round-£5 amount that actually fits within safe_to_spend.
    Never £0: at or below zero there IS no nearest yes."""
    if safe_to_spend <= 0:
        return None
    amount = int(safe_to_spend // 5) * 5
    return amount if amount >= 5 else None


# ── Ask-when nudge — restored, loop-native, 2026-08-26 (independent audit) ──
# Owner-reported UX bug this fixes: "Would I be able to afford a trip for
# 2000£" (a large, dateless one-off) used to be judged silently against the
# CURRENT pay period ("£2,000 would take you −£2,212") with no prompt to
# say when the trip actually was — the deleted ladder's
# `_is_big_one_off_with_no_horizon` fixed this with a deterministic
# post-processing suffix can_i.py's endpoint guaranteed onto the reply. That
# guarantee mechanism has no equivalent in the loop (there is no post-hook
# over the model's own final text any more), so this is restored as a TOOL
# RESULT signal instead: `check_affordability` sets `ask_when: true` +
# `timeframe_assumed: "current_period"` whenever it silently judged a large
# amount against the current period for lack of a timeframe, and
# penny_agent's system prompt instructs the model to act on that flag.
#
# The SAME threshold the deleted predicate used — reused, not reinvented:
# "large" means at least half of a positive safe-to-spend envelope, or
# ANY positive amount when the envelope is already at/below zero (there is
# no positive envelope left to take a fraction of). The one piece of the
# original predicate NOT carried over is the one-off SUBJECT-word match
# ("trip", "holiday", "wedding", ...) — this tool never sees the raw
# question text, only `amount`/`timeframe`, so the signal here is threshold-
# only; a small dateless ask (a £5 coffee) still never trips it.
_BIG_ONE_OFF_FRACTION = 0.5


def _is_large_relative_to_envelope(amount: float, safe_to_spend: float) -> bool:
    if safe_to_spend > 0:
        return amount >= _BIG_ONE_OFF_FRACTION * safe_to_spend
    return amount > 0


async def check_affordability(uid: str, amount: float, timeframe: str | None = None) -> dict:
    """The `check_affordability` tool's engine. `amount` is a plain £ figure
    the MODEL has already extracted from the question (never re-extracted by
    regex here); `timeframe`, when given, is a short free-text phrase naming
    a future point ("December", "October 2027", "next year") the spend is
    FOR, parsed by `_parse_timeframe` above.

    Returns a dict with `insufficient_data: True` (no other keys but
    `reason`) when the user has no connected account data yet — same shape
    every other read-only tool in penny_tools.py uses for that case — or the
    full fact pack otherwise, always including a final `verdict` sentence
    (never a bare Yes/No/Tight word) the model must reproduce verbatim.
    """
    sts = await compute_safe_to_spend(uid)
    if sts.get("status") == "insufficient_data":
        return {"insufficient_data": True, "reason": "no account data connected yet"}

    safe_to_spend = float(sts.get("safe_to_spend") or 0.0)
    days_until_payday = sts.get("days_until_payday") or 1
    amount = float(amount or 0.0)

    monthly_surplus = 0.0
    try:
        region = await get_user_region(uid)
        cutoff = datetime.now() - timedelta(days=90)
        _, _, monthly_surplus = await _cashflow(uid, region, cutoff)
    except Exception:
        logger.exception("affordability: monthly cashflow lookup failed for %s", uid)

    free_after_spend = round(safe_to_spend - amount)
    what_ifs: dict = {
        "amount_asked": amount,
        "free_after_spend": free_after_spend,
        "per_day_after": round(free_after_spend / max(1, days_until_payday), 2),
        "goes_negative": free_after_spend < 0,
    }

    months_until_target = _parse_timeframe(timeframe or "", date.today())
    if months_until_target is not None and months_until_target > 0:
        what_ifs["months_until_target"] = months_until_target
        what_ifs["savable_by_target"] = (
            round(monthly_surplus * months_until_target) if monthly_surplus > 0 else 0
        )

    verdict_word = _derive_verdict(what_ifs, safe_to_spend)
    if verdict_word is not None:
        verdict = _whatif_delta_line(amount, free_after_spend)
    elif what_ifs.get("months_until_target"):
        verdict = _multimonth_fit_headline(what_ifs.get("savable_by_target") or 0, amount)
    else:
        # No timeframe was understood at all and the this-period delta is
        # still the honest answer to "can I afford this right now" — falls
        # back to the same delta line every ordinary same-period ask gets.
        verdict = _whatif_delta_line(amount, free_after_spend)

    result: dict = {
        "verdict": verdict,
        "verdict_word": verdict_word,
        "safe_to_spend": _money(safe_to_spend),
        "amount_asked": _money(amount),
        "free_after_spend": _money(free_after_spend),
        "days_until_payday": days_until_payday,
        "next_payday": sts.get("next_payday"),
        "state": sts.get("state"),
        "short_reason": sts.get("short_reason"),
        "bills_total": _money(sts.get("bills_total")),
    }
    if what_ifs.get("months_until_target"):
        result["months_until_target"] = what_ifs["months_until_target"]
        result["savable_by_target"] = _money(what_ifs.get("savable_by_target"))
    elif not (timeframe or "").strip() and _is_large_relative_to_envelope(amount, safe_to_spend):
        # No timeframe was given at all AND this amount is large enough that
        # silently judging it against the current pay period is misleading
        # (see the "Ask-when nudge" comment above `_BIG_ONE_OFF_FRACTION`) —
        # tell the model it assumed the current period and must ask when the
        # spend is actually for.
        result["timeframe_assumed"] = "current_period"
        result["ask_when"] = True
    if verdict_word == "no":
        nearest = _nearest_yes_amount(safe_to_spend)
        if nearest is not None:
            result["nearest_yes_amount"] = _money(nearest)
    if safe_to_spend > 0:
        result["per_day"] = _money(round(safe_to_spend / max(1, days_until_payday), 2))
    return result
