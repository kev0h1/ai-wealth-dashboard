"""G65 (reviewer major on G47, 2026-09-13): a manual account's class
(current vs. savings) must be decided in exactly ONE place —
`app.services.account_kinds.manual_account_class` — and both
`services/companion.py` (the cover-plan engine) and `routers/accounts.py`'s
`_manual_to_account` (the `/accounts` API) must call that ONE function
rather than each restating the mapping locally.

Before this fix the two restated it and disagreed for an out-of-enum
`account_type` in OPPOSITE directions: companion.py defaulted to SAVINGS,
`_manual_to_account` defaulted to CURRENT/TRANSACTION. A comment in
companion.py falsely claimed the two mappings were "the same". Nothing can
write an out-of-enum `account_type` today (`routers/manual_accounts.py`
validates writes against `ACCOUNT_TYPES = {"savings", "current",
"credit_card"}`, and `routers/savings.py`/`routers/transactions.py` both
hardcode `"savings"`), so this was unreachable in production — the fixtures
below write directly into a fake `manual_accounts_col`, bypassing that
validation, purely to exercise the otherwise-unreachable case and prove the
two sides can no longer disagree about it.

`FakeCol`/`_match`/`_FakeCursor`/`_account`/`_manual`/`_bill`/`_run` mirror
`test_offline_account_ranking.py`'s harness verbatim (by convention, per
that file's own docstring, these small fakes are NOT shared across test
files here — each file keeps its own copy).
"""
import asyncio
from datetime import date, timedelta

import app.services.companion as companion
import app.routers.accounts as accounts_router
import app.services.account_kinds as account_kinds
import app.db.collections as db_collections

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
        return n

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

def _bill(name, days_away, amount, account_id, balance, *, kind="commitment"):
    disp = TODAY + timedelta(days=days_away)
    return {
        "name": name, "days_away": days_away, "amount": amount,
        "account_id": account_id, "account_name": account_id,
        "account_bank": "Bank", "account_balance": balance,
        "is_credit_card": False, "kind": kind,
        "category": "Bills", "edited": False, "rule_label": None,
        "pending": False, "days_past_due": 0,
        "expected_date": disp.isoformat(), "original_date": None,
        "dest_account_id": None, "dest_account_spendable": None,
    }


def _account(acct_id, balance, *, provider="barclays", name=None,
             subtype="TRANSACTION", atype="BANK"):
    """A connected (TrueLayer/Finexer-shaped) account doc."""
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": subtype, "type": atype, "provider": provider,
    }


def _manual(acct_id, balance, *, account_type="savings", name=None):
    """A `manual_accounts_col` doc. `account_type` is passed straight
    through with NO validation, so tests here can (deliberately) write
    values outside `ACCOUNT_TYPES` to exercise the otherwise-unreachable
    out-of-enum path."""
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id,
        "balance": balance, "account_type": account_type,
    }


def _run(monkeypatch, bills, *, accounts=None, manual_accounts=None,
         income_streams=None, window_income=None, account_eligibility_out=None):
    """Full-stack harness for `companion.compute_today_items`, following
    `test_cover_plan_account_eligibility.py`'s `_run` pattern verbatim."""
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
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol(manual_accounts or []))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
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

    items = asyncio.run(companion.compute_today_items(
        UID, persist=False, account_eligibility_out=account_eligibility_out,
    ))
    return items


def _find(items, item_type):
    return next((i for i in items if i["type"] == item_type), None)


def _leg_source_ids(move):
    return {m["move_map"]["from"]["account_id"] for m in move["moves"]}


# ── Unit coverage of the single shared function ─────────────────────────────

