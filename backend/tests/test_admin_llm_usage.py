"""Unit tests for app.routers.admin_usage — the bot/owner-only cost
dashboard `GET /admin/llm-usage`. Router handlers in this codebase are
unit-tested by calling them directly with a plain dict standing in for
the `current_user` dependency's return value (no HTTP client, no real
Mongo) — see tests/test_ops.py's own docstring for this convention.

`llm_usage_col` is faked with a small aggregate() that understands the
two pipeline shapes this router issues (group by "$pipeline", and the
two-stage group by {user_id, pipeline} then by user_id) well enough to
reproduce what real Mongo would return for a handful of fixture docs,
without depending on the exact stage contents beyond that distinguishing
shape. `get_subscription` is faked directly so tier lookups don't touch
subscriptions_col at all.
"""
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

import app.routers.admin_usage as admin_usage
from app.routers.admin_usage import admin_llm_usage


class _FakeAggResult:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n):
        return self._rows


class _FakeLlmUsageCol:
    """Mimics the two aggregate() shapes admin_llm_usage issues, over an
    in-memory doc list — enough to validate the router's own grouping and
    rounding logic without a real Mongo aggregation pipeline running."""

    def __init__(self, docs):
        self.docs = docs

    def aggregate(self, pipeline):
        match = pipeline[0]["$match"]
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in match.items())]
        group_id = pipeline[1]["$group"]["_id"]

        if group_id == "$pipeline":
            by_pipeline: dict = {}
            for d in rows:
                by_pipeline.setdefault(d["pipeline"], []).append(d)
            out = []
            for pname, ds in by_pipeline.items():
                out.append({
                    "_id": pname,
                    "cost_usd": sum(d.get("cost_usd") or 0.0 for d in ds),
                    "calls": len(ds),
                    "prompt_tokens": sum(d.get("prompt_tokens") or 0 for d in ds),
                    "cached_tokens": sum(d.get("cached_tokens") or 0 for d in ds),
                    "completion_tokens": sum(d.get("completion_tokens") or 0 for d in ds),
                    "avg_latency_ms": (sum(d.get("latency_ms") or 0 for d in ds) / len(ds)) if ds else 0.0,
                })
            out.sort(key=lambda r: r["cost_usd"], reverse=True)
            return _FakeAggResult(out)

        # by_user two-stage shape: group by (user_id, pipeline), then by user_id.
        by_up: dict = {}
        for d in rows:
            key = (d.get("user_id"), d.get("pipeline"))
            by_up.setdefault(key, []).append(d)
        stage1 = []
        for (uid, pname), ds in by_up.items():
            stage1.append({
                "user_id": uid,
                "pipeline": pname,
                "cost_usd": sum(d.get("cost_usd") or 0.0 for d in ds),
                "calls": len(ds),
                "message_ids": list({d.get("message_id") for d in ds}),
            })
        by_user: dict = {}
        for row in stage1:
            by_user.setdefault(row["user_id"], []).append(row)
        out = []
        for uid, rows2 in by_user.items():
            out.append({
                "_id": uid,
                "cost_usd": sum(r["cost_usd"] for r in rows2),
                "calls": sum(r["calls"] for r in rows2),
                "pipelines": [
                    {"pipeline": r["pipeline"], "cost_usd": r["cost_usd"], "calls": r["calls"], "message_ids": r["message_ids"]}
                    for r in rows2
                ],
            })
        return _FakeAggResult(out)


class _FakeSub:
    def __init__(self, tier_name):
        self.tier_name = tier_name


_TIERS = {"alice@example.com": "lite", "bob@example.com": "standard", "carol@example.com": "max"}


async def _fake_get_subscription(email):
    return _FakeSub(_TIERS.get(email, "max"))


def _doc(user_id, pipeline, cost, prompt, cached, completion, latency, message_id=None, ym="2026-09"):
    return {
        "user_id": user_id, "pipeline": pipeline, "cost_usd": cost,
        "prompt_tokens": prompt, "cached_tokens": cached, "completion_tokens": completion,
        "latency_ms": latency, "message_id": message_id, "year_month": ym,
    }


FIXTURE_DOCS = [
    _doc("alice@example.com", "penny", 0.01, 100, 10, 5, 200, message_id="m1"),
    _doc("alice@example.com", "penny", 0.002, 50, 5, 2, 100, message_id="m1"),
    _doc("alice@example.com", "scenario", 0.005, 80, 0, 8, 300),
    _doc("bob@example.com", "penny", 0.03, 120, 20, 15, 400, message_id="m2"),
    _doc("bob@example.com", "scenario", 0.001, 40, 0, 4, 150),
    _doc("carol@example.com", "scenario", 0.05, 200, 0, 25, 500),
]


