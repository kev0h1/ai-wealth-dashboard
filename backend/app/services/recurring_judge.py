"""LLM scrutiny pass for the trusted-category bypass in `_detect_recurring`
(app/routers/analytics.py).

Why this exists: "Transfer" (and the rest of DEFAULT_RECURRING_CATEGORIES)
is a TRUSTED category — a series in it is accepted as recurring at 2
occurrences, skipping the interval-tolerance and amount-stability gates the
generic path enforces. That trust is deliberate (see the comment block
above DEFAULT_RECURRING_CATEGORIES in analytics.py) and must stay. But it
also means a handful of one-off balance transfers that happen to share
statement text ("COMP BAL XFR") can clear the bar on category alone, even
though their amounts and gaps are wildly irregular — a real case: 4
balance transfers of GBP641.32/1362.69/1574.05/996.07 on a HSBC credit
card, gaps of 43 and 17 days, projected as a GBP1,310.94 phantom bill.

The fix is not a hardcoded description rule (Kevin was explicit: no
"balance transfer" string matching) — it's a second look FROM AN LLM,
reasoning like a UK personal-finance analyst, applied only to the series
that actually need it: ones that only qualified because the category is
trusted, and would otherwise have failed the same generic gates every
non-trusted series must clear. This mirrors app/services/categorisation.py's
shape (deterministic core + cached LLM judgement) and reuses the exact
OpenRouter/Haiku call convention `_ai_recurring_predict` in analytics.py
already established.

The deterministic detector remains the floor: on any failure to reach a
verdict (no API key, timeout, non-200, bad JSON), a series projects exactly
as it did before this module existed. This module only ever REMOVES a
series from the projection (a veto); it never adds one.
"""
import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, date as _date

import httpx

from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat
from app.db.collections import recurring_judge_col

logger = logging.getLogger(__name__)

_TIMEOUT_S = 15  # matches _ai_recurring_predict's timeout in analytics.py
_MODEL = "anthropic/claude-haiku-4-5"

# Cap real LLM calls per refresh so a cold cache (first sync, or every
# series' evidence changing at once) cannot burst spend. Cache hits don't
# count against this — only series that actually need a fresh judgement do.
MAX_JUDGEMENTS_PER_REFRESH = 10


# ── Shared evidence gate (the ONE copy; analytics.py imports this) ─────────

