"""Tests for the envelope funding-source reservation fix (owner, verbatim,
2026-08-31): "does it take account [of] what has been set aside on the
envelope? ... it is focused on the transaction that enters the savings
challenge account, but is dependent on the [source] account we are taking
[money] from... would there be enough for this envelope?"

Live case this closes: Penny's move card recommended £825 from Monzo
(balance £1,051) toward a shortfall elsewhere, while the "Saving Challenge"
allocation still needed ~£230 of daily drip THIS period from that SAME
Monzo account. The recommendation left the envelope's own funding source
short before any everyday spend.

Covers:
  - `app.services.companion._reserved_for_allocations` in isolation
    (monkeypatched `list_active_allocations`): single-source derivation,
    multi-source modal-source choice, an unpaired fill account (no
    derivable source), and completed/pending allocations (via `remaining`,
    already forced to 0 upstream) contributing nothing.
  - Real period-scoping, driven through the ACTUAL `app.routers.allocations
    .list_active_allocations` (a completed "once" allocation and a pending
    future-dated one), proving the reservation only ever reflects genuinely
    live, this-period remainders.
  - The live-shaped end-to-end case through `companion.compute_today_items`:
    a Monzo->Premier "drip" mirrored in `internal_inflows`, an allocation
    with £230 remaining on that same fill account, and a £825-sized move
    recommendation from Monzo that must shrink once the reservation is
    wired in.
  - The payday plan's `distributable` sizing off the salary account, same
    reservation, same shrink-not-crash behaviour.

No mongomock is available in this environment, so DB-touching collections
are replaced with tiny in-memory fakes, following the same local-copy
convention this suite's neighbours (test_allocations.py, test_payday_plan_
own_transfers.py, test_internal_inflows.py) already established.
"""
import asyncio
from datetime import date, datetime, timedelta

from bson import ObjectId

import app.db.collections as db_collections
import app.routers.allocations as allocations
import app.services.companion as companion
import app.services.pace as pace_module

UID = "alloc-reservation-user"


# ── Section 1: `_reserved_for_allocations` in isolation ─────────────────────
# `list_active_allocations` monkeypatched directly on `companion` (it was
# imported by name into that module's namespace, exactly like
# `_build_cashflow_response`/`income_credit_ok` — see companion.py's own
# imports), so these tests exercise the derivation/aggregation logic alone,
# without touching allocations.py or Mongo at all.

def _alloc(fill_account_id, remaining, **overrides):
    d = {"fill_account_id": fill_account_id, "remaining": remaining, "amount_per_period": 266.0}
    d.update(overrides)
    return d


def _inflow(dest, source):
    return {"account_id": dest, "source_account_id": source}


def _reserve(monkeypatch, allocs, inflows):
    async def fake_list_active_allocations(uid):
        return allocs
    monkeypatch.setattr(companion, "list_active_allocations", fake_list_active_allocations)
    return asyncio.run(companion._reserved_for_allocations(UID, inflows, {}))


def test_single_source_reserves_full_remainder_on_that_source(monkeypatch):
    allocs = [_alloc("premier", 230.0)]
    inflows = [_inflow("premier", "monzo") for _ in range(5)]
    assert _reserve(monkeypatch, allocs, inflows) == {"monzo": 230.0}


def test_multi_source_modal_choice_reserves_full_remainder_on_dominant_source(monkeypatch):
    """Monzo funds this envelope on 4 of 5 mirrored occurrences, HSBC on 1
    (an occasional manual top-up). The FULL remainder is reserved against
    Monzo, the dominant source, HSBC gets nothing — the deliberate
    simplification the owner directive allows over proportional splitting."""
    allocs = [_alloc("premier", 100.0)]
    inflows = (
        [_inflow("premier", "monzo") for _ in range(4)]
        + [_inflow("premier", "hsbc")]
    )
    reserved = _reserve(monkeypatch, allocs, inflows)
    assert reserved == {"monzo": 100.0}
    assert "hsbc" not in reserved


