"""Focused Safe-to-Spend hardening tests.

These exercise the pure low-point walk, the active-consent account universe,
the unsupported-region guard, and preference-cache invalidation without
requiring Mongo.
"""
import asyncio

import app.routers.analytics as analytics
import app.routers.preferences as preferences
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.net_position as net_position
import app.services.region as region_service


class _ListCol:
    def __init__(self, docs):
        self.docs = list(docs)
        self.find_calls = []

    def find(self, query, projection=None):
        self.find_calls.append((query, projection))
        return self

    async def to_list(self, _limit):
        return list(self.docs)


class _PrefsCol:
    def __init__(self, doc=None):
        self.doc = doc or {"user_id": "user@example.com"}
        self.updated = None

    async def find_one(self, _query):
        return self.doc

    async def update_one(self, query, update, upsert=False):
        self.updated = (query, update, upsert)


class _CacheDocCol:
    async def find_one(self, _query):
        return {"_id": "user@example.com"}


class _CacheSpy:
    def __init__(self):
        self.calls = []

    def invalidate(self, *args):
        self.calls.append(args)


def test_same_day_debits_are_applied_before_income_for_safe_to_spend():
    # Date-only forecasts cannot establish that salary arrives before a direct
    # debit. The safe floor must therefore see the bill's temporary deficit.
    lowest = analytics._safe_to_spend_lowest_projected_balance(
        100.0,
        [{"days_away": 2, "amount": 150.0}],
        [{"days_away": 2, "amount": 150.0}],
    )
    assert lowest == -50.0


def test_lowest_projected_balance_preserves_the_actual_timeline_floor():
    lowest = analytics._safe_to_spend_lowest_projected_balance(
        500.0,
        [{"days_away": 1, "amount": 300.0}, {"days_away": 3, "amount": 350.0}],
        [{"days_away": 2, "amount": 100.0}],
    )
    assert lowest == -50.0


def test_lowest_projected_balance_ignores_transfers_inside_spendable_pool():
    lowest = analytics._safe_to_spend_lowest_projected_balance(
        100.0,
        [
            {
                "days_away": 1,
                "amount": 213.34,
                "kind": analytics.MOVEMENT,
                "dest_account_spendable": True,
            },
            {"days_away": 2, "amount": 50.0, "kind": "commitment"},
        ],
        [],
    )
    assert lowest == 50.0


def test_lowest_projected_balance_keeps_savings_and_untraced_movements():
    lowest = analytics._safe_to_spend_lowest_projected_balance(
        100.0,
        [
            {
                "days_away": 1,
                "amount": 40.0,
                "kind": analytics.MOVEMENT,
                "dest_account_spendable": False,
            },
            {
                "days_away": 2,
                "amount": 30.0,
                "kind": analytics.MOVEMENT,
                "dest_account_spendable": None,
            },
        ],
        [],
    )
    assert lowest == 30.0


def test_safe_to_spend_excludes_yapily_records_without_authorized_consent(monkeypatch):
    native = _ListCol([{"balance": 200.0}])
    stale_yapily = _ListCol([{"balance": 900.0}])
    consents = _ListCol([])
    monkeypatch.setattr(analytics, "accounts_col", native)
    monkeypatch.setattr(analytics, "yapily_accounts_col", stale_yapily)
    monkeypatch.setattr(analytics, "yapily_consents_col", consents)

    result = asyncio.run(analytics._safe_to_spend_accounts("user@example.com"))

    assert result == [{"balance": 200.0}]
    assert stale_yapily.find_calls == []
    assert consents.find_calls == [
        ({"user_id": "user@example.com", "status": "AUTHORIZED"}, {"_id": 1})
    ]


