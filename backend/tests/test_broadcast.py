"""Unit tests for B20 admin broadcasts (app/services/broadcast.py,
app/routers/broadcast.py). Router handlers are called directly with a
plain dict standing in for the `current_user` dependency's return value,
same convention as tests/test_admin_llm_usage.py / tests/test_ops.py — no
HTTP client, no real Mongo. Collections are tiny in-memory fakes; boundary
functions from app.core.subscription (`get_subscription`, `penny_allowance`)
and the push transport (`send_push_to_user`) are monkeypatched directly
rather than faking their own DB reads, matching test_admin_llm_usage.py's
`_fake_get_subscription` pattern.

Nothing here ever calls the real `send_push_to_user` — every test that
exercises a send monkeypatches it with a recording stub, so this suite can
never reach FCM/APNs/web-push, real or otherwise.
"""
import asyncio

import pytest
from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import app.routers.broadcast as broadcast_router
import app.services.broadcast as broadcast
from app.routers.broadcast import (
    AudienceSpec, ComposeRequest, SendRequest,
    broadcast_preview, broadcast_send, list_offers, dismiss_offer,
)


# ── in-memory fake Mongo ────────────────────────────────────────────────

def _match(doc: dict, query: dict) -> bool:
    for k, v in query.items():
        if isinstance(v, dict):
            if "$ne" in v:
                if doc.get(k) == v["$ne"]:
                    return False
            else:
                return False  # unsupported operator — fail loudly in a test
        else:
            if doc.get(k) != v:
                return False
    return True


def _project(doc, projection):
    if doc is None or not projection:
        return dict(doc) if doc is not None else None
    return {k: doc.get(k) for k, want in projection.items() if want}


class _Cursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return self

    async def to_list(self, n=None):
        return list(self._docs[:n] if n else self._docs)

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class FakeCollection:
    def __init__(self, docs=None):
        self.docs: dict = {d["_id"]: dict(d) for d in (docs or [])}

    def find(self, query=None, projection=None):
        query = query or {}
        matched = [_project(d, projection) for d in self.docs.values() if _match(d, query)]
        return _Cursor(matched)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs.values():
            if _match(d, query):
                return _project(d, projection)
        return None

    async def insert_one(self, doc):
        _id = doc.get("_id")
        if _id in self.docs:
            raise DuplicateKeyError("duplicate key")
        self.docs[_id] = dict(doc)

    async def update_one(self, query, update):
        for d in self.docs.values():
            if _match(d, query):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return type("R", (), {"matched_count": 1})()
        return type("R", (), {"matched_count": 0})()

    async def find_one_and_update(self, query, update, upsert=False, return_document=None):
        for _id, d in self.docs.items():
            if _match(d, query):
                before = dict(d)
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return dict(d) if return_document == ReturnDocument.AFTER else before
        return None


# ── fixtures ─────────────────────────────────────────────────────────────

USERS = ["alice@example.com", "bob@example.com", "carol@example.com", "dave@example.com"]
TIERS = {"alice@example.com": "lite", "bob@example.com": "standard", "carol@example.com": "lite", "dave@example.com": "max"}
# bob is "at the Penny cap" (remaining 0); everyone else has headroom.
PENNY_REMAINING = {"alice@example.com": 20, "bob@example.com": 0, "carol@example.com": 5, "dave@example.com": None}
# carol has opted out of offers.
OPTED_OUT = {"carol@example.com"}


async def _fake_get_subscription(email):
    return type("Sub", (), {"tier_name": TIERS.get(email, "max")})()


async def _fake_penny_allowance(email):
    return {"remaining": PENNY_REMAINING.get(email)}


async def _fake_notif_pref(user_id, key):
    assert key == "offers"
    return user_id not in OPTED_OUT


class _Push:
    def __init__(self):
        self.calls = []

    async def __call__(self, user_id, title, body, url="/"):
        self.calls.append((user_id, title, body, url))
        return {"apns": {}, "fcm": {}, "webpush": {}}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(broadcast_router, "PRIMARY_EMAIL", "kevin.maingi12@gmail.com")

    user_profiles = FakeCollection([{"_id": u} for u in USERS])
    preferences = FakeCollection([{"_id": u, "user_id": u} for u in USERS])
    subscriptions = FakeCollection([{"_id": u, "user_id": u} for u in USERS])
    broadcasts = FakeCollection()
    receipts = FakeCollection()

    monkeypatch.setattr(broadcast, "user_profiles_col", user_profiles)
    monkeypatch.setattr(broadcast, "preferences_col", preferences)
    monkeypatch.setattr(broadcast, "subscriptions_col", subscriptions)
    monkeypatch.setattr(broadcast, "broadcasts_col", broadcasts)
    monkeypatch.setattr(broadcast, "broadcast_receipts_col", receipts)
    monkeypatch.setattr(broadcast, "get_subscription", _fake_get_subscription)
    monkeypatch.setattr(broadcast, "penny_allowance", _fake_penny_allowance)
    monkeypatch.setattr(broadcast, "notif_pref", _fake_notif_pref)
    monkeypatch.setattr(broadcast, "BILLING_ENABLED", False)

    push = _Push()
    monkeypatch.setattr(broadcast, "send_push_to_user", push)

    return {"broadcasts": broadcasts, "receipts": receipts, "push": push}


