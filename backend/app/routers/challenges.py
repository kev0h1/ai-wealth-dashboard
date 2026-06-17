"""Weekly spending challenges endpoints."""
import uuid as uuid_lib
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.core.auth import current_user
from app.db.collections import (
    challenges_col, budgets_col,
    transactions_col, yapily_transactions_col,
)
from app.services.region import get_user_region, get_kenya_transactions

router = APIRouter(tags=["challenges"])

CHALLENGE_CATS = {"Eating Out", "Entertainment", "Shopping", "Groceries", "Transport", "Subscriptions"}
CHALLENGE_EXCL = {"Transfer", "Savings", "Debt", "Income", "Bills", "Utilities"}


def _week_bounds():
    now        = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    week_end   = week_start + timedelta(days=6, hours=23, minutes=59, seconds=59)
    return week_start, week_end


def _day_bounds():
    now       = datetime.utcnow()
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end   = day_start + timedelta(hours=23, minutes=59, seconds=59)
    return day_start, day_end


async def _get_debit_txns_challenge(uid: str, since: datetime) -> list:
    region = await get_user_region(uid)
    if region == "Kenya":
        return await get_kenya_transactions(uid, since)
    tl  = await transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": since}}).to_list(None)
    yap = await yapily_transactions_col.find({"user_id": uid, "transaction_type": "debit", "date": {"$gte": since}}).to_list(None)
    return tl + yap


async def _resolve_stale_challenges(uid: str):
    now   = datetime.utcnow()
    stale = await challenges_col.find({"uid": uid, "status": "active", "period_end": {"$lt": now}}).to_list(None)
    for ch in stale:
        txns   = await _get_debit_txns_challenge(uid, ch["period_start"])
        cat    = ch["category"]
        actual = sum(
            t["amount"] for t in txns
            if (t.get("custom_category") or t.get("category")) == cat
            and ch["period_start"] <= t.get("date", datetime.min) <= ch["period_end"]
        )
        status = "completed" if actual <= ch["target"] else "failed"
        update: dict = {"status": status, "actual": round(actual, 2)}
        if ch.get("tier") == "budget" and status == "completed" and ch["target"] > 0:
            ratio = actual / ch["target"]
            update["xp_reward"] = 60 if ratio <= 0.5 else 40 if ratio <= 0.75 else 20
        await challenges_col.update_one({"_id": ch["_id"]}, {"$set": update})


async def _get_challenge_stats(uid: str) -> dict:
    history  = await challenges_col.find(
        {"uid": uid, "status": {"$in": ["completed", "failed"]}}
    ).sort("period_start", -1).to_list(None)
    total_xp = sum(ch["xp_reward"] for ch in history if ch["status"] == "completed")
    level        = total_xp // 300 + 1
    xp_in_level  = total_xp % 300
    seen_weeks: dict[str, dict] = {}
    for ch in history:
        wk = ch["period_start"].strftime("%Y-W%W") if ch["cadence"] == "weekly" else None
        if wk:
            seen_weeks.setdefault(wk, {})
            if ch["status"] == "completed":
                seen_weeks[wk][ch["tier"]] = True
    streak = 0
    for wk in sorted(seen_weeks.keys(), reverse=True):
        if seen_weeks[wk].get("medium") or seen_weeks[wk].get("stretch"):
            streak += 1
        else:
            break
    return {
        "total_xp": total_xp, "level": level, "xp_in_level": xp_in_level, "xp_per_level": 300,
        "streak": streak,
        "completed": sum(1 for ch in history if ch["status"] == "completed"),
        "failed":    sum(1 for ch in history if ch["status"] == "failed"),
    }


async def _generate_all_challenges(uid: str) -> list[dict]:
    week_start, week_end = _week_bounds()
    day_start,  day_end  = _day_bounds()
    region   = await get_user_region(uid)
    currency = "KES" if region == "Kenya" else "GBP"
    min_weekly = 500 if region == "Kenya" else 5

    four_weeks_ago = week_start - timedelta(days=28)
    raw_txns       = await _get_debit_txns_challenge(uid, four_weeks_ago)
    hist_txns      = [t for t in raw_txns if t.get("date", datetime.min) < week_start]

    cat_totals: dict[str, float] = {}
    cat_days:   dict[str, set]   = {}
    for t in hist_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat not in CHALLENGE_CATS:
            continue
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]
        cat_days.setdefault(cat, set()).add(t.get("date", datetime.min).date())

    ranked = sorted(
        [(cat, total / 4) for cat, total in cat_totals.items() if total / 4 >= min_weekly],
        key=lambda x: -x[1]
    )

    new_docs: list[dict] = []

    existing_easy = await challenges_col.find_one({"uid": uid, "tier": "easy", "period_start": day_start})
    if not existing_easy and ranked:
        daily_ranked = sorted(
            [(cat, w) for cat, w in ranked if len(cat_days.get(cat, set())) >= 5],
            key=lambda x: -len(cat_days.get(x[0], set()))
        )
        easy_cat, easy_baseline_wk = (daily_ranked[0] if daily_ranked else ranked[-1])
        daily_baseline = easy_baseline_wk / 7
        daily_target   = round(daily_baseline * 0.85, 2)
        easy = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "easy",
            "cadence": "daily", "title": f"Keep {easy_cat} under budget today",
            "category": easy_cat, "baseline": round(daily_baseline, 2),
            "target": daily_target, "reduction_pct": 0.15, "currency": currency,
            "xp_reward": 20, "period_start": day_start, "period_end": day_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(easy)
        new_docs.append(easy)

    existing_medium = await challenges_col.find_one({"uid": uid, "tier": "medium", "period_start": week_start})
    if not existing_medium and len(ranked) >= 1:
        med_cat, med_wk = ranked[min(1, len(ranked) - 1)]
        med_target = round(med_wk * 0.80, 2)
        medium = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "medium",
            "cadence": "weekly", "title": f"Cut {med_cat} spending by 20% this week",
            "category": med_cat, "baseline": round(med_wk, 2),
            "target": med_target, "reduction_pct": 0.20, "currency": currency,
            "xp_reward": 75, "period_start": week_start, "period_end": week_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(medium)
        new_docs.append(medium)

    existing_stretch = await challenges_col.find_one({"uid": uid, "tier": "stretch", "period_start": week_start})
    if not existing_stretch and len(ranked) >= 1:
        str_cat, str_wk = ranked[0]
        str_target = round(str_wk * 0.65, 2)
        stretch = {
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "stretch",
            "cadence": "weekly", "title": f"Slash {str_cat} spending by 35% this week",
            "category": str_cat, "baseline": round(str_wk, 2),
            "target": str_target, "reduction_pct": 0.35, "currency": currency,
            "xp_reward": 150, "period_start": week_start, "period_end": week_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        }
        await challenges_col.insert_one(stretch)
        new_docs.append(stretch)

    return new_docs


