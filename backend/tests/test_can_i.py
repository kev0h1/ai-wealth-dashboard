"""Unit tests for app.routers.can_i's own surface after the ground-up
loop-first rebuild, 2026-08-26 (see PENNY_TOOLS.md). The ~4,900-line
deterministic ladder this file used to pin question-by-question (synonym
tables, per-domain handlers, per-screen vocabulary, follow-up-route
inheritance) is gone outright — that acceptance corpus retired along with
the ladder it pinned, see PENNY_TOOLS.md's own "what was deleted" note.

What survives here: the gates that still run before the Penny tool loop
(greeting, length, scenario), the wire shape of POST /can-i and GET
/can-i/suggestions, the deterministic refusal fallback, and usage-quota
discipline (charged once on a real answer, never on a refusal). The tool
loop's own mechanics (rounds, tool dispatch, the OUT_OF_SCOPE sentinel, the
seam wiring into can_i()) are covered in test_penny_agent.py, not here.
"""
import asyncio

import app.routers.can_i as can_i_module
from app.routers.can_i import (
    _fmt_gbp,
    _greeting_response,
    _headroom_chip,
    _is_greeting,
    _round5,
    _scaled_fallback_chip,
    _valid_screen,
    _weekend_or_week,
    can_i_suggestions,
)


# ── Greeting gate ─────────────────────────────────────────────────────────

def test_is_greeting_matches_bare_greetings():
    for q in ("hey", "Hi!", "hello there", "yo", "good morning", "sup?"):
        assert _is_greeting(q), q


def test_is_greeting_does_not_match_a_real_question_with_a_greeting_prefix():
    # "hey can I spend £20" must NOT match: the greeting words alone don't
    # consume the whole trimmed question, so the anchored regex fails and
    # this falls through to the length gate/tool loop exactly like any
    # other question.
    assert not _is_greeting("hey can I spend £20")
    assert not _is_greeting("hi, how much do I have left")


def test_greeting_response_shape_costs_nothing():
    result = _greeting_response()
    assert result["headline"] is None
    assert result["facts"] == []
    assert result["explainer"] is False
    assert result["out_of_scope"] is False
    assert result["reply"]
    assert "—" not in result["reply"] and "–" not in result["reply"]