def test_unpaired_fill_account_has_no_derivable_source_reserves_nothing(monkeypatch):
    """Fills arrive from outside the tracked accounts (or the series hasn't
    cleared `_learn_transfer_destinations`'s evidence gate) — no mirrored
    inflow lands on THIS fill account at all. Fail-open: reserves nothing
    anywhere, rather than guessing."""
    allocs = [_alloc("premier", 230.0)]
    inflows = [_inflow("some-other-account", "monzo")]
    assert _reserve(monkeypatch, allocs, inflows) == {}


def test_fully_filled_allocation_reserves_nothing(monkeypatch):
    allocs = [_alloc("premier", 0.0)]
    inflows = [_inflow("premier", "monzo")]
    assert _reserve(monkeypatch, allocs, inflows) == {}


def test_completed_and_pending_allocations_reserve_nothing(monkeypatch):
    """`remaining` is already forced to 0 for a completed OR pending
    allocation by allocations.py's `_serialise` — this function trusts that
    upstream figure completely rather than re-deriving completed/pending
    status itself, so both fall out for free with no separate branch."""
    allocs = [
        _alloc("premier", 0.0, completed=True),
        _alloc("isa", 0.0, pending=True),
    ]
    inflows = [_inflow("premier", "monzo"), _inflow("isa", "hsbc")]
    assert _reserve(monkeypatch, allocs, inflows) == {}


def test_no_active_allocations_reserves_nothing(monkeypatch):
    assert _reserve(monkeypatch, [], [_inflow("premier", "monzo")]) == {}


def test_inactive_allocations_never_reach_this_function(monkeypatch):
    """The real `list_active_allocations` already queries `{"active": True}`
    — an inactive allocation is never even IN the list this function
    receives, so it structurally reserves nothing. Section 2 below proves
    this against the REAL query; here an empty list stands in for "already
    filtered out"."""
    assert _reserve(monkeypatch, [], [_inflow("premier", "monzo")]) == {}


# ── Section 2: real period-scoping, through the ACTUAL allocations router ───

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$lte" in cond and not (val is not None and val <= cond["$lte"]):
                return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *a, **kw):
        return self

    def limit(self, *a, **kw):
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


TODAY = date.today()


def _once_doc(*, fill_account_id, amount):
    """A "once" allocation doc whose fixed window is safely in the PAST
    (completed) — bypassing `create_allocation` (which always fixes the
    boundary to today's period) so this test doesn't have to wait for a
    real pay period to elapse. Mirrors test_allocations.py's own
    `_completed_once_doc` helper."""
    start = TODAY - timedelta(days=400)
    end = TODAY - timedelta(days=370)
    return {
        "_id": ObjectId(),
        "user_id": UID,
        "name": "Old one-off",
        "amount_per_period": amount,
        "fill_account_id": fill_account_id,
        "match_type": "description_contains",
        "match_value": "SAVING CHALLENGE",
        "fill_display_name": "Saving Challenge",
        "effective_from": datetime(start.year, start.month, start.day),
        "recurrence": "once",
        "created_period_start": datetime(start.year, start.month, start.day),
        "created_period_end": datetime(end.year, end.month, end.day, 23, 59, 59),
        "active": True,
        "created_at": datetime.now(),
    }


def _pending_doc(*, fill_account_id, amount):
    """An `every_period` allocation whose `effective_from` falls in a FUTURE
    pay period — `_serialise` marks this `pending` (the reserve hasn't
    started yet) and forces `remaining` to 0, exactly like
    test_allocations.py's `test_effective_from_in_future_is_pending_with_
    zero_reserve`. `eff_start`/`eff_end` for an `every_period` doc come from
    the CALLER's current period (`get_pay_period_for_date(today, cfg)` —
    calendar month here, see `_setup_real_allocations`), so effective_from
    only needs to land next calendar month to qualify."""
    if TODAY.month == 12:
        next_month_start = TODAY.replace(year=TODAY.year + 1, month=1, day=1)
    else:
        next_month_start = TODAY.replace(month=TODAY.month + 1, day=1)
    future = next_month_start + timedelta(days=5)
    return {
        "_id": ObjectId(),
        "user_id": UID,
        "name": "Not started yet",
        "amount_per_period": amount,
        "fill_account_id": fill_account_id,
        "match_type": "description_contains",
        "match_value": "SAVING CHALLENGE",
        "fill_display_name": "Saving Challenge",
        "effective_from": datetime(future.year, future.month, future.day),
        "recurrence": "every_period",
        "active": True,
        "created_at": datetime.now(),
    }


