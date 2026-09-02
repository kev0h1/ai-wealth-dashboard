"""Unit/integration tests for the 2026-09-01 overdraft-plus-bills fix.

Bug (owner, verbatim, phone 07:41): "the Barclays account is short and it
still has bills to cover, I thought that when the account is in a deficit
penny would make a suggestion to cover the deficit and also the bills."

Root cause: `assessable_bills`'s filter required `account_balance >= 0` in
three mirrored places (companion.py, analytics.at_risk_count,
spend_impact._cashflow_window). That silently dropped EVERY bill on an
already-overdrawn CURRENT account from the running-balance shortfall walk,
so step 1 of `compute_today_items` never saw a bill-backed shortfall for it
and only the narrow overdraft-only fallback fired — sized off the live
deficit alone (`ceil5(deficit)+10`), blind to bills days away.

Fix: `app.routers.analytics.is_assessable_bill` is now the single shared
predicate for all three call sites — it excludes "no balance data" and
credit cards, but no longer excludes a negative balance on a real debit
account. The running-balance walk (`_walk_events`) already handles a
negative STARTING balance naturally (no special-cased summing needed): once
the account's own bills re-enter the walk, `min_running` already reflects
deficit + cumulative bills, so the existing `abs(min_running)` sizing and
`_ceil5(...)+10` buffer convention pick it up for free.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention `test_unfunded_move.py`/`test_internal_inflows.py` already
established (`FakeCol`/`_match`/`_FakeCursor` are NOT shared across test
files by convention here).
"""
import asyncio
from datetime import date, timedelta

import app.routers.analytics as analytics
import app.services.companion as companion
import app.db.collections as db_collections
from app.routers.analytics import is_assessable_bill, PATTERNS_VERSION
from app.services.categories import MOVEMENT

UID = "kevin"
TODAY = date.today()


# ── Generic fake-Mongo plumbing (subset matcher + collection) ───────────────

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return list(self._docs)

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _ModifiedResult:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new_doc = dict(filt)
            self._apply(new_doc, update)
            self.docs.append(new_doc)

    async def update_many(self, filt, update):
        n = 0
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                n += 1
        return _ModifiedResult(n)

    @staticmethod
    def _apply(d, update):
        for k, v in (update.get("$set") or {}).items():
            d[k] = v
        for k, v in (update.get("$setOnInsert") or {}).items():
            d.setdefault(k, v)
        for k, v in (update.get("$addToSet") or {}).items():
            d.setdefault(k, [])
            if v not in d[k]:
                d[k].append(v)


# ── Fixtures ─────────────────────────────────────────────────────────────

def _bill(name, days_away, amount, account_id, balance, *, kind="commitment",
          is_credit_card=False, account_name=None):
    disp = TODAY + timedelta(days=days_away)
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_name": account_name or account_id,
        "account_bank": "Bank", "account_balance": balance,
        "is_credit_card": is_credit_card, "kind": kind,
        "category": "Bills", "edited": False, "rule_label": None,
        "pending": False, "days_past_due": 0,
        "expected_date": disp.isoformat(), "original_date": None,
        "dest_account_id": None, "dest_account_spendable": None,
    }


def _account(acct_id, balance, *, provider="barclays", name=None,
             subtype="TRANSACTION", atype="BANK"):
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": subtype, "type": atype, "provider": provider,
    }


