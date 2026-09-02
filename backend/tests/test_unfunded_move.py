"""Unit tests for the `unfunded_move` companion item — a deliberate, narrow
owner extension of the movement doctrine (Kevin, 2026-08-27; see
app/services/companion.py section 5d).

Standing doctrine (untouched everywhere else): a movement bounce never
counts as at-risk/RED and never resurrects the "move money" recommendation
(`_gate_recommendation` gate (b)) — a bounced own-transfer has no fee and no
credit damage. What's new is narrower: a movement that is BOTH pending
(due date arrived/passed, nothing observed) AND unfundable per the SAME
conservative walk (present in `bounced_bills`) is a genuine call to
action — fund it, do it anyway, or skip it — surfaced as one aggregated
QUIET card with a per-move SKIP that reuses the existing
`/cashflow/skip-occurrence` per-occurrence override endpoint.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention `test_internal_inflows.py` already established for this file's
neighbours (`FakeCol` / `_match` / `_FakeCursor` are NOT shared across test
files by convention here).
"""
import asyncio
from datetime import date, timedelta

import app.services.companion as companion
import app.db.collections as db_collections
from app.services.categories import MOVEMENT

UID = "kevin"


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


TODAY = date.today()


def _mv_bill(name, amount, account_id, *, pending, days_away=0, days_past_due=0,
             dest_account_id=None, original_date=None):
    """A movement-kind bill dict shaped like analytics.py's raw_bills entries
    — the only fields companion.py's unfunded_move branch reads."""
    disp = TODAY + timedelta(days=days_away)
    return {
        "name": name, "amount": amount, "days_away": days_away,
        "account_id": account_id, "account_name": account_id, "account_bank": "Bank",
        "account_balance": 100.0, "is_credit_card": False, "kind": MOVEMENT,
        "category": "Transfer", "edited": False, "rule_label": None,
        "pending": pending, "days_past_due": days_past_due,
        "expected_date": disp.isoformat(),
        "original_date": original_date,
        "dest_account_id": dest_account_id,
        "dest_account_spendable": True,
    }


def _commitment_bill(name, amount, account_id, days_away):
    """A plain (non-movement) bill — used to give a payday-plan destination
    something to fund, and as the "real bill" control in the movement-only
    doctrine check."""
    disp = TODAY + timedelta(days=days_away)
    return {
        "name": name, "amount": amount, "days_away": days_away,
        "account_id": account_id, "account_name": account_id, "account_bank": "Bank",
        "account_balance": 100.0, "is_credit_card": False, "kind": "commitment",
        "category": "Bills", "edited": False, "rule_label": None,
        "pending": days_away <= 0, "days_past_due": 0,
        "expected_date": disp.isoformat(), "original_date": None,
        "dest_account_id": None, "dest_account_spendable": None,
    }


def _account(acct_id, balance, provider="barclays", name=None):
    return {
        "_id": acct_id, "user_id": UID, "name": name or acct_id, "balance": balance,
        "subtype": "TRANSACTION", "type": "BANK", "provider": provider,
    }


def _run(monkeypatch, bills, *, accounts=None, payday_window=False,
         income_streams=None, window_income=None, companion_items=None):
    """Full-stack harness: patches every collection compute_today_items
    touches and calls it for real, following test_internal_inflows.py's
    `_run_compute_today_items` pattern (extended with `accounts_col` so the
    payday-plan / account-lookup branches this item interacts with can be
    driven from a test)."""
    import app.services.pay_period as pay_period
    import app.services.income as income

    monkeypatch.setattr(income, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda today_d, pay_cfg: today_d + timedelta(days=10))
    if payday_window:
        monkeypatch.setattr(
            pay_period, "get_pay_period_for_date",
            lambda today_d, pay_cfg: (today_d, today_d + timedelta(days=27)),
        )
    else:
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
    # app.services.pace imports its OWN module-level cashflow_cache_col /
    # transactions_col / yapily_transactions_col / preferences_col (from
    # app.db.collections, at import time), read/written by
    # compute_today_items's rhythm-checkpoint pass via
    # pace._read_cached_baseline / _write_cached_baseline. Patching only
    # `companion`'s names left this write path pointed at the REAL database
    # (root cause of a "kevin" fixture doc found polluting the live
    # cashflow_cache collection, 2026-08-28) — patch pace's own references
    # too so this suite never touches Mongo.
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


# ── Trigger: all four quadrants (pending × bounced) ─────────────────────────

