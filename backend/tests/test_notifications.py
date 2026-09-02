"""Unit tests for the money-movement merge (`_maybe_money_movement`, which
combines `_maybe_bill_shortfall` and `_maybe_move_recommendation`) and the
category-pace dedup (`_maybe_category_pace`).

No mongomock is available in this environment, so DB-touching collections are
replaced with tiny in-memory fakes and the lazily-imported dependencies
(`compute_today_items`, `_build_cashflow_response`, `compute_spend_verdict`,
`notif_pref`, `send_push_to_user`) are monkeypatched at their source module.
Each test drives the async functions directly via `asyncio.run`, matching how
the rest of this suite avoids a pytest-asyncio dependency by testing
sync/pure seams — here the seam is the notification function itself, called
from sync test bodies.
"""
import asyncio

import app.services.companion as companion
import app.routers.analytics as analytics
import app.services.spend_verdict as spend_verdict
import app.db.collections as collections
import app.services.notifications as notifications


class FakeStateCol:
    """Stand-in for `notification_state_col`: a single-collection, `_id`-keyed
    in-memory store supporting the subset of Mongo semantics the checks use
    (`find_one` by `_id`, `update_one` with a flat `$set` + upsert)."""

    def __init__(self, docs=None):
        self.docs = {k: dict(v) for k, v in (docs or {}).items()}

    async def find_one(self, query, *args, **kwargs):
        return self.docs.get(query.get("_id"))

    async def update_one(self, filt, update, upsert=False):
        _id = filt.get("_id")
        if _id not in self.docs:
            if not upsert:
                return
            self.docs[_id] = {"_id": _id}
        doc = self.docs[_id]
        # Real Mongo interprets a dotted $set key ("category_pace.2026-08-01")
        # as a nested-field write, not a literal top-level key — several
        # checks in notifications.py (budget_exceeded, bill_shortfall,
        # category_pace) rely on that. Mirror it here.
        for key, value in (update.get("$set") or {}).items():
            parts = key.split(".")
            d = doc
            for p in parts[:-1]:
                d = d.setdefault(p, {})
            d[parts[-1]] = value


class FakeCashflowCacheCol:
    async def find_one(self, query, *args, **kwargs):
        return {"_id": query.get("_id")}


class FakePreferencesCol:
    """Always "no prefs saved" -> callers fall back to their own defaults
    (calendar_month pay period, etc). Avoids touching the real Motor client,
    which binds to whichever event loop first used it — a problem once more
    than one test in this file calls `asyncio.run()` (each run gets a fresh
    loop, and the real client would raise "Event loop is closed" on the
    second one)."""

    async def find_one(self, query, *args, **kwargs):
        return None