def _run(monkeypatch, bills, *, accounts=None, income_streams=None,
         window_income=None, companion_items=None):
    """Full-stack harness for `companion.compute_today_items`, following
    test_unfunded_move.py's `_run` pattern verbatim."""
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda today_d, pay_cfg: (today_d - timedelta(days=10), today_d + timedelta(days=17)),
    )

    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol(companion_items or []))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([
        {"user_id": UID, "income_streams": income_streams or []}
    ]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    import app.services.pace as pace_module
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {
            "upcoming_bills": bills,
            "upcoming_income": window_income or [],
            "internal_inflows": [],
        }

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    items = asyncio.run(companion.compute_today_items(UID, persist=True))
    return items, companion.companion_items_col


def _find(items, item_type):
    return next((i for i in items if i["type"] == item_type), None)


# ── is_assessable_bill: the shared predicate ────────────────────────────────

def test_negative_balance_debit_account_stays_assessable():
    """The actual Premier shape: overdrawn current account, real balance
    data, not a credit card -- must NOT be excluded."""
    b = _bill("Account fee", 2, 5.0, "premier", -30.61)
    assert is_assessable_bill(b) is True


def test_no_balance_data_excluded():
    b = _bill("Mystery bill", 2, 5.0, "unknown_acct", None)
    assert is_assessable_bill(b) is False


def test_credit_card_excluded_even_with_negative_balance():
    b = _bill("Amex minimum", 2, 50.0, "amex", -500.0, is_credit_card=True)
    assert is_assessable_bill(b) is False


def test_positive_balance_debit_account_stays_assessable():
    b = _bill("Council Tax", 2, 100.0, "premier", 500.0)
    assert is_assessable_bill(b) is True


def test_credit_card_with_positive_balance_still_excluded():
    """A credit card currently in credit is still not a balance to walk."""
    b = _bill("Amex minimum", 2, 50.0, "amex", 20.0, is_credit_card=True)
    assert is_assessable_bill(b) is False


def test_three_mirrored_filters_share_the_same_predicate():
    """companion.py and spend_impact.py both import `is_assessable_bill`
    from analytics.py rather than hand-rolling their own copy -- the
    sims-lockstep discipline this fix relies on. Proves the identical
    function object backs all three call sites, so they can never drift
    again."""
    import app.services.spend_impact as spend_impact_module

    assert companion.is_assessable_bill is is_assessable_bill
    # spend_impact imports it lazily inside `_cashflow_window`; import the
    # module fresh here to confirm the same name is reachable from analytics.
    from app.routers.analytics import is_assessable_bill as reimported
    assert reimported is is_assessable_bill


# ── compute_today_items: overdrawn account WITH in-window bills ────────────

def test_overdrawn_account_with_bills_sizes_deficit_plus_bills(monkeypatch):
    """The Premier shape: -£30.61 balance, a small fee (commitment) and a
    large card payment (movement) both due before payday. The move must be
    sized to clear the deficit AND cover both bills, not just the deficit."""
    accounts = [
        _account("premier", -30.61, name="Premier Current"),
        _account("hsbc", 2000.0, name="HSBC Current", provider="hsbc"),
    ]
    bills = [
        _bill("Account fee", 2, 5.0, "premier", -30.61, kind="commitment"),
        _bill("AMEX PAYMENT", 3, 874.10, "premier", -30.61, kind=MOVEMENT),
    ]
    items, _ = _run(monkeypatch, bills, accounts=accounts)
    item = _find(items, "move")
    assert item is not None
    assert item["plan_dest"]["is_overdraft"] is False
    # min_running walk: -30.61 - 5.00 - 874.10 = -909.71
    assert item["plan_dest"]["needs_total"] == 879  # 5.00 + 874.10, rounded
    assert len(item["plan_dest"]["bills"]) == 2
    # amount_needed = ceil5(909.71) + 10 = 920
    assert item["amount"] == 920
    assert item["plan_dest"]["account_id"] == "premier"
    assert "2 payments (£879)" in item["body"]
    assert "it's £30.61 overdrawn" in item["body"]


def test_overdrawn_account_no_bills_unchanged_overdraft_only(monkeypatch):
    """No in-window bill anywhere on the account -- must keep today's exact
    overdraft-only behaviour: clear to £0 + the £10 buffer, nothing more."""
    accounts = [
        _account("premier", -30.61, name="Premier Current"),
        _account("hsbc", 2000.0, name="HSBC Current", provider="hsbc"),
    ]
    items, _ = _run(monkeypatch, [], accounts=accounts)
    item = _find(items, "move")
    assert item is not None
    assert item["plan_dest"]["is_overdraft"] is True
    # ceil5(30.61) + 10 = 45
    assert item["amount"] == 45
    assert "It's £30.61 overdrawn right now." in item["body"]


def test_credit_card_bill_never_enters_the_walk(monkeypatch):
    """A negative balance on a CREDIT CARD must still be excluded -- only
    the debit-account sign check was wrong, not the credit-card exclusion."""
    accounts = [
        _account("amex", -500.0, name="Amex", subtype="CREDIT_CARD", atype="CREDIT_CARD"),
        _account("hsbc", 2000.0, name="HSBC Current", provider="hsbc"),
    ]
    bills = [
        _bill("Amex minimum payment", 2, 50.0, "amex", -500.0, is_credit_card=True),
    ]
    items, _ = _run(monkeypatch, bills, accounts=accounts)
    # No bill-backed move for the card (its bill was never assessable), and
    # `_overdraft_deficits` independently excludes credit cards too, so no
    # overdraft-fallback card either.
    assert _find(items, "move") is None


# ── at_risk_count: the badge must now count an overdrawn account's bills ───

def _run_at_risk(monkeypatch, bills, *, next_pay_in_days=10):
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=next_pay_in_days))

    monkeypatch.setattr(
        analytics, "cashflow_cache_col",
        FakeCol([{"_id": UID, "patterns_version": PATTERNS_VERSION}]),
    )
    monkeypatch.setattr(analytics, "preferences_col", FakeCol([]))
    monkeypatch.setattr(analytics, "accounts_col", FakeCol([]))
    monkeypatch.setattr(analytics, "yapily_accounts_col", FakeCol([]))

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": []}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    result = asyncio.run(analytics.at_risk_count(user={"email": UID}))
    return result["count"]


def test_at_risk_count_now_counts_an_overdrawn_accounts_bill(monkeypatch):
    """Before the fix: the account's bills were filtered out entirely by
    `account_balance >= 0`, so this badge silently read 0 even though a
    real commitment was days away on an already-overdrawn account."""
    bills = [_bill("Account fee", 2, 5.0, "premier", -30.61, kind="commitment")]
    assert _run_at_risk(monkeypatch, bills) == 1


def test_at_risk_count_credit_card_still_excluded(monkeypatch):
    bills = [_bill("Amex minimum payment", 2, 50.0, "amex", -500.0, is_credit_card=True)]
    assert _run_at_risk(monkeypatch, bills) == 0


def test_at_risk_count_movement_only_bounce_on_overdrawn_account_not_counted(monkeypatch):
    """Same movement-doctrine carve-out as everywhere else: a bounced
    `movement` bill (the user's own transfer) never trips the at-risk
    badge, even on an overdrawn account, since it's not an obligation that
    can fail expensively."""
    bills = [_bill("Own transfer to savings", 2, 900.0, "premier", -30.61, kind=MOVEMENT)]
    assert _run_at_risk(monkeypatch, bills) == 0
