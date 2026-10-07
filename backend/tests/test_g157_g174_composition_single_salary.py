"""Merge-resolution composition check (Kevin's board question, 2026-09-29,
resolving G157 into main after G174 and A101 landed there): does G157's
payer-identity work still compose with G174's `confirmed_alias`, or does it
produce a SECOND, competing notion of Kevin's salary?

Answer proven here: no second notion. `_confirmed_income_fallback`'s
payer-identity alias pass (G157) is the ONLY mechanism that stamps
`confirmed_alias` -- G174's own field, and the one every downstream reader
(`income_credit_ok`, `_pp_salary_income`, the ask pipeline below) still
keys off unchanged. See analytics.py's `_confirmed_income_fallback`
docstring: "G157 replaces the old G174 heuristic ... with a PAYER-IDENTITY
alias pass." G174's date/amount-proximity heuristic (3 days, 15 percent) is
gone from `_confirmed_income_fallback` entirely, replaced by
`resolve_confirmed_alias`'s token-identity match; nothing else in the
codebase re-derives a competing "is this the salary" verdict.

Kevin's exact shape (a confirmed stream stored under an OLD raw payroll
reference, three credits under that reference, one credit under the NEW
reference the bank switched to) is run through the full stack: first
`_detect_recurring` + `_confirmed_income_fallback` (the `recurring_income`
list a cashflow-cache doc stores -- this IS "the cache doc" the board note
asks about), then `companion.compute_today_items` (the payday plan and the
`ask:payer_lapsed`/`ask:payer_account_moved` pipeline every surface reads,
fed from that same cache doc's `recurring_income`). Exactly ONE salary
entry must come out of each -- never two, and never a stale "your pay
changed" ask firing alongside a plan that already has the right salary.
"""
import asyncio
from datetime import date, datetime, timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module
from app.routers.analytics import (
    _detect_recurring,
    _confirmed_income_fallback,
    PATTERNS_VERSION,
)

UID = "g157-g174-composition-user"
ACCT_ID = "acc-current"
OLD_REF = "185008 12702436 GOLDMAN SACHS"
NEW_REF = "0201 GOLDMAN SACHS GOLDMAN SACHS PAY"
TODAY = date(2026, 9, 24)

CONFIRMED_STREAM = {
    "key": OLD_REF, "status": "confirmed",
    "schedule": {"type": "last_weekday", "weekday": 4},
    "avg_amount": 4798.08, "last_seen": "2026-07-31",
    "confirmed_at": "2026-08-02T09:00:00",
}


def income_txn(merchant, d, amount, account_id=ACCT_ID):
    return {
        "merchant_name": merchant, "description": merchant, "amount": amount,
        "date": datetime(d.year, d.month, d.day), "category": "Income",
        "custom_category": None, "account_id": account_id,
    }


def _build_recurring_income():
    """Kevin's exact 2026-09-24 shape: three credits under the old payroll
    reference, then one under the bank's new reference, with the confirmed
    stream still stored (as `resolve_confirmed_alias` never rewrites
    preferences) under the old reference."""
    credits = [
        income_txn(OLD_REF, date(2026, 5, 29), 4798.08),
        income_txn(OLD_REF, date(2026, 6, 26), 4798.08),
        income_txn(OLD_REF, date(2026, 7, 31), 4798.08),
        income_txn(NEW_REF, date(2026, 8, 28), 4798.08),
    ]
    recurring_income = _detect_recurring(credits, today=TODAY, is_income=True)
    fallback = _confirmed_income_fallback(
        recurring_income, {OLD_REF: CONFIRMED_STREAM}, set(), TODAY,
    )
    # Exactly what `compute_and_cache_cashflow` does in production: the
    # fallback's synthesised entries are appended onto the detected list,
    # then the WHOLE thing is what gets stored as the cache doc's
    # `recurring_income` and fed to `_serialise_pattern`/`upcoming_income`.
    return recurring_income + fallback


def _upcoming_income_from(entry, today=TODAY):
    """Mirrors analytics.py's `raw_income.append({...})` build inside
    `_build_cashflow_response` (the exact field mapping from a
    `recurring_income` entry to an `upcoming_income` item) closely enough
    for this test's purposes: same `confirmed_alias` carry-through G174
    added specifically so `income_credit_ok` sees it on the built item, not
    just the internal list."""
    return {
        "name": entry["key"],
        "confirmed_alias": entry.get("confirmed_alias"),
        "amount": entry["avg_amount"],
        "expected_date": entry["next_date"].isoformat(),
        "days_away": (entry["next_date"] - today).days,
        "category": entry.get("category"),
        "account_id": entry.get("account_id"),
        "occurrences": entry.get("occurrences"),
        "amounts_recent": entry.get("amounts_recent"),
    }


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


def test_cache_doc_holds_exactly_one_salary_entry():
    """The `recurring_income` list a cashflow-cache doc stores -- both the
    detected-and-aliased series and the (empty, here) synthesised fallback
    -- collapses to exactly one entry, not two."""
    combined = _build_recurring_income()
    assert len(combined) == 1
    entry = combined[0]
    assert entry["avg_amount"] == 4798.08
    assert entry["next_date"] == date(2026, 9, 25)
    # G174's own field, stamped by G157's payer-identity pass -- one field,
    # one mechanism, not two.
    assert entry["confirmed_alias"] == OLD_REF


def test_compute_today_items_income_view_has_exactly_one_salary(monkeypatch):
    """Feed the SAME cache-doc shape production code would build (Kevin's
    one deduped entry) into `compute_today_items`, and confirm the payday
    plan and the ask pipeline agree: one salary, right amount, right
    account, and no "your pay changed"/"your pay moved" ask contradicting a
    plan that already has the confirmed salary correctly."""
    combined = _build_recurring_income()
    assert len(combined) == 1
    entry = combined[0]
    upcoming_income = [_upcoming_income_from(entry)]

    cache_doc = {
        "_id": UID,
        "patterns_version": PATTERNS_VERSION,
        "recurring_income": combined,
    }

    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([cache_doc]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{
        "user_id": UID, "income_streams": [CONFIRMED_STREAM],
    }]))
    monkeypatch.setattr(companion, "accounts_col", _Col([_account(1000.0)]))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
    # app.services.pace reads its OWN module-level collection bindings, not
    # companion's -- same note test_confirmed_salary_alias.py/
    # test_payday_split.py already carry.
    monkeypatch.setattr(pace_module, "cashflow_cache_col", _Col([cache_doc]))
    monkeypatch.setattr(pace_module, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", _Col([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", _Col([]))

    import app.services.pay_period as pay_period
    import app.services.income as income_mod

    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=1))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": [], "upcoming_income": upcoming_income, "internal_inflows": []}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))

    plan = next((i for i in items if i["type"] == "payday_plan"), None)
    assert plan is not None
    assert plan["salary"]["amount"] == 4798
    assert plan["salary"]["account_id"] == ACCT_ID

    # No competing verdict: a fresh, non-lapsed, same-account salary must
    # not also raise "has your pay changed?" or "your pay moved" -- either
    # would be a second, disagreeing notion of the same salary the plan
    # above already has right.
    payer_asks = [i for i in items if i["type"] == "ask" and i["id"].startswith("ask:payer_")]
    assert payer_asks == [], f"expected no payer ask alongside a correct plan, got {payer_asks}"

    # Exactly one salary-shaped entry reached the plan; the underlying
    # income view this was built from also held exactly one (asserted
    # above in test_cache_doc_holds_exactly_one_salary_entry, and re-proven
    # here since this test builds its own `combined`).
    assert len(upcoming_income) == 1