def test_safe_to_spend_includes_yapily_records_with_authorized_consent(monkeypatch):
    native = _ListCol([{"balance": 200.0}])
    active_yapily = _ListCol([{"balance": 300.0}])
    monkeypatch.setattr(analytics, "accounts_col", native)
    monkeypatch.setattr(analytics, "yapily_accounts_col", active_yapily)
    monkeypatch.setattr(analytics, "yapily_consents_col", _ListCol([{"_id": "active-consent"}]))

    result = asyncio.run(analytics._safe_to_spend_accounts("user@example.com"))

    assert result == [{"balance": 200.0}, {"balance": 300.0}]
    assert active_yapily.find_calls == [
        (
            {"user_id": "user@example.com", "consent": {"$in": ["active-consent"]}},
            {"balance": 1, "type": 1, "subtype": 1, "currency": 1},
        )
    ]


def test_kenya_safe_to_spend_returns_explicit_unsupported_result(monkeypatch):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol())

    async def kenya(_uid):
        return "Kenya"

    monkeypatch.setattr(region_service, "get_user_region", kenya)
    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    assert result == {
        "status": "insufficient_data",
        "calculation_status": "unsupported",
        "unavailable_components": ["kenya_spendable_cash"],
    }


def test_safe_to_spend_returns_lowest_projected_balance_and_reconciles_cash(monkeypatch):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol({
        "user_id": "user@example.com", "safe_to_spend_buffer": 10,
    }))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol())

    async def uk(_uid):
        return "UK"

    async def cashflow_response(_cached, uid=None):
        return {
            "upcoming_bills": [
                {"days_away": 1, "amount": 30.0},
                {
                    "days_away": 1,
                    "amount": 40.0,
                    "kind": analytics.MOVEMENT,
                    "dest_account_spendable": True,
                },
            ],
            "upcoming_income": [{"days_away": 1, "amount": 50.0}],
        }

    async def accounts(_uid):
        return [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def commitments(_uid):
        return 5, 1

    async def allocations(_uid):
        return 4.0, 1

    async def card_growth(_uid, _start, _today, _bills):
        return 3.0

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", allocations)
    monkeypatch.setattr(net_position, "card_growth_unpaid", card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)

    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    # The £30 debit lands before the same-day £50 income, so £70 is the true
    # low point. £70 - £10 buffer - £5 plan - £4 envelope = £51 before cards.
    assert result["lowest_projected_balance"] == 70.0
    assert result["safe_to_spend_cash"] == 51.0
    assert result["safe_to_spend"] == 48.0
    assert result["bills_total"] == 30.0
    assert result["pooled_transfers_excluded"] == 40.0
    assert result["calculation_status"] == "complete"
    assert result["unavailable_components"] == []


def test_safe_to_spend_marks_a_known_reserve_failure_degraded(monkeypatch):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol({"user_id": "user@example.com"}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol())

    async def uk(_uid):
        return "UK"

    async def cashflow_response(_cached, uid=None):
        return {"upcoming_bills": [], "upcoming_income": []}

    async def accounts(_uid):
        return [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def unavailable_commitments(_uid):
        raise RuntimeError("commitments store unavailable")

    async def no_allocations(_uid):
        return 0.0, 0

    async def no_card_growth(_uid, _start, _today, _bills):
        return 0.0

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", unavailable_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(net_position, "card_growth_unpaid", no_card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)

    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    assert result["status"] == "ok"  # Numeric compatibility is retained.
    assert result["calculation_status"] == "degraded"
    assert result["unavailable_components"] == ["commitments_reserve"]
    assert result["safe_to_spend"] == 0.0  # known reserve failures fail closed
    assert result["state"] == "short"
    assert result["short_reason"] is None


def test_preferences_patch_invalidates_every_cached_response_for_user(monkeypatch):
    prefs_col = _PrefsCol({"user_id": "user@example.com", "hide_net_worth": False, "dark_mode": True})
    cache = _CacheSpy()
    monkeypatch.setattr(preferences, "preferences_col", prefs_col)
    monkeypatch.setattr(preferences, "response_cache", cache)

    result = asyncio.run(preferences.update_preferences(
        {"safe_to_spend_buffer": 75}, {"email": "user@example.com"}
    ))

    assert cache.calls == [("user@example.com",)]
    assert result == {"hide_net_worth": False, "dark_mode": True}
