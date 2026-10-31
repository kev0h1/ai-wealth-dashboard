"""H140: the scenario regression suite.

Every JSON file in tests/scenarios/ is a synthetic situation (see
tests/scenarios/README.md). It is seeded into the disposable wealth_test_*
database and run through the REAL builders and walks, with only "today"
patched:

  analytics.get_cashflow              (the cashflow lists every screen reads:
                                       the real builder plus the live-balance
                                       overlay and period facts)
  analytics.compute_safe_to_spend     (pooled Left to spend)
  analytics.at_risk_count             (the Upcoming badge)
  companion.compute_today_items       (cover plan, payday plan, per-account
                                       position and Spend from)

Expected values are hand-computed in each fixture (never copied from a run).
The computed snapshot is also written to tests/scenarios/out/<slug>.json and
compared with the committed file; the frontend gate (check:scenarios) replays
those snapshots through the client walks.

Motor binds a client to the first event loop that touches it, and the shared
module-level client is spent by the time this test runs (conftest's autouse
cache cleanup uses asyncio.run). So each scenario opens its OWN guarded client
inside its own loop and rebinds every `*_col` name in the app modules to it for
the duration of the run (restored afterwards, including modules first imported
during it). Nothing is faked.
"""
import asyncio
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

import app.db.collections as dbc
from app.core import timeutil
from app.db.guard import TEST_DB_NAME_RE, make_guarded_client_class

SCEN_DIR = Path(__file__).parent / "scenarios"
OUT_DIR = SCEN_DIR / "out"
FIXTURES = sorted(SCEN_DIR.glob("*.json"))
LONDON = ZoneInfo("Europe/London")


def _uid(slug: str) -> str:
    return f"scenario-{slug}@example.test"


def _app_modules():
    return [m for n, m in list(sys.modules.items()) if m is not None and (n == "app" or n.startswith("app."))]


def _rebind_collections(client):
    """Point every module-level collection handle in the app at `client`.

    Returns a restore callable. Modules first imported DURING the run (lazy
    imports inside handlers) bind the new collections at import time, so the
    restore scans every module again and puts the original handles back by
    name; nothing is left pointing at a closed client for later tests.
    """
    from motor.motor_asyncio import AsyncIOMotorCollection
    from app.core.config import MONGO_DB

    assert TEST_DB_NAME_RE.match(MONGO_DB), "scenario suite only runs against a wealth_test_* database"
    originals = {
        v.name: v for k, v in vars(dbc).items()
        if k.endswith("_col") and isinstance(v, AsyncIOMotorCollection)
    }
    original_db = dbc.db
    new_db = client[MONGO_DB]
    new_cols = {name: new_db[name] for name in originals}

    def is_old(v):
        return isinstance(v, AsyncIOMotorCollection) and v.database.name == MONGO_DB and v.name in new_cols \
            and v.database is not new_db

    def to_new(v):
        if is_old(v):
            return new_cols[v.name]
        if v is original_db:
            return new_db
        # A module-level tuple or list of handles (counted_accounts._COLLECTIONS).
        if type(v) in (tuple, list) and any(is_old(x) for x in v):
            return type(v)(new_cols[x.name] if is_old(x) else x for x in v)
        return None

    def to_original(v):
        def back(x):
            if isinstance(x, AsyncIOMotorCollection) and x.database is new_db and x.name in originals:
                return originals[x.name]
            return x
        if v is new_db:
            return original_db
        if type(v) in (tuple, list) and any(back(x) is not x for x in v):
            return type(v)(back(x) for x in v)
        new = back(v)
        return new if new is not v else None

    def rebind(convert):
        for mod in _app_modules():
            for attr, value in list(vars(mod).items()):
                new = convert(value)
                if new is not None:
                    setattr(mod, attr, new)

    def restore():
        rebind(to_original)

    try:
        rebind(to_new)
    except BaseException:
        restore()  # a mid-swap failure must not leave closed-client handles behind
        raise
    return restore