@pytest.fixture(autouse=True)
def _owner_email(monkeypatch):
    monkeypatch.setattr(admin_usage, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")


@pytest.fixture
def fake_col(monkeypatch):
    fake = _FakeLlmUsageCol(list(FIXTURE_DOCS))
    monkeypatch.setattr(admin_usage, "llm_usage_col", fake)
    monkeypatch.setattr(admin_usage, "get_subscription", _fake_get_subscription)
    return fake


# ── admin gating ─────────────────────────────────────────────────────────

def test_403_for_ordinary_user(fake_col):
    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await admin_llm_usage(month="2026-09", user={"email": "someone@example.com", "name": ""})
        assert exc_info.value.status_code == 403

    asyncio.run(_run())


def test_200_for_bot(fake_col):
    result = asyncio.run(admin_llm_usage(month="2026-09", user={"email": "kevin.maingi12@gmail.com", "name": "Bot"}))
    assert result["month"] == "2026-09"


def test_200_for_owner_session(fake_col):
    result = asyncio.run(admin_llm_usage(month="2026-09", user={"email": "kevin.maingi12@gmail.com", "name": ""}))
    assert result["month"] == "2026-09"


# ── month validation ─────────────────────────────────────────────────────

def test_malformed_month_400(fake_col):
    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await admin_llm_usage(month="September-2026", user={"name": "Bot"})
        assert exc_info.value.status_code == 400

    asyncio.run(_run())


def test_malformed_month_out_of_range_400(fake_col):
    async def _run():
        with pytest.raises(HTTPException) as exc_info:
            await admin_llm_usage(month="2026-13", user={"name": "Bot"})
        assert exc_info.value.status_code == 400

    asyncio.run(_run())


def test_default_month_is_current_utc_month(monkeypatch):
    fake = _FakeLlmUsageCol([])
    monkeypatch.setattr(admin_usage, "llm_usage_col", fake)
    monkeypatch.setattr(admin_usage, "get_subscription", _fake_get_subscription)
    result = asyncio.run(admin_llm_usage(month=None, user={"name": "Bot"}))
    assert result["month"] == datetime.now(timezone.utc).strftime("%Y-%m")
    assert result["totals"]["users"] == 0
    assert result["totals"]["calls"] == 0
    assert "penny_messages" not in result["totals"]  # no penny-pipeline docs at all this month


# ── shape, totals, ordering, percentiles ──────────────────────────────────

def test_totals_by_pipeline_by_user_and_percentiles(fake_col):
    result = asyncio.run(admin_llm_usage(month="2026-09", user={"name": "Bot"}))

    totals = result["totals"]
    assert totals["cost_usd"] == pytest.approx(0.098, abs=1e-9)
    assert totals["calls"] == 6
    assert totals["prompt_tokens"] == 590
    assert totals["cached_tokens"] == 35
    assert totals["completion_tokens"] == 59
    assert totals["users"] == 3
    assert totals["penny_messages"] == 2  # distinct m1, m2

    by_pipeline = result["by_pipeline"]
    assert [row["pipeline"] for row in by_pipeline] == ["scenario", "penny"]  # sorted by cost desc
    scenario_row = by_pipeline[0]
    assert scenario_row["cost_usd"] == pytest.approx(0.056, abs=1e-9)
    assert scenario_row["calls"] == 3
    assert scenario_row["prompt_tokens"] == 320
    assert scenario_row["completion_tokens"] == 37
    assert scenario_row["avg_latency_ms"] == pytest.approx(316.7, abs=0.05)
    penny_row = by_pipeline[1]
    assert penny_row["cost_usd"] == pytest.approx(0.042, abs=1e-9)
    assert penny_row["calls"] == 3
    assert penny_row["avg_latency_ms"] == pytest.approx(233.3, abs=0.05)

    by_user = result["by_user"]
    assert [row["user_id"] for row in by_user] == [
        "carol@example.com", "bob@example.com", "alice@example.com",
    ]  # sorted by cost desc: 0.05, 0.031, 0.017
    carol, bob, alice = by_user
    assert carol["cost_usd"] == pytest.approx(0.05, abs=1e-9)
    assert carol["top_pipeline"] == "scenario"
    assert carol["penny_messages"] == 0
    assert carol["tier"] == "max"
    assert carol["user"] == "ca***@example.com"

    assert bob["cost_usd"] == pytest.approx(0.031, abs=1e-9)
    assert bob["top_pipeline"] == "penny"
    assert bob["penny_messages"] == 1
    assert bob["tier"] == "standard"

    assert alice["cost_usd"] == pytest.approx(0.017, abs=1e-9)
    assert alice["top_pipeline"] == "penny"  # 0.012 penny > 0.005 scenario
    assert alice["penny_messages"] == 1
    assert alice["tier"] == "lite"

    cpu = result["cost_per_user_usd"]
    assert cpu["mean"] == pytest.approx(0.0327, abs=1e-4)
    assert cpu["median"] == pytest.approx(0.031, abs=1e-9)
    assert cpu["p90"] == pytest.approx(0.05, abs=1e-9)

    assert "tiering-unit-economics-mcp-2026-09.md" in result["estimates_note"]
    assert "Usage metering" in result["estimates_note"]
    assert "—" not in result["estimates_note"]  # no em dashes in copy
