"""Tests for the dated-promo STRIP FALLBACK in `_generate_savings_insight_content`
(backend/app/routers/savings_insights.py) — bug diagnosed live 2026-09-01 20:04
via the observability added in test_generate_savings_insight_content_observability.py:
a real "research" tap on subscriptions 502'd three times in one session because
the LLM kept writing dated-promo phrasing ("offer ends...", bundle deals)
without a parseable `claim_valid_until`, both attempts tripped `_DATED_PROMO_RE`,
and the guardrail dropped the ENTIRE generation.

The guardrail's intent (never show a dated claim without an expiry) is right;
the all-or-nothing penalty was wrong for deal-heavy categories. Fix: on a
second violation, strip only the offending sentence(s) (`_strip_dated_promo_sentences`)
and keep whatever survives, rather than dropping everything. Only return None
(-> 502 at the call sites) when nothing meaningful survives the strip.

Same fake-httpx-client convention as
test_generate_savings_insight_content_observability.py: no real network
calls, `httpx.AsyncClient` is replaced with a tiny fake that returns exactly
what each test wants, in call order (Tavily first, then up to two OpenRouter
attempts).
"""
import asyncio

import pytest

import app.routers.savings_insights as savings_insights
from app.routers.savings_insights import (
    _generate_savings_insight_content,
    _strip_dated_promo_sentences,
    _DATED_PROMO_RE,
)


def _run(coro):
    return asyncio.run(coro)


class _FakeResponse:
    def __init__(self, status_code, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def json(self):
        return self._json


class _RecordingAsyncClient:
    """Same one-shot fake as the observability tests, plus records every
    `.post()` call's kwargs into `sink` so a test can inspect exactly what
    prompt was sent on a given attempt (used to verify the retry carries
    violation feedback, not a blind regeneration)."""

    def __init__(self, item, sink):
        self._item = item
        self._sink = sink

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        self._sink.append(kwargs)
        if isinstance(self._item, Exception):
            raise self._item
        return self._item


def _patch_client_queue(monkeypatch, queue: list, sink: list):
    remaining = list(queue)

    def factory(*args, **kwargs):
        return _RecordingAsyncClient(remaining.pop(0), sink)

    monkeypatch.setattr(savings_insights.httpx, "AsyncClient", factory)


def _patch_keys(monkeypatch):
    monkeypatch.setattr(savings_insights, "TAVILY_API_KEY", "fake-tavily-key")
    monkeypatch.setattr(savings_insights, "OPENROUTER_API_KEY", "fake-openrouter-key")


TAVILY_SUCCESS_BODY = {"answer": "Some current UK deals.", "results": [{"content": "A search result snippet."}]}


def _llm_body(title, body, savings_estimate=None, claim_valid_until=None):
    import json
    content = json.dumps({
        "title": title, "body": body,
        "savings_estimate": savings_estimate, "claim_valid_until": claim_valid_until,
    })
    return {"choices": [{"message": {"content": content}}]}


# ── _strip_dated_promo_sentences — pure unit tests ──────────────────────────

def test_strip_removes_only_the_dated_promo_sentence():
    text = ("Compare rolling monthly plans to avoid overpaying. "
            "There's a January sale ending soon on annual plans.")
    out = _strip_dated_promo_sentences(text)
    assert "Compare rolling monthly plans to avoid overpaying." in out
    assert "January sale" not in out
    assert not _DATED_PROMO_RE.search(out)


def test_strip_returns_unchanged_when_nothing_matches():
    text = "Switching typically saves around £15 a month, no strings attached."
    assert _strip_dated_promo_sentences(text) == text


def test_strip_blank_input_returns_blank():
    assert _strip_dated_promo_sentences("") == ""
    assert _strip_dated_promo_sentences(None) is None


def test_strip_all_promo_sentence_leaves_nothing():
    text = "Look out for a Black Friday deal on annual plans."
    assert _strip_dated_promo_sentences(text) == ""


# ── retry feedback (item 1: is the retry blind?) ────────────────────────────

def test_second_attempt_prompt_carries_dated_promo_violation_feedback(monkeypatch):
    """First attempt trips the guardrail; the SECOND attempt's prompt must
    name the specific failure and how to fix it, not just blindly re-ask the
    same question. This is the check that rules out 'blind regeneration' as
    the root cause of the double failure."""
    sink: list = []
    _patch_keys(monkeypatch)
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body(
                "Cut your streaming bill",
                "There's a January sale ending soon on annual plans.",
            )),  # attempt 0: dated promo, no claim_valid_until -> violation
            _FakeResponse(200, _llm_body(
                "Cut your streaming bill",
                "Bundling typically saves a few pounds a month.",
            )),  # attempt 1: clean
        ],
        sink,
    )

    result = _run(_generate_savings_insight_content("subscriptions", None, None))

    assert result is not None
    # sink[0] = tavily call, sink[1] = attempt 0, sink[2] = attempt 1
    assert len(sink) == 3
    second_attempt_prompt = sink[2]["json"]["messages"][0]["content"]
    assert "your previous answer" in second_attempt_prompt
    assert "claim_valid_until" in second_attempt_prompt
    assert "time-bound offer" in second_attempt_prompt