def _freeze_clock(fixed_now: datetime):
    """Replace `datetime` and `date` in every app module with subclasses whose
    now()/utcnow()/today() return the scenario's day at 09:00 London, so the
    90-day wall-clock reads in analytics, companion and friends cannot make a
    snapshot drift. isinstance() still accepts real datetimes (metaclass).
    Returns a restore callable."""
    real_dt, real_date = datetime, date

    class _DTMeta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, real_dt)

    class _DateMeta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, real_date)

    class FrozenDatetime(real_dt, metaclass=_DTMeta):
        @classmethod
        def now(cls, tz=None):
            return fixed_now.astimezone(tz) if tz is not None else fixed_now.replace(tzinfo=None)

        @classmethod
        def utcnow(cls):
            return fixed_now.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

        @classmethod
        def today(cls):
            return fixed_now.replace(tzinfo=None)

    class FrozenDate(real_date, metaclass=_DateMeta):
        @classmethod
        def today(cls):
            return fixed_now.date()

    patched: list[tuple[object, str, object]] = []
    try:
        for mod in _app_modules():
            for attr, value in list(vars(mod).items()):
                if value is real_dt:
                    patched.append((mod, attr, value))
                    setattr(mod, attr, FrozenDatetime)
                elif value is real_date:
                    patched.append((mod, attr, value))
                    setattr(mod, attr, FrozenDate)
    except BaseException:
        for mod, attr, value in reversed(patched):
            setattr(mod, attr, value)
        raise

    def restore():
        for mod, attr, value in reversed(patched):
            setattr(mod, attr, value)

    return restore


def _dt(iso: str) -> datetime:
    d = date.fromisoformat(iso[:10])
    return datetime(d.year, d.month, d.day)


async def _seed(spec: dict, uid: str) -> None:
    from app.routers.analytics import PATTERNS_VERSION

    col = dbc
    # The disposable database is shared by every scenario in the run and fixture
    # account ids are plain strings, so empty the seeded collections first.
    # `_rebind_collections` has already asserted this is a wealth_test_* database.
    for c in (col.preferences_col, col.accounts_col, col.manual_accounts_col, col.cashflow_cache_col,
              col.transactions_col, col.commitments_col, col.allocations_col, col.card_terms_col):
        await c.delete_many({})
    await col.preferences_col.insert_one({
        "user_id": uid,
        "pay_period_config": spec["pay_period_config"],
        "income_streams": spec.get("confirmed_income_streams") or [],
    })
    for acc in spec.get("accounts", []):
        await col.accounts_col.insert_one({"user_id": uid, **acc})
    for acc in spec.get("manual_accounts", []):
        await col.manual_accounts_col.insert_one({"user_id": uid, **acc})
    cache = {"_id": uid, "patterns_version": PATTERNS_VERSION, "bnpl_commitments": [],
             "recurring_spend": [], "recurring_income": [], "avg_daily_spend": 0,
             **spec.get("cashflow_cache", {})}
    await col.cashflow_cache_col.insert_one(cache)
    for t in spec.get("transactions", []):
        await col.transactions_col.insert_one({**t, "user_id": uid, "date": _dt(t["date"])})
    for c in spec.get("commitments", []):
        await col.commitments_col.insert_one({"user_id": uid, **c})
    for a in spec.get("allocations", []):
        await col.allocations_col.insert_one({"user_id": uid, **a})
    for term in spec.get("card_terms", []):
        await col.card_terms_col.insert_one({"user_id": uid, **term})


def _r2(x):
    return None if x is None else round(float(x), 2)


async def _compute(spec: dict, uid: str) -> dict:
    from app.routers import analytics
    from app.routers.allocations import list_account_plans
    from app.services import companion
    from app.services.pay_period import _next_payday, get_pay_period_for_date

    today_d = timeutil.user_today()
    cfg = spec["pay_period_config"]
    # The real GET /cashflow handler: builder + live balance overlay + period facts.
    resp = await analytics.get_cashflow({"email": uid})
    sts = await analytics.compute_safe_to_spend(uid)
    at_risk = await analytics.at_risk_count({"email": uid})
    elig: dict = {}
    items = await companion.compute_today_items(uid, persist=False, account_eligibility_out=elig)
    pool = sts.get("safe_to_spend")
    companion.cap_spend_from_to_pool(elig, pool)
    plans = (await list_account_plans({"email": uid})).get("items") or []
    accounts = [
        {k: v for k, v in (a | {"id": str(a["_id"])}).items() if k not in ("_id", "user_id")}
        async for a in dbc.accounts_col.find({"user_id": uid})
    ]
    next_pay = _next_payday(today_d, cfg)
    pstart, pend = get_pay_period_for_date(today_d, cfg)
    return {
        "name": spec["name"],
        "today": today_d.isoformat(),
        "days_to_payday": (next_pay - today_d).days,
        "period": {"start": pstart.isoformat(), "end": pend.isoformat()},
        "safe_to_spend": {k: sts.get(k) for k in (
            "safe_to_spend", "safe_to_spend_cash", "card_growth_reserved",
            "commitments_reserved", "allocations_reserved", "calculation_status",
        )},
        "at_risk_count": at_risk["count"],
        "cashflow": {
            **{k: resp.get(k, []) for k in (
                "upcoming_bills", "upcoming_income", "internal_inflows", "observed_pending_bills",
            )},
            "spendable_balance": resp.get("spendable_balance"),
            "next_payday": resp.get("next_payday"),
            "period": resp.get("period"),
        },
        "accounts": sorted(accounts, key=lambda a: a["id"]),
        "account_eligibility": elig,
        "account_plans": plans,
        "items": [
            {k: i.get(k) for k in ("id", "type", "amount", "total", "moves", "dests", "salary", "covered", "income_note")
             if k in i}
            for i in items
        ],
    }


