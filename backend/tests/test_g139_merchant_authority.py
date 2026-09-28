"""G139: merchant-decision authority.

Two independent regressions, proven behaviourally against synthetic fixture
data (no real Mongo, no real user data — see conventions in
tests/test_transfer_pairs.py and tests/test_spend_performance_guards.py,
which this file's fake-Mongo plumbing follows):

  1. `categorisation.apply_rules_bulk`'s Pass 4 (merchant-level
     custom_category propagation onto auto-categorised rows) used to keep
     the FIRST override it saw per (canonical key, transaction_type), which
     is whatever order Mongo's `.find()` happens to return — no relationship
     to which correction the user actually made most recently. Proven
     empirically against Kevin's own Playtomic history: one row corrected to
     "Golf" in June sorted before six later rows corrected to "Padel"
     between late June and September, so the stale June decision won
     permanently. Fixed by sorting the override rows by their own
     transaction date, most recent first, before the first-seen-wins loop
     runs.

  2. `companion.py`'s rhythm checkpoint item printed the SAME period total
     twice in one card (`brief_lead.value` and `body`) whenever there was no
     single dominant transaction, because `brief_lead.companion` is just the
     static caption "so far this period" in that branch — identical number,
     identical caption, twice. Fixed by only including `body` when a
     dominant transaction exists (the branch where `brief_lead` and `body`
     genuinely say different things).

This file does NOT re-test companion.py's rhythm-item builder end to end
(that pulls in baseline caching, engaged-category consent gating and pay
period resolution that have nothing to do with G139) — instead it proves the
underlying FIGURE the rhythm card's `body`/`brief_lead` both draw from
(`pace.load_spend_txns`, the same helper `companion.py` imports as
`_load_spend_txns`) agrees with what `GET /transactions/search` returns for
the same period and category, the check the G139 item itself asked for.
"""
import asyncio
import re
from datetime import date, datetime

import pytest

import app.services.categorisation as categorisation
import app.services.pace as pace
import app.routers.transactions as transactions_router
from app.services.categories import CategoryKinds, BUILTIN_CATEGORY_KINDS


# ── Generic fake-Mongo plumbing ──────────────────────────────────────────────
# Same subset-matcher-plus-in-memory-collection convention as
# tests/test_transfer_pairs.py, extended with $and/$gte/$lte (needed by
# transactions.py's _search_query) and a chainable sort()/skip()/limit()
# cursor (needed by search_transactions' `.find().sort().limit().to_list()`
# call shape, same convention tests/test_spend_performance_guards.py uses).

def _match(doc: dict, query: dict) -> bool:
    for key, cond in query.items():
        if key == "$or":
            if not any(_match(doc, sub) for sub in cond):
                return False
            continue
        if key == "$and":
            if not all(_match(doc, sub) for sub in cond):
                return False
            continue
        val = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and val not in cond["$in"]:
                return False
            if "$nin" in cond and val in cond["$nin"]:
                return False
            if "$ne" in cond and val == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
            if "$gte" in cond and not (val is not None and val >= cond["$gte"]):
                return False
            if "$lte" in cond and not (val is not None and val <= cond["$lte"]):
                return False
            if "$regex" in cond:
                flags = re.IGNORECASE if "i" in (cond.get("$options") or "") else 0
                if not (isinstance(val, str) and re.search(cond["$regex"], val, flags)):
                    return False
        else:
            if val != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, field, direction=1):
        self._docs.sort(key=lambda d: d.get(field), reverse=(direction < 0))
        return self

    def skip(self, n):
        self._docs = self._docs[n:]
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    async def to_list(self, n=None):
        return list(self._docs) if n is None else list(self._docs[:n])

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _ModifiedResult:
    def __init__(self, n):
        self.modified_count = n


