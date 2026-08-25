"""Unit tests for app.services.net_position — `card_growth_unpaid`,
`period_net`, and `short_reason_for` (the pure derivation
`compute_safe_to_spend` uses to distinguish a genuine bills-risk short from
a purely card-funded short).

No mongomock is available in this environment (see test_notifications.py's
own note); these tests monkeypatch the async helpers net_position.py's
lazy imports pull in (needle._credit_card_account_ids/_txns_for_period/
_card_delta, spend_verdict._load_period_txns, categories.get_category_kinds,
db.collections.preferences_col) at their SOURCE modules, matching the
monkeypatch-the-module-level-name pattern test_notifications.py and
test_transfer_pairs.py already established — a lazy `from X import Y` inside
a function body reads the patched attribute off module X at call time.
"""
import asyncio
from datetime import date

import app.db.collections as collections
import app.services.categories as categories
import app.services.needle as needle
import app.services.spend_verdict as spend_verdict
from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.net_position import card_growth_unpaid, period_net, short_reason_for

KIND_MAP = dict(BUILTIN_CATEGORY_KINDS)


class _FakePrefsCol:
    def __init__(self, doc):
        self._doc = doc

    async def find_one(self, query):
        return self._doc


def txn(category, amount, *, debit=True, merchant="", desc="", d=None, account_id="a"):
    return {
        "date": d or date.today(), "category": category, "amount": abs(float(amount)),
        "debit": debit, "merchant_name": merchant, "description": desc, "id": "x",
        "account_id": account_id,
    }


# ── card_growth_unpaid ───────────────────────────────────────────────────

def test_card_growth_floored_at_zero_when_cards_paid_down(monkeypatch):
    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return -75.0  # cards shrank this period

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    result = asyncio.run(card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert result == 0.0


def test_card_growth_double_count_guard_subtracts_scheduled_card_bill(monkeypatch):
    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return 200.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    window_bills = [
        {"account_id": "card1", "amount": 80.0},   # resolves to the card — subtracted
        {"account_id": "current-acc", "amount": 40.0},  # not a card — untouched
    ]
    result = asyncio.run(
        card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25), window_bills)
    )
    assert result == 120.0  # 200 - 80


def test_card_growth_guard_skipped_when_bill_has_no_account_id(monkeypatch):
    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return 200.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    window_bills = [{"amount": 80.0}]  # no account_id key at all
    result = asyncio.run(
        card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25), window_bills)
    )
    assert result == 200.0  # guard skipped — nothing subtracted


def test_card_growth_guard_matches_via_is_credit_card_flag_when_account_id_differs(monkeypatch):
    """is_credit_card is the PRIMARY signal — a bill dict whose account_id
    doesn't line up with the card-growth account-id set (a real possibility:
    the delta comes from `_credit_card_account_ids`/native+Yapily txn
    collections, the bill window is built independently) must still be
    caught via the explicit flag analytics.py already computes."""
    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return 200.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    window_bills = [{"account_id": "some-other-spelling", "amount": 80.0, "is_credit_card": True}]
    result = asyncio.run(
        card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25), window_bills)
    )
    assert result == 120.0  # 200 - 80, matched via is_credit_card despite account_id mismatch


def test_card_growth_guard_explicit_false_is_credit_card_not_overridden_by_account_id(monkeypatch):
    """An explicit is_credit_card=False is trusted even when account_id
    happens to collide with the card-id set — the flag is the primary,
    known-good signal and must not be second-guessed by the fallback."""
    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return 200.0

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    window_bills = [{"account_id": "card1", "amount": 80.0, "is_credit_card": False}]
    result = asyncio.run(
        card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25), window_bills)
    )
    assert result == 200.0  # not subtracted — explicit False wins


def test_card_growth_no_card_accounts_returns_zero(monkeypatch):
    async def fake_card_ids(uid):
        return set()

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    result = asyncio.run(card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert result == 0.0


def test_card_growth_failure_tolerant_returns_zero(monkeypatch):
    async def boom(uid):
        raise RuntimeError("db down")

    monkeypatch.setattr(needle, "_credit_card_account_ids", boom)
    result = asyncio.run(card_growth_unpaid("kevin", date(2026, 8, 1), date(2026, 8, 25)))
    assert result == 0.0


# ── short_reason_for ──────────────────────────────────────────────────────

def test_short_reason_none_when_not_short():
    assert short_reason_for("comfortable", 500.0) is None
    assert short_reason_for("tight", 50.0) is None


def test_short_reason_bills_when_cash_pot_itself_non_positive():
    assert short_reason_for("short", 0.0) == "bills"
    assert short_reason_for("short", -20.0) == "bills"


def test_short_reason_cards_when_bills_covered_but_net_short():
    assert short_reason_for("short", 40.0) == "cards"


# ── period_net ────────────────────────────────────────────────────────────

def test_period_net_excludes_movement_from_income_and_outflow(monkeypatch):
    prefs = _FakePrefsCol({"user_id": "kevin", "pay_period_config": {"type": "calendar_month"}})
    monkeypatch.setattr(collections, "preferences_col", prefs)

    async def fake_kind_map(uid):
        return KIND_MAP

    monkeypatch.setattr(categories, "get_category_kinds", fake_kind_map)

    txns = [
        txn("Groceries", 50.0, merchant="Tesco"),
        txn("Income", 1000.0, merchant="Employer", debit=False),
        txn("Savings", 300.0, merchant="Pot"),        # MOVEMENT — excluded from both
        txn("Debt", 150.0, merchant="Barclaycard"),    # MOVEMENT — excluded from both
    ]

    async def fake_load(uid, start, end):
        return txns

    monkeypatch.setattr(spend_verdict, "_load_period_txns", fake_load)

    async def fake_card_ids(uid):
        return set()

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)

    result = asyncio.run(period_net("kevin"))
    assert result is not None
    assert result["income"] == 1000.0
    assert result["outflow"] == 50.0
    assert result["net"] == 950.0
    assert result["card_growth"] == 0.0


def test_period_net_card_growth_is_signed_not_floored(monkeypatch):
    prefs = _FakePrefsCol({"pay_period_config": {"type": "calendar_month"}})
    monkeypatch.setattr(collections, "preferences_col", prefs)

    async def fake_kind_map(uid):
        return KIND_MAP

    monkeypatch.setattr(categories, "get_category_kinds", fake_kind_map)

    async def fake_load(uid, start, end):
        return []

    monkeypatch.setattr(spend_verdict, "_load_period_txns", fake_load)

    async def fake_card_ids(uid):
        return {"card1"}

    async def fake_txns(uid, start, end, account_ids=None):
        return []

    def fake_delta(txns):
        return -40.0  # cards were paid down this period

    monkeypatch.setattr(needle, "_credit_card_account_ids", fake_card_ids)
    monkeypatch.setattr(needle, "_txns_for_period", fake_txns)
    monkeypatch.setattr(needle, "_card_delta", fake_delta)

    result = asyncio.run(period_net("kevin"))
    assert result is not None
    assert result["card_growth"] == -40.0  # descriptive, never floored


def test_period_net_failure_tolerant_returns_none(monkeypatch):
    prefs = _FakePrefsCol({"pay_period_config": {"type": "calendar_month"}})
    monkeypatch.setattr(collections, "preferences_col", prefs)

    async def boom(uid):
        raise RuntimeError("boom")

    monkeypatch.setattr(categories, "get_category_kinds", boom)

    async def fake_load(uid, start, end):
        return []

    monkeypatch.setattr(spend_verdict, "_load_period_txns", fake_load)

    result = asyncio.run(period_net("kevin"))
    assert result is None