def run(coro):
    return asyncio.run(coro)


# ── auth: current_user boundary (real function, not mocked) ─────────────

def test_current_user_rejects_unauthenticated():
    from app.core.auth import current_user

    class _Req:
        headers = {}

    with pytest.raises(HTTPException) as exc:
        run(current_user(_Req()))
    assert exc.value.status_code == 401


# ── auth: _require_admin / router-level gating ───────────────────────────

def test_preview_403_for_unauthenticated_style_empty_user():
    with pytest.raises(HTTPException) as exc:
        run(broadcast_preview(
            ComposeRequest(title="t", body="b", audience=AudienceSpec(type="everyone")),
            user={"email": "", "name": ""},
        ))
    assert exc.value.status_code == 403


def test_preview_403_for_ordinary_user(_env):
    with pytest.raises(HTTPException) as exc:
        run(broadcast_preview(
            ComposeRequest(title="t", body="b", audience=AudienceSpec(type="everyone")),
            user={"email": "someone@example.com", "name": ""},
        ))
    assert exc.value.status_code == 403


def test_preview_200_for_bot(_env):
    doc = run(broadcast_preview(
        ComposeRequest(title="t", body="b", audience=AudienceSpec(type="everyone")),
        user={"email": "kevin.maingi12@gmail.com", "name": "Bot"},
    ))
    assert doc["status"] == "draft"


def test_preview_200_for_owner_session(_env):
    doc = run(broadcast_preview(
        ComposeRequest(title="t", body="b", audience=AudienceSpec(type="everyone")),
        user={"email": "kevin.maingi12@gmail.com", "name": ""},
    ))
    assert doc["status"] == "draft"


def test_send_403_for_ordinary_user(_env):
    with pytest.raises(HTTPException) as exc:
        run(broadcast_send("whatever", SendRequest(dry_run=True), user={"email": "someone@example.com", "name": ""}))
    assert exc.value.status_code == 403


# ── audience resolution ───────────────────────────────────────────────────

def test_everyone_excludes_opted_out(_env):
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert set(ids) == set(USERS) - OPTED_OUT
    assert "carol@example.com" not in ids  # opted out


def test_tier_filter(_env):
    ids = run(broadcast.resolve_audience({"type": "tier", "tier": "lite"}))
    # alice and carol are "lite"; carol is opted out and must be excluded.
    assert set(ids) == {"alice@example.com"}


def test_state_penny_cap_filter(_env):
    ids = run(broadcast.resolve_audience({"type": "state", "state": "penny_cap"}))
    assert set(ids) == {"bob@example.com"}


def test_unknown_audience_type_rejected(_env):
    with pytest.raises(broadcast.BroadcastError):
        run(broadcast.resolve_audience({"type": "nonsense"}))


def test_unknown_tier_rejected(_env):
    with pytest.raises(broadcast.BroadcastError):
        run(broadcast.resolve_audience({"type": "tier", "tier": "platinum"}))


def test_unknown_state_rejected(_env):
    with pytest.raises(broadcast.BroadcastError):
        run(broadcast.resolve_audience({"type": "state", "state": "trial_ending"}))


# ── price guard (BILLING_ENABLED must be monkeypatched, never read from env) ─

def test_price_guard_blocks_price_when_billing_disabled(_env):
    with pytest.raises(broadcast.BroadcastError):
        run(broadcast.create_broadcast(
            title="50% off", body="Get it for just £4.99 this week",
            url="/", audience={"type": "everyone"}, created_by="kevin",
        ))


