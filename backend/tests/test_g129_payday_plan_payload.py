"""Tests for G129: two backend payload defects in the payday_plan builder
(backend/app/services/companion.py), both found while diagnosing G128
against Kevin's real payload on 2026-09-18.

Defect 1 — the trimmed-month re-derive block (only runs when `trimmed` is
True, since it re-sizes every destination once the month's total moves
outstrip what the salary account can distribute) unconditionally recomputed
EVERY destination's `target` as `bills_total + spend_typical + buffer`,
overwriting a savings destination's own formula from the dest-building loop
above it (`target = move + bills_total` — savings pots mirror the user's
habitual top-up, never auto-buffer, so they carry no spend/buffer inputs at
all). Because neither `spend_typical` nor `buffer` is ever non-zero for a
savings destination, the re-derive silently collapsed a savings pot's
target to its `bills_total` alone — 0 whenever the pot has no bills, even
while `move` stayed positive. This is exactly Kevin's Barclays "Personal
GBP" pot: £0 owed, £100 usually moving, `target: 0` reported alongside it —
not a trustworthy "what this account needs" figure. Fixed by tagging each
destination with an explicit `destination_kind` ("savings" or "spend") in
the dest-building loop and having the re-derive block honour it instead of
applying one formula to both kinds. A `habitual_top_up` boolean is now
computed server-side alongside it (G128's note on this item, 2026-09-18): a
savings pot with nothing owed but a habitual amount still moving is an
accumulation top-up, not a shortfall, and the frontend must read that fact
from this explicit field rather than inferring it from `target === 0`,
which only ever held by accident of this defect.

Defect 2 — the headline `f"Payday plan: split £{salary_amount:,} across
{n_moves} accounts"` quoted the whole landed salary as the amount being
split across the destinations, when the amount actually distributed is
`total` — in Kevin's payload, £4,798 (salary) vs £3,075 (total, after
trimming). PaydayPlanCard.tsx strips the figure out of a salary-backed
headline before rendering (the hero figure carries the number instead), so
this wasn't visibly wrong on Home, but the wrong string was still persisted
verbatim into the companion item document, readable by any other consumer
(Penny tools, MCP) exactly as built.

Follows the full-collection-fake pattern established by
tests/test_payday_split.py and tests/test_payday_plan_fixes.py (real
`compute_today_items`, no mocked Mongo; `transactions_col` faked in-memory
for the "usual" habitual-transfer detection).
"""
import asyncio
from datetime import datetime, timedelta

import app.core.timeutil as timeutil
import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module

UID = "g129-payday-user"
SALARY_ACCT = "acc-salary"
SAVINGS_ACCT = "acc-savings-pot"
BILL_ACCT = "acc-bill-dest"


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
    harness: `find()` ignores its query entirely and returns every doc,
    `find_one` filters on `_id` when the caller's query names one."""

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


