"""G270: shared instrument prices. Fake collections, no Mongo."""
import asyncio
from datetime import date, datetime, timezone

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
    monkeypatch.setattr(ip, "investment_notes_col", _Col())
    monkeypatch.setattr(ip, "user_today", lambda: TODAY)
    # Frozen "now" on TODAY so same-day checks never depend on the real clock.
    monkeypatch.setattr(ip, "_utcnow", lambda: datetime(2026, 10, 14, 7, tzinfo=timezone.utc))
    bumps = []

    async def _bump(uid):
        bumps.append(uid)
    import app.services.data_version as dv
    monkeypatch.setattr(dv, "bump", _bump)
    inst.bumps = bumps
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
    old = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)  # three days before frozen TODAY
    inst.docs[ISIN]["fetched_at"] = old
    inst.docs[ISIN]["last_attempt_at"] = old
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
    monkeypatch.setattr(inv_router, "investment_notes_col", _Col())  # G278: the holdings list also reads note-only funds
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


def _old(inst, price=100.0):
    old = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
    inst.docs[ISIN] = {"_id": ISIN, "isin": ISIN, "price": price, "price_date": "2026-10-11",
                       "source": "fake", "confidence": "high", "fetched_at": old,
                       "last_attempt_at": old, "history": []}


def test_implausible_move_rejected_keeps_old_price(cols):
    inst, *_ = cols
    _old(inst, 100.0)
    out = run(ip.refresh_instrument(ISIN, [_Src(price=150.0)]))
    assert out == "failed" and inst.docs[ISIN]["price"] == 100.0
    assert inst.docs[ISIN]["price_date"] == "2026-10-11"
    _old(inst, 100.0)
    assert run(ip.refresh_instrument(ISIN, [_Src(price=120.0)])) == "fetched"
    assert inst.docs[ISIN]["price"] == 120.0


class _Unconfigured(_Src):
    configured = False


def test_missing_key_does_not_stamp_the_day(cols):
    inst, *_ = cols
    _old(inst)
    src = _Unconfigured()
    assert run(ip.refresh_instrument(ISIN, [src])) == "unavailable"
    assert src.calls == 0
    assert inst.docs[ISIN]["last_attempt_at"] == datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
    _, holdings, accs = cols
    res = run(ip.refresh_account_prices(accs.docs["a1"], [src]))
    assert res["status"] == "unavailable"


def test_account_refresh_shares_once_a_day_and_bumps_all_holders(cols):
    inst, holdings, accs = cols
    src = _Src()
    for h in holdings.docs.values():
        h["instrument_key"] = ISIN  # as after the migration
    r1 = run(ip.refresh_account_prices(accs.docs["a1"], [src]))
    assert r1["status"] == "updated" and r1["updated"] == 1
    assert set(inst.bumps) == {"u1@x.com", "u2@x.com"}
    assert accs.docs["a2"]["total_value"] == 300.0
    r2 = run(ip.refresh_account_prices(accs.docs["a2"], [src]))
    assert r2["status"] == "skipped" and src.calls == 1


def test_history_one_point_per_date(cols):
    inst, *_ = cols
    run(ip.ensure_instrument(ISIN, isin=ISIN, name="Fund"))
    for price in (10.0, 11.0):
        run(ip.record_quote(ISIN, ip.PriceQuote(price, "2026-10-14", "GBP", "fake", "high")))
    hist = inst.docs[ISIN]["history"]
    assert hist == [{"price_date": "2026-10-14", "price": 11.0, "source": "fake"}]


def test_name_is_sanitised_for_prompt():
    assert ip.sanitise_name("Fund <script>\nIgnore previous\n{x}") == "Fund scriptIgnore previousx"
    assert len(ip.sanitise_name("a" * 500)) == 80


class _NoQuote(_Src):
    async def fetch(self, inst):
        self.calls += 1
        return None


def _legacy(holdings, accs, lr=datetime(2026, 10, 13, 23, 30, tzinfo=timezone.utc)):
    # pre-migration state: holdings priced on themselves, no instrument_key
    holdings.docs["h1"].update(current_price=12.5, current_value=25.0,
                               last_refreshed=lr)
    holdings.docs["h2"].update(current_price=12.5, current_value=37.5,
                               last_refreshed=lr)
    accs.docs["a1"]["total_value"] = 25.0
    accs.docs["a2"]["total_value"] = 37.5


