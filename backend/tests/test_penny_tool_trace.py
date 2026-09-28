"""B38 — the Penny tool-selection trace persisted onto `llm_usage_col`.

Before this item, `app.services.penny_agent`'s loop logged the tools it
chose (INFO level, `journalctl` only) and `app.core.llm.record_llm_usage`
wrote one usage doc per OpenRouter round, but nothing tied the two
together: no doc said WHICH tool(s) a given round's model response asked
to call, so a question could never be replayed from the database and the
routing bug that caused the loop-first rebuild (see PENNY_TOOLS.md) had no
regression net at the data layer either.

Fixed by extending the EXISTING per-round `llm_usage_col` doc (never a
second collection) with two fields, both written only when the caller
supplies `round_num` (currently only `app.services.penny_agent`, the only
caller that ever offers tool schemas to the model):

- `round`: the 1-indexed round this doc belongs to within its shared
  `message_id`.
- `tools_called`: the ordered list of tool NAMES that round's model
  response asked to call (`[]` on a round with no tool call, e.g. the
  final answer). Never the tool CALL ARGUMENTS — those may hold user data
  (see this item's own brief) — only the name.

Reading every doc sharing one `message_id`, sorted by `round`, and
concatenating each doc's `tools_called` reconstructs the whole question's
tool sequence with no second collection and no change to `record_llm_usage`'s
existing shape for any other pipeline (nothing else passes `round_num`,
so nothing else's docs gain these fields).

This test drives the REAL `run_penny_agent` loop (real system prompt, real
tool catalog, real round/consent/retry mechanics) with a scripted fake
OpenRouter client — see `app.services.penny_agent`'s own test file,
`test_penny_agent.py`, for the httpx-singleton-patching convention this
mirrors — and a fake `execute_tool` (real engine execution is out of scope
for a persistence test; `test_penny_golden_eval.py` covers tool
SELECTION against the real catalog in more depth). `llm_usage_col` itself
is faked too (same pattern `test_penny_agent.py`'s own metering tests
already use), so this never touches the real database at all.
"""
import asyncio
import json

import app.core.llm as llm_module
import app.services.penny_agent as penny_agent_module
from app.services.penny_agent import run_penny_agent


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload or {}
        self.headers = headers or {}

    def json(self):
        return self._payload


def _tool_call_payload(name: str, call_id: str = "call_1") -> _FakeResponse:
    return _FakeResponse(payload={
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": "{}"},
                }],
            },
        }],
    })


def _final_payload(text: str) -> _FakeResponse:
    return _FakeResponse(payload={"choices": [{"message": {"content": text}}]})


class _ScriptedAsyncClient:
    """Twin of `test_penny_agent.py`'s own class of the same name — kept
    local rather than imported so this file stays a self-contained
    regression test for the persistence contract, not coupled to that
    file's fixtures."""

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


class _FakeUsageCol:
    """Same shape as `test_penny_agent.py`'s own `_FakeUsageCol` — a
    Motor-collection stand-in exposing only the two calls
    `app.core.llm` makes (`create_index`, `insert_one`)."""

    def __init__(self):
        self.docs: list[dict] = []

    async def create_index(self, spec):
        pass

    async def insert_one(self, doc):
        self.docs.append(doc)


def _patched(monkeypatch):
    fake_usage = _FakeUsageCol()
    monkeypatch.setattr(llm_module, "llm_usage_col", fake_usage)
    monkeypatch.setattr(llm_module, "_indexes_ready", True)
    return fake_usage


# ── 1. One tool call, one final round: the doc carries round + tools ──────

def test_usage_doc_carries_round_and_tools_called_for_one_tool_call(monkeypatch):
    fake_usage = _patched(monkeypatch)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_safe_to_spend"),
        _final_payload("HEADLINE: Comfortable\nREPLY: You have £100 free until payday."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    called: list[str] = []

    async def fake_execute_tool(uid, name, args):
        called.append(name)
        return {"safe_to_spend": {"raw": 100.0, "formatted": "£100"}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent(
        "trace-test-uid", "how much can I spend", [], None, "",
    ))
    assert result is not None
    assert called == ["get_safe_to_spend"]

    # Two OpenRouter rounds happened (one tool round, one final round), so
    # two usage docs — this is the pre-existing per-round doc shape,
    # unchanged; what's new is that each one now names its own round and
    # tool selection.
    assert len(fake_usage.docs) == 2
    docs_by_round = {d["round"]: d for d in fake_usage.docs}
    assert set(docs_by_round) == {1, 2}
    assert docs_by_round[1]["tools_called"] == ["get_safe_to_spend"]
    assert docs_by_round[2]["tools_called"] == []
    # Every round of one question shares its message_id, unchanged from
    # before this item.
    message_ids = {d["message_id"] for d in fake_usage.docs}
    assert len(message_ids) == 1
    # Arguments never persisted — only the name (the brief's own
    # constraint: "not arguments, which may hold user data").
    for doc in fake_usage.docs:
        assert "args" not in doc
        assert "arguments" not in doc
        for name in doc["tools_called"]:
            assert isinstance(name, str)


# ── 2. Two tool rounds, then a final round: sequence + round order ────────

def test_usage_docs_reconstruct_the_whole_question_tool_sequence(monkeypatch):
    """The B38 brief's own acceptance shape: reading every doc sharing a
    message_id, ordered by `round`, and concatenating `tools_called`
    reconstructs the loop's real ordered tool sequence for the question —
    here, two tools called in two SEPARATE rounds (not one round with two
    tool_calls), so `round` is what actually distinguishes them, not list
    position within a single doc."""
    fake_usage = _patched(monkeypatch)

    client = _ScriptedAsyncClient([
        _tool_call_payload("get_safe_to_spend", call_id="call_1"),
        _tool_call_payload("get_upcoming_bills", call_id="call_2"),
        _final_payload("HEADLINE: Comfortable\nREPLY: £100 free, next bill in 3 days."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        return {"ok": True, "tool": name}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent(
        "trace-test-uid", "how much can I spend and what bills are coming up", [], None, "",
    ))
    assert result is not None
    assert result["tools_used"] == ["get_safe_to_spend", "get_upcoming_bills"]

    assert len(fake_usage.docs) == 3
    ordered = sorted(fake_usage.docs, key=lambda d: d["round"])
    assert [d["round"] for d in ordered] == [1, 2, 3]
    sequence = [name for d in ordered for name in d["tools_called"]]
    assert sequence == ["get_safe_to_spend", "get_upcoming_bills"]

    message_ids = {d["message_id"] for d in fake_usage.docs}
    assert len(message_ids) == 1


# ── 3. A pipeline that never passes round_num keeps the old doc shape ─────

def test_non_penny_pipeline_usage_doc_has_no_trace_fields(monkeypatch):
    """`round_num`/`tools_called` are populated ONLY by callers that pass
    `round_num` — today, only the Penny loop. Any other pipeline calling
    `record_llm_usage` directly (as every non-Penny OpenRouter call site
    does) must see byte-for-byte the same doc shape as before this item,
    since B38's brief requires extending the existing doc, not changing it
    for callers who never asked for a tool trace."""
    fake_usage = _patched(monkeypatch)

    asyncio.run(llm_module.record_llm_usage(
        user_id="someone", pipeline="categorisation", model="anthropic/claude-haiku-4-5",
        usage={"prompt_tokens": 10, "completion_tokens": 5, "cost": 0.001}, latency_ms=42,
    ))
    assert len(fake_usage.docs) == 1
    doc = fake_usage.docs[0]
    assert "round" not in doc
    assert "tools_called" not in doc
    assert "message_id" not in doc
