"""Focused Safe-to-Spend hardening tests.

These exercise the pure low-point walk, the active-consent account universe,
the unsupported-region guard, and preference-cache invalidation without
requiring Mongo.
"""
import asyncio
from datetime import date, datetime, timedelta, timezone

import app.routers.analytics as analytics
import app.routers.preferences as preferences
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.income as income_service
import app.services.net_position as net_position
import app.services.region as region_service


def test_safe_to_spend_cache_rejects_payload_from_old_arithmetic():
    assert not analytics._safe_to_spend_cache_current({
        "status": "ok",
        "safe_to_spend": -803.0,
        "short_reason": "cards",
    })
    assert analytics._safe_to_spend_cache_current({
        "status": "ok",
        "calculation_version": analytics.SAFE_TO_SPEND_CALCULATION_VERSION,
    })


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
    def __init__(self, doc=None):
        self.doc = doc or {"_id": "user@example.com"}

    async def find_one(self, _query):
        return self.doc


class _CacheSpy:
    def __init__(self):
        self.calls = []

    def invalidate(self, *args):
        self.calls.append(args)

    async def ainvalidate(self, uid):
        # preferences.update_preferences was converted to the awaited
        # variant (guarantees the version bump lands before the response
        # returns) — same call-recording behaviour as invalidate() above.
        self.calls.append((uid,))


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
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol({
        "_id": "user@example.com",
        "recurring_spend": [
            {"card_dest_account_id": "card1"},
            {"card_dest_account_id": "card2"},
        ],
    }))
    monkeypatch.setattr(analytics, "card_terms_col", _ListCol([
        {"account_id": "card1", "usage": "clear_monthly"},
        {"account_id": "card2", "usage": "carry"},
    ]))

    async def uk(_uid):
        return "UK"

    async def cashflow_response(_cached, uid=None):
        return {
            "upcoming_bills": [
                {
                    "days_away": 1,
                    "amount": 30.0,
                    "expected_date": "2026-09-18",
                    "kind": analytics.MOVEMENT,
                    "card_dest_account_id": "card1",
                },
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
        return [
            {"account_id": "card1", "net_change": 63.0, "growth": 63.0, "unpaid_growth": 63.0},
            {"account_id": "card2", "net_change": -60.0, "growth": 0.0, "unpaid_growth": 0.0},
        ]

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)

    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    # The £30 debit lands before the same-day £50 income, so £70 is the true
    # low point. £70 - £10 buffer - £5 plan - £4 envelope = £51 before cards.
    assert result["lowest_projected_balance"] == 70.0
    assert result["safe_to_spend_cash"] == 51.0
    assert result["safe_to_spend"] == 51.0
    assert result["card_growth_total"] == 3.0
    assert result["card_growth_reserved"] == 0.0
    assert result["card_growth_wording"] == "cleared_monthly"
    assert result["card_growth_due_date"] == "2026-09-18"
    assert result["bills_total"] == 30.0
    assert result["pooled_transfers_excluded"] == 40.0
    assert result["calculation_status"] == "complete"
    assert result["unavailable_components"] == []


def test_safe_to_spend_reserves_only_growth_without_a_learned_repayment(monkeypatch):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol({"user_id": "user@example.com"}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol({
        "_id": "user@example.com", "recurring_spend": [],
    }))
    monkeypatch.setattr(analytics, "card_terms_col", _ListCol([]))

    async def uk(_uid):
        return "UK"

    async def cashflow_response(_cached, uid=None):
        return {"upcoming_bills": [], "upcoming_income": []}

    async def accounts(_uid):
        return [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def no_commitments(_uid):
        return 0, 0

    async def no_allocations(_uid):
        return 0.0, 0

    async def unlearned_growth(_uid, _start, _today, _bills):
        return [
            {"account_id": "card1", "net_change": 200.0, "growth": 200.0, "unpaid_growth": 200.0},
            {"account_id": "card2", "net_change": -50.0, "growth": 0.0, "unpaid_growth": 0.0},
        ]

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", no_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", unlearned_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)

    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    assert result["safe_to_spend_cash"] == 100.0
    assert result["card_growth_total"] == 150.0
    # The unlearned card grew by £200, but a £50 paydown elsewhere means
    # the portfolio grew by £150. The fallback reserve is capped to that
    # visible total so the card fact and arithmetic still reconcile.
    assert result["card_growth_reserved"] == 150.0
    assert result["safe_to_spend"] == -50.0
    assert result["state"] == "short"
    assert result["short_reason"] == "cards_unconfirmed"


def test_safe_to_spend_fails_closed_when_card_growth_cannot_be_verified(monkeypatch):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol({"user_id": "user@example.com"}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol())

    async def uk(_uid):
        return "UK"

    async def cashflow_response(_cached, uid=None):
        return {"upcoming_bills": [], "upcoming_income": []}

    async def accounts(_uid):
        return [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]

    async def no_commitments(_uid):
        return 0, 0

    async def no_allocations(_uid):
        return 0.0, 0

    async def failed_growth(_uid, _start, _today, _bills):
        return None

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", no_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", failed_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)

    result = asyncio.run(analytics.compute_safe_to_spend("user@example.com"))

    assert result["calculation_status"] == "degraded"
    assert result["unavailable_components"] == ["card_growth_reserve"]
    assert result["safe_to_spend"] == 0.0
    assert result["short_reason"] is None


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
        return []

    async def monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(region_service, "get_user_region", uk)
    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", unavailable_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", no_card_growth)
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


