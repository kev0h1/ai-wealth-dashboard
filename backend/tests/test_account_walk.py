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