# ── strip fallback: second violation -> survive rather than drop ───────────

def test_second_violation_strips_and_persists_survivors(monkeypatch, caplog):
    _patch_keys(monkeypatch)
    sink: list = []
    dated_body = (
        "Compare rolling monthly plans to avoid overpaying. "
        "There's a January sale ending soon on annual plans."
    )
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body("Cut your streaming bill", dated_body)),  # attempt 0
            _FakeResponse(200, _llm_body("Cut your streaming bill", dated_body)),  # attempt 1 (still violates)
        ],
        sink,
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("subscriptions", None, None))

    assert result is not None
    assert "Compare rolling monthly plans to avoid overpaying." in result["body"]
    assert "January sale" not in result["body"]
    assert not _DATED_PROMO_RE.search(f"{result['title']} {result['body']}")
    # The dated claim was stripped out, not kept with a real expiry attached.
    assert result["claim_valid_until"] is None

    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("stripped offending sentence" in m and "category=subscriptions" in m for m in warnings)


def test_stripped_content_never_matches_dated_promo_regex_unexpired(monkeypatch):
    """Belt-and-braces assertion (item 3): whatever survives the strip must
    never itself still match _DATED_PROMO_RE, since claim_valid_until is None
    on this path."""
    _patch_keys(monkeypatch)
    sink: list = []
    dated_body = "Ask about the Black Friday deal, it ends in November. Otherwise plans are evergreen."
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body("Cut your gym costs", dated_body)),
            _FakeResponse(200, _llm_body("Cut your gym costs", dated_body)),
        ],
        sink,
    )

    result = _run(_generate_savings_insight_content("gym", None, None))

    assert result is not None
    combined = f"{result['title']} {result['body']}"
    assert not _DATED_PROMO_RE.search(combined)
    assert result["claim_valid_until"] is None


def test_nothing_survives_strip_returns_none(monkeypatch, caplog):
    """When the ENTIRE body (and title) is the dated-promo claim, stripping
    leaves nothing meaningful -> the function must still return None (the
    caller turns that into a 502), not a hollow card."""
    _patch_keys(monkeypatch)
    sink: list = []
    all_promo_body = "Look out for a Black Friday deal on annual plans."
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body("", all_promo_body)),
            _FakeResponse(200, _llm_body("", all_promo_body)),
        ],
        sink,
    )

    with caplog.at_level("WARNING", logger="app.routers.savings_insights"):
        result = _run(_generate_savings_insight_content("subscriptions", None, None))

    assert result is None
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("dated-promo strip left nothing usable" in m and "category=subscriptions" in m for m in warnings)


def test_savings_estimate_revalidated_after_strip(monkeypatch):
    """savings_estimate on the strip-fallback path still goes through the
    same derivability guard as the normal success path — a number that
    survives only because the model invented it must still be nulled."""
    _patch_keys(monkeypatch)
    sink: list = []
    dated_body = (
        "Compare rolling monthly plans to avoid overpaying. "
        "There's a January sale ending soon on annual plans."
    )
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body("Cut your streaming bill", dated_body, savings_estimate="~£999/mo")),
            _FakeResponse(200, _llm_body("Cut your streaming bill", dated_body, savings_estimate="~£999/mo")),
        ],
        sink,
    )

    result = _run(_generate_savings_insight_content("subscriptions", None, None))

    assert result is not None
    # £999 traces to nothing in the tavily snippets/user context above -> nulled.
    assert result["savings_estimate"] is None


def test_first_attempt_dated_promo_with_working_claim_valid_until_needs_no_strip(monkeypatch):
    """Control case: when the model DOES supply a usable claim_valid_until on
    the very first attempt, the strip fallback is never reached and the real
    date is kept."""
    _patch_keys(monkeypatch)
    sink: list = []
    dated_body = "There's a January sale ending on 2027-01-31 for new subscribers."
    _patch_client_queue(
        monkeypatch,
        [
            _FakeResponse(200, TAVILY_SUCCESS_BODY),
            _FakeResponse(200, _llm_body(
                "Cut your streaming bill", dated_body, claim_valid_until="2027-01-31",
            )),
        ],
        sink,
    )

    result = _run(_generate_savings_insight_content("subscriptions", None, None))

    assert result is not None
    assert result["claim_valid_until"] is not None
    assert result["claim_valid_until"].year == 2027
    assert "January sale" in result["body"]
    assert len(sink) == 2  # no second attempt needed
