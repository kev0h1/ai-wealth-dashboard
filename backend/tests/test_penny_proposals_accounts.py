"""Tests for B16 (2026-09-08, B12 stage 3): propose-only write tools for
offline (manually-tracked) accounts, their ledger entries, transaction-
mirror rules, disconnecting a bank connection, and syncing now. See
docs/penny/action-inventory.md and PENNY_TOOLS.md's "Write tools
(propose-only)" table for the doctrine these extend.

Same fakes/conventions as tests/test_penny_proposals_twins.py and
tests/test_penny_proposals_preferences.py (no mongomock in this
environment — `_FakeCol` stands in for a Motor collection), copied rather
than imported so this file stays independently runnable. CORE PRINCIPLE
under test throughout: Penny PROPOSES, never executes — every new
`_exec_propose_*` executor here must return a stored proposal dict (never
mutate real data), and only POST /penny/proposals/{id}/execute (replaying
the SAME router function the app's own confirm sheet/Accounts page calls)
ever turns one into a real write.

Where a propose-side resolver reads through a router-level list function
rather than a raw collection (get_accounts, list_manual_transactions), this
file follows test_penny_proposals_preferences.py's own established
convention (`_patch_accounts`) of monkeypatching the router FUNCTION
directly rather than faking every collection it touches underneath —
simpler and just as faithful, since the function itself is never under
test here (its own router-level tests cover it).
"""
import asyncio
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_tools import execute_tool

UID = "kevin"


