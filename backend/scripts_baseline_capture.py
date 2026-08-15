"""ENGINE baseline capture — READ-ONLY on user financial data.

Writes /tmp/engine-baseline.json with, for every user_id found via
transactions_col.distinct('user_id'):
  - monthly_cashflow (income/spending/debt/cat/n_months)
  - pace verdict + discretionary/non-spend split
  - compute_safe_to_spend headline/state/tight-threshold
  - compute_portrait trait ids + narratives
  - current budget-period spend
  - payday-plan everyday-spend target (per-account, from _per_account_everyday_spend)
  - per-card category totals (cards/story: per_card + drivers)
  - challenges eligible-category counts (ranked list length, replicated read-only —
    does NOT call _generate_all_challenges, which writes)
  - zero-similar-transactions count (transactions whose /transactions/{id}/similar
    logic would return zero rows)

Before measuring, clears ONLY pure-computation memo-cache fields
(cashflow_cache_col.monthly_cf, .total_baselines) so stale cache blobs cannot
hide drift. This does not touch transactions/accounts/balances or any other
real user data.
"""
import asyncio
import json
import re
from datetime import datetime, timedelta, date

from app.db.collections import (
    transactions_col, cashflow_cache_col, preferences_col,
)
from app.services.cashflow import monthly_cashflow
from app.services.region import get_user_region
from app.services.pace import compute_pace
from app.services.behaviour import compute_portrait
from app.services.pay_period import get_pay_period_for_date
from app.routers.analytics import compute_safe_to_spend
from app.routers.goals import budget_period_spend
from app.routers.cards import cards_story
from app.services.companion import _per_account_everyday_spend
from app.services.categorisation import LEADING_DATE_RE

_MONTH_RE_CHECK = None  # placeholder, unused


def _description_stem(desc: str) -> str:
    from app.services.categorisation import strip_date_fragments
    s = strip_date_fragments(desc.strip())
    s = re.sub(r'\s+[A-Z]{2,4}\s*$', '', s).strip()
    s = re.sub(r'\s+\d{6,}\s*$', '', s).strip()
    return s or strip_date_fragments(desc) or desc


CHALLENGE_CATS = {"Eating Out", "Entertainment", "Shopping", "Groceries", "Transport", "Subscriptions"}


async def _challenge_eligible_count(uid: str) -> int:
    """Read-only replica of _generate_all_challenges' `ranked` list length —
    does NOT call the writing function."""
    from app.services.region import get_kenya_transactions
    region = await get_user_region(uid)
    min_weekly = 500 if region == "Kenya" else 5

    now = datetime.utcnow()
    week_start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    four_weeks_ago = week_start - timedelta(days=28)

    if region == "Kenya":
        raw_txns = await get_kenya_transactions(uid, four_weeks_ago)
        raw_txns = [t for t in raw_txns if t.get("transaction_type") == "debit"]
    else:
        from app.db.collections import yapily_transactions_col
        tl = await transactions_col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": four_weeks_ago}}
        ).to_list(None)
        yap = await yapily_transactions_col.find(
            {"user_id": uid, "transaction_type": "debit", "date": {"$gte": four_weeks_ago}}
        ).to_list(None)
        raw_txns = tl + yap

    hist_txns = [t for t in raw_txns if t.get("date", datetime.min) < week_start]

    cat_totals: dict[str, float] = {}
    for t in hist_txns:
        cat = t.get("custom_category") or t.get("category") or "Other"
        if cat not in CHALLENGE_CATS:
            continue
        cat_totals[cat] = cat_totals.get(cat, 0) + t["amount"]

    ranked = [(cat, total / 4) for cat, total in cat_totals.items() if total / 4 >= min_weekly]
    return len(ranked)


async def _zero_similar_count(uid: str) -> tuple[int, int]:
    """For every transactions_col row belonging to uid, replicate the exact
    match logic of GET /transactions/{id}/similar and count how many rows
    return zero matches. Returns (zero_count, total_scanned)."""
    docs = await transactions_col.find(
        {"user_id": uid},
        {"merchant_name": 1, "description": 1, "transaction_type": 1, "date": 1},
    ).to_list(None)

    zero = 0
    for ref in docs:
        merchant = ref.get("merchant_name")
        description = ref.get("description", "") or ""
        txn_type = ref.get("transaction_type", "debit")

        match: dict = {
            "_id": {"$ne": ref["_id"]},
            "user_id": uid,
            "transaction_type": txn_type,
        }
        if merchant:
            match["merchant_name"] = merchant
        else:
            stem = _description_stem(description)
            if len(stem.strip()) < 3:
                zero += 1
                continue
            match["description"] = re.compile(
                r'^\s*' + LEADING_DATE_RE + re.escape(stem), re.IGNORECASE
            )
        count = await transactions_col.count_documents(match)
        if count == 0:
            zero += 1
    return zero, len(docs)