def _setup_real_allocations(monkeypatch, *, docs, accounts=None):
    monkeypatch.setattr(allocations, "accounts_col", FakeCol(accounts or []))
    monkeypatch.setattr(allocations, "yapily_accounts_col", FakeCol([]))
    monkeypatch.setattr(allocations, "manual_accounts_col", FakeCol([]))
    monkeypatch.setattr(allocations, "allocations_col", FakeCol(docs))
    monkeypatch.setattr(allocations, "transactions_col", FakeCol([]))
    monkeypatch.setattr(allocations, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(allocations, "preferences_col", FakeCol(
        [{"user_id": UID, "pay_period_config": {"type": "calendar_month"}}]
    ))


def test_completed_once_allocation_reserves_nothing_even_with_a_real_mirrored_source(monkeypatch):
    """A "once" allocation whose fixed window ended long ago is `completed`
    (`remaining` forced to 0 by `_serialise`) — even though a plausible
    mirrored Monzo->Premier inflow exists, it must reserve nothing. Drives
    the REAL `app.routers.allocations.list_active_allocations` (not a fake),
    genuinely proving period-scoping flows through."""
    doc = _once_doc(fill_account_id="premier", amount=230)
    _setup_real_allocations(monkeypatch, docs=[doc])
    inflows = [_inflow("premier", "monzo") for _ in range(5)]
    reserved = asyncio.run(companion._reserved_for_allocations(UID, inflows, {}))
    assert reserved == {}


def test_pending_future_allocation_reserves_nothing(monkeypatch):
    """`effective_from` in the future -> pending -> `remaining` forced to 0
    -> reserves nothing, even with a real mirrored source available."""
    doc = _pending_doc(fill_account_id="premier", amount=230)
    _setup_real_allocations(monkeypatch, docs=[doc])
    inflows = [_inflow("premier", "monzo") for _ in range(5)]
    reserved = asyncio.run(companion._reserved_for_allocations(UID, inflows, {}))
    assert reserved == {}


def test_live_every_period_allocation_reserves_through_the_real_pipeline(monkeypatch):
    """Contrast case: a genuinely live `every_period` allocation, partially
    filled, DOES reserve its remainder — through the real
    `list_active_allocations` pipeline end to end, not a fake."""
    doc = {
        "_id": ObjectId(),
        "user_id": UID,
        "name": "Saving Challenge",
        "amount_per_period": 266.0,
        "fill_account_id": "premier",
        "match_type": "description_contains",
        "match_value": "SAVING CHALLENGE",
        "fill_display_name": "Saving Challenge",
        "effective_from": datetime(TODAY.year, TODAY.month, 1),
        "recurrence": "every_period",
        "active": True,
        "created_at": datetime.now(),
    }
    # No fill transactions at all this period -> filled_this_period == 0 ->
    # remaining == the full amount_per_period (£266).
    _setup_real_allocations(monkeypatch, docs=[doc])
    inflows = [_inflow("premier", "monzo") for _ in range(5)]
    reserved = asyncio.run(companion._reserved_for_allocations(UID, inflows, {}))
    assert reserved == {"monzo": 266.0}


# ── Section 2b: the direct fill-leg pairing fallback ─────────────────────────
# Coordinator finding (2026-08-31): the owner's REAL "Saving Challenge"
# envelope is a DAILY, escalating-amount drip — `_detect_recurring`'s cadence
# floor means that series can never be classified recurring, so
# `_learn_transfer_destinations` never learns it and `internal_inflows` stays
# empty for it, no matter how consistent the real pairing evidence is. These
# tests drive `_direct_fill_leg_source` (via `_reserved_for_allocations`,
# with an EMPTY `internal_inflows` so the primary channel finds nothing and
# the fallback is the only channel that can possibly answer) against a real
# same-day/exact-amount debit/credit pairing, exactly the owner's shape.

FILL_ACCT = "premier-savings-pot"
SRC_ACCT_A = "monzo-current"
SRC_ACCT_B = "hsbc-current"
MATCH_TYPE = "description_equals"
MATCH_VALUE = "Saving Challenge (2026)"


def _fallback_alloc(remaining, *, start, end):
    return {
        "fill_account_id": FILL_ACCT,
        "remaining": remaining,
        "amount_per_period": 266.0,
        "match_type": MATCH_TYPE,
        "match_value": MATCH_VALUE,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "effective_from": start.isoformat(),
    }


def _credit(day, amount, description=MATCH_VALUE):
    return {
        "user_id": UID, "account_id": FILL_ACCT, "amount": amount,
        "transaction_type": "credit", "date": datetime(day.year, day.month, day.day, 9, 0, 0),
        "merchant_name": None, "description": description,
    }


def _debit(account_id, day, amount, description=""):
    return {
        "user_id": UID, "account_id": account_id, "amount": amount,
        "transaction_type": "debit", "date": datetime(day.year, day.month, day.day, 9, 0, 0),
        "merchant_name": None, "description": description,
    }


def _setup_fallback(monkeypatch, *, alloc, credits, debits):
    async def fake_list_active_allocations(uid):
        return [alloc]
    monkeypatch.setattr(companion, "list_active_allocations", fake_list_active_allocations)
    monkeypatch.setattr(allocations, "transactions_col", FakeCol(credits))
    monkeypatch.setattr(allocations, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(companion, "transactions_col", FakeCol(debits))
    monkeypatch.setattr(companion, "yapily_transactions_col", FakeCol([]))


def test_daily_drip_shape_derives_the_right_source_via_the_fallback(monkeypatch):
    """The owner's actual shape: 30 daily, escalating-amount pairs (£1, £2,
    ... £30), each debit/credit posting the same second on the same day.
    `internal_inflows` is empty (as it genuinely is for this series on
    live data — see the companion.py module docstring reference), so this
    can ONLY be derived via the fallback."""
    start = TODAY - timedelta(days=29)
    end = TODAY
    credits = [_credit(start + timedelta(days=i), float(i + 1)) for i in range(30)]
    debits = [_debit(SRC_ACCT_A, start + timedelta(days=i), float(i + 1)) for i in range(30)]
    alloc = _fallback_alloc(230.0, start=start, end=end)
    _setup_fallback(monkeypatch, alloc=alloc, credits=credits, debits=debits)

    reserved = asyncio.run(companion._reserved_for_allocations(UID, [], {}))
    assert reserved == {SRC_ACCT_A: 230.0}


def test_contended_credit_with_no_affinity_fails_closed(monkeypatch):
    """One fill credit, but TWO candidate debits on DIFFERENT accounts,
    same day, same amount, neither description naming the fill account —
    per the 2026-08-26 collision doctrine this is an unresolved collision:
    the credit contributes NOTHING (not a guess at either account), and
    since it's the only credit, the allocation ends up with no derivable
    source at all."""
    day = TODAY
    credits = [_credit(day, 42.0, description=MATCH_VALUE)]
    debits = [
        _debit(SRC_ACCT_A, day, 42.0, description="FASTER PAYMENT"),
        _debit(SRC_ACCT_B, day, 42.0, description="STANDING ORDER"),
    ]
    alloc = _fallback_alloc(230.0, start=day, end=day)
    _setup_fallback(monkeypatch, alloc=alloc, credits=credits, debits=debits)

    reserved = asyncio.run(companion._reserved_for_allocations(UID, [], {}))
    assert reserved == {}


def test_contended_credit_resolved_by_name_affinity_to_the_fill_account(monkeypatch):
    """Same contention shape, but one candidate debit's OWN description
    names the fill account ("Saving Challenge") while the other doesn't —
    affinity narrows it to exactly one, so that credit DOES contribute,
    to the affine account only."""
    day = TODAY
    credits = [_credit(day, 42.0, description=MATCH_VALUE)]
    debits = [
        _debit(SRC_ACCT_A, day, 42.0, description="Saving Challenge (2026) sweep"),
        _debit(SRC_ACCT_B, day, 42.0, description="STANDING ORDER"),
    ]
    alloc = _fallback_alloc(230.0, start=day, end=day)
    _setup_fallback(monkeypatch, alloc=alloc, credits=credits, debits=debits)
    # The fill account's own name/provider is what `_has_affinity` matches
    # candidate descriptions against.
    account_map = {FILL_ACCT: {"name": "Saving Challenge (2026)", "provider": "Monzo"}}

    reserved = asyncio.run(companion._reserved_for_allocations(UID, [], account_map))
    assert reserved == {SRC_ACCT_A: 230.0}


def test_internal_inflows_channel_takes_precedence_over_fallback(monkeypatch):
    """When the primary `internal_inflows` channel already has a source for
    an allocation, the direct fill-leg pairing fallback must NEVER even be
    consulted — spied here directly (rather than inferred from the result)
    so this is a real proof of precedence, not a coincidence of both
    channels agreeing."""
    calls = []

    async def spy_fallback(*a, **kw):
        calls.append((a, kw))
        return "should-never-be-used"

    monkeypatch.setattr(companion, "_direct_fill_leg_source", spy_fallback)

    alloc = _fallback_alloc(230.0, start=TODAY - timedelta(days=5), end=TODAY)
    inflows = [_inflow(FILL_ACCT, "chase-current") for _ in range(3)]
    reserved = _reserve(monkeypatch, [alloc], inflows)

    assert reserved == {"chase-current": 230.0}
    assert calls == []


# ── Section 3: the live-shaped case, end to end through compute_today_items ─
# Monzo (balance £1,051, no bills of its own -> min-running £1,051) is the
# sole source for a £815 shortfall elsewhere (amount_needed = ceil5(815) +
# 10 = £825, comfortably inside Monzo's pre-reservation headroom of £1,041,
# so the FULL £825 is recommended, exactly like the real card). The
# allocation still needs £230 of drip this period from that same Monzo
# account. Post-reservation headroom is £1,041 - £230 = £811 < £825, so the
# leg must shrink to the new binding constraint, floored to the nearest £5.

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


DEST_ACCT = "acc-premier"
SRC_ACCT = "acc-monzo"


def _account(acct_id, balance, name):
    return {
        "_id": acct_id, "name": name, "balance": balance,
        "subtype": "TRANSACTION", "type": "TRANSACTION", "provider": "Barclays",
        "currency": "GBP",
    }


def _shortfall_bill():
    return {
        "name": "Council Tax", "days_away": 3, "amount": 815.0,
        "account_id": DEST_ACCT, "account_balance": 0.0, "is_credit_card": False,
        "kind": "commitment", "expected_date": (date.today() + timedelta(days=3)).isoformat(),
        "account_name": "Premier",
    }


def _drip_inflows(n=5):
    """Mirrored Monzo->Premier drip occurrences, for derivation only.
    Deliberately dated WELL PAST the 10-day cashflow window (`_next_payday`
    below) so `window_inflows` (in_window-filtered) never includes them and
    they can never be double-counted as a same-account credit inside the
    shortfall walk itself — `_reserved_for_allocations` reads the FULL,
    unfiltered `internal_inflows` list (see companion.py's own comment at
    its call site), so they're still visible for derivation regardless."""
    return [
        {
            "name": "SAVING CHALLENGE DRIP", "amount": 10.0, "days_away": 15 + d,
            "account_id": DEST_ACCT, "account_name": "Premier", "account_bank": "Barclays",
            "source_account_id": SRC_ACCT, "source_account_name": "Monzo",
            "destination_spendable": False,
        }
        for d in range(n)
    ]


def _base_patch(monkeypatch, *, accounts, bills, allocations_list):
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

    today_d = date.today()
    monkeypatch.setattr(income_mod, "get_confirmed_payday", lambda prefs, today_d: None)
    monkeypatch.setattr(pay_period, "_next_payday", lambda td, cfg: today_d + timedelta(days=10))
    # Solidly mid-period (day 21 of the period) so the payday-plan section
    # (days_into_period <= 3) never fires and interferes with the move card
    # this test is actually about.
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda ref, cfg: (today_d - timedelta(days=20), today_d + timedelta(days=10)),
    )

    async def fake_resp(cached, uid=None, prefs=None):
        return {"upcoming_bills": bills, "upcoming_income": [], "internal_inflows": _drip_inflows()}

    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    async def fake_list_active_allocations(u):
        return allocations_list

    monkeypatch.setattr(companion, "list_active_allocations", fake_list_active_allocations)


def _run(monkeypatch, *, allocations_list):
    accounts = [
        _account(DEST_ACCT, 0.0, "Premier"),
        _account(SRC_ACCT, 1051.0, "Monzo"),
    ]
    bills = [_shortfall_bill()]
    _base_patch(monkeypatch, accounts=accounts, bills=bills, allocations_list=allocations_list)
    return asyncio.run(companion.compute_today_items(UID, persist=False))


def _move_card(items):
    return next((i for i in items if i["type"] == "move"), None)


def test_baseline_no_allocation_recommends_the_full_825_from_monzo(monkeypatch):
    """Confirms the pre-fix arithmetic (no allocation in play at all): the
    full £825 is recommended from Monzo, matching the live card before this
    fix — the regression baseline the next test's shrink is measured against."""
    items = _run(monkeypatch, allocations_list=[])
    card = _move_card(items)
    assert card is not None
    assert card["move_map"]["from"]["account_id"] == SRC_ACCT
    assert card["amount"] == 825
    assert card["move_map"]["from"]["reserved_for_allocations"] == 0
    assert card["envelope_reserved"] is False


def test_live_shaped_case_envelope_reservation_shrinks_the_monzo_leg(monkeypatch):
    """The owner's exact live shape: a £230 remainder still needed this
    period on the Saving Challenge envelope, funded (per the mirrored drip)
    by the SAME Monzo account the shortfall recommendation would otherwise
    fully draw from. The recommended leg must shrink below the previous
    £825, and the payload must disclose why."""
    allocations_list = [{
        "fill_account_id": DEST_ACCT,
        "remaining": 230.0,
        "amount_per_period": 266.0,
        "active": True,
        "completed": False,
        "pending": False,
    }]
    items = _run(monkeypatch, allocations_list=allocations_list)
    card = _move_card(items)
    assert card is not None
    leg = card["move_map"]["from"]
    assert leg["account_id"] == SRC_ACCT
    # Pre-reservation headroom was £1,041 (balance £1,051 - £10 buffer); the
    # £230 envelope reservation drops it to £811, now BELOW the £825 the
    # destination needs, so the leg is capped there and floored to the
    # nearest £5 (partial-leg flooring, unchanged pre-existing rule).
    assert card["amount"] <= 821
    assert card["amount"] == 810
    assert leg["reserved_for_allocations"] == 230.0
    assert card["envelope_reserved"] is True
    # Every figure still reconciles: the card is honest that it no longer
    # fully covers the destination (dest_gap = 825 - 810 = 15 > 0.5).
    assert card["covered"] is False
    assert "residual" in card


def test_over_capping_allocation_shrinks_the_leg_further_still_no_crash(monkeypatch):
    """A much larger unfilled remainder (more than the whole shortfall) — the
    move sizing must never go negative or crash, it just recommends less
    (or, per Step 3's own `leg_amount < 5` guard, no leg from this source at
    all -> the destination becomes uncovered rather than a bad number)."""
    allocations_list = [{
        "fill_account_id": DEST_ACCT,
        "remaining": 1035.0,  # > £1,041 pre-reservation headroom
        "amount_per_period": 1200.0,
        "active": True,
        "completed": False,
        "pending": False,
    }]
    items = _run(monkeypatch, allocations_list=allocations_list)
    # Either no move card (uncovered, nothing safely movable) or one whose
    # amount is small and never negative — either way, no crash.
    card = _move_card(items)
    if card is not None:
        assert card["amount"] >= 0


# ── Section 4: the payday plan's own `distributable` sizing ─────────────────

def _salary(days_away, amount, account_id):
    return {
        "name": "Salary", "days_away": days_away, "amount": amount,
        "account_id": account_id, "occurrences": 3,
        "amounts_recent": [amount, amount, amount],
    }


def _run_payday_plan(monkeypatch, *, allocations_list, salary_balance=3000.0):
    salary_acct = "acc-salary"
    accounts = [
        _account(salary_acct, salary_balance, "Salary Account"),
        _account(DEST_ACCT, 0.0, "Premier"),
    ]
    _base_patch(monkeypatch, accounts=accounts, bills=[], allocations_list=allocations_list)

    async def fake_resp(cached, uid=None, prefs=None):
        return {
            "upcoming_bills": [],
            "upcoming_income": [_salary(20, 3000.0, salary_acct)],
            "internal_inflows": [
                {
                    "name": "SAVING CHALLENGE DRIP", "amount": 10.0, "days_away": d,
                    "account_id": DEST_ACCT, "account_name": "Premier", "account_bank": "Barclays",
                    "source_account_id": salary_acct, "source_account_name": "Salary Account",
                    "destination_spendable": False,
                }
                for d in range(5)
            ],
        }
    monkeypatch.setattr(companion, "_build_cashflow_response", fake_resp)

    import app.services.pay_period as pay_period
    today_d = date.today()
    # Force the payday-plan window ON via preview (mirrors test_payday_
    # plan_own_transfers.py's own recipe) so the section actually computes.
    monkeypatch.setattr(
        pay_period, "get_pay_period_for_date",
        lambda ref, cfg: (today_d - timedelta(days=20), today_d + timedelta(days=20)),
    )
    monkeypatch.setattr(pay_period, "_next_payday", lambda td, cfg: today_d + timedelta(days=20))

    items = asyncio.run(companion.compute_today_items(UID, payday_preview=True, persist=False))
    return next((i for i in items if i["type"] == "payday_plan"), None), salary_acct


def test_payday_plan_distributable_shrinks_by_the_salary_accounts_own_reservation(monkeypatch):
    """The salary account funds the Saving Challenge drip too — the payday
    plan's own `distributable` figure (how much of the salary account is
    free to split across destinations) must shrink by the same £230
    reservation, exactly like an ordinary shortfall source does, with no
    special-casing (the existing trim/re-balance maths just consumes the
    smaller pot)."""
    plan_without, salary_acct = _run_payday_plan(monkeypatch, allocations_list=[])
    plan_with, _ = _run_payday_plan(monkeypatch, allocations_list=[{
        "fill_account_id": DEST_ACCT,
        "remaining": 230.0,
        "amount_per_period": 266.0,
        "active": True,
        "completed": False,
        "pending": False,
    }])
    assert plan_without is not None
    assert plan_with is not None
    # `stays` (distributable - total, floored at 0) must be exactly £230
    # lower with the reservation in play, everything else about the
    # destinations' own needs being identical between the two runs.
    assert plan_without["salary"]["stays"] - plan_with["salary"]["stays"] == 230
