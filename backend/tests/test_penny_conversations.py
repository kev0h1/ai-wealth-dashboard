"""G248: Penny chat history. Storage, caps, eviction, proposals link, erasure,
export, the model window and the open_last_chat preference. No Mongo: a tiny
in-memory collection stands in for the Motor handle, patched at the service."""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i
import app.routers.penny_conversations as router
import app.routers.preferences as preferences
import app.services.penny_conversations as svc

A = "a@example.com"
B = "b@example.com"


def _get(doc, key):
    cur = doc
    for part in key.split("."):
        if isinstance(cur, list):
            try:
                cur = cur[int(part)]
            except (ValueError, IndexError):
                return _MISSING
        elif isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return _MISSING
    return cur


_MISSING = object()


def _match(doc, filt):
    for key, cond in filt.items():
        val = _get(doc, key)
        if isinstance(cond, dict):
            if "$exists" in cond and (val is not _MISSING) != cond["$exists"]:
                return False
            if "$in" in cond and val not in cond["$in"]:
                return False
        else:
            if val is _MISSING:
                val = None if cond is None else val
            if val != cond:
                return False
    return True


class _Cursor:
    def __init__(self, docs):
        self.docs = list(docs)

    def sort(self, spec, direction=1):
        pairs = spec if isinstance(spec, list) else [(spec, direction)]
        for key, d in reversed(pairs):
            self.docs.sort(key=lambda x: x.get(key) or 0, reverse=d < 0)
        return self

    def skip(self, n):
        self.docs = self.docs[n:]
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class _Res:
    def __init__(self, matched=0, deleted=0):
        self.matched_count = matched
        self.deleted_count = deleted


class _Col:
    def __init__(self):
        self.docs = []

    def find(self, filt=None, projection=None):
        return _Cursor(d for d in self.docs if _match(d, filt or {}))

    async def find_one(self, filt=None, projection=None):
        return next((d for d in self.docs if _match(d, filt or {})), None)

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                for k, spec in (update.get("$push") or {}).items():
                    d.setdefault(k, []).extend(spec["$each"])
                return _Res(matched=1)
        return _Res()

    async def delete_one(self, filt):
        for d in self.docs:
            if _match(d, filt):
                self.docs.remove(d)
                return _Res(deleted=1)
        return _Res()

    async def delete_many(self, filt):
        hit = [d for d in self.docs if _match(d, filt)]
        for d in hit:
            self.docs.remove(d)
        return _Res(deleted=len(hit))


@pytest.fixture
def cols(monkeypatch):
    convs, props = _Col(), _Col()
    monkeypatch.setattr(svc, "penny_conversations_col", convs)
    monkeypatch.setattr(svc, "penny_proposals_col", props)
    monkeypatch.setattr(can_i, "penny_conversations", svc)
    return convs, props


def run(coro):
    return asyncio.run(coro)


def _pair(q="How much is left?", a="You have 40 pounds free."):
    return [svc.clean_turn("user", q), svc.clean_turn("assistant", a)]


def test_create_list_get_append_delete(cols):
    conv = run(svc.create_conversation(A))
    cid = conv["id"]
    assert conv["turns"] == [] and conv["title"] == "New chat"
    out = run(svc.append_turns(A, cid, _pair()))
    assert out == {"turn_count": 2, "at_cap": False}
    listed = run(svc.list_conversations(A))
    assert [c["id"] for c in listed] == [cid]
    assert listed[0]["title"] == "How much is left?"
    assert listed[0]["preview"] == "You have 40 pounds free."
    got = run(svc.get_conversation(A, cid))
    assert [t["role"] for t in got["turns"]] == ["user", "assistant"]
    assert run(svc.delete_conversation(A, cid)) is True
    assert run(svc.list_conversations(A)) == []
    with pytest.raises(svc.ConversationNotFound):
        run(svc.get_conversation(A, cid))


def test_title_is_the_first_question_only_and_trimmed(cols):
    cid = run(svc.create_conversation(A))["id"]
    run(svc.append_turns(A, cid, _pair("x" * 200)))
    run(svc.append_turns(A, cid, _pair("second question")))
    title = run(svc.get_conversation(A, cid))["title"]
    assert title.startswith("xxx") and len(title) <= svc.PENNY_TITLE_MAX


def test_thirty_turn_cap_with_at_cap_flag(cols):
    cid = run(svc.create_conversation(A))["id"]
    for i in range(14):
        assert run(svc.append_turns(A, cid, _pair(f"q{i}")))["at_cap"] is False
    last = run(svc.append_turns(A, cid, _pair("q14")))
    assert last == {"turn_count": 30, "at_cap": True}
    with pytest.raises(svc.ConversationFull):
        run(svc.append_turns(A, cid, _pair("one too many")))
    assert len(run(svc.get_conversation(A, cid))["turns"]) == 30


