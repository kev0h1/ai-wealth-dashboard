"""Preference-gated notification triggers, fired after a transaction sync.

A single orchestrator (`notify_after_sync`) runs the per-type checks, each
gated by the user's notification preferences and de-duplicated via
`notification_state_col` so the same alert never fires twice for one event.

The two money-movement checks (`_maybe_bill_shortfall`, a bill that may not
clear, and `_maybe_move_recommendation`, Penny's payday move that fixes it)
keep their own detection/threshold/dedup logic exactly as before, but no
longer send their own push — they return what's newly true, and
`_maybe_money_movement` decides whether that's one merged push (both fired),
one plain push (only one fired), or nothing, all landing on "/" (home, where
both the payday plan and the move recommendation cards live).
"""
import logging
from datetime import datetime, timedelta
from datetime import date as _date

from app.core.push import send_push_to_user, notify_new_transactions
from app.db.collections import (
    preferences_col, budgets_col, savings_goals_col,
    transactions_col, yapily_transactions_col, notification_state_col,
)
from app.services.categories import get_category_kinds, is_non_spend
from app.services.pay_period import get_pay_period_for_date

log = logging.getLogger(__name__)

# Per-type defaults when the user hasn't set a preference. Transactions default
# off (noisiest); the rest are high-signal and default on.
#
# "bill_alerts" also gates the merged money-movement push (bill shortfall +
# move recommendation, see `_maybe_money_movement`) — no separate key, same
# reasoning `_maybe_move_recommendation` already documents: the two checks
# report on the same underlying risk, so they share one Settings toggle.
NOTIF_DEFAULTS = {
    "transactions":             False,
    "budget_alerts":            True,
    "goal_milestones":          True,
    "insights":                 True,
    "period_digest":            True,
    "bill_alerts":              True,
    "category_pace":            True,
    "classification_attention": True,
}

# Outflows that aren't real consumption are never counted against a budget.
# That set is no longer duplicated here — it is the declared category kind
# (movement / income), read once per check via app.services.categories.


async def notif_pref(user_id: str, key: str) -> bool:
    doc = await preferences_col.find_one({"user_id": user_id}, {"notification_prefs": 1})
    prefs = (doc or {}).get("notification_prefs") or {}
    return bool(prefs.get(key, NOTIF_DEFAULTS.get(key, False)))


async def _state(user_id: str) -> dict:
    return await notification_state_col.find_one({"_id": user_id}) or {}


async def _maybe_settle_planned(user_id: str) -> None:
    from app.services.planned import settle_planned_expenses
    await settle_planned_expenses(user_id)


async def notify_after_sync(user_id: str, region: str, new_txns: list) -> None:
    """Run every preference-gated check after a sync brought new transactions."""
    if not user_id or user_id == "unknown":
        return

    # Money-movement is a merge of two checks (bill shortfall + move
    # recommendation) into at most one push — special-cased ahead of the
    # generic loop below for the same reason it always was: the two checks
    # need to see each other's result before either can send.
    try:
        await _maybe_money_movement(user_id, region)
    except Exception as e:  # one failing check must not block the others
        log.warning("notify_after_sync money_movement failed for %s: %s", user_id, e)

    for label, coro in (
        ("planned_settlement", _maybe_settle_planned(user_id)),
        ("transactions", _maybe_transactions(user_id, new_txns)),
        ("budget_alerts", _maybe_budget_exceeded(user_id, region)),
        ("goal_milestones", _maybe_goal_funded(user_id, region)),
        ("insights", _maybe_new_insights(user_id)),
        ("category_pace", _maybe_category_pace(user_id, region)),
        ("classification_attention", _maybe_classification_attention(user_id)),
    ):
        try:
            await coro
        except Exception as e:  # one failing check must not block the others
            log.warning("notify_after_sync %s failed for %s: %s", label, user_id, e)


async def _maybe_transactions(user_id: str, new_txns: list) -> None:
    if new_txns and await notif_pref(user_id, "transactions"):
        await notify_new_transactions(user_id, new_txns)


