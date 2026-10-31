"""Machine classification invariants, independent of transaction wording."""
import asyncio
import json
from datetime import datetime

import pytest

from app.routers import transactions as router
from app.services import categorisation as cat, vendor_directory
from tests.test_g139_merchant_authority import FakeCol
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds

UID = "generic-category-owner"


class Rows(FakeCol):
    async def update_one(self, query, update, upsert=False):
        before = await self.find_one(query)
        await super().update_one(query, update, upsert=upsert)
        return type("Result", (), {"modified_count": int(before is not None)})()


def row(id_, label, direction="debit", **extra):
    return {"_id": id_, "user_id": UID, "account_id": "current", "merchant_name": label,
            "description": label, "transaction_type": direction,
            "amount": -9 if direction == "debit" else 9, "category": "Other",
            "custom_category": None, "date": datetime(2026, 10, 30), **extra}


@pytest.fixture
def env(monkeypatch):
    rows = Rows()
    async def noop(*args, **kwargs): return 0
    async def kinds(*args, **kwargs): return {"Income", "Other", "Transfer", "Groceries"}
    async def identity(*args, **kwargs): return {"name_tokens": ["morgan"], "account_numbers": [], "sort_codes": [], "own_map": {}}
    async def decisions(*args, **kwargs): return {}
    async def ladder(*args, **kwargs): return {}
    monkeypatch.setattr(cat, "transactions_col", rows)
    monkeypatch.setattr(cat, "statement_transactions_col", Rows())
    monkeypatch.setattr(router, "transactions_col", rows)
    monkeypatch.setattr(cat, "OPENROUTER_API_KEY", "synthetic")
    monkeypatch.setattr(router, "OPENROUTER_API_KEY", "synthetic")
    monkeypatch.setattr(router, "TAVILY_API_KEY", "")
    monkeypatch.setattr(cat, "user_identity", identity)
    monkeypatch.setattr(cat, "user_allowed_categories", kinds)
    monkeypatch.setattr(cat, "cache_merchant", noop)
    monkeypatch.setattr(router, "apply_rules_bulk", noop)
    monkeypatch.setattr(router, "teaching_decision_times", decisions)
    monkeypatch.setattr(router.response_cache, "ainvalidate", noop)
    monkeypatch.setattr(vendor_directory, "run_vendor_ladder", ladder)
    return rows


def response(mapping):
    return type("Reply", (), {"status_code": 200, "json": lambda self: {
        "choices": [{"message": {"content": json.dumps(mapping)}}],
    }})()


@pytest.mark.parametrize("label", ["Morgan arbitrary label 7361", "Morgan unrelated counterparty"])
@pytest.mark.parametrize("path", ["owner_check", "background", "on_demand"])
def test_any_automatic_model_income_answer_is_rejected_for_debits(env, monkeypatch, label, path):
    debit, credit = row("out", label), row("in", label, "credit")
    env.docs.extend([debit, credit])
    async def model(*args, **kwargs):
        return response({str(i): "Income" for i in range(3)})
    monkeypatch.setattr(cat, "openrouter_chat", model)
    monkeypatch.setattr(router, "openrouter_chat", model)
    if path == "owner_check":
        asyncio.run(cat.llm_name_check(UID))
    elif path == "background":
        asyncio.run(cat.categorise_others_bg(UID))
    else:
        asyncio.run(router.auto_categorise(user={"email": UID}))
    assert debit["category"] != "Income"
    assert credit["category"] == "Income"


def test_old_machine_income_on_a_debit_cannot_teach_another_debit(env, monkeypatch):
    old = row("old", "Arbitrary historic label", category="Income", date=datetime(2026, 9, 1))
    new = row("new", "Arbitrary historic label")
    env.docs.extend([old, new])
    monkeypatch.setattr(router, "OPENROUTER_API_KEY", "")
    asyncio.run(router.auto_categorise(user={"email": UID}))
    assert new["category"] != "Income"


def test_user_correction_outranks_a_newer_automatic_classification(env, monkeypatch):
    label = "Unrelated credit description"
    older = row("chosen", label, "credit", custom_category="Transfer",
                date=datetime(2026, 8, 1), custom_category_at=datetime(2026, 8, 2))
    newer = row("guess", label, "credit", category="Income", date=datetime(2026, 10, 1))
    target = row("new", label, "credit")
    env.docs.extend([older, newer, target])
    monkeypatch.setattr(router, "OPENROUTER_API_KEY", "")
    asyncio.run(router.auto_categorise(user={"email": UID}))
    assert target["category"] == "Transfer"
    assert older["custom_category"] == "Transfer"


@pytest.mark.parametrize("path", ["background", "on_demand"])
def test_user_correction_while_model_is_running_wins(env, monkeypatch, path):
    target = row("chosen", "Arbitrary in-flight credit", "credit")
    env.docs.append(target)
    async def model(*args, **kwargs):
        target["custom_category"] = "Transfer"
        target["category"] = "Other"
        return response({"0": "Income", "1": "Income"})
    monkeypatch.setattr(cat, "openrouter_chat", model)
    monkeypatch.setattr(router, "openrouter_chat", model)
    if path == "background":
        asyncio.run(cat.categorise_others_bg(UID))
    else:
        asyncio.run(router.auto_categorise(user={"email": UID}))
    assert target["custom_category"] == "Transfer"
    assert target["category"] == "Other"


def bulk_setup(monkeypatch, rules=()):
    for name in ("accounts_col", "user_profiles_col", "merchant_categories_col", "confirmed_transfer_pairs_col", "teaching_events_col"):
        monkeypatch.setattr(cat, name, Rows())
    monkeypatch.setattr(cat, "user_rules_col", Rows(rules))
    async def kinds(*args): return CategoryKinds(dict(BUILTIN_CATEGORY_KINDS))
    monkeypatch.setattr(cat, "get_category_kinds", kinds)


def test_explicit_user_rule_and_income_reversal_remain_authoritative(env, monkeypatch):
    target = row("target", "Arbitrary reversal rule")
    chosen = row("manual", "Different user reversal", custom_category="Income")
    env.docs.extend([target, chosen])
    bulk_setup(monkeypatch, [{"uid": UID, "pattern": "arbitrary reversal", "category": "Income"}])
    asyncio.run(cat.apply_rules_bulk(UID))
    assert target["category"] == "Income"
    assert chosen["custom_category"] == "Income"


def test_persisted_correction_time_wins_when_teaching_log_has_expired(env, monkeypatch):
    label = "Unfamiliar named receipt"
    recent_decision = row("old-transaction", label, "credit", custom_category="Transfer",
                          date=datetime(2026, 7, 1), custom_category_at=datetime(2026, 10, 29))
    older_decision = row("newer-transaction", label, "credit", custom_category="Income",
                         date=datetime(2026, 10, 1), custom_category_at=datetime(2026, 10, 2))
    target = row("target", label, "credit")
    env.docs.extend([recent_decision, older_decision, target])
    bulk_setup(monkeypatch)
    asyncio.run(cat.apply_rules_bulk(UID))
    assert target["category"] == "Transfer"


def test_machine_cached_income_cannot_classify_an_arbitrary_debit(env, monkeypatch):
    label = "Opaque counterparty label"
    target = row("target", label)
    env.docs.append(target)
    bulk_setup(monkeypatch)
    monkeypatch.setattr(cat, "merchant_categories_col", Rows([{
        "_id": f"{UID}::{cat.canonical_merchant_key(label, label)}", "uid": UID,
        "category": "Income", "source": "llm",
    }]))
    asyncio.run(cat.apply_rules_bulk(UID))
    assert target["category"] != "Income"
