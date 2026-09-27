"""Coverage for the payday-plan behaviour agreed 2026-08-29, revised G164
(2026-09-26), and stripped of all lifecycle machinery by G172 (2026-09-27,
Kevin): the payday plan carries NO done/celebration/funded-by-hand state.
It is a distribution recommendation for the period that starts on payday,
recomputed fresh from live balances on every call — nothing is ever read
back from a prior run to decide whether to show it.

FIX A (kept, reframed) — a call landing INSIDE the payday window must
still price the plan for THIS window (never recomputing a stale
month-out figure), and a `payday_preview` call must always price the
NEXT payday regardless of where `today` sits. There is no "done doc"
concept left to gate on: the only real precondition left is the window
position itself, which section 5b already handles via
`_effective_payday_window`.

SALARY-OBSERVED (G172, new) — the live plan stops showing once a real
credit matching the plan's identified salary has actually landed in the
salary account since this pay period's first day (`_pp_salary_observed`).
Kevin: the plan is a recommendation for money not yet in place; once the
salary is actually sitting in the account there is nothing left to
recommend. A `payday_preview` call is unaffected — it always prices the
NEXT payday, whose salary hasn't landed yet by construction.

TOTAL-ZERO (G172 decision) — a plan whose every destination already
clears on its own (`total == 0`) still surfaces, with the "every account
is already set" headline section 5b already builds; it is dismissible
like any other plan. Only a genuine (`total > 0`) plan suppresses the
ordinary per-destination move cards — a `total == 0` plan leaves them
untouched, so a shortfall on some OTHER account (outside this plan's own
destinations) still gets its own move card.

FIX B — a genuine preview must date its simulated salary credit at the
REAL next payday inside the existing running-balance walk, not "today" —
draining this period's remaining bills first, exactly as the walk already
does for every other event. Unchanged by G172.

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
    harness: `find()` ignores its query entirely and returns every doc but
    `find_one` DOES filter on `_id` when the caller's query names one, since
    companion.py makes several independent `find_one({"_id": ...})` probes
    for DIFFERENT ids in the same request. `update_one` honours `$setOnInsert`
    alongside `$set`."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        return _Cursor(list(self.docs))

    async def find_one(self, query=None, projection=None):
        if query and "_id" in query:
            return next((d for d in self.docs if d.get("_id") == query["_id"]), None)
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
            for k, v in (update.get("$setOnInsert") or {}).items():
                new_doc.setdefault(k, v)
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
        "amounts_recent": [amount, amount, amount], "expected_date": "2026-08-29",
    }


def _base_patch(monkeypatch, *, accounts, bills, income, companion_items=None):
    companion_items_col = _Col(companion_items or [])
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", companion_items_col)
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    # `_pp_salary_observed` reads both collections unconditionally on every
    # in-window, non-preview call, so this harness must patch
    # `yapily_transactions_col` too, exactly like `transactions_col` above,
    # or an unpatched test would reach the real Mongo-backed collection.
    monkeypatch.setattr(companion, "yapily_transactions_col", _Col([]))
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
    return pay_period, companion_items_col


def _payday_plan(items):
    return next((i for i in items if i["type"] == "payday_plan"), None)


# ── total == 0 (every destination already clears on its own) ────────────────

def test_plan_with_total_zero_still_surfaces_and_does_not_suppress_moves(monkeypatch):
    """G172 decision: a payday plan with NO eligible destinations at all
    (`dests` ends up empty — nothing to move) still surfaces, with the
    "every account is already set" headline section 5b already builds,
    rather than emitting nothing. It is dismissible like any other plan,
    and because `total == 0` it must NOT suppress the ordinary
    per-destination move cards: a genuine, still-unfunded shortfall on a
    DIFFERENT account (excluded from the payday plan's own destination
    scan via `cover_plan_excluded_accounts`, so it can never itself be a
    plan destination) still needs its own move card. This replaces the old
    `_pp_born_clear` special case, which conflated "the forecast walk
    shows this destination clearing anyway" with "there is nothing to
    move" — two different conditions; the latter is the only one left
    that genuinely yields `total == 0`, since a destination the forecast
    walk shows clearing on its own can still carry a nonzero buffer-only
    move (a legitimate distribution recommendation now that there is no
    verdict attached to it)."""
    today_d = timeutil.user_today()
    OTHER_ACCT = "acc-other"
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        # SALARY_ACCT is always skipped as its own destination, and
        # OTHER_ACCT is excluded from the plan's destination scan below —
        # so `dests` ends up empty with no other account to consider at
        # all. OTHER_ACCT still has a real, unfunded shortfall (via the
        # ordinary shortfall pipeline, which `cover_plan_excluded_accounts`
        # never touches).
        accounts=[
            _account(SALARY_ACCT, 3000.0),
            _account(OTHER_ACCT, 0.0, "Other"),
        ],
        bills=[_bill("Rent", 2, 400.0, account_id=OTHER_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(
        companion, "preferences_col",
        _Col([{"user_id": UID, "cover_plan_excluded_accounts": [OTHER_ACCT]}]),
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    plan = _payday_plan(items)
    assert plan is not None, "a total == 0 plan still surfaces, not emits nothing"
    assert plan["total"] == 0
    assert "already set" in plan["headline"]

    plan_docs = [d for d in companion_items_col.docs if d.get("type") == "payday_plan"]
    assert len(plan_docs) == 1, "the plan is persisted like any other, even at total == 0"
    assert plan_docs[0]["status"] == "active"

    move_items = [i for i in items if i["type"] == "move"]
    assert move_items, "moves must not be suppressed: OTHER_ACCT's genuine shortfall still needs a card"
    assert any(i.get("_dest_acct") == OTHER_ACCT for i in move_items) or any(
        "Other" in i.get("headline", "") for i in move_items
    )


def test_plan_with_genuine_total_persists_and_suppresses_moves(monkeypatch):
    """A plan with at least one genuinely short destination (`total > 0`)
    persists active and DOES suppress the ordinary per-destination move
    cards for the accounts it's funding — no lifecycle beyond that; a
    second call in the same window recomputes the same figure fresh."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    plan = _payday_plan(items)
    assert plan is not None
    assert plan["total"] > 0
    plan_docs = [d for d in companion_items_col.docs if d.get("type") == "payday_plan"]
    assert len(plan_docs) == 1
    assert plan_docs[0]["status"] == "active"
    assert "_celebrated" not in plan_docs[0]
    assert "_dest_accts" not in plan_docs[0], "G172: no reader left for this field, so it's no longer persisted"
    assert "_total" not in plan_docs[0], "G172: no reader left for this field, so it's no longer persisted"

    move_items = [i for i in items if i["type"] == "move"]
    assert not move_items, "a genuine (total > 0) plan replaces the per-destination move cards"