def test_can_i_greeting_short_circuits_before_length_gate(monkeypatch):
    # "Hi" is 2 characters, below the 3-160 gate — proves the greeting check
    # runs BEFORE that gate, not after.
    called = {"limit": False}

    async def _boom_limit(email):
        called["limit"] = True

    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _boom_limit)
    body = {"question": "Hi"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is False
    assert result["headline"] is None
    assert called["limit"] is False  # never reached check_ai_chat_limit at all


# ── Length gate / API-key guard ──────────────────────────────────────────

def test_can_i_length_gate_rejects_short_question(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    body = {"question": "ok"}
    try:
        asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 400


def test_can_i_length_gate_rejects_long_question(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    body = {"question": "x" * 161}
    try:
        asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 400


def test_can_i_missing_api_key_raises_500(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "")
    body = {"question": "can I spend £45 this weekend"}
    try:
        asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 500


# ── `_valid_screen` — still a validated enum, still consumed by the wire
# contract (passed through to run_penny_agent) even though this router no
# longer routes on it directly ───────────────────────────────────────────

def test_valid_screen_accepts_known_values_only():
    for s in ("home", "spend", "planning", "insights", "tax", "grow", "debt", "accounts", "other"):
        assert _valid_screen(s) == s
    assert _valid_screen("not-a-real-screen") is None
    assert _valid_screen(None) is None
    assert _valid_screen(123) is None


# ── Scenario gate: covered end-to-end (wiring into /can-i) in
# test_scenario_routing.py, not duplicated here — this file just confirms
# the gate still runs before check_ai_chat_limit's result would matter,
# i.e. that /can-i still exposes `looks_like_scenario` as the module-level
# name test_scenario_routing.py patches. ──────────────────────────────────

def test_can_i_module_still_exposes_scenario_gate_hooks():
    assert hasattr(can_i_module, "looks_like_scenario")
    assert hasattr(can_i_module, "parse_question")


# ── Wire shape: a real answer from the tool loop ─────────────────────────

async def _noop_check_ai_chat_limit(email):
    return None


def _patch_can_i_common(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)


def test_can_i_wire_shape_on_agent_success(monkeypatch):
    _patch_can_i_common(monkeypatch)

    usage_calls = []

    async def spy_increment(uid):
        usage_calls.append(uid)

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", spy_increment)

    async def fake_agent(uid, question, history, screen, context):
        return {"headline": "You have headroom", "reply": "You have £100 free until payday.", "tools_used": ["get_safe_to_spend"]}

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    body = {"question": "how much can I spend this weekend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))

    assert set(result.keys()) >= {"reply", "headline", "facts", "explainer", "topic", "out_of_scope"}
    assert result["reply"] == "You have £100 free until payday."
    assert result["headline"] == "You have headroom"
    assert result["facts"] == []
    assert result["explainer"] is False
    assert result["topic"] is None
    assert result["out_of_scope"] is False
    # Usage-quota: charged exactly once on a real answer.
    assert usage_calls == ["kevin"]


def test_can_i_house_style_applied_to_agent_output(monkeypatch):
    # The agent's own output still passes through _house_style (the shared
    # em-dash/en-dash backstop) before it reaches the user, same as every
    # other reply shape in this file.
    _patch_can_i_common(monkeypatch)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    async def fake_agent(uid, question, history, screen, context):
        return {"headline": "Fine either way", "reply": "That works, no issue at all — go for it.", "tools_used": []}

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    body = {"question": "can I spend £20 this weekend"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert "—" not in result["reply"] and "–" not in result["reply"]


# ── Refusal fallback: agent returns None (any failure, or a genuine
# off-topic decline via the sentinel — both indistinguishable to can_i.py,
# see run_penny_agent's own failure contract) ─────────────────────────────

def test_can_i_refusal_fallback_when_agent_returns_none(monkeypatch):
    _patch_can_i_common(monkeypatch)

    usage_calls = []

    async def spy_increment(uid):
        usage_calls.append(uid)

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", spy_increment)

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
    assert result["facts"] == []
    assert result["reply"]
    # No usage charged for a refusal.
    assert usage_calls == []


def test_can_i_refusal_fallback_appends_screen_hint_only_when_known(monkeypatch):
    _patch_can_i_common(monkeypatch)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    async def fake_agent(uid, question, history, screen, context):
        return None

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    async def fake_sts(uid):
        return {"status": "insufficient_data"}

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)

    with_screen = asyncio.run(can_i_module.can_i(
        {"question": "what's the weather like today", "screen": "spend"}, {"email": "kevin"},
    ))
    assert with_screen["reply"].endswith("You can also ask what this page shows.")

    without_screen = asyncio.run(can_i_module.can_i(
        {"question": "what's the weather like today"}, {"email": "kevin"},
    ))
    assert not without_screen["reply"].endswith("You can also ask what this page shows.")


def test_can_i_refusal_fallback_gracefully_handles_sts_lookup_failure(monkeypatch):
    # The worked-example preview inside the refusal is wrapped in its own
    # try/except (see can_i.py) — a compute_safe_to_spend outage must not
    # take the whole refusal down, it just falls back to the default £50
    # example.
    _patch_can_i_common(monkeypatch)
    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", _noop_check_ai_chat_limit)

    async def fake_agent(uid, question, history, screen, context):
        return None

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    async def _boom(uid):
        raise RuntimeError("db outage")

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", _boom)

    body = {"question": "what's the weather like today"}
    result = asyncio.run(can_i_module.can_i(body, {"email": "kevin"}))
    assert result["out_of_scope"] is True
    assert "£50" in result["reply"]


# ── GET /can-i/suggestions — unchanged by the rebuild, still worth pinning ──

def test_headroom_chip_none_below_floor():
    assert _headroom_chip(20.0) is None
    assert _headroom_chip(0.0) is None
    assert _headroom_chip(-50.0) is None


def test_headroom_chip_rounds_to_nearest_five():
    chip = _headroom_chip(200.0)
    assert chip is not None
    assert "£40" in chip["label"]  # 20% of 200 = 40, already a multiple of 5


def test_scaled_fallback_chip_floors_at_ten():
    chip = _scaled_fallback_chip(30.0)  # 20% of 30 = 6, floored to 10
    assert chip is not None
    assert "£10" in chip["label"]


def test_weekend_or_week_is_one_of_two_fixed_strings():
    assert _weekend_or_week() in ("this week", "this weekend")


def test_round5_rounds_to_nearest_five():
    assert _round5(12) == 10
    assert _round5(13) == 15
    assert _round5(0) == 0


def test_fmt_gbp_uses_unicode_minus_never_a_hyphen():
    assert _fmt_gbp(-12.5, decimals=2) == "−£12.50"
    assert "-" not in _fmt_gbp(-12.5, decimals=2)  # no plain ASCII hyphen
    assert _fmt_gbp(12.0) == "£12"


def test_can_i_suggestions_insufficient_data_returns_fixed_chips(monkeypatch):
    async def fake_sts(uid):
        return {"status": "insufficient_data"}

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)
    result = asyncio.run(can_i_suggestions({"email": "kevin"}))
    assert len(result["chips"]) == 2
    assert result["context_line"] == "Connect an account to see your numbers"


def test_can_i_suggestions_negative_safe_to_spend_uses_reassurance_chips(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": -83.0, "days_until_payday": 3,
            "next_payday": "2026-08-28", "state": "short", "short_reason": "cards",
        }

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)
    result = asyncio.run(can_i_suggestions({"email": "kevin"}))
    labels = [c["label"] for c in result["chips"]]
    assert labels == can_i_module._REASSURANCE_CHIPS
    assert "−£" not in result["context_line"] and "-£" not in result["context_line"]
    assert "gone on cards" in result["context_line"]


def test_can_i_suggestions_comfortable_headroom_uses_spend_shaped_chips(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "safe_to_spend": 200.0, "days_until_payday": 10,
            "next_payday": "2026-09-05", "state": "comfortable", "short_reason": None,
        }

    monkeypatch.setattr(can_i_module, "get_cached_safe_to_spend", fake_sts)

    async def fake_kind_map(uid):
        return {}

    monkeypatch.setattr(can_i_module, "get_category_kinds", fake_kind_map)

    async def fake_discretionary(uid, kind_map):
        return None

    monkeypatch.setattr(can_i_module, "_discretionary_chip_candidate", fake_discretionary)

    async def fake_commitment(uid):
        return None

    monkeypatch.setattr(can_i_module, "_commitment_chip_candidate", fake_commitment)

    result = asyncio.run(can_i_suggestions({"email": "kevin"}))
    assert 1 <= len(result["chips"]) <= 3
    assert "£200" in result["context_line"]