def gate_failure_reason(items: list, intervals: list[float], avg_interval: float) -> str | None:
    """The generic (non-trusted-category) recurring evidence gate, extracted
    so `_detect_recurring`'s trusted-tier bypass and this module's
    suspect-selection can never drift into two different thresholds.

    Returns a short reason string the moment `items` would FAIL the gate a
    non-trusted-category series must clear, or None if it would pass.
    Thresholds are copied verbatim from `_detect_recurring` (analytics.py):
    fewer than 3 occurrences, interval spread beyond max(3, 20% of the mean
    interval), or amounts spread beyond 30% of the median.
    """
    if len(items) < 3:
        return "fewer than 3 occurrences"
    tolerance = max(3.0, avg_interval * 0.2)
    if any(abs(iv - avg_interval) > tolerance for iv in intervals):
        return "irregular intervals between occurrences"
    amounts = sorted(abs(float(t.get("amount", 0))) for t in items)
    median = amounts[len(amounts) // 2]
    if median <= 0 or any(abs(a - median) > median * 0.3 for a in amounts):
        return "amounts vary more than 30% from the median"
    return None


def is_suspect(series: dict) -> bool:
    """True when `series` (one `_detect_recurring` result dict) was only
    accepted because its category is trusted, and would have FAILED the
    generic gate above on its own evidence. Set by `_detect_recurring` at
    detection time (see `trusted_bypass_reason`), so this reads a flag
    rather than re-deriving one — the detector already has the intervals
    and unrounded avg_interval in hand at the exact moment it decides to
    bypass, which is the only place this can be computed precisely.

    A non-trusted series (already had to clear the generic gate to exist at
    all) and a trusted series that would ALSO have passed the generic gate
    both come back False here — neither needs a second, expensive opinion.
    """
    return bool(series.get("trusted_bypass_reason"))


def _cache_signature(series: dict) -> str:
    """A cache key component that changes the moment the series' evidence
    does: occurrence count + last occurrence date + a hash of the rounded
    amounts. A new occurrence therefore invalidates the cache naturally —
    no TTL needed on a hit."""
    occ = series.get("occurrences_detail") or []
    amounts = sorted(round(float(o.get("amount", 0)), 2) for o in occ)
    amounts_hash = hashlib.sha1(json.dumps(amounts).encode()).hexdigest()[:12]
    last_date = series.get("last_date")
    last_date_s = last_date.isoformat() if hasattr(last_date, "isoformat") else str(last_date)
    return f"{len(occ)}:{last_date_s}:{amounts_hash}"


def _account_context(acct: dict | None) -> dict:
    if not acct:
        return {"bank": None, "account_type": "unknown", "is_credit_card": False, "balance": None}
    is_cc = bool(acct.get("is_credit_card"))
    return {
        "bank": acct.get("provider"),
        "account_type": "credit card" if is_cc else "current/savings account",
        "is_credit_card": is_cc,
        "balance": acct.get("balance"),
    }


def _build_prompt(series: dict, acct: dict | None) -> str:
    occ = sorted(series.get("occurrences_detail") or [], key=lambda o: o["date"])
    dates = [o["date"] for o in occ]
    intervals = []
    for i in range(1, len(dates)):
        try:
            d0 = _date.fromisoformat(dates[i - 1])
            d1 = _date.fromisoformat(dates[i])
            intervals.append((d1 - d0).days)
        except Exception:
            pass
    ctx = _account_context(acct)
    payload = {
        "description": series.get("key"),
        "category": series.get("category"),
        "account": ctx,
        "occurrences": occ,
        "intervals_days": intervals,
        "projected_next_date": series.get("next_date").isoformat() if hasattr(series.get("next_date"), "isoformat") else series.get("next_date"),
        "projected_amount": series.get("avg_amount"),
    }
    return (
        "You are a UK personal finance analyst reviewing one detected 'recurring bill' "
        "series from a bank account, deciding whether to keep projecting it as a future "
        "bill or veto it as a false positive.\n\n"
        "The series below cleared detection only because its category is trusted at low "
        "occurrence counts, so it was never checked for a regular cadence or stable "
        "amounts the way an ordinary series would be. Decide: is this a genuine recurring "
        "commitment likely to recur on roughly this cadence, or a series of one-off events "
        "that happen to share statement text (e.g. balance transfers, ad-hoc top-ups, "
        "manual card payments, transfers to self made by hand)?\n\n"
        "Guidance:\n"
        "- A variable-amount bill on a REGULAR cadence (energy, phone overage) IS "
        "recurring — amount variance alone is not disqualifying.\n"
        "- Irregular timing AND irregular amounts together, especially on a credit-card "
        "account, strongly suggest a series of ad-hoc one-off events, not a bill.\n"
        "- When genuinely unsure, prefer to ALLOW the projection: a false bill in the "
        "forecast is annoying, but silently dropping a real bill is worse. The "
        "deterministic detector already provides the floor; you are only removing "
        "clear false positives.\n\n"
        f"Evidence:\n{json.dumps(payload, indent=2, default=str)}\n\n"
        "Reply with STRICT JSON only, no other text: "
        '{"recurring": true or false, "confidence": 0 to 1, "reason": "<one plain sentence, '
        'no em-dashes, safe to show the user>"}'
    )


async def _call_llm_judge(series: dict, acct: dict | None, uid: str) -> dict | None:
    if not OPENROUTER_API_KEY:
        return None
    prompt = _build_prompt(series, acct)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            r = await openrouter_chat(
                {"model": _MODEL, "max_tokens": 250,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=uid, pipeline="recurring_judge", client=client,
            )
        if r.status_code != 200:
            return None
        content = r.json()["choices"][0]["message"]["content"].strip()
        m = re.search(r"\{.*\}", content, re.DOTALL)
        if not m:
            return None
        verdict = json.loads(m.group(0))
        if "recurring" not in verdict:
            return None
        return {
            "recurring": bool(verdict["recurring"]),
            "confidence": float(verdict.get("confidence", 0.5)),
            "reason": str(verdict.get("reason", "")).strip(),
        }
    except Exception as e:
        logger.info("recurring_judge: judge call failed, failing open: %s", e)
        return None


async def judge_suspect_series(uid: str, series_list: list[dict], account_map: dict) -> dict[str, dict]:
    """Review every SUSPECT series in `series_list` (see `is_suspect`) and
    return a `{key: verdict_doc}` map for every series a verdict was
    reached for (cache hit or fresh judgement) — callers apply the veto via
    `apply_verdicts`. Non-suspect series never appear in the input the
    caller need send, and are never sent to the LLM even if present.

    Cached per user in `recurring_judge_col`, keyed on `f"{uid}::{key}"`,
    invalidated by `_cache_signature` the moment the series' evidence
    changes. Fresh judgements for a cold cache run CONCURRENTLY
    (asyncio.gather), not serially, since this executes inline in the
    `/cashflow` request path and up to `MAX_JUDGEMENTS_PER_REFRESH` serial
    15s-timeout calls would make that request crawl.
    """
    if not series_list:
        return {}
    suspects = [s for s in series_list if is_suspect(s)]
    if not suspects:
        return {}

    verdicts: dict[str, dict] = {}
    to_judge: list[tuple[dict, str]] = []
    for s in suspects:
        sig = _cache_signature(s)
        cached = await recurring_judge_col.find_one({"_id": f"{uid}::{s['key']}"})
        if cached and cached.get("cache_sig") == sig:
            verdicts[s["key"]] = cached
        else:
            to_judge.append((s, sig))

    if not OPENROUTER_API_KEY:
        return verdicts  # fail open: nothing fresh can be judged, cache hits still apply

    to_judge = to_judge[:MAX_JUDGEMENTS_PER_REFRESH]

    async def _judge_one(s: dict, sig: str) -> dict | None:
        acct = account_map.get(s.get("account_id") or "") if account_map else None
        result = await _call_llm_judge(s, acct, uid)
        if result is None:
            return None
        doc = {
            "_id": f"{uid}::{s['key']}",
            "user_id": uid,
            "key": s["key"],
            "cache_sig": sig,
            "recurring": result["recurring"],
            "confidence": result["confidence"],
            "reason": result["reason"],
            "judged_at": datetime.now(),
        }
        try:
            await recurring_judge_col.update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
        except Exception as e:
            logger.info("recurring_judge: cache write failed (non-fatal): %s", e)
        return doc

    if to_judge:
        fresh = await asyncio.gather(*[_judge_one(s, sig) for s, sig in to_judge])
        for doc in fresh:
            if doc:
                verdicts[doc["key"]] = doc

    return verdicts


def apply_verdicts(
    series_list: list[dict],
    verdicts: dict[str, dict],
    judge_overrides: set[str] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Split `series_list` into (kept, engine_vetoed) using `verdicts`.

    A series is vetoed only when a verdict was actually reached AND it says
    `recurring: false` — no verdict (fail-open, or never suspect) always
    keeps the series exactly as the deterministic core decided. Vetoed
    entries are tracked separately from the user's `dismissed_recurring`
    preference (that list is theirs; this is the engine's own judgement,
    with its reason and timestamp) so a future UI can show "Sorted set this
    aside: <reason>" distinctly from a user dismissal.

    `judge_overrides` (keys the user has explicitly told the undo-log "this
    IS recurring" — see POST /dismissed-series/override in analytics.py) is
    checked FIRST and short-circuits the veto entirely, including for a
    fresh verdict reached this exact call. A user override outranks the
    judge by design: once a person has looked at a specific series and said
    it's real, no future re-judgement gets to silently veto it again — the
    LLM's job is to catch cases nobody has looked at yet, not to overrule a
    human who already has.
    """
    overrides = judge_overrides or set()
    kept: list[dict] = []
    engine_vetoed: list[dict] = []
    for s in series_list:
        if s["key"] in overrides:
            kept.append(s)
            continue
        v = verdicts.get(s["key"])
        if v is not None and v.get("recurring") is False:
            engine_vetoed.append({
                "key": s["key"],
                "category": s.get("category"),
                "reason": v.get("reason"),
                "confidence": v.get("confidence"),
                "vetoed_at": v.get("judged_at"),
            })
            continue
        kept.append(s)
    return kept, engine_vetoed
