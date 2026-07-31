"""Behavioural signature engine for The Mirror.

All traits are computed generically from any user's transactions.
Zero hardcoding of specific users, accounts, merchants, or amounts.
"""
import re
import json
import asyncio
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Any

import httpx

from app.core.config import OPENROUTER_API_KEY, APP_URL
from app.db.collections import transactions_col, accounts_col, behaviour_portrait_col

# Categories excluded from "real spend" computations
_NON_SPEND_CATEGORIES = {
    "Transfer", "Savings", "Debt", "Income", "Internal Transfer",
    "Loan Payment", "Credit Card Payment",
}

# Discretionary categories eligible for "signature pleasure" trait
_DISCRETIONARY = {
    "Eating Out", "Entertainment", "Shopping", "Hobbies", "Travel",
    "Health & Beauty", "Sports & Fitness", "Subscriptions",
}

# BNPL merchants (case-insensitive substring match)
_BNPL_KEYWORDS = {"klarna", "clearpay", "zilch", "laybuy", "payl8r"}

# Gambling indicators
_GAMBLING_CATEGORIES = {"Gambling"}
# Word-boundary regex: 888 only matches as the brand compounds 888sport/888casino/888poker,
# never as bare digits embedded in account/reference numbers.
_GAMBLING_RE = re.compile(
    r"\b(bet365|betfair|ladbrokes|paddy\s*power|coral|william\s*hill|sky\s*bet"
    r"|betway|unibet|888(?:sport|casino|poker))\b",
    re.IGNORECASE,
)

# Returned payment / fee keywords
_RETURNED_KEYWORDS = {"returned", "unpaid", "bounced", "dishonoured", "dishonoure",
                      "late fee", "overdraft fee", "rejected payment"}


