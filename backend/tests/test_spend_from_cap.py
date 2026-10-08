"""G234: a per-account "Spend from" figure never exceeds the pooled Safe to Spend.

`cap_spend_from_to_pool` (app/services/companion.py) is the one place the cap
lives; `build_today_payload` (app/routers/companion.py) applies it once the
pooled figure is final. These tests pin the cap, the zero and negative pool,
the preserved raw field, fail-closed behaviour and the excluded account.
"""
import asyncio

import app.routers.companion as companion_router
import app.services.companion as companion_service
from app.services.companion import cap_spend_from_to_pool

UID = "kevin@example.com"


def _pool_from_ledger(spendable_now, income, bills, allocations, commitments, buffer):
    return round(spendable_now + income - bills - allocations - commitments - buffer, 2)


def test_kevins_numbers_give_the_pool_and_cap_barclays():
    pool = _pool_from_ledger(1366.48, 6.50, 950.78, 231.84, 80, 0)
    assert pool == 110.36
    elig = {"barclays": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0}}
    cap_spend_from_to_pool(elig, pool)
    assert elig["barclays"]["spend_from_headroom"] == 110.36
    assert elig["barclays"]["account_headroom_raw"] == 127.0
    assert elig["barclays"]["spend_from_capped"] is True
    assert elig["barclays"]["headroom"] == 127.0  # standing cover-plan figure untouched


def test_cap_does_not_bind_when_account_is_below_the_pool():
    elig = {"a": {"short": False, "headroom": 50.0, "spend_from_headroom": 50.0}}
    cap_spend_from_to_pool(elig, 110.36)
    assert elig["a"]["spend_from_headroom"] == 50.0
    assert elig["a"]["spend_from_capped"] is False


def test_several_accounts_are_capped_independently():
    elig = {
        "a": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0},
        "b": {"short": False, "headroom": 60.0, "spend_from_headroom": 60.0},
        "c": {"short": False, "headroom": 300.0, "spend_from_headroom": 120.0},
    }
    cap_spend_from_to_pool(elig, 110.36)
    assert [elig[k]["spend_from_headroom"] for k in "abc"] == [110.36, 60.0, 110.36]
    assert [elig[k]["spend_from_capped"] for k in "abc"] == [True, False, True]
    # the cap uses the G114-corrected figure as the raw value, not the standing one
    assert elig["c"]["account_headroom_raw"] == 120.0


def test_every_shown_figure_is_within_the_pool():
    elig = {str(i): {"short": False, "headroom": h, "spend_from_headroom": h}
            for i, h in enumerate([5.0, 20.0, 110.36, 110.37, 999.0, -4.0])}
    cap_spend_from_to_pool(elig, 110.36)
    assert all(0 <= e["spend_from_headroom"] <= 110.36 for e in elig.values())


def test_zero_pool_shows_no_figures():
    elig = {"a": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0}}
    cap_spend_from_to_pool(elig, 0.0)
    assert elig["a"]["spend_from_headroom"] == 0.0
    assert elig["a"]["account_headroom_raw"] == 127.0


def test_negative_pool_shows_no_figures():
    elig = {"a": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0}}
    cap_spend_from_to_pool(elig, -42.0)
    assert elig["a"]["spend_from_headroom"] == 0.0
    assert elig["a"]["spend_from_capped"] is True


def test_entry_without_spend_from_field_falls_back_to_headroom():
    elig = {"a": {"short": False, "headroom": 200.0}}
    cap_spend_from_to_pool(elig, 110.36)
    assert elig["a"]["spend_from_headroom"] == 110.36
    assert elig["a"]["account_headroom_raw"] == 200.0


def _stub(monkeypatch, eligibility, pool):
    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        if account_eligibility_out is not None:
            account_eligibility_out.update({k: dict(v) for k, v in eligibility.items()})
        return []

    async def get_pool(uid):
        return pool

    monkeypatch.setattr(companion_router, "compute_today_items", compute)
    monkeypatch.setattr(companion_router, "_pooled_safe_to_spend", get_pool)


def test_today_payload_is_capped_and_keeps_raw(monkeypatch):
    _stub(monkeypatch, {"b": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0}}, 110.36)
    payload = asyncio.run(companion_router.build_today_payload(UID))
    e = payload["account_eligibility"]["b"]
    assert (e["spend_from_headroom"], e["account_headroom_raw"]) == (110.36, 127.0)


def test_today_payload_with_unknown_pool_fails_closed(monkeypatch):
    _stub(monkeypatch, {"b": {"short": False, "headroom": 127.0, "spend_from_headroom": 127.0}}, None)
    payload = asyncio.run(companion_router.build_today_payload(UID))
    assert payload["account_eligibility"] is None  # client says "not available", never an uncapped figure


def test_pool_reader_reads_final_safe_to_spend(monkeypatch):
    import app.routers.analytics as analytics

    async def sts(uid):
        return {"status": "ok", "calculation_status": "complete", "safe_to_spend": 110.36}

    monkeypatch.setattr(analytics, "get_cached_safe_to_spend", sts)
    assert asyncio.run(companion_router._pooled_safe_to_spend(UID)) == 110.36

    async def syncing(uid):
        return {"status": "ok", "calculation_status": "syncing", "safe_to_spend": 0}

    monkeypatch.setattr(analytics, "get_cached_safe_to_spend", syncing)
    assert asyncio.run(companion_router._pooled_safe_to_spend(UID)) is None

    async def boom(uid):
        raise RuntimeError("down")

    monkeypatch.setattr(analytics, "get_cached_safe_to_spend", boom)
    assert asyncio.run(companion_router._pooled_safe_to_spend(UID)) is None

    async def degraded(uid):
        return {"status": "ok", "calculation_status": "degraded", "safe_to_spend": -20.0}

    monkeypatch.setattr(analytics, "get_cached_safe_to_spend", degraded)
    assert asyncio.run(companion_router._pooled_safe_to_spend(UID)) == -20.0


def test_excluded_account_never_appears(monkeypatch):
    """G231: the engine never emits an entry for an excluded account, and the
    cap adds none."""
    from tests.test_cover_plan_account_eligibility import _account, _run

    accounts = [_account("counted", 300.0), {**_account("joint", 900.0), "include_in_safe_to_spend": False}]
    eligibility = {}
    _run(monkeypatch, [], accounts=accounts, account_eligibility_out=eligibility)
    cap_spend_from_to_pool(eligibility, 110.36)
    assert "joint" not in eligibility
    assert "counted" in eligibility
    assert eligibility["counted"]["spend_from_headroom"] <= 110.36


def test_no_penny_surface_quotes_account_headroom():
    """Penny tools, chips, can_i and affordability read the pooled figure
    only; the capped per-account figure is reached solely through the
    /today account_eligibility payload."""
    import pathlib
    root = pathlib.Path(companion_service.__file__).parent.parent
    for rel in ("services/penny_tools.py", "services/penny_chips.py", "routers/can_i.py", "services/affordability.py"):
        path = root / rel
        if path.exists():
            text = path.read_text()
            assert "spend_from_headroom" not in text and "account_headroom_raw" not in text, rel
