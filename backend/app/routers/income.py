"""Income stream detect-then-confirm endpoints."""
from datetime import date as _date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from app.core.auth import current_user
from app.db.collections import preferences_col, transactions_col, yapily_transactions_col
from app.routers.analytics import compute_and_cache_cashflow, _detect_recurring
from app.services.income import derive_schedule, next_occurrence, schedule_label, get_confirmed_payday

router = APIRouter(tags=["income"])

VALID_SCHEDULE_TYPES = {"weekly", "biweekly", "day_of_month", "last_weekday"}


async def _get_detected_income_streams(uid: str) -> list[dict]:
    """Re-run income detection from raw transactions (same logic as _compute_cashflow_patterns)."""
    cutoff = datetime.now() - timedelta(days=90)
    proj = {"merchant_name": 1, "description": 1, "amount": 1, "date": 1,
            "transaction_type": 1, "category": 1, "custom_category": 1}
    raw = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}}, proj
    ).to_list(None)
    raw += await yapily_transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}}, proj
    ).to_list(None)
    credits = [t for t in raw if t.get("transaction_type") == "credit"
               and (t.get("custom_category") or t.get("category") or "Other") not in {"Transfer"}]
    return _detect_recurring(credits, today=_date.today(), is_income=True)


async def _get_txn_dates_for_key(uid: str, key: str) -> list[_date]:
    """Fetch all transaction dates for a given merchant key (same bucketing as _detect_recurring)."""
    cutoff = datetime.now() - timedelta(days=90)
    proj = {"merchant_name": 1, "description": 1, "date": 1, "transaction_type": 1,
            "category": 1, "custom_category": 1}
    raw = await transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "credit"}, proj
    ).to_list(None)
    raw += await yapily_transactions_col.find(
        {"user_id": uid, "date": {"$gte": cutoff}, "transaction_type": "credit"}, proj
    ).to_list(None)
    dates = []
    for t in raw:
        t_key = (t.get("merchant_name") or t.get("description", "")[:35]).strip()
        if t_key == key:
            d = t["date"]
            if isinstance(d, datetime):
                d = d.date()
            dates.append(d)
    return sorted(dates)


@router.get("/income/streams")
async def get_income_streams(user: dict = Depends(current_user)):
    uid = user["email"]
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    stored: dict[str, dict] = {s["key"]: s for s in (prefs.get("income_streams") or [])}

    detected = await _get_detected_income_streams(uid)
    today = _date.today()

    result = []
    for stream in detected:
        if stream["occurrences"] < 2:
            continue
        key = stream["key"]
        stored_entry = stored.get(key)
        status = stored_entry["status"] if stored_entry else "suggested"

        if status == "rejected":
            continue  # never re-suggest

        # Derive schedule live from actual transaction dates
        txn_dates = await _get_txn_dates_for_key(uid, key)
        sched = derive_schedule(txn_dates) if len(txn_dates) >= 2 else None

        if sched and stored_entry and stored_entry.get("schedule"):
            # If confirmed, use the stored schedule (may have been manually set)
            active_sched = stored_entry["schedule"] if status == "confirmed" else sched
        else:
            active_sched = sched

        next_date = next_occurrence(active_sched, today).isoformat() if active_sched else None
        slabel = schedule_label(active_sched) if active_sched else None

        result.append({
            "key": key,
            "avg_amount": round(stream["avg_amount"], 2),
            "occurrences": stream["occurrences"],
            "schedule": active_sched,
            "schedule_label": slabel,
            "next_date": next_date,
            "status": status,
        })

    # Also include confirmed manual streams not in detected
    for s in (prefs.get("income_streams") or []):
        if s["key"] == "manual" and s.get("status") == "confirmed":
            sched = s.get("schedule")
            next_date = next_occurrence(sched, today).isoformat() if sched else None
            result.append({
                "key": "manual",
                "avg_amount": round(float(s.get("avg_amount") or 0), 2),
                "occurrences": 0,
                "schedule": sched,
                "schedule_label": schedule_label(sched) if sched else None,
                "next_date": next_date,
                "status": "confirmed",
            })

    return result


@router.post("/income/streams/confirm")
async def confirm_income_stream(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")

    txn_dates = await _get_txn_dates_for_key(uid, key)
    if len(txn_dates) < 2:
        raise HTTPException(400, "not enough transaction history to derive a schedule")

    sched = derive_schedule(txn_dates)
    if sched is None:
        raise HTTPException(422, "could not derive a regular schedule from transaction history")

    # Get avg_amount from detected streams
    detected = await _get_detected_income_streams(uid)
    avg_amount = next((s["avg_amount"] for s in detected if s["key"] == key), 0)

    entry = {
        "key": key,
        "status": "confirmed",
        "schedule": sched,
        "avg_amount": round(avg_amount, 2),
        "last_seen": txn_dates[-1].isoformat(),
        "confirmed_at": datetime.now().isoformat(),
    }

    # Update or insert into income_streams array
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    streams = [s for s in (prefs.get("income_streams") or []) if s["key"] != key]
    streams.append(entry)
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"income_streams": streams, "user_id": uid}},
        upsert=True,
    )

    import asyncio
    asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
    return entry