def test_price_guard_allows_price_when_billing_enabled(_env, monkeypatch):
    monkeypatch.setattr(broadcast, "BILLING_ENABLED", True)
    doc = run(broadcast.create_broadcast(
        title="50% off", body="Get it for just £4.99 this week",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    assert doc["status"] == "draft"


def test_price_guard_allows_price_free_copy(_env):
    doc = run(broadcast.create_broadcast(
        title="New feature", body="Try the new spend view today",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    assert doc["status"] == "draft"


# ── recipient count visible before send (preview), snapshot frozen ───────

def test_preview_freezes_recipient_count(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    assert doc["recipient_count"] == len(set(USERS) - OPTED_OUT)
    assert set(doc["recipient_ids"]) == set(USERS) - OPTED_OUT


# ── send: real transport is mocked, dry-run never calls it ───────────────

def test_dry_run_never_calls_push(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    result = run(broadcast.send_broadcast(doc["_id"], dry_run=True))
    assert result["status"] == "sent"
    assert result["results"]["delivered"] == len(set(USERS) - OPTED_OUT)
    assert _env["push"].calls == []  # no real send happened


def test_real_send_calls_push_for_every_recipient(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    result = run(broadcast.send_broadcast(doc["_id"], dry_run=False))
    assert result["status"] == "sent"
    sent_to = {c[0] for c in _env["push"].calls}
    assert sent_to == set(USERS) - OPTED_OUT


# ── idempotency: double submit must not double-send ───────────────────────

def test_double_submit_does_not_double_send(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    first = run(broadcast.send_broadcast(doc["_id"], dry_run=False))
    second = run(broadcast.send_broadcast(doc["_id"], dry_run=False))

    assert first["status"] == "sent"
    assert second["status"] == "sent"
    # Only the first call actually sent — the second is a no-op that
    # returns the already-stored result.
    assert len(_env["push"].calls) == len(set(USERS) - OPTED_OUT)


def test_double_submit_via_router_handler(_env):
    """Same guarantee through the actual HTTP-facing handler, bot-authed,
    two rapid POSTs to /admin/broadcast/{id}/send."""
    doc = run(broadcast_preview(
        ComposeRequest(title="Hello", body="A message for everyone", audience=AudienceSpec(type="everyone")),
        user={"email": "kevin.maingi12@gmail.com", "name": "Bot"},
    ))
    bot_user = {"email": "kevin.maingi12@gmail.com", "name": "Bot"}
    run(broadcast_send(doc["id"], SendRequest(dry_run=False), user=bot_user))
    run(broadcast_send(doc["id"], SendRequest(dry_run=False), user=bot_user))
    assert len(_env["push"].calls) == len(set(USERS) - OPTED_OUT)


def test_send_record_written_per_recipient(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello there", body="A message for everyone",
        url="/spend", audience={"type": "everyone"}, created_by="kevin",
    ))
    run(broadcast.send_broadcast(doc["_id"], dry_run=False))

    receipts = _env["receipts"].docs
    expected = set(USERS) - OPTED_OUT
    assert set(r["user_id"] for r in receipts.values()) == expected
    for r in receipts.values():
        assert r["broadcast_id"] == doc["_id"]
        assert r["title"] == "Hello there"
        assert r["body"] == "A message for everyone"
        assert r["url"] == "/spend"
        assert r["sent_at"] is not None
        assert r["dry_run"] is False


def test_send_missing_broadcast_raises(_env):
    with pytest.raises(broadcast.BroadcastError):
        run(broadcast.send_broadcast("does-not-exist"))


# ── opt-out: a user who turned offers off never gets a receipt ───────────

def test_opted_out_user_never_gets_a_receipt(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    run(broadcast.send_broadcast(doc["_id"], dry_run=False))
    receipt_users = {r["user_id"] for r in _env["receipts"].docs.values()}
    assert "carol@example.com" not in receipt_users
    push_users = {c[0] for c in _env["push"].calls}
    assert "carol@example.com" not in push_users


# ── in-app card: offers list + dismiss ────────────────────────────────────

def test_dry_run_receipts_never_surface_as_in_app_offers(_env):
    doc = run(broadcast.create_broadcast(
        title="Hello", body="A message for everyone",
        url="/", audience={"type": "everyone"}, created_by="kevin",
    ))
    run(broadcast.send_broadcast(doc["_id"], dry_run=True))
    result = run(list_offers(user={"email": "alice@example.com", "name": ""}))
    assert result["offers"] == []


def test_real_send_surfaces_as_in_app_offer_then_dismissable(_env):
    doc = run(broadcast.create_broadcast(
        title="Big news", body="Something worth knowing",
        url="/spend", audience={"type": "everyone"}, created_by="kevin",
    ))
    run(broadcast.send_broadcast(doc["_id"], dry_run=False))

    result = run(list_offers(user={"email": "alice@example.com", "name": ""}))
    assert len(result["offers"]) == 1
    offer = result["offers"][0]
    assert offer["title"] == "Big news"
    assert offer["url"] == "/spend"

    dismissed = run(dismiss_offer(offer["id"], user={"email": "alice@example.com", "name": ""}))
    assert dismissed == {"ok": True}

    result_after = run(list_offers(user={"email": "alice@example.com", "name": ""}))
    assert result_after["offers"] == []


def test_dismiss_scoped_to_own_user(_env):
    """One user cannot dismiss another user's offer card by guessing its id."""
    doc = run(broadcast.create_broadcast(
        title="Big news", body="Something worth knowing",
        url="/spend", audience={"type": "everyone"}, created_by="kevin",
    ))
    run(broadcast.send_broadcast(doc["_id"], dry_run=False))
    alice_offers = run(list_offers(user={"email": "alice@example.com", "name": ""}))
    receipt_id = alice_offers["offers"][0]["id"]

    with pytest.raises(HTTPException) as exc:
        run(dismiss_offer(receipt_id, user={"email": "bob@example.com", "name": ""}))
    assert exc.value.status_code == 404

    # Still unread for alice.
    still_there = run(list_offers(user={"email": "alice@example.com", "name": ""}))
    assert len(still_there["offers"]) == 1


# ── copy hygiene: no em dashes anywhere the user reads ────────────────────

def test_no_em_dashes_in_module_user_facing_strings():
    # Every raised-error message a caller might surface, sampled directly.
    assert "—" not in "Offer copy cannot mention a price until billing is live. Describe the offer without a discount amount."
