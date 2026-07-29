"""Companion spine — rhythm-aware today-engine.

Computes up to 3 items (moves first) for a user's home screen.
Zero LLM calls — all copy is deterministic from live data.
Zero hardcodes — computed generically for any user.
"""
import logging
import math
from datetime import date, datetime, timedelta
from typing import Any

from app.db.collections import (
    accounts_col,
    yapily_accounts_col,
    cashflow_cache_col,
    preferences_col,
    behaviour_portrait_col,
    companion_items_col,
    needle_history_col,
)

log = logging.getLogger(__name__)
from app.routers.analytics import _build_cashflow_response


_WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _weekday_name(d: date) -> str:
    return _WEEKDAYS[d.weekday()]


def _ceil5(amount: float) -> int:
    """Round up to nearest £5."""
    return math.ceil(amount / 5) * 5


async def _live_balance(account_id: str) -> float | None:
    """Fetch current balance for a single account across all account collections."""
    from bson import ObjectId

    def _try_oid(v: str):
        try:
            return ObjectId(v)
        except Exception:
            return v

    oid = _try_oid(account_id)
    for col in (accounts_col, yapily_accounts_col):
        doc = await col.find_one(
            {"_id": oid},
            {"balance": 1, "current_balance": 1, "available_balance": 1},
        )
        if doc:
            bal = doc.get("balance") or doc.get("current_balance") or doc.get("available_balance") or 0.0
            return float(bal)
    return None


