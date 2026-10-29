"""G359 (Kevin, 29 Oct 2026): a brand-new account rebuilt from ~90 days of
bank history has a monthly last-Friday salary seen only twice and no confirmed
stream, so `_income_pattern_reliable` (3+ sightings) never credits it. The
Home cover plan then funded six own-account standing orders that leave the
salary account ON payday with money moved from Starling and Monzo, and
footnoted the salary as having "landed in Barclays X, not X".

Step 1: a STEADY salary (2 sightings, amounts within 10%, the user's pay
rhythm, largest regular credit on its account, due this window) is credited,
basis "steady", and the Home brief asks once to confirm it.
Step 2: with the salary NOT credited at all, a gap that is >= 80% own-account
payday standing orders never becomes a cover move into the salary account.
Step 3: the footnote never says "landed in A, not A", and two same-bank
holder-named accounts are told apart.

Local FakeCol copy, following the file-local convention of
test_unfunded_move.py.
"""
import asyncio
from datetime import date, timedelta

import pytest

import app.db.collections as db_collections
import app.services.companion as companion
from app.core import timeutil
from app.routers.analytics import _steady_salary_candidate, income_credit_basis, stamp_credit_basis
from app.services.categories import MOVEMENT

UID = "g359-user"
TODAY = date(2026, 10, 29)
PAY_CFG = {"type": "last_friday"}
BC, BP, ST, MZ = "acc-barclays-current", "acc-barclays-pot", "acc-starling", "acc-monzo"
SALARY_KEY = "Goldman Sachs Pay"


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
    """Stand-in for a Motor collection — enough of `.find()`/`.find_one()`/
    `.update_one()`/`.update_many()` to drive the real code under test."""

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



def _account(acct_id, balance, *, provider, name, subtype="TRANSACTION", atype="BANK"):
    return {
        "_id": acct_id, "user_id": UID, "name": name, "balance": balance,
        "subtype": subtype, "type": atype, "provider": provider,
    }


def _accounts(*, starling=45.0, monzo=30.0):
    return [
        _account(BC, 350.0, provider="barclays", name="MR KEVIN MBITHI MAINGI"),
        _account(BP, 10.0, provider="barclays", name="MR KEVIN MBITHI MAINGI", subtype="SAVINGS", atype="SAVINGS"),
        _account(ST, starling, provider="starling", name="Starling Personal"),
        _account(MZ, monzo, provider="monzo", name="Monzo Personal Account"),
    ]


def _bill(name, amount, days_away, *, kind="commitment", dest=None, acct=BC):
    return {
        "name": name, "amount": amount, "days_away": days_away,
        "account_id": acct, "account_name": "Mr Kevin Mbithi Maingi", "account_bank": "Barclays",
        "account_balance": 350.0, "is_credit_card": False, "kind": kind,
        "category": "Transfer" if kind == MOVEMENT else "Bills", "edited": False,
        "rule_label": None, "pending": False, "days_past_due": 0,
        "expected_date": (TODAY + timedelta(days=days_away)).isoformat(),
        "original_date": None, "dest_account_id": dest,
        "dest_account_spendable": True if dest else None,
    }


def _bills(*, extra=()):
    own = [("HSBC", 1886.0), ("NatWest", 925.0), ("Rainy Day Saver", 100.0),
           ("Chase", 50.0), ("Foris", 25.0), ("Revolut", 20.0)]
    out = [_bill(n, a, 1, kind=MOVEMENT, dest=f"own-{n}") for n, a in own]
    out += [
        _bill("Vanguard", 400.0, 4, kind=MOVEMENT),
        _bill("Avios fee", 12.0, 4),
        _bill("Digital Ocean", 4.0, 4),
    ]
    return out + list(extra)


def _salary(*, occurrences=2, amounts=None, acct=BC, interval=28.0):
    amts = amounts or [4797.88] * occurrences
    return {
        "name": SALARY_KEY, "display_name": SALARY_KEY, "amount": 4797.88, "days_away": 1,
        "expected_date": (TODAY + timedelta(days=1)).isoformat(), "account_id": acct,
        "account_name": "Mr Kevin Mbithi Maingi", "account_bank": "Barclays",
        "category": "Income", "occurrences": occurrences, "amounts_recent": amts,
        "avg_interval": interval,
    }