def _mongo_matches(doc: dict, query: dict) -> bool:
    """Tiny subset-of-Mongo query matcher — just enough to exercise the real
    `_category_clause` ($or / $in) against fake in-memory documents, so the
    classification-attention tests drive the ACTUAL clause rather than a
    hand-rolled stand-in for it."""
    for key, cond in query.items():
        if key == "$or":
            if not any(_mongo_matches(doc, sub) for sub in cond):
                return False
        elif isinstance(cond, dict) and "$in" in cond:
            if doc.get(key) not in cond["$in"]:
                return False
        else:
            if doc.get(key) != cond:
                return False
    return True


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class FakeTxnCol:
    """Stand-in for `transactions_col`/`yapily_transactions_col`: enough of
    Motor's `.find()` (sync call returning an async-iterable cursor) to drive
    `_current_classification_flags`'s query against real documents."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.find_calls = 0

    def find(self, query, *args, **kwargs):
        self.find_calls += 1
        return _FakeCursor([d for d in self.docs if _mongo_matches(d, query)])


def _txn(txn_id, category=None, custom_category=None, transaction_type="debit"):
    return {
        "_id": txn_id, "user_id": "kevin", "transaction_type": transaction_type,
        "category": category, "custom_category": custom_category,
    }


def _move_item(item_id, amount=110, account_id="acc-natwest", name="THE NUMBER ONE"):
    return {
        "id": item_id,
        "type": "move",
        "headline": f"Move £{amount:,} to {name}",
        "body": "…",
        "amount": amount,
        "plan_dest": {"account_id": account_id, "name": name},
    }


def _bill(name, days_away, amount, account_balance, account_id):
    return {
        "name": name,
        "days_away": days_away,
        "amount": amount,
        "account_balance": account_balance,
        "account_id": account_id,
        "account_bank": account_id,
    }


def _patch_common(monkeypatch, *, pref_on=True, state_docs=None):
    state = FakeStateCol(state_docs)
    monkeypatch.setattr(notifications, "notification_state_col", state)
    monkeypatch.setattr(notifications, "preferences_col", FakePreferencesCol())
    monkeypatch.setattr(notifications, "notif_pref", _const_pref(pref_on))
    sent = []

    async def fake_send(user_id, title, body, url="/"):
        sent.append({"user_id": user_id, "title": title, "body": body, "url": url})
        return {}

    monkeypatch.setattr(notifications, "send_push_to_user", fake_send)
    return state, sent


def _const_pref(value):
    async def _pref(user_id, key):
        return value
    return _pref


# ── _maybe_move_recommendation / _maybe_bill_shortfall: detection + dedup,
# no send (send moved to _maybe_money_movement) ─────────────────────────────

def test_new_move_recommendation_detected_not_sent(monkeypatch):
    state, sent = _patch_common(monkeypatch, state_docs={})
    item = _move_item("plan:2026-09-01:fp1")

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts, new_moves = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert sent == []  # detection only, this function never sends anymore
    assert dest_accts == {"acc-natwest"}
    assert [m["id"] for m in new_moves] == ["plan:2026-09-01:fp1"]
    assert state.docs["kevin"]["move_recommended"] == ["plan:2026-09-01:fp1"]


def test_unchanged_recommendation_not_renotified_on_second_sync(monkeypatch):
    item_id = "plan:2026-09-01:fp1"
    state, sent = _patch_common(monkeypatch, state_docs={"kevin": {"move_recommended": [item_id]}})
    item = _move_item(item_id)

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts, new_moves = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert sent == []
    assert dest_accts == {"acc-natwest"}
    assert new_moves == []  # already active last sync, so not "new" this sync
    assert state.docs["kevin"]["move_recommended"] == [item_id]


def test_materially_changed_recommendation_is_new_again(monkeypatch):
    old_id = "plan:2026-09-01:fp1"
    new_id = "plan:2026-09-01:fp2"  # amount moved, fingerprint changed
    state, sent = _patch_common(monkeypatch, state_docs={"kevin": {"move_recommended": [old_id]}})
    item = _move_item(new_id, amount=150)

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts, new_moves = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert [m["id"] for m in new_moves] == [new_id]
    # State is replaced wholesale with what's currently active — the old,
    # no-longer-emitted id is pruned automatically, not accumulated.
    assert state.docs["kevin"]["move_recommended"] == [new_id]


def test_preference_off_suppresses_detection(monkeypatch):
    state, sent = _patch_common(monkeypatch, pref_on=False, state_docs={})
    called = {"n": 0}

    async def fake_items(uid):
        called["n"] += 1
        return [_move_item("plan:2026-09-01:fp1")]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts, new_moves = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert dest_accts == set()
    assert new_moves == []
    # Pref is checked before the (heavier) recompute — no wasted work either.
    assert called["n"] == 0


def test_bill_shortfall_suppressed_for_account_with_active_move(monkeypatch):
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    bills = [
        _bill("THE NUMBER ONE overdraft fee", 3, 95.90, 0.0, "acc-natwest"),
        _bill("Council Tax", 2, 50.0, 10.0, "acc-other"),
    ]

    async def fake_resp(cached):
        return {"upcoming_bills": bills}

    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    # Same account as the live move recommendation ("acc-natwest") is covered;
    # "acc-other" is not, so its bill must still qualify normally.
    new_bills = asyncio.run(notifications._maybe_bill_shortfall("kevin", "UK", {"acc-natwest"}))

    assert sent == []  # detection only
    assert [b["name"] for b in new_bills] == ["Council Tax"]
    assert "Council Tax" in new_bills[0]["body"]


# ── _maybe_money_movement: the merge/send layer ──────────────────────────────

def test_money_movement_merges_when_both_fire(monkeypatch):
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    bill = _bill("Council Tax", 2, 50.0, 10.0, "acc-other")

    async def fake_items(uid):
        return [_move_item("plan:2026-09-01:fp1", amount=110, account_id="acc-natwest")]

    async def fake_resp(cached):
        return {"upcoming_bills": [bill]}

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert len(sent) == 1  # ONE merged push, not two
    assert sent[0]["title"] == "Bill may not clear"
    assert "Council Tax" in sent[0]["body"]
    assert "£110" in sent[0]["body"] and "THE NUMBER ONE" in sent[0]["body"]
    assert sent[0]["url"] == "/"


def test_money_movement_sends_bill_alone_when_only_bill_fires(monkeypatch):
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    bill = _bill("Council Tax", 2, 50.0, 10.0, "acc-other")

    async def fake_items(uid):
        return []  # no move recommendation this sync

    async def fake_resp(cached):
        return {"upcoming_bills": [bill]}

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Bill may not clear"
    assert sent[0]["url"] == "/"


def test_money_movement_sends_move_alone_when_only_move_fires(monkeypatch):
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    async def fake_items(uid):
        return [_move_item("plan:2026-09-01:fp1", amount=110, account_id="acc-natwest")]

    async def fake_resp(cached):
        return {"upcoming_bills": []}  # no bills at risk

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Move £110 to THE NUMBER ONE"
    assert sent[0]["url"] == "/"


def test_money_movement_sends_nothing_when_neither_fires(monkeypatch):
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    async def fake_items(uid):
        return []

    async def fake_resp(cached):
        return {"upcoming_bills": []}

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert sent == []


def test_money_movement_two_bills_one_move_sends_every_event(monkeypatch):
    """Regression for the swallow bug: with two new bills and one new move,
    the merge must only consume the FIRST bill + the move — the second bill
    is not allowed to vanish just because its dedup state was already
    written by the detector before this ran."""
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    bills = [
        _bill("Council Tax", 2, 50.0, 10.0, "acc-other"),
        _bill("Broadband", 4, 30.0, 5.0, "acc-third"),
    ]

    async def fake_items(uid):
        return [_move_item("plan:2026-09-01:fp1", amount=110, account_id="acc-natwest")]

    async def fake_resp(cached):
        return {"upcoming_bills": bills}

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert len(sent) == 2  # merged (Council Tax + move) + standalone Broadband
    assert sent[0]["title"] == "Bill may not clear"
    assert "Council Tax" in sent[0]["body"] and "£110" in sent[0]["body"]
    assert sent[0]["url"] == "/"
    assert sent[1]["title"] == "Bill may not clear"
    assert "Broadband" in sent[1]["body"]
    assert sent[1]["url"] == "/"


def test_money_movement_one_bill_two_moves_sends_every_event(monkeypatch):
    """Same regression, mirrored: two new moves + one new bill must produce
    the merged push plus a standalone push for the second move — never a
    silently dropped move."""
    _state_col, sent = _patch_common(monkeypatch, state_docs={})
    monkeypatch.setattr(collections, "cashflow_cache_col", FakeCashflowCacheCol())

    bill = _bill("Council Tax", 2, 50.0, 10.0, "acc-other")
    moves = [
        _move_item("plan:2026-09-01:fp1", amount=110, account_id="acc-natwest", name="THE NUMBER ONE"),
        _move_item("plan:2026-09-01:fp2", amount=60, account_id="acc-isa", name="ISA"),
    ]

    async def fake_items(uid):
        return moves

    async def fake_resp(cached):
        return {"upcoming_bills": [bill]}

    monkeypatch.setattr(companion, "compute_today_items", fake_items)
    monkeypatch.setattr(analytics, "_build_cashflow_response", fake_resp)

    asyncio.run(notifications._maybe_money_movement("kevin", "UK"))

    assert len(sent) == 2  # merged (Council Tax + first move) + standalone second move
    assert sent[0]["title"] == "Bill may not clear"
    assert "£110" in sent[0]["body"] and "THE NUMBER ONE" in sent[0]["body"]
    assert sent[0]["url"] == "/"
    assert sent[1]["title"] == "Move £60 to ISA"
    assert sent[1]["url"] == "/"


# ── _maybe_category_pace: one push per category per pay period ──────────────

def _notable(category, multiple=2.0, excess=80.0):
    return {"category": category, "multiple": multiple, "excess": excess}


def _verdict(notables, period_start="2026-08-01", days_elapsed=22):
    return {
        "notables": notables,
        "period": {"start": period_start, "days_elapsed": days_elapsed},
    }


def test_category_pace_pushes_once_then_dedupes_same_period(monkeypatch):
    state, sent = _patch_common(monkeypatch, state_docs={})

    async def fake_verdict(uid):
        return _verdict([_notable("Entertainment", multiple=2.0, excess=80.0)])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", fake_verdict)

    asyncio.run(notifications._maybe_category_pace("kevin", "UK"))
    assert len(sent) == 1
    assert sent[0]["title"] == "Entertainment is running hot"
    assert "twice your usual pace for day 22" in sent[0]["body"]
    assert sent[0]["url"] == "/spend"

    # Same category, same period, second sync — must not renotify.
    asyncio.run(notifications._maybe_category_pace("kevin", "UK"))
    assert len(sent) == 1


def test_category_pace_new_category_same_period_notifies_again(monkeypatch):
    state, sent = _patch_common(
        monkeypatch, state_docs={"kevin": {"category_pace": {"2026-08-01": ["Entertainment"]}}},
    )

    async def fake_verdict(uid):
        return _verdict([
            _notable("Entertainment", multiple=2.0, excess=80.0),
            _notable("Groceries", multiple=1.6, excess=45.0),
        ])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", fake_verdict)

    asyncio.run(notifications._maybe_category_pace("kevin", "UK"))

    assert len(sent) == 1  # Entertainment already flagged; only Groceries is new
    assert sent[0]["title"] == "Groceries is running hot"
    assert set(state.docs["kevin"]["category_pace"]["2026-08-01"]) == {"Entertainment", "Groceries"}


def test_category_pace_preference_off_suppresses(monkeypatch):
    _state, sent = _patch_common(monkeypatch, pref_on=False, state_docs={})
    called = {"n": 0}

    async def fake_verdict(uid):
        called["n"] += 1
        return _verdict([_notable("Entertainment")])

    monkeypatch.setattr(spend_verdict, "compute_spend_verdict", fake_verdict)

    asyncio.run(notifications._maybe_category_pace("kevin", "UK"))

    assert sent == []
    assert called["n"] == 0


# ── _maybe_classification_attention: unplaced + miscategorised, dedup on id ─

def _patch_classification(monkeypatch, *, txns=None, yapily_txns=None, flagged=None,
                           pairs=None, pref_on=True, state_docs=None):
    state, sent = _patch_common(monkeypatch, pref_on=pref_on, state_docs=state_docs)
    txn_col = FakeTxnCol(txns)
    yapily_col = FakeTxnCol(yapily_txns)
    monkeypatch.setattr(notifications, "transactions_col", txn_col)
    monkeypatch.setattr(notifications, "yapily_transactions_col", yapily_col)

    async def fake_flagged(uid):
        return flagged or []

    monkeypatch.setattr(analytics, "_flagged_miscategorised", fake_flagged)

    async def fake_pairs(uid):
        return pairs if pairs is not None else []

    monkeypatch.setattr(analytics, "_transfer_pair_suggestions", fake_pairs)
    return state, sent, txn_col, yapily_col


def test_classification_attention_first_run_seeds_silently(monkeypatch):
    txns = [_txn("t1", category=None, custom_category=None)]  # unplaced
    state, sent, *_ = _patch_classification(monkeypatch, txns=txns, state_docs={})

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert sent == []  # backlog at rollout must never blast a push
    assert state.docs["kevin"]["classification_seen"] == ["t1"]


def test_classification_attention_new_unplaced_after_seeding_notifies(monkeypatch):
    baseline = [_txn("t1", category="Other")]
    state, sent, txn_col, _ = _patch_classification(
        monkeypatch, txns=baseline, state_docs={"kevin": {"classification_seen": ["t1"]}},
    )

    # A brand new unplaced debit lands after the baseline was seeded.
    txn_col.docs.append(_txn("t2", category=None, custom_category=None))

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Some payments need a look"
    assert sent[0]["body"] == "1 payment I could not place"
    assert sent[0]["url"] == "/spend"
    assert set(state.docs["kevin"]["classification_seen"]) == {"t1", "t2"}

    # Re-running with no further change must not renotify (dedup on id).
    asyncio.run(notifications._maybe_classification_attention("kevin"))
    assert len(sent) == 1


def test_classification_attention_unplaced_query_treats_empty_string_as_other(monkeypatch):
    """SHOULD-FIX regression: category="" (and custom_category="") must count
    as unplaced, matching `transactions.py`'s own `_category_clause("Other")`
    — this is the exact clause reused, not a hand-rolled copy."""
    txns = [_txn("t1", category="", custom_category=None)]
    state, sent, *_ = _patch_classification(monkeypatch, txns=txns, state_docs={})

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    # First run only seeds — but seeding must have picked t1 up as unplaced,
    # proving the "" case matched the query at all.
    assert state.docs["kevin"]["classification_seen"] == ["t1"]


def test_classification_attention_guardrail_flagged_item(monkeypatch):
    state, sent, *_ = _patch_classification(monkeypatch, txns=[], flagged=[], state_docs={})
    asyncio.run(notifications._maybe_classification_attention("kevin"))
    assert sent == []  # seeded with nothing flagged

    # Re-patch with the same state but a newly flagged miscategorised item.
    async def fake_flagged(uid):
        return [{"_id": "m1"}]

    monkeypatch.setattr(analytics, "_flagged_miscategorised", fake_flagged)

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Some payments need a look"
    assert sent[0]["body"] == "1 may be miscategorised"
    assert "m1" in state.docs["kevin"]["classification_seen"]

    # Dedup: same flagged id again on the next sync must not renotify.
    asyncio.run(notifications._maybe_classification_attention("kevin"))
    assert len(sent) == 1


def test_classification_attention_combined_counts_wording(monkeypatch):
    state, sent, *_ = _patch_classification(monkeypatch, txns=[], flagged=[], state_docs={})
    asyncio.run(notifications._maybe_classification_attention("kevin"))
    assert sent == []

    txns = [
        _txn("t1", category=None, custom_category=None),
        _txn("t2", category="Other", custom_category=None),
    ]
    monkeypatch.setattr(notifications, "transactions_col", FakeTxnCol(txns))

    async def fake_flagged(uid):
        return [{"_id": "m1"}]

    monkeypatch.setattr(analytics, "_flagged_miscategorised", fake_flagged)

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["body"] == "2 payments I could not place and 1 may be miscategorised"


# ── _maybe_classification_attention: transfer-pair suggestions, separately
# keyed dedup (`classification_pairs_seen` — a different id-space from the
# transaction ids `classification_seen` tracks) ─────────────────────────────

def _pair(id_a, id_b):
    return {"pair_key": ":".join(sorted([id_a, id_b]))}


def test_classification_attention_pairs_first_run_seeds_silently(monkeypatch):
    """Rollout backlog (owner currently has ~10 live suggestions) must never
    blast a push for history — only pairs newly appearing after this
    baseline should notify."""
    pairs = [_pair("c1", "d1"), _pair("c2", "d2")]
    state, sent, *_ = _patch_classification(
        monkeypatch, txns=[], flagged=[], pairs=pairs, state_docs={},
    )

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert sent == []
    assert set(state.docs["kevin"]["classification_pairs_seen"]) == {p["pair_key"] for p in pairs}


def test_classification_attention_new_pair_after_baseline_notifies(monkeypatch):
    baseline_pair = _pair("c1", "d1")
    state, sent, *_ = _patch_classification(
        monkeypatch, txns=[], flagged=[], pairs=[baseline_pair],
        state_docs={"kevin": {
            "classification_seen": [],
            "classification_pairs_seen": [baseline_pair["pair_key"]],
        }},
    )

    new_pair = _pair("c2", "d2")

    async def fake_pairs(uid):
        return [baseline_pair, new_pair]

    monkeypatch.setattr(analytics, "_transfer_pair_suggestions", fake_pairs)

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Some payments need a look"
    assert sent[0]["body"] == "1 possible transfer to confirm"
    assert sent[0]["url"] == "/spend"
    assert set(state.docs["kevin"]["classification_pairs_seen"]) == {
        baseline_pair["pair_key"], new_pair["pair_key"],
    }

    # Re-running with no further change must not renotify (dedup on pair_key).
    asyncio.run(notifications._maybe_classification_attention("kevin"))
    assert len(sent) == 1


def test_classification_attention_pair_already_seen_does_not_renotify(monkeypatch):
    """Once notified (or already present at baseline), a pair_key stays
    seen forever — including after the user dismisses or confirms it, since
    the sheet itself stops returning it either way."""
    pair = _pair("c1", "d1")
    state, sent, *_ = _patch_classification(
        monkeypatch, txns=[], flagged=[], pairs=[pair],
        state_docs={"kevin": {
            "classification_seen": [],
            "classification_pairs_seen": [pair["pair_key"]],
        }},
    )

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert sent == []


def test_classification_attention_pairs_plus_unplaced_combined_body(monkeypatch):
    txns = [_txn("t1", category=None, custom_category=None)]
    pair = _pair("c1", "d1")
    state, sent, *_ = _patch_classification(
        monkeypatch, txns=txns, flagged=[], pairs=[pair],
        state_docs={"kevin": {"classification_seen": [], "classification_pairs_seen": []}},
    )

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["body"] == "1 payment I could not place and 1 possible transfer to confirm"


def test_classification_attention_pair_compute_failure_degrades_to_two_part(monkeypatch):
    """A broken `_transfer_pair_suggestions` call must not take down the
    existing unplaced/miscategorised push — it degrades to the original
    two-part behaviour and leaves the pairs baseline untouched (so the next
    successful run still seeds it fresh, not silently, once it recovers)."""
    txns = [_txn("t1", category=None, custom_category=None)]
    state, sent, *_ = _patch_classification(
        monkeypatch, txns=txns, flagged=[],
        state_docs={"kevin": {"classification_seen": []}},
    )

    async def fake_pairs_boom(uid):
        raise RuntimeError("boom")

    monkeypatch.setattr(analytics, "_transfer_pair_suggestions", fake_pairs_boom)

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert len(sent) == 1
    assert sent[0]["body"] == "1 payment I could not place"
    assert "classification_pairs_seen" not in state.docs["kevin"]


def test_classification_attention_preference_off_does_no_query_work(monkeypatch):
    called = {"n": 0}

    async def fake_flags(uid):
        called["n"] += 1
        return set(), set()

    _state, sent, *_ = _patch_classification(monkeypatch, txns=[], pref_on=False, state_docs={})
    monkeypatch.setattr(notifications, "_current_classification_flags", fake_flags)

    asyncio.run(notifications._maybe_classification_attention("kevin"))

    assert sent == []
    assert called["n"] == 0


# ── Budget-ceiling retirement (2026-08-30, owner decision, option C) ────────
# The budgets_col-backed "budget_alerts" notifier (_maybe_budget_exceeded) was
# removed, along with the budgets_col read that used to open the pay-period
# digest ("Last period: £X of £Y budgeted"). These two tests guard the
# retirement: the catalogue no longer advertises the dead toggle, and the
# digest still sends a clean goals-only summary with no budgets_col access.

def test_notification_catalogue_no_longer_offers_budget_alerts():
    assert "budget_alerts" not in notifications.NOTIF_DEFAULTS
    assert not hasattr(notifications, "_maybe_budget_exceeded")
    assert not hasattr(notifications, "budgets_col")


def test_period_digest_has_no_budget_clause_and_reuses_goals(monkeypatch):
    import app.routers.goals as goals_module
    from datetime import date as _date

    state, sent = _patch_common(monkeypatch, state_docs={})
    today = _date.today()

    def fake_pay_period(d, cfg):
        return today, today  # force "start == today" -> period boundary

    monkeypatch.setattr(notifications, "get_pay_period_for_date", fake_pay_period)

    async def fake_goals_summary(uid, region):
        return [{"pillar": "debt", "label": "Debt-free", "detail": "£500 to go", "pct": 80}]

    monkeypatch.setattr(goals_module, "goals_summary", fake_goals_summary)

    class FakeNeedleHistoryCol:
        async def find_one(self, query, *a, **k):
            return {"pushed": True}  # already pushed -> skip compute_needle entirely

    monkeypatch.setattr(collections, "needle_history_col", FakeNeedleHistoryCol())

    asyncio.run(notifications.send_period_digest("kevin"))

    assert len(sent) == 1
    assert "budgeted" not in sent[0]["body"]
    assert "Debt-free" in sent[0]["body"]
