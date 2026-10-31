"""G373 transaction-list contracts against the disposable test Mongo DB."""
import asyncio
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

import app.routers.transactions as routes
import app.services.pending_transactions as pending
import app.services.truelayer_sync as truelayer_sync
import app.services.categories as categories_service
import app.services.categorisation as categorisation_service
import app.services.spending as spending_service
from app.db.collections import accounts_col, pending_transactions_col, statement_transactions_col, transactions_col, yapily_transactions_col
from app.core.config import MONGO_DB, MONGO_URI


@pytest.fixture
def mongo(monkeypatch):
    """A per-test Motor client keeps asyncio.run from closing the app
    client's event loop.  The database remains conftest's disposable one."""
    assert MONGO_DB.startswith("wealth_test_")
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=2000)
    db = client[MONGO_DB]
    global accounts_col, pending_transactions_col, statement_transactions_col, transactions_col, yapily_transactions_col
    accounts_col, pending_transactions_col = db["accounts"], db["pending_transactions"]
    transactions_col, yapily_transactions_col, statement_transactions_col = db["transactions"], db["yapily_transactions"], db["statement_transactions"]
    for module in (routes, pending, truelayer_sync):
        monkeypatch.setattr(module, "accounts_col", accounts_col, raising=False)
        monkeypatch.setattr(module, "pending_transactions_col", pending_transactions_col, raising=False)
        monkeypatch.setattr(module, "transactions_col", transactions_col, raising=False)
    monkeypatch.setattr(routes, "yapily_transactions_col", yapily_transactions_col)
    monkeypatch.setattr(routes, "statement_transactions_col", statement_transactions_col)
    monkeypatch.setattr(routes, "yapily_accounts_col", db["yapily_accounts"])
    # `all_transactions` obtains its real category/identity/card context;
    # point those services at this same client rather than faking output.
    monkeypatch.setattr(categories_service, "user_categories_col", db[categories_service.user_categories_col.name])
    monkeypatch.setattr(categorisation_service, "user_profiles_col", db[categorisation_service.user_profiles_col.name])
    monkeypatch.setattr(categorisation_service, "accounts_col", accounts_col)
    monkeypatch.setattr(spending_service, "accounts_col", accounts_col)
    monkeypatch.setattr(spending_service, "transactions_col", transactions_col)
    monkeypatch.setattr(spending_service, "yapily_transactions_col", yapily_transactions_col)
    yield
    client.close()


def _token(): return uuid4().hex
def _uid(): return f"g373-{_token()}@example.test"


def _booked(uid, account, when, *, raw_id=None, **extra):
    return {"_id": raw_id or f"booked-{_token()}", "user_id": uid, "account_id": account,
            "date": when, "amount": 12.5, "currency": "GBP", "description": "COFFEE SHOP",
            "merchant_name": "Coffee Shop", "category": "Eating Out", "custom_category": None,
            "transaction_type": "debit", "provider": "TrueLayer", **extra}


async def _search(uid, **overrides):
    # Direct calls do not have FastAPI's Query(None) coercion.
    args = {"q": None, "page": 1, "page_size": 20, "category": None, "categories": None,
            "merchants": None, "days": None, "date_from": None, "date_to": None,
            "txn_type": None, "activity_order": False, "user": {"email": uid}}
    args.update(overrides)
    return await routes.search_transactions(**args)


async def _account(uid, account, **overrides):
    args = {"page": 1, "page_size": 20, "q": None, "category": None, "days": None,
            "txn_type": None, "activity_order": False, "user": {"email": uid}}
    args.update(overrides)
    return await routes.get_transactions(account, **args)


def test_pending_first_page_filters_currency_and_never_inflates_settled_total(mongo):
    async def scenario():
        uid, account, now = _uid(), f"account-{_token()}", datetime.utcnow()
        await accounts_col.insert_one({"_id": account, "user_id": uid, "currency": "EUR"})
        await transactions_col.insert_one(_booked(uid, account, now - timedelta(days=1)))
        await pending_transactions_col.insert_one({"_id": f"legacy-{_token()}", "source_transaction_id": "legacy-pending", "user_id": uid, "account_id": account, "date": now + timedelta(days=1), "amount": 12.5, "description": "COFFEE SHOP", "merchant_name": "Coffee Shop", "transaction_type": "debit", "provider": "TrueLayer", "is_pending": True, "first_seen": now})
        await pending_transactions_col.insert_one({"_id": f"stale-{_token()}", "source_transaction_id": "stale", "user_id": uid, "account_id": account, "date": now, "amount": 1, "description": "OLD", "transaction_type": "debit", "provider": "TrueLayer", "is_pending": True, "first_seen": now - timedelta(days=pending.PENDING_TXN_MAX_AGE_DAYS + 1)})
        first = await _search(uid, q="coffee", page_size=1, txn_type="debit")
        assert first["total"] == 1 and first["pending_total"] == 1
        assert first["pending_items"][0].currency == "EUR" and first["pending_items"][0].activity_date is not None
        assert "pending_items" not in await _search(uid, page=2, page_size=1)
        assert (await _account(uid, account, q="coffee", txn_type="debit"))["pending_total"] == 1
        assert not (await _search(uid, q="absent"))["pending_items"]
        assert not (await _search(uid, category="Other"))["pending_items"]
    asyncio.run(scenario())


