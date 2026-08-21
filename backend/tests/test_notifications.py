"""Unit tests for the "Move £X to <account>" push (`_maybe_move_recommendation`)
and its double-notify interaction with `_maybe_bill_shortfall`.

No mongomock is available in this environment, so DB-touching collections are
replaced with tiny in-memory fakes and the lazily-imported dependencies
(`compute_today_items`, `_build_cashflow_response`, `notif_pref`,
`send_push_to_user`) are monkeypatched at their source module. Each test
drives the async functions directly via `asyncio.run`, matching how the rest
of this suite avoids a pytest-asyncio dependency by testing sync/pure seams
— here the seam is the notification function itself, called from sync test
bodies.
"""
import asyncio

import app.services.companion as companion
import app.routers.analytics as analytics
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
        self.docs[_id].update(update.get("$set") or {})


class FakeCashflowCacheCol:
    async def find_one(self, query, *args, **kwargs):
        return {"_id": query.get("_id")}


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


def test_new_move_recommendation_notifies(monkeypatch):
    state, sent = _patch_common(monkeypatch, state_docs={})
    item = _move_item("plan:2026-09-01:fp1")

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Move £110 to THE NUMBER ONE"
    assert "£" in sent[0]["body"] or "Covers" in sent[0]["body"]
    assert sent[0]["url"] == "/penny"
    assert dest_accts == {"acc-natwest"}
    assert state.docs["kevin"]["move_recommended"] == ["plan:2026-09-01:fp1"]


def test_unchanged_recommendation_does_not_renotify_on_second_sync(monkeypatch):
    item_id = "plan:2026-09-01:fp1"
    state, sent = _patch_common(monkeypatch, state_docs={"kevin": {"move_recommended": [item_id]}})
    item = _move_item(item_id)

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert sent == []
    assert dest_accts == {"acc-natwest"}
    assert state.docs["kevin"]["move_recommended"] == [item_id]


def test_materially_changed_recommendation_renotifies(monkeypatch):
    old_id = "plan:2026-09-01:fp1"
    new_id = "plan:2026-09-01:fp2"  # amount moved, fingerprint changed
    state, sent = _patch_common(monkeypatch, state_docs={"kevin": {"move_recommended": [old_id]}})
    item = _move_item(new_id, amount=150)

    async def fake_items(uid):
        return [item]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert len(sent) == 1
    assert sent[0]["title"] == "Move £150 to THE NUMBER ONE"
    # State is replaced wholesale with what's currently active — the old,
    # no-longer-emitted id is pruned automatically, not accumulated.
    assert state.docs["kevin"]["move_recommended"] == [new_id]


def test_preference_off_suppresses_push(monkeypatch):
    state, sent = _patch_common(monkeypatch, pref_on=False, state_docs={})
    called = {"n": 0}

    async def fake_items(uid):
        called["n"] += 1
        return [_move_item("plan:2026-09-01:fp1")]

    monkeypatch.setattr(companion, "compute_today_items", fake_items)

    dest_accts = asyncio.run(notifications._maybe_move_recommendation("kevin"))

    assert sent == []
    assert dest_accts == set()
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
    # "acc-other" is not, so its bill must still push normally.
    asyncio.run(notifications._maybe_bill_shortfall("kevin", "UK", {"acc-natwest"}))

    assert len(sent) == 1
    assert sent[0]["title"] == "Bill may not clear"
    assert "Council Tax" in sent[0]["body"]
    assert "THE NUMBER ONE" not in sent[0]["body"]
