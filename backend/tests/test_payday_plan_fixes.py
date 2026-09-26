"""Coverage for the payday-plan fixes agreed 2026-08-29, revised G164
(2026-09-26, Kevin's advisory-only decision):

FIX A — a call landing INSIDE the payday window AFTER the live payday_plan
doc has already settled ("done" — the user acted on it by hand — or
"superseded" — their own standing orders got there first, G164) must never
compute a fresh plan FOR THAT WINDOW. G164 dropped the old "already split"
executed summary entirely: the payday plan is purely advisory, so a settled
window has nothing left to REPORT either — a plain in-window call emits
NOTHING. A `payday_preview` call is different: Penny always wants the NEXT
payday's plan, settled window or not, so preview keeps running and prices
the period after the settled one.

G164 — a payday_plan doc born ACTIVE and already fully cleared before the
SAME `compute_today_items` call even finishes (the standing orders had
already fired before Sorted ever proposed anything) is superseded quietly:
no "done", no celebration, no item at all — including the in-memory item
already added earlier in that same call. A doc that was active in an
EARLIER run and clears now is the user-acted-by-hand case and keeps the
done+celebrate behaviour that predates G164.

FIX B — a genuine preview (taken OUTSIDE the payday window, or INSIDE one
that has already settled, per FIX A above) must date its simulated salary
credit at the REAL next payday inside the existing running-balance walk,
not "today" — draining this period's remaining bills first, exactly as the
walk already does for every other event.

FIX C — `commitment_names` (already computed server-side) must reach a
floored dest's payload unchanged, confirming the frontend has something to
render.

Follows the full-collection-fake pattern established by
tests/test_payday_split.py (real `compute_today_items`, no mocked Mongo).
"""
import asyncio
from datetime import date, datetime, timedelta

import app.core.timeutil as timeutil
import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module

UID = "payday-fix-user"
SALARY_ACCT = "acc-salary"
DEST_ACCT = "acc-dest"


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n):
        return list(self._docs)

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
        return self