async def _maybe_budget_exceeded(user_id: str, region: str) -> None:
    if not await notif_pref(user_id, "budget_alerts"):
        return
    budget_doc = await budgets_col.find_one({"user_id": user_id, "region": region})
    budgets = (budget_doc or {}).get("budgets") or []
    limits = {b["category"]: b["monthly_limit"] for b in budgets if b.get("monthly_limit")}
    if not limits:
        return

    prefs = await preferences_col.find_one({"user_id": user_id}, {"pay_period_config": 1})
    pay_config = (prefs or {}).get("pay_period_config", {"type": "calendar_month"})
    start, _end = get_pay_period_for_date(_date.today(), pay_config)
    period_key = start.isoformat()
    start_dt = datetime(start.year, start.month, start.day)

    spend: dict[str, float] = {}
    if region != "Kenya":
        # ONE kind-map read for the whole period scan below.
        kinds = await get_category_kinds(user_id)
        q = {"user_id": user_id, "transaction_type": "debit", "date": {"$gte": start_dt}}
        proj = {"amount": 1, "category": 1, "custom_category": 1}
        for col in (transactions_col, yapily_transactions_col):
            for t in await col.find(q, proj).to_list(None):
                cat = t.get("custom_category") or t.get("category") or "Other"
                if is_non_spend(kinds, cat):
                    continue
                spend[cat] = spend.get(cat, 0.0) + abs(float(t.get("amount", 0) or 0))

    state = await _state(user_id)
    already = (state.get("budget_exceeded") or {}).get(period_key, [])
    newly: list[str] = []
    for cat, limit in limits.items():
        if spend.get(cat, 0.0) >= limit and cat not in already:
            newly.append(cat)

    if not newly:
        return
    sym = "KES " if region == "Kenya" else "£"
    for cat in newly:
        await send_push_to_user(
            user_id,
            f"Over budget: {cat}",
            f"You've spent {sym}{spend[cat]:,.0f} of your {sym}{limits[cat]:,.0f} {cat} budget this period.",
            "/budget",
        )
    await notification_state_col.update_one(
        {"_id": user_id},
        {"$set": {f"budget_exceeded.{period_key}": already + newly}},
        upsert=True,
    )


async def _maybe_goal_funded(user_id: str, region: str) -> None:
    if not await notif_pref(user_id, "goal_milestones"):
        return
    from app.routers.savings import _current_savings, _target_amount, _cashflow

    goal = await savings_goals_col.find_one({"_id": user_id})
    if not goal:
        return
    cutoff = datetime.now() - timedelta(days=90)
    _income, monthly_spending, _surplus = await _cashflow(user_id, region, cutoff)
    target = _target_amount(goal, monthly_spending)
    if target <= 0:
        return
    current = await _current_savings(user_id, goal)
    if current < target:
        return

    target_key = f"{target:.0f}"
    state = await _state(user_id)
    if state.get("goal_funded") == target_key:
        return
    sym = "KES " if region == "Kenya" else "£"
    await send_push_to_user(
        user_id,
        "Savings goal reached",
        f"You've hit your {sym}{target:,.0f} safety-net target. Nicely done.",
        "/insights",
    )
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"goal_funded": target_key}}, upsert=True,
    )


async def _maybe_new_insights(user_id: str) -> None:
    if not await notif_pref(user_id, "insights"):
        return
    from app.routers.analytics import compute_insights

    insights = await compute_insights(user_id)
    current_ids = [i.id for i in insights]
    state = await _state(user_id)

    # First run: record the baseline silently so we don't blast every existing
    # insight as if it were brand new.
    if "seen_insights" not in state:
        await notification_state_col.update_one(
            {"_id": user_id}, {"$set": {"seen_insights": current_ids}}, upsert=True,
        )
        return

    seen = set(state.get("seen_insights") or [])
    fresh = [i for i in insights if i.id not in seen]
    if fresh:
        top = max(fresh, key=lambda i: i.impact)
        title = "New money insight" if len(fresh) == 1 else f"{len(fresh)} new money insights"
        await send_push_to_user(user_id, title, top.title, "/insights")
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"seen_insights": current_ids}}, upsert=True,
    )


