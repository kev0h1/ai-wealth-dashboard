"""Unit tests for A80's service-wide monthly OpenRouter call ceiling
(`app.core.llm._check_global_ceiling`, wired into `openrouter_chat`).

Fakes `llm_global_usage_col` the same way tests/test_llm_meter.py fakes
`llm_usage_col` — a small in-memory stand-in for the one Motor shape this
code actually uses (`find_one_and_update` with `$inc`/upsert/
return_document, `update_one` with `$set`), no real Mongo, no real network
(httpx.MockTransport). `LLM_GLOBAL_MONTHLY_CALL_CEILING` is monkeypatched
on the `app.core.llm` module directly, since `_check_global_ceiling` reads
the module-level name at call time.

Deliberately NOT covered here: A81's per-user allowance fail-open behaviour
(`app.routers.can_i`'s `penny_allowance` gate) — a separate, unrelated
decision this item does not touch.
"""
import asyncio
import logging

import httpx
import pytest
from fastapi import HTTPException

import app.core.llm as llm_module
from app.core.llm import openrouter_chat


class _Result:
    def __init__(self, modified_count: int):
        self.modified_count = modified_count


class _FakeGlobalUsageCol:
    """Minimal Motor stand-in for llm_global_usage_col: one doc per `_id`
    (the "YYYY-MM" key), supporting the exact find_one_and_update/update_one
    shapes `_check_global_ceiling` issues."""

    def __init__(self):
        self.docs: dict[str, dict] = {}

    async def find_one_and_update(self, filt, update, *, upsert=False, return_document=None):
        _id = filt["_id"]
        doc = self.docs.get(_id)
        if doc is None:
            if not upsert:
                return None
            doc = {"_id": _id}
            self.docs[_id] = doc
        for k, v in update.get("$inc", {}).items():
            doc[k] = doc.get(k, 0) + v
        return dict(doc)

    async def update_one(self, filt, update):
        _id = filt["_id"]
        doc = self.docs.get(_id)
        if doc is None:
            return _Result(0)
        for k, v in filt.items():
            if k == "_id":
                continue
            if isinstance(v, dict) and "$ne" in v:
                if doc.get(k) == v["$ne"]:
                    return _Result(0)
            elif doc.get(k) != v:
                return _Result(0)
        modified = 0
        for k, v in update.get("$set", {}).items():
            if doc.get(k) != v:
                modified = 1
            doc[k] = v
        return _Result(modified)


class _ExplodingGlobalUsageCol:
    async def find_one_and_update(self, *a, **kw):
        raise RuntimeError("mongo is down")

    async def update_one(self, *a, **kw):
        raise RuntimeError("mongo is down")


@pytest.fixture
def fake_global_col(monkeypatch):
    fake = _FakeGlobalUsageCol()
    monkeypatch.setattr(llm_module, "llm_global_usage_col", fake)
    return fake


def _ok_handler(calls: list):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={
            "model": "anthropic/claude-haiku-4-5",
            "choices": [{"message": {"content": "hi"}}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "cost": 0.0001},
        })
    return handler


# ── disabled (default) ──────────────────────────────────────────────────

def test_disabled_ceiling_makes_no_counter_write_and_sends(monkeypatch, fake_global_col):
    monkeypatch.setattr(llm_module, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 0)
    calls: list = []

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(calls))) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert len(calls) == 1
    assert fake_global_col.docs == {}  # no counter doc at all


# ── under the ceiling ────────────────────────────────────────────────────

def test_under_ceiling_increments_counter_and_sends(monkeypatch, fake_global_col):
    monkeypatch.setattr(llm_module, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 5)
    calls: list = []

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(calls))) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert len(calls) == 1
    assert len(fake_global_col.docs) == 1
    (doc,) = fake_global_col.docs.values()
    assert doc["count"] == 1


# ── crossing the ceiling ─────────────────────────────────────────────────

def test_call_crossing_ceiling_is_refused_with_no_http_request(monkeypatch, fake_global_col):
    monkeypatch.setattr(llm_module, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 1)
    from datetime import datetime, timezone
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    fake_global_col.docs[ym] = {"_id": ym, "count": 1}  # already at the ceiling
    calls: list = []

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(calls))) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_run())

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["code"] == "LLM_GLOBAL_CEILING_REACHED"
    assert calls == []  # the request was never sent
    assert fake_global_col.docs[ym]["count"] == 2  # the increment itself still happened


# ── counter write failure ───────────────────────────────────────────────

def test_counter_write_error_refuses_the_call(monkeypatch):
    monkeypatch.setattr(llm_module, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 1000)
    monkeypatch.setattr(llm_module, "llm_global_usage_col", _ExplodingGlobalUsageCol())
    calls: list = []

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(calls))) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(_run())

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["code"] == "LLM_GLOBAL_CEILING_REACHED"
    assert calls == []  # fail CLOSED: a storage error must never let the call through


# ── 80% warning ──────────────────────────────────────────────────────────

def test_80_percent_warning_fires_once(monkeypatch, fake_global_col, caplog):
    monkeypatch.setattr(llm_module, "LLM_GLOBAL_MONTHLY_CALL_CEILING", 10)
    from datetime import datetime, timezone
    ym = datetime.now(timezone.utc).strftime("%Y-%m")
    fake_global_col.docs[ym] = {"_id": ym, "count": 7}  # next call -> 8, exactly 80% of 10
    calls: list = []

    async def _one_call():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_ok_handler(calls))) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    with caplog.at_level(logging.WARNING, logger="app.core.llm"):
        asyncio.run(_one_call())  # count -> 8, crosses 80%, should warn once
        asyncio.run(_one_call())  # count -> 9, still >= 80%, must NOT warn again

    warnings = [r for r in caplog.records if "80%" in r.message or "80%%" in r.message]
    assert len(warnings) == 1
    assert fake_global_col.docs[ym]["warned_80"] is True
    assert fake_global_col.docs[ym]["count"] == 9
    assert len(calls) == 2  # both calls were well under the ceiling of 10, both sent
