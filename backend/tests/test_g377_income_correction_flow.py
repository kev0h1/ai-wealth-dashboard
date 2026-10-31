"""G377: a category correction must remove an own-transfer credit from Upcoming.

This intentionally drives the PATCH route and the dirty-cache reader around
the real cashflow pattern builder.  It is not a unit test of the prefilter:
the regression was a stale, plausible-looking income entry in Upcoming after
the user corrected the newest credit in a series to Transfer.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.analytics as analytics
import app.routers.transactions as transactions
import app.services.cashflow as cashflow_service
import app.services.derived_caches as derived_caches
import app.services.money_shape as money_shape
import app.services.data_version as data_version
from app.core.build import engine_build
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds
from app.services.categorisation import series_key
from app.services.income_evidence import historical_income_context, select_income_evidence
from app.services.income_payer import payer_key
from app.services.own_account_transfers import build_match_metadata, resolve_transfer_evidence


UID = "g377-owner@example.com"
OTHER_UID = "g377-other@example.com"
ACCOUNT = "g377-current"
OTHER_ACCOUNT = "g377-savings"


def _match(row, query):
    for key, expected in (query or {}).items():
        if key == "$or":
            if not any(_match(row, arm) for arm in expected):
                return False
            continue
        actual = row.get(key)
        if isinstance(expected, dict):
            if "$in" in expected and actual not in expected["$in"]:
                return False
            if "$nin" in expected and actual in expected["$nin"]:
                return False
            if "$ne" in expected and actual == expected["$ne"]:
                return False
            if "$gte" in expected and (actual is None or actual < expected["$gte"]):
                return False
            if "$lt" in expected and (actual is None or actual >= expected["$lt"]):
                return False
            if "$lte" in expected and (actual is None or actual > expected["$lte"]):
                return False
            if "$exists" in expected and ((key in row) != expected["$exists"]):
                return False
        elif actual != expected:
            return False
    return True


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return [dict(row) for row in self.rows]


class _Col:
    def __init__(self, rows=()):
        self.rows = [dict(row) for row in rows]

    def find(self, query=None, projection=None):
        # Projection fidelity catches an accidental dependency on unprojected
        # state in the real analytics query.
        rows = [_project(row, projection) for row in self.rows if _match(row, query)]
        return _Cursor(rows)

    async def find_one(self, query=None, projection=None, **_kwargs):
        row = next((row for row in self.rows if _match(row, query)), None)
        return _project(row, projection) if row else None

    async def update_one(self, query, update, upsert=False):
        row = next((row for row in self.rows if _match(row, query)), None)
        if row is None and upsert:
            row = {key: value for key, value in query.items() if not key.startswith("$")}
            self.rows.append(row)
        if row is not None:
            row.update(update.get("$set") or {})
            for key in update.get("$unset") or {}:
                row.pop(key, None)

    async def update_many(self, query, update):
        changed = 0
        for row in self.rows:
            if _match(row, query):
                row.update(update.get("$set") or {})
                changed += 1
        return type("Result", (), {"modified_count": changed})()

    async def count_documents(self, query):
        return sum(_match(row, query) for row in self.rows)

    async def insert_one(self, row):
        self.rows.append(dict(row))


def _project(row, projection):
    if projection is None:
        return dict(row)
    return {key: value for key, value in row.items() if key == "_id" or projection.get(key)}


def _credit(id_, description, days, *, category="Income", uid=UID, account=ACCOUNT):
    return {
        "_id": id_, "user_id": uid, "account_id": account,
        "transaction_type": "credit", "amount": 1500.0,
        "date": datetime.now() - timedelta(days=days), "currency": "GBP",
        "merchant_name": description, "description": description, "category": category,
    }


def _debit(id_, days, *, uid=UID):
    return {
        "_id": id_, "user_id": uid, "account_id": ACCOUNT,
        "transaction_type": "debit", "amount": -75.0,
        "date": datetime.now() - timedelta(days=days), "currency": "GBP",
        "merchant_name": "REAL OUTGOING", "description": "REAL OUTGOING",
        "category": "Bills",
    }


@pytest.mark.parametrize(
    ("payer_label", "correction_category"),
    [
        ("Tuesday Perks Reward", "Transfer"),
        ("Atypical Counterparty 9017", "Personal sweep"),
    ],
)
@pytest.mark.parametrize("correction_age", [28, 210])
def test_category_correction_removes_whole_payer_series_on_the_next_upcoming_read(
    monkeypatch, payer_label, correction_category, correction_age,
):
    """Any explicit non-income correction suppresses only its payer/account.

    A confirmed stream is deliberately present: without an explicit
    non-income guard, its fallback can resurrect precisely the phantom that
    the detected-series filter removed.  A separate salary and bill make the
    assertion prove that the filter is scoped to this payer, account and user.
    """
    now = datetime.now()
    test_rows = [
        _credit("corrected-old-1", payer_label, 84),
        _credit("corrected-old-2", payer_label, 56),
        _credit("corrected-new", payer_label, correction_age),
        # The same label in another owned account is a different payer key
        # and must remain income after this account's correction.
        _credit("other-account-1", payer_label, 84, account=OTHER_ACCOUNT),
        _credit("other-account-2", payer_label, 56, account=OTHER_ACCOUNT),
        _credit("other-account-3", payer_label, 28, account=OTHER_ACCOUNT),
        _credit("salary-1", "ACME SALARY", 84),
        _credit("salary-2", "ACME SALARY", 56),
        _credit("salary-3", "ACME SALARY", 28),
        _debit("outgoing-1", 84), _debit("outgoing-2", 56), _debit("outgoing-3", 28),
        # Same merchant text under another user is a firewall regression guard.
        _credit("other-user", payer_label, 28, uid=OTHER_UID),
    ]
    corrected_key = payer_key(test_rows[0])
    other_account_key = payer_key(test_rows[3])
    salary_key = payer_key(test_rows[6])
    txns = _Col(test_rows)
    accounts = _Col([{
        "_id": ACCOUNT, "user_id": UID, "name": "Current", "balance": 3000.0,
        "currency": "GBP", "type": "current", "subtype": "transaction",
    }, {
        "_id": OTHER_ACCOUNT, "user_id": UID, "name": "Savings", "balance": 1000.0,
        "currency": "GBP", "type": "savings", "subtype": "savings",
    }])
    # The raw key is intentionally the pre-payer-identity shape preferences
    # store.  The test therefore covers the confirmed-fallback route too.
    prefs = _Col([{"user_id": UID, "income_streams": [{
        "key": series_key(test_rows[0]), "status": "confirmed", "avg_amount": 1500.0,
        "schedule": {"type": "day_of_month", "day": now.day},
    }]}])
    cache = _Col([{
        "_id": UID, "computed_at": now - timedelta(hours=1),
        "computed_from": now - timedelta(hours=1),
        "patterns_version": analytics.PATTERNS_VERSION,
        "engine_build": engine_build(), "recurring_income": [], "upcoming_bills": [],
    }])

    for module, name, value in (
        (analytics, "transactions_col", txns), (transactions, "transactions_col", txns),
        (analytics, "yapily_transactions_col", _Col()),
        (analytics, "accounts_col", accounts), (analytics, "yapily_accounts_col", _Col()),
        (analytics, "preferences_col", prefs),
        (analytics, "cashflow_cache_col", cache), (derived_caches, "cashflow_cache_col", cache),
    ):
        monkeypatch.setattr(module, name, value)

    async def kinds(_uid):
        return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))

    async def no_predictions(*_args, **_kwargs):
        return []

    async def no_judge(*_args, **_kwargs):
        return {}

    async def no_monthly(*_args, **_kwargs):
        return {}

    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(analytics, "get_category_kinds", kinds)
    monkeypatch.setattr(analytics, "_ai_recurring_predict", no_predictions)
    monkeypatch.setattr(analytics, "judge_suspect_series", no_judge)
    monkeypatch.setattr(cashflow_service, "monthly_cashflow", no_monthly)
    monkeypatch.setattr(money_shape, "compute_and_cache_money_shape", noop)
    monkeypatch.setattr(data_version, "bump", noop)
    monkeypatch.setattr(transactions, "cache_merchant", noop)
    monkeypatch.setattr(
        transactions, "user_allowed_categories",
        lambda _uid: asyncio.sleep(0, result={correction_category}),
    )
    monkeypatch.setattr(transactions, "count_rule_matches", lambda *_args, **_kwargs: asyncio.sleep(0, result=0))
    monkeypatch.setattr(transactions, "teaching_events_col", _Col())
    monkeypatch.setattr(derived_caches.response_cache, "ainvalidate", noop)
    monkeypatch.setattr(transactions.response_cache, "ainvalidate", noop)

    # Avoid background-task timing obscuring the reader guarantee.  The route
    # still marks the real cache doc dirty; the next reader owns recompute.
    def close_background(coro):
        coro.close()
        return None

    monkeypatch.setattr(transactions.asyncio, "create_task", close_background)

    async def run():
        await analytics.compute_and_cache_cashflow(UID)
        before = await cache.find_one({"_id": UID})
        assert {corrected_key, other_account_key, salary_key}.issubset(
            {row["key"] for row in before["recurring_income"]}
        )
        assert before["recurring_spend"], "a genuine outgoing bill must survive baseline compute"

        result = await transactions.update_transaction(
            "corrected-new", {"category": correction_category}, {"email": UID},
        )
        dirty = await cache.find_one({"_id": UID})
        changed = next(row for row in txns.rows if row["_id"] == "corrected-new")
        assert result["custom_category"] == correction_category
        assert changed["custom_category"] == correction_category
        assert changed.get("custom_category_at") is not None
        assert dirty.get("dirty_since") is not None, "PATCH must invalidate Upcoming before its task runs"

        # This is the real synchronous read-side recovery path used by
        # /cashflow when the fire-and-forget task has not landed yet.
        after = await analytics.recompute_if_dirty_for_read(UID, dirty)
        return after

    after = asyncio.run(run())
    assert after.get("dirty_since") is None
    remaining = {row["key"] for row in after["recurring_income"]}
    assert corrected_key not in remaining
    assert {other_account_key, salary_key}.issubset(remaining)
    assert after["recurring_spend"], "the correction must not erase real outflow forecasts"
    assert txns.rows[-1].get("custom_category") is None, "PATCH remains user-scoped"


@pytest.mark.parametrize("counterpart_present", [True, False])
def test_historical_pair_needs_its_real_counterpart_to_suppress_a_confirmation(counterpart_present):
    when = datetime.now() - timedelta(days=210)
    incoming = {**_credit("old-in", "TEST transfer", 210), "date": when}
    outgoing = {**incoming, "_id": "old-out", "account_id": "other-owned",
                "transaction_type": "debit", "category": "Other"}
    incoming["own_transfer_match"] = build_match_metadata(incoming, outgoing, "Transfer")
    incoming["category"] = "Transfer"
    # No marker on the counterpart: historical-context loading must retrieve
    # its exact ID, not trust the credit's persisted marker on its own.
    col = _Col([incoming, *([outgoing] if counterpart_present else []),
                {**incoming, "_id": "foreign", "user_id": OTHER_UID}])
    projection = {key: 1 for key in set(incoming) | set(outgoing)}
    history = asyncio.run(historical_income_context(
        UID, datetime.now() - timedelta(days=180), [], [col], projection, include_pairs=True,
    ))
    assert {row["_id"] for row in history} == ({"old-in", "old-out"} if counterpart_present else {"old-in"})
    resolved = resolve_transfer_evidence(history, {"Transfer"}, owned_account_ids={ACCOUNT, "other-owned"})
    evidence = select_income_evidence(resolved)
    assert evidence.confirmed({"TEST": {}}) == ({} if counterpart_present else {"TEST": {}})
