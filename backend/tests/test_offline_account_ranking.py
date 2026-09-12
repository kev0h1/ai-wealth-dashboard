"""Tests for G47: an offline (manually-synced) account must rank WITH its
real class — current or savings — not as a third class reached only after
every connected account in both classes.

Kevin, 2026-09-13: "An offline account is the same as a connected account
but is just manually synced, that is the distinction, and an offline
account can be current or savings." Before this fix, `companion.py` built
offline-account dicts (around the old line 1516-1534) with no `type`/
`subtype` at all, so `_is_current`/`_is_savings` returned false for every
one of them regardless of what `manual_accounts_col`'s own `account_type`
said, and `class_specs` (in `_find_legs_for_destination`) ranked ALL
offline accounts, current or savings, as a third class reached only once
BOTH connected classes combined were exhausted.

Fix: the offline-account build loop now stamps `subtype` from
`manual_accounts_col`'s `account_type` (`"CURRENT"` or `"SAVINGS"`, the
same mapping `routers/accounts.py`'s `_manual_to_account` already uses for
the `/accounts` API), so the existing `services/account_kinds.py`
classifiers place it correctly. `class_specs` collapsed from three tuples
to two — `(all_uk_accounts + offline_accounts, <current predicate>)` then
`(all_uk_accounts + offline_accounts, <savings predicate>)` — so an offline
account competes on headroom within its real class. The manual-transfer
cost (reaching the money needs the user to act) survives as a TIE-BREAK in
`_live_class`'s sort key: at EQUAL headroom, a connected account is chosen
over an offline one, never the reverse.

Every test here drives the REAL engine end to end (`compute_today_items`
via a commitment bill that creates a genuine destination shortfall, exactly
`test_cover_plan_account_eligibility.py`'s
`test_short_account_is_never_the_one_the_engine_actually_uses` pattern),
reading the actual leg(s) picked (`move["moves"][i]["move_map"]["from"]
["account_id"]`), not a restatement of `_is_current`/`_is_savings` in
isolation.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention this suite's neighbours already established (`FakeCol`/`_match`/
`_FakeCursor` are NOT shared across test files by convention here).
"""
import asyncio
from datetime import date, timedelta

import app.services.companion as companion
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
    """A `manual_accounts_col` doc — the real shape (`account_type` in
    `{"savings", "current", "credit_card"}`, see `routers/manual_accounts.py`'s
    `ACCOUNT_TYPES`), NOT a companion.py-internal offline-account dict."""
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id,
        "balance": balance, "account_type": account_type,
    }


def _run(monkeypatch, bills, *, accounts=None, manual_accounts=None,
         income_streams=None, window_income=None, account_eligibility_out=None):
    """Full-stack harness for `companion.compute_today_items`, following
    `test_cover_plan_account_eligibility.py`'s `_run` pattern verbatim,
    extended with `manual_accounts` so `manual_accounts_col` can carry real
    offline-account fixtures instead of always being empty."""
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


# ── An offline CURRENT account ranks WITH current accounts ─────────────────

def test_offline_current_account_ranks_with_current_accounts(monkeypatch):
    """Only source available in the current class is an offline CURRENT
    account; a connected SAVINGS pot with far more headroom also exists.
    Before this fix, the offline account was excluded from class 1 entirely
    (no subtype), so the connected savings pot — the ONLY thing `_is_
    current`/`_is_savings` would have admitted to class 1 or 2 — would have
    been picked instead, reaching into savings on the very first shortfall.
    After the fix, the offline account's stamped `subtype` puts it in the
    current class, so it is used and the savings pot is never touched."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("halifax", 5000.0, name="Halifax Savings", subtype="SAVINGS", provider="halifax"),
    ]
    manual_accounts = [_manual("cash_current", 200.0, account_type="current", name="Offline Current")]
    bills = [_bill("Rent", 2, 50.0, "premier", 0.0, kind="commitment")]

    items = _run(monkeypatch, bills, accounts=accounts, manual_accounts=manual_accounts)

    move = _find(items, "move")
    assert move is not None
    leg_ids = _leg_source_ids(move)
    assert leg_ids == {"cash_current"}
    assert "halifax" not in leg_ids


# ── An offline SAVINGS pot ranks WITH savings, by headroom, not last ────────

def test_offline_savings_pot_ranks_with_savings_by_headroom(monkeypatch):
    """No connected current account is viable (only the destination
    itself), so the shortfall must be funded from the savings class. A
    connected savings pot has modest headroom (£40, not enough alone); an
    offline savings pot has far more (£4,990). Before this fix, the
    connected pot (class 2) would have been exhausted FIRST and the offline
    pot (class 3) reached only for the residual — TWO legs. After the fix,
    both compete in one savings class ranked by headroom, so the single
    higher-headroom offline pot covers it alone and the connected pot is
    never touched."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("halifax", 50.0, name="Halifax Savings", subtype="SAVINGS", provider="halifax"),
    ]
    manual_accounts = [_manual("piggy", 5000.0, account_type="savings", name="Offline Savings")]
    bills = [_bill("Rent", 2, 60.0, "premier", 0.0, kind="commitment")]

    items = _run(monkeypatch, bills, accounts=accounts, manual_accounts=manual_accounts)

    move = _find(items, "move")
    assert move is not None
    leg_ids = _leg_source_ids(move)
    assert leg_ids == {"piggy"}
    assert "halifax" not in leg_ids