async def _maybe_move_recommendation(user_id: str) -> tuple[set[str], list[dict]]:
    """Detect (never send) Penny's "Move £X to <account>" cover-plan card.

    Hooked into `_maybe_money_movement` alongside `_maybe_bill_shortfall` —
    the recommendation is computed fresh from `compute_today_items`, the same
    function that powers the /penny and Home cards, so a resulting push always
    matches what the user would see if they opened the app.

    Preference: reuses `bill_alerts` rather than a new key. The move
    recommendation only ever exists to fix the exact situation `bill_alerts`
    already covers (a bill that may not clear) — it is the actionable
    counterpart to that same risk, not a separate category of alert. Reusing
    it means no new Settings toggle is needed.

    Dedup + pruning: `compute_today_items` bakes a fingerprint of the
    recommended amounts into each item's id, so a materially changed
    recommendation naturally gets a new id. State stores exactly the ids of
    *currently active* recommendations and is REPLACED (not appended to)
    each run: an id that stops being emitted — because it was paid, verified,
    dismissed, or the payday window rolled over — simply drops out on the
    next sync. That keeps state bounded to "what's live right now" without a
    separate expiry pass, unlike the per-period lists the sibling checks
    accumulate. This dedup/state-write behaviour is unchanged from before the
    send/landing layer moved out to `_maybe_money_movement`.

    Returns (dest_accts, new_moves):
      - dest_accts: destination account ids that currently have an active
        move recommendation, so `_maybe_bill_shortfall` can suppress its own
        detection for the same account (the move is the fix for that same
        risk; reporting both would describe one problem twice).
      - new_moves: the move items that are newly active this sync (not
        pushed yet — the caller decides whether to send them alone or merged
        with a bill-shortfall push).
    """
    if not await notif_pref(user_id, "bill_alerts"):
        return set(), []

    from app.services.companion import compute_today_items

    try:
        items = await compute_today_items(user_id)
    except Exception as e:
        log.warning("move recommendation compute failed for %s: %s", user_id, e)
        return set(), []

    # Only genuine "here's the transfer" cards carry an `amount` + `plan_dest`
    # (the funded cover-plan case). The sibling "no viable source" card is
    # also `type == "move"` but recommends nothing to move, so it's excluded.
    moves = [
        i for i in items
        if i.get("type") == "move" and i.get("amount") and i.get("plan_dest", {}).get("account_id")
    ]
    dest_accts = {str(m["plan_dest"]["account_id"]) for m in moves}

    state = await _state(user_id)
    already = set(state.get("move_recommended") or [])
    current_ids = {m["id"] for m in moves}

    new_moves = [m for m in moves if m["id"] not in already]

    if current_ids != already:
        await notification_state_col.update_one(
            {"_id": user_id},
            {"$set": {"move_recommended": sorted(current_ids)}},
            upsert=True,
        )
    return dest_accts, new_moves


def _bill_shortfall_body(b: dict, sym: str) -> str:
    days = b["days_away"]
    if days == 0:
        timing = "today"
    elif days == 1:
        timing = "tomorrow"
    else:
        timing = f"in {days}d"
    account_label = b.get("account_bank") or "your account"
    return (
        f"{b['name']} ({sym}{b['amount']:,.2f}) is due {timing}"
        f", {account_label} only has {sym}{b['account_balance']:,.2f}."
    )


async def _maybe_bill_shortfall(user_id: str, region: str, covered_dest_accts: set[str] | None = None) -> list[dict]:
    """Detect (never send) bills at risk of not clearing. Returns the newly
    at-risk bills (each augmented with a "body" string), for the caller to
    send alone or merged with a move recommendation. Detection, thresholds
    and dedup are unchanged from before the send/landing layer moved out to
    `_maybe_money_movement`."""
    if not await notif_pref(user_id, "bill_alerts"):
        return []

    from app.db.collections import cashflow_cache_col
    from app.routers.analytics import _build_cashflow_response

    cached = await cashflow_cache_col.find_one({"_id": user_id})
    if not cached:
        return []
    resp = await _build_cashflow_response(cached)
    upcoming_bills = resp.get("upcoming_bills") or []

    covered = covered_dest_accts or set()
    at_risk = [
        b for b in upcoming_bills
        if b["days_away"] <= 7
        and b.get("account_balance") is not None
        and b["account_balance"] >= 0
        and b["amount"] > b["account_balance"]
        and str(b.get("account_id") or "") not in covered
    ]
    if not at_risk:
        return []

    prefs = await preferences_col.find_one({"user_id": user_id}, {"pay_period_config": 1})
    pay_config = (prefs or {}).get("pay_period_config", {"type": "calendar_month"})
    start, _end = get_pay_period_for_date(_date.today(), pay_config)
    period_key = start.isoformat()

    state = await _state(user_id)
    already: list[str] = (state.get("bill_shortfall") or {}).get(period_key, [])

    sym = "KES " if region == "Kenya" else "£"
    newly: list[str] = []
    new_bills: list[dict] = []
    for b in at_risk:
        name = b["name"]
        if name in already:
            continue
        new_bills.append({**b, "body": _bill_shortfall_body(b, sym)})
        newly.append(name)

    if not newly:
        return []
    await notification_state_col.update_one(
        {"_id": user_id},
        {"$set": {f"bill_shortfall.{period_key}": already + newly}},
        upsert=True,
    )
    return new_bills


