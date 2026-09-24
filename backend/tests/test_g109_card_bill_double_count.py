"""Tests for G109: a bill on a credit card was counted against cash twice —
once when it hit the card, again when the card was repaid.

Kevin, 2026-09-16: a £180 Anthropic subscription on the Amex dropped
projected cash from £603 to £423 even though no cash moves when a card is
charged, then the separate Amex repayment from Barclays reduced it again.

Root cause: `compute_safe_to_spend`'s `window_bills` (routers/analytics.py,
just above the running-balance walk) was filtered only by
`_is_pooled_spendable_transfer` — it never excluded a bill sitting ON a
credit card, so a card charge subtracted from the walk exactly like a real
debit, on top of the separate repayment bill that (correctly) also
subtracted from it.

Fix: `_touches_pooled_cash`, a new predicate next to
`_is_pooled_spendable_transfer`, composed into `window_bills`'s own filter
(analytics.py, the only call site). The cash-led rule, three categories
split by the POOL BOUNDARY:
  - a charge ON a credit card does NOT reduce cash (excluded here)
  - a payment TO a card DOES reduce cash (its own account is never a card,
    so it is untouched by this predicate)
  - a movement between two pooled accounts does NOT reduce cash (already
    `_is_pooled_spendable_transfer`, unchanged)

`window_bills` is also what `net_position.card_growth_by_card` receives as
its own `window_bills` argument (step 6c, the card-growth fallback
reserve), so this same filter change is what stops that function's
double-count guard from matching a future CHARGE against its own card and
silently shrinking the fail-closed reserve for a card with no learned
repayment — see `test_reserve_still_catches_growth_with_no_predicted_repayment`
below, which is the dangerous-failure-mode check the ticket calls for.

Same fake-Mongo/monkeypatch conventions as test_safe_to_spend_hardening.py
(no mongomock in this environment).
"""
import asyncio
from datetime import date, timedelta

import app.routers.analytics as analytics
import app.routers.allocations as allocations_router
import app.routers.commitments as commitments_router
import app.services.cashflow as cashflow_service
import app.services.categories as categories
import app.services.income as income_service
import app.services.needle as needle
import app.services.net_position as net_position
from app.services.categories import BUILTIN_CATEGORY_KINDS

UID = "kevin@example.com"
KIND_MAP = dict(BUILTIN_CATEGORY_KINDS)


async def _fake_kinds(_uid):
    return KIND_MAP


class _ListCol:
    def __init__(self, docs):
        self.docs = list(docs)

    def find(self, query, projection=None):
        return self

    async def to_list(self, _limit):
        return list(self.docs)


class _PrefsCol:
    def __init__(self, doc=None):
        self.doc = doc or {"user_id": UID}

    async def find_one(self, _query):
        return self.doc


class _CacheDocCol:
    def __init__(self, doc=None):
        self.doc = doc or {"_id": UID}

    async def find_one(self, _query):
        return self.doc


def _wire_common(monkeypatch, *, recurring_spend=None):
    monkeypatch.setattr(analytics, "preferences_col", _PrefsCol({"user_id": UID}))
    monkeypatch.setattr(analytics, "cashflow_cache_col", _CacheDocCol({
        "_id": UID, "recurring_spend": recurring_spend or [],
    }))
    monkeypatch.setattr(analytics, "card_terms_col", _ListCol([]))

    async def no_commitments(_uid):
        return 0, 0

    async def no_allocations(_uid):
        return 0.0, 0

    async def monthly_cashflow(_uid, _cutoff):
        return {"spending": 0.0, "n_months": 3}

    async def no_sync(_uid):
        return None

    monkeypatch.setattr(commitments_router, "total_reserved_slices", no_commitments)
    monkeypatch.setattr(allocations_router, "total_reserved_remaining", no_allocations)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow_cached", monthly_cashflow)
    monkeypatch.setattr(analytics, "last_bank_sync", no_sync)


