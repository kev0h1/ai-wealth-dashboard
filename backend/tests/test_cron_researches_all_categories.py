"""Proves the weekly cron (`_refresh_savings_insights_for_user`) now
researches EVERY category through the full honesty chain (owner decision
2026-09-01) — including the five categories that used to be PULL-only
(car_finance, gym, subscriptions, groceries, eating_out) and never got a
push-generated call from this cron at all (see the now-deleted
test_refresh_savings_insights_pull_categories.py).

"Through the honesty chain" here means: the real `_regen_reason` gate
decides whether to call `_generate_savings_insight_content` (not a
category-membership skip), and the result is stamped with
`content_valid_until` via `_compute_content_valid_until` exactly like every
other category — no separate code path any more.
"""
import asyncio
from datetime import datetime, timedelta

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _refresh_savings_insights_for_user,
    DEFAULT_RESEARCH_TTL,
    MAX_RESEARCHED_PER_PASS,
)


UID = "kevin.maingi12@gmail.com"
NOW = datetime(2026, 9, 1, 12, 0, 0)


class _FrozenDatetime(datetime):
    @classmethod
    def utcnow(cls):
        return NOW


def _run(coro):
    return asyncio.run(coro)


class FakeInsightsCol:
    def __init__(self, docs):
        self.docs = {d["category"]: dict(d, _id=d["category"]) for d in docs}

    async def find_one(self, query):
        return self.docs.get(query.get("category"))

    async def update_one(self, filt, update):
        for d in self.docs.values():
            if d.get("_id") == filt.get("_id"):
                d.update(update.get("$set", {}))
                for k in update.get("$unset", {}):
                    d.pop(k, None)
                return

    async def insert_one(self, doc):
        self.docs[doc["category"]] = doc


def _setup(monkeypatch, *, applicable, triggered_by_map, existing_docs=()):
    col = FakeInsightsCol(existing_docs)
    monkeypatch.setattr(savings_insights, "savings_insights_col", col)
    monkeypatch.setattr(savings_insights, "datetime", _FrozenDatetime)

    async def fake_detect(user_id):
        return applicable

    async def fake_triggered(user_id, category_key):
        return triggered_by_map.get(category_key, [])

    async def fake_verified(user_id, existing):
        return None

    calls: list[str] = []

    async def fake_content(category_key, user_id, user_context, triggered_by):
        calls.append(category_key)
        return {"title": f"{category_key} title", "body": f"{category_key} body", "savings_estimate": None}

    monkeypatch.setattr(savings_insights, "_detect_insight_categories", fake_detect)
    monkeypatch.setattr(savings_insights, "_find_triggered_transactions", fake_triggered)
    monkeypatch.setattr(savings_insights, "_check_verified_saving", fake_verified)
    monkeypatch.setattr(savings_insights, "_generate_savings_insight_content", fake_content)
    return col, calls


def test_a_formerly_pull_category_now_gets_generation_called_on_first_pass(monkeypatch):
    # gym was one of the five categories this cron used to skip entirely.
    triggered_by = [{"merchant_key": "pure gym", "monthly_amount": 25.0, "display_name": "Pure Gym"}]
    col, calls = _setup(
        monkeypatch, applicable=["gym"],
        triggered_by_map={"gym": triggered_by, "energy": [], "groceries": []},
    )

    _run(_refresh_savings_insights_for_user(UID))

    assert "gym" in calls, "gym must now go through the same _regen_reason -> generate path as any other category"
    gym = col.docs["gym"]
    assert gym["title"] == "gym title"
    assert gym["researched_at"] == NOW
    assert gym["content_valid_until"] == NOW + DEFAULT_RESEARCH_TTL


def test_all_five_former_pull_categories_get_generation_called_when_they_have_evidence(monkeypatch):
    former_pull = ["car_finance", "gym", "subscriptions", "groceries", "eating_out"]
    triggered_by_map = {
        cat: [{"merchant_key": cat, "monthly_amount": 30.0, "display_name": cat.title()}]
        for cat in former_pull
    }
    triggered_by_map["energy"] = []
    col, calls = _setup(monkeypatch, applicable=former_pull, triggered_by_map=triggered_by_map)

    _run(_refresh_savings_insights_for_user(UID))

    # MAX_RESEARCHED_PER_PASS caps how many can be researched in one pass —
    # assert every category that WAS researched went through generation
    # (the honesty chain), and confirm the cap itself is respected.
    assert len(calls) == min(len(former_pull), MAX_RESEARCHED_PER_PASS)
    assert set(calls) <= set(former_pull)
    for cat in calls:
        doc = col.docs[cat]
        assert doc["title"] == f"{cat} title"
        assert doc["content_valid_until"] is not None


def test_content_valid_until_is_stamped_on_the_update_path_too(monkeypatch):
    from app.routers.savings_insights import PROMPT_VERSION

    existing = {
        "category": "subscriptions", "user_id": UID, "insight_id": "subscriptions-abc",
        "icon": "📺", "label": "Subscriptions", "pinned": False,
        "title": "Old", "body": "Old body", "savings_estimate": None,
        "content_hash": "old-hash", "is_new": False,
        "refreshed_at": NOW - timedelta(days=40),  # past the 30-day TTL regen reason
        "researched_at": NOW - timedelta(days=40),
        "content_valid_until": NOW - timedelta(days=33),
        "prompt_version": PROMPT_VERSION,
        "triggered_by": [{"merchant_key": "netflix", "monthly_amount": 12.99, "display_name": "Netflix"}],
    }
    col, calls = _setup(
        monkeypatch, applicable=["subscriptions"],
        triggered_by_map={"subscriptions": existing["triggered_by"], "energy": [], "groceries": []},
        existing_docs=[existing],
    )

    _run(_refresh_savings_insights_for_user(UID))

    assert "subscriptions" in calls
    doc = col.docs["subscriptions"]
    assert doc["title"] == "subscriptions title"
    assert doc["content_valid_until"] == NOW + DEFAULT_RESEARCH_TTL


def test_per_user_cap_defers_the_rest_to_the_next_pass_untouched(monkeypatch):
    # More first_generation-eligible categories than MAX_RESEARCHED_PER_PASS
    # allows in one go — the overflow categories must be left completely
    # alone (not even triggered_by refreshed), so `_regen_reason` fires
    # again for them, unsuppressed, on the very next pass.
    cats = ["mobile", "broadband", "energy", "car_insurance", "mortgage", "gym", "subscriptions"]
    assert len(cats) > MAX_RESEARCHED_PER_PASS
    triggered_by_map = {cat: [{"merchant_key": cat, "monthly_amount": 20.0, "display_name": cat}] for cat in cats}
    col, calls = _setup(monkeypatch, applicable=cats, triggered_by_map=triggered_by_map)

    _run(_refresh_savings_insights_for_user(UID))

    assert len(calls) == MAX_RESEARCHED_PER_PASS
    untouched = [c for c in cats if c not in calls]
    assert untouched, "cap must actually bind for this fixture"
    for cat in untouched:
        assert cat not in col.docs, "a capped category with no prior doc must not be half-written"