def test_eviction_deletes_exactly_the_oldest(cols):
    convs, _ = cols
    from datetime import datetime, timedelta, timezone
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(10):
        convs.docs.append({"_id": f"old{i}", "user_id": A, "title": None, "turns": [],
                           "created_at": base + timedelta(days=i), "updated_at": base + timedelta(days=i)})
    convs.docs.append({"_id": "b-old", "user_id": B, "title": None, "turns": [],
                       "created_at": base - timedelta(days=9), "updated_at": base - timedelta(days=9)})
    run(svc.create_conversation(A))
    ids = {d["_id"] for d in convs.docs if d["user_id"] == A}
    assert "old0" not in ids and "old1" in ids and len(ids) == 10
    assert any(d["_id"] == "b-old" for d in convs.docs)


def test_users_cannot_read_append_or_delete_each_others_chats(cols):
    cid = run(svc.create_conversation(A))["id"]
    with pytest.raises(svc.ConversationNotFound):
        run(svc.get_conversation(B, cid))
    with pytest.raises(svc.ConversationNotFound):
        run(svc.append_turns(B, cid, _pair()))
    assert run(svc.delete_conversation(B, cid)) is False
    assert run(svc.list_conversations(B)) == []


def test_only_role_and_text_are_stored(cols):
    cid = run(svc.create_conversation(A))["id"]
    body = {"turns": [
        {"role": "user", "text": "hi there", "token": "SECRET", "view": {"balance": 1}},
        {"role": "assistant", "text": "hello", "proposal_id": "p1", "raw_tool": {"x": 1}},
    ]}
    run(router.append_turns(cid, body, {"email": A}))
    stored = cols[0].docs[0]["turns"]
    assert set(stored[0]) == {"role", "text", "ts"}
    assert set(stored[1]) == {"role", "text", "ts", "proposal_id"}


def test_router_validation_and_full_is_409(cols):
    cid = run(svc.create_conversation(A))["id"]
    for bad in ({}, {"turns": []}, {"turns": [{"role": "system", "text": "x"}]}, {"turns": [{"role": "user", "text": " "}]}):
        with pytest.raises(HTTPException) as e:
            run(router.append_turns(cid, bad, {"email": A}))
        assert e.value.status_code == 400
    cols[0].docs[0]["turns"] = [{"role": "user", "text": "x", "ts": 0}] * 30
    with pytest.raises(HTTPException) as e:
        run(router.append_turns(cid, {"turns": [{"role": "user", "text": "more"}]}, {"email": A}))
    assert e.value.status_code == 409 and e.value.detail["code"] == "PENNY_CONVERSATION_FULL"
    with pytest.raises(HTTPException) as e:
        run(router.get_conversation("nope", {"email": A}))
    assert e.value.status_code == 404


def test_can_i_appends_the_exchange_and_links_the_proposal(cols, monkeypatch):
    convs, props = cols
    cid = run(svc.create_conversation(A))["id"]
    props.docs.append({"_id": "prop-1", "user_id": A})

    async def fake_answer(body, user):
        return {"reply": "I can set that up.", "headline": "h", "proposal": {"proposal_id": "prop-1"}}

    monkeypatch.setattr(can_i, "_can_i_answer", fake_answer)
    out = run(can_i.can_i({"question": "Add a plan", "conversation_id": cid}, {"email": A}))
    assert out["conversation"] == {"id": cid, "turn_count": 2, "at_cap": False}
    turns = convs.docs[0]["turns"]
    assert [t["text"] for t in turns] == ["Add a plan", "I can set that up."]
    assert turns[1]["proposal_id"] == "prop-1"
    assert props.docs[0]["conversation_id"] == cid


def test_can_i_without_a_conversation_is_unchanged(cols, monkeypatch):
    async def fake_answer(body, user):
        return {"reply": "ok"}
    monkeypatch.setattr(can_i, "_can_i_answer", fake_answer)
    assert run(can_i.can_i({"question": "hello there"}, {"email": A})) == {"reply": "ok"}


def test_can_i_missing_conversation_still_answers(cols, monkeypatch):
    async def fake_answer(body, user):
        return {"reply": "ok"}
    monkeypatch.setattr(can_i, "_can_i_answer", fake_answer)
    out = run(can_i.can_i({"question": "hello there", "conversation_id": "gone"}, {"email": A}))
    assert out["reply"] == "ok" and out["conversation"] == {"id": "gone", "missing": True}


