"""G365 (money engine step 3): the one per-account walk.

Four places used to compute a per-account running balance over the same
WindowInputs (companion's closing walk `_walk_events`, `_source_min_running`,
`_walk_min`, and the inline loop in `analytics.at_risk_count`). This file pins
that they still produce exactly what they produced before the extraction.

`tests/fixtures/account_walk_golden.json` was captured from the OLD code
(WALK_GOLDEN_DUMP=1, one-off) on one fixture that exercises every difference
between the four walks. Two kinds of entry:

  - "callers": what the real callers computed (compute_today_items' walk
    events and results, the `compute_account_positions` arguments
    `_gp_closing` and `low_point_by_account`, the income notes, and
    `at_risk_count`), captured through spies on the real old code.
  - "legacy": per-account closing, low point, ordered events and (for the
    cover plan's `_walk_min`) the with-extra-income minima, computed by
    verbatim copies of the old closure bodies (`_legacy_*` below), because
    `_source_min_running` and `_walk_min` were closures inside
    compute_today_items and cannot be called from a test.
"""
import asyncio
import json
import os
from datetime import date, timedelta
from pathlib import Path

import pytest

import app.core.timeutil as timeutil
import app.db.collections as db_collections
import app.routers.analytics as analytics
import app.services.account_position as account_position
import app.services.companion as companion
import app.services.income as income
import app.services.pay_period as pay_period
from app.routers.analytics import PATTERNS_VERSION, income_credit_ok
from tests.test_internal_inflows import FakeCol

UID = "kevin"
TODAY = date(2026, 11, 2)
DAYS_TO_PAY = 10
GOLDEN = Path(__file__).parent / "fixtures" / "account_walk_golden.json"


# ── fixture ──────────────────────────────────────────────────────────────────

def _bill(name, days, amount, acct, bal, kind="commitment", card=False, **extra):
    b = {
        "name": name, "days_away": days, "amount": amount, "account_id": acct,
        "account_balance": bal, "is_credit_card": card, "kind": kind,
        "expected_date": (TODAY + timedelta(days=days)).isoformat(),
    }
    b.update(extra)
    return b


def _income(name, days, amount, acct):
    return {
        "name": name, "days_away": days, "amount": amount, "account_id": acct,
        "occurrences": 3, "amounts_recent": [amount, amount, amount],
        "confirmed_alias": None, "expected_date": (TODAY + timedelta(days=days)).isoformat(),
    }


def _inflow(days, amount, dest, src):
    return {
        "name": "OWN TRANSFER", "amount": amount, "days_away": days,
        "account_id": dest, "source_account_id": src,
    }


def _resp():
    return {
        "upcoming_bills": [
            # barclays: covered source of two funded inflows; movement bill to hsbc
            _bill("To HSBC", 2, 1758.33, "barclays", 5000.0, kind="movement"),
            _bill("To Pot", 3, 400.0, "barclays", 5000.0, kind="movement"),
            _bill("Insurance", 5, 120.0, "barclays", 5000.0),
            # hsbc: short until the funded inflow lands, then covered
            _bill("Council Tax", 4, 100.0, "hsbc", 12.0),
            # natwest: a bill and an UNFUNDED inflow (its source, lowsrc, is short)
            _bill("Gym", 3, 60.0, "natwest", 100.0),
            # lowsrc: short source; a movement bill that bounces (never counted),
            # a card repayment that bounces (counted), a plain bill that bounces
            _bill("Standing order out", 1, 90.0, "lowsrc", 5.0, kind="movement"),
            _bill("Card repayment", 2, 40.0, "lowsrc", 5.0, kind="movement", is_card_repayment=True),
            _bill("Phone", 6, 25.0, "lowsrc", 5.0),
            # bill on an account the user has no balance row for: seeded from the bill
            _bill("Orphan bill", 4, 70.0, "orphan", 40.0),
            # not assessable: credit card, and no balance data
            _bill("Amex bill", 5, 80.0, "amex", None, card=True),
            _bill("Unpriced", 6, 20.0, "ghost", None),
            # a G231 excluded account with a bill and an income
            _bill("Excluded rent", 4, 300.0, "excl", 50.0),
            # payday-day and later: not in the window
            _bill("Rent", DAYS_TO_PAY, 500.0, "barclays", 5000.0),
        ],
        "upcoming_income": [
            _income("ACME", 6, 2500.0, "barclays"),
            _income("ACME", DAYS_TO_PAY, 2500.0, "barclays"),
            # confirmed income attributed to an account with NO bill (pot)
            _income("Bonus", 5, 77.0, "pot"),
            # reliable-by-pattern income on hsbc, not confirmed
            _income("Refund", 7, 15.0, "hsbc"),
            _income("Excluded pay", 5, 900.0, "excl"),
        ],
        "internal_inflows": [
            _inflow(2, 1758.33, "hsbc", "barclays"),      # funded
            _inflow(3, 400.0, "pot", "barclays"),          # funded, account has no bill
            _inflow(5, 300.0, "natwest", "lowsrc"),        # unfunded, account has a bill
            _inflow(7, 50.0, "pot", "ghost"),              # unknown source: never credited
        ],
        "exclusions_unverified": True,
    }