def _run_scenario(spec: dict, slug: str, monkeypatch, fixed_hour: int = 9) -> dict:
    from app.core.config import MONGO_URI

    uid = _uid(slug)
    today_d = date.fromisoformat(spec["today"])
    fixed_now = datetime(today_d.year, today_d.month, today_d.day, fixed_hour, 0, tzinfo=LONDON)
    monkeypatch.setattr(timeutil, "user_now", lambda: fixed_now)
    monkeypatch.setattr(timeutil, "user_today", lambda: today_d)

    async def go():
        client = make_guarded_client_class()(MONGO_URI, maxPoolSize=5, serverSelectionTimeoutMS=8000)
        restore = _rebind_collections(client)
        unfreeze = _freeze_clock(fixed_now)
        try:
            await _seed(spec, uid)
            return await _compute(spec, uid)
        finally:
            unfreeze()
            restore()
            client.close()

    return asyncio.run(go())


def _json_roundtrip(obj) -> dict:
    return json.loads(json.dumps(obj, sort_keys=True, default=str))


def _moves(snapshot: dict) -> list[dict]:
    out = []
    for item in snapshot["items"]:
        if item["type"] != "move":
            continue
        for m in item.get("moves") or []:
            mm = m["move_map"]
            out.append({"from": mm["from"]["account_id"], "to": mm["to"]["account_id"], "amount": m["amount"],
                        "card": item["id"]})
    return out


def _check_expected(snap: dict, spec: dict) -> None:
    exp = spec["expected"]
    where = f"[{spec['name']}]"
    assert _r2(snap["safe_to_spend"]["safe_to_spend"]) == _r2(exp["left_to_spend"]), f"{where} left_to_spend"
    assert snap["at_risk_count"] == exp["at_risk_count"], f"{where} at_risk_count"
    elig = snap["account_eligibility"]
    for acct_id, want in (exp.get("accounts") or {}).items():
        got = elig.get(acct_id)
        assert got is not None, f"{where} no account position for {acct_id}"
        spend_from = want.get("spend_from", want.get("available"))
        if spend_from is not None:
            assert _r2(got["spend_from_headroom"]) == _r2(spend_from), f"{where} {acct_id} spend_from"
        for key in ("after_payments", "low_point"):
            if key in want:
                assert _r2(got[key]) == _r2(want[key]), f"{where} {acct_id} {key}"
        if "verdict" in want:
            assert _verdict(got) == want["verdict"], f"{where} {acct_id} verdict"
    cover = exp.get("cover_plan")
    if cover is not None:
        moves = _moves(snap)
        assert _r2(sum(m["amount"] for m in moves)) == _r2(cover["moves_total"]), f"{where} cover moves_total"
        got_moves = sorted((m["from"], m["to"], _r2(m["amount"])) for m in moves)
        want_moves = sorted((m["from"], m["to"], _r2(m["amount"])) for m in cover["moves"])
        assert got_moves == want_moves, f"{where} cover moves"
    plan = next((i for i in snap["items"] if i["type"] == "payday_plan"), None)
    if exp.get("payday_plan") is None:
        assert plan is None, f"{where} unexpected payday plan"
    else:
        assert plan is not None, f"{where} payday plan missing"
        assert _r2(plan["total"]) == _r2(exp["payday_plan"]["total"]), f"{where} payday plan total"


def _verdict(position: dict) -> str:
    after, low = position.get("after_payments"), position.get("low_point")
    short = (after is not None and after < 0) or (low is not None and low < 0)
    return "short" if short else "covered"


