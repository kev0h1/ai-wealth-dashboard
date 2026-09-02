"""Coverage for the 2026-08-29 owner directive: the payday plan's dest
bills_total / salary-obligation maths must skip a MOVEMENT bill whose
learned destination is one of the user's own accounts (own-account
transfers are not "payments" the plan should be sizing itself against),
while an UNSTAMPED movement (no learned destination — no evidence, or a
genuine external destination like Vanguard/Foris) keeps counting,
fail-safe, exactly like the frontend's `isPooledNoOp` rule
(frontend/app/planning/PlanningPage.tsx, 2026-08-26) this extends to the
payday plan's own pooled sizing. See app/services/companion.py's
`_is_own_transfer_bill`.

Follows the full-collection-fake pattern established by
tests/test_payday_plan_fixes.py / tests/test_payday_split.py (real
`compute_today_items`, no mocked Mongo) — genuine OUTSIDE-window preview
(FIX A's contract: a call inside an executed window never recomputes) so
the plan actually runs its dest-building loop.
"""
import asyncio
from datetime import date, timedelta

import app.db.collections as db_collections
import app.services.companion as companion
import app.services.pace as pace_module

UID = "payday-owntransfer-user"
SALARY_ACCT = "acc-salary"
DEST_ACCT = "acc-numberone"       # THE NUMBER ONE-like dest account
OWN_HSBC_ACCT = "acc-hsbc"        # stamped own-account destination
CARD_ACCT = "acc-card"            # credit card the repayment pays off


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


def _account(acct_id, balance, name="Account"):
    return {
        "_id": acct_id, "name": name, "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _bill(name, days_away, amount, account_id, kind="commitment", dest_account_id=None):
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_balance": 1.0, "is_credit_card": False,
        "kind": kind, "expected_date": "2026-08-29",
        "dest_account_id": dest_account_id,
        "dest_account_spendable": True if dest_account_id else None,
    }


def _salary(days_away, amount, account_id=SALARY_ACCT):
    return {
        "name": "Salary", "days_away": days_away, "amount": amount,
        "account_id": account_id, "occurrences": 3,
        "amounts_recent": [amount, amount, amount],
    }