PREFS = {
    "user_id": UID,
    "income_streams": [
        {"key": "ACME", "status": "confirmed"},
        {"key": "Bonus", "status": "confirmed"},
    ],
    "pay_period_config": {"type": "calendar_month"},
}

ACCOUNTS = [
    {"_id": "barclays", "user_id": UID, "balance": 4800.0, "subtype": "current"},
    {"_id": "hsbc", "user_id": UID, "balance": 12.0, "subtype": "current"},
    {"_id": "natwest", "user_id": UID, "balance": 90.0, "subtype": "current"},
    {"_id": "lowsrc", "user_id": UID, "balance": 5.0, "subtype": "current"},
    {"_id": "pot", "user_id": UID, "balance": 250.0, "subtype": "savings"},
    {"_id": "idle", "user_id": UID, "balance": 15.0, "subtype": "current"},
    {"_id": "excl", "user_id": UID, "balance": 50.0, "include_in_safe_to_spend": False},
]
YAPILY: list = []
MANUAL = [{"_id": "man1", "user_id": UID, "balance": 250.0, "account_type": "savings", "name": "Cash tin"}]

_PROJ = {"name": 1, "balance": 1, "current_balance": 1, "available_balance": 1,
         "subtype": 1, "account_subtype": 1, "type": 1, "provider": 1, "currency": 1,
         "nickname": 1, "display_name": 1, "include_in_safe_to_spend": 1}


def _norm(x):
    return json.loads(json.dumps(x, default=str, sort_keys=True))


def _patch_common(monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(
        pay_period, "_next_payday", lambda today_d, cfg: today_d + timedelta(days=DAYS_TO_PAY)
    )

    async def fake_resp(cached, uid=None, prefs=None):
        return _resp()

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)


def _build_wi(monkeypatch, *, resp=None):
    """The window inputs exactly as compute_today_items builds them."""
    from app.services import window_inputs as wim

    _patch_common(monkeypatch)
    kw = dict(
        load_balances=wim.user_accounts_loader(
            UID, FakeCol([dict(a) for a in ACCOUNTS]), FakeCol(YAPILY), FakeCol(MANUAL), _PROJ,
        ),
        stamp_credit_basis=True, reapply_exclusions=True, load_when_no_bills=True,
    )
    return asyncio.run(wim.build_window_inputs(
        UID, resp if resp is not None else _resp(), json.loads(json.dumps(PREFS)), **kw,
    ))


def _preview_salary(wi):
    """The payday-plan salary candidate, selected as compute_today_items does."""
    pool = [
        i for i in wi.window_income_before_exclusions + wi.payday_day_income
        if income_credit_ok(i, str(i.get("account_id") or ""), wi.confirmed_income_keys)
    ]
    confirmed = [
        i for i in pool
        if i.get("name") in wi.confirmed_income_keys or i.get("confirmed_alias") in wi.confirmed_income_keys
    ]
    use = confirmed or pool
    return max(use, key=lambda i: float(i["amount"])) if use else None


# ── real callers (spies on the live code) ────────────────────────────────────

