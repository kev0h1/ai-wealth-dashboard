"""Unit tests for app.services.penny_agent (the ground-up loop-first
rebuild's tool-calling loop, see PENNY_TOOLS.md) plus the seam wiring in
app.routers.can_i's `can_i()` endpoint, which now runs this loop for every
question that isn't a greeting, a length/API-key gate, or a scenario ask —
not as a fallback behind a deterministic ladder, which no longer exists.

Mirrors test_can_i.py's conventions: `httpx` is a true singleton module, so
`monkeypatch.setattr(<any_module>.httpx, "AsyncClient", Fake)` patches the
SAME attribute every other module's `import httpx` sees.

run_penny_agent's contract (see that module's own docstring): a dict on
success, `None` on ANY failure whatsoever, never raises to the caller.
"""
import asyncio
import json
import time

import httpx

import app.routers.can_i as can_i_module
import app.services.penny_agent as penny_agent_module
import app.services.affordability as affordability_module
import app.services.penny_tools as penny_tools_module
from app.services.penny_agent import run_penny_agent
from app.services.penny_tools import execute_tool


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def _tool_call_payload(name: str, args: dict, call_id: str = "call_1") -> _FakeResponse:
    return _FakeResponse(payload={
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)},
                }],
            },
        }],
    })


def _final_payload(text: str) -> _FakeResponse:
    return _FakeResponse(payload={"choices": [{"message": {"content": text}}]})