def _check_invariants(snap: dict, spec: dict) -> None:
    where = f"[{spec['name']}]"
    pool = snap["safe_to_spend"]["safe_to_spend"]
    pool_shown = max(0.0, float(pool or 0.0))
    for acct_id, pos in snap["account_eligibility"].items():
        # 1. Spend from never exceeds the pooled Left to spend.
        assert pos["spend_from_headroom"] <= pool_shown + 0.005, f"{where} {acct_id} spend_from above pooled Left to spend"
        # 2. A short verdict is exactly: after payments or low point below zero.
        assert (_verdict(pos) == "short") == (
            (pos.get("after_payments") is not None and pos["after_payments"] < 0)
            or (pos.get("low_point") is not None and pos["low_point"] < 0)
        ), f"{where} {acct_id} verdict rule"
    # 3. Each cover-plan card's headline total equals the sum of its moves.
    for item in snap["items"]:
        if item["type"] == "move":
            assert _r2(item["amount"]) == _r2(sum(m["amount"] for m in item["moves"])), (
                f"{where} cover card {item['id']} headline total differs from its moves"
            )
    # 4. The payday plan's total equals the sum of its destination moves.
    plan = next((i for i in snap["items"] if i["type"] == "payday_plan"), None)
    if plan is not None:
        assert _r2(plan["total"]) == _r2(sum(d["move"] for d in plan["dests"])), f"{where} payday plan total vs dests"
    # 5. Every in-period bill appears in exactly one account walk.
    _check_each_bill_in_one_walk(snap, where)


def _in_walk_window(snap: dict, bill: dict) -> bool:
    # G360: the period ends the day before payday, no lookahead.
    return 0 <= bill["days_away"] < snap["days_to_payday"]


def _check_each_bill_in_one_walk(snap: dict, where: str) -> None:
    """A bill in the period is counted once: on exactly one paying account, and
    never twice in the payload (the G354 double count). Fixtures never contain
    two genuinely identical same-day debits, so a repeat key is a duplicate."""
    known = {a["id"] for a in snap["accounts"]}
    counts: dict[tuple, int] = {}
    for bill in snap["cashflow"]["upcoming_bills"]:
        if not _in_walk_window(snap, bill) or bill.get("is_credit_card") or bill.get("observed_pending"):
            continue
        assert bill.get("account_id") in known, f"{where} bill {bill['name']} has no known paying account, so it is in no walk"
        key = (bill["name"], bill["expected_date"], bill["amount"])
        counts[key] = counts.get(key, 0) + 1
    for key, n in counts.items():
        assert n == 1, f"{where} bill {key} appears {n} times in the period"


@pytest.mark.parametrize("path", FIXTURES, ids=[p.stem for p in FIXTURES])
def test_scenario(path, monkeypatch):
    spec = json.loads(path.read_text())
    snap = _json_roundtrip(_run_scenario(spec, path.stem, monkeypatch))

    _check_expected(snap, spec)
    _check_invariants(snap, spec)

    out_path = OUT_DIR / f"{path.stem}.json"
    rendered = json.dumps(snap, indent=2, sort_keys=True) + "\n"
    if os.environ.get("SCENARIO_WRITE") == "1":
        OUT_DIR.mkdir(exist_ok=True)
        out_path.write_text(rendered)
        return
    assert out_path.exists(), (
        f"no committed snapshot for {path.stem}: run `SCENARIO_WRITE=1 pytest tests/test_scenarios.py` "
        f"and review tests/scenarios/out/{path.stem}.json"
    )
    assert out_path.read_text() == rendered, (
        f"scenario {path.stem}: the computed snapshot differs from tests/scenarios/out/{path.stem}.json. "
        "If the change is intended, regenerate with SCENARIO_WRITE=1 pytest tests/test_scenarios.py, "
        "then review the diff: every changed figure must be explained by your change."
    )


def test_every_scenario_has_expected_notes():
    assert FIXTURES, "no scenarios found"
    for path in FIXTURES:
        spec = json.loads(path.read_text())
        assert len((spec["expected"].get("notes") or "").strip()) > 80, (
            f"{path.name}: expected.notes must show the hand computation"
        )


def test_frozen_clock_is_what_every_module_sees(monkeypatch):
    """The wall clock is frozen for the run: every app module that imported
    `datetime` or `date` sees the scenario's day, whatever the real date is, and
    the scenario's snapshot does not move with the time of day either."""
    spec = json.loads((SCEN_DIR / "card-bill-unconfirmed-hold.json").read_text())
    seen = []
    import app.routers.analytics as analytics_mod
    import app.services.companion as companion_mod

    unfreeze = _freeze_clock(datetime(2026, 10, 12, 9, 0, tzinfo=LONDON))
    try:
        for mod in (analytics_mod, companion_mod):
            day = getattr(mod, "date", None) or mod._date
            seen.append((mod.datetime.now().date(), mod.datetime.utcnow().date(), day.today()))
        assert isinstance(datetime(2026, 1, 1), analytics_mod.datetime)
    finally:
        unfreeze()
    assert all(row == (date(2026, 10, 12),) * 3 for row in seen)
    assert analytics_mod.datetime is datetime  # restored
    early = _json_roundtrip(_run_scenario(spec, "clock-a", monkeypatch, fixed_hour=0))
    late = _json_roundtrip(_run_scenario(spec, "clock-a", monkeypatch, fixed_hour=22))
    assert early == late