async def _maybe_money_movement(user_id: str, region: str) -> None:
    """Merged send/landing layer for the two money-movement checks.

    Runs `_maybe_move_recommendation` first and carries its covered accounts
    into `_maybe_bill_shortfall`, exactly as before, so a live move
    recommendation for an account suppresses the plain shortfall detection
    for that same account. What's new: neither check sends its own push
    anymore — this decides, once, what actually goes out. Both detectors
    already wrote their dedup state before returning here, so every new
    event MUST be sent exactly once — none may be silently dropped, or it
    would be marked "seen" and never retried.

      - a new bill AND a new move both landed this sync -> the FIRST of each
        merges into ONE push (shortfall leads, the move is named as the
        remedy). There's no real pairing to exploit beyond that: a bill only
        counts as "at risk" once accounts already covered by ANY active move
        (not just a new one) are excluded, so a same-sync bill and move can
        never share an account — first-with-first is exactly as arbitrary as
        any other pairing, so it's the simplest one.
      - every OTHER new bill and new move (i.e. everything past the one
        consumed by the merge) still gets its own push, in its own framing.
      - only one side fired -> each of its new items gets its own push.
      - neither -> nothing.

    All pushes land on "/" (home), where both the payday plan and the move
    recommendation cards live.
    """
    dest_accts: set[str] = set()
    new_moves: list[dict] = []
    try:
        dest_accts, new_moves = await _maybe_move_recommendation(user_id)
    except Exception as e:
        log.warning("money_movement move_recommendation failed for %s: %s", user_id, e)

    new_bills: list[dict] = []
    try:
        new_bills = await _maybe_bill_shortfall(user_id, region, dest_accts)
    except Exception as e:
        log.warning("money_movement bill_shortfall failed for %s: %s", user_id, e)

    if not new_bills and not new_moves:
        return

    bills = list(new_bills)
    moves = list(new_moves)

    if bills and moves:
        bill = bills.pop(0)
        move = moves.pop(0)
        dest_name = move["plan_dest"].get("name") or "your account"
        amount = int(round(move["amount"]))
        remedy = f" I can move £{amount:,} to {dest_name} to help cover it."
        body = bill["body"] + remedy
        await send_push_to_user(user_id, "Bill may not clear", body, "/")

    # Every event not consumed by the merge above still gets its own push —
    # a swallowed item here would be reported as "seen" (dedup state was
    # already written by the detector) and never surface again.
    for b in bills:
        await send_push_to_user(user_id, "Bill may not clear", b["body"], "/")

    for m in moves:
        dest_name = m["plan_dest"].get("name") or "your account"
        amount = int(round(m["amount"]))
        title = f"Move £{amount:,} to {dest_name}"
        body = "Covers an expected bill before it's due."
        await send_push_to_user(user_id, title, body, "/")


def _pace_line(multiple: float, excess: float, days_elapsed: int, sym: str) -> str:
    """Mirror of frontend/components/SpendVerdictView.tsx's `paceLine` — same
    three branches, same rounding, same wording, so the push never says
    something the Spend page itself wouldn't. Kept in sync deliberately
    rather than shared, since the frontend has no server call to make for a
    push body."""
    day_label = f"day {days_elapsed}"
    rounded = round(multiple, 1)
    if 1.9 <= rounded <= 2.1:
        return f"about twice your usual pace for {day_label}."
    if rounded > 2.1:
        return f"about {rounded:.1f}× your usual pace for {day_label}."
    return f"running about {sym}{round(excess):,} ahead of usual for {day_label}."