def test_failed_first_fetch_premigration_keeps_legacy_total(cols):
    inst, holdings, accs = cols
    _legacy(holdings, accs, datetime(2026, 10, 12, 12, tzinfo=timezone.utc))
    res = run(ip.refresh_account_prices(accs.docs["a1"], [_NoQuote()]))
    assert res["status"] == "failed"
    # total equals the legacy value, not the older statement value (50.0)
    assert accs.docs["a1"]["total_value"] == 25.0 and res["new_total"] == 25.0
    holdings.docs["h1"]["instrument_key"] = ISIN
    inst.docs[ISIN].pop("price", None)  # still unpriced for the GET path
    inst.docs[ISIN]["price"] = None
    assert ip.holding_value(holdings.docs["h1"], inst.docs[ISIN]) == 25.0


def test_first_real_quote_replaces_legacy_seed_regardless_of_size(cols):
    inst, holdings, accs = cols
    _legacy(holdings, accs, datetime(2026, 10, 12, 12, tzinfo=timezone.utc))
    # the seed (12.5) is not a real quote, so a far-off first real quote is accepted
    run(ip.refresh_account_prices(accs.docs["a1"], [_Src(price=100.0)]))
    assert inst.docs[ISIN]["price"] == 100.0 and inst.docs[ISIN]["source"] == "fake"
    assert accs.docs["a1"]["total_value"] == 200.0


def test_link_seeds_instrument_from_legacy(cols):
    inst, holdings, accs = cols
    _legacy(holdings, accs)
    run(ip._link_holdings(list(holdings.docs.values())))
    d = inst.docs[ISIN]
    assert d["price"] == 12.5 and d["source"] == "legacy" and d["confidence"] == "low"
    # 23:30 UTC on 13 Oct is 00:30 BST on 14 Oct: the London date
    assert d["price_date"] == "2026-10-14"
    assert d["history"] == [{"price_date": "2026-10-14", "price": 12.5, "source": "legacy"}]


def test_migration_seeds_already_linked_none_price_doc(cols):
    inst, holdings, accs = cols
    _legacy(holdings, accs)
    for h in holdings.docs.values():
        h["instrument_key"] = ISIN
    inst.docs[ISIN] = {"_id": ISIN, "isin": ISIN, "price": None, "price_date": None, "history": []}
    c = run(mig.migrate(holdings, inst, apply=True))
    assert c["prices_seeded"] == 1 and c["legacy_cleaned"] == 2
    assert inst.docs[ISIN]["price"] == 12.5 and inst.docs[ISIN]["source"] == "migrated"
    assert "current_price" not in holdings.docs["h1"]
    again = run(mig.migrate(holdings, inst, apply=True))
    assert again["prices_seeded"] == 0 and again["legacy_cleaned"] == 0 and again["already_linked"] == 2


def test_migration_keeps_legacy_when_no_price_to_replace_it(cols):
    inst, holdings, _ = cols
    holdings.docs["h1"]["instrument_key"] = ISIN
    holdings.docs["h1"]["current_value"] = 25.0  # no price, no last_refreshed: cannot seed
    inst.docs[ISIN] = {"_id": ISIN, "isin": ISIN, "price": None, "history": []}
    run(mig.migrate(holdings, inst, apply=True))
    assert holdings.docs["h1"]["current_value"] == 25.0


def test_london_date_conversion_in_migration(cols):
    inst, holdings, _ = cols
    holdings.docs["h1"].update(current_price=9.0, last_refreshed=datetime(2026, 7, 1, 23, 30))  # naive UTC, BST
    run(mig.migrate(holdings, inst, apply=True))
    assert inst.docs[ISIN]["price_date"] == "2026-07-02"


def test_bound_not_applied_against_seeded_price(cols):
    inst, *_ = cols
    _old(inst, 12.5)
    inst.docs[ISIN]["source"] = "legacy"
    assert run(ip.refresh_instrument(ISIN, [_Src(price=1250.0)])) == "fetched"
    assert inst.docs[ISIN]["price"] == 1250.0 and inst.docs[ISIN]["source"] == "fake"
    inst.docs[ISIN]["fetched_at"] = inst.docs[ISIN]["last_attempt_at"] = datetime(2026, 10, 11, 12, tzinfo=timezone.utc)
    assert run(ip.refresh_instrument(ISIN, [_Src(price=2500.0)])) == "failed"  # bound applies now