async def _generate_budget_adherence_challenges(uid: str) -> None:
    week_start, week_end = _week_bounds()
    region   = await get_user_region(uid)
    currency = "KES" if region == "Kenya" else "GBP"

    budget_doc = await budgets_col.find_one({"user_id": uid, "region": region})
    if not budget_doc:
        return

    for b in budget_doc.get("budgets", []):
        cat = b.get("category", "")
        if not cat or b.get("planned", False) or cat in CHALLENGE_EXCL:
            continue
        existing = await challenges_col.find_one(
            {"uid": uid, "tier": "budget", "category": cat, "period_start": week_start}
        )
        if existing:
            continue
        weekly_target = round(b["monthly_limit"] / 4, 2)
        await challenges_col.insert_one({
            "_id": str(uuid_lib.uuid4()), "uid": uid, "tier": "budget", "cadence": "weekly",
            "title": f"Stay within your {cat} budget this week", "category": cat,
            "baseline": round(b["monthly_limit"], 2), "target": weekly_target,
            "reduction_pct": 0.0, "currency": currency, "xp_reward": 20,
            "period_start": week_start, "period_end": week_end,
            "status": "active", "actual": None, "created_at": datetime.utcnow(),
        })


async def _compute_progress(ch: dict, all_txns: list) -> dict:
    cat           = ch["category"]
    actual_so_far = sum(
        t["amount"] for t in all_txns
        if (t.get("custom_category") or t.get("category")) == cat
        and t.get("date", datetime.min) >= ch["period_start"]
    )
    now = datetime.utcnow()
    if ch["cadence"] == "daily":
        hours_left = max(0, int((ch["period_end"] - now).total_seconds() / 3600))
        time_left  = f"{hours_left}h left"
    else:
        days_left = max(0, (ch["period_end"] - now).days)
        time_left = f"{days_left}d left"
    pct_used = min(1.0, actual_so_far / ch["target"]) if ch["target"] > 0 else 0.0
    return {
        "actual_so_far": round(actual_so_far, 2), "target": ch["target"],
        "pct_used": round(pct_used * 100, 1), "on_track": actual_so_far <= ch["target"],
        "time_left": time_left,
    }


def _fmt_challenge(ch: dict, progress: dict | None = None) -> dict:
    out = {
        "id": ch["_id"], "tier": ch["tier"], "cadence": ch["cadence"],
        "title": ch["title"], "category": ch["category"],
        "baseline": ch["baseline"], "target": ch["target"],
        "reduction_pct": ch["reduction_pct"], "currency": ch["currency"],
        "xp_reward": ch["xp_reward"],
        "period_start": ch["period_start"].isoformat(),
        "period_end":   ch["period_end"].isoformat(),
        "status": ch["status"], "actual": ch.get("actual"),
    }
    if progress is not None:
        out["progress"] = progress
    return out


@router.get("/challenges")
async def get_challenges(user: dict = Depends(current_user)):
    uid = user["email"]
    await _resolve_stale_challenges(uid)
    await _generate_all_challenges(uid)
    await _generate_budget_adherence_challenges(uid)

    stats  = await _get_challenge_stats(uid)
    active = await challenges_col.find({"uid": uid, "status": "active", "period_start": {"$exists": True}}).to_list(None)

    if active:
        earliest = min(ch["period_start"] for ch in active)
        all_txns = await _get_debit_txns_challenge(uid, earliest)
    else:
        all_txns = []

    tier_order       = ["easy", "medium", "stretch"]
    tier_challenges  = []
    budget_challenges = []

    for ch in sorted(
        [c for c in active if c.get("tier") in ("easy", "medium", "stretch")],
        key=lambda c: tier_order.index(c.get("tier", "easy"))
    ):
        progress = await _compute_progress(ch, all_txns)
        tier_challenges.append(_fmt_challenge(ch, progress))

    for ch in sorted(
        [c for c in active if c.get("tier") == "budget"],
        key=lambda c: c.get("category", "")
    ):
        progress = await _compute_progress(ch, all_txns)
        budget_challenges.append(_fmt_challenge(ch, progress))

    history_docs = await challenges_col.find(
        {"uid": uid, "status": {"$in": ["completed", "failed"]}, "tier": {"$in": ["easy", "medium", "stretch"]}}
    ).sort("period_start", -1).limit(15).to_list(None)

    return {
        "stats": stats,
        "challenges": tier_challenges,
        "budget_challenges": budget_challenges,
        "history": [_fmt_challenge(ch) for ch in history_docs],
    }
