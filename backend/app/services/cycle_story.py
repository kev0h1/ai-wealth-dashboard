"""Cycle (pay-period) story — deterministic chapters + LLM narrative.

Three public coroutines:
  compute_cycle_story   — deterministic facts for a single pay period
  narrate_cycle_story   — one LLM call that turns facts into six prose sections
  get_cycle_story       — cache-aware entry point for the /cycle/story endpoint
"""
from __future__ import annotations

import copy
import json
import re
import logging
from datetime import date, datetime, timedelta, timezone
from collections import defaultdict
from typing import Any

import httpx

from app.core.config import OPENROUTER_API_KEY, APP_URL
from app.db.collections import (
    transactions_col,
    accounts_col,
    preferences_col,
    behaviour_portrait_col,
    needle_history_col,
    cycle_story_col,
)
from app.services.behaviour import (
    savings_account_ids,
    classify_saving_flow,
    _NON_SPEND_CATEGORIES,
)
from app.services.needle import (
    _txns_for_period,
    _credit_card_account_ids,
    _current_account_ids,
    compute_needle,
    _build_tomorrow_strings,
)
from app.services.pay_period import get_pay_period_for_date, prev_pay_period

log = logging.getLogger(__name__)

CARDS_MATERIAL_THRESHOLD = 50.0


def _to_date_str(val: Any) -> str:
    if isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, date) and not isinstance(val, datetime):
        return val.strftime("%Y-%m-%d")
    if isinstance(val, str):
        return val[:10]
    return ""


def _date_ord(d: str) -> int:
    try:
        return datetime.strptime(d, "%Y-%m-%d").toordinal()
    except Exception:
        return 0