class FakeCol:
    """Stand-in for a Motor collection — docs are plain dicts mutated in
    place, so assertions after calling the real function under test can just
    re-inspect the same list."""

    name = "fake"

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if _match(d, query)])

    async def find_one(self, query=None, projection=None, sort=None):
        query = query or {}
        matches = [d for d in self.docs if _match(d, query)]
        if not matches:
            return None
        if sort:
            field, direction = sort[0]
            matches.sort(key=lambda d: d.get(field), reverse=(direction < 0))
        return matches[0]

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for d in self.docs if _match(d, query))

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                self._apply(d, update)
                return
        if upsert:
            new = dict(filt)
            self._apply(new, update)
            self.docs.append(new)

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


async def _fake_get_category_kinds(uid):
    return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))


UID = "g139-fixture@example.invalid"


def _t(id_, *, custom_category=None, category=None, date_, merchant="Playtomic",
       desc="PLAYTOMIC LONDON", ttype="debit", amount=20.0):
    return {
        "_id": id_, "user_id": UID, "transaction_type": ttype, "amount": amount,
        "date": date_, "account_id": "acc1", "merchant_name": merchant,
        "description": desc, "category": category, "custom_category": custom_category,
        "currency": "GBP",
    }


def _te(id_, *, transaction_id, ts, category=None, additional_ids=None, event_type="correction"):
    """A teaching_events_col row shaped exactly like
    `routers/transactions.py`'s writers (`update_transaction`'s "correction"
    event, or one of `resolve-movement`'s "movement_*" events) — see
    `categorisation.teaching_decision_times`."""
    payload = {}
    if category is not None:
        payload["category"] = category
    if additional_ids:
        payload["additional_ids"] = additional_ids
    return {
        "_id": id_, "user_id": UID, "type": event_type,
        "transaction_id": transaction_id, "merchant_key": None,
        "payload": payload, "created_at": ts,
    }