def test_pending_and_bounced_fires():
    """Both conditions true: overdue movement, walk says the source can't
    fund it — the exact Kevin scenario (HSBC/Monzo transfers, short account)."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0)]
        bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                           pending=True, days_past_due=9, original_date="2026-08-18")]
        items, _ = _run(mp, bills, accounts=accounts)
        item = _find(items, "unfunded_move")
        assert item is not None
        assert item["moves"][0]["key"] == "KEVIN MAINGI HSBC FT"
        assert item["moves"][0]["source_account_id"] == "barclays"
        assert item["estimated"] is False
    finally:
        mp.undo()


def test_pending_but_fundable_does_not_fire():
    """Overdue, but the account genuinely holds enough — Planning's own
    pending copy already covers "late", this must not also fire."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 500.0)]
        bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                           pending=True, days_past_due=9, original_date="2026-08-18")]
        items, _ = _run(mp, bills, accounts=accounts)
        assert _find(items, "unfunded_move") is None
    finally:
        mp.undo()


def test_bounced_but_not_yet_due_does_not_fire():
    """Unfundable per the walk, but not due yet — payday may still fund it;
    the sims already reason about that, so this must not jump the gun."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 5.0)]
        bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                           pending=False, days_away=3)]
        items, _ = _run(mp, bills, accounts=accounts)
        assert _find(items, "unfunded_move") is None
    finally:
        mp.undo()


def test_neither_pending_nor_bounced_does_not_fire(monkeypatch):
    mp = monkeypatch
    accounts = [_account("barclays", 500.0)]
    bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                       pending=False, days_away=5)]
    items, _ = _run(mp, bills, accounts=accounts)
    assert _find(items, "unfunded_move") is None


# ── Aggregation ───────────────────────────────────────────────────────────

def test_two_qualifying_moves_aggregate_into_one_item(monkeypatch):
    mp = monkeypatch
    accounts = [_account("barclays", 20.0)]
    bills = [
        _mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                 pending=True, days_past_due=9, original_date="2026-08-18"),
        _mv_bill("K MONZO TEST FT", 77.0, "barclays",
                 pending=True, days_past_due=1, original_date="2026-08-26"),
    ]
    items, _ = _run(mp, bills, accounts=accounts)
    unfunded = [i for i in items if i["type"] == "unfunded_move"]
    assert len(unfunded) == 1
    assert len(unfunded[0]["moves"]) == 2
    assert "2 planned moves" in unfunded[0]["headline"]
    # Soonest-due first.
    assert unfunded[0]["moves"][0]["key"] == "KEVIN MAINGI HSBC FT"


# ── Fingerprint stability across runs ────────────────────────────────────

def test_fingerprint_stable_across_runs_upserts_not_duplicates(monkeypatch):
    mp = monkeypatch
    accounts = [_account("barclays", 20.0)]
    bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                       pending=True, days_past_due=9, original_date="2026-08-18")]
    items1, col = _run(mp, bills, accounts=accounts)
    first_id = _find(items1, "unfunded_move")["id"]
    # Second run reuses whatever the first run persisted.
    stored_docs = list(col.docs)
    items2, col2 = _run(mp, bills, accounts=accounts, companion_items=stored_docs)
    second_id = _find(items2, "unfunded_move")["id"]
    assert first_id == second_id
    unfunded_docs = [d for d in col2.docs if d.get("type") == "unfunded_move"]
    assert len(unfunded_docs) == 1


# ── Resolution when skipped/observed ─────────────────────────────────────

def test_resolves_when_the_move_no_longer_qualifies():
    """Simulates the per-occurrence skip endpoint's effect (the skipped
    occurrence simply stops appearing in upcoming_bills, exactly like
    `_apply_overrides_to_occurrence`'s skip branch does upstream): the next
    compute must not linger on the old card, and the stale doc must not
    stay "active"."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0)]
        bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                           pending=True, days_past_due=9, original_date="2026-08-18")]
        items1, col = _run(mp, bills, accounts=accounts)
        assert _find(items1, "unfunded_move") is not None
        stored_docs = list(col.docs)

        # The move is now gone from upcoming_bills (skipped or observed).
        items2, col2 = _run(mp, [], accounts=accounts, companion_items=stored_docs)
        assert _find(items2, "unfunded_move") is None
        stale = [d for d in col2.docs if d.get("type") == "unfunded_move"]
        assert stale and all(d["status"] != "active" for d in stale)
    finally:
        mp.undo()