async def compute_cycle_story(uid: str, period_start: date, period_end: date, preview_close: bool = False) -> dict:
    """Compute deterministic chapter facts for a pay period."""
    today = date.today()
    fetch_end = min(period_end, today)

    raw_txns = await _txns_for_period(uid, period_start, fetch_end)
    if not raw_txns:
        return {"status": "no_data"}

    raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)

    # Account classification
    cc_ids = await _credit_card_account_ids(uid)
    current_acc_docs = await _current_account_ids(uid)
    current_acc_ids = {str(a.get("account_id") or a.get("_id")) for a in current_acc_docs}
    saving_acc_ids = savings_account_ids(raw_accounts)

    # Normalise transactions
    txns: list[dict] = []
    for t in raw_txns:
        amount = float(t.get("amount", 0) or 0)
        cat = t.get("custom_category") or t.get("category") or "Other"
        date_str = _to_date_str(t.get("date", ""))
        acc_id = str(t.get("account_id") or "")
        is_debit = t.get("transaction_type") == "debit"
        is_credit_card = acc_id in cc_ids
        desc = (t.get("description") or t.get("name") or "").strip()
        txns.append({
            "amount": amount,
            "category": cat,
            "description": desc,
            "date": date_str,
            "account_id": acc_id,
            "is_debit": is_debit,
            "is_credit": not is_debit,
            "is_credit_card": is_credit_card,
        })

    period_start_str = period_start.isoformat()
    week1_end = period_start + timedelta(days=6)
    week1_end_str = week1_end.isoformat()

    # Real spend = debits NOT in _NON_SPEND_CATEGORIES (any account)
    real_spend_all = [
        t for t in txns
        if t["is_debit"] and t["category"] not in _NON_SPEND_CATEGORIES
    ]

    # ── Chapter 1: Opening ────────────────────────────────────────────────────
    opening_window_end = period_start + timedelta(days=2)
    opening_window_end_str = opening_window_end.isoformat()
    income_txns = [
        t for t in txns
        if not t["is_debit"]
        and t["category"] == "Income"
        and t["account_id"] in current_acc_ids
        and period_start_str <= t["date"] <= opening_window_end_str
    ]
    income_in = round(sum(abs(t["amount"]) for t in income_txns), 2)
    opening = {"income_in": income_in, "count": len(income_txns)}

    # ── Chapter: Spending (universal) ────────────────────────────────────────
    total_spend = round(sum(abs(t["amount"]) for t in real_spend_all), 2)

    # Top 5 categories by summed abs amount, ALL accounts
    cat_totals: dict[str, float] = defaultdict(float)
    for t in real_spend_all:
        cat_totals[t["category"]] += abs(t["amount"])
    top_categories = [
        {"category": cat, "total": round(v, 2)}
        for cat, v in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)[:5]
    ]

    spending_chapter = {
        "total_spend": total_spend,
        "income_in": income_in,  # reuse payday-window income from opening chapter
        "top_categories": top_categories,
    }

    # ── Chapter 2: Cliff ──────────────────────────────────────────────────────
    week1_spend_txns = [
        t for t in real_spend_all
        if t["date"] <= week1_end_str
    ]
    week1_spend = round(sum(abs(t["amount"]) for t in week1_spend_txns), 2)
    period_spend = round(sum(abs(t["amount"]) for t in real_spend_all), 2)

    if period_spend > 0:
        week1_pct = round(week1_spend / period_spend * 100, 1)
    else:
        week1_pct = 0.0

    # Top 3 payees from week-1 real spend debits
    # Bills first (sorted by total desc), then non-Bills (sorted by total desc)
    payee_totals: dict[str, float] = defaultdict(float)
    payee_cats: dict[str, str] = {}
    for t in week1_spend_txns:
        payee = t["description"].strip().title() if t["description"] else "Unknown"
        payee_totals[payee] += abs(t["amount"])
        payee_cats[payee] = t["category"]

    bills_payees = sorted(
        [(p, v) for p, v in payee_totals.items() if payee_cats[p] == "Bills"],
        key=lambda x: x[1], reverse=True
    )
    non_bills_payees = sorted(
        [(p, v) for p, v in payee_totals.items() if payee_cats[p] != "Bills"],
        key=lambda x: x[1], reverse=True
    )

    commitments_raw = bills_payees[:3]
    remaining = 3 - len(commitments_raw)
    if remaining > 0:
        commitments_raw += non_bills_payees[:remaining]

    commitments = [{"payee": p, "total": round(v, 2)} for p, v in commitments_raw]

    cliff = {
        "week1_spend": week1_spend,
        "period_spend": period_spend,
        "week1_pct": week1_pct,
        "commitments": commitments,
    }

    # ── Chapter 3: Switch ─────────────────────────────────────────────────────
    # week1 cc pct
    week1_real = [t for t in real_spend_all if t["date"] <= week1_end_str]
    week1_total_spend = sum(abs(t["amount"]) for t in week1_real)
    week1_cc_spend = sum(abs(t["amount"]) for t in week1_real if t["is_credit_card"])
    if week1_total_spend > 0:
        week1_card_pct = round(week1_cc_spend / week1_total_spend * 100, 1)
    else:
        week1_card_pct = 0.0

    # rest (after day 7)
    rest_real = [t for t in real_spend_all if t["date"] > week1_end_str]
    rest_total_spend = sum(abs(t["amount"]) for t in rest_real)
    rest_cc_spend = sum(abs(t["amount"]) for t in rest_real if t["is_credit_card"])
    if rest_total_spend > 0:
        rest_card_pct = round(rest_cc_spend / rest_total_spend * 100, 1)
    else:
        rest_card_pct = 0.0

    # switch_day: first day where cc real spend > 50% of day total AND day total >= £10
    switch_day = None
    day_cursor = period_start
    while day_cursor <= fetch_end:
        day_str = day_cursor.isoformat()
        day_real = [t for t in real_spend_all if t["date"] == day_str]
        day_total = sum(abs(t["amount"]) for t in day_real)
        day_cc = sum(abs(t["amount"]) for t in day_real if t["is_credit_card"])
        if day_total >= 10 and day_cc > day_total * 0.5:
            switch_day = day_str
            break
        day_cursor += timedelta(days=1)

    switch = {
        "week1_card_pct": week1_card_pct,
        "rest_card_pct": rest_card_pct,
        "switch_day": switch_day,
    }

    # ── Chapter: Cards (conditional) ──────────────────────────────────────────
    # new_spend: ALL debits on cc accounts (no category filter)
    cc_new_spend_txns = [t for t in txns if t["is_debit"] and t["is_credit_card"]]
    cc_new_spend = round(sum(abs(t["amount"]) for t in cc_new_spend_txns), 2)
    # payments: all credits on cc accounts (= existing card_feeding_total will match)
    cc_payment_txns = [t for t in txns if t["is_credit"] and t["is_credit_card"]]
    cc_payments = round(sum(abs(t["amount"]) for t in cc_payment_txns), 2)
    cc_delta = round(cc_new_spend - cc_payments, 2)
    # share_of_spend: cc new spend / total real spend
    cc_share = round(cc_new_spend / total_spend, 3) if total_spend > 0 else 0.0
    cards_present = bool(cc_ids)
    cards_material = cards_present and abs(cc_delta) >= CARDS_MATERIAL_THRESHOLD

    cards_chapter = {
        "present": cards_present,
        "material": cards_material,
        "new_spend": cc_new_spend,
        "payments": cc_payments,
        "delta": cc_delta,
        "share_of_spend": cc_share,
    }

    # ── Chapter 4: Moves ──────────────────────────────────────────────────────
    # card_feeding: all credits on cc accounts
    card_feeding_txns = [
        t for t in txns
        if t["is_credit"] and t["is_credit_card"]
    ]
    card_feeding_total = round(sum(abs(t["amount"]) for t in card_feeding_txns), 2)
    card_feeding = {"count": len(card_feeding_txns), "total": card_feeding_total}

    # classify_saving_flow
    flow = classify_saving_flow(txns, saving_acc_ids)
    type1 = flow["type1"]
    type2 = flow["type2"]
    withdrawals = flow["withdrawals"]
    external_type1 = flow["external_type1"]
    all_savings_credits = flow["all_savings_credits"]

    ritual_saving_txns = [t for t in (type1 + type2) if abs(t["amount"]) <= 15]
    deliberate_saving_txns = [t for t in (type1 + type2) if abs(t["amount"]) > 15]

    ritual_saving = {
        "count": len(ritual_saving_txns),
        "total": round(sum(abs(t["amount"]) for t in ritual_saving_txns), 2),
    }
    deliberate_saving = {
        "count": len(deliberate_saving_txns),
        "total": round(sum(abs(t["amount"]) for t in deliberate_saving_txns), 2),
    }
    buffer_draws = {
        "count": len(withdrawals),
        "total": round(sum(abs(t["amount"]) for t in withdrawals), 2),
    }

    # other_shuffles: Transfer/Internal Transfer debits on non-savings, non-cc accounts
    # excluding type1 saving debits and debits matching card_feeding credits (£0.02, 2 days)
    type1_ids = {id(t) for t in type1}

    def _matches_card_feeding(t: dict) -> bool:
        t_ord = _date_ord(t["date"])
        t_amt = abs(t["amount"])
        for cf in card_feeding_txns:
            if abs(abs(cf["amount"]) - t_amt) <= 0.02 and abs(_date_ord(cf["date"]) - t_ord) <= 2:
                return True
        return False

    other_shuffles_txns = [
        t for t in txns
        if t["is_debit"]
        and t["category"] in ("Transfer", "Internal Transfer")
        and t["account_id"] not in saving_acc_ids
        and not t["is_credit_card"]
        and id(t) not in type1_ids
        and not _matches_card_feeding(t)
    ]
    other_shuffles = {
        "count": len(other_shuffles_txns),
        "total": round(sum(abs(t["amount"]) for t in other_shuffles_txns), 2),
    }

    moves = {
        "card_feeding": card_feeding,
        "ritual_saving": ritual_saving,
        "deliberate_saving": deliberate_saving,
        "buffer_draws": buffer_draws,
        "other_shuffles": other_shuffles,
    }

    # ── Chapter 5: Keeping ────────────────────────────────────────────────────
    set_aside = round(
        sum(abs(t["amount"]) for t in type1) + sum(abs(t["amount"]) for t in type2), 2
    )
    drawn_back = round(sum(abs(t["amount"]) for t in withdrawals), 2)
    external_total = round(sum(abs(t["amount"]) for t in external_type1), 2)
    kept = round(set_aside - drawn_back, 2)

    keeping = {
        "set_aside": set_aside,
        "drawn_back": drawn_back,
        "external": external_total,
        "kept": kept,
    }

    # ── Chapter 6: Close (only when period has ended, or preview_close) ──────
    close = None
    needle_doc = None
    if period_end < today or preview_close:
        if period_end < today:
            # Normal path: read from needle_history or compute_needle (writes to DB)
            needle_id = f"{uid}:{period_end.isoformat()}"
            needle_doc = await needle_history_col.find_one({"_id": needle_id})
            if needle_doc is None:
                try:
                    needle_doc = await compute_needle(uid, period_start, period_end)
                except Exception as e:
                    log.warning("cycle_story: compute_needle failed: %s", e)
        else:
            # Preview path: compute as of today, do NOT write to DB
            from app.services.needle import _compute_needle_facts
            try:
                needle_doc = await _compute_needle_facts(uid, period_start, period_end)
            except Exception as e:
                log.warning("cycle_story preview: needle facts failed: %s", e)
                needle_doc = None
        if needle_doc:
            close = {
                "month_end_cash": round(float(needle_doc.get("month_end_cash", 0)), 2),
                "card_delta": round(float(needle_doc.get("card_delta", 0)), 2),
                "streak_weeks": needle_doc.get("streak_weeks"),
            }

    # ── Chapter 7: Self ───────────────────────────────────────────────────────
    portrait = await behaviour_portrait_col.find_one({"_id": uid})
    trait_list: list[dict] = []
    streak_weeks: int | None = None

    if portrait and portrait.get("status") == "ok":
        for tr in portrait.get("traits", []):
            trait_list.append({
                "id": tr.get("id"),
                "title": tr.get("title"),
                "choice": tr.get("choice"),
            })
            if tr.get("id") == "saving_habit":
                for ev in tr.get("evidence", []):
                    if "-week streak" in ev or "-week" in ev:
                        m = re.search(r"(\d+)-week", ev)
                        if m:
                            try:
                                streak_weeks = int(m.group(1))
                            except Exception:
                                pass

    fired = {
        "front_loader": week1_pct >= 40,
        "credit_switch": (switch_day is not None) and cards_material,
        "saving_streak_intact": (streak_weeks or 0) >= 4,
    }

    self_facts = {
        "traits": trait_list,
        "streak_weeks": streak_weeks,
        "fired": fired,
    }

    return {
        "status": "ok",
        "opening": opening,
        "cliff": cliff,
        "spending": spending_chapter,
        "cards": cards_chapter,
        "switch": switch if cards_material else None,
        "moves": moves,
        "keeping": keeping,
        "close": close,
        "self_facts": self_facts,
        "needle_lines": needle_doc.get("lines") if needle_doc else None,
    }