def test_manual_account_class_for_every_enum_value():
    assert account_kinds.manual_account_class("current") == "CURRENT"
    assert account_kinds.manual_account_class("savings") == "SAVINGS"
    # "credit_card" is a valid ACCOUNT_TYPES member, but both real callers
    # branch on `account_type == "credit_card"` themselves BEFORE ever
    # calling this function (companion.py skips the doc outright;
    # `_manual_to_account` returns a differently-shaped Account). Covered
    # here anyway for completeness: it falls into the "not current" branch,
    # same as any other non-current value.
    assert account_kinds.manual_account_class("credit_card") == "SAVINGS"


def test_manual_account_class_missing_value():
    assert account_kinds.manual_account_class(None) == "SAVINGS"


def test_manual_account_class_unrecognised_value():
    """The deliberately-chosen out-of-enum behaviour (G65): SAVINGS, so an
    account of an unrecognised type is reached by the cover-plan engine
    only after every current account is exhausted, never drawn from
    first -- matching `services/companion.py`'s prior default rather than
    `_manual_to_account`'s prior default, which is why this fix changes no
    behaviour for any value that can occur today."""
    assert account_kinds.manual_account_class("some_future_type") == "SAVINGS"
    assert account_kinds.manual_account_class("") == "SAVINGS"


# ── Structural pin: both callers reference the SAME function object ────────

def test_companion_and_accounts_router_share_the_same_classifier_function():
    """If either module stopped importing `manual_account_class` and went
    back to restating the mapping inline, this fails immediately -- even if
    the restated formula happened to compute the same answer for every
    input tried here. The point of G65 is that the two are UNABLE to drift
    by construction, not merely that they currently happen to agree."""
    assert companion.manual_account_class is account_kinds.manual_account_class
    assert accounts_router.manual_account_class is account_kinds.manual_account_class


# ── Behavioural pin: the engine and the API classify the same doc the same way ──

def test_engine_and_manual_to_account_agree_on_an_unrecognised_account_type(monkeypatch):
    """Pins `services/companion.py`'s offline-account build and
    `routers/accounts.py`'s `_manual_to_account` together for a manual
    account doc with an account_type outside `ACCOUNT_TYPES` -- exactly the
    input the two used to resolve in opposite directions.

    The scenario is built so the engine's choice of leg reveals which CLASS
    it placed the account in, not just whether it used it at all: a
    connected CURRENT account has comfortable headroom (£500) to cover the
    £60 bill alone, and the unrecognised-type manual account has far MORE
    headroom (£5,000). Class ranking picks the highest-headroom candidate
    within a class first (see `test_offline_account_ranking.py`), so:

    - If the manual account is (correctly) classed SAVINGS, the current
      class is checked first, the connected current account alone already
      covers the bill, and the savings class -- and the manual account in
      it -- is never reached.
    - If the manual account were (wrongly) classed CURRENT, it would
      outrank the connected current account WITHIN the current class (its
      headroom is larger) and would be picked instead.

    So this fails if `services/companion.py` ever placed the account in the
    wrong class, and separately asserts `_manual_to_account` resolves the
    SAME document to SAVINGS too -- together, "changing one side only" (in
    either direction) breaks this test.
    """
    manual_doc = _manual(
        "mystery", 5000.0, account_type="some_future_type", name="Offline Mystery",
    )

    # `_manual_to_account` (the /accounts API) resolves it to SAVINGS.
    api_account = accounts_router._manual_to_account(dict(manual_doc), "GBP")
    assert api_account.subtype == "SAVINGS"

    # The engine resolves the SAME document to the SAVINGS class: the
    # connected current account alone is sufficient, so it is chosen and
    # the unrecognised-type manual account (SAVINGS class, never reached)
    # is left untouched.
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("conn_cur", 500.0, name="Connected Current", provider="hsbc"),
    ]
    bills = [_bill("Rent", 2, 60.0, "premier", 0.0, kind="commitment")]

    items = _run(monkeypatch, bills, accounts=accounts, manual_accounts=[manual_doc])

    move = _find(items, "move")
    assert move is not None
    leg_ids = _leg_source_ids(move)
    assert leg_ids == {"conn_cur"}
    assert "mystery" not in leg_ids
