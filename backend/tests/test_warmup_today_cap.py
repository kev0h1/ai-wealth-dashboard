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
    for n in ("_compute_card_plan_progress", "_compute_cover_plan", "_compute_safe_to_spend", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_miscategorised_list", "_compute_grow", "_compute_commitments", "_compute_overspending"):
        monkeypatch.setattr(warmup, n, other)
    monkeypatch.setattr(warmup, "_maybe_spending_pace", other)
    asyncio.run(warmup._warm_user_impl(UID))
    return puts


def test_syncing_or_unreadable_pool_is_not_cached(monkeypatch):
    puts = _run(monkeypatch, {"status": "ok", "items": [], "account_eligibility": None})
    assert "today" not in puts


def test_healthy_pool_is_cached(monkeypatch):
    puts = _run(monkeypatch, {"status": "ok", "items": [], "account_eligibility": {"a": {"headroom": 5.0}}})
    assert "today" in puts


def test_unavailable_card_plan_progress_is_a_failed_warm(monkeypatch):
    async def aput(*args, **kwargs):
        return None

    async def bump(_uid):
        return 1

    async def unavailable(_uid):
        return {"status": "unavailable"}

    async def ok(_uid):
        return {"status": "ok"}

    monkeypatch.setattr(warmup.response_cache, "aput", aput)
    monkeypatch.setattr(warmup.data_version, "bump", bump)
    monkeypatch.setattr(warmup, "_compute_card_plan_progress", unavailable)
    for n in ("_compute_today", "_compute_cover_plan", "_compute_safe_to_spend", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_miscategorised_list", "_compute_grow", "_compute_commitments", "_compute_overspending"):
        monkeypatch.setattr(warmup, n, ok)
    monkeypatch.setattr(warmup, "_maybe_spending_pace", ok)
    result = asyncio.run(warmup._warm_user_impl(UID))
    assert result["failed"] == ["card_plan_progress"]
    assert "card_plan_progress" not in result["warmed"]
    assert "today" in result["warmed"]


def test_generic_warm_runs_overspending_last_without_notifying(monkeypatch):
    order = []

    async def bump(_uid):
        order.append("bump")
        return 8

    async def other(_uid):
        order.append("step")
        return {"status": "ok"}

    async def refresh(_uid):
        order.append("overspending")
        return {"schema_version": 1}

    async def notify(_uid):
        order.append("notify")

    async def put(*args, **kwargs):
        return None

    monkeypatch.setattr(warmup.response_cache, "aput", put)
    monkeypatch.setattr(warmup.data_version, "bump", bump)
    for n in ("_compute_card_plan_progress", "_compute_today", "_compute_cover_plan", "_compute_safe_to_spend", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_miscategorised_list", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, other)
    monkeypatch.setattr(warmup, "_compute_overspending", refresh)
    monkeypatch.setattr(warmup, "_maybe_spending_pace", notify)

    result = asyncio.run(warmup._warm_user_impl(UID))
    assert result["failed"] == []
    assert result["warmed"][-1] == "overspending"
    assert order[0] == "bump"
    assert order[-1] == "overspending"
    assert "notify" not in order


def test_post_sync_wrapper_notifies_only_when_refresh_succeeds(monkeypatch):
    called = []

    async def bump(_uid):
        return 8

    async def other(_uid):
        return {"status": "ok"}

    async def ready(_uid):
        return {"schema_version": 1}

    async def notify(_uid):
        called.append(_uid)

    async def put(*args, **kwargs):
        return None

    monkeypatch.setattr(warmup.response_cache, "aput", put)
    monkeypatch.setattr(warmup.data_version, "bump", bump)
    for n in ("_compute_card_plan_progress", "_compute_today", "_compute_cover_plan", "_compute_safe_to_spend", "_compute_spend_verdict", "_compute_miscategorised_count", "_compute_miscategorised_list", "_compute_grow", "_compute_commitments"):
        monkeypatch.setattr(warmup, n, other)
    monkeypatch.setattr(warmup, "_compute_overspending", ready)
    monkeypatch.setattr(warmup, "_maybe_spending_pace", notify)

    result = asyncio.run(warmup.warm_after_sync(UID))
    assert "overspending" in result["warmed"]
    assert called == [UID]


def test_post_sync_does_not_join_a_pre_sync_generic_snapshot(monkeypatch):
    events = []
    async def scenario():
        started, finish_old = asyncio.Event(), asyncio.Event()
        version = 0
        calls = 0
        async def bump(uid):
            nonlocal version
            version += 1
            events.append(f"boundary:{version}")
            return version
        async def compute(uid, include_cover_plan=True):
            nonlocal calls
            calls += 1
            run = calls
            if run == 1:
                started.set()
                await finish_old.wait()
                events.append("old-complete")
            else:
                assert version >= 1
                events.append("fresh-complete")
            return {"warmed": ["overspending"], "failed": [], "version": version}
        async def notify(uid):
            assert calls == 2 and events[-1] == "fresh-complete"
            events.append("notify")
        monkeypatch.setattr(warmup.data_version, "bump", bump)
        monkeypatch.setattr(warmup, "_warm_user_impl", compute)
        monkeypatch.setattr(warmup, "_maybe_spending_pace", notify)
        old = asyncio.create_task(warmup.warm_user(UID))
        await started.wait()
        post_sync = asyncio.create_task(warmup.warm_after_sync(UID))
        await asyncio.sleep(0)
        assert version == 1 and not post_sync.done()
        finish_old.set()
        await asyncio.gather(old, post_sync)
        assert events == ["boundary:1", "old-complete", "fresh-complete", "notify"]
    asyncio.run(scenario())