async def narrate_cycle_story(facts: dict, traits: list[dict], period: dict) -> dict:
    """Call the LLM to narrate the six story sections."""
    period_str = f"{period.get('start')} to {period.get('end')}"

    trait_summary = ""
    for tr in traits:
        choice = tr.get("choice") or "undecided"
        trait_summary += f"  - {tr.get('title', tr.get('id', ''))} (choice: {choice})\n"
    if not trait_summary:
        trait_summary = "  No traits recorded yet.\n"

    # Deterministic guard: always strip routing facts AND cards object — LLM never sees card facts
    llm_facts = copy.deepcopy(facts)
    llm_facts.pop("switch", None)
    llm_facts.pop("cards", None)
    llm_facts.get("moves", {}).pop("card_feeding", None)
    llm_facts.get("self_facts", {}).get("fired", {}).pop("credit_switch", None)

    system_prompt = (
        "You are Penny, the AI inside a personal money app. "
        "Write in British English. Be warm, plain, and calm. Second person ('you', 'your'). "
        "ZERO judgement, zero advice, zero moralising. "
        "Every number you mention MUST come directly from the facts JSON — never invent a figure. "
        "Traits marked 'keep' are deliberate choices the user is proud of — celebrate them, never question them. "
        "\n\n"
        "THE STORY IS THE USER'S SPENDING JOURNEY this pay period.\n"
        "OPENING: Money arriving — income landing, the starting position.\n"
        "MONTH: How the spending flowed — the total real spend (spending.total_spend), "
        "when it went (cliff week-one timing), and where it went (top categories).\n"
        "MOVES: The transfers and saving moves — deliberate savings and shuffles.\n"
        "ABSOLUTE BAN: The words 'card', 'cards', 'credit', 'plastic', 'payment methods', "
        "and 'borrowing' (and any euphemism for card spending) must NEVER appear anywhere "
        "in ANY section — not in OPENING, MONTH, MOVES, KEEPING, CLOSE, or SELF. "
        "Narrate only what is in the facts JSON you are given. Do not reference card activity.\n"
        "KEEPING: What was set aside versus drawn back.\n"
        "CLOSE: Where the period landed — cash position.\n"
        "SELF: The portrait — traits and streak celebrated.\n"
        "\n"
        "Output EXACTLY six labelled sections on separate lines, each starting with the label and colon:\n"
        "OPENING:\n"
        "MONTH:\n"
        "MOVES:\n"
        "KEEPING:\n"
        "CLOSE:\n"
        "SELF:\n"
        "Each section: 1-3 short sentences only. No bullet points. No extra headings."
    )

    if facts.get("partial_view"):
        system_prompt += (
            "\n\nPARTIAL VIEW: some of this user's accounts are not connected, so you only see "
            "part of their money. Never guess about what you cannot see. If income_in is 0, do NOT "
            "say they had no income — money may arrive in accounts outside this view; acknowledge "
            "the limited view plainly and calmly."
        )

    user_prompt = (
        f"Pay period: {period_str}\n\n"
        f"Facts JSON:\n{json.dumps(llm_facts, indent=2)}\n\n"
        f"User traits:\n{trait_summary}\n"
        "Write the six-section story now."
    )

    opening_data = facts.get("opening", {})
    is_partial = bool(facts.get("partial_view"))
    if is_partial and opening_data.get("income_in", 0) == 0:
        spending_data_temp = facts.get("spending", {})
        fallback_opening = (
            f"Only part of your money is visible here — this view saw "
            f"£{spending_data_temp.get('total_spend', 0):,.2f} of spending this period."
        )
    else:
        fallback_opening = (
            f"You started the period with £{opening_data.get('income_in', 0):,.2f} "
            f"landing across {opening_data.get('count', 0)} deposit(s)."
        )
    spending_data = facts.get("spending", {})
    cliff_data = facts.get("cliff") or {}
    if cliff_data:
        fallback_month = (
            f"You spent £{spending_data.get('total_spend', 0):,.2f} this period, "
            f"with week one accounting for {cliff_data.get('week1_pct', 0)}% of it."
        )
    else:
        fallback_month = (
            f"You spent £{spending_data.get('total_spend', 0):,.2f} this period."
        )
    moves_data = facts.get("moves", {})
    fallback_moves = (
        f"You made {moves_data.get('deliberate_saving', {}).get('count', 0)} deliberate saving transfer(s) "
        f"and {moves_data.get('other_shuffles', {}).get('count', 0)} other shuffle(s) this period."
    )
    keeping_data = facts.get("keeping", {})
    fallback_keeping = (
        f"You set aside £{keeping_data.get('set_aside', 0):,.2f} "
        f"and drew back £{keeping_data.get('drawn_back', 0):,.2f}, "
        f"keeping £{keeping_data.get('kept', 0):,.2f} net."
    )
    close_data = facts.get("close") or {}
    if close_data:
        fallback_close = (
            f"You closed the month with £{close_data.get('month_end_cash', 0):,.2f} in current accounts."
        )
    else:
        fallback_close = "The period is still open — closing figures will appear when it ends."

    self_data = facts.get("self_facts", {})
    trait_count = len(self_data.get("traits", []))
    fallback_self = (
        f"Your portrait shows {trait_count} trait(s). "
        f"Streak: {self_data.get('streak_weeks') or 'not tracked'} weeks."
    )

    source = "fallback"
    sections: dict[str, str] = {}

    if OPENROUTER_API_KEY:
        try:
            async with httpx.AsyncClient(timeout=30) as http:
                r = await http.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "HTTP-Referer": APP_URL,
                    },
                    json={
                        "model": "anthropic/claude-haiku-4-5",
                        "max_tokens": 600,
                        "temperature": 0.4,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt},
                        ],
                    },
                )
            data = r.json()
            raw_text = data["choices"][0]["message"]["content"].strip()

            # Parse with regex split on section labels
            parts = re.split(
                r"^(OPENING|MONTH|MOVES|KEEPING|CLOSE|SELF)\s*:",
                raw_text,
                flags=re.MULTILINE,
            )
            # parts = ["", "OPENING", " text...", "MONTH", " text...", ...]
            i = 1
            while i + 1 < len(parts):
                label = parts[i].strip()
                text = parts[i + 1].strip()
                sections[label.lower()] = text
                i += 2

        except Exception as e:
            log.warning("narrate_cycle_story: LLM call failed: %s", e)

    all_labels = {"opening", "month", "moves", "keeping", "close", "self"}
    if all_labels.issubset(sections.keys()):
        source = "llm"

    _card_pat = re.compile(r"\b(card|cards|credit|plastic)\b", re.IGNORECASE)
    _fallbacks = {
        "opening": fallback_opening,
        "month": fallback_month,
        "moves": fallback_moves,
        "keeping": fallback_keeping,
        "close": fallback_close,
        "self": fallback_self,
    }
    sanitiser_replaced: list[str] = []

    # Build resolved sections, sanitising any stray card language from LLM output
    resolved: dict[str, str] = {}
    for label in ("opening", "month", "moves", "keeping", "close", "self"):
        text = sections.get(label, _fallbacks[label])
        if _card_pat.search(text):
            log.warning("narrate_cycle_story: sanitiser replaced section '%s' — card language found", label)
            sanitiser_replaced.append(label)
            text = _fallbacks[label]
        resolved[label] = text

    # Deterministic card splice: append EXACTLY ONE sentence to the month section when material
    cards_data = facts.get("cards") or {}
    if cards_data.get("material"):
        _delta = cards_data.get("delta", 0)
        _direction = "higher" if _delta > 0 else "lower"
        _card_sentence = (
            f" £{cards_data.get('new_spend', 0):,.2f} of that spending rode on your cards, "
            f"and the balances closed £{abs(_delta):,.2f} {_direction}."
        )
        resolved["month"] = resolved["month"].rstrip() + _card_sentence

    return {
        "opening": resolved["opening"],
        "month": resolved["month"],
        "moves": resolved["moves"],
        "keeping": resolved["keeping"],
        "close": resolved["close"],
        "self": resolved["self"],
        "source": source,
        "sanitiser_replaced": sanitiser_replaced,
    }


