"""Tests for the granular WARNING logs added to `_generate_savings_insight_content`
(backend/app/routers/savings_insights.py) — observability fix, owner phone
report 2026-08-28: a real "Find me alternatives" tap on the eating_out insight
returned the generic 502 "Couldn't check just now" and journalctl showed
NOTHING, because both the Tavily block (`except Exception: pass`) and the
OpenRouter block (`except Exception: parsed = None`) swallowed every failure
silently, and the only outcome the caller could see was "content is falsy".

These pin that every branch which can lead to that empty result now logs its
own specific cause (tavily HTTP status / tavily timeout / LLM HTTP status /
LLM timeout / unparseable LLM JSON / guardrail violation exhausted) at
WARNING, tagged with `category=`, so a future incident is diagnosable from
`journalctl -u wealth-api` alone without needing to reproduce it live.

No real network calls: `httpx.AsyncClient` is replaced with a tiny fake that
returns (or raises) exactly what each test wants, in call order — the first
`async with httpx.AsyncClient(...)` in the function body is always the Tavily
search, subsequent ones are the (up to two) OpenRouter attempts.
"""
import asyncio

import httpx
import pytest

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import _generate_savings_insight_content


def _run(coro):
    return asyncio.run(coro)


class _FakeResponse:
    def __init__(self, status_code, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def json(self):
        return self._json


class _FakeAsyncClient:
    """One-shot fake for a single `async with httpx.AsyncClient(...) as client:`
    block — `item` is either an `_FakeResponse` to return from `.post()`, or
    an `Exception` instance to raise instead."""

    def __init__(self, item):
        self._item = item

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        if isinstance(self._item, Exception):
            raise self._item
        return self._item


def _patch_client_queue(monkeypatch, queue: list):
    """Each call to `httpx.AsyncClient(timeout=...)` inside the function under
    test pops the next queued item, in call order (Tavily first, then each
    OpenRouter attempt)."""
    remaining = list(queue)

    def factory(*args, **kwargs):
        return _FakeAsyncClient(remaining.pop(0))

    monkeypatch.setattr(savings_insights.httpx, "AsyncClient", factory)


def _patch_keys(monkeypatch):
    monkeypatch.setattr(savings_insights, "TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setattr(savings_insights, "OPENROUTER_API_KEY", "fake-openrouter-key")


LLM_SUCCESS_BODY = {
    "choices": [{"message": {"content": '{"title":"x","body":"y","savings_estimate":null,"claim_valid_until":null}'}}],
}
TAVILY_SUCCESS_BODY = {"answer": "Some current UK deals.", "results": [{"content": "A search result snippet."}]}


def test_tavily_non_200_logs_warning_with_status_and_category(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    _patch_client_queue(monkeypatch, [_FakeResponse(503)])

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("gym", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("tavily HTTP 503" in m and "category=gym" in m for m in warnings)


def test_tavily_timeout_logs_warning(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    _patch_client_queue(monkeypatch, [httpx.TimeoutException("timed out")])

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("energy", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("tavily timeout" in m and "category=energy" in m for m in warnings)


def test_llm_non_200_logs_warning_with_status_and_attempt(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(500),  # attempt 0
            _FakeResponse(500),  # attempt 1 (violation regen is unreachable — parsed never became a dict)
        ],
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("eating_out", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("LLM HTTP 500" in m and "category=eating_out" in m and "attempt=0" in m for m in warnings)


def test_llm_timeout_logs_warning(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            httpx.TimeoutException("timed out"),  # attempt 0
            httpx.TimeoutException("timed out"),  # attempt 1
        ],
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("eating_out", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("LLM timeout" in m and "category=eating_out" in m for m in warnings)


def test_llm_unparseable_json_logs_warning(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    bad_json_body = {"choices": [{"message": {"content": "not json at all"}}]}
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, bad_json_body),  # attempt 0
            _FakeResponse(200, bad_json_body),  # attempt 1
        ],
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("eating_out", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("not valid JSON" in m and "category=eating_out" in m for m in warnings)


def test_missing_tavily_key_logs_warning_and_never_calls_openrouter(monkeypatch, caplog):
    monkeypatch.setattr(savings_insights, "TAVILY_API_KEY", "")
    monkeypatch.setattr(savings_insights, "OPENROUTER_API_KEY", "fake-openrouter-key")
    _patch_client_queue(monkeypatch, [])  # no httpx call should happen at all

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("mobile", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert any("TAVILY_API_KEY not configured" in m and "category=mobile" in m for m in warnings)


def test_successful_generation_emits_no_warnings(monkeypatch, caplog):
    """Control case — a clean success path must stay quiet, otherwise the
    new WARNING logs would themselves become the noise this fix is trying to
    avoid."""
    _patch_keys(monkeypatch)
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, LLM_SUCCESS_BODY),
        ],
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("gym", None, None))

    assert result is not None
    assert result["title"] == "x"
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING" and r.name == "app.routers.savings_insights"]
    assert warnings == []