# ── Manual-transfer cost survives as a tie-break, not a class ───────────────

def test_connected_account_preferred_over_offline_at_equal_headroom(monkeypatch):
    """A connected current account and an offline current account have
    IDENTICAL headroom (£190 each). Either alone covers the £70 needed.
    The tie-break in `_live_class`'s sort key — connected before offline at
    equal headroom — must pick the connected account: reaching the offline
    one needs a manual transfer, so it is never preferred over an
    equally-good connected account.

    The ids are deliberately chosen so the offline account (`aaa_off_cur`)
    sorts BEFORE the connected one (`zzz_conn_cur`) alphabetically. That
    means the sort key's final tie-break term (account id) would, on its
    own, already pick the connected account by the id-order coincidence
    the previous version of this test relied on (`conn_cur` < `off_cur`).
    Here id order points the WRONG way, so the only thing that can still
    land on the connected account is the `_is_offline` term the sort key
    checks before id — this test fails if that term is removed (confirmed
    by temporarily deleting it from `_live_class`'s sort key in
    `companion.py` and observing the assertion below fail)."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("zzz_conn_cur", 200.0, name="Connected Current", provider="hsbc"),
    ]
    manual_accounts = [_manual("aaa_off_cur", 200.0, account_type="current", name="Offline Current")]
    bills = [_bill("Rent", 2, 60.0, "premier", 0.0, kind="commitment")]

    items = _run(monkeypatch, bills, accounts=accounts, manual_accounts=manual_accounts)

    move = _find(items, "move")
    assert move is not None
    leg_ids = _leg_source_ids(move)
    assert leg_ids == {"zzz_conn_cur"}
    assert "aaa_off_cur" not in leg_ids


# ── The case that drove the old behaviour still holds ───────────────────────

def test_offline_savings_only_reached_once_current_accounts_are_exhausted(monkeypatch):
    """TWO connected current accounts, neither alone big enough to cover
    the gap (£100 and £50 headroom against a £220 need, `_ceil5(shortfall)
    + 10` per `compute_today_items`, from a £210 bill), so the current
    class's combined headroom (£150) still falls £70 short. An offline
    SAVINGS pot with ample headroom (£4,990) also exists. The engine must
    drain BOTH connected current accounts in full before carrying the £70
    residual into the savings class, where the offline pot picks it up.

    This is the case the previous version of this test claimed to cover
    but did not: with only one connected current account (which alone
    covered the whole bill), the current class was never actually
    exhausted, so the test proved nothing about what happens once it is.
    Here the current class is only exhausted in combination, and the
    offline savings pot is only reached after that combination is spent.

    Proof this discriminates: temporarily restricting `_live_class`'s
    "class alone can't cover it" branch (around companion.py's
    `_find_legs_for_destination`) to spend only the single highest-headroom
    account instead of the whole class makes this test fail (`conn_b`
    never appears; the residual the engine then hands to the offline pot
    is wrong), which is what "exhausted in combination" is checking for."""
    accounts = [
        _account("premier", 0.0, name="Premier Current"),
        _account("conn_a", 110.0, name="Connected Current A", provider="hsbc"),
        _account("conn_b", 60.0, name="Connected Current B", provider="natwest"),
    ]
    manual_accounts = [_manual("piggy", 5000.0, account_type="savings", name="Offline Savings")]
    bills = [_bill("Rent", 2, 210.0, "premier", 0.0, kind="commitment")]

    items = _run(monkeypatch, bills, accounts=accounts, manual_accounts=manual_accounts)

    move = _find(items, "move")
    assert move is not None
    leg_ids = _leg_source_ids(move)
    assert leg_ids == {"conn_a", "conn_b", "piggy"}

    amount_by_source = {
        m["move_map"]["from"]["account_id"]: m["amount"] for m in move["moves"]
    }
    # Both connected current accounts drained to their full headroom...
    assert amount_by_source["conn_a"] == 100
    assert amount_by_source["conn_b"] == 50
    # ...and the offline pot picks up exactly the residual, not before.
    assert amount_by_source["piggy"] == 70
