"""Guardrail tests for G4: the tax explainer's system prompt (both the
legacy `chat.answer_tax_question` route and the live Penny agent loop's
tax rule) must carry hard product constraints, never invite the model to
recommend/name/compare a specific product, provider or scheme, and the
legacy route's OpenRouter call must set a low temperature.

Q8 (compliance): "Tax content is limited to general explanation of UK
rules; no product or scheme is recommended" and Penny "never names or
recommends a specific financial product or provider."
"""
import asyncio

import app.routers.chat as chat_module
import app.services.penny_agent as penny_agent_module


class _FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_answer_tax_question_prompt_has_product_constraints_and_temperature(monkeypatch):
    async def fake_fact_pack(uid):
        return {
            "income": 90_000,
            "income_known": True,
            "income_bracket": "",
            "pension_annual": 5_000,
            "adjusted_net_income": 85_000,
            "personal_allowance_remaining": 12570.0,
            "personal_allowance_taper_over": 0.0,
            "allowance_line": "Full personal allowance intact (£12,570)",
            "income_line": "£90,000",
            "has_child_benefit": False,
        }

    monkeypatch.setattr(chat_module, "build_tax_fact_pack", fake_fact_pack)

    captured: dict = {}

    async def fake_openrouter_chat(body, **kwargs):
        captured["body"] = body
        return _FakeResponse(payload={
            "choices": [{"message": {"content": "General explanation only."}}],
        })

    monkeypatch.setattr(chat_module, "openrouter_chat", fake_openrouter_chat)

    reply = asyncio.run(chat_module.answer_tax_question(
        "user-1", "Kevin", [{"role": "user", "content": "How does EIS relief work?"}],
    ))

    assert reply == "General explanation only."

    body = captured["body"]
    assert body["temperature"] == 0.2

    system = body["messages"][0]["content"]
    assert "Product constraints (hard rules)" in system
    assert "never recommend" in system.lower()
    assert "regulated financial adviser" in system.lower()
    assert "qualifying startup investors can claim" not in system


def test_penny_agent_prompt_has_product_constraint_sentence():
    system = penny_agent_module._SYSTEM_PROMPT
    assert "never suggest, name or recommend a specific product" in system.lower()
    assert "eis/seis" in system.lower()
    assert "regulated financial adviser" in system.lower() or "regulated adviser" in system.lower()
