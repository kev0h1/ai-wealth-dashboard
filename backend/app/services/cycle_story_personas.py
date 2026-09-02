"""Hardcoded persona facts for demo / preview mode."""
import copy
from datetime import datetime, timezone

from app.db.collections import cycle_story_col
from app.services.cycle_story import narrate_cycle_story

PERSONAS: dict[str, dict] = {
    "comfortable": {
        "status": "ok",
        "opening": {"income_in": 5200.0, "count": 1},
        "spending": {
            "total_spend": 3100.0,
            "income_in": 5200.0,
            "top_categories": [
                {"category": "Bills", "total": 950.0},
                {"category": "Groceries", "total": 520.0},
                {"category": "Eating Out", "total": 480.0},
                {"category": "Travel", "total": 450.0},
                {"category": "Shopping", "total": 380.0},
            ],
        },
        "cliff": {
            "week1_spend": 868.0,
            "period_spend": 3100.0,
            "week1_pct": 28.0,
            "commitments": [
                {"payee": "Mortgage", "total": 620.0},
                {"payee": "Council Tax", "total": 160.0},
                {"payee": "Home Insurance", "total": 45.0},
            ],
        },
        "cards": {"present": False, "material": False, "new_spend": 0.0, "payments": 0.0, "delta": 0.0, "share_of_spend": 0.0, "breakdown": []},
        "switch": None,
        "moves": {
            "card_feeding": {"count": 0, "total": 0.0},
            "ritual_saving": {"count": 0, "total": 0.0},
            "deliberate_saving": {"count": 2, "total": 3000.0},
            "buffer_draws": {"count": 0, "total": 0.0},
            "other_shuffles": {"count": 0, "total": 0.0},
        },
        "keeping": {"set_aside": 3000.0, "drawn_back": 0.0, "external": 1500.0, "kept": 3000.0},
        "close": {"month_end_cash": 61200.0, "card_delta": 0.0, "streak_weeks": None},
        "self_facts": {
            "traits": [],
            "streak_weeks": None,
            "fired": {"front_loader": False, "credit_switch": False, "saving_streak_intact": False},
        },
        "needle_lines": None,
    },
    "breakeven": {
        "status": "ok",
        "opening": {"income_in": 2600.0, "count": 1},
        "spending": {
            "total_spend": 2580.0,
            "income_in": 2600.0,
            "top_categories": [
                {"category": "Bills", "total": 1150.0},
                {"category": "Groceries", "total": 430.0},
                {"category": "Transport", "total": 300.0},
                {"category": "Eating Out", "total": 260.0},
                {"category": "Subscriptions", "total": 140.0},
            ],
        },
        "cliff": {
            "week1_spend": 1161.0,
            "period_spend": 2580.0,
            "week1_pct": 45.0,
            "commitments": [
                {"payee": "Rent", "total": 850.0},
                {"payee": "Council Tax", "total": 140.0},
                {"payee": "Energy Supplier", "total": 95.0},
            ],
        },
        "cards": {
            "present": True,
            "material": True,
            "new_spend": 900.0,
            "payments": 838.0,
            "delta": 62.0,
            "share_of_spend": 0.349,
            "breakdown": [
                {"account_id": "persona-breakeven-barclaycard", "name": "Barclaycard Platinum", "provider": "Barclaycard", "new_spend": 620.0, "delta": 40.0},
                {"account_id": "persona-breakeven-amex", "name": "Amex Everyday", "provider": "American Express", "new_spend": 280.0, "delta": 22.0},
                # Dormant card: no new spend this cycle, ranked last. Exercises
                # the "all cards, not just active ones" contract in previews.
                {"account_id": "persona-breakeven-halifax", "name": "Halifax Clarity", "provider": "Halifax", "new_spend": 0.0, "delta": 0.0},
            ],
        },
        "switch": {"week1_card_pct": 12.0, "rest_card_pct": 58.0, "switch_day": "2026-06-12"},
        "moves": {
            "card_feeding": {"count": 2, "total": 838.0},
            "ritual_saving": {"count": 0, "total": 0.0},
            "deliberate_saving": {"count": 1, "total": 80.0},
            "buffer_draws": {"count": 2, "total": 120.0},
            "other_shuffles": {"count": 0, "total": 0.0},
        },
        "keeping": {"set_aside": 80.0, "drawn_back": 120.0, "external": 0.0, "kept": -40.0},
        "close": {"month_end_cash": 41.0, "card_delta": 62.0, "streak_weeks": None},
        "self_facts": {
            "traits": [],
            "streak_weeks": None,
            "fired": {"front_loader": True, "credit_switch": True, "saving_streak_intact": False},
        },
        "needle_lines": None,
    },
    "partial": {
        "status": "ok",
        "partial_view": True,
        "opening": {"income_in": 0.0, "count": 0},
        "spending": {
            "total_spend": 1240.0,
            "income_in": 0.0,
            "top_categories": [
                {"category": "Eating Out", "total": 340.0},
                {"category": "Groceries", "total": 310.0},
                {"category": "Transport", "total": 260.0},
                {"category": "Shopping", "total": 190.0},
                {"category": "Bills", "total": 140.0},
            ],
        },
        "cliff": None,
        "cards": {"present": False, "material": False, "new_spend": 0.0, "payments": 0.0, "delta": 0.0, "share_of_spend": 0.0, "breakdown": []},
        "switch": None,
        "moves": {
            "card_feeding": {"count": 0, "total": 0.0},
            "ritual_saving": {"count": 0, "total": 0.0},
            "deliberate_saving": {"count": 0, "total": 0.0},
            "buffer_draws": {"count": 0, "total": 0.0},
            "other_shuffles": {"count": 4, "total": 600.0},
        },
        "keeping": {"set_aside": 0.0, "drawn_back": 0.0, "external": 0.0, "kept": 0.0},
        "close": {"month_end_cash": 380.0, "card_delta": 0.0, "streak_weeks": None},
        "self_facts": {
            "traits": [],
            "streak_weeks": None,
            "fired": {"front_loader": False, "credit_switch": False, "saving_streak_intact": False},
        },
        "needle_lines": None,
    },
}

PERSONA_PERIOD = {
    "start": "2026-06-01",
    "end": "2026-06-30",
    "closed": True,
    "days_elapsed": 30,
    "days_to_payday": 0,
}


async def get_persona_story(name: str) -> dict:
    """Return a persona story, using permanent cache in cycle_story_col."""
    cache_id = f"persona:{name}"
    cached = await cycle_story_col.find_one({"_id": cache_id})
    if cached:
        cached.pop("_id", None)
        return cached

    facts = copy.deepcopy(PERSONAS[name])
    narrative = await narrate_cycle_story(facts, facts["self_facts"]["traits"], PERSONA_PERIOD)

    cards_data = facts.get("cards") or {}
    now_iso = datetime.now(timezone.utc).isoformat()

    result = {
        "status": "ok",
        "period": PERSONA_PERIOD,
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
        "cards_link": bool(cards_data.get("material")),
        "computed_at": now_iso,
        "persona": name,
        "is_demo": True,
    }

    doc = {"_id": cache_id, **result}
    await cycle_story_col.update_one(
        {"_id": cache_id},
        {"$set": {k: v for k, v in doc.items() if k != "_id"}},
        upsert=True,
    )

    return result
