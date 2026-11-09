"""Stored-evidence contracts for G449.  No test calls a matcher or live DB."""
from datetime import date, datetime
import asyncio
from functools import wraps
import pytest
from app.services import filed_transfers as h
from app.services.own_account_transfers import OWN_TRANSFER_MATCH_VERSION

def run_async(fn):
    @wraps(fn)
    def run(*args, **kwargs):
        return asyncio.run(fn(*args, **kwargs))
    return run

class Cursor:
    def __init__(self, rows): self.rows = rows
    async def to_list(self, _): return list(self.rows)
class Col:
    def __init__(self, rows=()): self.rows = list(rows)
    def find(self, query, *_a, **_k):
        assert query["user_id"] == "owner@example.com" # auth isolation on every read
        return Cursor(self.rows)
def mark(other, account, *, confirmed=False):
    return {"version": OWN_TRANSFER_MATCH_VERSION, "counterpart_id": other,
            "counterpart_account_id": account, "source": "ai", "confirmed": confirmed,
            "previous_category": "Other", "matched_category": "Transfer"}
def row(id, typ, when, amount, account, marker=None, category="Transfer", currency="GBP"):
    return {"_id":id,"user_id":"owner@example.com","transaction_type":typ,"date":when,"amount":amount,
            "account_id":account,"currency":currency,"description":"Own transfer","merchant_name":"Own transfer",
            "category":category,"own_transfer_match":marker,"_filed_source":"transactions"}

@pytest.fixture
def fake(monkeypatch):
    async def cats(_): return {"Transfer":"movement","Savings":"movement","Other":"discretionary"}
    monkeypatch.setattr(h,"get_category_kinds",cats)
    monkeypatch.setattr(h,"resolve_transfer_evidence",lambda rows,*a,**k: rows)
    monkeypatch.setattr(h,"reversible_pair",lambda *a: True)
    async def load(*_): return []
    monkeypatch.setattr(h,"_load_period_txns",load)
    monkeypatch.setattr(h,"accounts_col",Col([{"_id":"a","name":"BARCLAYS","provider":{"name":"Barclays"},"currency":"GBP"},{"_id":"b","name":"HSBC","provider":"HSBC","currency":"GBP"}]))
    monkeypatch.setattr(h,"own_transfer_judgements_col",Col())
    return monkeypatch

@run_async
async def test_scope_partitions_exact_spend_total_without_credit_double_count(fake):
    data=[row("d","debit",datetime(2026,10,26,23,59),100,"a",mark("c","b")),row("c","credit",datetime(2026,10,27),100,"b",mark("d","a")),row("o","debit",datetime(2026,10,26),25,"a",category="Savings")]
    async def rows(_): return data
    async def load(*_): return [{"id":"d","debit":True,"category":"Transfer","amount":100,"own_move":False,"card_repayment":False},{"id":"c","debit":False,"category":"Transfer","amount":100,"own_move":False,"card_repayment":False},{"id":"o","debit":True,"category":"Savings","amount":25,"own_move":False,"card_repayment":False}]
    fake.setattr(h,"_all_rows",rows); fake.setattr(h,"_load_period_txns",load)
    out=await h.list_filed_transfers("owner@example.com",start=date(2026,10,26),end=date(2026,10,26))
    assert out["scope_total"] == 125 and sum(x["total_amount"] for x in out["items"]) == 125
    assert next(x for x in out["items"] if x["kind"]=="own_transfer")["occurrences"][0]["credit"]["transaction_type"] == "credit"