# ── G35: pin the composed safe_to_spend figure against a fixed fixture ─────
#
# Kevin's Safe-to-Spend hero moved from £64 to £276 within a few hours with
# no transactions posted on the account (2026-09-10). The investigation
# (see the G35 backlog note) could not point at a single merged commit that
# changed the number inside that window — the one candidate that touches
# this exact arithmetic, G16 ("card_growth_reserved must stop being
# subtracted... for a card with a learned repayment series"), merged the
# night before the window started, and G24 explicitly preserves "the
# reserve math is untouched" (its own commit message) and only adds a
# display-only field. The likelier mechanism is a legitimate scheduled
# recompute (task_reconcile_truelayer, every 4h) reacting to new
# information from the bank — e.g. a predicted bill matched to a freshly
# observed PENDING debit (pending_transactions.py) is structurally excluded
# from upcoming_bills, or a recurring-series veto (recurring_judge.py,
# capped at MAX_JUDGEMENTS_PER_REFRESH=10 per refresh) reaching a series for
# the first time on a later tick — neither of which is a bug. But nothing
# in this codebase snapshots the number's own components over time (that
# gap is B18), so the exact mechanism for THIS particular jump could not be
# reconstructed after the fact.
#
# This test is the structural fix asked for regardless of cause: it exercises
# `compute_safe_to_spend` for real (not a mocked-away stub) against a FIXED,
# realistic fixture — bills and income landing on both sides of payday, a
# buffer, commitments and allocations reserves, and two credit cards (one
# with a learned repayment series, one without, so both the "growth is a
# fact, not always a reserve" rule AND the fail-closed fallback reserve are
# exercised) — and pins every named component of the response, not just the
# headline figure. A future change to this arithmetic (deliberate or not)
# must update this fixture's expected numbers explicitly; it can never move
# silently.
def test_safe_to_spend_pins_against_a_fixed_transaction_fixture(monkeypatch):
    uid = "g35-fixture@example.com"

    # Deterministic relative to "today" (never frozen system time) so the
    # test never rots, but still pins every component to a hand-derived
    # number — see the walk-through in the comments below.
    today = date.today()
    next_payday = today + timedelta(days=14)  # days_until_payday == 14
    last_synced = datetime(2026, 1, 1, 9, 30, 0, tzinfo=timezone.utc)

    prefs = {
        "user_id": uid,
        "safe_to_spend_buffer": 50.0,
        "pay_period_config": {"type": "calendar_month"},
    }

    # Two spendable pool accounts (one current, one savings — savings must
    # never enter spendable_now) and two credit cards, one growing on a
    # LEARNED repayment series (its growth is a fact only, never reserved)
    # and one with no learned series (its growth fails closed as a reserve).
    accounts = [
        {"name": "Current Account", "balance": 1000.0, "type": "bank",
         "subtype": "CURRENT", "currency": "GBP"},
        {"name": "Rainy Day Savings", "balance": 500.0, "type": "bank",
         "subtype": "SAVINGS", "currency": "GBP"},
        {"name": "Card A (learned repayment)", "balance": -400.0,
         "type": "credit card", "subtype": "CREDIT", "currency": "GBP"},
        {"name": "Card B (no learned repayment)", "balance": -150.0,
         "type": "credit card", "subtype": "CREDIT", "currency": "GBP"},
    ]
    # spendable_now = 1000.0 (savings + both credit cards excluded from the
    # pool entirely by _account_pool_kind); card_debt = 400 + 150 = 550.0.

    bills = [
        {"name": "Rent", "days_away": 3, "amount": 600.0, "kind": "commitment"},
        {"name": "Council Tax", "days_away": 10, "amount": 150.0, "kind": "commitment"},
        # A pooled transfer into an account already counted in spendable_now
        # must be excluded from bills_total AND the lowest-balance walk —
        # this is the G19/pooled-transfers guard, exercised here.
        {"name": "Move between own current accounts", "days_away": 5,
         "amount": 200.0, "kind": analytics.MOVEMENT, "dest_account_spendable": True},
        # A movement to savings is a real outflow from the spendable pool
        # (not pooled-excluded) — stays in the walk.
        {"name": "Move to savings", "days_away": 6, "amount": 100.0,
         "kind": analytics.MOVEMENT, "dest_account_spendable": False},
    ]
    # window_bills (pooled transfer excluded) = Rent(600) + Council Tax(150)
    #   + Move to savings(100) = 850.0; pooled_transfers_excluded = 200.0.

    income = [
        {"name": "Freelance invoice", "days_away": 7, "amount": 300.0},
        # Lands exactly ON payday (days_away == days_until_payday), so this
        # is payday_income, not income_before_payday.
        {"name": "Salary", "days_away": 14, "amount": 2000.0},
    ]
    # income_before_payday = 300.0; payday_income = 2000.0.

    # Lowest-balance walk from spendable_now=1000, debit-before-income on a
    # shared day (none share a day here, but the ordering rule still
    # applies): day3 -600=400 (min) -> day6 -100=300 (min) -> day7 +300=600
    # -> day10 -150=450. lowest_projected_balance = 300.0.
    # safe_to_spend after buffer: 300 - 50 = 250.0
    # after commitments_reserved (40): 250 - 40 = 210.0
    # after allocations_reserved (30.5): 210 - 30.5 = 179.5  (== safe_to_spend_cash)
    # card_growth_total = 120 (Card A, learned) + 80 (Card B, unlearned) = 200.0
    # card_growth_reserved = min(200.0, unlearned_growth=80.0) = 80.0
    # final safe_to_spend: 179.5 - 80.0 = 99.5

    async def fake_region(_uid):
        return "UK"

    def fake_confirmed_payday(_prefs, _today):
        return (next_payday, {"schedule": "fixed"})

    async def fake_cashflow_response(_cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income}

    async def fake_accounts(_uid):
        return accounts

    async def fake_commitments(_uid):
        return 40, 2

    async def fake_allocations(_uid):
        return 30.5, 1

    async def fake_card_growth(_uid, _period_start, _today, _window_bills):
        return [
            {"account_id": "cardA", "net_change": 120.0, "growth": 120.0,
             "unpaid_growth": 120.0, "new_spend": 90.0},
            {"account_id": "cardB", "net_change": 80.0, "growth": 80.0,
             "unpaid_growth": 80.0, "new_spend": 80.0},
        ]

    async def fake_monthly_cashflow(_uid, _region, _cutoff):
        return {"spending": 2000.0, "n_months": 3}

    async def fake_last_sync(_uid):
        return last_synced

    monkeypatch.setattr(
        analytics, "preferences_col", _PrefsCol(prefs),
    )
    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        _CacheDocCol({
            "_id": uid,
            # Card A's repayment series has been learned onto its account —
            # this is what keeps its growth OUT of the fail-closed reserve.
            "recurring_spend": [{"card_dest_account_id": "cardA"}],
        }),
    )
    monkeypatch.setattr(analytics, "card_terms_col", _ListCol([]))
    monkeypatch.setattr(region_service, "get_user_region", fake_region)
    monkeypatch.setattr(income_service, "get_confirmed_payday", fake_confirmed_payday)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", fake_accounts)
    monkeypatch.setattr(commitments_router, "total_reserved_slices", fake_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", fake_allocations)
    monkeypatch.setattr(net_position, "card_growth_by_card", fake_card_growth)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", fake_monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", fake_last_sync)

    result = asyncio.run(analytics.compute_safe_to_spend(uid))

    assert result["status"] == "ok"
    assert result["calculation_status"] == "complete"
    assert result["unavailable_components"] == []

    # The composed headline figure and its pre-card-reserve twin.
    assert result["safe_to_spend"] == 99.5
    assert result["safe_to_spend_cash"] == 179.5

    # Every named component that feeds it, so a future change can never
    # move the headline number without this test naming exactly which
    # component moved and by how much.
    assert result["next_payday"] == next_payday.isoformat()
    assert result["days_until_payday"] == 14
    assert result["bills_total"] == 850.0
    assert result["pooled_transfers_excluded"] == 200.0
    assert result["income_before_payday"] == 300.0
    assert result["payday_income"] == 2000.0
    assert result["buffer"] == 50.0
    assert result["spendable_now"] == 1000.0
    assert result["lowest_projected_balance"] == 300.0
    assert result["card_debt"] == 550.0
    assert result["card_growth_total"] == 200.0
    assert result["card_new_spend_total"] == 170.0
    assert result["card_growth_reserved"] == 80.0
    assert result["card_growth_wording"] == "carried"
    assert result["card_growth_due_date"] is None
    assert result["commitments_reserved"] == 40
    assert result["commitments_count"] == 2
    assert result["commitments_reserved_period_label"] == "monthly"
    assert result["allocations_reserved"] == 30.5
    assert result["allocations_count"] == 1
    assert result["last_synced"] == last_synced.isoformat()

    # state/short_reason/estimated derive from the figures above; pinned so
    # a change to their thresholds is also forced through this test.
    assert result["state"] == "tight"
    assert result["short_reason"] is None
    assert result["estimated"] is False