class _Col:
    """Minimal Motor stand-in — same precedent as test_payday_split.py's
    harness: query filtering is NOT implemented for `find_one`/`find` in
    general (single-user fixtures), but `find_one` DOES check `_id` so the
    FIX A gate's own `find_one`-free `async for ... find(...)` prefix-match
    still exercises real filtering logic in companion.py itself, not here."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        return self.docs[0] if self.docs else None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("_id") == filt.get("_id"):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return
        if upsert:
            new_doc = dict(filt)
            for k, v in (update.get("$set") or {}).items():
                new_doc[k] = v
            self.docs.append(new_doc)


def _account(acct_id, balance, name="Salary Account"):
    return {
        "_id": acct_id, "name": name, "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _bill(name, days_away, amount, account_id=SALARY_ACCT, account_balance=1.0):
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_balance": account_balance, "is_credit_card": False,
        "kind": "commitment", "expected_date": "2026-08-29",
    }


def _salary(days_away, amount, account_id=SALARY_ACCT):
    return {
        "name": "Salary", "days_away": days_away, "amount": amount,
        "account_id": account_id, "occurrences": 3,
        "amounts_recent": [amount, amount, amount],
    }


def _base_patch(monkeypatch, *, accounts, bills, income, companion_items=None):
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col(companion_items or []))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    # See test_payday_split.py's identical note: app.services.pace owns its
    # own module-level collection bindings — patch them too so this suite
    # never touches Mongo.
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income, "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    return pay_period


def _payday_plan(items):
    return next((i for i in items if i["type"] == "payday_plan"), None)


# ── FIX A / G164 — settled-window gate + advisory-only lifecycle ────────────

def _make_settled_doc(pstart: date, dests, *, status: str, created_at=None):
    total = sum(d["move"] for d in dests)
    doc = {
        "_id": f"payday_plan:{pstart.isoformat()}:realfp",
        "uid": UID,
        "type": "payday_plan",
        "status": status,
        "headline": f"Payday plan: split £{total:,} across {len(dests)} accounts",
        "body": f"£{total:,} distributed, £0 stays in Salary Account.",
        "action": {"label": "See what's due ›", "route": "/upcoming"},
        "estimated": False,
        "_window_end": (pstart + timedelta(days=30)).isoformat(),
        "_dest_accts": [d["account_id"] for d in dests],
        "_total": total,
        "covered": True,
        "dests": dests,
        "salary": {
            "account_id": SALARY_ACCT, "name": "Salary Account", "provider": "Barclays",
            "amount": 2000, "stays": 0,
        },
        "trimmed": False,
    }
    if created_at is not None:
        doc["created_at"] = created_at
    return doc


def test_born_done_plan_is_superseded_with_no_celebration_and_no_item(monkeypatch):
    """G164: a payday_plan doc built THIS SAME run (section 5b) whose
    destinations already all clear (`min_running >= 0`) by the time step 7
    checks it was never a live suggestion the user could act on — the
    standing orders had already fired before Sorted ever proposed anything.
    It is superseded quietly: no "done", no `_celebrated`, no item at all —
    including the in-memory item 5b already appended this same call."""
    today_d = timeutil.user_today()
    pay_period = _base_patch(
        monkeypatch,
        # DEST_ACCT has no bills/income of its own, so the running walk
        # never pushes it negative (min_running stays at its own starting
        # balance, 0.0, which is >= 0) — while section 5b's own target
        # formula (bills_total + spend_typical + buffer, all zero here bar
        # the default £50 payday_buffer) still proposes topping it up.
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    assert _payday_plan(items) is None, "a plan that clears before it was ever live must emit nothing"

    plan_docs = [d for d in companion.companion_items_col.docs if d.get("type") == "payday_plan"]
    assert len(plan_docs) == 1
    assert plan_docs[0]["status"] == "superseded"
    assert not plan_docs[0].get("_celebrated")

    celebrations = [i for i in items if i["type"] == "celebration"]
    assert not celebrations, "a born-done plan must never celebrate"


def test_active_plan_from_an_earlier_run_that_clears_is_done_and_celebrated(monkeypatch):
    """The pre-G164 path is unchanged: a plan that was ALREADY active from
    an earlier run (its own `created_at` predates this call's start) and
    NOW clears is the user-acted-by-hand case — it goes "done", celebrates
    once, exactly as before."""
    today_d = timeutil.user_today()
    pay_period = _base_patch(monkeypatch, accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 500.0, "Everyday")], bills=[], income=[])
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))

    dests = [
        {
            "account_id": DEST_ACCT, "name": "Everyday", "provider": "Barclays",
            "balance": 500, "bills_total": 0, "bill_count": 0, "spend_typical": 0, "buffer": 0,
            "target": 500, "move": 500, "usual": None,
        },
    ]
    earlier_run = datetime.utcnow() - timedelta(hours=2)
    active_doc = _make_settled_doc(today_d, dests, status="active", created_at=earlier_run)
    monkeypatch.setattr(companion, "companion_items_col", _Col([active_doc]))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    stored = next(d for d in companion.companion_items_col.docs if d["_id"] == active_doc["_id"])
    assert stored["status"] == "done"
    assert stored.get("_celebrated") is True

    celebrations = [i for i in items if i["type"] == "celebration"]
    assert celebrations, "an earlier-run active plan clearing now must still celebrate"


def test_preview_inside_a_paid_window_prices_the_next_period(monkeypatch):
    """G164: once a window has settled (done or superseded), a plain call
    emits nothing (see the next test), but Penny's `payday_preview` call
    must still get a plan — for the NEXT payday, not a recompute of the
    settled one, and without double-crediting the salary that has already
    landed in `live_balances`."""
    today_d = timeutil.user_today()
    days_to_pay = 30
    pay_period = _base_patch(
        monkeypatch,
        # SALARY_ACCT's balance already reflects the landed salary; the
        # only future event is next period's own bill and next period's
        # own salary, about a month out.
        accounts=[_account(SALARY_ACCT, 5000.0)],
        bills=[_bill("Mortgage", days_to_pay - 5, 900.0, account_id=SALARY_ACCT)],
        income=[_salary(days_to_pay, 2500.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=3)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=days_to_pay))

    # A settled window (superseded here; "done" behaves identically per the
    # FIX A gate, which treats both the same way) for the CURRENT window.
    settled_doc = _make_settled_doc(today_d, [
        {"account_id": SALARY_ACCT, "name": "Salary Account", "provider": "Barclays",
         "balance": 0, "bills_total": 0, "bill_count": 0, "spend_typical": 0, "buffer": 0,
         "target": 0, "move": 0, "usual": None},
    ], status="superseded")
    monkeypatch.setattr(companion, "companion_items_col", _Col([settled_doc]))

    calls: list[tuple[list, dict]] = []
    real_walk = companion._walk_events

    def spy(events, balances):
        calls.append((list(events), dict(balances)))
        return real_walk(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy)

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    plan = _payday_plan(items)
    assert plan is not None, "a preview must still price the NEXT payday even inside a settled window"
    assert plan.get("preview") is True
    assert plan["next_pay"] == (today_d + timedelta(days=days_to_pay)).isoformat()

    # No double-counting: the preview salary credit enters the walk dated at
    # next_pay, never at "today" (day 0) — the account's CURRENT balance
    # already carries whatever landed previously; crediting it again at day
    # 0 would double it.
    main_events, _ = calls[0]
    salary_events = [e for e in main_events if e[1] == SALARY_ACCT and e[3] is True and abs(e[2] - 2500.0) < 0.01]
    assert salary_events, "preview salary credit never entered the walk as an event"
    assert all(e[0] == days_to_pay for e in salary_events)
    assert not any(e[0] == 0 for e in salary_events), "salary must not be credited a second time 'today'"


def test_plain_in_window_call_with_superseded_doc_emits_nothing_and_does_not_suppress_moves(monkeypatch):
    """G164: a plain (non-preview) in-window call against a settled window
    emits no payday_plan item at all (the advisory plan has nothing left to
    report), and — unlike the old live-plan window — must NOT suppress the
    ordinary per-destination move cards: a residual shortfall is exactly
    how Penny should still speak if the standing orders left an account
    short."""
    today_d = timeutil.user_today()
    pay_period = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 50.0), _account(DEST_ACCT, 0.0, "Everyday")],
        # A genuine, still-unfunded shortfall at DEST_ACCT — proof a "move"
        # recommendation can still surface once the plan itself is settled.
        bills=[_bill("Rent", 2, 400.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(20, 3000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=20))

    settled_doc = _make_settled_doc(today_d, [
        {"account_id": DEST_ACCT, "name": "Everyday", "provider": "Barclays",
         "balance": 0, "bills_total": 400, "bill_count": 1, "spend_typical": 0, "buffer": 0,
         "target": 400, "move": 400, "usual": None},
    ], status="superseded")
    monkeypatch.setattr(companion, "companion_items_col", _Col([settled_doc]))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=False))

    assert _payday_plan(items) is None

    move_items = [i for i in items if i["type"] == "move"]
    assert move_items, "a residual shortfall must still surface as a move card once the plan is settled"


# ── FIX B — dated preview salary credit ──────────────────────────────────────

def test_preview_salary_credit_lands_at_next_pay_not_today(monkeypatch):
    """Outside the payday window (the only place a genuine preview should
    run once FIX A's gate is in place): the simulated salary must enter the
    walk dated at the REAL next payday, after this period's remaining bills
    have already drained the account — not immediately today."""
    today_d = timeutil.user_today()
    days_to_pay = 5
    bill_days_away = 3
    bill_amount = 200.0
    start_balance = 1000.0
    salary_amount = 1500.0

    pay_period = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, start_balance)],
        bills=[_bill("Council Tax", bill_days_away, bill_amount)],
        income=[_salary(days_to_pay, salary_amount)],  # on payday itself
    )
    # OUTSIDE the window (days_into_period large) — the gated, genuine
    # preview case per FIX A's contract.
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d - timedelta(days=20), today_d + timedelta(days=days_to_pay)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=days_to_pay))

    calls: list[tuple[list, dict]] = []
    real_walk = companion._walk_events

    def spy(events, balances):
        calls.append((list(events), dict(balances)))
        return real_walk(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy)

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    assert _payday_plan(items) is not None
    assert calls, "expected the walk to run at least once"

    main_events, main_seed = calls[0]
    salary_events = [e for e in main_events if e[1] == SALARY_ACCT and e[3] is True and abs(e[2] - salary_amount) < 0.01]
    assert salary_events, "preview salary credit never entered the walk as an event"
    assert all(e[0] == days_to_pay for e in salary_events), (
        f"preview salary credit must be dated at next_pay (days_away={days_to_pay}), "
        f"got {[e[0] for e in salary_events]}"
    )
    assert not any(e[0] == 0 for e in salary_events), "salary must not be credited 'today'"

    # Replay the SAME walk twice — once truncated to everything strictly
    # BEFORE next_pay, once with next_pay's own events included — to prove
    # the balance excludes the credit right up to the boundary and includes
    # it from next_pay onward, under the standing same-day (bills-before-
    # income) ordering rule.
    def _sorted(evts):
        return sorted(evts, key=lambda e: (e[0], 1 if e[3] else 0))

    before = [e for e in main_events if e[0] < days_to_pay]
    running_before, _, _, _ = real_walk(_sorted(before), dict(main_seed))
    running_after, _, _, _ = real_walk(_sorted(main_events), dict(main_seed))

    assert running_before[SALARY_ACCT] == start_balance - bill_amount
    assert running_after[SALARY_ACCT] == start_balance - bill_amount + salary_amount