async def main():
    uids = await transactions_col.distinct("user_id")
    print(f"Users found via transactions_col.distinct('user_id'): {len(uids)}")
    for u in uids:
        print(" -", u)

    # ── Clear pure-computation memo caches (NOT user financial data) ──────────
    for uid in uids:
        await cashflow_cache_col.update_one(
            {"_id": uid},
            {"$unset": {"monthly_cf": "", "total_baselines": ""}},
        )
    print("Cleared monthly_cf + total_baselines memo caches for all users.\n")

    baseline: dict[str, dict] = {}
    now_dt = datetime.now()
    cutoff90 = now_dt - timedelta(days=90)

    for uid in uids:
        print(f"=== {uid} ===")
        entry: dict = {}

        region = await get_user_region(uid)
        entry["region"] = region

        # 1. monthly_cashflow
        cf = await monthly_cashflow(uid, region, cutoff90)
        entry["monthly_cashflow"] = cf

        # 2. pace verdict + split
        try:
            pace = await compute_pace(uid)
        except Exception as e:
            pace = {"error": str(e)}
        entry["pace"] = {
            "state": pace.get("state"),
            "split": pace.get("split"),
            "sustainable": pace.get("sustainable"),
            "actual": pace.get("actual"),
        }

        # 3. safe-to-spend
        try:
            sts = await compute_safe_to_spend(uid)
        except Exception as e:
            sts = {"status": "error", "error": str(e)}
        tight_threshold = None
        if sts.get("status") == "ok":
            monthly_spend = cf.get("spending", 0.0)
            tight_threshold = max(100.0, monthly_spend * 0.10)
        entry["safe_to_spend"] = {
            "status": sts.get("status"),
            "headline": sts.get("safe_to_spend"),
            "state": sts.get("state"),
            "tight_threshold": tight_threshold,
            "estimated": sts.get("estimated"),
        }

        # 4. portrait
        try:
            portrait = await compute_portrait(uid)
        except Exception as e:
            portrait = {"status": "error", "error": str(e)}
        if portrait.get("status") == "ok":
            entry["portrait"] = {
                "status": "ok",
                "traits": [
                    {"id": t.get("id"), "title": t.get("title"), "narrative": t.get("narrative")}
                    for t in portrait.get("traits", [])
                ],
            }
        else:
            entry["portrait"] = {"status": portrait.get("status", "error")}

        # 5. budget-period spend (current pay period)
        prefs = await preferences_col.find_one({"user_id": uid}) or {}
        pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
        p_start, p_end = get_pay_period_for_date(date.today(), pay_cfg)
        try:
            bp_spend = await budget_period_spend(uid, p_start, p_end)
        except Exception as e:
            bp_spend = {"error": str(e)}
        entry["budget_period_spend"] = {
            "period_start": p_start.isoformat(),
            "period_end": p_end.isoformat(),
            "by_category": bp_spend,
        }

        # 6. payday-plan everyday-spend target (per-account)
        cached_doc = await cashflow_cache_col.find_one({"_id": uid}) or {}
        recurring_keys = {r.get("key") for r in (cached_doc.get("recurring_spend") or []) if r.get("key")}
        try:
            everyday_spend = await _per_account_everyday_spend(uid, recurring_keys)
        except Exception as e:
            everyday_spend = {"error": str(e)}
        entry["payday_plan_everyday_spend"] = everyday_spend

        # 7. per-card category totals (cards/story)
        try:
            cards = await cards_story(user={"email": uid}, which="current")
        except Exception as e:
            cards = {"status": "error", "error": str(e)}
        if cards.get("status") == "ok":
            entry["cards_story"] = {
                "per_card": cards.get("per_card"),
                "drivers": cards.get("drivers"),
                "movement": cards.get("movement"),
            }
        else:
            entry["cards_story"] = {"status": cards.get("status", "error")}

        # 8. challenges eligible counts (read-only replica)
        try:
            entry["challenges_eligible_count"] = await _challenge_eligible_count(uid)
        except Exception as e:
            entry["challenges_eligible_count"] = f"error: {e}"

        # 9. zero-similar-transactions count
        zero, total = await _zero_similar_count(uid)
        entry["zero_similar_transactions"] = {"zero_count": zero, "total_scanned": total}

        baseline[uid] = entry
        print(f"  spending={cf.get('spending')} pace={entry['pace']['state']} "
              f"sts={entry['safe_to_spend']['headline']}({entry['safe_to_spend']['state']}) "
              f"portrait_traits={len(entry['portrait'].get('traits', []))} "
              f"zero_similar={zero}/{total}")

    with open("/tmp/engine-baseline.json", "w") as f:
        json.dump(baseline, f, indent=2, default=str)

    # ── Summary table ──────────────────────────────────────────────────────
    print("\n\n=== SUMMARY TABLE ===")
    header = f"{'user':32} {'spend':>9} {'pace':>10} {'sts':>9} {'sts_state':>10} {'tight':>8} {'traits':>7} {'challenges':>11} {'zero_sim':>9} {'txns':>6}"
    print(header)
    total_zero = 0
    total_txns = 0
    for uid, e in baseline.items():
        zs = e["zero_similar_transactions"]
        total_zero += zs["zero_count"]
        total_txns += zs["total_scanned"]
        print(f"{uid:32} {e['monthly_cashflow'].get('spending', 0):9.2f} "
              f"{str(e['pace'].get('state')):>10} "
              f"{str(e['safe_to_spend'].get('headline')):>9} "
              f"{str(e['safe_to_spend'].get('state')):>10} "
              f"{str(round(e['safe_to_spend'].get('tight_threshold') or 0, 2)):>8} "
              f"{len(e['portrait'].get('traits', [])):7} "
              f"{str(e.get('challenges_eligible_count')):>11} "
              f"{zs['zero_count']:9} {zs['total_scanned']:6}")
    print(f"\nTOTAL zero-similar-transactions across all users: {total_zero} / {total_txns} scanned")
    print("Baseline written to /tmp/engine-baseline.json")


if __name__ == "__main__":
    asyncio.run(main())