def _run(monkeypatch, bills, income, *, accounts=None, income_streams=None, eligibility=None):
    import app.services.income as income_mod
    import app.services.pace as pace_module
    import app.services.categories as categories_module
    import app.services.checkpoints as checkpoints_module
    import app.services.debt_plan as debt_plan_module

    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(companion, "accounts_col", FakeCol(accounts or _accounts()))
    monkeypatch.setattr(companion, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(companion, "companion_items_col", FakeCol([]))
    monkeypatch.setattr(companion, "behaviour_portrait_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "savings_insights_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "card_terms_col", FakeCol([]))
    monkeypatch.setattr(companion, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(companion, "preferences_col", FakeCol([
        {"user_id": UID, "pay_period_config": PAY_CFG, "income_streams": income_streams or []}
    ]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol([]))

    async def no_active_allocations(uid):
        return []

    monkeypatch.setattr(companion, "list_active_allocations", no_active_allocations)
    monkeypatch.setattr(pace_module, "cashflow_cache_col", FakeCol([{"_id": UID}]))
    monkeypatch.setattr(pace_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(pace_module, "transactions_col", FakeCol([]))
    monkeypatch.setattr(pace_module, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(categories_module, "user_categories_col", FakeCol([]))
    monkeypatch.setattr(checkpoints_module, "preferences_col", FakeCol([{"user_id": UID}]))
    monkeypatch.setattr(checkpoints_module, "checkpoints_col", FakeCol([]))
    monkeypatch.setattr(checkpoints_module, "category_intent_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "transactions_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(db_collections, "commitments_col", FakeCol([]))

    async def no_debt_plan(uid, **kw):
        return {"totals": {"verdict": "good"}, "cards": []}

    monkeypatch.setattr(debt_plan_module, "get_debt_plan_cached", no_debt_plan)

    async def fake_resp(cached, uid=None, prefs=None):
        return {
            "upcoming_bills": bills, "upcoming_income": income,
            "internal_inflows": [], "late_income": [],
        }

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)
    out = {} if eligibility is None else eligibility
    items = asyncio.run(companion.compute_today_items(UID, persist=False, account_eligibility_out=out))
    return items


def _moves(items):
    return [i for i in items if i["type"] == "move"]


def _ask(items, ask_id):
    return next((i for i in items if i["id"] == ask_id), None)


# ── Step 1 ──────────────────────────────────────────────────────────────────

def test_steady_salary_is_credited_and_no_cover_move_for_the_salary_account(monkeypatch):
    sal = _salary()
    elig: dict = {}
    items = _run(monkeypatch, _bills(), [sal], eligibility=elig)

    assert _moves(items) == []
    assert sal["credit_basis"] == "steady"
    assert sal["estimated"] is True
    # Starling and Monzo are not reserved for any move.
    for sid in (ST, MZ):
        assert elig[sid]["spend_from_headroom"] >= 0
        assert elig[sid]["spend_from_headroom"] == pytest.approx(elig[sid].get("headroom", 0.0), abs=50)
    assert not any("landed in" in str(i.get("income_note") or "") for i in items)


def test_steady_salary_asks_once_to_confirm_with_hedged_copy(monkeypatch):
    items = _run(monkeypatch, _bills(), [_salary()])
    ask = _ask(items, "ask:confirm_salary")
    assert ask is not None
    assert ask["income_note_kind"] == "confirm_salary"
    assert ask["income_note"] == (
        "Sorted is counting your £4,798 pay expected around 30 Oct. "
        "Confirm it so this stays reliable."
    )
    assert ask["body"] == ask["income_note"]
    assert ask["action"]["route"] == "/settings"
    assert "—" not in ask["body"] and "!" not in ask["body"] and "will" not in ask["body"]


def test_credited_incomes_lists_the_steady_salary_on_a_move_card(monkeypatch):
    # A genuine commitment keeps the account short even with the salary in.
    big = _bill("Rent", 6000.0, 1)
    items = _run(
        monkeypatch, _bills(extra=[big]), [_salary()],
        accounts=_accounts(starling=9000.0),
    )
    cards = _moves(items)
    assert cards, "a real commitment beyond the pay should still produce a move"
    assumed = cards[0]["assumed_incomes"]
    assert assumed and assumed[0]["name"] == SALARY_KEY
    assert assumed[0]["basis"] == "steady" and assumed[0]["estimated"] is True
    to = cards[0]["moves"][0]["move_map"]["to"]
    assert to["display_label"] == "your Barclays current account"
    assert cards[0]["plan_dest"]["display_label"] == "your Barclays current account"


def test_three_occurrences_is_reliable_not_steady(monkeypatch):
    sal = _salary(occurrences=3)
    items = _run(monkeypatch, _bills(), [sal])
    assert sal["credit_basis"] == "reliable"
    assert _moves(items) == []
    assert _ask(items, "ask:confirm_salary") is None


def test_confirmed_stream_is_confirmed_basis_and_never_asks(monkeypatch):
    sal = _salary()
    items = _run(
        monkeypatch, _bills(), [sal],
        income_streams=[{"key": SALARY_KEY, "status": "confirmed"}],
    )
    assert sal["credit_basis"] == "confirmed"
    assert _ask(items, "ask:confirm_salary") is None


def test_two_occurrences_forty_percent_apart_is_not_steady():
    sal = _salary(amounts=[4797.88, 2900.0])
    assert _steady_salary_candidate(sal, PAY_CFG, [sal], TODAY) is False
    stamp_credit_basis([sal], PAY_CFG, frozenset(), TODAY)
    assert sal["credit_basis"] is None


def test_steady_rule_edges():
    sal = _salary()
    assert _steady_salary_candidate(sal, PAY_CFG, [sal], TODAY) is True
    assert _steady_salary_candidate(_salary(occurrences=1), PAY_CFG, [], TODAY) is False
    assert _steady_salary_candidate(_salary(interval=60.0), PAY_CFG, [], TODAY) is False
    assert _steady_salary_candidate(sal, None, [sal], TODAY) is False
    later = _salary()
    later["expected_date"] = (TODAY + timedelta(days=20)).isoformat()
    assert _steady_salary_candidate(later, PAY_CFG, [later], TODAY) is False
    bigger = dict(_salary(), name="Other big credit", amount=9000.0, occurrences=2)
    assert _steady_salary_candidate(sal, PAY_CFG, [sal, bigger], TODAY) is False


# ── Step 2 ──────────────────────────────────────────────────────────────────

def test_payday_standing_orders_never_drive_a_cover_move_when_pay_is_expected(monkeypatch):
    sal = _salary(occurrences=1, amounts=[4797.88], interval=None)
    items = _run(monkeypatch, _bills(), [sal])
    assert sal["credit_basis"] is None
    assert _moves(items) == []
    note = _ask(items, "ask:payday_funds_moves")
    assert note is not None
    assert note["income_note_kind"] == "payday_funds_moves"
    assert note["income_note"] == (
        "These moves usually come out of your pay expected around 30 Oct, so no move "
        "is suggested. Confirm your pay in Settings so Sorted can count on it."
    )


def test_payday_funds_moves_guard_unit():
    movement = _bill("HSBC", 3000.0, 1, kind=MOVEMENT, dest="own")
    other = _bill("Rent", 900.0, 1)
    sal = {"account_id": BC, "days_away": 1, "amount": 5000.0}
    assert companion._payday_funds_moves(BC, 3000.0, [movement], [sal]) is sal
    # Less than 80% own-account movements: the guard stays out of the way.
    assert companion._payday_funds_moves(BC, 3900.0, [movement, other], [sal]) is None
    # Salary into a different account does not explain this account's gap.
    assert companion._payday_funds_moves(BC, 3000.0, [movement], [dict(sal, account_id=BP)]) is None
    # Salary too small to clear the gap.
    assert companion._payday_funds_moves(BC, 3000.0, [movement], [dict(sal, amount=100.0)]) is None


# ── Step 3 ──────────────────────────────────────────────────────────────────

def test_steady_candidate_on_the_other_account_is_not_credited_to_the_current_account(monkeypatch):
    sal = _salary(acct=BP)
    assert income_credit_basis(sal, BC, frozenset()) is None
    items = _run(
        monkeypatch, _bills(), [sal],
        accounts=_accounts(starling=9000.0),
    )
    cards = _moves(items)
    assert cards, "an honest move is still recommended"
    note = cards[0].get("income_note") or ""
    assert "your Barclays savings" in note and "your Barclays current account" in note
    assert "not Mr Kevin" not in note


def test_footnote_never_says_landed_in_a_not_a_for_the_same_account(monkeypatch):
    # Unsteady salary on the shortfall account itself (40% apart) plus a real
    # commitment so a move is still recommended.
    sal = _salary(amounts=[4797.88, 2900.0])
    big = _bill("Rent", 6000.0, 1)
    items = _run(monkeypatch, _bills(extra=[big]), [sal], accounts=_accounts(starling=9000.0))
    cards = _moves(items)
    assert cards
    note = cards[0].get("income_note") or ""
    assert "landed in" not in note
    assert "hasn't been steady enough" in note


def _acct(acct_id, name, provider, subtype):
    return {"_str_id": acct_id, "name": name, "provider": provider, "subtype": subtype, "type": "BANK"}


def test_distinct_labels_for_two_holder_named_accounts_of_one_bank():
    from app.services.account_names import distinct_account_label

    cur = _acct("a", "MR KEVIN MBITHI MAINGI", "barclays", "TRANSACTION")
    sav = _acct("b", "MR KEVIN MBITHI MAINGI", "barclays", "SAVINGS")
    both = [cur, sav]
    assert distinct_account_label(cur, both) == "your Barclays current account"
    assert distinct_account_label(sav, both) == "your Barclays savings"


def test_a_single_holder_named_account_is_just_your_bank_account():
    from app.services.account_names import distinct_account_label

    cur = _acct("a", "MR KEVIN MBITHI MAINGI", "barclays", "TRANSACTION")
    other = _acct("c", "Starling Personal", "starling", "TRANSACTION")
    assert distinct_account_label(cur, [cur, other]) == "your Barclays account"