def test_replace_scope_snapshot_and_exact_handover_do_not_guess_by_amount(mongo):
    async def scenario():
        uid, other, account, now = _uid(), _uid(), f"account-{_token()}", datetime.utcnow()
        row = {"transaction_id": "provider-id", "date": now, "amount": -12.5, "description": "COFFEE SHOP", "transaction_type": "debit"}
        await pending.replace_pending_for_account([row], account, uid, "TrueLayer")
        await pending.replace_pending_for_account([row], account, other, "TrueLayer")
        await pending.replace_pending_for_account([row], account, uid, "Finexer")
        other_account = f"account-{_token()}"
        await pending.replace_pending_for_account([row], other_account, uid, "TrueLayer")
        assert await pending_transactions_col.count_documents({"source_transaction_id": "provider-id"}) == 4
        await transactions_col.insert_one(_booked(uid, account, now, raw_id="provider-id"))
        # Same-user second account is not collapsed by the first account's booking.
        assert (await _account(uid, account))["pending_total"] == 1
        assert (await _account(uid, other_account))["pending_total"] == 1
        await pending.replace_pending_for_account([], account, uid, "Finexer")
        assert (await _account(uid, account))["pending_total"] == 0
    asyncio.run(scenario())


def test_pending_cap_reports_true_total_and_all_transactions_excludes_it(mongo):
    async def scenario():
        uid, account, now, booked_id = _uid(), f"account-{_token()}", datetime.utcnow(), f"booked-{_token()}"
        await transactions_col.insert_one(_booked(uid, account, now, raw_id=booked_id))
        rows = [{"transaction_id": f"p-{n}", "date": now, "amount": -1, "description": f"PENDING {n}", "transaction_type": "debit"} for n in range(205)]
        await pending.replace_pending_for_account(rows, account, uid, "TrueLayer")
        result = await _search(uid)
        assert result["total"] == 1 and result["pending_total"] == 205 and len(result["pending_items"]) == 200
        second = await _search(uid, pending_page=2)
        assert second["pending_total"] == 205 and len(second["pending_items"]) == 5
        assert not {row.id for row in result["pending_items"]} & {row.id for row in second["pending_items"]}
        assert [x.id for x in await routes.all_transactions(days=365, user={"email": uid})] == [booked_id]
    asyncio.run(scenario())


def test_activity_order_across_sources_filters_pages_and_keeps_raw_bank_date(mongo):
    async def scenario():
        uid, account = _uid(), f"account-{_token()}"
        seen, monday = datetime(2026, 10, 31, 10), datetime(2026, 11, 2, 9)
        await transactions_col.insert_one(_booked(uid, account, monday, raw_id=f"main-{_token()}", first_seen=seen))
        await yapily_transactions_col.insert_one(_booked(uid, f"y-{_token()}", datetime(2026, 10, 31, 11), raw_id=f"yapily-{_token()}", first_seen=datetime(2026, 10, 31, 11)))
        await statement_transactions_col.insert_one(_booked(uid, f"s-{_token()}", datetime(2026, 10, 30, 11), raw_id=f"statement-{_token()}", first_seen=datetime(2026, 10, 30, 11)))
        assert (await _search(uid, page_size=1))["items"][0].date == monday
        one, two = await _search(uid, activity_order=True, page_size=1), await _search(uid, activity_order=True, page=2, page_size=1)
        assert one["items"][0].date == datetime(2026, 10, 31, 11)
        assert two["items"][0].date == monday and two["items"][0].activity_date == seen
        assert len((await _search(uid, activity_order=True, date_from="2026-10-31", date_to="2026-10-31"))["items"]) == 2
    asyncio.run(scenario())


def test_sync_first_seen_and_activity_date_are_insert_only(monkeypatch, mongo):
    async def noop(_uid): return None
    async def scenario():
        uid, account, raw_id = _uid(), f"account-{_token()}", f"sync-{_token()}"
        monkeypatch.setattr(truelayer_sync, "mark_stale", noop)
        txn = {"transaction_id": raw_id, "timestamp": "2030-11-04T09:00:00Z", "amount": -5, "currency": "GBP", "description": "WEEKEND", "merchant_name": "Shop"}
        await truelayer_sync._upsert_transactions([txn], account, uid)
        anchor = datetime(2026, 10, 31)
        await transactions_col.update_one({"_id": raw_id}, {"$set": {"first_seen": anchor, "activity_date": anchor}})
        await truelayer_sync._upsert_transactions([txn], account, uid)
        saved = await transactions_col.find_one({"_id": raw_id})
        assert saved["first_seen"] == anchor and saved["activity_date"] == anchor
    asyncio.run(scenario())