async def _llm_narrate(trait_id: str, title: str, evidence: list[str], fallback: str) -> str:
    """Generate a warm one-sentence narrative via OpenRouter/Haiku.
    Falls back to `fallback` on any error."""
    if not OPENROUTER_API_KEY:
        return fallback
    evidence_text = "; ".join(evidence)
    prompt = (
        f"You are writing a single warm, plain-English sentence for a money app's 'behavioural portrait' card. "
        f"The trait is: '{title}'. Evidence: {evidence_text}. "
        "Rules: exactly one sentence, max 25 words, no invented numbers, no judgement, descriptive and calm. "
        "Do not include quotes. Output only the sentence."
    )
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            r = await http.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "HTTP-Referer": APP_URL,
                },
                json={
                    "model": "anthropic/claude-haiku-4-5",
                    "max_tokens": 60,
                    "temperature": 0.3,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
        data = r.json()
        text = data["choices"][0]["message"]["content"].strip()
        # Strip any accidental quotes
        text = text.strip('"\'')
        if text:
            return text
    except Exception:
        pass
    return fallback


def savings_account_ids(raw_accounts: list) -> set:
    """Return set of account_ids where subtype is a savings variant."""
    return {
        str(a.get("account_id") or a.get("id") or a.get("_id"))
        for a in raw_accounts
        if (a.get("account_subtype") or a.get("subtype") or "").lower() in
           ("savings", "isa", "cash isa", "stocks isa")
    }


def _date_to_ord(date_str: str) -> int:
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").toordinal()
    except Exception:
        return 0


def _t1_is_external(t1: dict, all_credits: list) -> bool:
    t1_ord = _date_to_ord(t1["date"])
    t1_amt = abs(t1["amount"])
    for t2 in all_credits:
        if abs(abs(t2["amount"]) - t1_amt) <= 0.02 and abs(_date_to_ord(t2["date"]) - t1_ord) <= 2:
            return False
    return True


def classify_saving_flow(txns: list, saving_acc_ids: set) -> dict:
    """Classify transactions into saving-flow buckets.

    Returns:
        type1             — Savings-category debits on non-savings accounts
        type2             — Credits on savings accounts not matched to type1
        withdrawals       — Debits on savings accounts
        external_type1    — type1 debits with no matching savings-account credit
        all_savings_credits — All credits received by savings accounts (pre-dedupe)
    """
    # Type 1: Savings-category debits on current/non-savings accounts
    type1 = [
        t for t in txns
        if t["category"] == "Savings"
        and t["is_debit"]
        and t["account_id"] not in saving_acc_ids
    ]

    all_savings_credits: list = []
    type2: list = []
    for t in txns:
        if t["account_id"] not in saving_acc_ids:
            continue
        if t["is_debit"]:
            continue
        all_savings_credits.append(t)
        t_ord = _date_to_ord(t["date"])
        t_amt = abs(t["amount"])
        matched = any(
            abs(abs(t1["amount"]) - t_amt) <= 0.02
            and abs(_date_to_ord(t1["date"]) - t_ord) <= 2
            for t1 in type1
        )
        if not matched:
            type2.append(t)

    withdrawals = [
        t for t in txns
        if t["account_id"] in saving_acc_ids and t["is_debit"]
    ]

    external_t1 = [t for t in type1 if _t1_is_external(t, all_savings_credits)]

    return {
        "type1": type1,
        "type2": type2,
        "withdrawals": withdrawals,
        "external_type1": external_t1,
        "all_savings_credits": all_savings_credits,
    }


async def compute_portrait(uid: str) -> dict:
    """
    Compute the behavioural portrait for a user over ~180 days.
    Returns the portrait dict (to be cached by the caller).
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=180)
    cutoff_naive = cutoff.replace(tzinfo=None)

    # Fetch all transactions in window (all sources — TrueLayer only for now,
    # structured generically so adding Finexer/Mono collections is trivial)
    # date field may be stored as datetime object or YYYY-MM-DD string
    raw_txns = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff_naive}}
    ).to_list(None)

    if not raw_txns:
        # Try string-based fallback (some collections store date as string)
        cutoff_str = cutoff.strftime("%Y-%m-%d")
        raw_txns = await transactions_col.find(
            {"user_id": uid, "date": {"$gte": cutoff_str}}
        ).to_list(None)

    if not raw_txns:
        return {"status": "insufficient_data"}

    # Normalise date field to YYYY-MM-DD string for all subsequent processing
    def _to_date_str(val) -> str:
        if isinstance(val, datetime):
            return val.strftime("%Y-%m-%d")
        if isinstance(val, str):
            return val[:10]
        return ""

    # Determine actual date range
    dates = [_to_date_str(t["date"]) for t in raw_txns if t.get("date")]
    dates = [d for d in dates if d]
    if not dates:
        return {"status": "insufficient_data"}

    min_date = min(dates)
    max_date = max(dates)

    # Need at least 60 days of history
    try:
        span_days = (
            datetime.strptime(max_date, "%Y-%m-%d") -
            datetime.strptime(min_date, "%Y-%m-%d")
        ).days
    except Exception:
        return {"status": "insufficient_data"}

    if span_days < 60:
        return {"status": "insufficient_data"}

    window_days = span_days

    # Fetch accounts for subtype info (credit card detection)
    raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    credit_account_ids = {
        str(a.get("account_id") or a.get("id") or a.get("_id"))
        for a in raw_accounts
        if (a.get("account_subtype") or a.get("subtype") or "").upper() in
           ("CREDIT_CARD", "CREDIT CARD", "CREDITCARD")
        or (a.get("account_type") or a.get("type") or "").lower() in
           ("credit", "credit_card")
    }

    # Normalise transactions
    txns = []
    for t in raw_txns:
        amount = float(t.get("amount", 0) or 0)
        cat = t.get("custom_category") or t.get("category") or "Other"
        desc = (t.get("description") or t.get("name") or "").lower()
        date_str = _to_date_str(t.get("date", ""))
        acc_id = str(t.get("account_id") or "")
        txns.append({
            "amount": amount,
            "category": cat,
            "description": desc,
            "date": date_str,
            "account_id": acc_id,
            "is_debit": (t.get("transaction_type") == "debit"),
            "is_credit_card": acc_id in credit_account_ids,
        })

    traits = []

    # ── TRAIT 1: Front-loading ────────────────────────────────────────────────
    spend_txns = [t for t in txns if t["is_debit"] and t["category"] not in _NON_SPEND_CATEGORIES]
    early_spend = 0.0
    late_spend = 0.0
    day_totals: dict[int, float] = defaultdict(float)

    for t in spend_txns:
        try:
            day = int(t["date"].split("-")[2])
        except (IndexError, ValueError):
            continue
        abs_amt = abs(t["amount"])
        if day <= 7:
            early_spend += abs_amt
        else:
            late_spend += abs_amt
        day_totals[day] += abs_amt

    total_spend = early_spend + late_spend
    if total_spend >= 500 and len(spend_txns) >= 20:
        early_pct = early_spend / total_spend * 100
        if early_pct >= 40:
            evidence = [
                f"{early_pct:.0f}% of your spending lands in the first 7 days of the month",
                f"£{early_spend / max(1, span_days / 30):.0f} average early-month spend",
            ]
            fallback = f"You tend to spend heavily in the first week of each month, with {early_pct:.0f}% of monthly outgoings landing there."
            narrative = await _llm_narrate("front_loader", "The Front-Loader", evidence, fallback)
            traits.append({
                "id": "front_loader",
                "title": "The Front-Loader",
                "narrative": narrative,
                "evidence": evidence,
                "kind": "structure",
                "choice": None,
            })

    # ── TRAIT 2: Credit switch mid-month ──────────────────────────────────────
    if credit_account_ids:
        early_cc = sum(abs(t["amount"]) for t in spend_txns if t["is_credit_card"] and
                       _day_of(t["date"]) is not None and _day_of(t["date"]) <= 7)
        early_total = sum(abs(t["amount"]) for t in spend_txns if
                         _day_of(t["date"]) is not None and _day_of(t["date"]) <= 7)
        late_cc = sum(abs(t["amount"]) for t in spend_txns if t["is_credit_card"] and
                      _day_of(t["date"]) is not None and _day_of(t["date"]) > 7)
        late_total = sum(abs(t["amount"]) for t in spend_txns if
                        _day_of(t["date"]) is not None and _day_of(t["date"]) > 7)

        if early_total >= 100 and late_total >= 100:
            early_cc_pct = early_cc / early_total * 100
            late_cc_pct = late_cc / late_total * 100
            if late_cc_pct >= 35 and (late_cc_pct - early_cc_pct) >= 15:
                evidence = [
                    f"Credit card share: {early_cc_pct:.0f}% in week 1, {late_cc_pct:.0f}% after week 1",
                    "Plastic use increases as the month progresses",
                ]
                fallback = "Your credit card use ramps up through the month as cash flow tightens after payday."
                narrative = await _llm_narrate("credit_switch", "Runs on Plastic Mid-Month", evidence, fallback)
                traits.append({
                    "id": "credit_switch",
                    "title": "Runs on Plastic Mid-Month",
                    "narrative": narrative,
                    "evidence": evidence,
                    "kind": "structure",
                    "choice": None,
                })

    # ── TRAIT 3: Saving habit ─────────────────────────────────────────────────
    #
    # ONE-MOVEMENT-ONE-COUNT RULE
    # A transfer to savings produces two transaction records: a debit on the
    # source (current) account and a credit on the destination (savings) account.
    # We count each real saving movement exactly once:
    #
    #   Type 1 — Debits categorised "Savings" on NON-savings accounts (current /
    #             credit accounts).  These are the originating leg of the transfer.
    #
    #   Type 2 — CREDITS on savings-subtype accounts.  These are the receiving
    #             leg.  We include a type-2 credit only if NO type-1 debit already
    #             accounts for it (amount within £0.02, date within 2 calendar
    #             days).  This catches direct deposits that have no matching
    #             Savings-category debit on a current account.
    #
    # We never count DEBITS on savings accounts — those are withdrawals, the
    # opposite of saving.

    saving_acc_ids = savings_account_ids(raw_accounts)
    flow = classify_saving_flow(txns, saving_acc_ids)
    saving_type1 = flow["type1"]
    saving_type2 = flow["type2"]
    saving_withdrawals = flow["withdrawals"]
    all_savings_credits = flow["all_savings_credits"]
    external_type1 = flow["external_type1"]

    outflow = round(sum(abs(t["amount"]) for t in saving_withdrawals), 2)
    saving_list = saving_type1 + saving_type2
    external_setaside = round(sum(abs(t["amount"]) for t in external_type1), 2)

    if saving_list:
        # Group by ISO week
        weeks: dict[str, list] = defaultdict(list)
        for t in saving_list:
            try:
                d = datetime.strptime(t["date"], "%Y-%m-%d")
                week_key = d.strftime("%Y-W%W")
                weeks[week_key].append(t)
            except Exception:
                continue

        weeks_with_saving = len([w for w in weeks.values() if w])
        total_weeks = max(1, span_days // 7)
        saving_freq = weeks_with_saving / total_weeks

        # Streak: consecutive weeks
        sorted_week_keys = sorted(weeks.keys())
        max_streak = 1
        cur_streak = 1
        for i in range(1, len(sorted_week_keys)):
            prev = datetime.strptime(sorted_week_keys[i-1] + "-1", "%Y-W%W-%w")
            curr = datetime.strptime(sorted_week_keys[i] + "-1", "%Y-W%W-%w")
            if (curr - prev).days <= 7:
                cur_streak += 1
                max_streak = max(max_streak, cur_streak)
            else:
                cur_streak = 1

        saving_total = sum(abs(t["amount"]) for t in saving_list)
        kept = round(saving_total - outflow, 2)

        if max_streak >= 8 and saving_freq >= 0.8:
            title = "The Daily Saver"
            # Build evidence lines — omit a line when value is 0 or data-absent
            ev_line1 = f"{len(saving_list)} deposits over {span_days} days · {max_streak}-week streak"
            if outflow > 0:
                ev_line2 = f"£{saving_total:.0f} set aside · £{outflow:.0f} drawn back when the month needed it"
            else:
                ev_line2 = f"£{saving_total:.0f} set aside"
            evidence = [ev_line1, ev_line2]
            if external_setaside > 0:
                evidence.append(f"£{external_setaside:.0f} of it went to investments or external destinations")
            fallback = "You set money aside almost every day — some builds up, some works as a buffer you draw on through the month."
        elif saving_freq >= 0.5 or weeks_with_saving >= 8:
            title = "Regular Saver"
            ev_line1 = f"{len(saving_list)} deposits over {span_days} days · {max_streak}-week streak"
            if outflow > 0:
                ev_line2 = f"£{saving_total:.0f} set aside · £{outflow:.0f} drawn back when the month needed it"
            else:
                ev_line2 = f"£{saving_total:.0f} set aside"
            evidence = [ev_line1, ev_line2]
            if external_setaside > 0:
                evidence.append(f"£{external_setaside:.0f} of it went to investments or external destinations")
            fallback = f"You save regularly — across {weeks_with_saving} of the {total_weeks} weeks tracked."
        else:
            title = None

        if title:
            narrative = await _llm_narrate("saving_habit", title, evidence, fallback)
            traits.append({
                "id": "saving_habit",
                "title": title,
                "narrative": narrative,
                "evidence": evidence,
                "kind": "habit",
                "choice": None,
            })

    # ── TRAIT 4: Orchestration ────────────────────────────────────────────────
    transfer_txns = [t for t in txns if t["category"] in ("Transfer", "Internal Transfer")]
    account_transfer_counts: dict[str, int] = defaultdict(int)
    for t in transfer_txns:
        account_transfer_counts[t["account_id"]] += 1

    active_transfer_accounts = [acc for acc, cnt in account_transfer_counts.items() if cnt >= 3]
    if len(active_transfer_accounts) >= 3:
        transfer_volume = sum(abs(t["amount"]) for t in transfer_txns)
        monthly_transfer = transfer_volume / max(1, span_days / 30)
        evidence = [
            f"{len(active_transfer_accounts)} accounts actively used for transfers",
            f"£{monthly_transfer:.0f} average monthly transfer volume",
        ]
        fallback = f"You actively orchestrate money across {len(active_transfer_accounts)} accounts, moving funds with clear intent."
        narrative = await _llm_narrate("orchestrator", "The Orchestrator", evidence, fallback)
        traits.append({
            "id": "orchestrator",
            "title": "The Orchestrator",
            "narrative": narrative,
            "evidence": evidence,
            "kind": "structure",
            "choice": None,
        })

    # ── TRAIT 5: Signature pleasure ───────────────────────────────────────────
    disc_counts: dict[str, int] = defaultdict(int)
    disc_totals: dict[str, float] = defaultdict(float)
    for t in txns:
        if t["is_debit"] and t["category"] in _DISCRETIONARY:
            disc_counts[t["category"]] += 1
            disc_totals[t["category"]] += abs(t["amount"])

    if disc_counts:
        top_cat = max(disc_counts, key=lambda c: disc_counts[c])
        if disc_counts[top_cat] >= 5:
            monthly_count = disc_counts[top_cat] / max(1, span_days / 30)
            evidence = [
                f"{disc_counts[top_cat]} {top_cat.lower()} transactions in the window",
                f"£{disc_totals[top_cat]:.0f} total · ~{monthly_count:.1f}× per month",
            ]
            fallback = f"{top_cat} is clearly something you love — it's your most frequent discretionary category."
            narrative = await _llm_narrate("signature_pleasure", f"Your Signature: {top_cat}", evidence, fallback)
            traits.append({
                "id": "signature_pleasure",
                "title": f"Your Signature: {top_cat}",
                "narrative": narrative,
                "evidence": evidence,
                "kind": "pleasure",
                "choice": None,
            })

    # ── TRAIT 6: Money hygiene ────────────────────────────────────────────────
    # Cash withdrawals
    cash_txns = [t for t in txns if t["is_debit"] and (
        t["category"] in ("Cash", "ATM") or
        (any(kw in t["description"] for kw in ("cash", "atm", "cashpoint", "withdraw"))
         and "cashback" not in t["description"])
    )]
    cash_total = sum(abs(t["amount"]) for t in cash_txns)
    cash_pct = cash_total / max(1, total_spend) * 100

    # BNPL
    bnpl_txns = [t for t in txns if any(kw in t["description"] for kw in _BNPL_KEYWORDS)]

    # Gambling — use word-boundary regex; bare "888" in account refs is not a match
    gambling_txns = [t for t in txns if
                     t["category"] in _GAMBLING_CATEGORIES or
                     _GAMBLING_RE.search(t["description"])]

    # Returned payments / fees
    returned_txns = [t for t in txns if any(kw in t["description"] for kw in _RETURNED_KEYWORDS)]

    hygiene_issues = []
    hygiene_positives = []

    if cash_pct >= 10:
        hygiene_issues.append(f"{cash_pct:.0f}% of spending is cash or ATM withdrawals")
    else:
        hygiene_positives.append("Mostly digital — minimal cash use")

    if bnpl_txns:
        hygiene_issues.append(f"{len(bnpl_txns)} buy-now-pay-later transaction(s) detected")
    if gambling_txns:
        hygiene_issues.append(f"{len(gambling_txns)} gambling transaction(s) in the window")
    if len(returned_txns) >= 2:
        hygiene_issues.append(f"{len(returned_txns)} returned payment or late fee(s)")

    if not hygiene_issues:
        evidence = hygiene_positives + ["No BNPL, gambling, or returned payments detected"]
        fallback = "Your financial hygiene is clean — no missed payments, BNPL, or cash dependency."
        title = "Clean Record"
        narrative = await _llm_narrate("hygiene", title, evidence, fallback)
        traits.append({
            "id": "hygiene",
            "title": title,
            "narrative": narrative,
            "evidence": evidence,
            "kind": "hygiene",
            "choice": None,
        })
    elif len(spend_txns) >= 10:
        # Only surface hygiene issues if there's enough data to be confident
        evidence = hygiene_issues
        fallback = "A few patterns worth keeping an eye on — described above, without judgement."
        title = "A Few Things to Note"
        narrative = await _llm_narrate("hygiene", title, evidence, fallback)
        traits.append({
            "id": "hygiene",
            "title": title,
            "narrative": narrative,
            "evidence": evidence,
            "kind": "hygiene",
            "choice": None,
        })

    return {
        "status": "ok",
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "window_days": window_days,
        "traits": traits,
    }


def _day_of(date_str: str) -> int | None:
    """Return the day-of-month from a YYYY-MM-DD string, or None."""
    try:
        return int(date_str.split("-")[2])
    except (IndexError, ValueError, AttributeError):
        return None