def _base_patch(monkeypatch, *, accounts, bills, income):
    monkeypatch.setattr(companion, "cashflow_cache_col", _Col([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", _Col([{"user_id": UID}]))
    monkeypatch.setattr(companion, "accounts_col", _Col(accounts))
    monkeypatch.setattr(companion, "yapily_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "manual_accounts_col", _Col([]))
    monkeypatch.setattr(companion, "companion_items_col", _Col([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", _Col([]))
    monkeypatch.setattr(companion, "transactions_col", _Col([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", _Col([]))
    monkeypatch.setattr(db_collections, "card_terms_col", _Col([]))
    monkeypatch.setattr(db_collections, "commitments_col", _Col([]))
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


def _run(monkeypatch, *, accounts, bills, income, days_to_pay=20):
    """OUTSIDE the payday window (FIX A's gated case) + `payday_preview=True`
    forces the plan section on, so a fresh plan actually computes — same
    recipe as test_payday_plan_fixes.py's FIX B test."""
    today_d = date.today()
    pay_period = _base_patch(monkeypatch, accounts=accounts, bills=bills, income=income)
    monkeypatch.setattr(pay_period, "get_pay_period_for_date",
                         lambda ref, cfg: (today_d - timedelta(days=20), today_d + timedelta(days=days_to_pay)))
    monkeypatch.setattr(pay_period, "_next_payday", lambda today, cfg: today_d + timedelta(days=days_to_pay))
    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    return _payday_plan(items)


def _dest(plan, acct_id):
    return next((d for d in plan["dests"] if d["account_id"] == acct_id), None)


# ── Own-transfer (stamped) excluded from dest bills_total ───────────────────

def test_stamped_own_transfer_excluded_from_dest_bills_total(monkeypatch):
    accounts = [
        _account(SALARY_ACCT, 5000.0, "Salary Account"),
        _account(DEST_ACCT, 0.0, "THE NUMBER ONE"),
        _account(OWN_HSBC_ACCT, 100.0, "MAINGI K M"),
    ]
    bills = [
        # Own-account transfer, stamped: THE NUMBER ONE -> MAINGI K M (HSBC).
        _bill("MAINGI KM", 25, 150.0, account_id=DEST_ACCT, kind="movement", dest_account_id=OWN_HSBC_ACCT),
        # A genuine card repayment on the same account: MOVEMENT-kind but
        # never stamped with dest_account_id (card links go via the separate
        # card_dest_account_id channel) — must keep counting.
        _bill("NATWEST", 28, 62.41, account_id=DEST_ACCT, kind="movement", dest_account_id=None),
    ]
    income = [_salary(days_to_pay := 20, 3000.0)]
    plan = _run(monkeypatch, accounts=accounts, bills=bills, income=income, days_to_pay=days_to_pay)
    assert plan is not None

    d = _dest(plan, DEST_ACCT)
    assert d is not None, "expected THE NUMBER ONE to appear as a payday-plan dest"
    # bills_total must reflect ONLY the card repayment (£62.41), the £150
    # own-transfer must be excluded entirely.
    assert d["bills_total"] == 62
    assert d["bill_count"] == 1
    assert d["own_transfers_skipped"] == 150


def test_unstamped_movement_keeps_counting_fail_safe(monkeypatch):
    """An unstamped movement (no learned destination at all — e.g. a
    genuinely external destination like Vanguard/Foris, or a same-user
    transfer the matcher simply never accumulated evidence for) must NOT be
    excluded: the rule is strictly opt-in on a present dest_account_id."""
    accounts = [
        _account(SALARY_ACCT, 5000.0, "Salary Account"),
        _account(DEST_ACCT, 0.0, "THE NUMBER ONE"),
    ]
    bills = [
        _bill("Vanguard", 25, 200.0, account_id=DEST_ACCT, kind="movement", dest_account_id=None),
    ]
    income = [_salary(20, 3000.0)]
    plan = _run(monkeypatch, accounts=accounts, bills=bills, income=income, days_to_pay=20)
    assert plan is not None

    d = _dest(plan, DEST_ACCT)
    assert d is not None
    assert d["bills_total"] == 200
    assert d["bill_count"] == 1
    assert d["own_transfers_skipped"] == 0


def test_external_and_card_repayment_bills_count_stamped_own_transfer_excluded(monkeypatch):
    """Combined scenario mirroring the real THE-NUMBER-ONE data: a card
    repayment (unstamped by design) and an external-looking movement
    (unstamped) both count; only the stamped own-account transfer drops."""
    accounts = [
        _account(SALARY_ACCT, 5000.0, "Salary Account"),
        _account(DEST_ACCT, 0.0, "THE NUMBER ONE"),
        _account(OWN_HSBC_ACCT, 100.0, "MAINGI K M"),
    ]
    bills = [
        _bill("MAINGI KM", 25, 150.0, account_id=DEST_ACCT, kind="movement", dest_account_id=OWN_HSBC_ACCT),
        _bill("NATWEST", 28, 62.41, account_id=DEST_ACCT, kind="movement", dest_account_id=None),
        _bill("Foris Crypto", 32, 40.0, account_id=DEST_ACCT, kind="movement", dest_account_id=None),
    ]
    income = [_salary(20, 3000.0)]
    plan = _run(monkeypatch, accounts=accounts, bills=bills, income=income, days_to_pay=20)
    d = _dest(plan, DEST_ACCT)
    assert d is not None
    assert d["bills_total"] == 102  # 62.41 + 40.0, rounded
    assert d["bill_count"] == 2
    assert d["own_transfers_skipped"] == 150


# ── Salary-account obligation maths ──────────────────────────────────────────

def test_salary_bills_excl_own_dests_skips_stamped_own_transfer(monkeypatch):
    """`_salary_bills_excl_own_dests` must ALSO apply the stamp-based skip —
    a salary-account own-transfer with a learned destination must never
    inflate `_salary_target`, independent of whether its amount happens to
    match a `usual_moves` entry (the pre-existing amount-based dedup).

    Compares two otherwise-identical runs (stamped vs unstamped destination)
    rather than asserting an absolute `stays` figure, since the preview's
    own projected-salary credit is already folded into the balance `_bal`
    reads — the DELTA between the two runs isolates exactly what the
    £1,844.33 own-transfer bill did to the salary target, independent of
    that base."""
    def _make_bills(dest_account_id):
        return [
            _bill("KEVIN MAINGI HSBC STO", 25, 1844.33, account_id=SALARY_ACCT,
                  kind="movement", dest_account_id=dest_account_id),
            # An ordinary (non-movement) bill stays reserved either way.
            _bill("Council Tax", 26, 150.0, account_id=SALARY_ACCT, kind="commitment"),
        ]

    accounts = [
        _account(SALARY_ACCT, 5000.0, "Salary Account"),
        _account(OWN_HSBC_ACCT, 100.0, "MAINGI K M"),
    ]
    income = [_salary(20, 5000.0)]

    plan_stamped = _run(monkeypatch, accounts=accounts, bills=_make_bills(OWN_HSBC_ACCT),
                         income=income, days_to_pay=20)
    plan_unstamped = _run(monkeypatch, accounts=accounts, bills=_make_bills(None),
                           income=income, days_to_pay=20)
    assert plan_stamped is not None and plan_unstamped is not None

    # No account other than the salary account qualifies as a dest here (no
    # bills/usual moves target OWN_HSBC_ACCT), so nothing is distributed in
    # either run — the entire effect shows up in `stays`.
    assert plan_stamped["total"] == 0
    assert plan_unstamped["total"] == 0
    stays_stamped = plan_stamped["salary"]["stays"]
    stays_unstamped = plan_unstamped["salary"]["stays"]
    # Stamped run must have MORE left over: the unstamped run still reserves
    # the £1,844.33 as a salary-account bill (existing amount-match dedup
    # doesn't apply here — no usual_moves data in this fixture), the stamped
    # run correctly excludes it via `_is_own_transfer_bill`.
    # 1845 not 1844.33: `stays` truncates via int(), and only the unstamped
    # run's target carries the .33 fraction (the stamped run's target is a
    # round £200), so truncation itself claims the extra penny of delta.
    assert stays_stamped - stays_unstamped == 1845
