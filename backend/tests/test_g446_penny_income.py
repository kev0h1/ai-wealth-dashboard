"""G446: Penny receives the engine's income provenance without inventing it."""
import asyncio
from copy import deepcopy

from app.services import penny_tools


def _run(awaitable):
    return asyncio.run(awaitable)


def _safe_to_spend_with_evidence():
    return {
        "status": "ok", "safe_to_spend": 420.25, "safe_to_spend_cash": 420.25,
        "next_payday": "2026-11-27", "days_until_payday": 18, "state": "comfortable",
        "bills_total": 259, "card_debt": 0, "card_growth_total": 0, "estimated": True,
        "income_before_payday": 1250.5, "payday_income": 80.25,
        "income_evidence": {
            "as_of": "2026-11-09T12:00:00Z",
            "before_payday": {
                "total": 1250.5, "status": "complete", "transactions_href": "/transactions?transaction_id=salary-1",
                "transactions_scope": "sources", "items": [{
                    "key": "salary", "payer": "Example Ltd", "amount": 1250.5,
                    "expected_date": "2026-11-20", "account_id": "acct-1", "account_name": "Main account",
                    "account_bank": "Monzo", "cadence": "monthly", "last_received": "2026-10-20",
                    "occurrences": 6, "confirmed": True, "basis": "confirmed schedule",
                    "transactions_href": "/transactions?transaction_id=salary-1", "transactions_scope": "sources",
                }],
            },
            "expected_pay": {
                "total": 80.25, "status": "complete", "transactions_href": "/transactions?income_period=payday",
                "transactions_scope": "income_period", "items": [{
                    "key": "benefit", "payer": "Example benefit", "amount": 80.25,
                    "expected_date": "2026-11-27", "account_id": None, "account_name": None,
                    "account_bank": None, "cadence": "monthly", "last_received": "2026-10-27",
                    "occurrences": 4, "confirmed": False, "basis": "detected pattern",
                    "transactions_href": "/transactions?income_period=payday", "transactions_scope": "income_period",
                }],
            },
        },
    }


def test_safe_to_spend_forwards_income_evidence_without_mutation(monkeypatch):
    payload = _safe_to_spend_with_evidence()
    original = deepcopy(payload)
    seen = []

    async def compute(uid):
        seen.append(uid)
        return payload

    async def extras(uid):
        assert uid == "person@example.com"
        return {"per_account": []}

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", compute)
    monkeypatch.setattr(penny_tools, "_per_account_extras", extras)
    out = _run(penny_tools._exec_get_safe_to_spend("person@example.com"))

    assert seen == ["person@example.com"]
    assert payload == original
    assert out["income_before_payday"] == {"raw": 1250.5, "formatted": "+£1,250.50"}
    assert out["payday_income"] == {"raw": 80.25, "formatted": "+£80.25"}
    before = out["income_evidence"]["before_payday"]
    payday = out["income_evidence"]["expected_pay"]
    assert before["total"] == {"raw": 1250.5, "formatted": "+£1,250.50"}
    assert before["items"][0]["amount"] == {"raw": 1250.5, "formatted": "+£1,250.50"}
    assert before["items"][0] == {
        "key": "salary", "payer": "Example Ltd", "amount": {"raw": 1250.5, "formatted": "+£1,250.50"},
        "expected_date": "2026-11-20", "account_id": "acct-1", "account_name": "Main account",
        "account_bank": "Monzo", "cadence": "monthly", "last_received": "2026-10-20",
        "occurrences": 6, "confirmed": True, "basis": "confirmed schedule",
        "transactions_href": "/transactions?transaction_id=salary-1", "transactions_scope": "sources",
    }
    assert before["items"][0]["transactions_href"] == "/transactions?transaction_id=salary-1"
    assert payday["total"] == {"raw": 80.25, "formatted": "+£80.25"}
    assert payday["items"][0] == {
        "key": "benefit", "payer": "Example benefit", "amount": {"raw": 80.25, "formatted": "+£80.25"},
        "expected_date": "2026-11-27", "account_id": None, "account_name": None,
        "account_bank": None, "cadence": "monthly", "last_received": "2026-10-27",
        "occurrences": 4, "confirmed": False, "basis": "detected pattern",
        "transactions_href": "/transactions?income_period=payday", "transactions_scope": "income_period",
    }


def test_safe_to_spend_omits_legacy_income_evidence(monkeypatch):
    payload = _safe_to_spend_with_evidence()
    payload.pop("income_evidence")

    async def compute(uid):
        assert uid == "person@example.com"
        return payload

    async def extras(uid):
        return {}

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", compute)
    monkeypatch.setattr(penny_tools, "_per_account_extras", extras)
    out = _run(penny_tools._exec_get_safe_to_spend("person@example.com"))

    assert "income_evidence" not in out
    assert out["income_before_payday"] == {"raw": 1250.5, "formatted": "+£1,250.50"}
    assert out["payday_income"] == {"raw": 80.25, "formatted": "+£80.25"}


def test_safe_to_spend_omits_mismatched_income_evidence(monkeypatch):
    payload = _safe_to_spend_with_evidence()
    payload["income_evidence"]["before_payday"]["items"][0]["amount"] = 1250.49

    async def compute(uid):
        return payload

    async def extras(uid):
        return {}

    monkeypatch.setattr(penny_tools, "compute_safe_to_spend", compute)
    monkeypatch.setattr(penny_tools, "_per_account_extras", extras)
    out = _run(penny_tools._exec_get_safe_to_spend("person@example.com"))

    assert "income_evidence" not in out
    assert out["income_before_payday"] == {"raw": 1250.5, "formatted": "+£1,250.50"}