class _ScriptedAsyncClient:
    """httpx.AsyncClient stand-in that returns one scripted response (or
    raises one scripted exception) per call, in order — records every
    request payload so a test can assert on `tool_choice`/`messages`."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        item = self._responses[len(self.calls) - 1] if len(self.calls) <= len(self._responses) else self._responses[-1]
        if isinstance(item, Exception):
            raise item
        return item


# ── 1. One tool call, then a well-formed final answer ───────────────────────

def test_run_penny_agent_one_tool_call_then_final_answer(monkeypatch):
    client = _ScriptedAsyncClient([
        _tool_call_payload("get_safe_to_spend", {}),
        _final_payload("HEADLINE: You have headroom\nREPLY: You have £100 free until payday."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        assert name == "get_safe_to_spend"
        return {"safe_to_spend": {"raw": 100.0, "formatted": "£100"}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))

    assert result is not None
    assert result["headline"] == "You have headroom"
    assert result["reply"] == "You have £100 free until payday."
    assert result["tools_used"] == ["get_safe_to_spend"]
    assert len(client.calls) == 2
    # First call offers tools with tool_choice="auto"; the tool result was
    # fed back as a role="tool" message with the matching call id.
    assert client.calls[0]["tool_choice"] == "auto"
    tool_messages = [m for m in client.calls[1]["messages"] if m.get("role") == "tool"]
    assert len(tool_messages) == 1
    assert tool_messages[0]["tool_call_id"] == "call_1"
    assert json.loads(tool_messages[0]["content"])["safe_to_spend"]["formatted"] == "£100"


# ── 2. Model returns tool_calls forever -> capped at 4 model calls, None ───

def test_run_penny_agent_infinite_tool_calls_stops_at_cap(monkeypatch):
    # Every response (including the 4th, forced-final, round) keeps
    # returning tool_calls with no text content — the forced tool_choice
    # "none" on round 4 is a request-side signal, not something this fake
    # model actually honours, so round 4 still yields no parseable answer
    # and the loop must give up rather than ever issuing a 5th call.
    always_tool_call = _tool_call_payload("get_safe_to_spend", {})
    client = _ScriptedAsyncClient([always_tool_call] * 10)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        return {"ok": True}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))

    assert result is None
    assert len(client.calls) == 4
    # Round 4 (the last one made) was forced to tool_choice="none".
    assert client.calls[-1]["tool_choice"] == "none"


# ── 3. OpenRouter HTTP failure on the first call -> None, no exception ─────

def test_run_penny_agent_http_error_returns_none(monkeypatch):
    client = _ScriptedAsyncClient([httpx.ConnectError("boom")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("no tool should be reached, the HTTP call itself failed")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))
    assert result is None


def test_run_penny_agent_non_200_returns_none(monkeypatch):
    client = _ScriptedAsyncClient([_FakeResponse(status_code=500, payload={})])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))
    assert result is None


# ── 4. Malformed final text (no HEADLINE:/REPLY: lines) -> None ────────────

def test_run_penny_agent_malformed_final_text_returns_none(monkeypatch):
    client = _ScriptedAsyncClient([_final_payload("Sure, you can spend £50.")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))
    assert result is None


# ── Off-topic sentinel: the model's OWN decline, not a phrased refusal ──────
# Fix 2 of the independent audit, 2026-08-26: letting the model phrase its
# own "that's outside what I can help with" would parse as a normal
# HEADLINE/REPLY pair, mislabelling a genuinely off-topic question as
# answered (out_of_scope False) — can_i.py's long-standing invariant is the
# opposite (off-topic gets the fixed refusal, never an LLM-phrased answer).
# The sentinel closes that gap: a bare "OUT_OF_SCOPE" final message is
# treated exactly like any other failure.

def test_run_penny_agent_out_of_scope_sentinel_returns_none(monkeypatch):
    client = _ScriptedAsyncClient([_final_payload("OUT_OF_SCOPE")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("an off-topic decline must never call a tool")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "what's the weather like today", [], None, ""))
    assert result is None


def test_run_penny_agent_out_of_scope_sentinel_logs_warning(monkeypatch, caplog):
    # Observability sweep, owner phone report 2026-08-28: this branch is a
    # documented FAILURE path (module docstring's "Failure doctrine" —
    # returns None, drives the caller to the generic refusal) but used to
    # log at .info(), invisible under prod's effective logging threshold —
    # promoted to .warning() alongside the round-cap/HTTP-error/unparseable-
    # answer siblings that already logged at that level.
    client = _ScriptedAsyncClient([_final_payload("OUT_OF_SCOPE")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    with caplog.at_level("INFO", logger="app.services.penny_agent"):
        result = asyncio.run(run_penny_agent("kevin", "what's the weather like today", [], None, ""))

    assert result is None
    decline_records = [r for r in caplog.records if "declined off-topic" in r.message]
    assert len(decline_records) == 1
    assert decline_records[0].levelname == "WARNING"


def test_run_penny_agent_out_of_scope_sentinel_with_trailing_text_returns_none(monkeypatch):
    # Belt-and-braces: the model adding stray trailing punctuation/whitespace
    # after the sentinel must not defeat detection (`.startswith`, not just
    # exact equality, after stripping).
    client = _ScriptedAsyncClient([_final_payload("OUT_OF_SCOPE\n")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    result = asyncio.run(run_penny_agent("kevin", "what's the weather like today", [], None, ""))
    assert result is None


# ── Hard wall-clock ceiling — fix 1 of the independent audit ────────────────
# The SOFT `_WALL_CLOCK_BUDGET_S` check inside the loop only changes what the
# NEXT request asks for; it does nothing to bound a request already in
# flight. `asyncio.wait_for` around the whole loop is the real ceiling: a
# client whose `post()` hangs well past the (tiny, monkeypatched) budget
# must be cut off close to budget+grace, not left running to completion —
# proving actual cancellation, not just a slow test.

class _HangingAsyncClient:
    def __init__(self, sleep_seconds: float):
        self._sleep_seconds = sleep_seconds
        self.calls = 0

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls += 1
        await asyncio.sleep(self._sleep_seconds)
        return _final_payload("HEADLINE: too slow\nREPLY: should never be reached.")


def test_run_penny_agent_wall_clock_ceiling_fires_before_round_cap(monkeypatch):
    # Budget+grace monkeypatched down to 0.2s total; the fake model call
    # hangs for 5s (would otherwise take up to 4 x 15s = 60s to give up via
    # the round cap alone).
    monkeypatch.setattr(penny_agent_module, "_WALL_CLOCK_BUDGET_S", 0.1)
    monkeypatch.setattr(penny_agent_module, "_WALL_CLOCK_GRACE_S", 0.1)
    client = _HangingAsyncClient(sleep_seconds=5.0)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    started = time.monotonic()
    result = asyncio.run(run_penny_agent("kevin", "how much can I spend", [], None, ""))
    elapsed = time.monotonic() - started

    assert result is None
    # Cut off close to the (monkeypatched) 0.2s ceiling, nowhere near the
    # 5s the hanging call was scripted to take, and nowhere near 4 x 15s.
    assert elapsed < 1.0
    assert client.calls == 1


# ── 5. execute_tool with an unknown tool name -> error dict, never raises ──

def test_execute_tool_unknown_name_returns_error_dict():
    result = asyncio.run(execute_tool("kevin", "not_a_real_tool", {}))
    assert result == {"error": "unknown tool: not_a_real_tool"}


# ── 6. Seam wiring in can_i.py — the loop is now the PRIMARY path, not a
# fallback behind a deterministic ladder (the ladder was deleted outright in
# the ground-up rebuild, see PENNY_TOOLS.md) ────────────────────────────────

class _RaisingFind:
    """commitments_col stand-in — see test_can_i.py's identical fixture:
    `_active_goals_summary` wraps its whole body in `except Exception:
    return []`, so a synchronous raise here is swallowed exactly like a
    real Mongo outage, giving an empty active-goals list without touching
    real Mongo."""
    def find(self, *args, **kwargs):
        raise RuntimeError("no real Mongo access in this test")


def _patch_can_i_common(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "commitments_col", _RaisingFind())


def test_can_i_seam_full_integration_success(monkeypatch):
    # Full integration, no stubbing of run_penny_agent itself: any ordinary
    # question (not a greeting, not scenario-shaped) reaches the REAL agent
    # loop directly, no ladder in front of it any more, which calls a tool
    # and gets a well-formed, in-scope money answer back from the (scripted)
    # model — this is the scenario the sentinel fix must NOT interfere with.
    # `penny_agent_module.httpx` is the same singleton `can_i_module.httpx`
    # patches elsewhere in this suite, so patching it here reaches the real
    # `run_penny_agent` call the seam makes.
    _patch_can_i_common(monkeypatch)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_safe_to_spend", {}),
        _final_payload("HEADLINE: You have headroom\nREPLY: You have £100 free until payday."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        return {"safe_to_spend": {"raw": 100.0, "formatted": "£100"}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    body = {"question": "what's the weather like today"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is False
    assert result["headline"] == "You have headroom"
    assert result["reply"] == "You have £100 free until payday."
    assert result["facts"] == []


def test_can_i_seam_full_integration_out_of_scope_sentinel_falls_back(monkeypatch):
    # Same full integration, but the (scripted) model correctly declines via
    # the OUT_OF_SCOPE sentinel — the seam must fall through to the existing
    # fixed refusal, exactly as if run_penny_agent had never been called at
    # all. This is the regression the independent audit flagged: without
    # the sentinel, a model-phrased decline would have parsed as a normal,
    # correctly-labelled answer for what is actually an off-topic question.
    _patch_can_i_common(monkeypatch)

    client = _ScriptedAsyncClient([_final_payload("OUT_OF_SCOPE")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("an off-topic decline must never call a tool")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)

    body = {"question": "what's the weather like today"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is True
    assert result["headline"] == "That one's outside what I can work out from your numbers."


def test_can_i_seam_falls_back_to_refusal_when_agent_returns_none(monkeypatch):
    _patch_can_i_common(monkeypatch)

    async def fake_agent(uid, question, history, screen, context):
        return None

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    async def fake_sts(uid):
        return {"status": "ok", "safe_to_spend": 100.0, "days_until_payday": 5}

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)

    body = {"question": "what's the weather like today"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is True
    assert result["headline"] == "That one's outside what I can work out from your numbers."


# ── 7. check_affordability tool — the verdict word passes through
# untouched. `execute_tool` dispatches to `_exec_check_affordability`, which
# calls `app.services.affordability.check_affordability` (imported into
# penny_tools.py as `_check_affordability`) and returns its dict verbatim —
# no reshaping, no re-deriving. Monkeypatching that one call point proves
# the tool layer never touches the verdict itself. ──────────────────────────

def test_check_affordability_tool_verdict_word_passes_through_untouched(monkeypatch):
    async def fake_check_affordability(uid, amount, timeframe=None):
        assert uid == "kevin"
        assert amount == 45.0
        assert timeframe is None
        return {
            "verdict": "£45 leaves £149 free",
            "verdict_word": "yes",
            "safe_to_spend": {"raw": 194.0, "formatted": "£194"},
        }

    monkeypatch.setattr(penny_tools_module, "_check_affordability", fake_check_affordability)

    result = asyncio.run(execute_tool("kevin", "check_affordability", {"amount": 45}))
    assert result["verdict"] == "£45 leaves £149 free"
    assert result["verdict_word"] == "yes"


def test_check_affordability_tool_passes_timeframe_through(monkeypatch):
    captured = {}

    async def fake_check_affordability(uid, amount, timeframe=None):
        captured["timeframe"] = timeframe
        return {"verdict": "That fits", "verdict_word": None}

    monkeypatch.setattr(penny_tools_module, "_check_affordability", fake_check_affordability)

    result = asyncio.run(execute_tool("kevin", "check_affordability", {"amount": 2000, "timeframe": "October 2027"}))
    assert captured["timeframe"] == "October 2027"
    assert result["verdict"] == "That fits"


def test_check_affordability_tool_rejects_non_numeric_amount():
    result = asyncio.run(execute_tool("kevin", "check_affordability", {"amount": "not a number"}))
    assert "error" in result


# ── 8. get_category_spend tool — aggregates computed server-side (never
# summed by the model), top merchants present ───────────────────────────────

def test_get_category_spend_tool_returns_server_side_aggregate_and_top_merchants(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {
            "period": {"start": "2026-08-01", "end": "2026-08-28"},
            "notables": [{"category": "Entertainment", "spent": 231.0, "payments_count": 16}],
            "majority": [{"category": "Groceries", "spent": 120.0, "payments_count": 8}],
        }

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", fake_verdict)

    async def fake_txn_rows(uid, category, start, end):
        assert category == "Entertainment"
        return [
            {"amount": 60.0, "merchant_name": "Daniel Maingi", "description": None},
            {"amount": 40.0, "merchant_name": "Daniel Maingi", "description": None},
            {"amount": 30.0, "merchant_name": "Google Play", "description": None},
            {"amount": 10.0, "merchant_name": "Netflix", "description": None},
        ]

    monkeypatch.setattr(penny_tools_module, "_category_txn_rows", fake_txn_rows)

    result = asyncio.run(execute_tool("kevin", "get_category_spend", {"category": "Entertainment"}))

    # Server-computed totals from the engine's own aggregate, never re-summed.
    assert result["this_period"]["spent"]["raw"] == 231.0
    assert result["this_period"]["payments_count"] == 16
    # Top merchants, ranked and totalled server-side.
    assert result["top_merchants"][0]["merchant"] == "Daniel Maingi"
    assert result["top_merchants"][0]["spent"]["raw"] == 100.0
    assert len(result["top_merchants"]) <= 3


def test_get_category_spend_tool_with_no_category_returns_top_categories(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {
            "period": {"start": "2026-08-01", "end": "2026-08-28"},
            "notables": [{"category": "Entertainment", "spent": 231.0, "payments_count": 16}],
            "majority": [{"category": "Groceries", "spent": 120.0, "payments_count": 8}],
        }

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", fake_verdict)

    result = asyncio.run(execute_tool("kevin", "get_category_spend", {}))
    assert "top_categories" in result
    labels = [c["category"] for c in result["top_categories"]]
    assert labels[0] == "Entertainment"  # highest spend first


def test_get_category_spend_tool_last_n_months_uses_rolling_window(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {"period": {"start": "2026-08-01", "end": "2026-08-28"}, "notables": [], "majority": []}

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", fake_verdict)

    async def fake_txn_rows(uid, category, start, end):
        return [{"amount": 25.0, "merchant_name": "Tesco", "description": None}] * 3

    monkeypatch.setattr(penny_tools_module, "_category_txn_rows", fake_txn_rows)

    result = asyncio.run(execute_tool("kevin", "get_category_spend", {"category": "Groceries", "months": 3}))
    assert result["last_n_months"]["months"] == 3
    assert result["last_n_months"]["spent"]["raw"] == 75.0
    assert result["last_n_months"]["payments_count"] == 3


# ── 9. Integration: an advice-shaped question reaches the loop, not any
# deterministic route — the exact motivating bug for this rebuild. "How can
# I improve my entertainment spending" used to be captured by a category-
# synonym match in the deleted ladder and answered with a bare current-period
# total ("£231 on Entertainment this period / Across 16 payments"); the loop
# must call get_category_spend itself and phrase an answer using the facts
# (total, pace comparison, top merchant), never a prescription. ─────────────

def test_can_i_entertainment_advice_question_reaches_the_loop_not_a_deterministic_route(monkeypatch):
    _patch_can_i_common(monkeypatch)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_category_spend", {"category": "Entertainment"}),
        _final_payload(
            "HEADLINE: Entertainment is running hot\n"
            "REPLY: Entertainment is £231 across 16 payments this period, about 4x your "
            "usual pace. Daniel Maingi and Google Play drive most of it."
        ),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    tool_calls_made = []

    async def fake_execute_tool(uid, name, args):
        tool_calls_made.append(name)
        return {
            "this_period": {"spent": {"raw": 231.0, "formatted": "£231"}, "payments_count": 16},
            "top_merchants": [
                {"merchant": "Daniel Maingi", "spent": {"raw": 100.0, "formatted": "£100"}},
                {"merchant": "Google Play", "spent": {"raw": 60.0, "formatted": "£60"}},
            ],
        }

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    body = {"question": "How can I improve my entertainment spending"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    # The loop was reached (a tool was actually called via the real
    # run_penny_agent, not a fixed deterministic reply) and answered the
    # question asked, not a bare current-period total.
    assert tool_calls_made == ["get_category_spend"]
    assert result["out_of_scope"] is False
    assert "£231" in result["reply"]
    assert "Daniel Maingi" in result["reply"] or "Google Play" in result["reply"]


# ── 10. Tax-mechanics question: no tool call needed, doctrine-shaped
# answer accepted straight from the model's general knowledge (system
# prompt rule 9) ─────────────────────────────────────────────────────────

def test_can_i_tax_mechanics_question_needs_no_tool_call(monkeypatch):
    _patch_can_i_common(monkeypatch)

    client = _ScriptedAsyncClient([
        _final_payload(
            "HEADLINE: Tapers above £100,000\n"
            "REPLY: This tax year, the personal allowance tapers above £100,000 of "
            "adjusted net income and is lost entirely by £125,140."
        ),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("a general tax-mechanics question needs no tool call")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    body = {"question": "When does the personal allowance start tapering?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert result["out_of_scope"] is False
    assert "£100,000" in result["reply"]
    assert len(client.calls) == 1  # answered on the first round, no tool round


# ── 11. Independent audit fixes, 2026-08-26 ─────────────────────────────────

# Fix 1 — get_category_spend's raw-transaction reads must apply the same
# home-currency filter app.services.spend_verdict._load_period_txns uses, so
# last_n_months/top_merchants can never disagree with this_period (which
# already goes through that filtered engine) for the same category.

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeCollection:
    def __init__(self, docs):
        self._docs = docs

    def find(self, query, proj=None):
        return _FakeCursor(self._docs)

    async def find_one(self, query, proj=None):
        return self._docs[0] if self._docs else None


def test_category_txn_rows_filters_foreign_currency_rows(monkeypatch):
    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(penny_tools_module, "get_user_region", fake_region)
    monkeypatch.setattr(penny_tools_module, "transactions_col", _FakeCollection([
        {"amount": 50.0, "category": "Groceries", "currency": "GBP", "merchant_name": "Tesco"},
        {"amount": 999.0, "category": "Groceries", "currency": "KES", "merchant_name": "Naivas"},
        {"amount": 20.0, "category": "Groceries", "merchant_name": "Sainsbury's"},  # no currency key -> kept
    ]))
    monkeypatch.setattr(penny_tools_module, "yapily_transactions_col", _FakeCollection([]))

    from datetime import datetime as _dt
    rows = asyncio.run(penny_tools_module._category_txn_rows(
        "kevin", "Groceries", _dt(2026, 8, 1), _dt(2026, 8, 28),
    ))
    merchants = {r["merchant_name"] for r in rows}
    assert "Naivas" not in merchants  # foreign-currency row dropped
    assert merchants == {"Tesco", "Sainsbury's"}


# Fix 2 — get_upcoming_bills must compute live on a cache miss (mirroring
# GET /cashflow's own miss branch), never a false "no account data
# connected yet" refusal for a newly-synced user who just hasn't had a
# cache doc written yet.

def test_get_upcoming_bills_computes_live_on_cache_miss(monkeypatch):
    async def fake_find_one_miss(query, proj=None):
        return None

    monkeypatch.setattr(penny_tools_module.cashflow_cache_col, "find_one", fake_find_one_miss)
    monkeypatch.setattr(penny_tools_module, "accounts_col", _FakeCollection([{"_id": "acc1"}]))
    monkeypatch.setattr(penny_tools_module, "yapily_accounts_col", _FakeCollection([]))

    computed = {"called": False}

    async def fake_compute_patterns(uid):
        computed["called"] = True
        return {"recurring_spend": [], "recurring_income": []}

    monkeypatch.setattr(penny_tools_module, "_compute_cashflow_patterns", fake_compute_patterns)

    async def fake_update_one(*a, **kw):
        return None

    monkeypatch.setattr(penny_tools_module.cashflow_cache_col, "update_one", fake_update_one)

    async def fake_build_response(cached, uid=None):
        return {
            "upcoming_bills": [{"name": "Council Tax", "amount": 150.0, "expected_date": "2026-09-01", "days_away": 4, "kind": "commitment"}],
            "upcoming_income": [],
        }

    monkeypatch.setattr(penny_tools_module, "_build_cashflow_response", fake_build_response)

    result = asyncio.run(penny_tools_module._exec_get_upcoming_bills("kevin"))
    assert computed["called"] is True
    assert "insufficient_data" not in result
    assert result["upcoming_bills"][0]["name"] == "Council Tax"


def test_get_upcoming_bills_insufficient_data_only_when_no_accounts_at_all(monkeypatch):
    async def fake_find_one_miss(query, proj=None):
        return None

    monkeypatch.setattr(penny_tools_module.cashflow_cache_col, "find_one", fake_find_one_miss)
    monkeypatch.setattr(penny_tools_module, "accounts_col", _FakeCollection([]))
    monkeypatch.setattr(penny_tools_module, "yapily_accounts_col", _FakeCollection([]))

    async def fail_compute_patterns(uid):
        raise AssertionError("must not compute live with zero connected accounts")

    monkeypatch.setattr(penny_tools_module, "_compute_cashflow_patterns", fail_compute_patterns)

    result = asyncio.run(penny_tools_module._exec_get_upcoming_bills("kevin"))
    assert result == {"insufficient_data": True, "reason": "no account data connected yet"}


# Fix 3 — get_tax_position exposes the user's OWN figures (the deleted
# ladder's tax-routing branch always injected these from
# chat.answer_tax_question; the loop's general tax-mechanics doctrine has
# no equivalent without this tool). Figures pass through untouched.

def test_get_tax_position_tool_returns_users_own_figures_untouched(monkeypatch):
    async def fake_fact_pack(uid):
        return {
            "income": 132000.0,
            "income_known": True,
            "income_bracket": "",
            "pension_annual": 8000.0,
            "adjusted_net_income": 124000.0,
            "personal_allowance_remaining": 1000.0,
            "personal_allowance_taper_over": 24000.0,
            "allowance_line": "Personal allowance: £1,000 remaining, needs £24,000 more pension to restore in full",
            "income_line": "£132,000",
            "has_child_benefit": False,
        }

    monkeypatch.setattr(penny_tools_module, "build_tax_fact_pack", fake_fact_pack)

    result = asyncio.run(execute_tool("kevin", "get_tax_position", {}))
    assert result["income"]["raw"] == 132000.0
    assert result["adjusted_net_income"]["raw"] == 124000.0
    assert result["personal_allowance_remaining"]["raw"] == 1000.0
    assert result["personal_allowance_line"] == (
        "Personal allowance: £1,000 remaining, needs £24,000 more pension to restore in full"
    )
    assert result["has_child_benefit"] is False


def test_get_tax_position_tool_insufficient_data_when_income_not_entered(monkeypatch):
    async def fake_fact_pack(uid):
        return {"income": 0.0, "income_known": False, "income_bracket": "50k-75k"}

    monkeypatch.setattr(penny_tools_module, "build_tax_fact_pack", fake_fact_pack)

    result = asyncio.run(execute_tool("kevin", "get_tax_position", {}))
    assert result.get("insufficient_data") is True


def test_can_i_personal_allowance_question_calls_get_tax_position(monkeypatch):
    # End-to-end: the loop must reach get_tax_position for a question about
    # the user's OWN allowance, not answer from general knowledge alone.
    _patch_can_i_common(monkeypatch)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_tax_position", {}),
        _final_payload(
            "HEADLINE: £1,000 of allowance left\n"
            "REPLY: You have £1,000 of personal allowance remaining this tax year."
        ),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    tool_calls_made = []

    async def fake_execute_tool(uid, name, args):
        tool_calls_made.append(name)
        return {
            "tax_year": "2026/27",
            "personal_allowance_remaining": {"raw": 1000.0, "formatted": "£1,000"},
            "personal_allowance_line": "Personal allowance: £1,000 remaining, needs £24,000 more pension to restore in full",
        }

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    body = {"question": "How much personal allowance do I have left?"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert tool_calls_made == ["get_tax_position"]
    assert "£1,000" in result["reply"]


# Fix 4 — the restored ask-when nudge: check_affordability sets `ask_when`
# for a large dateless amount (reusing the deleted predicate's own 0.5-of-
# envelope threshold), never for a small one.

def _patch_affordability_common(monkeypatch, safe_to_spend, days_until_payday=10):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": safe_to_spend, "days_until_payday": days_until_payday,
            "next_payday": "2026-09-05", "state": "comfortable", "short_reason": None, "bills_total": 0.0,
        }

    monkeypatch.setattr(affordability_module, "compute_safe_to_spend", fake_sts)

    async def fake_region(uid):
        return "UK"

    monkeypatch.setattr(affordability_module, "get_user_region", fake_region)

    async def fake_cashflow(uid, region, cutoff):
        return (0.0, 0.0, 0.0)

    monkeypatch.setattr(affordability_module, "_cashflow", fake_cashflow)


def test_check_affordability_ask_when_flag_for_large_dateless_amount(monkeypatch):
    _patch_affordability_common(monkeypatch, safe_to_spend=200.0)
    # 150 >= 0.5 * 200 -> large relative to the envelope, no timeframe given.
    result = asyncio.run(affordability_module.check_affordability("kevin", 150.0, None))
    assert result["ask_when"] is True
    assert result["timeframe_assumed"] == "current_period"


def test_check_affordability_no_ask_when_flag_for_small_amount(monkeypatch):
    _patch_affordability_common(monkeypatch, safe_to_spend=200.0)
    # 20 < 0.5 * 200 -> not large enough to trip the nudge.
    result = asyncio.run(affordability_module.check_affordability("kevin", 20.0, None))
    assert "ask_when" not in result
    assert "timeframe_assumed" not in result


def test_check_affordability_no_ask_when_flag_when_timeframe_given(monkeypatch):
    _patch_affordability_common(monkeypatch, safe_to_spend=200.0)
    result = asyncio.run(affordability_module.check_affordability("kevin", 150.0, "December"))
    assert "ask_when" not in result


def test_check_affordability_ask_when_true_when_envelope_already_short(monkeypatch):
    # safe_to_spend <= 0 -> no positive envelope to take a fraction of, any
    # positive amount with no timeframe counts as large (same rule the
    # deleted predicate applied).
    _patch_affordability_common(monkeypatch, safe_to_spend=-40.0)
    result = asyncio.run(affordability_module.check_affordability("kevin", 5.0, None))
    assert result["ask_when"] is True


# ── Elliptical-follow-up format-drop bug, 2026-08-30 ────────────────────────
# Owner-reported: "What were my unplaced transactions" answered fine, then
# "What about last month" (the plain elliptical follow-up, inheriting the
# prior turn's subject) got the generic out-of-scope refusal. Traced with
# live instrumentation (not committed) to app.services.penny_agent, not to
# history handling: the model correctly used the two-turn history to infer
# the same subject, correctly re-called get_spend_verdict for the changed
# window, and produced a real, tool-grounded answer — but wrote it as bare
# prose with no HEADLINE:/REPLY: labels (mimicking the unlabelled shape of
# rule 8's own advice-shaped example, since fixed). The strict parser
# rejected the whole answer as "malformed", which run_penny_agent's failure
# contract makes indistinguishable from a genuine refusal, so can_i.py's
# seam fell back to the fixed "outside what I can work out" refusal and
# discarded a correct answer.
#
# Fix: `_parse_headline_reply_or_none` gained a narrow, tool-grounded
# fallback (`has_tool_grounding=True`, set whenever this call's own
# `tools_used` is non-empty) — unlabelled-but-substantial content is
# accepted as the reply verbatim with a headline synthesised from its first
# sentence, rather than discarded. A round that never called a tool keeps
# the original strict all-or-nothing behaviour (test 4 above,
# `test_run_penny_agent_malformed_final_text_returns_none`, already covers
# and continues to cover that path unchanged).

def test_parse_headline_reply_or_none_well_formed_ignores_grounding_flag():
    # The ordinary, already-covered path: correctly labelled content parses
    # the same whether or not a tool was called.
    raw = "HEADLINE: You have headroom\nREPLY: You have £100 free until payday."
    assert penny_agent_module._parse_headline_reply_or_none(raw, has_tool_grounding=False) == (
        "You have headroom", "You have £100 free until payday.",
    )
    assert penny_agent_module._parse_headline_reply_or_none(raw, has_tool_grounding=True) == (
        "You have headroom", "You have £100 free until payday.",
    )


def test_parse_headline_reply_or_none_unlabelled_without_grounding_stays_none():
    # No tool was ever called this turn -> the fallback must NOT fire, this
    # is exactly the shape a genuine hallucination or off-topic answer would
    # also take. Strict behaviour preserved.
    raw = "Sure, you can spend £50."
    assert penny_agent_module._parse_headline_reply_or_none(raw, has_tool_grounding=False) is None


def test_parse_headline_reply_or_none_unlabelled_with_grounding_falls_back():
    # The exact motivating bug: a real, tool-grounded answer with the
    # HEADLINE:/REPLY: labels dropped must now be accepted rather than
    # thrown away.
    raw = (
        "Last month you had £85 of unplaced transactions across 2 payments, "
        "the largest being £46 from Shift4 on 15 August. This is routine "
        "and not material to your overall picture."
    )
    result = penny_agent_module._parse_headline_reply_or_none(raw, has_tool_grounding=True)
    assert result is not None
    headline, reply = result
    assert reply == raw
    assert headline  # a non-empty synthesised headline
    assert len(headline) <= 60


def test_parse_headline_reply_or_none_trivial_content_with_grounding_stays_none():
    # Too short to be a real answer even with grounding -- guards against a
    # near-empty/garbage final message being dressed up as a valid reply.
    assert penny_agent_module._parse_headline_reply_or_none("ok", has_tool_grounding=True) is None
    assert penny_agent_module._parse_headline_reply_or_none("", has_tool_grounding=True) is None


def test_parse_headline_reply_or_none_out_of_scope_text_with_grounding_stays_none():
    # Defense in depth: even if somehow reached with tool grounding, the
    # bare sentinel itself must never be treated as a real answer (the live
    # loop already intercepts OUT_OF_SCOPE before ever calling this parser,
    # this is a second, independent guard against a future refactor).
    assert penny_agent_module._parse_headline_reply_or_none(
        "OUT_OF_SCOPE", has_tool_grounding=True,
    ) is None


def test_parse_headline_reply_or_none_partial_labels_with_grounding_stays_none():
    # Only a REPLY: line, no HEADLINE: at all -- a genuinely broken partial
    # attempt at the contract, not the clean-absence shape the fallback is
    # scoped to. Must still surface as None, not be silently patched up.
    raw = "REPLY: You have £100 free until payday."
    assert penny_agent_module._parse_headline_reply_or_none(raw, has_tool_grounding=True) is None


def test_run_penny_agent_elliptical_followup_inherits_subject_and_reruns_tool(monkeypatch):
    """End-to-end reproduction of the reported two-turn exchange: turn 1
    ("What were my unplaced transactions") already answered and folded into
    history exactly as PennyConversation.tsx's buildHistory sends it (assistant
    content = the prior turn's `reply`, preferred over `headline`); turn 2
    ("What about last month") is the bare elliptical follow-up. The scripted
    model re-calls get_spend_verdict (proving history-driven subject
    inheritance reached a real tool call) and returns its final answer
    unlabelled, reproducing the exact drop this test suite is pinning the fix
    for."""
    history = [
        {"role": "user", "content": "What were my unplaced transactions"},
        {"role": "assistant", "content": "You don't have any transactions waiting to be categorised right now."},
    ]
    unlabelled_answer = (
        "Last month you had £85 of unplaced transactions across 2 payments, "
        "the largest being £46 from Shift4 on 15 August. This is routine "
        "and not material to your overall picture."
    )
    client = _ScriptedAsyncClient([
        _tool_call_payload("get_spend_verdict", {"period_offset": -1}),
        _final_payload(unlabelled_answer),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        assert name == "get_spend_verdict"
        return {"unresolved": {"count": 2, "largest": {"display_name": "Shift4", "amount": {"formatted": "£46"}}}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "What about last month", history, "spend", ""))

    assert result is not None
    assert result["tools_used"] == ["get_spend_verdict"]
    assert result["reply"] == unlabelled_answer
    # The prior turn's history must actually have been sent to the model —
    # not dropped or truncated before the second request.
    sent_messages = client.calls[0]["messages"]
    sent_contents = [m.get("content") for m in sent_messages if m.get("role") in ("user", "assistant")]
    assert "What were my unplaced transactions" in sent_contents
    assert "You don't have any transactions waiting to be categorised right now." in sent_contents


def test_run_penny_agent_bitcoin_question_still_refuses(monkeypatch):
    # Genuine refusals must survive this fix untouched: the model declining
    # with the bare sentinel, even after a tool round, still returns None —
    # has_tool_grounding never overrides the OUT_OF_SCOPE check, which runs
    # before the parser is ever reached.
    client = _ScriptedAsyncClient([_final_payload("OUT_OF_SCOPE")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("should I buy bitcoin must never reach a tool call")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", "should I buy bitcoin", [], None, ""))
    assert result is None


# ── Owner-reported bug, 2026-08-31, verbatim (Home Penny sheet): "If we
# move 825£ from my Monzo account, how much will be left" got the generic
# out-of-scope refusal live. Diagnosis (see app.services.penny_agent's own
# dated comment on _WALL_CLOCK_BUDGET_S/_WALL_CLOCK_GRACE_S/
# _REQUEST_TIMEOUT_S) ruled out BOTH suspected gates and traced it to those
# three constants being too tight for real OpenRouter/Anthropic Haiku
# latency (10-25s/round observed, vs the ~2-4s the old 12s/15s budget
# assumed) — the loop was structurally unable to finish even one tool round
# before being cut off, regardless of routing or scope. These two tests
# cover the two halves of that fix. ─────────────────────────────────────────

def test_wall_clock_budget_wide_enough_for_realistic_multi_round_latency():
    """Regression pin: the budget must stay wide enough for a realistic
    2-3 round tool exchange (get_accounts, calculate, final answer) to
    actually finish, not silently shrink back toward the old 12s/15s figures
    that live-measured Anthropic Haiku 4.5 latency (10-25s per round trip,
    confirmed provider-side via a same-path control call to a much faster
    model) could never survive. Values themselves were live-verified against
    the exact reported question (~31-55s total, see this module's own
    comment on the constants)."""
    assert penny_agent_module._WALL_CLOCK_BUDGET_S >= 30.0
    assert (
        penny_agent_module._WALL_CLOCK_BUDGET_S + penny_agent_module._WALL_CLOCK_GRACE_S
    ) >= 50.0
    assert penny_agent_module._REQUEST_TIMEOUT_S >= 25.0


def test_run_penny_agent_account_move_arithmetic_question_reaches_tool_loop(monkeypatch):
    """Functional half of the fix: given tool results (mocked per this
    suite's own pattern, no live model/network call), the loop must reach
    get_accounts then calculate for this exact phrasing and quote their
    figures verbatim - proving the SHAPE of the question was always
    answerable once the loop actually got to run, which is what the widened
    wall-clock budget above now lets happen live."""
    from app.routers.scenario import looks_like_scenario

    question = "If we move 825£ from my Monzo account, how much will be left"
    # The scenario gate was the prime suspect ("If we...") - confirmed not
    # the cause, and pinned again here alongside the functional proof.
    assert not looks_like_scenario(question)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_accounts", {}, call_id="call_1"),
        _tool_call_payload("calculate", {"expression": "1051 - 825"}, call_id="call_2"),
        _final_payload(
            "HEADLINE: £226 left in Monzo\n"
            "REPLY: Your Monzo current account has £1,051 now. Moving £825 leaves £226."
        ),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    calls: list[str] = []

    async def fake_execute_tool(uid, name, args):
        calls.append(name)
        if name == "get_accounts":
            return {
                "accounts": [{
                    "name": "Kevin Mbithi Maingi", "provider": "MONZO", "type": "bank",
                    "balance": {"raw": 1051.0, "formatted": "£1,051"},
                }],
            }
        if name == "calculate":
            assert args["expression"] == "1051 - 825"
            return {"ok": True, "result": 226, "expression": "1051 - 825"}
        raise AssertionError(f"unexpected tool {name}")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent("kevin", question, [], "home", ""))

    assert result is not None
    assert calls == ["get_accounts", "calculate"]
    assert result["headline"] == "£226 left in Monzo"
    assert "£226" in result["reply"]
    assert result["tools_used"] == ["get_accounts", "calculate"]
