"""G270: shared instrument prices. Fake collections, no Mongo."""
import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest

import app.services.investment_prices as ip
import app.routers.investments as inv_router
from scripts import migrate_instrument_prices as mig

ISIN = "GB00B3X7QG63"
TODAY = date(2026, 10, 14)


class _Cur:
    def __init__(self, docs):
        self.docs = docs

    async def to_list(self, n):
        return [dict(d) for d in self.docs]


def _match(d, q):
    for k, v in q.items():
        if isinstance(v, dict) and "$in" in v:
            if d.get(k) not in v["$in"]:
                return False
        elif d.get(k) != v:
            return False
    return True


class _Col:
    def __init__(self, docs=()):
        self.docs = {d["_id"]: dict(d) for d in docs}

    def find(self, q=None, projection=None):
        return _Cur([d for d in self.docs.values() if _match(d, q or {})])

    async def find_one(self, q, projection=None):
        for d in self.docs.values():
            if _match(d, q):
                return dict(d)
        return None

    async def update_one(self, q, u, upsert=False):
        d = next((x for x in self.docs.values() if _match(x, q)), None)
        if d is None:
            if not upsert:
                return
            d = {"_id": q["_id"]}
            d.update(u.get("$setOnInsert", {}))
            self.docs[d["_id"]] = d
        d.update(u.get("$set", {}))
        for k in u.get("$unset", {}):
            d.pop(k, None)


class _Src:
    name = "fake"

    def __init__(self, price=100.0, fail=False):
        self.calls = 0
        self.price, self.fail = price, fail

    async def fetch(self, inst):
        self.calls += 1
        if self.fail:
            raise RuntimeError("boom")
        return ip.PriceQuote(self.price, TODAY.isoformat(), "GBP", "fake", "high")


def _holding(i, acc, user, units=2.0, isin=ISIN):
    return {"_id": f"h{i}", "account_id": acc, "user_id": user, "name": "Fund", "isin": isin,
            "units": units, "statement_value": 50.0}


@pytest.fixture
def cols(monkeypatch):
    inst = _Col()
    holdings = _Col([_holding(1, "a1", "u1@x.com"), _holding(2, "a2", "u2@x.com", units=3.0)])
    accs = _Col([{"_id": "a1", "user_id": "u1@x.com", "total_value": 0},
                 {"_id": "a2", "user_id": "u2@x.com", "total_value": 0}])
    for mod in (ip,):
        monkeypatch.setattr(mod, "instrument_prices_col", inst)
        monkeypatch.setattr(mod, "investment_holdings_col", holdings)
        monkeypatch.setattr(mod, "investment_accounts_col", accs)
    monkeypatch.setattr(ip, "user_today", lambda: TODAY)
    return inst, holdings, accs


def run(c):
    return asyncio.run(c)


def test_two_users_same_isin_one_fetch(cols):
    inst, holdings, accs = cols
    src = _Src()
    res = run(ip.refresh_all_instruments([src]))
    assert src.calls == 1 and res["instruments"] == 1 and res["fetched"] == 1
    assert res["changed_users"] == {"u1@x.com", "u2@x.com"}
    assert accs.docs["a1"]["total_value"] == 200.0 and accs.docs["a2"]["total_value"] == 300.0


def test_skipped_when_fetched_today(cols):
    src = _Src()
    run(ip.refresh_all_instruments([src]))
    run(ip.refresh_all_instruments([src]))
    assert src.calls == 1


def test_failed_fetch_keeps_last_price_and_date(cols):
    inst, *_ = cols
    run(ip.refresh_all_instruments([_Src(price=250.0)]))
    inst.docs[ISIN]["fetched_at"] = datetime.now(timezone.utc) - timedelta(days=3)
    inst.docs[ISIN]["last_attempt_at"] = datetime.now(timezone.utc) - timedelta(days=3)
    res = run(ip.refresh_all_instruments([_Src(fail=True)]))
    assert res["failed"] == 1
    d = inst.docs[ISIN]
    assert d["price"] == 250.0 and d["price_date"] == TODAY.isoformat()
    # not retried the same day
    bad = _Src(fail=True)
    run(ip.refresh_all_instruments([bad]))
    assert bad.calls == 0


def test_stale_price_shows_its_date(cols, monkeypatch):
    inst, holdings, accs = cols
    inst.docs[ISIN] = {"_id": ISIN, "isin": ISIN, "price": 10.0, "price_date": "2026-10-09",
                       "source": "web_search", "confidence": "low", "fetched_at": None, "history": []}
    monkeypatch.setattr(inv_router, "investment_holdings_col", holdings)
    monkeypatch.setattr(inv_router, "investment_accounts_col", accs)
    monkeypatch.setattr(inv_router, "get_instruments", ip.get_instruments)
    holdings.docs["h1"]["instrument_key"] = ISIN
    accs.docs["a1"]["user_id"] = "u1@x.com"
    out = run(inv_router.get_investment_holdings("a1", {"email": "u1@x.com"}))
    h = out[0]
    assert h["price_date"] == "2026-10-09" and h["current_price"] == 10.0
    assert h["price_source"] == "web_search" and h["price_confidence"] == "low"
    assert h["current_value"] == 20.0


def test_migration_dry_run_then_apply(cols):
    inst, holdings, _ = cols
    holdings.docs["h1"].update(current_price=12.5, current_value=25.0,
                               last_refreshed=datetime(2026, 10, 10, 6, 30))
    before = {k: dict(v) for k, v in holdings.docs.items()}
    c = run(mig.migrate(holdings, inst, apply=False))
    assert c["linked"] == 2 and c["prices_seeded"] == 1
    assert holdings.docs == before and inst.docs == {}
    c = run(mig.migrate(holdings, inst, apply=True))
    assert holdings.docs["h1"]["instrument_key"] == ISIN
    assert "current_price" not in holdings.docs["h1"]
    assert inst.docs[ISIN]["price"] == 12.5 and inst.docs[ISIN]["price_date"] == "2026-10-10"
    again = run(mig.migrate(holdings, inst, apply=True))
    assert again["linked"] == 0 and again["already_linked"] == 2


def test_no_user_id_in_instrument_prices(cols):
    inst, holdings, _ = cols
    run(ip.refresh_all_instruments([_Src()]))
    run(mig.migrate(holdings, inst, apply=True))
    blob = repr(inst.docs)
    assert "user_id" not in blob and "@x.com" not in blob
