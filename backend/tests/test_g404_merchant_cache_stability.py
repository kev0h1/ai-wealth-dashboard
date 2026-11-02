"""G404: cache source precedence (user > rule > llm), first llm judgement wins,
and a changed key re-stamps the caller's own rows. Fakes only, no database."""
import asyncio
import importlib.util
import os
from pathlib import Path

import pytest

from app.services import categorisation as cat
from tests.test_g139_merchant_authority import FakeCol

UID = "g404-owner"
OTHER = "g404-other"
KEY = "examplepayee"


class Rows(FakeCol):
    pass


@pytest.fixture
def env(monkeypatch):
    cache, rows, stmts = FakeCol(), Rows(), Rows()
    stale: list = []

    async def allowed(uid): return {"Bills", "Groceries", "Padel"}
    async def mark_stale(uid, *, reason="x"): stale.append((uid, reason))

    monkeypatch.setattr(cat, "merchant_categories_col", cache)
    monkeypatch.setattr(cat, "transactions_col", rows)
    monkeypatch.setattr(cat, "statement_transactions_col", stmts)
    monkeypatch.setattr(cat, "user_allowed_categories", allowed)
    async def not_relative(key, uid): return False
    monkeypatch.setattr(cat, "_key_looks_user_relative", not_relative)
    from app.services import derived_caches
    monkeypatch.setattr(derived_caches, "mark_stale", mark_stale)
    return type("Env", (), {"cache": cache, "rows": rows, "stmts": stmts, "stale": stale})


def run(coro):
    return asyncio.run(coro)


def txn(id_, cat_, uid=UID, custom=None, key=KEY):
    return {"_id": id_, "user_id": uid, "merchant_key": key, "category": cat_, "custom_category": custom}


def cats(env):
    return {d["_id"]: d["category"] for d in env.rows.docs}


def test_second_llm_judgement_is_refused(env):
    assert run(cat.cache_merchant(KEY, "Bills", "llm", uid=UID)) is True
    assert run(cat.cache_merchant(KEY, "Groceries", "llm", uid=UID)) is False
    assert env.cache.docs[0]["category"] == "Bills"


def test_rule_replaces_llm_and_restamps_only_uncustomised_rows(env):
    run(cat.cache_merchant(KEY, "Bills", "llm", uid=UID))
    env.rows.docs += [txn("a", "Bills"), txn("b", "Bills", custom="Padel"), txn("c", "Transfer")]
    env.stmts.docs.append(txn("s", "Bills"))
    env.stale.clear()
    assert run(cat.cache_merchant(KEY, "Groceries", "rule", uid=UID)) is True
    assert cats(env) == {"a": "Groceries", "b": "Bills", "c": "Groceries"}
    assert env.stmts.docs[0]["category"] == "Groceries"
    assert env.stale == [(UID, "merchant_category_restamp")]


def test_user_replaces_rule_and_user_doc_never_overwritten(env):
    run(cat.cache_merchant(KEY, "Bills", "rule", uid=UID))
    assert run(cat.cache_merchant(KEY, "Groceries", "user", uid=UID)) is True
    assert run(cat.cache_merchant(KEY, "Bills", "rule", uid=UID)) is False
    assert run(cat.cache_merchant(KEY, "Bills", "llm", uid=UID)) is False
    assert env.cache.docs[0]["category"] == "Groceries"
    assert env.cache.docs[0]["source"] == "user"


def test_global_write_restamps_only_callers_rows(env):
    env.rows.docs += [txn("mine", "Other"), txn("theirs", "Other", uid=OTHER)]
    assert run(cat.cache_merchant(KEY, "Groceries", "llm", uid=UID, prefer_global=True)) is True
    assert env.cache.docs[0]["_id"] == KEY  # genuinely global
    assert cats(env) == {"mine": "Groceries", "theirs": "Other"}


def test_first_llm_write_fills_only_unresolved_rows(env):
    env.rows.docs += [txn("open", "Other"), txn("settled", "Transfer")]
    run(cat.cache_merchant(KEY, "Bills", "llm", uid=UID))
    assert cats(env) == {"open": "Bills", "settled": "Transfer"}


def test_mark_stale_once_on_change_and_not_on_refusal(env):
    run(cat.cache_merchant(KEY, "Bills", "llm", uid=UID))
    env.rows.docs.append(txn("a", "Other"))
    env.stale.clear()
    run(cat.cache_merchant(KEY, "Groceries", "llm", uid=UID))  # refused
    assert env.stale == []
    run(cat.cache_merchant(KEY, "Groceries", "user", uid=UID))
    assert len(env.stale) == 1 and env.stale[0][1]
    run(cat.cache_merchant(KEY, "Groceries", "user", uid=UID))  # no change
    assert len(env.stale) == 1


def _load_report():
    path = Path(__file__).resolve().parent.parent / "scripts" / "merchant_key_migration_report.py"
    spec = importlib.util.spec_from_file_location("mk_report", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_report_refuses_without_mongo_db(monkeypatch):
    monkeypatch.delenv("MONGO_DB", raising=False)
    assert run(_load_report().main(["x", UID])) == 2


def test_report_counts_on_fake_collection():
    mod = _load_report()
    col = FakeCol([
        {"_id": f"{UID}::examplepayee", "uid": UID, "source": "user"},
        {"_id": f"{UID}::examplecard 824849 32000", "uid": UID, "source": "user"},
        {"_id": f"{UID}::other", "uid": UID, "source": "llm"},
        {"_id": f"{OTHER}::examplecard 111111 22222", "uid": OTHER, "source": "user"},
    ])
    counts = run(mod.count_stale_user_keys(col, UID))
    assert counts["user_docs"] == 2
    assert counts["would_not_resolve"] == 1
