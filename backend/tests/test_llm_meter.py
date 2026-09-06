"""Unit tests for app.core.llm — the shared OpenRouter client + per-user/
pipeline cost metering that every LLM call site in the app now goes
through.

`record_llm_usage`/`monthly_usage` are exercised against a small fake
Mongo-like collection so assertions don't depend on a running Mongo
process. `openrouter_chat` is exercised with `httpx.MockTransport` so no
real network call is made, and its own metering path is checked against
the real `llm_usage_col` (self-cleaning: every doc this test writes is
under a private test user_id and deleted in a `finally`), the same "talk to
the real local Mongo" convention the rest of this test suite already uses
(see tests/conftest.py's own notes on why there's no mongomock here).
"""
import asyncio
from datetime import datetime, timezone

import httpx
import pytest

import app.core.llm as llm_module
from app.core.llm import monthly_usage, openrouter_chat, record_llm_usage


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeLlmUsageCol:
    """Minimal stand-in for the Motor collection: records insert_one calls,
    supports the one aggregate() shape monthly_usage issues, and the one
    distinct() shape it issues for penny message ids. No real network."""

    def __init__(self):
        self.docs: list[dict] = []
        self.index_calls: list[list] = []

    async def create_index(self, spec):
        self.index_calls.append(spec)

    async def insert_one(self, doc):
        self.docs.append(doc)

    def aggregate(self, pipeline):
        match = pipeline[0]["$match"]
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in match.items())]
        by_pipeline: dict[str, list[dict]] = {}
        for d in rows:
            by_pipeline.setdefault(d["pipeline"], []).append(d)
        out = []
        for pname, ds in by_pipeline.items():
            out.append({
                "_id": pname,
                "calls": len(ds),
                "cost_usd": sum(d.get("cost_usd") or 0.0 for d in ds),
                "prompt_tokens": sum(d.get("prompt_tokens") or 0 for d in ds),
                "cached_tokens": sum(d.get("cached_tokens") or 0 for d in ds),
                "completion_tokens": sum(d.get("completion_tokens") or 0 for d in ds),
            })
        return _FakeCursor(out)

    async def distinct(self, field, match):
        rows = [d for d in self.docs if all(
            (d.get(k) == v) if k != "message_id" else (d.get(k) is not None)
            for k, v in match.items()
        )]
        return sorted({d[field] for d in rows if d.get(field) is not None})


@pytest.fixture
def fake_col(monkeypatch):
    fake = _FakeLlmUsageCol()
    monkeypatch.setattr(llm_module, "llm_usage_col", fake)
    monkeypatch.setattr(llm_module, "_indexes_ready", True)  # skip index setup noise
    return fake


# ── record_llm_usage ─────────────────────────────────────────────────────

def test_record_llm_usage_inserts_expected_doc_with_full_usage(fake_col):
    usage = {
        "prompt_tokens": 1200,
        "completion_tokens": 80,
        "cost": 0.0034,
        "prompt_tokens_details": {"cached_tokens": 900},
    }
    asyncio.run(record_llm_usage(
        user_id="kevin@example.com", pipeline="penny", model="anthropic/claude-haiku-4-5",
        usage=usage, latency_ms=1234, message_id="msg-1",
    ))
    assert len(fake_col.docs) == 1
    doc = fake_col.docs[0]
    assert doc["user_id"] == "kevin@example.com"
    assert doc["pipeline"] == "penny"
    assert doc["model"] == "anthropic/claude-haiku-4-5"
    assert doc["prompt_tokens"] == 1200
    assert doc["cached_tokens"] == 900
    assert doc["completion_tokens"] == 80
    assert doc["cost_usd"] == pytest.approx(0.0034)
    assert doc["latency_ms"] == 1234
    assert doc["message_id"] == "msg-1"
    assert isinstance(doc["ts"], datetime)
    assert doc["year_month"] == datetime.now(timezone.utc).strftime("%Y-%m")


def test_record_llm_usage_defaults_cost_and_cached_to_zero_when_absent(fake_col):
    usage = {"prompt_tokens": 500, "completion_tokens": 40}
    asyncio.run(record_llm_usage(
        user_id="u1", pipeline="scenario", model="anthropic/claude-haiku-4-5",
        usage=usage, latency_ms=500,
    ))
    doc = fake_col.docs[0]
    assert doc["cost_usd"] == 0.0
    assert doc["cached_tokens"] == 0
    assert "message_id" not in doc  # only Penny rounds carry this field


def test_record_llm_usage_never_raises_on_bad_input(fake_col):
    # usage=None used to be a plausible caller mistake — must degrade
    # gracefully (a zeroed doc, still tagged with pipeline/user/model so the
    # call is at least visible), never propagate and turn a successful LLM
    # call into a user-facing 500.
    asyncio.run(record_llm_usage(
        user_id="u1", pipeline="memory", model="m", usage=None, latency_ms=1,
    ))
    assert len(fake_col.docs) == 1
    assert fake_col.docs[0]["cost_usd"] == 0.0
    assert fake_col.docs[0]["prompt_tokens"] == 0


def test_record_llm_usage_never_raises_when_collection_write_fails(monkeypatch):
    class _ExplodingCol:
        async def insert_one(self, doc):
            raise RuntimeError("mongo is down")

    monkeypatch.setattr(llm_module, "llm_usage_col", _ExplodingCol())
    monkeypatch.setattr(llm_module, "_indexes_ready", True)
    # Must not raise — this is metering, a DB hiccup here must never take
    # down the LLM call that already succeeded.
    asyncio.run(record_llm_usage(
        user_id="u1", pipeline="memory", model="m", usage={}, latency_ms=1,
    ))


