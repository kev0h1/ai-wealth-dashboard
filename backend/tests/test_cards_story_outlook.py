"""Coverage for the per-card "outlook" fields GET /cards/story grafts onto
its existing payload (app/routers/cards.py, G10, 2026-09-09): payoff_month,
promo_end, apr_pct, paying_interest, monthly_interest_now, cleared_monthly
per card, plus the top-level extra_to_clear — all sourced from
app.services.debt_plan.get_debt_plan_cached and matched onto the story's
own per_card rows by account_id.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny fakes (same pattern as
test_cycle_story_cards_breakdown.py), and get_debt_plan_cached itself is
monkeypatched at the module level cards.py imported it into — these tests
exercise cards_story's matching/degrading logic, not compute_debt_plan.
"""
import asyncio
import logging
from datetime import date, datetime

import app.routers.cards as cards


UID = "kevin"


class _FixedDate(date):
    """Pins `date.today()` inside app.routers.cards so the "current month"
    lookup _current_apr_and_promo_end does against rate_schedule segments
    is deterministic regardless of when this suite runs."""

    _fixed = date(2026, 9, 9)

    @classmethod
    def today(cls):
        return cls._fixed


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self

    async def to_list(self, n):
        return list(self._docs[: n if n is not None else len(self._docs)])