def test_reopens_under_a_new_id_after_dismissal():
    """A genuinely NEW unfunded move (different account+name+amount set)
    after an old one was dismissed must still raise — dismissal is
    permanent by id, per this file's existing convention (see
    `_get_dismissed`/`dismiss_item`), and the fingerprint changing for a
    materially different move set is what makes that work here."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0)]
        bills1 = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                            pending=True, days_past_due=9, original_date="2026-08-18")]
        items1, col = _run(mp, bills1, accounts=accounts)
        old_id = _find(items1, "unfunded_move")["id"]

        # Dismiss it.
        dismissed_doc = {"_id": f"dismissed:{UID}", "ids": [old_id]}
        stored_docs = list(col.docs) + [dismissed_doc]

        # A different movement now qualifies.
        bills2 = [_mv_bill("K MONZO TEST FT", 77.0, "barclays",
                            pending=True, days_past_due=1, original_date="2026-08-26")]
        items2, _ = _run(mp, bills2, accounts=accounts, companion_items=stored_docs)
        new_item = _find(items2, "unfunded_move")
        assert new_item is not None
        assert new_item["id"] != old_id
    finally:
        mp.undo()


# ── Payday-plan overlap exclusion ────────────────────────────────────────

def test_excluded_when_its_destination_is_funded_by_the_live_payday_plan():
    """The transfer's learned destination is already getting money from the
    live payday plan this window (move > 0 in `dests`) — describing the
    same move twice would double-describe it, so unfunded_move must yield."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0), _account("hsbc_dest", 0.0, provider="hsbc")]
        bills = [
            _mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                     pending=True, days_past_due=9, dest_account_id="hsbc_dest",
                     original_date="2026-08-18"),
            # A real bill on hsbc_dest guarantees the plan gives it a
            # positive move (via the trim's own bills-floor) regardless of
            # how tight the salary account's distributable is — isolates
            # this test to the overlap exclusion itself, not trim edge cases.
            _commitment_bill("Council Tax", 40.0, "hsbc_dest", days_away=5),
        ]
        window_income = [{
            "name": "Salary", "amount": 2000.0, "days_away": 10, "account_id": "barclays",
            "account_name": "Barclays Current",
        }]
        items, _ = _run(
            mp, bills, accounts=accounts, payday_window=True,
            income_streams=[{"key": "Salary", "status": "confirmed"}],
            window_income=window_income,
        )
        # The plan card fired and IS funding hsbc_dest.
        plan = _find(items, "payday_plan")
        assert plan is not None
        assert any(d["account_id"] == "hsbc_dest" and d["move"] > 0 for d in plan["dests"])
        # unfunded_move must not double-describe the same move.
        assert _find(items, "unfunded_move") is None
    finally:
        mp.undo()


def test_not_excluded_when_destination_is_outside_the_payday_plan():
    """Same payday window, but the transfer's destination is NOT one the
    live plan is funding this period (an unknown/untracked pot) — the
    overlap exclusion must not over-fire and swallow every movement during
    the payday window."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0)]
        bills = [
            _mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                     pending=True, days_past_due=9, dest_account_id="not_a_tracked_account",
                     original_date="2026-08-18"),
        ]
        window_income = [{
            "name": "Salary", "amount": 2000.0, "days_away": 10, "account_id": "barclays",
            "account_name": "Barclays Current",
        }]
        items, _ = _run(
            mp, bills, accounts=accounts, payday_window=True,
            income_streams=[{"key": "Salary", "status": "confirmed"}],
            window_income=window_income,
        )
        assert _find(items, "unfunded_move") is not None
    finally:
        mp.undo()


# ── Movement red-path suppression untouched ──────────────────────────────

def test_movement_bounce_never_appears_in_shortfalls_or_move_cards():
    """Doctrine check: a movement-only bounce must still never reach the
    "move money" recommendation engine (`shortfalls`/move cards) or set any
    at-risk signal — this extension only ever ADDS the quiet unfunded_move
    card, it must never resurrect what `_gate_recommendation` gate (b)
    suppresses. Uses a bounced-but-not-yet-due movement (so unfunded_move
    itself doesn't fire either) purely to isolate the doctrine check from
    this item's own trigger."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 5.0)]
        bills = [_mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                           pending=True, days_past_due=9, original_date="2026-08-18")]
        items, _ = _run(mp, bills, accounts=accounts)
        # No "move" (bill-shortfall) card, no at-risk-flavoured card at all
        # beyond the quiet unfunded_move item itself.
        assert _find(items, "move") is None
        unfunded = _find(items, "unfunded_move")
        assert unfunded is not None
        assert "moves" in unfunded  # the SKIP-offering shape, never "move money"
    finally:
        mp.undo()


def test_movement_and_real_bill_coexist_move_card_represents_the_real_bill_only():
    """An account with BOTH a bounced movement (unfunded_move territory)
    AND a real bounced bill (move-card territory, gate (b) does not
    suppress since a real obligation is among the bounced items) — the move
    card must still describe the REAL bill, never the movement, exactly as
    `_gate_recommendation`'s docstring promises; unfunded_move covers the
    movement side separately."""
    import pytest
    mp = pytest.MonkeyPatch()
    try:
        accounts = [_account("barclays", 20.0)]
        bills = [
            _mv_bill("KEVIN MAINGI HSBC FT", 81.67, "barclays",
                     pending=True, days_past_due=9, original_date="2026-08-18"),
            _commitment_bill("Council Tax", 50.0, "barclays", days_away=0),
        ]
        items, _ = _run(mp, bills, accounts=accounts)
        move = _find(items, "move")
        assert move is not None
        assert "Council Tax" in move["body"] or "Council Tax" in move.get("headline", "")
        assert "HSBC" not in move["body"]
        assert _find(items, "unfunded_move") is not None
    finally:
        mp.undo()
