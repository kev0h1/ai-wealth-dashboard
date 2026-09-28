"""G174 (urgent slice of G157, Kevin 2026-09-27 board note): the payday plan
must never let an unconfirmed candidate stand in as "the pay" while a
confirmed salary is expected on payday, even when that confirmed stream's
own payroll reference has just changed and its fresh series hasn't yet
cleared `_income_pattern_reliable`'s 3-occurrence floor on its own evidence.

Root cause: G158's dedupe guard in `_confirmed_income_fallback` correctly
suppresses a synthesised confirmed entry once a detected series under the
NEW reference is close enough (3 days, 15%) to be the same payer -- but,
before this fix, left that detected entry to sink or swim on
`_income_pattern_reliable` alone. A brand-new reference with only 1-2
occurrences failed that bar, so `income_credit_ok` rejected it, and
`app.services.companion._pp_salary_income` (`max(...,
key=amount)` over whatever DID pass) picked an unrelated small standing
order instead -- Kevin's real 2026-09-27 repro: a confirmed ~£4,798 salary
under a changed reference was invisible, and a £2 GONDWE standing order
became "the pay".

The fix stamps `confirmed_alias` onto the detected entry `_confirmed_income_
fallback`'s dedupe branch defers to (see that function and
`income_credit_ok` in analytics.py), and makes `_pp_salary_income` prefer
any candidate confirmed by key OR alias over a merely-reliable one,
whatever the amounts.

Companion-harness style, following the same full-collection-fake pattern as
`test_payday_split.py` (this file's sibling) rather than duplicating that
file's own fixtures wholesale, since this scenario needs bespoke income
items (`occurrences`/`confirmed_alias`) `_salary()` there doesn't build.
"""
import asyncio
from datetime import timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module

UID = "confirmed-salary-alias-user"
ACCT_ID = "acc-current"
CONFIRMED_KEY = "185008 12702436 Goldman Sachs BGC"
NEW_REF_KEY = "0201-GOLDMAN SACHS GOLDMAN SACHS PA"


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


def _account(balance):
    return {
        "_id": ACCT_ID, "name": "Premier Current Account", "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _income_item(name, amount, *, occurrences, confirmed_alias=None, days_away=5):
    item = {
        "name": name, "amount": amount, "days_away": days_away,
        "account_id": ACCT_ID, "occurrences": occurrences,
        "amounts_recent": [amount] * occurrences,
    }
    if confirmed_alias is not None:
        item["confirmed_alias"] = confirmed_alias
    return item


def _run(monkeypatch, *, balance, income, bills=None, days_to_pay=5):
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{
        "user_id": UID,
        "income_streams": [{
            "key": CONFIRMED_KEY, "status": "confirmed",
            "schedule": {"type": "last_weekday", "weekday": 4},
            "avg_amount": 4798.08,
        }],
    }]))
    monkeypatch.setattr(companion, "accounts_col", _Col([_account(balance)]))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    # See test_payday_split.py's own note: app.services.pace reads its OWN
    # module-level collection bindings, not companion's -- patch both or the
    # rhythm-checkpoint pass reaches the real database.
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=days_to_pay))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills or [], "upcoming_income": income, "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    return asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))


def _payday_plan(items):
    return next((i for i in items if i["type"] == "payday_plan"), None)


def test_confirmed_alias_wins_the_salary_slot_over_a_reliable_small_standing_order(monkeypatch):
    """Kevin's exact 2026-09-27 repro, in miniature: a £2 GONDWE standing
    order is reliable (3 stable occurrences) and would otherwise pass
    `income_credit_ok` on its own; a ~£4,798 salary under its NEW payroll
    reference has only 2 occurrences so far (below the reliability floor on
    its own evidence) but carries `confirmed_alias` pointing at the
    confirmed Goldman Sachs stream. The plan's salary must be the £4,798
    aliased entry, never the £2 standing order."""
    income = [
        _income_item("GONDWE CC COSCTO STO", 2.0, occurrences=3),
        _income_item(NEW_REF_KEY, 4798.08, occurrences=2, confirmed_alias=CONFIRMED_KEY),
    ]
    items = _run(monkeypatch, balance=1000.0, income=income)

    plan = _payday_plan(items)
    assert plan is not None
    assert plan["salary"]["amount"] == 4798
    assert plan["salary"]["account_id"] == ACCT_ID


def test_confirmed_alias_wins_even_against_a_larger_merely_reliable_candidate(monkeypatch):
    """The preference is for CONFIRMED, not for the larger amount -- proven
    here by making the unconfirmed candidate the bigger of the two. Without
    the G174 preference fix, a plain `max(..., key=amount)` over every
    income_credit_ok-passing candidate would wrongly pick this one."""
    income = [
        _income_item("FREELANCE CLIENT BACS", 9000.0, occurrences=3),
        _income_item(NEW_REF_KEY, 4798.08, occurrences=2, confirmed_alias=CONFIRMED_KEY),
    ]
    items = _run(monkeypatch, balance=1000.0, income=income)

    plan = _payday_plan(items)
    assert plan is not None
    assert plan["salary"]["amount"] == 4798


def test_payday_split_risk_absent_when_aliased_salary_covers_the_split(monkeypatch):
    """The same aliased salary must also be recognised by `payday_split_risk`
    (via `income_credit_ok`, the same gate) -- an account with no live
    balance but the aliased ~£4,798 salary landing on payday must not be
    flagged at risk against a much smaller payday-day bill."""
    bills = [{
        "name": "Payday Bill", "days_away": 5, "amount": 100.0,
        "account_id": ACCT_ID, "account_balance": None, "is_credit_card": False,
        "kind": "commitment", "expected_date": "2026-08-29",
    }]
    income = [
        _income_item("GONDWE CC COSCTO STO", 2.0, occurrences=3),
        _income_item(NEW_REF_KEY, 4798.08, occurrences=2, confirmed_alias=CONFIRMED_KEY),
    ]
    items = _run(monkeypatch, balance=0.0, income=income, bills=bills)

    plan = _payday_plan(items)
    assert plan is not None
    assert plan.get("payday_split_risk") is None