def _acc(id_, name, balance=100.0, provider="Test Bank", type_="transaction", manual=False, connection_id=None):
    return Account(
        id=id_, name=name, type=type_, balance=balance, provider=provider,
        manual=manual, connection_id=connection_id,
    )


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCol:
    """Twin of test_penny_proposals_twins.py's own _FakeCol, extended with
    `.find()` (returning a `_FakeCursor`) and `.count_documents()` — this
    file's resolvers (`_resolve_offline_account_for_propose`,
    `_resolve_account_rule_for_propose`, `_resolve_bank_connection_for_
    propose`) read Mongo collections directly rather than through a router
    list function, unlike every resolver a prior B14/B15 test file needed."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    def find(self, query=None, projection=None):
        query = query or {}
        return _FakeCursor([d for d in self.docs if self._match(d, query)])

    async def count_documents(self, query=None):
        query = query or {}
        return sum(1 for d in self.docs if self._match(d, query))

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


def _live_doc(kind, params, **overrides):
    now = datetime.now()
    doc = {
        "_id": "p-test", "user_id": UID, "kind": kind, "params": params,
        "summary": "s", "consequence": "c", "destructive": False,
        "created_at": now, "expires_at": now + timedelta(minutes=15),
        "executed_at": None, "result": None, "cancelled_at": None,
    }
    doc.update(overrides)
    return doc


def _patch_consented_prefs(monkeypatch, extra=None) -> "_FakeCol":
    doc = {"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}
    if extra:
        doc.update(extra)
    fake_prefs = _FakeCol([doc])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)
    return fake_prefs


def _patch_proposals_col(monkeypatch) -> "_FakeCol":
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    return fake_col


def _patch_offline_accounts(monkeypatch, docs) -> "_FakeCol":
    fake_col = _FakeCol(docs)
    monkeypatch.setattr(penny_tools_module, "manual_accounts_col", fake_col)
    _patch_proposals_col(monkeypatch)
    return fake_col


def _patch_account_rules(monkeypatch, docs) -> "_FakeCol":
    fake_col = _FakeCol(docs)
    monkeypatch.setattr(penny_tools_module, "manual_account_rules_col", fake_col)
    return fake_col


def _patch_get_accounts(monkeypatch, accounts):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return accounts

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)


def _patch_list_manual_transactions(monkeypatch, entries):
    import app.routers.manual_accounts as manual_accounts_module

    async def fake_list(acc_id, user):
        return entries

    monkeypatch.setattr(manual_accounts_module, "list_manual_transactions", fake_list)


def _patch_resolve_source_scope(monkeypatch, resolver=None):
    import app.routers.manual_accounts as manual_accounts_module

    if resolver is None:
        async def resolver(uid, raw):
            return raw

    monkeypatch.setattr(manual_accounts_module, "_resolve_source_scope", resolver)


def _entry(id_, description, amount, transaction_type="debit", when="2026-08-01"):
    return {
        "id": id_, "account_id": "off1", "date": datetime.fromisoformat(when),
        "amount": amount, "currency": "GBP", "description": description,
        "merchant_name": None, "category": "Transfer", "custom_category": None,
        "transaction_type": transaction_type,
    }


# ═════════════════════════════════════════════════════════════════════════
# Section A — propose_create_offline_account
# ═════════════════════════════════════════════════════════════════════════

def test_propose_create_offline_account_happy_path(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "Cash Jar", "account_type": "savings", "balance": 120,
    }))
    assert result["proposal"] is True
    assert result["kind"] == "create_offline_account"
    assert result["params"] == {"name": "Cash Jar", "account_type": "savings", "balance": 120.0}
    assert result["destructive"] is False
    assert "Cash Jar" in result["summary"] and "£120" in result["summary"]


def test_propose_create_offline_account_defaults_balance_to_zero(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "New Pot", "account_type": "current",
    }))
    assert result["params"]["balance"] == 0.0


def test_propose_create_offline_account_bad_type_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "X", "account_type": "isa",
    }))
    assert "error" in result


def test_propose_create_offline_account_blank_name_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "   ", "account_type": "savings",
    }))
    assert "error" in result


def test_propose_create_offline_account_non_numeric_balance_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "X", "account_type": "savings", "balance": "loads",
    }))
    assert "error" in result


def test_propose_create_offline_account_negative_balance_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_offline_account", {
        "name": "X", "account_type": "savings", "balance": -5,
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section B — offline-account resolver + propose_update_offline_account
# ═════════════════════════════════════════════════════════════════════════

def test_propose_update_offline_account_resolves_by_id(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "off1", "balance": 75,
    }))
    assert result["proposal"] is True
    assert result["params"] == {"account_id": "off1", "balance": 75.0}
    assert result["destructive"] is False


def test_propose_update_offline_account_resolves_by_unique_name(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "cash", "name": "Holiday Jar",
    }))
    assert result["params"] == {"account_id": "off1", "name": "Holiday Jar"}
    assert "Holiday Jar" in result["summary"]


def test_propose_update_offline_account_ambiguous_name(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Joint Savings", "account_type": "savings", "balance": 10.0},
        {"_id": "off2", "user_id": UID, "name": "Joint Savings Pot", "account_type": "savings", "balance": 20.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "joint", "balance": 5,
    }))
    assert result.get("ambiguous") is True
    assert {m["id"] for m in result["matches"]} == {"off1", "off2"}


def test_propose_update_offline_account_unknown_name_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "nonexistent pot", "balance": 5,
    }))
    assert "error" in result


def test_propose_update_offline_account_nothing_to_update_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {"account_ref": "off1"}))
    assert "error" in result


def test_propose_update_offline_account_bad_type_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "off1", "account_type": "isa",
    }))
    assert "error" in result


def test_propose_update_offline_account_negative_balance_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "off1", "balance": -1,
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section C — propose_delete_offline_account
# ═════════════════════════════════════════════════════════════════════════

def test_propose_delete_offline_account_happy_path(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_delete_offline_account", {"account_ref": "off1"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_offline_account"
    assert result["params"] == {"account_id": "off1"}
    assert result["destructive"] is True
    assert result["summary"] == "Delete the offline account 'Cash Jar'"
    assert "ledger entry" in result["consequence"] and "rule" in result["consequence"]


def test_propose_delete_offline_account_unknown_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_delete_offline_account", {"account_ref": "off1"}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section D — propose_add_ledger_entry
# ═════════════════════════════════════════════════════════════════════════

def test_propose_add_ledger_entry_credit_happy_path(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 20, "description": "Birthday money", "direction": "credit",
    }))
    assert result["proposal"] is True
    assert result["kind"] == "add_ledger_entry"
    assert result["params"] == {
        "account_id": "off1", "amount": 20.0, "description": "Birthday money", "transaction_type": "credit",
    }
    assert result["destructive"] is False
    assert "deposit" in result["summary"] and "£20" in result["summary"] and "Birthday money" in result["summary"]


def test_propose_add_ledger_entry_debit_wording(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 10, "description": "Coffee", "direction": "debit",
    }))
    assert "payment out" in result["summary"]


def test_propose_add_ledger_entry_unknown_account_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 10, "description": "Coffee", "direction": "debit",
    }))
    assert "error" in result


def test_propose_add_ledger_entry_blank_description_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 10, "description": "  ", "direction": "debit",
    }))
    assert "error" in result


def test_propose_add_ledger_entry_non_positive_amount_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 0, "description": "Coffee", "direction": "debit",
    }))
    assert "error" in result


def test_propose_add_ledger_entry_bad_direction_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 10, "description": "Coffee", "direction": "sideways",
    }))
    assert "error" in result


def test_propose_add_ledger_entry_bad_date_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_add_ledger_entry", {
        "account_ref": "off1", "amount": 10, "description": "Coffee", "direction": "debit", "date": "not-a-date",
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section E — ledger-entry resolver + propose_update_ledger_entry
# ═════════════════════════════════════════════════════════════════════════

def test_propose_update_ledger_entry_resolves_by_id(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [_entry("tx1", "Coffee", 3.5)])
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "tx1", "amount": 4.0,
    }))
    assert result["proposal"] is True
    assert result["params"] == {"account_id": "off1", "entry_id": "tx1", "amount": 4.0}


def test_propose_update_ledger_entry_resolves_by_description_and_date(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [
        _entry("tx1", "Coffee", 3.5, when="2026-08-01"),
        _entry("tx2", "Coffee", 3.5, when="2026-08-05"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "Coffee on 2026-08-05", "amount": 4.0,
    }))
    assert result["proposal"] is True
    assert result["params"]["entry_id"] == "tx2"


def test_propose_update_ledger_entry_ambiguous_same_description_no_date(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [
        _entry("tx1", "Coffee", 3.5, when="2026-08-01"),
        _entry("tx2", "Coffee", 3.5, when="2026-08-05"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "Coffee", "amount": 4.0,
    }))
    assert result.get("ambiguous") is True
    assert {m["id"] for m in result["matches"]} == {"tx1", "tx2"}


def test_propose_update_ledger_entry_mirror_entry_never_matches(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    mirror_entry = _entry("mirror:m1", "Rule posting", 12.0)
    _patch_list_manual_transactions(monkeypatch, [mirror_entry])
    # Exact id lookup of the mirror entry must also fail to resolve.
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "mirror:m1", "amount": 4.0,
    }))
    assert "error" in result
    result2 = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "Rule posting", "amount": 4.0,
    }))
    assert "error" in result2


def test_propose_update_ledger_entry_nothing_to_update_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [_entry("tx1", "Coffee", 3.5)])
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "tx1",
    }))
    assert "error" in result


def test_propose_update_ledger_entry_bad_date_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [_entry("tx1", "Coffee", 3.5)])
    result = asyncio.run(execute_tool(UID, "propose_update_ledger_entry", {
        "account_ref": "off1", "entry_ref": "tx1", "date": "not-a-date",
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section F — propose_delete_ledger_entry
# ═════════════════════════════════════════════════════════════════════════

def test_propose_delete_ledger_entry_happy_path(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [_entry("tx1", "Coffee", 3.5)])
    result = asyncio.run(execute_tool(UID, "propose_delete_ledger_entry", {
        "account_ref": "off1", "entry_ref": "tx1",
    }))
    assert result["proposal"] is True
    assert result["kind"] == "delete_ledger_entry"
    assert result["params"] == {"account_id": "off1", "entry_id": "tx1"}
    assert result["destructive"] is False
    assert "Coffee" in result["summary"] and "Cash Jar" in result["summary"]


def test_propose_delete_ledger_entry_not_found_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_list_manual_transactions(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_delete_ledger_entry", {
        "account_ref": "off1", "entry_ref": "tx1",
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section G — propose_create_account_rule
# ═════════════════════════════════════════════════════════════════════════

def test_propose_create_account_rule_happy_path_no_source(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "Groceries mirror", "target_account_ref": "off1",
        "match_type": "category", "match_value": "Groceries", "sign": "same", "backfill": False,
    }))
    assert result["proposal"] is True
    assert result["kind"] == "create_account_rule"
    assert result["params"] == {
        "name": "Groceries mirror", "target_account_id": "off1", "match_type": "category",
        "match_value": "Groceries", "sign": "same", "match_field": None,
        "source_account_id": None, "backfill": False,
    }
    assert "Cash Jar" in result["summary"] and "starting from today" in result["summary"]


def test_propose_create_account_rule_happy_path_with_source(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    _patch_get_accounts(monkeypatch, [_acc("acc1", "Monzo Current", manual=False)])
    _patch_resolve_source_scope(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "Groceries mirror", "target_account_ref": "off1",
        "match_type": "description_contains", "match_value": "Tesco", "sign": "same",
        "source_account_ref": "Monzo", "backfill": True,
    }))
    assert result["proposal"] is True
    assert result["params"]["source_account_id"] == "acc1"
    assert result["params"]["backfill"] is True
    assert "Monzo Current" in result["summary"] and "copying past matching transactions too" in result["summary"]


def test_propose_create_account_rule_unknown_target_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "X", "target_account_ref": "off1",
        "match_type": "category", "match_value": "Groceries", "sign": "same",
    }))
    assert "error" in result


def test_propose_create_account_rule_bad_match_type_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "X", "target_account_ref": "off1",
        "match_type": "amount_over", "match_value": "50", "sign": "same",
    }))
    assert "error" in result


def test_propose_create_account_rule_bad_sign_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "X", "target_account_ref": "off1",
        "match_type": "category", "match_value": "Groceries", "sign": "inverted",
    }))
    assert "error" in result


def test_propose_create_account_rule_blank_match_value_is_tool_error(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    result = asyncio.run(execute_tool(UID, "propose_create_account_rule", {
        "name": "X", "target_account_ref": "off1",
        "match_type": "category", "match_value": "  ", "sign": "same",
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section H — rule resolver + propose_update_account_rule
# ═════════════════════════════════════════════════════════════════════════

_RULE_DOC = {
    "_id": "rule1", "user_id": UID, "name": "Groceries mirror", "target_account_id": "off1",
    "match_type": "category", "match_value": "Groceries", "sign": "same", "match_field": None,
    "active": True, "source_account_id": None,
}


def test_propose_update_account_rule_resolves_by_id(monkeypatch):
    _patch_account_rules(monkeypatch, [dict(_RULE_DOC)])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_update_account_rule", {
        "rule_ref": "rule1", "active": False,
    }))
    assert result["proposal"] is True
    assert result["params"] == {"rule_id": "rule1", "active": False}
    assert "pausing" in result["summary"]


def test_propose_update_account_rule_ambiguous_name(monkeypatch):
    _patch_account_rules(monkeypatch, [
        {**_RULE_DOC, "_id": "rule1", "name": "Groceries mirror"},
        {**_RULE_DOC, "_id": "rule2", "name": "Groceries backup mirror"},
    ])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_update_account_rule", {
        "rule_ref": "Groceries", "active": False,
    }))
    assert result.get("ambiguous") is True
    assert {m["id"] for m in result["matches"]} == {"rule1", "rule2"}


def test_propose_update_account_rule_nothing_to_update_is_tool_error(monkeypatch):
    _patch_account_rules(monkeypatch, [dict(_RULE_DOC)])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_update_account_rule", {"rule_ref": "rule1"}))
    assert "error" in result


def test_propose_update_account_rule_bad_match_type_is_tool_error(monkeypatch):
    _patch_account_rules(monkeypatch, [dict(_RULE_DOC)])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_update_account_rule", {
        "rule_ref": "rule1", "match_type": "vibes",
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section I — propose_delete_account_rule
# ═════════════════════════════════════════════════════════════════════════

def test_propose_delete_account_rule_happy_path(monkeypatch):
    _patch_account_rules(monkeypatch, [dict(_RULE_DOC)])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_delete_account_rule", {"rule_ref": "rule1"}))
    assert result["proposal"] is True
    assert result["kind"] == "delete_account_rule"
    assert result["params"] == {"rule_id": "rule1"}
    assert result["summary"] == "Delete the rule 'Groceries mirror'"
    assert "reversed" in result["consequence"]


def test_propose_delete_account_rule_not_found_is_tool_error(monkeypatch):
    _patch_account_rules(monkeypatch, [])
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_delete_account_rule", {"rule_ref": "rule1"}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section J — bank-connection resolver + propose_disconnect_bank
# ═════════════════════════════════════════════════════════════════════════

def _patch_bank_env(monkeypatch, connections=None, finexer=None, accounts=None):
    monkeypatch.setattr(penny_tools_module, "connections_col", _FakeCol(connections or []))
    monkeypatch.setattr(penny_tools_module, "finexer_consents_col", _FakeCol(finexer or []))
    monkeypatch.setattr(penny_tools_module, "accounts_col", _FakeCol(accounts or []))
    _patch_proposals_col(monkeypatch)


def test_propose_disconnect_bank_resolves_by_truelayer_connection_id(monkeypatch):
    _patch_bank_env(
        monkeypatch,
        connections=[{"_id": "conn1", "user_id": UID}],
        accounts=[
            {"_id": "a1", "user_id": UID, "connection_id": "conn1", "provider": "Monzo"},
            {"_id": "a2", "user_id": UID, "connection_id": "conn1", "provider": "Monzo"},
        ],
    )
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "conn1"}))
    assert result["proposal"] is True
    assert result["kind"] == "disconnect_bank"
    assert result["params"] == {"connection_id": "conn1"}
    assert result["destructive"] is True
    assert result["summary"] == "Disconnect Monzo (2 accounts)"
    assert "Safe-to-Spend" in result["consequence"] and "may" in result["consequence"]


def test_propose_disconnect_bank_resolves_by_finexer_consent_id(monkeypatch):
    _patch_bank_env(
        monkeypatch,
        finexer=[{"_id": "fx1", "user_id": UID}],
        accounts=[{"_id": "a1", "user_id": UID, "connection_id": "fx1", "provider": "Barclays"}],
    )
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "fx1"}))
    assert result["params"] == {"connection_id": "fx1"}
    assert result["summary"] == "Disconnect Barclays (1 account)"


def test_propose_disconnect_bank_resolves_by_bank_name(monkeypatch):
    _patch_bank_env(
        monkeypatch,
        connections=[{"_id": "conn1", "user_id": UID}],
        accounts=[{"_id": "a1", "user_id": UID, "connection_id": "conn1", "provider": "Monzo"}],
    )
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "monzo"}))
    assert result["params"] == {"connection_id": "conn1"}


def test_propose_disconnect_bank_ambiguous_bank_name(monkeypatch):
    _patch_bank_env(
        monkeypatch,
        connections=[{"_id": "conn1", "user_id": UID}, {"_id": "conn2", "user_id": UID}],
        accounts=[
            {"_id": "a1", "user_id": UID, "connection_id": "conn1", "provider": "Monzo"},
            {"_id": "a2", "user_id": UID, "connection_id": "conn2", "provider": "Monzo"},
        ],
    )
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "monzo"}))
    assert result.get("ambiguous") is True
    assert {m["connection_id"] for m in result["matches"]} == {"conn1", "conn2"}


def test_propose_disconnect_bank_unknown_name_is_tool_error(monkeypatch):
    _patch_bank_env(monkeypatch, accounts=[])
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "Nonexistent Bank"}))
    assert "error" in result


def test_propose_disconnect_bank_never_resolves_yapily_consent_id(monkeypatch):
    """A Yapily account's own `connection_id` field is actually a Yapily
    *consent* id (see accounts.py's own get_accounts), never a real
    connections_col/finexer_consents_col row — this resolver must never
    treat that value as a resolvable connection even if (defensively) an
    account carrying it were somehow present in accounts_col."""
    _patch_bank_env(
        monkeypatch,
        connections=[{"_id": "conn-real", "user_id": UID}],
        accounts=[
            {"_id": "a1", "user_id": UID, "connection_id": "conn-real", "provider": "Monzo"},
            {"_id": "a-yap", "user_id": UID, "connection_id": "yapily-consent-999", "provider": "Yapily Test Bank"},
        ],
    )
    result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {
        "connection_or_account_ref": "yapily-consent-999",
    }))
    # execute_tool's own _tool_error wrapping drops "available" (same as
    # every other propose exec's `return _tool_error(resolved["error"])`
    # line) — call the resolver directly too, to prove the underlying
    # match genuinely failed rather than merely being reported oddly.
    assert "error" in result
    direct = asyncio.run(
        penny_tools_module._resolve_bank_connection_for_propose(UID, "yapily-consent-999")
    )
    assert direct.get("error")
    assert "Yapily Test Bank" in direct.get("available", [])


# ═════════════════════════════════════════════════════════════════════════
# Section K — propose_sync_now
# ═════════════════════════════════════════════════════════════════════════

def test_propose_sync_now_exact_strings(monkeypatch):
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_sync_now", {}))
    assert result["proposal"] is True
    assert result["kind"] == "sync_now"
    assert result["params"] == {}
    assert result["summary"] == "Refresh your bank connections now"
    assert result["consequence"] == "Pulls the latest transactions and balances, may take a minute"
    assert result["destructive"] is False


# ═════════════════════════════════════════════════════════════════════════
# Section L — registration + destructive flag consistency
# ═════════════════════════════════════════════════════════════════════════

_NEW_TOOL_NAMES = {
    "propose_create_offline_account", "propose_update_offline_account", "propose_delete_offline_account",
    "propose_add_ledger_entry", "propose_update_ledger_entry", "propose_delete_ledger_entry",
    "propose_create_account_rule", "propose_update_account_rule", "propose_delete_account_rule",
    "propose_disconnect_bank", "propose_sync_now",
}

_NEW_KIND_NAMES = {
    "create_offline_account", "update_offline_account", "delete_offline_account",
    "add_ledger_entry", "update_ledger_entry", "delete_ledger_entry",
    "create_account_rule", "update_account_rule", "delete_account_rule",
    "disconnect_bank", "sync_now",
}


def test_all_new_tools_registered_in_propose_tool_names():
    assert _NEW_TOOL_NAMES <= penny_tools_module.PROPOSE_TOOL_NAMES
    assert len(_NEW_TOOL_NAMES) == 11


def test_all_new_kinds_registered_in_proposal_executors():
    assert _NEW_KIND_NAMES <= set(can_i_module._PROPOSAL_EXECUTORS.keys())


def test_only_delete_offline_account_and_disconnect_bank_are_destructive(monkeypatch):
    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    delete_result = asyncio.run(execute_tool(UID, "propose_delete_offline_account", {"account_ref": "off1"}))
    assert delete_result["destructive"] is True

    _patch_bank_env(
        monkeypatch,
        connections=[{"_id": "conn1", "user_id": UID}],
        accounts=[{"_id": "a1", "user_id": UID, "connection_id": "conn1", "provider": "Monzo"}],
    )
    disconnect_result = asyncio.run(execute_tool(UID, "propose_disconnect_bank", {"connection_or_account_ref": "conn1"}))
    assert disconnect_result["destructive"] is True

    _patch_offline_accounts(monkeypatch, [
        {"_id": "off1", "user_id": UID, "name": "Cash Jar", "account_type": "savings", "balance": 50.0},
    ])
    update_result = asyncio.run(execute_tool(UID, "propose_update_offline_account", {
        "account_ref": "off1", "balance": 10,
    }))
    assert update_result["destructive"] is False

    _patch_proposals_col(monkeypatch)
    sync_result = asyncio.run(execute_tool(UID, "propose_sync_now", {}))
    assert sync_result["destructive"] is False


# ═════════════════════════════════════════════════════════════════════════
# Section M — executors (can_i.py replays the real router function)
# ═════════════════════════════════════════════════════════════════════════

def test_execute_create_offline_account_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("create_offline_account", {
        "name": "Cash Jar", "account_type": "savings", "balance": 20.0,
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_create(body, user):
        captured["body"] = body
        return {"id": "off1", **body}

    monkeypatch.setattr(manual_accounts_module, "create_manual_account", fake_create)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["body"] == {"name": "Cash Jar", "account_type": "savings", "balance": 20.0}
    assert result["result"]["id"] == "off1"


def test_execute_update_offline_account_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_offline_account", {"account_id": "off1", "balance": 30.0})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_update(acc_id, body, user):
        captured["acc_id"] = acc_id
        captured["body"] = body
        return {"id": acc_id, "balance": body["balance"]}

    monkeypatch.setattr(manual_accounts_module, "update_manual_account", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"acc_id": "off1", "body": {"balance": 30.0}}
    assert result["result"]["balance"] == 30.0


def test_execute_delete_offline_account_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_offline_account", {"account_id": "off1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_delete(acc_id, user):
        captured["acc_id"] = acc_id
        return {"deleted": acc_id}

    monkeypatch.setattr(manual_accounts_module, "delete_manual_account", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"acc_id": "off1"}
    assert result["result"] == {"deleted": "off1"}


def test_execute_add_ledger_entry_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("add_ledger_entry", {
        "account_id": "off1", "amount": 20.0, "description": "Birthday money", "transaction_type": "credit",
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_add(acc_id, body, user):
        captured["acc_id"] = acc_id
        captured["body"] = body
        return {"id": "tx1", **body}

    monkeypatch.setattr(manual_accounts_module, "add_manual_transaction", fake_add)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["acc_id"] == "off1"
    assert captured["body"] == {"amount": 20.0, "description": "Birthday money", "transaction_type": "credit"}
    assert result["result"]["id"] == "tx1"


def test_execute_update_ledger_entry_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_ledger_entry", {
        "account_id": "off1", "entry_id": "tx1", "amount": 4.0,
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_update(acc_id, tx_id, body, user):
        captured["acc_id"] = acc_id
        captured["tx_id"] = tx_id
        captured["body"] = body
        return {"id": tx_id, "amount": body["amount"]}

    monkeypatch.setattr(manual_accounts_module, "update_manual_transaction", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"acc_id": "off1", "tx_id": "tx1", "body": {"amount": 4.0}}
    assert result["result"]["amount"] == 4.0


def test_execute_delete_ledger_entry_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_ledger_entry", {"account_id": "off1", "entry_id": "tx1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_delete(acc_id, tx_id, user):
        captured["acc_id"] = acc_id
        captured["tx_id"] = tx_id
        return {"deleted": tx_id}

    monkeypatch.setattr(manual_accounts_module, "delete_manual_transaction", fake_delete)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"acc_id": "off1", "tx_id": "tx1"}
    assert result["result"] == {"deleted": "tx1"}


def test_execute_create_account_rule_dispatches_real_route(monkeypatch):
    params = {
        "name": "Groceries mirror", "target_account_id": "off1", "match_type": "category",
        "match_value": "Groceries", "sign": "same", "match_field": None,
        "source_account_id": None, "backfill": False,
    }
    fake_proposals = _FakeCol([_live_doc("create_account_rule", params)])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_create_rule(body, user):
        captured["body"] = body
        return {"id": "rule1", **body}

    monkeypatch.setattr(manual_accounts_module, "create_rule", fake_create_rule)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["body"] == params
    assert result["result"]["id"] == "rule1"


def test_execute_update_account_rule_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("update_account_rule", {"rule_id": "rule1", "active": False})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_update_rule(rule_id, body, user):
        captured["rule_id"] = rule_id
        captured["body"] = body
        return {"id": rule_id, "active": body["active"]}

    monkeypatch.setattr(manual_accounts_module, "update_rule", fake_update_rule)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"rule_id": "rule1", "body": {"active": False}}
    assert result["result"]["active"] is False


def test_execute_delete_account_rule_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("delete_account_rule", {"rule_id": "rule1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.manual_accounts as manual_accounts_module

    captured = {}

    async def fake_delete_rule(rule_id, user):
        captured["rule_id"] = rule_id
        return {"deleted": rule_id}

    monkeypatch.setattr(manual_accounts_module, "delete_rule", fake_delete_rule)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"rule_id": "rule1"}
    assert result["result"] == {"deleted": "rule1"}


def test_execute_disconnect_bank_dispatches_real_service(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("disconnect_bank", {"connection_id": "conn1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.services.retention as retention_module

    captured = {}

    async def fake_disconnect(uid, connection_id):
        captured["uid"] = uid
        captured["connection_id"] = connection_id
        return {"deleted": connection_id, "accounts_removed": 2}

    monkeypatch.setattr(retention_module, "disconnect_connection", fake_disconnect)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"uid": UID, "connection_id": "conn1"}
    assert result["result"] == {"deleted": "conn1", "accounts_removed": 2}


def test_execute_disconnect_bank_raises_404_when_connection_gone(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("disconnect_bank", {"connection_id": "conn1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.services.retention as retention_module

    async def fake_disconnect(uid, connection_id):
        return None

    monkeypatch.setattr(retention_module, "disconnect_connection", fake_disconnect)

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc_info.value.status_code == 404


def test_execute_sync_now_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("sync_now", {})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.accounts as accounts_module

    captured = {}

    async def fake_sync_all(user):
        captured["user"] = user
        return {"message": "Synced", "connections": 1, "total_accounts": 2}

    monkeypatch.setattr(accounts_module, "sync_all", fake_sync_all)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["user"] == {"email": UID}
    assert result["result"]["message"] == "Synced"
