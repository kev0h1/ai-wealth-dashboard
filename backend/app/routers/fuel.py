"""Fuel price proximity: 'what you paid vs what's nearby'.

Reads the cached UK Fuel Finder snapshot (collected on the UK egress box; see
fuel_finder_collector.py) and ranks same-grade stations near the user. The
snapshot is loaded once and re-read only when the file changes on disk.
"""
import json
import math
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import current_user
from app.db.collections import user_profiles_col

router = APIRouter(tags=["fuel"])

SNAPSHOT_PATH = Path(__file__).resolve().parents[2] / "fuel_cache" / "fuel_prices_latest.json"

GRADES = {"E10", "E5", "B7_STANDARD", "B7_PREMIUM"}
GRADE_LABELS = {
    "E10": "Petrol (E10)",
    "E5": "Premium petrol (E5)",
    "B7_STANDARD": "Diesel (B7)",
    "B7_PREMIUM": "Premium diesel",
}

_cache: dict = {"mtime": None, "data": None}


def load_snapshot() -> dict | None:
    """Return the parsed snapshot, re-reading only when the file's mtime changes."""
    try:
        mtime = os.path.getmtime(SNAPSHOT_PATH)
    except OSError:
        return None
    if _cache["mtime"] != mtime:
        try:
            with open(SNAPSHOT_PATH) as f:
                _cache["data"] = json.load(f)
            _cache["mtime"] = mtime
        except (OSError, ValueError):
            return None
    return _cache["data"]


def _haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


@router.get("/fuel/nearby")
async def fuel_nearby(
    user: dict = Depends(current_user),
    grade: str = Query("E10"),
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    radius_km: float = Query(8.0, gt=0, le=50),
    paid: float | None = Query(None, description="What the user paid, pence/litre"),
    limit: int = Query(8, ge=1, le=25),
):
    grade = grade.upper()
    if grade not in GRADES:
        raise HTTPException(400, f"Unknown grade '{grade}'")

    # Anchor: explicit coords win, else the user's saved home location.
    if lat is None or lng is None:
        doc = await user_profiles_col.find_one({"_id": user["email"]})
        lat = (doc or {}).get("lat")
        lng = (doc or {}).get("lng")
        if lat is None or lng is None:
            raise HTTPException(
                422, "No location set — add your postcode in your profile or share your location.",
            )

    snap = load_snapshot()
    if not snap:
        raise HTTPException(503, "Fuel price data is not available right now.")

    found = []
    for s in snap.get("stations", []):
        if s.get("closed") or s.get("lat") is None or s.get("lng") is None:
            continue
        price = (s.get("prices") or {}).get(grade)
        if price is None:
            continue
        dist = _haversine_km(lat, lng, s["lat"], s["lng"])
        if dist > radius_km:
            continue
        found.append({
            "node_id": s.get("node_id"),
            "brand": s.get("brand_name"),
            "name": s.get("trading_name"),
            "postcode": s.get("postcode"),
            "city": s.get("city"),
            "lat": s["lat"],
            "lng": s["lng"],
            "distance_km": round(dist, 2),
            "ppl": price,
            "updated": (s.get("updated") or {}).get(grade),
            "is_supermarket": bool(s.get("is_supermarket")),
        })

    found.sort(key=lambda x: x["ppl"])
    cheapest = found[0] if found else None
    prices = [x["ppl"] for x in found]
    median_ppl = sorted(prices)[len(prices) // 2] if prices else None

    savings_ppl = None
    if paid is not None and cheapest is not None:
        savings_ppl = round(paid - cheapest["ppl"], 1)

    return {
        "grade": grade,
        "grade_label": GRADE_LABELS.get(grade, grade),
        "anchor": {"lat": lat, "lng": lng},
        "radius_km": radius_km,
        "paid_ppl": paid,
        "count": len(found),
        "cheapest_ppl": cheapest["ppl"] if cheapest else None,
        "median_ppl": median_ppl,
        "savings_ppl": savings_ppl,
        "snapshot_fetched_at": snap.get("fetched_at"),
        "stations": found[:limit],
    }


@router.get("/fuel/status")
async def fuel_status(user: dict = Depends(current_user)):
    snap = load_snapshot()
    if not snap:
        return {"available": False}
    return {
        "available": True,
        "fetched_at": snap.get("fetched_at"),
        "station_count": snap.get("station_count"),
    }