def _run_pass4(monkeypatch, txns, *, teaching_events=None):
    monkeypatch.setattr(categorisation, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(categorisation, "accounts_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_profiles_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "merchant_categories_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_rules_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "teaching_events_col", FakeCol(teaching_events or []))
    monkeypatch.setattr(categorisation, "get_category_kinds", _fake_get_category_kinds)
    asyncio.run(categorisation.apply_rules_bulk(UID, structural=False))


# ── Fix 1: recency, not first-match, wins ────────────────────────────────────

def test_pass4_latest_correction_wins_over_stale_first_match(monkeypatch):
    """Reproduces Kevin's own instance of the G139 shape: an old correction
    to one category (dated first, and — critically — ALSO listed FIRST in
    the fake collection so a test relying on insertion order rather than a
    recency sort would pass for the wrong reason) loses to newer corrections
    to a different category, for every still-uncorrected row of that
    merchant. A row the user separately, explicitly corrected to a THIRD
    category is never touched at all — the `custom_category: None`
    write-scoping guard Pass 4 (and every sibling propagation pass) relies
    on.

    No teaching events are supplied here, so this exercises the DATE
    fallback path specifically (the legacy/expired-event case
    `teaching_decision_times` documents) — Kevin's real corrections happened
    to correlate with transaction date, which is exactly why this test alone
    would have passed even under the purchase-date-only version of the fix.
    See `test_pass4_uses_decision_time_not_purchase_date_when_they_disagree`
    below for the case that version got wrong."""
    txns = [
        # Old correction — appears FIRST in the collection (the exact shape
        # that made the stale entry win under "first key seen wins"), but is
        # chronologically the OLDEST.
        _t("golf_old", custom_category="Golf", category="Health", date_=datetime(2026, 6, 11)),
        # Newer corrections to a different category — the user changing
        # their mind over the following months.
        _t("padel_1", custom_category="Padel", category="Health", date_=datetime(2026, 6, 26)),
        _t("padel_2", custom_category="Padel", category="Health", date_=datetime(2026, 9, 22)),
        # A deliberate, different, explicit choice on one specific row —
        # must never be overwritten by a merchant-level rule.
        _t("tennis_pick", custom_category="Tennis", category="Health", date_=datetime(2026, 5, 1)),
        # Still-uncorrected row of the same merchant, raw/uncategorised —
        # Pass 3's deterministic keyword rule stamps this "Health" first
        # (playtomic -> Health), then Pass 4 must override that stamp using
        # the MOST RECENT correction ("Padel"), not the oldest ("Golf").
        _t("target", custom_category=None, category=None, date_=datetime(2026, 9, 25)),
    ]
    _run_pass4(monkeypatch, txns)
    by_id = {t["_id"]: t for t in txns}

    assert by_id["target"]["category"] == "Padel", (
        "the most recent correction must win — got "
        f"{by_id['target']['category']!r}, expected 'Padel' (not the stale "
        "June 'Golf' correction)"
    )
    # The explicit per-row choice is untouched, both fields.
    assert by_id["tennis_pick"]["custom_category"] == "Tennis"
    assert by_id["tennis_pick"]["category"] == "Health"


def test_pass4_uses_decision_time_not_purchase_date_when_they_disagree(monkeypatch):
    """The actual CLASS of bug the G139 brief's correction called out:
    purchase-date recency and decision recency can point opposite ways. A
    row dated NEWER but corrected to "Golf" EARLIER must lose to a row dated
    OLDER but corrected to "Padel" LATER — the user going back and changing
    an old row's category after already having corrected a newer one. A
    pure `date`-sort gets this backwards (would rank the September-dated
    "Golf" row above the June-dated "Padel" row); `teaching_decision_times`
    must override that using each row's own correction timestamp."""
    txns = [
        # Purchased in September (newer), but corrected to "Golf" back in
        # June — an EARLY decision on a LATE transaction.
        _t("newer_txn_older_decision", custom_category="Golf", category="Health",
           date_=datetime(2026, 9, 1)),
        # Purchased in June (older), but corrected to "Padel" in September —
        # a LATE decision on an EARLY transaction. This is the user's most
        # recent intent and must win.
        _t("older_txn_newer_decision", custom_category="Padel", category="Health",
           date_=datetime(2026, 6, 1)),
        _t("target", custom_category=None, category=None, date_=datetime(2026, 9, 20)),
    ]
    teaching_events = [
        _te("ev1", transaction_id="newer_txn_older_decision",
            ts=datetime(2026, 6, 5), category="Golf"),
        _te("ev2", transaction_id="older_txn_newer_decision",
            ts=datetime(2026, 9, 15), category="Padel"),
    ]
    _run_pass4(monkeypatch, txns, teaching_events=teaching_events)
    by_id = {t["_id"]: t for t in txns}

    assert by_id["target"]["category"] == "Padel", (
        "decision time, not purchase date, must decide recency — got "
        f"{by_id['target']['category']!r}"
    )


def test_pass4_bulk_correction_companion_id_inherits_primarys_decision_time(monkeypatch):
    """A bulk correction (`additional_ids`) only logs ONE teaching event, on
    the primary id, with the companions listed inside
    `payload.additional_ids` — `teaching_decision_times` must fold those
    companions in too, not just the literal `transaction_id` field."""
    txns = [
        # Bulk-corrected together to "Padel" in one call — "bulk_companion"
        # has no event of its own, only "primary" does.
        _t("primary", custom_category="Padel", category="Health", date_=datetime(2026, 6, 1)),
        _t("bulk_companion", custom_category="Padel", category="Health", date_=datetime(2026, 6, 1)),
        # A later, single-row correction to "Golf" on a DIFFERENT row, dated
        # after the bulk pair but decided before it would be wrong to rank
        # ahead of it — this row's own event timestamp is EARLIER than the
        # bulk event, so it must lose despite an equal-or-later purchase
        # date, proving the companion id really did inherit the primary's
        # (later) decision time rather than falling back to its own `date`.
        _t("golf_single", custom_category="Golf", category="Health", date_=datetime(2026, 6, 2)),
        _t("target", custom_category=None, category=None, date_=datetime(2026, 9, 1)),
    ]
    teaching_events = [
        _te("ev_bulk", transaction_id="primary", ts=datetime(2026, 9, 10),
            category="Padel", additional_ids=["bulk_companion"]),
        _te("ev_golf", transaction_id="golf_single", ts=datetime(2026, 6, 3), category="Golf"),
    ]
    _run_pass4(monkeypatch, txns, teaching_events=teaching_events)
    by_id = {t["_id"]: t for t in txns}

    assert by_id["target"]["category"] == "Padel"


def test_pass4_leaves_row_with_different_explicit_custom_category_alone(monkeypatch):
    """Narrower, single-purpose companion to the test above: even with only
    ONE merchant-level override available (no ambiguity about recency at
    all), a row that already carries its own different custom_category is
    never rewritten. This is the "uncorrected" guard the G139 brief calls
    non-negotiable — scoped to `custom_category: None`, never "every row of
    that merchant"."""
    txns = [
        _t("padel_only", custom_category="Padel", category="Health", date_=datetime(2026, 9, 1)),
        _t("golf_pick", custom_category="Golf", category="Health", date_=datetime(2026, 8, 1)),
        _t("target", custom_category=None, category=None, date_=datetime(2026, 9, 10)),
    ]
    _run_pass4(monkeypatch, txns)
    by_id = {t["_id"]: t for t in txns}

    assert by_id["target"]["category"] == "Padel"
    assert by_id["golf_pick"]["custom_category"] == "Golf"
    assert by_id["golf_pick"]["category"] == "Health"


# ── Fix 1b: the same defect in /transactions/auto-categorise ────────────────
#
# routers/transactions.py's `auto_categorise` (POST /transactions/
# auto-categorise) builds its own `merchant_map` with the identical "first
# key seen wins" shape Pass 4 had, over a WIDER candidate pool: not just
# custom_category corrections, but any historical row whose AUTO `category`
# is already meaningful (not raw/None/Other). Same underlying bug class,
# same fix (sort by `teaching_decision_times`, falling back to `date`) —
# proven here with a case that has NO teaching events at all (neither row was
# ever an explicit correction, only a previously auto-categorised row), so
# this specifically exercises the `date`-fallback half of the shared fix,
# the realistic case for this endpoint's wider, correction-and-plain-auto
# mixed candidate pool.

def test_auto_categorise_merchant_map_uses_recency_not_first_match(monkeypatch):
    # A merchant name that doesn't collide with any deterministic keyword
    # rule (unlike "Playtomic" -> Health) — keeps Pass 3, which
    # `apply_rules_bulk(structural=True)` runs first inside this endpoint,
    # from stamping the target row before this endpoint's own merchant_map
    # logic gets a chance to.
    merchant = "Zentangle Studio"
    desc = merchant.upper()
    txns = [
        # Plain auto-categorised historical rows — never corrected (no
        # custom_category), which is exactly this endpoint's extra breadth
        # over Pass 4's candidate pool. Neither ever had a teaching event
        # (they were never a correction), so recency can only come from each
        # row's own transaction `date` here.
        _t("golf_old", custom_category=None, category="Golf",
           date_=datetime(2026, 6, 1), merchant=merchant, desc=desc),
        _t("padel_new", custom_category=None, category="Padel",
           date_=datetime(2026, 9, 22), merchant=merchant, desc=desc),
        # Still-uncategorised row of the same merchant.
        _t("target", custom_category=None, category="Other",
           date_=datetime(2026, 9, 25), merchant=merchant, desc=desc),
    ]
    fake_txns = FakeCol(txns)
    # apply_rules_bulk(structural=True) runs first inside auto_categorise —
    # same dependency set _run_pass4 patches, on the categorisation module
    # (where apply_rules_bulk and teaching_decision_times actually execute).
    monkeypatch.setattr(categorisation, "transactions_col", fake_txns)
    monkeypatch.setattr(categorisation, "accounts_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_profiles_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "merchant_categories_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "user_rules_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "confirmed_transfer_pairs_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "teaching_events_col", FakeCol([]))
    monkeypatch.setattr(categorisation, "get_category_kinds", _fake_get_category_kinds)
    # auto_categorise itself reads/writes transactions_col via its OWN
    # module-level binding (routers/transactions.py's own `from
    # app.db.collections import transactions_col, ...`) — same fake
    # instance, so a write from either module is visible to the other.
    monkeypatch.setattr(transactions_router, "transactions_col", fake_txns)

    asyncio.run(transactions_router.auto_categorise(user={"email": UID}))
    by_id = {t["_id"]: t for t in txns}

    assert by_id["target"]["category"] == "Padel", (
        "the most recently-dated historical row must win — got "
        f"{by_id['target']['category']!r}"
    )
    # Same custom_category: None write-scoping guard as Pass 4 — this
    # endpoint's writes are `category` only, never `custom_category`.
    assert by_id["golf_old"]["custom_category"] is None
    assert by_id["padel_new"]["custom_category"] is None
    assert by_id["target"]["custom_category"] is None


# ── Fix 2: the rhythm card's total agrees with /transactions/search ─────────

PERIOD_START = date(2026, 9, 1)
PERIOD_END = date(2026, 9, 30)


def _signed(doc: dict) -> float:
    amt = abs(float(doc["amount"]))
    return -amt if doc["transaction_type"] == "credit" else amt


def test_rhythm_card_category_total_matches_transactions_search(monkeypatch):
    """The rhythm checkpoint's per-category period total comes from
    `pace.load_spend_txns` (imported into companion.py as `_load_spend_txns`
    and summed by companion.py's own `_rc_cat_spent` loop — a two-line,
    unconditional sum over exactly the docs this helper returns). This test
    proves that figure agrees with what a user opening the same period and
    category via GET /transactions/search would see and add up themselves —
    the check the G139 item asked for."""
    txns = [
        # In period, Groceries.
        _t("g1", ttype="debit", amount=40.00, date_=datetime(2026, 9, 5),
           merchant="Tesco", desc="TESCO STORES", category="Groceries"),
        _t("g2", ttype="debit", amount=25.50, date_=datetime(2026, 9, 12),
           merchant="Tesco", desc="TESCO STORES", category="Groceries"),
        # A refund nets AGAINST the period total, both sides of the fence.
        _t("g3", ttype="credit", amount=5.00, date_=datetime(2026, 9, 20),
           merchant="Tesco", desc="TESCO STORES REFUND", category="Groceries"),
        # Out of period — must be excluded by both paths.
        _t("g_out", ttype="debit", amount=99.00, date_=datetime(2026, 8, 15),
           merchant="Tesco", desc="TESCO STORES", category="Groceries"),
        # In period, different category — must be excluded by both paths.
        _t("t1", ttype="debit", amount=12.00, date_=datetime(2026, 9, 8),
           merchant="TFL", desc="TFL TRAVEL", category="Transport"),
    ]
    monkeypatch.setattr(pace, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(pace, "yapily_transactions_col", FakeCol([]))

    kind_map = CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    spend_txns = asyncio.run(
        pace.load_spend_txns(UID, PERIOD_START, PERIOD_END, kind_map=kind_map)
    )
    # Exactly companion.py's `_rc_cat_spent` build loop (8g, "per-category
    # period totals").
    rhythm_total = 0.0
    for _t_row in spend_txns:
        if PERIOD_START <= _t_row["date"] <= PERIOD_END and _t_row["category"] == "Groceries":
            rhythm_total += _t_row["amount"]

    monkeypatch.setattr(transactions_router, "transactions_col", FakeCol(txns))
    monkeypatch.setattr(transactions_router, "yapily_transactions_col", FakeCol([]))
    monkeypatch.setattr(transactions_router, "statement_transactions_col", FakeCol([]))

    search_result = asyncio.run(transactions_router.search_transactions(
        category="Groceries",
        categories=None,
        date_from="2026-09-01",
        date_to="2026-09-30",
        page_size=100,
        user={"email": UID},
    ))
    search_total = sum(_signed(d.model_dump() if hasattr(d, "model_dump") else d)
                        for d in search_result["items"])

    assert search_total == pytest.approx(rhythm_total)
    assert rhythm_total == pytest.approx(60.50)
    assert len(search_result["items"]) == 3