def _wire_bills_and_accounts(monkeypatch, bills, accounts, income=None):
    async def cashflow_response(_cached, uid=None):
        return {"upcoming_bills": bills, "upcoming_income": income or []}

    async def accounts_fn(_uid):
        return accounts

    monkeypatch.setattr(analytics, "_build_cashflow_response", cashflow_response)
    monkeypatch.setattr(analytics, "_safe_to_spend_accounts", accounts_fn)


# ── The shared predicate itself ─────────────────────────────────────────────

def test_touches_pooled_cash_excludes_a_credit_card_charge():
    assert analytics._touches_pooled_cash({"is_credit_card": True}) is False


def test_touches_pooled_cash_includes_an_ordinary_debit():
    assert analytics._touches_pooled_cash({"is_credit_card": False}) is True


def test_touches_pooled_cash_includes_a_repayment_bill_to_a_card():
    """A repayment's OWN account is the paying current account, never the
    card — its is_credit_card is false regardless of card_dest_account_id."""
    repayment = {
        "kind": analytics.MOVEMENT,
        "is_credit_card": False,
        "card_dest_account_id": "amex",
        "dest_account_spendable": None,
    }
    assert analytics._touches_pooled_cash(repayment) is True


def test_touches_pooled_cash_defaults_true_for_a_bill_missing_the_field():
    """Fail toward including a real debit rather than silently dropping it
    for an older cached shape that predates the flag."""
    assert analytics._touches_pooled_cash({}) is True


# ── compute_safe_to_spend: the four synthetic scenarios the ticket asks for ─