async def compute_today_items(uid: str) -> list[dict]:
    """Compute companion items for `uid`. Cap at 3, moves first."""

    # ── 1. Load cashflow cache ──────────────────────────────────────────────
    cached = await cashflow_cache_col.find_one({"_id": uid})
    if not cached:
        return []

    resp = await _build_cashflow_response(cached, uid=uid)

    # ── 2. Determine pay window ─────────────────────────────────────────────
    from app.services.pay_period import _next_payday as _calc_next_payday
    from app.services.income import get_confirmed_payday as _get_confirmed_payday

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today_d = date.today()
    confirmed_result = _get_confirmed_payday(prefs, today_d)
    if confirmed_result:
        next_pay, _ = confirmed_result
    else:
        next_pay = _calc_next_payday(today_d, pay_cfg)
    days_to_pay = (next_pay - today_d).days
    window_end = next_pay  # exclusive upper bound (bills with days_away < days_to_pay)

    window_bills = [b for b in resp["upcoming_bills"] if b["days_away"] < days_to_pay]
    window_income = [i for i in resp["upcoming_income"] if i["days_away"] < days_to_pay]

    # Skip bills with no balance data (credit cards / unknown accounts)
    assessable_bills = [
        b for b in window_bills
        if b.get("account_balance") is not None and b["account_balance"] >= 0
    ]

    # ── 3. Seed live balances ───────────────────────────────────────────────
    acct_ids = list({b["account_id"] for b in assessable_bills if b.get("account_id")})
    from bson import ObjectId

    def _try_oid(v: str):
        try:
            return ObjectId(v)
        except Exception:
            return v

    live_balances: dict[str, float] = {}
    if acct_ids:
        oid_ids = [_try_oid(a) for a in acct_ids]
        for col in (accounts_col, yapily_accounts_col):
            async for acc in col.find(
                {"_id": {"$in": oid_ids}},
                {"balance": 1, "current_balance": 1, "available_balance": 1, "name": 1, "subtype": 1, "account_subtype": 1},
            ):
                bal = acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0.0
                live_balances[str(acc["_id"])] = float(bal)

    # ── 4. Running-balance simulation (same logic as at_risk_count) ─────────
    running: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in running:
            running[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    events: list[tuple[int, str, float, bool, dict]] = []
    for b in assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b))
    for i in window_income:
        for acct in list(running.keys()):
            events.append((i["days_away"], acct, float(i["amount"]), True, i))

    events.sort(key=lambda e: (e[0], 0 if e[3] else 1))

    # Track minimum running balance per account
    min_running: dict[str, float] = {k: v for k, v in running.items()}
    # Track the first bill that caused a shortfall per account
    shortfall_bill: dict[str, dict] = {}
    processed_income: set[tuple[int, str]] = set()

    for days_away, acct, amount, is_income, item in events:
        if is_income:
            key = (days_away, acct)
            if key not in processed_income:
                running[acct] = running.get(acct, 0.0) + amount
                processed_income.add(key)
        else:
            bal = running.get(acct, 0.0)
            if bal >= amount:
                running[acct] = bal - amount
                min_running[acct] = min(min_running.get(acct, bal - amount), bal - amount)
            else:
                # Bill bounces — record minimum (negative) and first-bounce bill
                min_running[acct] = min(min_running.get(acct, bal - amount), bal - amount)
                if acct not in shortfall_bill:
                    shortfall_bill[acct] = item

    # ── 5. Load ALL current-accounts for source selection ──────────────────
    # We need the full account details (name, subtype, balance)
    all_uk_accounts: list[dict] = []
    async for acc in accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "subtype": 1, "account_subtype": 1, "type": 1}):
        acc["_str_id"] = str(acc["_id"])
        all_uk_accounts.append(acc)
    async for acc in yapily_accounts_col.find({"user_id": uid}, {"name": 1, "balance": 1, "subtype": 1, "account_subtype": 1, "type": 1}):
        acc["_str_id"] = str(acc["_id"])
        all_uk_accounts.append(acc)

    def _is_savings(acc: dict) -> bool:
        st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
        return "SAVING" in st or "ISA" in st

    def _is_current(acc: dict) -> bool:
        st = (acc.get("account_subtype") or acc.get("subtype") or "").upper()
        t = (acc.get("type") or "").upper()
        return "TRANSACTION" in st or "CURRENT" in st or t == "BANK"

    # Compute per-account total upcoming bills in window (for source viability)
    acct_bills_total: dict[str, float] = {}
    for b in assessable_bills:
        a = b["account_id"] or "__unknown__"
        acct_bills_total[a] = acct_bills_total.get(a, 0.0) + float(b["amount"])

    # ── 6. Build MOVE items ─────────────────────────────────────────────────
    items: list[dict] = []
    dismissed = await _get_dismissed(uid)

    for dest_acct, min_bal in min_running.items():
        if min_bal >= 0:
            continue  # not short
        if dest_acct == "__unknown__":
            continue

        shortfall = abs(min_bal)
        amount_needed = _ceil5(shortfall) + 10  # round up to £5 + £10 margin

        # Find bill details
        bill = shortfall_bill.get(dest_acct)
        if not bill:
            continue

        bill_name = bill.get("name", "bill")
        bill_amount = int(round(float(bill.get("amount", 0))))
        bill_date = date.fromisoformat(bill["expected_date"])
        bill_weekday = _weekday_name(bill_date)

        # Account name lookup
        dest_name = bill.get("account_name") or dest_acct
        for acc in all_uk_accounts:
            if acc["_str_id"] == dest_acct:
                dest_name = acc.get("name", dest_name)
                break

        item_id = f"move:{dest_acct}:{window_end.isoformat()}"
        if item_id in dismissed:
            continue

        # ── Auto-verification: re-check if already "done" ──────────────────
        existing = await companion_items_col.find_one({"_id": item_id, "uid": uid})
        if existing and existing.get("status") == "done":
            # Still done — skip (celebration already emitted)
            continue

        # Check if NEWLY done (destination no longer short)
        # This is caught above since min_bal >= 0 skips — we only reach here when still short.

        # ── Source selection ────────────────────────────────────────────────
        source_name: str | None = None
        source_id: str | None = None

        # (a) Another CURRENT account with enough headroom
        for acc in all_uk_accounts:
            sid = acc["_str_id"]
            if sid == dest_acct:
                continue
            if not _is_current(acc):
                continue
            acc_bal = live_balances.get(sid, float(acc.get("balance") or 0))
            own_bills = acct_bills_total.get(sid, 0.0)
            headroom = acc_bal - own_bills
            if headroom >= amount_needed + 10:
                source_name = acc.get("name", sid)
                source_id = sid
                break

        # (b) Savings account
        if not source_name:
            for acc in all_uk_accounts:
                sid = acc["_str_id"]
                if sid == dest_acct:
                    continue
                if not _is_savings(acc):
                    continue
                acc_bal = live_balances.get(sid, float(acc.get("balance") or 0))
                if acc_bal >= amount_needed:
                    source_name = acc.get("name", sid)
                    source_id = sid
                    break

        if source_name:
            headline = f"Move £{amount_needed} to {dest_name}"
            body = (
                f"Your £{bill_amount} {bill_name} lands {bill_weekday} from {dest_name}. "
                f"It's £{int(round(shortfall))} short. "
                f"Moving £{amount_needed} from {source_name} covers it."
            )
            item_doc = {
                "_id": item_id,
                "uid": uid,
                "type": "move",
                "status": "active",
                "headline": headline,
                "body": body,
                "action": {"label": "View accounts", "route": "/accounts"},
                "estimated": False,
                "created_at": datetime.utcnow(),
                # Facts stored for verification
                "_dest_acct": dest_acct,
                "_source_acct": source_id,
                "_bill_name": bill_name,
                "_bill_amount": bill_amount,
                "_window_end": window_end.isoformat(),
            }
            await companion_items_col.update_one(
                {"_id": item_id, "uid": uid},
                {"$set": {k: v for k, v in item_doc.items() if k != "_id"}},
                upsert=True,
            )
            items.append({
                "id": item_id,
                "type": "move",
                "headline": headline,
                "body": body,
                "action": {"label": "View accounts", "route": "/accounts"},
                "estimated": False,
            })
        else:
            # No easy cover — emit calm "no easy cover" variant
            headline = f"£{int(round(shortfall))} gap before {dest_name} payday"
            body = (
                f"Your £{bill_amount} {bill_name} lands {bill_weekday}, "
                f"but {dest_name} is £{int(round(shortfall))} short "
                f"and there's no easy transfer source right now."
            )
            item_doc = {
                "_id": item_id,
                "uid": uid,
                "type": "move",
                "status": "active",
                "headline": headline,
                "body": body,
                "action": None,
                "estimated": False,
                "created_at": datetime.utcnow(),
                "_dest_acct": dest_acct,
                "_no_source": True,
                "_window_end": window_end.isoformat(),
            }
            await companion_items_col.update_one(
                {"_id": item_id, "uid": uid},
                {"$set": {k: v for k, v in item_doc.items() if k != "_id"}},
                upsert=True,
            )
            items.append({
                "id": item_id,
                "type": "move",
                "headline": headline,
                "body": body,
                "action": None,
                "estimated": False,
            })

        if len(items) >= 2:
            break  # cap moves at 2 to leave room for rhythm

    # ── 7. Auto-verification pass: flip previously "active" moves to "done" ─
    celebration_items: list[dict] = []
    async for stored in companion_items_col.find(
        {"uid": uid, "type": "move", "status": "active", "_celebrated": {"$ne": True}}
    ):
        stored_dest = stored.get("_dest_acct")
        stored_window = stored.get("_window_end", "")
        stored_id = stored["_id"]
        if stored_id in dismissed:
            continue
        # If the stored item is already emitted in this run, skip
        if any(i["id"] == stored_id for i in items):
            continue
        # Check if window still open
        if stored_window and date.fromisoformat(stored_window) < today_d:
            await companion_items_col.update_one(
                {"_id": stored_id, "uid": uid},
                {"$set": {"status": "expired"}},
            )
            continue
        # If min_running for this account is now >= 0 → done
        if stored_dest and min_running.get(stored_dest, 0.0) >= 0:
            bill_name = stored.get("_bill_name", "bill")
            bill_amount = stored.get("_bill_amount", 0)
            dest_name_stored = stored.get("headline", "").replace("Move £", "").split(" to ")[-1] if "to " in stored.get("headline", "") else stored_dest
            await companion_items_col.update_one(
                {"_id": stored_id, "uid": uid},
                {"$set": {"status": "done", "_celebrated": True}},
            )
            cel_id = f"celebrate:{stored_id}"
            if cel_id not in dismissed:
                celebration_items.append({
                    "id": cel_id,
                    "type": "celebration",
                    "headline": f"Sorted — {dest_name_stored} is covered",
                    "body": f"The £{bill_amount} {bill_name} is safe.",
                    "action": None,
                    "estimated": False,
                })

    # ── 8. RHYTHM items ─────────────────────────────────────────────────────
    rhythm_items: list[dict] = []
    portrait = await behaviour_portrait_col.find_one({"_id": uid})
    if portrait and portrait.get("status") == "ok":
        traits_by_id = {t["id"]: t for t in portrait.get("traits", [])}
        today_obj = date.today()
        year_month = today_obj.strftime("%Y-%m")

        # front_loader: within 3 days BEFORE the 1st of next month
        next_month_1st = (today_obj.replace(day=1) + timedelta(days=32)).replace(day=1)
        days_to_month_end = (next_month_1st - today_obj).days

        if "front_loader" in traits_by_id and 0 < days_to_month_end <= 3:
            trait = traits_by_id["front_loader"]
            evidence = trait.get("evidence", [])
            # Extract avg early-month from evidence e.g. "£300 average early-month spend"
            avg_early_month = 0
            for ev in evidence:
                if "average early-month spend" in ev:
                    try:
                        avg_early_month = int(float(ev.split("£")[1].split(" ")[0].replace(",", "")))
                    except Exception:
                        pass

            # Current cash across current accounts
            current_cash = sum(
                live_balances.get(acc["_str_id"], float(acc.get("balance") or 0))
                for acc in all_uk_accounts
                if _is_current(acc)
            )

            rid = f"rhythm:cliff:{year_month}"
            if rid not in dismissed:
                headline = f"Your heavy week starts {next_month_1st.strftime('%-d %b')}"
                body = (
                    f"Around £{avg_early_month} of commitments land in the first 7 days. "
                    f"Right now you hold £{int(round(current_cash))} across current accounts. · estimated"
                )
                rhythm_items.append({
                    "id": rid,
                    "type": "rhythm",
                    "headline": headline,
                    "body": body,
                    "action": None,
                    "estimated": True,
                })

        # credit_switch: day 8, 9 or 10 of the month
        if "credit_switch" in traits_by_id and today_obj.day in (8, 9, 10):
            trait = traits_by_id["credit_switch"]
            evidence = trait.get("evidence", [])
            early_pct = late_pct = None
            for ev in evidence:
                if "Credit card share:" in ev:
                    try:
                        parts = ev.split(":")[1].strip()
                        e_part, l_part = parts.split(",")
                        early_pct = int(e_part.strip().split("%")[0])
                        late_pct = int(l_part.strip().split("%")[0])
                    except Exception:
                        pass

            rid = f"rhythm:switch:{year_month}"
            if rid not in dismissed:
                if early_pct is not None and late_pct is not None:
                    card_desc = f"({early_pct}% → {late_pct}% of spending)"
                else:
                    card_desc = ""
                headline = "Card season"
                body = (
                    f"This is the week your cards usually take over {card_desc}. "
                    f"Nothing to do — just so it doesn't sneak up."
                )
                rhythm_items.append({
                    "id": rid,
                    "type": "rhythm",
                    "headline": headline,
                    "body": body,
                    "action": None,
                    "estimated": False,
                })

        # saving_habit streak celebration
        if "saving_habit" in traits_by_id:
            trait = traits_by_id["saving_habit"]
            evidence = trait.get("evidence", [])
            streak = 0
            for ev in evidence:
                if "saving streak" in ev:
                    try:
                        streak = int(ev.split("-week")[0].strip())
                    except Exception:
                        pass

            if streak >= 4:
                n = (streak // 4) * 4
                last_celebrated = portrait.get("last_streak_celebrated", 0)
                if n > last_celebrated:
                    rid = f"celebrate:streak:{n}"
                    if rid not in dismissed:
                        # Update portrait to mark this n as celebrated
                        await behaviour_portrait_col.update_one(
                            {"_id": uid},
                            {"$set": {"last_streak_celebrated": n}},
                        )
                        celebration_items.append({
                            "id": rid,
                            "type": "celebration",
                            "headline": f"{n} weeks of saving, unbroken",
                            "body": "Still going. That habit is yours.",
                            "action": None,
                            "estimated": False,
                        })

    # ── 8b. NEEDLE item (period close reward) ──────────────────────────────
    needle_items: list[dict] = []
    try:
        from app.services.needle import compute_needle
        from app.services.pay_period import get_pay_period_for_date, prev_pay_period as _prev_pay_period

        # Check if today is within 3 days AFTER a period close
        # i.e., the current period started 0-2 days ago
        curr_start, curr_end = get_pay_period_for_date(today_d, pay_cfg)
        days_into_period = (today_d - curr_start).days  # 0 = first day of period

        if 0 <= days_into_period <= 2:
            # The just-closed period
            closed_start, closed_end = _prev_pay_period(curr_start, pay_cfg)
            needle_id = f"needle:{closed_end.isoformat()}"
            if needle_id not in dismissed:
                # Try stored needle first (idempotent)
                stored_needle = await needle_history_col.find_one({"_id": f"{uid}:{closed_end.isoformat()}"})
                if stored_needle and "lines" in stored_needle:
                    needle_doc = stored_needle
                else:
                    needle_doc = await compute_needle(uid, closed_start, closed_end)

                lines = needle_doc.get("lines", {})
                headline_txt = lines.get("headline", "Your month, closed.")
                body_parts = []
                if lines.get("movement"):
                    body_parts.append(lines["movement"])
                if lines.get("cash"):
                    body_parts.append(lines["cash"])
                if lines.get("streak"):
                    body_parts.append(lines["streak"])
                body_txt = " ".join(body_parts)

                # Store card_delta so frontend can apply correct accent colour
                needle_items.append({
                    "id": needle_id,
                    "type": "needle",
                    "headline": headline_txt,
                    "body": body_txt,
                    "action": None,
                    "estimated": False,
                    # Extra metadata for frontend accent — won't break existing CompanionItem shape
                    # (frontend ignores unknown fields gracefully)
                    "_card_delta": needle_doc.get("card_delta", 0),
                    "_period_end": closed_end.isoformat(),
                })
    except Exception as _needle_exc:
        log.warning("needle item failed for %s: %s", uid, _needle_exc)

    # ── 9. Merge and cap at 3 ───────────────────────────────────────────────
    # needle is priority above rhythm but below moves/celebrations
    result = items[:2] + celebration_items[:1] + needle_items[:1] + rhythm_items
    return result[:3]


async def _get_dismissed(uid: str) -> set[str]:
    """Load dismissed item IDs for this user."""
    doc = await companion_items_col.find_one({"_id": f"dismissed:{uid}"})
    if not doc:
        return set()
    return set(doc.get("ids", []))


async def dismiss_item(uid: str, item_id: str) -> None:
    """Persist a dismissed item id so it never shows again."""
    await companion_items_col.update_one(
        {"_id": f"dismissed:{uid}"},
        {"$addToSet": {"ids": item_id}},
        upsert=True,
    )