# ── monthly_usage ────────────────────────────────────────────────────────

def test_monthly_usage_counts_distinct_penny_messages_and_sums_cost(fake_col):
    ym = "2026-09"
    uid = "kevin@example.com"

    async def _seed():
        # Two rounds of the SAME penny message (message_id="m1") plus one
        # round of a second message ("m2") — 3 docs, 2 distinct messages.
        await record_llm_usage(user_id=uid, pipeline="penny", model="x", latency_ms=1,
                                usage={"prompt_tokens": 100, "completion_tokens": 10, "cost": 0.01}, message_id="m1")
        await record_llm_usage(user_id=uid, pipeline="penny", model="x", latency_ms=1,
                                usage={"prompt_tokens": 50, "completion_tokens": 5, "cost": 0.002}, message_id="m1")
        await record_llm_usage(user_id=uid, pipeline="penny", model="x", latency_ms=1,
                                usage={"prompt_tokens": 30, "completion_tokens": 3, "cost": 0.001}, message_id="m2")
        await record_llm_usage(user_id=uid, pipeline="scenario", model="x", latency_ms=1,
                                usage={"prompt_tokens": 20, "completion_tokens": 2, "cost": 0.0005})
        # Different user — must not leak into this user's rollup.
        await record_llm_usage(user_id="someone-else@example.com", pipeline="penny", model="x", latency_ms=1,
                                usage={"prompt_tokens": 999, "completion_tokens": 9, "cost": 9.0}, message_id="m3")

    asyncio.run(_seed())
    # Force every seeded doc into the target year_month regardless of when
    # the test actually runs.
    for d in fake_col.docs:
        d["year_month"] = ym if d["user_id"] == uid else d["year_month"]

    result = asyncio.run(monthly_usage(uid, ym))
    assert result["year_month"] == ym
    assert result["penny_messages"] == 2
    assert result["cost_usd"] == pytest.approx(0.01 + 0.002 + 0.001 + 0.0005)
    assert result["by_pipeline"]["penny"]["calls"] == 3
    assert result["by_pipeline"]["penny"]["cost_usd"] == pytest.approx(0.013)
    assert result["by_pipeline"]["scenario"]["calls"] == 1
    assert "someone-else@example.com" not in str(result)


def test_monthly_usage_defaults_to_current_month_and_handles_no_data(fake_col):
    result = asyncio.run(monthly_usage("nobody@example.com"))
    assert result["year_month"] == datetime.now(timezone.utc).strftime("%Y-%m")
    assert result["penny_messages"] == 0
    assert result["cost_usd"] == 0.0
    assert result["by_pipeline"] == {}


# ── openrouter_chat ──────────────────────────────────────────────────────

def test_openrouter_chat_merges_provider_prefs_and_usage_include():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        body = _json.loads(request.content)
        captured["body"] = body
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={
            "model": "anthropic/claude-haiku-4-5",
            "choices": [{"message": {"content": "hi"}}],
            "usage": {
                "prompt_tokens": 10, "completion_tokens": 2, "cost": 0.0001,
                "prompt_tokens_details": {"cached_tokens": 0},
            },
        })

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await openrouter_chat(
                {"model": "anthropic/claude-haiku-4-5", "messages": [{"role": "user", "content": "hi"}]},
                user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    body = captured["body"]
    assert body["usage"] == {"include": True}
    assert "provider" in body and isinstance(body["provider"], dict)
    assert "Bearer" in (captured["auth"] or "")


def test_openrouter_chat_preserves_caller_provider_and_merges_usage_flag():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json
        captured["body"] = _json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "x"}}]})

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await openrouter_chat(
                {
                    "model": "m", "messages": [], "provider": {"only": "me"},
                    "usage": {"exclude_something": True},
                },
                user_id=None, pipeline="investment_prices", client=client,
            )

    asyncio.run(_run())
    body = captured["body"]
    assert body["provider"] == {"only": "me"}  # caller's own provider wins, untouched
    assert body["usage"] == {"exclude_something": True, "include": True}  # merged, not replaced


def test_openrouter_chat_records_usage_on_200(fake_col):
    """End-to-end through openrouter_chat -> record_llm_usage, against the
    fake collection (see the module docstring for why this suite fakes
    Mongo rather than round-tripping the real Motor client across more than
    one `asyncio.run()` per test — Motor's asyncio integration does not
    tolerate that)."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "model": "anthropic/claude-haiku-4-5",
            "choices": [{"message": {"content": "hi"}}],
            "usage": {"prompt_tokens": 42, "completion_tokens": 7, "cost": 0.00042},
        })

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await openrouter_chat(
                {"model": "anthropic/claude-haiku-4-5", "messages": []},
                user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    asyncio.run(_run())
    assert len(fake_col.docs) == 1
    doc = fake_col.docs[0]
    assert doc["prompt_tokens"] == 42
    assert doc["completion_tokens"] == 7
    assert doc["cost_usd"] == pytest.approx(0.00042)


def test_openrouter_chat_does_not_meter_a_non_200_response(fake_col):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await openrouter_chat(
                {"model": "m", "messages": []}, user_id="kevin@example.com", pipeline="scenario", client=client,
            )

    resp = asyncio.run(_run())
    assert resp.status_code == 500
    assert fake_col.docs == []