def _account(acct_id, balance, name="Account", subtype="TRANSACTION"):
    return {
        "_id": acct_id, "name": name, "balance": balance,
        "subtype": subtype, "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _bill(name, days_away, amount, account_id, account_balance=0.0):
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


def _base_patch(monkeypatch, *, accounts, bills, income, transactions=None):
    companion_items_col = _Col([])
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", companion_items_col)
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col(transactions or []))
    # `_pp_salary_observed` reads both collections unconditionally on every
    # in-window, non-preview call — see test_payday_plan_fixes.py's
    # identical note.
    monkeypatch.setattr(companion, "yapily_transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.categories as categories_module
    import app.services.income as income_mod
    import app.services.pay_period as pay_period

    # `_usual_payday_moves_raw` needs a working (empty) category-kinds
    # lookup — patch the module it actually reads from, not companion.py's
    # namespace, since `get_category_kinds` is imported locally inside the
    # function (same precedent as test_payday_plan_fixes.py).
    monkeypatch.setattr(categories_module, "user_categories_col", _Col([]))
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": income, "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    return pay_period, companion_items_col


def _payday_plan(items):
    return next((i for i in items if i["type"] == "payday_plan"), None)


def _dest(plan, acct_id):
    return next(d for d in plan["dests"] if d["account_id"] == acct_id)


def _run_trim_scenario(monkeypatch):
    """One trimmed-month payday plan with a savings destination (habitual
    £100 top-up, no bills owed) and a bill destination (£200 owed) whose
    combined moves (£350, before trimming) exceed what SALARY_ACCT can
    distribute (£100 balance, minus its own £50 buffer = £50) — forcing
    `trimmed = True` and exercising the re-derive block defect (1) lives in.
    The salary income (£999) is kept deliberately different from `total`
    (£300, after trimming) so defect (2)'s headline bug is unambiguous
    either way it's fixed or not."""
    today_d = timeutil.user_today()
    pay_period, companion_items_col = _base_patch(
        monkeypatch,
        accounts=[
            _account(SALARY_ACCT, 100.0, "Salary Account"),
            _account(SAVINGS_ACCT, 0.0, "Personal GBP", subtype="SAVINGS"),
            _account(BILL_ACCT, 0.0, "Everyday"),
        ],
        bills=[_bill("Council Tax", 2, 200.0, account_id=BILL_ACCT, account_balance=0.0)],
        income=[_salary(0, 999.0)],
        transactions=[
            # A historical £100 transfer FROM the salary account INTO the
            # savings pot, matched across all 4 lookback paydays (the fake
            # collection returns every doc every time) — gives the pot a
            # habitual `usual` of £100, same precedent as
            # test_payday_plan_fixes.py's own usual-move fixture.
            {"user_id": UID, "transaction_type": "debit", "account_id": SALARY_ACCT,
             "amount": 100.0, "date": datetime.combine(today_d, datetime.min.time()),
             "category": "Transfer"},
            {"user_id": UID, "transaction_type": "credit", "account_id": SAVINGS_ACCT,
             "amount": 100.0, "date": datetime.combine(today_d, datetime.min.time())},
        ],
    )
    monkeypatch.setattr(pay_period, "get_pay_period_for_date", lambda ref, cfg: (today_d, today_d + timedelta(days=29)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=30))
    monkeypatch.setattr(pay_period, "prev_pay_period", lambda ref, cfg: (ref - timedelta(days=30), ref))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=False, persist=True))
    plan = _payday_plan(items)
    assert plan is not None, "the scenario must produce a live payday plan"
    assert plan["trimmed"] is True, "scenario must actually exercise the trimmed re-derive block"
    return plan


# ── Defect 1: savings destination target survives the trimmed re-derive ────

def test_trimmed_savings_destination_reports_its_own_target(monkeypatch):
    plan = _run_trim_scenario(monkeypatch)
    savings = _dest(plan, SAVINGS_ACCT)
    assert savings["move"] == 100
    assert savings["bills_total"] == 0
    assert savings["target"] == savings["move"] + savings["bills_total"]
    assert savings["target"] != 0, (
        "a savings pot with nothing owed but a habitual amount moving must "
        "not report target 0 — that's the G129 defect, not a real reading"
    )


def test_trimmed_bill_destination_target_unaffected_by_the_fix(monkeypatch):
    plan = _run_trim_scenario(monkeypatch)
    bill_dest = _dest(plan, BILL_ACCT)
    # The non-savings formula is exactly what the re-derive block already
    # used before G129 — this destination's target must come out the same
    # whether the block branches on destination_kind or not.
    assert bill_dest["target"] == (
        bill_dest["bills_total"] + bill_dest["spend_typical"] + bill_dest["buffer"]
    )


def test_habitual_top_up_flag_explicit_not_inferred(monkeypatch):
    plan = _run_trim_scenario(monkeypatch)
    savings = _dest(plan, SAVINGS_ACCT)
    bill_dest = _dest(plan, BILL_ACCT)

    assert savings["destination_kind"] == "savings"
    assert bill_dest["destination_kind"] == "spend"

    assert savings["habitual_top_up"] is True, (
        "nothing owed (bills_total 0) but £100 habitually moving is exactly "
        "the top-up shape G128's note describes"
    )
    assert bill_dest["habitual_top_up"] is False, (
        "an ordinary bill destination is never a habitual top-up"
    )


# ── Defect 2: the headline must quote the distributed total, not salary ────

def test_headline_quotes_distributed_total_not_salary_amount(monkeypatch):
    plan = _run_trim_scenario(monkeypatch)
    assert plan["salary"]["amount"] == 999
    assert plan["total"] == 300

    assert f"£{plan['total']:,}" in plan["headline"], (
        "the headline must name the amount actually distributed across the "
        "destinations"
    )
    assert "£999" not in plan["headline"], (
        "defect 2: the headline must never quote the whole landed salary as "
        "the amount being split"
    )