async def get_cycle_story(uid: str, which: str = "current", preview_close: bool = False) -> dict:
    """Cache-aware entry point. Returns full story dict."""
    today = date.today()

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})

    period_start, period_end = get_pay_period_for_date(today, pay_cfg)
    if which == "last":
        period_start, period_end = prev_pay_period(period_start, pay_cfg)

    closed = period_end < today
    days_elapsed = (min(today, period_end) - period_start).days + 1
    days_to_payday = max(0, (period_end + timedelta(days=1) - today).days)

    period_meta = {
        "start": period_start.isoformat(),
        "end": period_end.isoformat(),
        "closed": closed,
        "days_elapsed": days_elapsed,
        "days_to_payday": days_to_payday,
    }

    # ── Preview path ──────────────────────────────────────────────────────────
    if preview_close and not closed:
        preview_key = f"{uid}:{period_end.isoformat()}:preview"
        cached_preview = await cycle_story_col.find_one({"_id": preview_key})
        if cached_preview:
            computed_at_str = cached_preview.get("computed_at")
            if computed_at_str:
                try:
                    computed_at = datetime.fromisoformat(computed_at_str.replace("Z", "+00:00"))
                    if computed_at.tzinfo is None:
                        computed_at = computed_at.replace(tzinfo=timezone.utc)
                    age = datetime.now(timezone.utc) - computed_at
                    if age.total_seconds() < 3600:  # 1h TTL for preview
                        cached_preview.pop("_id", None)
                        return cached_preview
                except Exception:
                    pass

        # Compute fresh preview
        facts = await compute_cycle_story(uid, period_start, period_end, preview_close=True)
        if facts.get("status") == "no_data":
            return {"status": "no_data", "period": period_meta}

        traits = facts.get("self_facts", {}).get("traits", [])
        narrative = await narrate_cycle_story(facts, traits, period_meta)

        now_iso = datetime.now(timezone.utc).isoformat()

        # Build tomorrow strings
        needle_lines = facts.get("needle_lines") or {}
        tomorrow = _build_tomorrow_strings(needle_lines) if needle_lines else None

        result = {
            "status": "ok",
            "period": period_meta,
            "chapters": {
                "opening": facts.get("opening"),
                "cliff": facts.get("cliff"),
                "spending": facts.get("spending"),
                "cards": facts.get("cards"),
                "switch": facts.get("switch"),
                "moves": facts.get("moves"),
                "keeping": facts.get("keeping"),
                "close": facts.get("close"),
                "self_facts": facts.get("self_facts"),
            },
            "narrative": narrative,
            "cards_link": bool((facts.get("cards") or {}).get("material")),
            "tomorrow": tomorrow,
            "is_preview": True,
            "computed_at": now_iso,
        }

        # Cache with preview key (never :final)
        preview_doc = {"_id": preview_key, **result}
        await cycle_story_col.update_one(
            {"_id": preview_key},
            {"$set": {k: v for k, v in preview_doc.items() if k != "_id"}},
            upsert=True,
        )
        return result

    # ── Normal path ───────────────────────────────────────────────────────────
    cache_key = f"{uid}:{period_end.isoformat()}:{'final' if closed else 'live'}"

    # Cache lookup
    cached = await cycle_story_col.find_one({"_id": cache_key})
    if cached:
        if closed:
            # Closed period: serve from cache indefinitely
            cached.pop("_id", None)
            return cached
        else:
            # Live period: return cached if computed_at within 24h
            computed_at_str = cached.get("computed_at")
            if computed_at_str:
                try:
                    computed_at = datetime.fromisoformat(computed_at_str.replace("Z", "+00:00"))
                    if computed_at.tzinfo is None:
                        computed_at = computed_at.replace(tzinfo=timezone.utc)
                    age = datetime.now(timezone.utc) - computed_at
                    if age.total_seconds() < 86400:
                        cached.pop("_id", None)
                        return cached
                except Exception:
                    pass

    # Compute fresh
    facts = await compute_cycle_story(uid, period_start, period_end)

    if facts.get("status") == "no_data":
        return {"status": "no_data", "period": period_meta}

    # ── Early-days gate (current period only) ─────────────────────────────────
    spending_total = (facts.get("spending") or {}).get("total_spend", 0)
    is_early = (not closed) and (days_elapsed <= 3 or spending_total < 50)
    if is_early:
        opening_data = facts.get("opening", {})
        income_in = opening_data.get("income_in", 0)
        count = opening_data.get("count", 0)
        if income_in > 0:
            opening_narrative = (
                f"£{income_in:,.2f} landed across {count} deposit(s) — "
                f"your new cycle has started."
            )
        else:
            opening_narrative = "Your new cycle has started."
        early_result = {
            "status": "ok",
            "early_days": True,
            "period": period_meta,
            "chapters": {"opening": facts.get("opening")},
            "narrative": {"opening": opening_narrative},
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }
        # Cache as live (24h) — cheap and avoids repeated LLM calls
        doc = {"_id": cache_key, **early_result}
        await cycle_story_col.update_one(
            {"_id": cache_key},
            {"$set": {k: v for k, v in doc.items() if k != "_id"}},
            upsert=True,
        )
        return early_result

    traits = facts.get("self_facts", {}).get("traits", [])
    narrative = await narrate_cycle_story(facts, traits, period_meta)

    now_iso = datetime.now(timezone.utc).isoformat()
    result = {
        "status": "ok",
        "period": period_meta,
        "chapters": {
            "opening": facts.get("opening"),
            "cliff": facts.get("cliff"),
            "spending": facts.get("spending"),
            "cards": facts.get("cards"),
            "switch": facts.get("switch"),
            "moves": facts.get("moves"),
            "keeping": facts.get("keeping"),
            "close": facts.get("close"),
            "self_facts": facts.get("self_facts"),
        },
        "narrative": narrative,
        "cards_link": bool((facts.get("cards") or {}).get("material")),
        "computed_at": now_iso,
    }

    # Cache the result
    doc = {"_id": cache_key, **result}
    await cycle_story_col.update_one(
        {"_id": cache_key},
        {"$set": {k: v for k, v in doc.items() if k != "_id"}},
        upsert=True,
    )

    return result