def test_can_i_refuses_before_the_model_when_the_chat_is_full(cols, monkeypatch):
    cid = run(svc.create_conversation(A))["id"]
    cols[0].docs[0]["turns"] = [{"role": "user", "text": "x", "ts": 0}] * 30

    async def boom(body, user):
        raise AssertionError("the model path must not run for a full chat")
    monkeypatch.setattr(can_i, "_can_i_answer", boom)
    with pytest.raises(HTTPException) as e:
        run(can_i.can_i({"question": "one more", "conversation_id": cid}, {"email": A}))
    assert e.value.status_code == 409 and e.value.detail["at_cap"] is True


def test_the_model_window_is_still_six_turns(monkeypatch):
    assert can_i.MODEL_HISTORY_TURNS == 6
    seen = {}

    async def fake_agent(uid, question, history, screen, context, view):
        seen["history"] = history
        return {"reply": "r", "headline": "h"}

    async def allowance(uid):
        return {"limit": None, "used": 0}

    monkeypatch.setattr(can_i, "run_penny_agent", fake_agent)
    monkeypatch.setattr(can_i, "penny_allowance", allowance)
    monkeypatch.setattr(can_i, "OPENROUTER_API_KEY", "x")
    history = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(40)]
    run(can_i._can_i_answer({"question": "what is left?", "history": history}, {"email": A}))
    assert [h["content"] for h in seen["history"]] == [f"m{i}" for i in range(34, 40)]


def test_export_returns_only_the_users_chats(cols):
    run(svc.create_conversation(A))
    run(svc.create_conversation(B))
    assert len(run(svc.export_conversations(A))) == 1


def test_erase_user_clears_conversations(monkeypatch):
    import app.db.collections as colmod
    import app.services.retention as retention
    assert "penny_conversations_col" in colmod.ERASURE_MANIFEST
    fakes = {name: _Col() for name in colmod.ERASURE_MANIFEST}
    for name, fake in fakes.items():
        monkeypatch.setattr(colmod, name, fake)
    monkeypatch.setattr(colmod, "ERASE_ONLY_COLLECTIONS", frozenset())
    fakes["penny_conversations_col"].docs = [
        {"_id": "c1", "user_id": A, "turns": []}, {"_id": "c2", "user_id": B, "turns": []},
    ]
    removed = run(retention.erase_user(A))
    assert removed.get("penny_conversations") == 1
    assert [d["_id"] for d in fakes["penny_conversations_col"].docs] == ["c2"]


# ── open_last_chat preference ────────────────────────────────────────────

class _PrefCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if d.get("user_id") == (q or {}).get("user_id")), None)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if d.get("user_id") == filt.get("user_id"):
                d.update(update.get("$set") or {})
                for f, n in (update.get("$inc") or {}).items():
                    d[f] = d.get(f, 0) + n
                return _Res(matched=1)
        new = dict(filt)
        new.update(update.get("$set") or {})
        for f, n in (update.get("$inc") or {}).items():
            new[f] = new.get(f, 0) + n
        self.docs.append(new)
        return _Res(matched=1)


class _Spy:
    def __init__(self):
        self.calls = []

    async def ainvalidate(self, uid):
        self.calls.append(uid)


def _prefs(monkeypatch, doc=None):
    col, spy = _PrefCol([doc] if doc else []), _Spy()
    monkeypatch.setattr(preferences, "preferences_col", col)
    monkeypatch.setattr(preferences, "response_cache", spy)
    return col, spy


def test_open_last_chat_defaults_off_round_trips_and_invalidates(monkeypatch):
    _, spy = _prefs(monkeypatch, None)
    assert run(preferences.get_preferences({"email": A}))["open_last_chat"] is False
    _prefs(monkeypatch, {"user_id": A, "version": 1})
    out = run(preferences.update_preferences({"open_last_chat": True}, {"email": A}))
    assert out["open_last_chat"] is True
    assert run(preferences.get_preferences({"email": A}))["open_last_chat"] is True
    assert "open_last_chat" in preferences.ALLOWED_PREFERENCE_FIELDS


def test_open_last_chat_rejects_non_booleans_and_unknown_siblings(monkeypatch):
    col, _ = _prefs(monkeypatch, {"user_id": A, "version": 1})
    for bad in ("yes", 1, None):
        with pytest.raises(HTTPException) as e:
            run(preferences.update_preferences({"open_last_chat": bad}, {"email": A}))
        assert e.value.status_code == 422
    assert "open_last_chat" not in col.docs[0]
    with pytest.raises(HTTPException) as e:
        run(preferences.update_preferences({"open_last_chats": True}, {"email": A}))
    assert e.value.status_code == 422