async def _maybe_category_pace(user_id: str, region: str) -> None:
    """Push once per category per pay period the first time it becomes a
    Spend-page "notable" — the exact qualification `spend_verdict.py`'s
    `build_notables_and_majority` already applies (the "N.N× usual pace for
    day D" flag shown on the Spend page), reused verbatim via
    `compute_spend_verdict` rather than a new threshold invented here.
    """
    if not await notif_pref(user_id, "category_pace"):
        return

    from app.services.spend_verdict import compute_spend_verdict

    try:
        verdict = await compute_spend_verdict(user_id)
    except Exception as e:
        log.warning("category pace compute failed for %s: %s", user_id, e)
        return

    notables = verdict.get("notables") or []
    if not notables:
        return

    period = verdict.get("period") or {}
    period_key = period.get("start")
    days_elapsed = period.get("days_elapsed") or 0
    if not period_key:
        return

    state = await _state(user_id)
    already: list[str] = (state.get("category_pace") or {}).get(period_key, [])

    sym = "KES " if region == "Kenya" else "£"
    newly: list[str] = []
    for n in notables:
        cat = n["category"]
        if cat in already:
            continue
        multiple = n.get("multiple")
        excess = n.get("excess")
        if multiple is None or excess is None:
            continue
        line = _pace_line(multiple, excess, days_elapsed, sym)
        body = line[0].upper() + line[1:]
        await send_push_to_user(user_id, f"{cat} is running hot", body, "/spend")
        newly.append(cat)

    if not newly:
        return
    await notification_state_col.update_one(
        {"_id": user_id},
        {"$set": {f"category_pace.{period_key}": already + newly}},
        upsert=True,
    )


def _classification_body(new_unplaced: set, new_miscategorised: set) -> str:
    parts: list[str] = []
    if new_unplaced:
        n = len(new_unplaced)
        parts.append(f"{n} payment{'s' if n != 1 else ''} I could not place")
    if new_miscategorised:
        n = len(new_miscategorised)
        parts.append(f"{n} may be miscategorised")
    return " and ".join(parts)


async def _current_classification_flags(user_id: str) -> tuple[set[str], set[str]]:
    """(unplaced_ids, miscategorised_ids) — stable transaction `_id` strings,
    mirroring the miscategorised guardrail's own dismissal keying
    (`analytics._flagged_miscategorised`, keyed on the same stable provider
    `_id`) so an id, once notified, is recognised again even if its category
    or dismissal state later changes.

    "Unplaced" = a debit whose effective category (custom override, else the
    synced category) is "Other" or missing — the app's own fallback when the
    categorisation engine has no confident category
    (`categorisation.py`'s `"Other"` default). Reuses `transactions.py`'s own
    `_category_clause("Other")` rather than re-deriving the match (it treats
    "" the same as None on both fields — a bare copy of this clause missed
    that once already)."""
    from app.routers.transactions import _category_clause

    other_clause = _category_clause("Other")
    unplaced: set[str] = set()
    for col in (transactions_col, yapily_transactions_col):
        cursor = col.find(
            {"user_id": user_id, "transaction_type": "debit", **other_clause},
            {"_id": 1},
        )
        async for t in cursor:
            unplaced.add(str(t["_id"]))

    from app.routers.analytics import _flagged_miscategorised

    flagged = await _flagged_miscategorised(user_id)
    miscategorised = {str(t["_id"]) for t in flagged}

    return unplaced, miscategorised


async def _maybe_classification_attention(user_id: str) -> None:
    """Push once when a sync leaves NEW unplaced or miscategorised payments
    behind — never the same payment twice (dedup on its stable id)."""
    if not await notif_pref(user_id, "classification_attention"):
        return

    try:
        unplaced, miscategorised = await _current_classification_flags(user_id)
    except Exception as e:
        log.warning("classification attention compute failed for %s: %s", user_id, e)
        return

    all_current = unplaced | miscategorised
    state = await _state(user_id)
    seen_key = "classification_seen"

    # First run: seed the baseline silently, same convention as
    # `_maybe_new_insights` — an existing backlog of unplaced/miscategorised
    # payments at rollout must never blast a push for history, only for what
    # a sync newly leaves behind from here on.
    if seen_key not in state:
        await notification_state_col.update_one(
            {"_id": user_id}, {"$set": {seen_key: sorted(all_current)}}, upsert=True,
        )
        return

    seen = set(state.get(seen_key) or [])
    new_unplaced = unplaced - seen
    new_miscategorised = miscategorised - seen
    if not new_unplaced and not new_miscategorised:
        return

    body = _classification_body(new_unplaced, new_miscategorised)
    await send_push_to_user(user_id, "Some payments need a look", body, "/spend")

    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {seen_key: sorted(seen | all_current)}}, upsert=True,
    )


