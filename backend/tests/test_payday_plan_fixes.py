"""Coverage for the three payday-plan fixes agreed 2026-08-29:

FIX A — a call landing INSIDE the payday window AFTER the live payday_plan
doc has already auto-verified ("done") must never compute a fresh preview
(which previously priced the period AFTER next payday against a balance
that already has the real salary landed). Instead it must emit a quiet
"already split" summary sourced straight from the persisted doc, flagged
`executed: True`. Applies to both a preview request and the plain
(non-preview) in-window call.

FIX B — a genuine preview (taken OUTSIDE the payday window) must date its
simulated salary credit at the REAL next payday inside the existing
running-balance walk, not "today" — draining this period's remaining bills
first, exactly as the walk already does for every other event.

FIX C — `commitment_names` (already computed server-side) must reach a
floored dest's payload unchanged, confirming the frontend has something to
render.

Follows the full-collection-fake pattern established by
tests/test_payday_split.py (real `compute_today_items`, no mocked Mongo).
"""
import asyncio
from datetime import date, timedelta

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


# ── FIX A — executed-window gate ─────────────────────────────────────────────

def _make_done_doc(pstart: date, dests):
    total = sum(d["move"] for d in dests)
    return {
        "_id": f"payday_plan:{pstart.isoformat()}:realfp",
        "uid": UID,
        "type": "payday_plan",
        "status": "done",
        "headline": f"Payday plan: split £{total:,} across {len(dests)} accounts",
        "body": f"£{total:,} distributed, £0 stays in Salary Account.",
        "action": {"label": "See what's due ›", "route": "/planning"},
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


def _executed_scenario(monkeypatch, *, preview: bool):
    today_d = date.today()
    pay_period = _base_patch(
        monkeypatch,
        accounts=[_account(SALARY_ACCT, 50.0), _account(DEST_ACCT, 0.0, "Saving Challenge")],
        # A fictional-looking preview (if it ran) would price a huge NEXT
        # period against these — proof the executed gate actually suppressed
        # computation rather than the numbers coincidentally matching.
        bills=[_bill("Mortgage", 20, 2365.0, account_id=SALARY_ACCT)],
        income=[_salary(20, 3000.0)],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=20))

    done_dests = [
        {
            "account_id": DEST_ACCT, "name": "Saving Challenge", "provider": "Barclays",
            "balance": 0, "bills_total": 0, "bill_count": 0, "spend_typical": 0, "buffer": 0,
            "target": 500, "move": 500, "usual": None, "commitment_names": ["Summer holiday"],
        },
        {
            "account_id": "acc-personal", "name": "Personal", "provider": "Barclays",
            "balance": 0, "bills_total": 0, "bill_count": 0, "spend_typical": 100, "buffer": 0,
            "target": 100, "move": 100, "usual": 100,
        },
    ]
    done_doc = _make_done_doc(today_d, done_dests)
    monkeypatch.setattr(companion, "companion_items_col", _Col([done_doc]))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=preview, persist=False))
    return items, done_doc


def test_preview_suppressed_when_done_doc_exists_in_window(monkeypatch):
    items, done_doc = _executed_scenario(monkeypatch, preview=True)
    plan = _payday_plan(items)
    assert plan is not None, "expected an executed payday_plan item, got none"

    # Executed summary, not a freshly (fictionally) computed preview.
    assert plan.get("executed") is True
    assert not plan.get("preview")
    assert plan["total"] == 600
    assert plan["dests"] == done_doc["dests"]
    # The £2,365 mortgage/next-period fiction must never have been priced.
    assert plan["total"] != 2365
    assert "next_pay" not in plan  # only genuine (non-executed) previews carry this


def test_plain_in_window_call_also_returns_executed_summary_not_nothing(monkeypatch):
    """The non-preview call (what Home's own `items` list is built from)
    must ALSO surface the executed summary, so HomeBrief can render the
    quiet 'Already split' row instead of falling back to the entry row."""
    items, done_doc = _executed_scenario(monkeypatch, preview=False)
    plan = _payday_plan(items)
    assert plan is not None
    assert plan.get("executed") is True
    assert plan["total"] == 600
    assert plan["dests"] == done_doc["dests"]


def test_commitment_names_survive_the_executed_passthrough(monkeypatch):
    items, _ = _executed_scenario(monkeypatch, preview=True)
    plan = _payday_plan(items)
    floored = next(d for d in plan["dests"] if d["account_id"] == DEST_ACCT)
    assert floored["commitment_names"] == ["Summer holiday"]


# ── FIX B — dated preview salary credit ──────────────────────────────────────

def test_preview_salary_credit_lands_at_next_pay_not_today(monkeypatch):
    """Outside the payday window (the only place a genuine preview should
    run once FIX A's gate is in place): the simulated salary must enter the
    walk dated at the REAL next payday, after this period's remaining bills
    have already drained the account — not immediately today."""
    today_d = date.today()
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