def test_a_charge_on_a_credit_card_does_not_reduce_the_walk(monkeypatch):
    """The exact Kevin shape: £180 Anthropic charge sitting on the Amex.
    card_growth_by_card is stubbed to [] here so this test isolates the
    walk itself from the separate reserve mechanism (covered below)."""
    _wire_common(monkeypatch)
    bills = [{
        "name": "Anthropic", "days_away": 2, "amount": 180.0,
        "expected_date": "2026-09-18", "kind": "discretionary",
        "account_id": "amex", "is_credit_card": True,
    }]
    accounts = [{"balance": 603.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def no_growth(_uid, _start, _today, _bills, _excluded=None):
        return []

    monkeypatch.setattr(net_position, "card_growth_by_card", no_growth)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    assert result["bills_total"] == 0.0  # the card charge never enters window_bills
    assert result["lowest_projected_balance"] == 603.0
    assert result["safe_to_spend"] == 603.0


def test_a_repayment_to_that_card_does_reduce_the_walk(monkeypatch):
    """The separate Amex repayment from Barclays — a MOVEMENT bill whose
    OWN account is Barclays (not a card), so is_credit_card is false on the
    bill itself even though card_dest_account_id names the card."""
    _wire_common(monkeypatch)
    bills = [{
        "name": "Amex repayment", "days_away": 2, "amount": 180.0,
        "expected_date": "2026-09-18", "kind": analytics.MOVEMENT,
        "account_id": "barclays", "is_credit_card": False,
        "card_dest_account_id": "amex", "dest_account_spendable": None,
    }]
    accounts = [{"balance": 603.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def no_growth(_uid, _start, _today, _bills, _excluded=None):
        return []

    monkeypatch.setattr(net_position, "card_growth_by_card", no_growth)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    assert result["bills_total"] == 180.0
    assert result["lowest_projected_balance"] == 423.0
    assert result["safe_to_spend"] == 423.0


def test_charge_and_its_repayment_together_reduce_cash_only_once(monkeypatch):
    """The full reproduction of Kevin's bug report: the £180 charge AND the
    £180 repayment both in the window. Before the fix this walked to
    603 - 180 (charge) - 180 (repayment) = 243. After the fix, only the
    repayment (the actual cash leaving Barclays) counts: 603 - 180 = 423."""
    _wire_common(monkeypatch)
    bills = [
        {
            "name": "Anthropic", "days_away": 1, "amount": 180.0,
            "expected_date": "2026-09-17", "kind": "discretionary",
            "account_id": "amex", "is_credit_card": True,
        },
        {
            "name": "Amex repayment", "days_away": 3, "amount": 180.0,
            "expected_date": "2026-09-19", "kind": analytics.MOVEMENT,
            "account_id": "barclays", "is_credit_card": False,
            "card_dest_account_id": "amex", "dest_account_spendable": None,
        },
    ]
    accounts = [{"balance": 603.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def no_growth(_uid, _start, _today, _bills, _excluded=None):
        return []

    monkeypatch.setattr(net_position, "card_growth_by_card", no_growth)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    assert result["bills_total"] == 180.0  # only the repayment, not the charge too
    assert result["safe_to_spend"] == 423.0  # not 243


def test_a_movement_between_two_pooled_accounts_does_not_reduce_cash(monkeypatch):
    """The other side of the pool boundary, unrelated to credit cards: a
    traced standing order into another of the user's own spendable accounts
    stays a no-op even in the same window as a card charge and a repayment,
    proving the two exclusions (`_is_pooled_spendable_transfer` and
    `_touches_pooled_cash`) compose correctly rather than fighting."""
    _wire_common(monkeypatch)
    bills = [
        {
            "name": "Anthropic", "days_away": 1, "amount": 180.0,
            "expected_date": "2026-09-17", "kind": "discretionary",
            "account_id": "amex", "is_credit_card": True,
        },
        {
            "name": "To ISA saver", "days_away": 1, "amount": 50.0,
            "expected_date": "2026-09-17", "kind": analytics.MOVEMENT,
            "account_id": "barclays", "is_credit_card": False,
            "dest_account_spendable": True,
        },
    ]
    accounts = [{"balance": 603.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def no_growth(_uid, _start, _today, _bills, _excluded=None):
        return []

    monkeypatch.setattr(net_position, "card_growth_by_card", no_growth)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    assert result["bills_total"] == 0.0
    assert result["pooled_transfers_excluded"] == 50.0
    assert result["safe_to_spend"] == 603.0


def test_reserve_still_catches_growth_with_no_predicted_repayment(monkeypatch):
    """The dangerous-failure-mode check the ticket calls out by name: a
    card is growing (spending on it) but has NO learned repayment series at
    all, and this period's cache still carries a future occurrence of that
    same charge (e.g. next month's Anthropic bill) inside the window.

    `card_growth_by_card` is NOT stubbed here — the real function runs
    against the REAL (filtered) `window_bills` `compute_safe_to_spend`
    builds, with only its own Mongo/txn reads faked (same pattern as
    test_net_position.py). This proves the coupling: because the charge
    bill no longer reaches `window_bills` at all (G109's fix), it can no
    longer be mismatched as a "scheduled" repayment against its own card
    (the pre-existing double-count guard in card_growth_by_card), so the
    fail-closed reserve still reserves the full £200 PAST growth rather
    than quietly discounting it by the £180 future charge, AND (G109
    follow-up) the £180 charge itself, which has not POSTED yet and so is
    invisible to `growth` (transaction-history based), is reserved
    separately via `card_charges_excluded_from_walk` -- £200 + £180 = £380,
    not just £200. Without that follow-up, the £180 would be caught by
    NEITHER the cash walk (correctly excluded, it's not cash leaving yet)
    NOR the reserve (nothing has posted yet), overstating cash by £180.

    G137, 2026-09-21: originally written against `days_away: 10` under an
    UNPINNED "today" (`compute_safe_to_spend` reads `date.today()`
    directly), relying on `get_confirmed_payday` finding no confirmed
    income stream in this fixture's bare prefs doc and falling back to the
    default "calendar_month" pay config, whose payday is a fixed calendar
    date (the 1st of next month) rather than one that moves with "today".
    `days_until_payday` was 15 the day this was written and shrinks by one
    for every day the suite runs on, so a real calendar month's final ~10
    days push `days_away: 10` outside `0 <= days_away < days_until_payday`
    and the charge silently drops out of `raw_window_bills` altogether —
    that is exactly what turned this into a false pass at 200.0 instead of
    380.0 (see G137). Anchored below to a payday fixed at "today" + 15 days
    (`get_confirmed_payday` monkeypatched the same way
    `test_safe_to_spend_pins_against_a_fixed_transaction_fixture` in
    test_safe_to_spend_hardening.py does it), so `days_away: 10` is inside
    the window on every calendar day, not just the day this was written.
    """
    _wire_common(monkeypatch, recurring_spend=[])  # no card_dest_account_id anywhere -> unlearned

    today = date.today()
    next_payday = today + timedelta(days=15)  # days_until_payday == 15, always

    def fake_confirmed_payday(_prefs, _today):
        return (next_payday, {"schedule": "fixed"})

    monkeypatch.setattr(income_service, "get_confirmed_payday", fake_confirmed_payday)

    bills = [{
        # A future occurrence of the SAME recurring charge that produced
        # this period's growth — is_credit_card true, no card_dest link.
        # days_away MUST stay inside the window (`raw_window_bills` keeps
        # `0 <= days_away < days_until_payday`, pinned to 15 above by the
        # fake_confirmed_payday monkeypatch): a charge dated after payday
        # never reaches `window_bills` for the ordinary calendar reason and
        # would make this test pass without exercising either the
        # exclusion or the reserve.
        "name": "Anthropic", "days_away": 10, "amount": 180.0,
        "expected_date": (today + timedelta(days=10)).isoformat(), "kind": "discretionary",
        "account_id": "amex", "is_credit_card": True,
    }]
    accounts = [{"balance": 100.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def fake_card_ids(_uid):
        return {"amex"}

    async def fake_txns(_uid, _start, _end, account_ids=None):
        return []  # the £200 growth fact is injected via _card_delta below

    def fake_delta(_txns):
        return 200.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)
    monkeypatch.setattr(categories, "get_category_kinds", _fake_kinds)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    # window_bills passed the £180 future charge through with is_credit_card
    # excluded from the walk (bills_total stays 0), so nothing already
    # accounted for it via the walk — the reserve must carry the full £200
    # PAST growth (not £20 = 200 - 180, the pre-fix double-count-guard
    # mismatch) PLUS the £180 not-yet-posted future charge on top.
    assert result["bills_total"] == 0.0
    assert result["card_growth_total"] == 200.0
    assert result["card_growth_reserved"] == 380.0
    assert result["safe_to_spend"] == -280.0
    assert result["state"] == "short"


def test_reserve_catches_a_not_yet_posted_charge_even_with_zero_past_growth(monkeypatch):
    """The purest form of the gap: a card with NO transaction history at
    all this period (growth=0 — e.g. a brand new card, or one that simply
    hasn't been used until today) whose only exposure is a single
    forecasted charge that has not posted yet. Before the G109 follow-up,
    `card_growth_by_card` would skip this card entirely (net_change == 0
    and new_spend == 0 with no `future_unposted_charges` field to check),
    so the reserve would sit at £0 while a real, predicted charge sat
    completely unaccounted for — cash overstated by the full amount.
    """
    _wire_common(monkeypatch, recurring_spend=[])
    bills = [{
        "name": "New Phone Contract", "days_away": 3, "amount": 45.0,
        "expected_date": "2026-09-19", "kind": "commitment",
        "account_id": "newcard", "is_credit_card": True,
    }]
    accounts = [{"balance": 200.0, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}]
    _wire_bills_and_accounts(monkeypatch, bills, accounts)

    async def fake_card_ids(_uid):
        return {"newcard"}

    async def fake_txns(_uid, _start, _end, account_ids=None):
        return []  # nothing has posted on this card yet this period

    def fake_delta(_txns):
        return 0.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)
    monkeypatch.setattr(categories, "get_category_kinds", _fake_kinds)

    result = asyncio.run(analytics.compute_safe_to_spend(UID))

    assert result["bills_total"] == 0.0  # the charge never enters the cash walk
    assert result["card_growth_total"] == 0.0  # nothing has posted — the descriptive fact stays honest
    assert result["card_growth_reserved"] == 45.0  # but the forecasted charge is still reserved for
    assert result["safe_to_spend"] == 155.0  # 200 - 45, not 200
