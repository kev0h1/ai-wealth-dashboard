"""Test for backlog A127: POST /chat/tax's name derivation used to be
`user.get("name", "").split()[0] or "there"`, which raises IndexError the
instant `user["name"]` is "" (since `"".split()` is `[]`, and `[0]` on an
empty list is an error). D7 (2026-09-28) made an empty session `name` the
normal case for Apple sign-in and Google accounts with no provider-supplied
display name.

This route (app/routers/chat.py's `tax_chat`) is dead code today — nothing
in the frontend calls it, see the module's own docstring — so the bug was
previously unreachable in practice, but the guard is fixed anyway rather
than leaving a live IndexError in an endpoint that still exists.

Follows this codebase's direct-call convention for router unit tests (see
tests/test_finexer_link.py's own docstring): call the async route function
directly with a plain-dict `user`, with `answer_tax_question` monkeypatched
out so no real OpenRouter call happens.
"""
import asyncio

import app.routers.chat as chat_module


def test_tax_chat_with_empty_session_name_does_not_raise(monkeypatch):
    monkeypatch.setattr(chat_module, "OPENROUTER_API_KEY", "test-key")

    captured = {}

    async def fake_answer_tax_question(uid, name, messages):
        captured["uid"] = uid
        captured["name"] = name
        return "a reply"

    monkeypatch.setattr(chat_module, "answer_tax_question", fake_answer_tax_question)

    result = asyncio.run(chat_module.tax_chat(
        {"messages": [{"role": "user", "content": "hello"}]},
        user={"email": "kevin@example.com", "name": ""},
    ))

    assert result == {"reply": "a reply"}
    assert captured["name"] == "there"


def test_tax_chat_with_a_real_session_name_uses_its_first_word(monkeypatch):
    monkeypatch.setattr(chat_module, "OPENROUTER_API_KEY", "test-key")

    captured = {}

    async def fake_answer_tax_question(uid, name, messages):
        captured["name"] = name
        return "a reply"

    monkeypatch.setattr(chat_module, "answer_tax_question", fake_answer_tax_question)

    asyncio.run(chat_module.tax_chat(
        {"messages": [{"role": "user", "content": "hello"}]},
        user={"email": "kevin@example.com", "name": "Kevin Maingi"},
    ))

    assert captured["name"] == "Kevin"