async def send_period_digest(user_id: str) -> None:
    """Fresh-start digest on the first day of a new pay period.

    One push: how last period went against the budget, plus the standing
    headline goals. This is the primary re-encounter moment for goals —
    the scoreboard comes to the user instead of living on a page they
    have to remember to visit.
    """
    if not await notif_pref(user_id, "period_digest"):
        return
    prefs = await preferences_col.find_one({"user_id": user_id}) or {}
    pay_config = prefs.get("pay_period_config", {"type": "calendar_month"})
    today = _date.today()
    start, _end = get_pay_period_for_date(today, pay_config)
    if start != today:
        return  # not a period boundary
    state = await _state(user_id)
    if state.get("last_digest_period") == start.isoformat():
        return  # already sent for this period

    region = prefs.get("region", "UK")
    sym = "KES " if region == "Kenya" else "£"
    from app.routers.goals import goals_summary, budget_period_spend
    from app.services.pay_period import prev_pay_period

    parts: list[str] = []

    # How last period went against the budget (the fresh-start hook)
    budget_doc = await budgets_col.find_one({"user_id": user_id, "region": region})
    limits = {b["category"]: b["monthly_limit"]
              for b in (budget_doc or {}).get("budgets") or [] if b.get("monthly_limit")}
    if limits and region != "Kenya":
        prev_start, prev_end = prev_pay_period(start, pay_config)
        spend = await budget_period_spend(user_id, prev_start, prev_end)
        spent = sum(max(0.0, spend.get(c, 0.0)) for c in limits)
        total = sum(limits.values())
        verdict = "under" if spent <= total else "over"
        parts.append(f"Last period: {sym}{spent:,.0f} of {sym}{total:,.0f} budgeted ({verdict})")

    # Standing goals (skip budget — covered above with last period's numbers)
    for g in await goals_summary(user_id, region):
        if g["pillar"] != "budget":
            parts.append(f"{g['label']}: {g['detail']}")

    if not parts:
        return
    body = " · ".join(parts)
    if len(body) > 175:
        body = body[:172] + "…"
    await send_push_to_user(user_id, "New pay period: fresh start", body, "/")
    await notification_state_col.update_one(
        {"_id": user_id}, {"$set": {"last_digest_period": start.isoformat()}}, upsert=True,
    )

    # Needle push — fired on period boundary, gated by period_digest pref (same gate).
    # Deduped: only once per (uid, period_end) via needle_history_col.pushed flag.
    try:
        from app.services.needle import compute_needle
        from app.services.pay_period import prev_pay_period as _prev_period
        from app.db.collections import needle_history_col

        prev_start, prev_end = _prev_period(start, pay_config)
        needle_id = f"{user_id}:{prev_end.isoformat()}"
        stored = await needle_history_col.find_one({"_id": needle_id})
        already_pushed = stored.get("pushed", False) if stored else False

        if not already_pushed:
            if stored and "lines" in stored:
                needle_doc = stored
            else:
                needle_doc = await compute_needle(user_id, prev_start, prev_end)

            lines = needle_doc.get("lines", {})
            push_headline = lines.get("headline", "Your month, closed.")
            push_body = lines.get("movement", "")
            if push_body and len(push_body) > 130:
                push_body = push_body[:127] + "…"
            if push_body:
                await send_push_to_user(user_id, push_headline, push_body, "/month/story?which=last")
            await needle_history_col.update_one(
                {"_id": needle_id},
                {"$set": {"pushed": True, "pushed_at": datetime.utcnow().isoformat()}},
                upsert=True,
            )
    except Exception as _needle_push_exc:
        log.warning("needle push failed for %s: %s", user_id, _needle_push_exc)