@run_async
async def test_all_time_actor_filter_pagination_native_currency_and_global_undo_count(fake):
    data=[]
    for n, day in enumerate((1,30)):
        data += [row(f"d{n}","debit",datetime(2026,9,day),10,"a",mark(f"c{n}","b")),row(f"c{n}","credit",datetime(2026,9,day),10,"b",mark(f"d{n}","a"))]
    data += [row("ud","debit",datetime(2026,10,2),20,"a",mark("uc","b",confirmed=True)),row("uc","credit",datetime(2026,10,2),20,"b",mark("ud","a",confirmed=True)),row("fx","debit",datetime(2026,10,3),9,"a",category="Savings",currency="USD")]
    async def rows(_): return data
    fake.setattr(h,"_all_rows",rows)
    out=await h.list_filed_transfers("owner@example.com",source="all",page_size=50)
    sorted_row=next(x for x in out["items"] if x["actor"]=="sorted"); user_row=next(x for x in out["items"] if x["actor"]=="user")
    assert out["scope_total"] is None and sorted_row["series_key"].startswith("sorted:") and sorted_row["undo_count"]==2
    assert next(x for x in out["items"] if x["description"] == "Own transfer" and x["currency"] == "USD")["total_amount"] == 9
    assert user_row["series_key"].startswith("user:") and (await h.list_filed_transfers("owner@example.com",source="sorted"))["total_series"]==1
    assert (await h.list_filed_transfers("owner@example.com",page_size=1))["pages"] >= 2

@run_async
async def test_stale_marker_falls_back_and_get_never_runs_reconcile(fake):
    data=[row("d","debit",datetime(2026,10,26),30,"a",{"bad":True})]
    async def rows(_): return data
    def resolve(rows,*_a,**_k):
        copy=dict(rows[0]); copy.pop("own_transfer_match"); return [copy]
    async def load(*_): return [{"id":"d","debit":True,"category":"Transfer","amount":30,"own_move":False,"card_repayment":False}]
    fake.setattr(h,"_all_rows",rows); fake.setattr(h,"resolve_transfer_evidence",resolve); fake.setattr(h,"_load_period_txns",load)
    fake.setattr(h,"reconcile_own_account_transfers",lambda *_: (_ for _ in ()).throw(AssertionError("GET mutated")),raising=False)
    out=await h.list_filed_transfers("owner@example.com",start=date(2026,10,26),end=date(2026,10,26))
    assert out["complete"] is False and out["scope_total"]==30 and out["items"][0]["kind"]=="other"


def test_http_boundary_authenticates_and_validates_scope(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.auth import current_user
    from app.routers import filed_transfers as routes
    app = FastAPI()
    app.include_router(routes.router)
    seen = []
    async def read(uid, **query):
        seen.append((uid, query))
        return {"items": [], "total_series": 0}
    monkeypatch.setattr(routes, "list_filed_transfers", read)
    with TestClient(app) as client:
        assert client.get("/transactions/filed-transfers").status_code == 401
        app.dependency_overrides[current_user] = lambda: {"email": "owner@example.com"}
        for query in ("?source=ai", "?page=0", "?page_size=51", "?from=2026-10-01", "?from=2026-11-01&to=2026-10-01"):
            assert client.get(f"/transactions/filed-transfers{query}").status_code == 400
        assert client.get("/transactions/filed-transfers?from=bad&to=2026-10-01").status_code == 422
        assert client.get("/transactions/filed-transfers?source=user&page=2&page_size=5&user_id=someone-else").status_code == 200
        assert seen == [("owner@example.com", {"start": None, "end": None, "source": "user", "page": 2, "page_size": 5})]


def test_undo_http_boundary_returns_pending_without_another_dirty_marker(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.auth import current_user
    from app.routers import filed_transfers as routes
    from app.services import filed_transfer_undo, derived_caches
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[current_user] = lambda: {"email": "owner@example.com"}
    seen = []
    async def undo(uid, key):
        seen.append((uid, key))
        if key == "gone": raise ValueError("Reload history")
        return {"undone": 2, "transaction_ids": ["c", "d"]}
    async def no_extra_defer(_): raise AssertionError("The helper already recorded H145")
    monkeypatch.setattr(filed_transfer_undo, "undo_filed_series", undo)
    monkeypatch.setattr(derived_caches, "defer_transfer_review_recompute", no_extra_defer)
    with TestClient(app) as client:
        assert client.post("/transactions/filed-transfers/undo", json={}).status_code == 400
        assert client.post("/transactions/filed-transfers/undo", json={"series_key": "gone"}).status_code == 409
        response = client.post("/transactions/filed-transfers/undo", json={"series_key": "sorted:recorded", "user_id": "someone-else"})
        assert response.status_code == 200 and response.json() == {"ok": True, "undone": 2, "transaction_ids": ["c", "d"], "recomputed": False, "pending": True}
        assert seen[-1] == ("owner@example.com", "sorted:recorded")