@router.post("/income/streams/reject")
async def reject_income_stream(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    key = (body.get("key") or "").strip()
    if not key:
        raise HTTPException(400, "key required")

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    streams = [s for s in (prefs.get("income_streams") or []) if s["key"] != key]
    streams.append({"key": key, "status": "rejected"})
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"income_streams": streams, "user_id": uid}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/income/streams/manual")
async def set_manual_income(body: dict, user: dict = Depends(current_user)):
    uid = user["email"]
    sched = body.get("schedule")
    if not sched or not isinstance(sched, dict):
        raise HTTPException(400, "schedule required")
    if sched.get("type") not in VALID_SCHEDULE_TYPES:
        raise HTTPException(422, f"schedule.type must be one of {VALID_SCHEDULE_TYPES}")

    # Validate required fields per type
    t = sched["type"]
    if t in ("weekly", "biweekly", "last_weekday"):
        if "weekday" not in sched:
            raise HTTPException(422, f"schedule.weekday required for type '{t}'")
    if t == "day_of_month":
        if "day" not in sched:
            raise HTTPException(422, "schedule.day required for type 'day_of_month'")
    if t == "biweekly" and "anchor" not in sched:
        raise HTTPException(422, "schedule.anchor (ISO date) required for type 'biweekly'")

    avg_amount = float(body.get("amount") or 0)
    entry = {
        "key": "manual",
        "status": "confirmed",
        "schedule": sched,
        "avg_amount": avg_amount,
        "confirmed_at": datetime.now().isoformat(),
    }

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    streams = [s for s in (prefs.get("income_streams") or []) if s["key"] != "manual"]
    streams.append(entry)
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"income_streams": streams, "user_id": uid}},
        upsert=True,
    )

    import asyncio
    asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
    return entry


@router.delete("/income/streams/{key}")
async def delete_income_stream(key: str, user: dict = Depends(current_user)):
    uid = user["email"]
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    streams = [s for s in (prefs.get("income_streams") or []) if s["key"] != key]
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"income_streams": streams, "user_id": uid}},
        upsert=True,
    )
    import asyncio
    asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))
    return {"ok": True}


@router.post("/income/confirm-payday")
async def confirm_payday(body: dict = None, user: dict = Depends(current_user)):
    """Confirm the server-proposed payday from the ask:payday companion item."""
    from app.services.income import (
        get_payday_proposal,
        payday_phrase as _payday_phrase,
        schedule_to_pay_period_config,
    )
    from app.services.companion import dismiss_item
    from app.services import response_cache
    from app.services.pay_period import get_pay_period_for_date

    uid = user["email"]
    today = _date.today()

    proposal = await get_payday_proposal(uid, today)
    if proposal is None:
        raise HTTPException(409, "no payday proposal available")

    sched = proposal["schedule"]
    new_config = proposal["pay_period_config"]

    entry = {
        "key": proposal["key"],
        "status": "confirmed",
        "schedule": sched,
        "avg_amount": proposal["amount"],
        "last_seen": proposal["last_seen"],
        "confirmed_at": datetime.now().isoformat(),
        "source": "payday_ask",
    }

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    streams = [s for s in (prefs.get("income_streams") or []) if s.get("key") != entry["key"]]
    streams.append(entry)
    await preferences_col.update_one(
        {"user_id": uid},
        {"$set": {"income_streams": streams, "pay_period_config": new_config, "user_id": uid}},
        upsert=True,
    )

    # Dismiss the ask item so it never re-asks
    await dismiss_item(uid, "ask:payday")

    # Invalidate all response caches for this user
    response_cache.invalidate(uid)

    # Kick cashflow recompute in background
    import asyncio
    asyncio.create_task(compute_and_cache_cashflow(uid, clear_ai_cache=False))

    # Compute period dates from the new config
    period_start, period_end = get_pay_period_for_date(today, new_config)

    return {
        "ok": True,
        "payday": proposal["next_date"],
        "schedule": sched,
        "schedule_label": proposal["schedule_label"],
        "payday_phrase": proposal["payday_phrase"],
        "pay_period_config": new_config,
        "merchant": proposal["merchant"],
        "amount": proposal["amount"],
        "period": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
    }