def _capture_companion(monkeypatch):
    _patch_common(monkeypatch)
    store: dict = {}
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]))
    monkeypatch.setattr(companion, "_build_cashflow_response", analytics._build_cashflow_response)
    monkeypatch.setattr(companion, "preferences_col", FakeCol([json.loads(json.dumps(PREFS))]))
    monkeypatch.setattr(companion, "accounts_col", FakeCol([dict(a) for a in ACCOUNTS]))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol(YAPILY))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol(MANUAL))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([json.loads(json.dumps(PREFS))]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def _no_plans(uid, goals=False, strict=False):
        return []

    monkeypatch.setattr(companion, "_load_account_plans", _no_plans)

    real_walk = companion._walk_events

    def spy_walk(events, balances):
        out = real_walk(events, balances)
        if "walk" not in store:
            running, min_running, shortfall, bounced = out
            store["walk"] = {
                "events": list(events),
                "balances": dict(balances),
                "running": list(running.items()),
                "min_running": list(min_running.items()),
                "shortfall_bill": list(shortfall.items()),
                "bounced_bills": list(bounced.items()),
            }
        return out

    monkeypatch.setattr(companion, "_walk_events", spy_walk)

    real_positions = account_position.compute_account_positions

    def spy_positions(plans, closing, **kw):
        store["positions_args"] = {
            "closing": list(closing.items()),
            "low_point_by_account": list((kw.get("low_point_by_account") or {}).items()),
        }
        return real_positions(plans, closing, **kw)

    monkeypatch.setattr(account_position, "compute_account_positions", spy_positions)
    eligibility: dict = {}
    items = asyncio.run(companion.compute_today_items(
        UID, payday_preview=True, persist=False, account_eligibility_out=eligibility,
    ))
    store["eligibility"] = eligibility
    store["income_notes"] = sorted(
        str(v) for it in items for k, v in (it or {}).items()
        if isinstance(v, str) and "doesn't count" in v
    )
    store["move_cards"] = [
        {k: v for k, v in it.items() if k not in ("id", "created_at", "updated_at", "_id")}
        for it in items if it.get("type") == "move"
    ]
    store["item_types"] = sorted(str(it.get("type")) for it in items)
    return _norm(store)


def _capture_at_risk(monkeypatch):
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]),
    )
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([json.loads(json.dumps(PREFS))]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([dict(a) for a in ACCOUNTS]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol(YAPILY))
    # The events reach the walk already sorted since G365; compared in walk
    # order (the golden was captured in insertion order).
    import app.services.account_walk as account_walk
    real_walk = account_walk.walk_events
    seen: list = []

    def spy_walk(events, balances):
        # the old inline loop carried (kind, is_card_repayment) as the item
        seen.extend(
            (d, a, amt, inc, None if inc else (it.get("kind"), bool(it.get("is_card_repayment"))))
            for d, a, amt, inc, it in events
        )
        return real_walk(events, balances)

    monkeypatch.setattr(account_walk, "walk_events", spy_walk)
    result = asyncio.run(analytics.at_risk_count(user={"email": UID}))
    return _norm({"events_unsorted": list(seen), "result": result})


# ── verbatim copies of the OLD closure bodies (golden capture only) ──────────
# `_legacy_*` are the pre-G365 bodies of compute_today_items' closing-walk
# event build, `_source_min_running` and `_walk_min`, lifted unchanged so the
# golden can record per-account events and low points. They are only called
# from the WALK_GOLDEN_DUMP test below.

def _legacy_closing_events(wi, preview_salary):
    running = dict(wi.running_seed)
    live_balances = wi.live_balances
    events: list = []
    credited_incomes: dict = {}
    for b in wi.assessable_bills:
        events.append((b["days_away"], b["account_id"] or "__unknown__", float(b["amount"]), False, b))
    for i in wi.window_income:
        acct = str(i.get("account_id") or "")
        if acct in running and income_credit_ok(i, acct, wi.confirmed_income_keys):
            events.append((i["days_away"], acct, float(i["amount"]), True, i))
            credited_incomes.setdefault(acct, []).append(i)
    for n in wi.funded_window_inflows:
        acct = str(n.get("account_id") or "")
        if acct and acct not in running and acct in live_balances:
            running[acct] = live_balances[acct]
        if acct in running:
            events.append((n["days_away"], acct, float(n["amount"]), True, n))
    if preview_salary is not None:
        _sal_acct = str(preview_salary.get("account_id") or "")
        if _sal_acct:
            if _sal_acct not in running:
                running[_sal_acct] = live_balances.get(_sal_acct, 0.0)
            events.append((wi.days_to_pay, _sal_acct, float(preview_salary["amount"]), True, preview_salary))
    events.sort(key=companion.walk_sort_key)
    return events, running, credited_incomes


def _legacy_source_min_running(wi, sid, start_balance):
    ev = [
        (b["days_away"], -float(b["amount"]))
        for b in wi.assessable_bills
        if (b["account_id"] or "__unknown__") == sid
    ]
    ev += [
        (i["days_away"], float(i["amount"]))
        for i in wi.window_income
        if income_credit_ok(i, sid, wi.confirmed_income_keys)
    ]
    ev += [
        (n["days_away"], float(n["amount"]))
        for n in wi.funded_window_inflows
        if str(n.get("account_id") or "") == sid
    ]
    ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
    run = start_balance
    mn = run
    for _d, delta in ev:
        run += delta
        mn = min(mn, run)
    return mn, ev


def _legacy_walk_min(wi, credited_incomes, dest, extra_income=None):
    ev = [
        (b["days_away"], -float(b["amount"]))
        for b in wi.assessable_bills
        if (b["account_id"] or "__unknown__") == dest
    ]
    ev += [(i2["days_away"], float(i2["amount"])) for i2 in credited_incomes.get(dest, [])]
    ev += [
        (n["days_away"], float(n["amount"]))
        for n in wi.funded_window_inflows
        if str(n.get("account_id") or "") == dest
    ]
    if extra_income is not None:
        ev.append((extra_income["days_away"], float(extra_income["amount"])))
    ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
    run = wi.live_balances.get(dest, 0.0)
    mn = run
    for _d, _delta in ev:
        run += _delta
        mn = min(mn, run)
    return mn, ev


def _ev_names(events):
    return [[e[0], e[1], e[2], e[3], (e[4] or {}).get("name")] for e in events]


def _eligible_sources(wi):
    """The accounts the old `_source_min_running` loop visited, in its order."""
    out = []
    for acc in wi.all_uk_accounts + wi.offline_accounts:
        if companion.is_credit_card_account(acc):
            continue
        if companion._is_current(acc) or companion._is_savings(acc) or companion._is_offline(acc):
            out.append(acc)
    return out


def _capture_legacy(monkeypatch):
    wi = _build_wi(monkeypatch)
    salary = _preview_salary(wi)
    events, seed, credited = _legacy_closing_events(wi, salary)
    running, min_running, shortfall, bounced = companion._walk_events(events, dict(seed))
    out: dict = {
        "preview_salary": (salary or {}).get("name"),
        "closing": {
            "events": _ev_names(events),
            "seed": list(seed.items()),
            "running": list(running.items()),
            "min_running": list(min_running.items()),
            "shortfall_bill": [[a, b.get("name")] for a, b in shortfall.items()],
            "bounced_bills": [[a, [b.get("name") for b in bl]] for a, bl in bounced.items()],
            "credited_incomes": [[a, [i.get("name") for i in il]] for a, il in credited.items()],
        },
    }
    low: dict = {}
    for acc in _eligible_sources(wi):
        sid = acc["_str_id"]
        bal = wi.live_balances.get(sid, float(acc.get("balance") or 0))
        mn, ev = _legacy_source_min_running(wi, sid, bal)
        low[sid] = {"opening": bal, "low_point": mn, "events": ev}
    out["source_low_point"] = low
    credited_ids = {id(i) for lst in credited.values() for i in lst}
    excluded_incomes = [i for i in wi.window_income if id(i) not in credited_ids]
    out["excluded_incomes"] = [i["name"] for i in excluded_incomes]
    walk_min: dict = {}
    for sid in sorted(set(seed) | set(low) | set(wi.live_balances)):
        base, ev = _legacy_walk_min(wi, credited, sid)
        with_extra = {}
        for inc in excluded_incomes:
            with_extra[inc["name"]] = _legacy_walk_min(wi, credited, sid, inc)[0]
        walk_min[sid] = {"opening": wi.live_balances.get(sid, 0.0), "min": base, "events": ev, "with_extra": with_extra}
    out["walk_min"] = walk_min
    return _norm(out)


CAPTURES = {
    "companion": _capture_companion,
    "at_risk": _capture_at_risk,
    "legacy": _capture_legacy,
}


def test_dump_golden(monkeypatch):
    """Only runs with WALK_GOLDEN_DUMP=1 (used once, on the pre-extraction code)."""
    if not os.environ.get("WALK_GOLDEN_DUMP"):
        pytest.skip("golden capture is a one-off")
    out = {}
    for name, fn in CAPTURES.items():
        with monkeypatch.context() as m:
            out[name] = fn(m)
    GOLDEN.write_text(json.dumps(out, indent=1, sort_keys=True) + "\n")


# ── the real callers still produce exactly what they did before ──────────────

@pytest.mark.parametrize("name", ["companion", "at_risk"])
def test_caller_output_equals_pre_extraction_golden(monkeypatch, name):
    golden = json.loads(GOLDEN.read_text())[name]
    got = CAPTURES[name](monkeypatch)
    if name == "at_risk":
        golden["events_unsorted"] = sorted(
            golden["events_unsorted"], key=lambda e: (e[0], 0 if e[3] else 1)
        )
        got["events_unsorted"] = sorted(got["events_unsorted"], key=lambda e: (e[0], 0 if e[3] else 1))
    assert got == golden


# ── the one walk reproduces the old per-caller figures (legacy golden) ───────

from app.services import account_walk as aw  # noqa: E402


def _names(events):
    return [[e[0], e[1], e[2], e[3], (e[4] or {}).get("name")] for e in events]


@pytest.fixture
def wi(monkeypatch):
    return _build_wi(monkeypatch)


def _golden_legacy():
    return json.loads(GOLDEN.read_text())["legacy"]


def test_closing_walk_equals_the_old_closing_golden(wi):
    g = _golden_legacy()["closing"]
    salary = _preview_salary(wi)
    assert salary["name"] == "ACME"
    events, seed, credited = aw.window_events(wi, inflow_admit="seed_live", preview_salary=salary)
    assert _norm(_names(events)) == g["events"]
    assert _norm(list(seed.items())) == g["seed"]
    running, min_running, shortfall, bounced = aw.walk_events(events, dict(seed))
    assert _norm(list(running.items())) == g["running"]
    assert _norm(list(min_running.items())) == g["min_running"]
    assert [[a, b["name"]] for a, b in shortfall.items()] == g["shortfall_bill"]
    assert [[a, [b["name"] for b in bl]] for a, bl in bounced.items()] == g["bounced_bills"]
    assert [[a, [i["name"] for i in il]] for a, il in credited.items()] == g["credited_incomes"]


def test_low_point_walk_equals_the_old_source_min_running_golden(wi):
    g = _golden_legacy()["source_low_point"]
    walked = {}
    for acc in _eligible_sources(wi):
        sid = acc["_str_id"]
        bal = wi.live_balances.get(sid, float(acc.get("balance") or 0))
        w = aw.walk_account(
            sid, wi, opening=bal, income_admit="any", inflow_admit="any", same_day_key="positive_delta",
        )
        walked[sid] = {
            "opening": bal, "low_point": w.low_point,
            "events": [(e[0], e[2] if e[3] else -e[2]) for e in w.events],
        }
    assert _norm(walked) == g


def test_with_extra_income_walk_equals_the_old_walk_min_golden(wi):
    g = _golden_legacy()
    _events, _seed, credited = aw.window_events(wi, inflow_admit="seed_live", preview_salary=_preview_salary(wi))
    credited_ids = {id(i) for lst in credited.values() for i in lst}
    excluded = [i for i in wi.window_income if id(i) not in credited_ids]
    assert [i["name"] for i in excluded] == g["excluded_incomes"]
    got = {}
    for sid in g["walk_min"]:
        kw = dict(opening=wi.live_balances.get(sid, 0.0), income_admit="seeded", inflow_admit="any",
                  same_day_key="positive_delta")
        base = aw.walk_account(sid, wi, **kw)
        got[sid] = {
            "opening": wi.live_balances.get(sid, 0.0),
            "min": base.low_point,
            "events": [(e[0], e[2] if e[3] else -e[2]) for e in base.events],
            "with_extra": {
                inc["name"]: aw.walk_account(sid, wi, extra_income=inc, **kw).low_point for inc in excluded
            },
        }
    assert _norm(got) == g["walk_min"]


def _at_risk_wi(monkeypatch):
    from app.services import window_inputs as wim

    _patch_common(monkeypatch)
    return asyncio.run(wim.build_window_inputs(
        UID, _resp(), json.loads(json.dumps(PREFS)),
        load_balances=wim.bill_account_loader(FakeCol([dict(a) for a in ACCOUNTS]), FakeCol(YAPILY)),
    ))


def test_at_risk_count_equals_the_golden_count(monkeypatch):
    wi_ar = _at_risk_wi(monkeypatch)
    events, seed, _ = aw.window_events(wi_ar)
    _r, _m, _s, bounced = aw.walk_events(events, seed)
    assert aw.count_at_risk(bounced) == json.loads(GOLDEN.read_text())["at_risk"]["result"]["count"] == 4


# ── AccountWalk carries closing, low point, first short and dated rows ───────

def test_account_walk_result_fields(wi):
    w = aw.walk_account("lowsrc", wi, opening=5.0)
    assert [r.item["name"] for r in w.rows] == ["Standing order out", "Card repayment", "Phone"]
    assert [round(r.running, 2) for r in w.rows] == [-85.0, -125.0, -150.0]
    assert w.closing == -150.0 and w.low_point == -150.0 and w.opening == 5.0
    assert w.first_short.bill["name"] == "Standing order out"
    assert (w.first_short.day, round(w.first_short.shortfall, 2)) == (1, 85.0)
    assert [b["name"] for b in w.bounced] == ["Standing order out", "Card repayment", "Phone"]
    assert all(r.short and r.delta < 0 for r in w.rows)
    covered = aw.walk_account("barclays", wi, opening=4800.0)
    assert covered.first_short is None and covered.bounced == []
    assert covered.low_point == round(4800.0 - 1758.33 - 400.0 - 120.0, 2)


def test_an_account_with_no_events_keeps_its_opening(wi):
    w = aw.walk_account("idle", wi, opening=15.0)
    assert (w.closing, w.low_point, w.first_short, w.rows, w.events) == (15.0, 15.0, None, [], [])
    # compute_today_items reads `running.get(sid, live)`: untracked means live.
    events, seed, _ = aw.window_events(wi, inflow_admit="seed_live")
    assert "idle" not in seed


def test_low_point_is_a_running_minimum_from_the_opening_balance(wi):
    # hsbc opens at 12, pays 100 on day 4 after a 1758.33 funded inflow on day 2
    w = aw.walk_account("hsbc", wi, opening=12.0, inflow_admit="any")
    assert [round(r.running, 2) for r in w.rows] == [1770.33, 1670.33, 1685.33]
    assert w.low_point == 12.0  # the opening is the lowest point, no debit went below it


# ── one test per W-difference, flipping only that keyword ────────────────────

def test_wd1_wd4_inflow_admit_flips_only_which_accounts_an_inflow_reaches(wi):
    # pot has no bill: a funded inflow reaches it only when it may seed it or any
    seeded = aw.walk_account("pot", wi, opening=250.0, inflow_admit="seeded")
    seed_live = aw.walk_account("pot", wi, opening=250.0, inflow_admit="seed_live")
    anyone = aw.walk_account("pot", wi, opening=250.0, inflow_admit="any")
    assert seeded.events == [] and seeded.closing == 250.0
    assert [e[2] for e in seed_live.events] == [400.0] and seed_live.closing == 650.0
    assert anyone.events == seed_live.events
    # a bill-seeded account takes its funded inflow in every mode
    for mode in ("seeded", "seed_live", "any"):
        hs = aw.walk_account("hsbc", wi, opening=12.0, inflow_admit=mode)
        assert 1758.33 in [e[2] for e in hs.events]
    # the unfunded inflow (its source is short) is never in the funded list
    nw = aw.walk_account("natwest", wi, opening=90.0, inflow_admit="any")
    assert 300.0 not in [e[2] for e in nw.events]
    # the window walk tracks pot only with seed_live
    _e, tracked_seeded, _c = aw.window_events(wi, inflow_admit="seeded")
    _e, tracked_live, _c = aw.window_events(wi, inflow_admit="seed_live")
    assert "pot" not in tracked_seeded and tracked_live["pot"] == 250.0
    with pytest.raises(ValueError):
        aw.window_events(wi, inflow_admit="any")


def test_wd2_the_opening_balance_is_the_callers(wi):
    a = aw.walk_account("barclays", wi, opening=4800.0)
    b = aw.walk_account("barclays", wi, opening=100.0)
    assert a.events == b.events and b.closing == a.closing - 4700.0
    assert b.first_short is not None and a.first_short is None


def test_wd3_income_admit_flips_only_the_seeding_requirement(wi):
    # Bonus is attributed to pot, which has no bill of its own
    seeded = aw.walk_account("pot", wi, opening=250.0, income_admit="seeded", inflow_admit="any")
    anyone = aw.walk_account("pot", wi, opening=250.0, income_admit="any", inflow_admit="any")
    assert "Bonus" not in [(e[4] or {}).get("name") for e in seeded.events]
    assert "Bonus" in [(e[4] or {}).get("name") for e in anyone.events]
    assert seeded.credited_incomes == [] and [i["name"] for i in anyone.credited_incomes] == ["Bonus"]
    assert round(anyone.closing - seeded.closing, 2) == 77.0
    # an account that has a bill takes its credit-ok income either way
    for mode in ("seeded", "any"):
        bc = aw.walk_account("barclays", wi, opening=4800.0, income_admit=mode)
        assert "ACME" in [(e[4] or {}).get("name") for e in bc.events]
    with pytest.raises(ValueError):
        aw.walk_account("pot", wi, opening=0.0, income_admit="sometimes")


def test_wd5_preview_salary_lands_at_days_to_pay_on_its_account_only(wi):
    salary = _preview_salary(wi)
    plain = aw.walk_account("barclays", wi, opening=4800.0)
    with_salary = aw.walk_account("barclays", wi, opening=4800.0, preview_salary=salary)
    extra = [e for e in with_salary.events if e not in plain.events]
    assert [(e[0], e[2], e[3]) for e in extra] == [(DAYS_TO_PAY, 2500.0, True)]
    assert round(with_salary.closing - plain.closing, 2) == 2500.0
    assert with_salary.low_point == plain.low_point
    other = aw.walk_account("hsbc", wi, opening=12.0, preview_salary=salary)
    assert other.events == aw.walk_account("hsbc", wi, opening=12.0).events
    # a salary account with no bill is tracked at its live balance
    ghost = dict(salary, account_id="pot")
    _e, tracked, _c = aw.window_events(wi, preview_salary=ghost)
    assert tracked["pot"] == 250.0
    assert "pot" not in aw.window_events(wi)[1]


def test_wd6_extra_income_is_one_event_at_its_own_day(wi):
    inc = {"name": "Maybe", "days_away": 4, "amount": 200.0, "account_id": "elsewhere"}
    base = aw.walk_account("lowsrc", wi, opening=5.0)
    more = aw.walk_account("lowsrc", wi, opening=5.0, extra_income=inc)
    assert [e for e in more.events if e not in base.events] == [(4, "lowsrc", 200.0, True, inc)]
    assert more.low_point > base.low_point


def test_wd7_credited_incomes_are_disclosed_by_the_walk(wi):
    events, seed, credited = aw.window_events(wi, inflow_admit="seed_live")
    assert {a: [i["name"] for i in il] for a, il in credited.items()} == {
        "barclays": ["ACME"], "hsbc": ["Refund"],
    }
    # inflows and the preview salary are never "credited incomes"
    events2, _s, credited2 = aw.window_events(wi, inflow_admit="seed_live", preview_salary=_preview_salary(wi))
    assert credited2 == credited and len(events2) == len(events) + 1


def test_wd8_same_day_key_only_changes_the_order_for_a_non_positive_credit(wi):
    zero = {"name": "Zero", "days_away": 2, "amount": 0.0, "account_id": "lowsrc"}
    a = aw.walk_account("lowsrc", wi, opening=5.0, extra_income=zero, same_day_key="is_income")
    b = aw.walk_account("lowsrc", wi, opening=5.0, extra_income=zero, same_day_key="positive_delta")
    day2 = lambda w: [(e[4] or {}).get("name") for e in w.events if e[0] == 2]  # noqa: E731
    assert day2(a) == ["Zero", "Card repayment"]
    assert day2(b) == ["Card repayment", "Zero"]
    # the figures do not move
    assert (a.closing, a.low_point) == (b.closing, b.low_point)
    # a positive credit sorts first under both
    pos = {"name": "Pos", "days_away": 2, "amount": 10.0, "account_id": "lowsrc"}
    for key in ("is_income", "positive_delta"):
        w = aw.walk_account("lowsrc", wi, opening=5.0, extra_income=pos, same_day_key=key)
        assert day2(w)[0] == "Pos"
    with pytest.raises(ValueError):
        aw.walk_account("lowsrc", wi, opening=5.0, same_day_key="alphabetical")


def test_wd9_count_at_risk_skips_a_bounced_movement_but_counts_a_card_repayment(wi):
    w = aw.walk_account("lowsrc", wi, opening=5.0)
    assert [b["name"] for b in w.bounced] == ["Standing order out", "Card repayment", "Phone"]
    assert aw.count_at_risk({"lowsrc": w.bounced}) == 2  # the movement one is not counted
    # first_short is the head of bounced, which here is the movement bill
    assert w.first_short.bill["kind"] == "movement"
    assert aw.count_at_risk({}) == 0


# ── the compat entry point keeps its old shape ──────────────────────────────

def test_walk_events_account_absent_from_balances_starts_at_zero_and_keeps_old_key_order():
    b = {"name": "b"}
    c = {"name": "c"}
    events = [
        (1, "x", 50.0, True, None),       # credit first: x not in balances
        (2, "x", 20.0, False, b),
        (3, "y", 5.0, False, c),          # y not in balances, goes negative
        (4, "z", 1.0, True, None),        # credit-only account: not in min_running
    ]
    running, mn, short, bounced = aw.walk_events(events, {"a": 10.0})
    assert list(running) == ["a", "x", "y", "z"] and running["x"] == 30.0 and running["y"] == -5.0
    assert list(mn) == ["a", "x", "y"] and mn["a"] == 10.0 and mn["x"] == 30.0 and mn["y"] == -5.0
    assert short == {"y": c} and bounced == {"y": [c]}


def test_walk_events_is_importable_from_companion_unchanged():
    assert companion._walk_events is aw.walk_events
    assert companion.walk_sort_key is aw.walk_sort_key


def test_credited_incomes_keep_the_window_income_key_order():
    """The consumer takes max(amount) over the credited incomes, so on an
    amount tie the first one wins: the old closing walk built the dict while
    looping `window_income`, not in the order the accounts were seeded."""
    from types import SimpleNamespace

    def inc(acct, day):
        return {"name": f"Pay {acct}", "account_id": acct, "amount": 1000.0, "days_away": day,
                "expected_date": f"2026-11-{day:02d}", "credit_basis": "steady", "steady_salary": True}

    inputs = SimpleNamespace(
        assessable_bills=[_bill("a", 1, 10.0, "A", 500.0), _bill("b", 1, 10.0, "B", 500.0)],
        window_income=[inc("B", 5), inc("A", 3)],  # B's income first, A seeded first
        confirmed_income_keys={"Pay A", "Pay B"},
        funded_window_inflows=[], live_balances={"A": 500.0, "B": 500.0},
        running_seed={"A": 500.0, "B": 500.0}, days_to_pay=10,
    )
    _events, seed, credited = aw.window_events(inputs)
    assert list(seed) == ["A", "B"]
    assert list(credited) == ["B", "A"]
    steady = [i for lst in credited.values() for i in lst if i.get("credit_basis") == "steady"]
    assert max(steady, key=lambda i: float(i["amount"]))["expected_date"] == "2026-11-05"
