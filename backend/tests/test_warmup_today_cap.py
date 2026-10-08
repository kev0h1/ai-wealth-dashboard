"""G234: warm-up must not persist a today payload whose pool was unreadable."""
import asyncio

import app.services.warmup as warmup

UID = "kevin@example.com"


def _run(monkeypatch, today_payload):
    puts = []

    async def aput(name, uid, payload, version=None):
        puts.append(name)

    async def bump(_u):
        return 1

    async def today(_uid):
        return today_payload

    async def other(_uid):
        return {"status": "ok"}

    monkeypatch.setattr(warmup.response_cache, "aput", aput)
    monkeypatch.setattr(warmup.data_version, "bump", bump)
    monkeypatch.setattr(warmup, "_compute_today", today)
    for n in ("_compute_safe_to_spend", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, other)
    asyncio.run(warmup._warm_user_impl(UID))
    return puts


def test_syncing_or_unreadable_pool_is_not_cached(monkeypatch):
    puts = _run(monkeypatch, {"status": "ok", "items": [], "account_eligibility": None})
    assert "today" not in puts


def test_healthy_pool_is_cached(monkeypatch):
    puts = _run(monkeypatch, {"status": "ok", "items": [], "account_eligibility": {"a": {"headroom": 5.0}}})
    assert "today" in puts