# ── SALARY-OBSERVED — the live plan stops once the real credit lands ────────

def test_plan_hidden_once_salary_credit_observed(monkeypatch):
    """G172: once a credit matching the plan's own identified salary has
    actually landed in the salary account since this period's first day,
    the live plan stops surfacing (and stops suppressing moves) even
    though we are still inside the payday window — Kevin: the plan is a
    recommendation for money not yet in place, so once it's actually
    there, there is nothing left to recommend."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    # A credit matching the £2,000 identified salary has already landed in
    # SALARY_ACCT since the period started (today_d, the period's own
    # `_pstart` here).
    monkeypatch.setattr(companion, "transactions_col", _Col([
        {"user_id": UID, "transaction_type": "credit", "account_id": SALARY_ACCT,
         "amount": 2000.0, "date": datetime.combine(today_d, datetime.min.time())},
    ]))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    assert _payday_plan(items) is None, "salary observed: the live plan must not surface"
    plan_docs = [d for d in companion_items_col.docs if d.get("type") == "payday_plan"]
    assert plan_docs == [], "salary observed: nothing is persisted either"

    # Moves are NOT suppressed once the plan itself doesn't run — DEST_ACCT's
    # genuine shortfall must still get its own card, the mid-month safety net.
    move_items = [i for i in items if i["type"] == "move"]
    assert move_items, "with the plan hidden, DEST_ACCT's shortfall needs its own move card"


def test_plan_still_shows_when_salary_not_yet_observed(monkeypatch):
    """Mirror of the above: with no matching credit in the transactions
    collections, the live plan surfaces exactly as it always did inside the
    payday window."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    # transactions_col/yapily_transactions_col stay empty (default from
    # _base_patch) — no observed credit at all.

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    assert _payday_plan(items) is not None, "salary not yet observed: the live plan must still surface"


def test_payday_preview_unaffected_by_salary_observed(monkeypatch):
    """A `payday_preview` call always prices the NEXT payday, so an already-
    observed credit for the CURRENT period's salary must never suppress it —
    the preview isn't even looking at this period."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    monkeypatch.setattr(companion, "transactions_col", _Col([
        {"user_id": UID, "transaction_type": "credit", "account_id": SALARY_ACCT,
         "amount": 2000.0, "date": datetime.combine(today_d, datetime.min.time())},
    ]))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))

    plan = _payday_plan(items)
    assert plan is not None and plan.get("preview") is True


# ── FIX A (reframed) — an in-window call still prices THIS window ───────────

def test_in_window_call_prices_the_live_window_with_no_doc_needed(monkeypatch):
    """G172: there is no "done doc" gate left to satisfy — an in-window call
    with NO pre-existing companion_items_col doc at all still computes and
    persists the live plan for the CURRENT window."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 3000.0), _account(DEST_ACCT, 0.0, "Everyday")],
        bills=[_bill("Council Tax", 2, 100.0, account_id=DEST_ACCT, account_balance=0.0)],
        income=[_salary(0, 2000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    assert companion_items_col.docs == []

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))

    plan = _payday_plan(items)
    assert plan is not None
    assert plan.get("preview") is not True


def test_preview_inside_the_payday_window_prices_the_next_period(monkeypatch):
    """G172: with no doc concept left to gate on, a `payday_preview` call
    taken INSIDE the current payday window must still price the NEXT
    payday, not a recompute of the current one — and without double-
    crediting the salary that has already landed in `live_balances`."""
    today_d = timeutil.user_today()
    days_to_pay = 30
    pay_period, companion_items_col = _base_patch(
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

    calls: list[tuple[list, dict]] = []
    real_walk = companion._walk_events

    def spy(events, balances):
        calls.append((list(events), dict(balances)))
        return real_walk(events, balances)

    monkeypatch.setattr(companion, "_walk_events", spy)

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    plan = _payday_plan(items)
    assert plan is not None, "a preview must always price the NEXT payday"
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


# ── FIX B — dated preview salary credit ──────────────────────────────────────

def test_preview_salary_credit_lands_at_next_pay_not_today(monkeypatch):
    """Outside the payday window: the simulated salary must enter the walk
    dated at the REAL next payday, after this period's remaining bills have
    already drained the account — not immediately today."""
    today_d = timeutil.user_today()
    days_to_pay = 5
    bill_days_away = 3
    bill_amount = 200.0
    start_balance = 1000.0
    salary_amount = 1500.0

    pay_period, _ = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, start_balance)],
        bills=[_bill("Council Tax", bill_days_away, bill_amount)],
        income=[_salary(days_to_pay, salary_amount)],  # on payday itself
    )
    # OUTSIDE the window (days_into_period large) — the gated, genuine
    # preview case.
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