class FakeCol:
    """Stand-in for a Motor collection — only the handful of methods
    cards_story's dependencies actually call are implemented."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _FakeCursor(self.docs)

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None


def _acc(account_id, name, provider, balance):
    return {"account_id": account_id, "name": name, "provider": provider, "balance": balance}


def _txn(account_id, amount, on_date, ttype):
    return {
        "account_id": account_id,
        "amount": amount,
        "date": datetime(on_date.year, on_date.month, on_date.day),
        "transaction_type": ttype,
        "category": "Shopping",
        "custom_category": None,
    }


def _plan_card(account_id, *, payoff_month=None, rate_schedule=None, paying_interest=False,
                monthly_interest_now=0.0, classification="carried_zero"):
    return {
        "account_id": account_id,
        "payoff_month": payoff_month,
        "rate_schedule": rate_schedule or [],
        "paying_interest": paying_interest,
        "monthly_interest_now": monthly_interest_now,
        "classification": classification,
    }


def _run(monkeypatch, accounts, cc_ids, txns, *, plan=None, plan_raises=False, which="current"):
    monkeypatch.setattr(cards, "date", _FixedDate)
    monkeypatch.setattr(cards, "preferences_col", FakeCol([]))
    monkeypatch.setattr(cards, "accounts_col", FakeCol(accounts))
    monkeypatch.setattr(cards, "account_rates_col", FakeCol([]))
    monkeypatch.setattr(cards, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(cards, "needle_history_col", FakeCol([]))

    async def _fake_cc_ids(uid):
        return set(cc_ids)

    async def _fake_txns_for_period(uid, start, end, account_ids=None):
        return txns

    monkeypatch.setattr(cards, "_credit_card_account_ids", _fake_cc_ids)
    monkeypatch.setattr(cards, "_txns_for_period", _fake_txns_for_period)

    async def _fake_get_debt_plan_cached(uid):
        if plan_raises:
            raise RuntimeError("debt engine had a bad day")
        return plan or {"cards": [], "extra_to_clear": None}

    monkeypatch.setattr(cards, "get_debt_plan_cached", _fake_get_debt_plan_cached)

    return asyncio.run(cards.cards_story(user={"email": UID}, which=which))


D1 = date(2026, 9, 5)


def test_outlook_fields_present_and_mapped_per_card(monkeypatch):
    accounts = [
        _acc("cc_promo", "Amex BA", "amex", -1064.0),
        _acc("cc_interest", "NatWest Mastercard", "natwest", -7552.0),
    ]
    cc_ids = {"cc_promo", "cc_interest"}
    txns = [
        _txn("cc_promo", 50.0, D1, "debit"),
        _txn("cc_interest", 40.0, D1, "debit"),
    ]
    plan = {
        "cards": [
            _plan_card(
                "cc_promo",
                payoff_month="2027-01",
                rate_schedule=[
                    {"from": "2026-01", "until": "2027-02", "apr_pct": 0.0, "source": "promo", "kind": "purchases"},
                    {"from": "2027-03", "until": None, "apr_pct": 22.9, "source": "standard", "kind": None},
                ],
                paying_interest=False,
                monthly_interest_now=0.0,
                classification="carried_zero",
            ),
            _plan_card(
                "cc_interest",
                payoff_month="2028-03",
                rate_schedule=[
                    {"from": "2026-01", "until": None, "apr_pct": 27.9, "source": "standard", "kind": None},
                ],
                paying_interest=True,
                monthly_interest_now=168.0,
                classification="carried_interest",
            ),
        ],
        "extra_to_clear": {"amount": 95, "debt_free_month": "2027-06", "horizon_months": 120},
    }

    story = _run(monkeypatch, accounts, cc_ids, txns, plan=plan)

    by_id = {c["account_id"]: c for c in story["per_card"]}

    promo = by_id["cc_promo"]
    assert promo["payoff_month"] == "2027-01"
    assert promo["apr_pct"] == 0.0
    assert promo["promo_end"] == "2027-02"
    assert promo["paying_interest"] is False
    assert promo["monthly_interest_now"] == 0.0
    assert promo["cleared_monthly"] is False

    interest = by_id["cc_interest"]
    assert interest["payoff_month"] == "2028-03"
    assert interest["apr_pct"] == 27.9
    assert interest["promo_end"] is None
    assert interest["paying_interest"] is True
    assert interest["monthly_interest_now"] == 168.0
    assert interest["cleared_monthly"] is False

    assert story["extra_to_clear"] == {"extra_per_month": 95, "debt_free_month": "2027-06"}


def test_cleared_monthly_card_flagged(monkeypatch):
    accounts = [_acc("cc_float", "Amex Corp Green", "amex", -100.0)]
    cc_ids = {"cc_float"}
    txns = [_txn("cc_float", 100.0, D1, "debit")]
    plan = {
        "cards": [
            _plan_card(
                "cc_float",
                payoff_month=None,
                rate_schedule=[],
                paying_interest=False,
                monthly_interest_now=0.0,
                classification="cleared_monthly",
            ),
        ],
        "extra_to_clear": None,
    }

    story = _run(monkeypatch, accounts, cc_ids, txns, plan=plan)
    card = story["per_card"][0]
    assert card["cleared_monthly"] is True
    assert card["payoff_month"] is None
    assert story["extra_to_clear"] is None


def test_debt_plan_failure_degrades_to_plain_story_with_warning(monkeypatch, caplog):
    accounts = [_acc("cc_a", "Some Card", "hsbc", -500.0)]
    cc_ids = {"cc_a"}
    txns = [_txn("cc_a", 50.0, D1, "debit")]

    with caplog.at_level(logging.WARNING, logger="app.routers.cards"):
        story = _run(monkeypatch, accounts, cc_ids, txns, plan_raises=True)

    assert story["status"] == "ok"
    card = story["per_card"][0]
    assert card["account_id"] == "cc_a"
    assert card["payoff_month"] is None
    assert card["promo_end"] is None
    assert card["apr_pct"] is None
    assert card["paying_interest"] is None
    assert card["monthly_interest_now"] is None
    assert card["cleared_monthly"] is None
    assert story["extra_to_clear"] is None
    assert any("debt plan unavailable" in r.message for r in caplog.records)


def test_card_with_no_matching_plan_entry_stays_null(monkeypatch):
    """A card the story knows about but the debt plan has nothing for
    (e.g. it isn't a credit_card_account per is_credit_card_account, or
    the plan simply omits it) must not raise a KeyError and must keep the
    outlook fields null rather than fabricating anything."""
    accounts = [_acc("cc_orphan", "Orphan Card", "hsbc", -50.0)]
    cc_ids = {"cc_orphan"}
    txns = [_txn("cc_orphan", 60.0, D1, "debit")]
    plan = {"cards": [], "extra_to_clear": None}

    story = _run(monkeypatch, accounts, cc_ids, txns, plan=plan)
    card = story["per_card"][0]
    assert card["payoff_month"] is None
    assert card["apr_pct"] is None
    assert card["cleared_monthly"] is None
