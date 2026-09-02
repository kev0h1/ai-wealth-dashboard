"""Tests for Penny Agent Mode v1 (owner decision, 2026-08-30, see
PENNY_TOOLS.md's "Write tools (propose-only)" section): the seven
propose-only write tools in app.services.penny_tools (six at v1 launch, plus
`propose_recategorise_transaction`, added the same day as a doctrine
amendment — user-initiated recategorisation only, the miscategorised-
guardrail queue stays excluded), the new get_fill_candidates read tool, the
consent/proposal-stop gating in app.services.penny_agent's loop, and the
/penny/agent-consent + /penny/proposals/{id}/execute + .../cancel endpoints
in app.routers.can_i.

No mongomock is available in this environment (see test_allocations.py's own
note) — DB-touching collections are replaced with a tiny in-memory fake
collection, `_FakeCol`, local to this file. NEVER touches the real
penny_proposals/preferences/allocations/commitments/planned collections, so
this suite creates nothing for the real owner, matching the standing rule.

CORE PRINCIPLE under test throughout: Penny PROPOSES, never executes. Every
`_exec_propose_*` executor must return a stored proposal dict (never mutate
real data itself), and only POST /penny/proposals/{id}/execute (replaying
the SAME router-level function the app's own confirm sheet calls) ever turns
one into a real write.
"""
import asyncio
import json
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_agent import run_penny_agent
from app.services.penny_tools import execute_tool

UID = "kevin"


def _acc(id_, name, balance=100.0, provider="Test Bank", type_="transaction"):
    return Account(id=id_, name=name, type=type_, balance=balance, provider=provider)


class _FakeCol:
    """Stand-in for a Motor collection — enough of find_one()/insert_one()/
    update_one() (exact-key-equality query matching only, sufficient for
    every use in this file) to drive the real proposal/execute/cancel code
    without touching real Mongo. Same minimal-fake convention
    test_allocations.py already established for this suite."""

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

    async def replace_one(self, filt, doc, upsert=False):
        """card_terms.py's own save_card_terms replace_one()s the whole
        terms document on every save (deliberately — see that function's
        own docstring) — only propose_set_card_apr's execute-side test
        needs this, added here rather than a new fake class since it's a
        pure addition, every other test in this file keeps using
        find_one/insert_one/update_one exactly as before."""
        for i, d in enumerate(self.docs):
            if self._match(d, filt):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))


# ═════════════════════════════════════════════════════════════════════════
# Section A — propose tool executors (app.services.penny_tools)
# ═════════════════════════════════════════════════════════════════════════

# ── propose_mirror_choice ───────────────────────────────────────────────

def test_propose_mirror_choice_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    async def fake_get_mirror(uid):
        return {"traits": [{"id": "t1", "title": "Weekend Splurger"}]}

    monkeypatch.setattr(penny_tools_module, "_exec_get_mirror", fake_get_mirror)

    result = asyncio.run(execute_tool(UID, "propose_mirror_choice", {"trait_id": "Weekend Splurger", "choice": "keep"}))

    assert result["proposal"] is True
    assert result["kind"] == "mirror_choice"
    assert result["params"] == {"trait_id": "t1", "choice": "keep"}
    assert len(fake_col.docs) == 1
    assert fake_col.docs[0]["kind"] == "mirror_choice"
    assert fake_col.docs[0]["expires_at"] - fake_col.docs[0]["created_at"] == timedelta(minutes=15)


def test_propose_mirror_choice_invalid_choice_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_mirror_choice", {"trait_id": "t1", "choice": "delete"}))
    assert "error" in result
    assert "proposal" not in result


def test_propose_mirror_choice_ambiguous_title(monkeypatch):
    async def fake_get_mirror(uid):
        return {"traits": [
            {"id": "t1", "title": "Weekend Splurger"},
            {"id": "t2", "title": "Weekend Warrior"},
        ]}

    monkeypatch.setattr(penny_tools_module, "_exec_get_mirror", fake_get_mirror)

    result = asyncio.run(execute_tool(UID, "propose_mirror_choice", {"trait_id": "weekend", "choice": "keep"}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


# ── propose_dismiss_recurring / propose_restore_recurring ──────────────

def test_propose_dismiss_recurring_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    async def fake_recurring(uid):
        return {"series": [{"name": "Netflix"}, {"name": "Spotify"}]}

    monkeypatch.setattr(penny_tools_module, "_exec_get_recurring_payments", fake_recurring)

    result = asyncio.run(execute_tool(UID, "propose_dismiss_recurring", {"key": "Netflix"}))
    assert result["proposal"] is True
    assert result["kind"] == "dismiss_recurring"
    assert result["params"] == {"key": "Netflix"}


def test_propose_dismiss_recurring_empty_key_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_dismiss_recurring", {"key": ""}))
    assert "error" in result


def test_propose_dismiss_recurring_ambiguous(monkeypatch):
    async def fake_recurring(uid):
        return {"series": [{"name": "Netflix"}, {"name": "Netgear Sub"}]}

    monkeypatch.setattr(penny_tools_module, "_exec_get_recurring_payments", fake_recurring)

    result = asyncio.run(execute_tool(UID, "propose_dismiss_recurring", {"key": "net"}))
    assert result.get("ambiguous") is True
    assert len(result["matches"]) == 2


def test_propose_restore_recurring_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    import app.routers.analytics as analytics_module

    async def fake_dismissed_series(user):
        return {"user": [{"key": "Netflix", "display_name": "Netflix"}]}

    monkeypatch.setattr(analytics_module, "dismissed_series", fake_dismissed_series)

    result = asyncio.run(execute_tool(UID, "propose_restore_recurring", {"key": "Netflix"}))
    assert result["proposal"] is True
    assert result["kind"] == "restore_recurring"
    assert result["params"] == {"key": "Netflix"}


def test_propose_restore_recurring_no_match_is_tool_error(monkeypatch):
    import app.routers.analytics as analytics_module

    async def fake_dismissed_series(user):
        return {"user": []}

    monkeypatch.setattr(analytics_module, "dismissed_series", fake_dismissed_series)

    result = asyncio.run(execute_tool(UID, "propose_restore_recurring", {"key": "Netflix"}))
    assert "error" in result


# ── propose_add_planned ─────────────────────────────────────────────────

def test_propose_add_planned_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    future = (date.today() + timedelta(days=5)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_add_planned", {"name": "Car service", "amount": 150, "date": future}))

    assert result["proposal"] is True
    assert result["kind"] == "add_planned"
    assert result["params"] == {"name": "Car service", "amount": 150.0, "date": future, "account_id": None}


def test_propose_add_planned_negative_amount_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_add_planned", {"name": "X", "amount": -5, "date": date.today().isoformat()}))
    assert "error" in result


def test_propose_add_planned_past_date_is_tool_error():
    past = (date.today() - timedelta(days=5)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_add_planned", {"name": "X", "amount": 10, "date": past}))
    assert "error" in result


def test_propose_add_planned_ambiguous_account(monkeypatch):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return [_acc("a1", "Joint Savings"), _acc("a2", "Joint Savings Pot")]

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)

    result = asyncio.run(execute_tool(UID, "propose_add_planned", {
        "name": "X", "amount": 10, "date": date.today().isoformat(), "account_id": "joint",
    }))
    assert result.get("ambiguous") is True


# ── propose_create_allocation ───────────────────────────────────────────

def _patch_allocation_db_bits(monkeypatch, *, owned=True, conflicts=False):
    import app.routers.accounts as accounts_module
    import app.routers.allocations as allocations_module

    async def fake_get_accounts(user):
        return [_acc("a1", "Monzo Savings")]

    async def fake_account_owned(uid, account_id):
        return owned

    async def fake_conflicts(uid, fill_account_id, match_type, match_value, exclude_id=None):
        return conflicts

    async def fake_pay_cfg(uid):
        return {"type": "calendar_month"}

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)
    monkeypatch.setattr(allocations_module, "_account_owned", fake_account_owned)
    monkeypatch.setattr(allocations_module, "_conflicts", fake_conflicts)
    monkeypatch.setattr(allocations_module, "_pay_cfg", fake_pay_cfg)


def test_propose_create_allocation_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)
    _patch_allocation_db_bits(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_create_allocation", {
        "name": "Saving Challenge", "amount_per_period": 9, "fill_account_id": "Monzo",
        "match_type": "description_contains", "match_value": "Saving Challenge",
        "recurrence": "every_period",
    }))

    assert result["proposal"] is True
    assert result["kind"] == "create_allocation"
    assert result["params"]["fill_account_id"] == "a1"
    assert result["params"]["name"] == "Saving Challenge"
    assert "Reduces safe to spend" in result["consequence"]
    assert "£9" in result["consequence"]


def test_propose_create_allocation_invalid_amount_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_create_allocation", {
        "name": "X", "amount_per_period": 0, "fill_account_id": "a1",
        "match_type": "description_contains", "match_value": "X", "recurrence": "every_period",
    }))
    assert "error" in result


def test_propose_create_allocation_conflict_is_tool_error(monkeypatch):
    _patch_allocation_db_bits(monkeypatch, conflicts=True)

    result = asyncio.run(execute_tool(UID, "propose_create_allocation", {
        "name": "X", "amount_per_period": 10, "fill_account_id": "Monzo",
        "match_type": "description_contains", "match_value": "X", "recurrence": "every_period",
    }))
    assert "error" in result
    assert "already fills" in result["error"]


def test_propose_create_allocation_account_not_found_is_tool_error(monkeypatch):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return [_acc("a1", "Monzo Savings")]

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)

    result = asyncio.run(execute_tool(UID, "propose_create_allocation", {
        "name": "X", "amount_per_period": 10, "fill_account_id": "Nonexistent Bank",
        "match_type": "description_contains", "match_value": "X", "recurrence": "every_period",
    }))
    assert "error" in result
    assert "no account matching" in result["error"]


# ── propose_create_commitment ───────────────────────────────────────────

def test_propose_create_commitment_happy_path(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_col)

    import app.routers.commitments as commitments_module

    async def fake_preview(body, user):
        return {"per_period_slice": 50, "feasibility": "surplus", "feasibility_note": "Likely coverable from your monthly spare rate."}

    monkeypatch.setattr(commitments_module, "preview_commitment", fake_preview)

    target = (date.today() + timedelta(days=200)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_create_commitment", {"name": "Japan trip", "amount": 2000, "target_date": target}))

    assert result["proposal"] is True
    assert result["kind"] == "create_commitment"
    assert result["consequence"] == "Likely coverable from your monthly spare rate."
    assert result["params"]["funding_pots"] == []


def test_propose_create_commitment_past_target_date_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_create_commitment", {"name": "X", "amount": 100, "target_date": "2000-01-01"}))
    assert "error" in result


def test_propose_create_commitment_invalid_amount_is_tool_error():
    target = (date.today() + timedelta(days=100)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_create_commitment", {"name": "X", "amount": -1, "target_date": target}))
    assert "error" in result


def test_propose_create_commitment_ambiguous_pot_account(monkeypatch):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return [_acc("a1", "ISA Pot"), _acc("a2", "ISA Pot Extra")]

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)

    target = (date.today() + timedelta(days=100)).isoformat()
    result = asyncio.run(execute_tool(UID, "propose_create_commitment", {
        "name": "X", "amount": 100, "target_date": target, "funding_pots": [{"account_id": "ISA"}],
    }))
    assert result.get("ambiguous") is True


# ── get_fill_candidates (read tool) ─────────────────────────────────────

def test_get_fill_candidates_happy_path(monkeypatch):
    import app.routers.accounts as accounts_module
    import app.routers.allocations as allocations_module

    async def fake_get_accounts(user):
        return [_acc("a1", "Monzo Savings")]

    async def fake_fill_candidates(account_id, user):
        assert account_id == "a1"
        return {"items": [{"display_name": "Saving Challenge", "last_amount": 9.0, "last_date": "2026-08-20", "occurrences_90d": 12}]}

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)
    monkeypatch.setattr(allocations_module, "fill_candidates", fake_fill_candidates)

    result = asyncio.run(execute_tool(UID, "get_fill_candidates", {"account_id_or_name": "Monzo"}))
    assert result["account_id"] == "a1"
    assert result["candidates"][0]["display_name"] == "Saving Challenge"
    assert result["candidates"][0]["last_amount"]["raw"] == 9.0


def test_get_fill_candidates_requires_account():
    result = asyncio.run(execute_tool(UID, "get_fill_candidates", {}))
    assert "error" in result


def test_get_fill_candidates_ambiguous_account(monkeypatch):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return [_acc("a1", "Joint Savings"), _acc("a2", "Joint Savings Pot")]

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)

    result = asyncio.run(execute_tool(UID, "get_fill_candidates", {"account_id_or_name": "joint"}))
    assert result.get("ambiguous") is True


# ── propose_recategorise_transaction ────────────────────────────────────
# Owner amendment, 2026-08-30: user-initiated recategorisation joins the
# propose/confirm set. `_FakeTxnCol` supports real query filtering (exact
# equality plus $gte/$lte/$in/$ne) — unlike `_FakeCol` above, this resolver
# needs date-range and merchant-fuzzy filtering to actually behave like the
# real `transactions_col`, not just find_one/insert_one/update_one.

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d

    async def to_list(self, n=None):
        return list(self._docs)

    def sort(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self


class _FakeTxnCol:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _matches(d, query):
        for k, v in (query or {}).items():
            if isinstance(v, dict):
                dv = d.get(k)
                if "$gte" in v and not (dv is not None and dv >= v["$gte"]):
                    return False
                if "$lte" in v and not (dv is not None and dv <= v["$lte"]):
                    return False
                if "$in" in v and dv not in v["$in"]:
                    return False
                if "$ne" in v and dv == v["$ne"]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if self._matches(d, query or {}):
                return d
        return None

    def find(self, query=None, projection=None):
        return _FakeCursor([d for d in self.docs if self._matches(d, query or {})])

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._matches(d, filt):
                d.update(update.get("$set") or {})
                return


def _txn_doc(_id="t1", merchant="SAINSBURYS", desc="SAINSBURYS S/MKTS", amount=23.40,
             category="Groceries", custom_category=None, day="2026-08-27", uid=UID,
             merchant_key="sainsburys"):
    return {
        "_id": _id, "user_id": uid, "merchant_name": merchant, "description": desc,
        "amount": amount, "transaction_type": "debit", "category": category,
        "custom_category": custom_category, "date": datetime.fromisoformat(day),
        "account_id": "acc1", "merchant_key": merchant_key,
    }


def _categories_payload(extra_custom=None, extra_kinds=None):
    from app.services.categories import BUILTIN_CATEGORIES, BUILTIN_CATEGORY_KINDS

    custom = extra_custom or []
    kinds = {**BUILTIN_CATEGORY_KINDS, **(extra_kinds or {})}
    return {
        "builtin": BUILTIN_CATEGORIES, "custom": custom,
        "all": BUILTIN_CATEGORIES + custom, "kinds": kinds,
    }


def _patch_get_categories(monkeypatch, payload=None):
    import app.routers.categories as categories_module

    async def fake_get_categories(user):
        return payload or _categories_payload()

    monkeypatch.setattr(categories_module, "get_categories", fake_get_categories)


def _patch_recat_txn_col(monkeypatch, docs):
    fake_col = _FakeTxnCol(docs)
    monkeypatch.setattr(penny_tools_module, "transactions_col", fake_col)
    import app.services.categorisation as categorisation_module
    monkeypatch.setattr(categorisation_module, "transactions_col", fake_col)
    return fake_col


def _patch_subscription_tier(monkeypatch, tier):
    import app.core.subscription as subscription_module

    class _FakeSub:
        def __init__(self, t):
            self.tier = t
            self.tier_name = subscription_module.TIER_NAMES[t]

    async def fake_get_subscription(email):
        return _FakeSub(tier)

    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)
    return subscription_module


def test_propose_recategorise_resolves_by_id(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "just_once",
    }))
    assert result["proposal"] is True
    assert result["params"]["transaction_id"] == "t1"


def test_propose_recategorise_resolves_by_merchant_date_amount_triple(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "merchant": "sainsbury", "date": "2026-08-27", "amount": 23.40,
        "new_category": "Eating Out", "scope": "just_once",
    }))
    assert result["proposal"] is True
    assert result["params"]["transaction_id"] == "t1"


def test_propose_recategorise_ambiguous_triple_returns_matches(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [
        _txn_doc(_id="t1", amount=23.40),
        _txn_doc(_id="t2", amount=11.00),
    ])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "merchant": "sainsbury", "date": "2026-08-27",
        "new_category": "Eating Out", "scope": "just_once",
    }))
    assert result.get("ambiguous") is True
    assert {m["id"] for m in result["matches"]} == {"t1", "t2"}


def test_propose_recategorise_no_ref_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "new_category": "Eating Out", "scope": "just_once",
    }))
    assert "error" in result


def test_propose_recategorise_not_found_is_tool_error(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [])
    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "nope", "new_category": "Eating Out", "scope": "just_once",
    }))
    assert "error" in result


def test_propose_recategorise_out_of_reach_collection_is_tool_error(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [])  # not in transactions_col
    monkeypatch.setattr(penny_tools_module, "yapily_transactions_col", _FakeTxnCol([_txn_doc(_id="t9")]))
    monkeypatch.setattr(penny_tools_module, "statement_transactions_col", _FakeTxnCol([]))
    monkeypatch.setattr(penny_tools_module, "mono_transactions_col", _FakeTxnCol([]))
    monkeypatch.setattr(penny_tools_module, "mpesa_transactions_col", _FakeTxnCol([]))

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t9", "new_category": "Eating Out", "scope": "just_once",
    }))
    assert "error" in result
    assert "isn't one Penny can recategorise" in result["error"]


def test_propose_recategorise_invalid_category_lists_suggestions(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eatin Out", "scope": "just_once",
    }))
    assert "error" in result
    assert "Eating Out" in result["error"]


def test_propose_recategorise_movement_category_rejected(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Transfer", "scope": "just_once",
    }))
    assert "error" in result


def test_propose_recategorise_already_filed_is_tool_error(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc(category="Eating Out")])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "just_once",
    }))
    assert "error" in result
    assert "already filed" in result["error"]


def test_propose_recategorise_missing_scope_is_tool_error(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out",
    }))
    assert "error" in result


def test_propose_recategorise_invalid_scope_is_tool_error(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "sometimes",
    }))
    assert "error" in result


def test_propose_recategorise_just_once_proposal_shape_verbatim(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "just_once",
    }))
    assert result["kind"] == "recategorise_transaction"
    assert result["summary"] == "File the SAINSBURYS £23.40 on 27 Aug as Eating Out instead of Groceries."
    assert result["consequence"] == "Changes only this transaction."
    assert result["params"] == {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "just_once",
        "previous_category": "Groceries",
    }


def test_propose_recategorise_always_shape_with_real_blast_radius(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    # The primary transaction plus 14 other never-corrected (custom_category
    # None) Sainsbury's rows the rule would also match — the fixture history
    # the "always" blast-radius count must be derived from, not invented.
    history = [_txn_doc()] + [
        _txn_doc(_id=f"h{i}", desc="SAINSBURYS S/MKTS LONDON", amount=10 + i, day="2026-08-01")
        for i in range(14)
    ]
    _patch_recat_txn_col(monkeypatch, history)
    _patch_get_categories(monkeypatch)
    _patch_subscription_tier(monkeypatch, __import__("app.core.subscription", fromlist=["Tier"]).Tier.PRO)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "always",
    }))
    assert result["kind"] == "recategorise_transaction"
    assert result["summary"] == "Always file SAINSBURYS as Eating Out instead of Groceries."
    assert result["consequence"] == "Sets a rule for this merchant and refiles 14 past transactions."
    assert result["params"]["scope"] == "always"
    assert result["params"]["pattern"]


def test_propose_recategorise_always_no_past_matches(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)
    import app.core.subscription as subscription_module
    _patch_subscription_tier(monkeypatch, subscription_module.Tier.PRO)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "always",
    }))
    assert result["consequence"] == "Sets a rule for this merchant. No past transactions match it yet."


def test_propose_recategorise_always_requires_pro_tier(monkeypatch):
    _patch_recat_txn_col(monkeypatch, [_txn_doc()])
    _patch_get_categories(monkeypatch)
    import app.core.subscription as subscription_module
    _patch_subscription_tier(monkeypatch, subscription_module.Tier.FREE)

    result = asyncio.run(execute_tool(UID, "propose_recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "always",
    }))
    assert "error" in result
    assert "Pro" in result["error"]


def test_no_guardrail_queue_propose_tools_exist():
    # The miscategorised-guardrail queue (transfer-pair suggestions, dismiss-
    # miscategorised, resolve-movement) stays explicitly EXCLUDED from the
    # 2026-08-30 recategorisation amendment — no propose tool for that
    # domain, ever, per PENNY_TOOLS.md's own doctrine text.
    names = penny_tools_module.PROPOSE_TOOL_NAMES
    banned_substrings = ("transfer_pair", "miscategorised", "resolve_movement")
    for name in names:
        for bad in banned_substrings:
            assert bad not in name, f"guardrail-queue tool leaked into propose set: {name}"


def test_execute_recategorise_transaction_just_once_dispatches_patch_endpoint(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "just_once",
        "previous_category": "Groceries",
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.transactions as transactions_module

    captured = {}

    async def fake_update_transaction(transaction_id, body, user):
        captured["transaction_id"] = transaction_id
        captured["body"] = body
        return {"updated": transaction_id, "custom_category": body["category"], "bulk_count": 0,
                "merchant_key": "sainsburys", "matches_past": 0, "rule_suggestion": None}

    monkeypatch.setattr(transactions_module, "update_transaction", fake_update_transaction)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured == {"transaction_id": "t1", "body": {"category": "Eating Out"}}
    assert result["result"]["custom_category"] == "Eating Out"


def test_execute_recategorise_transaction_always_dispatches_add_rule(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "always",
        "previous_category": "Groceries", "pattern": r"\bsainsburys\b", "merchant_label": "SAINSBURYS",
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.core.subscription as subscription_module
    _patch_subscription_tier(monkeypatch, subscription_module.Tier.PRO)

    import app.routers.categories as categories_module
    import app.routers.transactions as transactions_module

    patch_captured = {}
    rule_captured = {}

    async def fake_update_transaction(transaction_id, body, user):
        patch_captured["transaction_id"] = transaction_id
        patch_captured["body"] = body
        return {"updated": transaction_id, "custom_category": body["category"], "bulk_count": 0,
                "merchant_key": "sainsburys", "matches_past": 0, "rule_suggestion": None}

    async def fake_add_rule(body, user):
        rule_captured.update(body)
        return {"id": "rule1", "description": body["description"], "pattern": body["pattern"],
                "category": body["category"], "affected": [{"id": "h1", "previous_category": "Groceries"}]}

    monkeypatch.setattr(transactions_module, "update_transaction", fake_update_transaction)
    monkeypatch.setattr(categories_module, "add_rule", fake_add_rule)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    # Two-step sequence, primary transaction PATCHed BEFORE the rule is
    # created — mirrors TeachingSheet's own commitSpend-then-handleAlways
    # ordering (see _execute_recategorise_transaction's own doctrine note).
    assert patch_captured == {"transaction_id": "t1", "body": {"category": "Eating Out"}}
    assert rule_captured["pattern"] == r"\bsainsburys\b"
    assert rule_captured["category"] == "Eating Out"
    assert result["result"]["transaction"]["custom_category"] == "Eating Out"
    assert result["result"]["rule"]["id"] == "rule1"


def test_execute_recategorise_transaction_always_requires_pro_tier_at_execute_time(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("recategorise_transaction", {
        "transaction_id": "t1", "new_category": "Eating Out", "scope": "always",
        "previous_category": "Groceries", "pattern": r"\bsainsburys\b", "merchant_label": "SAINSBURYS",
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.core.subscription as subscription_module
    _patch_subscription_tier(monkeypatch, subscription_module.Tier.FREE)

    import app.routers.categories as categories_module
    import app.routers.transactions as transactions_module

    async def fail_add_rule(body, user):
        raise AssertionError("must never create a rule for a Free-tier user")

    async def fail_update_transaction(transaction_id, body, user):
        raise AssertionError("must never patch the transaction either — the tier gate fires before both calls")

    monkeypatch.setattr(categories_module, "add_rule", fail_add_rule)
    monkeypatch.setattr(transactions_module, "update_transaction", fail_update_transaction)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 402


# ═════════════════════════════════════════════════════════════════════════
# Section B — loop gating (app.services.penny_agent)
# ═════════════════════════════════════════════════════════════════════════

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
                "tool_calls": [{"id": call_id, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}],
            },
        }],
    })


def _final_payload(text: str) -> _FakeResponse:
    return _FakeResponse(payload={"choices": [{"message": {"content": text}}]})


class _ScriptedAsyncClient:
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


def _patch_consent(monkeypatch, consented: bool):
    async def fake_find_one(query, proj=None):
        return {"penny_agent_consent": "2026-08-30T00:00:00"} if consented else None

    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", fake_find_one)


def test_run_penny_agent_offers_propose_tools_even_when_not_consented(monkeypatch):
    # Flow fix, 2026-08-30 (owner-caught via live verification): the original
    # build only appended PROPOSE_TOOL_SCHEMAS when consented, which made the
    # dispatch-level consent_required branch unreachable dead code — an
    # unconsented user asking for an action got a model that never knew a
    # propose tool existed, so it just declined out-of-scope instead of ever
    # triggering the one-time consent moment. The schemas must now be offered
    # UNCONDITIONALLY; only the dispatch-time check below gates on consent.
    _patch_consent(monkeypatch, consented=False)
    client = _ScriptedAsyncClient([_final_payload("HEADLINE: ok\nREPLY: fine.")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))

    names = {t["function"]["name"] for t in client.calls[0]["tools"]}
    assert "propose_create_allocation" in names
    assert "propose_mirror_choice" in names
    assert "get_safe_to_spend" in names
    assert "get_fill_candidates" in names


def test_run_penny_agent_offers_propose_tools_when_consented(monkeypatch):
    _patch_consent(monkeypatch, consented=True)
    client = _ScriptedAsyncClient([_final_payload("HEADLINE: ok\nREPLY: fine.")])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))

    names = {t["function"]["name"] for t in client.calls[0]["tools"]}
    assert "propose_create_allocation" in names
    assert "propose_mirror_choice" in names


def test_run_penny_agent_system_prompt_carries_write_tools_addendum_regardless_of_consent(monkeypatch):
    # The model is never told a propose tool might be refused — the server
    # is the only gate (requirement: guidance must not claim unavailability).
    for consented in (False, True):
        _patch_consent(monkeypatch, consented=consented)
        client = _ScriptedAsyncClient([_final_payload("HEADLINE: ok\nREPLY: fine.")])
        monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

        asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))

        system_msg = client.calls[0]["messages"][0]
        assert system_msg["role"] == "system"
        assert "propose_create_allocation" in system_msg["content"]
        assert "unavailable" not in system_msg["content"].lower()


def test_run_penny_agent_consent_required_when_propose_tool_attempted_without_consent(monkeypatch):
    _patch_consent(monkeypatch, consented=False)
    client = _ScriptedAsyncClient([_tool_call_payload("propose_create_allocation", {"name": "X"})])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("must never execute a propose tool without consent — attempted intent must not be persisted")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))
    assert result == {"consent_required": True}


def test_run_penny_agent_stops_loop_when_tool_returns_proposal(monkeypatch):
    _patch_consent(monkeypatch, consented=True)
    client = _ScriptedAsyncClient([
        _tool_call_payload("propose_create_allocation", {"name": "X"}),
        _final_payload("HEADLINE: should never be reached\nREPLY: nope"),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    proposal = {"proposal": True, "proposal_id": "abc", "kind": "create_allocation", "summary": "s", "consequence": "c", "params": {}}

    async def fake_execute_tool(uid, name, args):
        return proposal

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))
    assert result == {"proposal": proposal}
    assert len(client.calls) == 1  # loop stopped at the proposal, no final-answer round


def test_run_penny_agent_ordinary_read_tool_unaffected_by_consent_gate(monkeypatch):
    # A non-consenting user's ordinary (read-only) question must behave
    # exactly as before this feature — proves the consent gate is scoped to
    # PROPOSE_TOOL_NAMES only, never a blanket block on tool calls.
    _patch_consent(monkeypatch, consented=False)
    client = _ScriptedAsyncClient([
        _tool_call_payload("get_safe_to_spend", {}),
        _final_payload("HEADLINE: You have headroom\nREPLY: You have £100 free."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute_tool(uid, name, args):
        return {"safe_to_spend": {"raw": 100.0, "formatted": "£100"}}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "how much can I spend", [], None, ""))
    assert result["headline"] == "You have headroom"


# ═════════════════════════════════════════════════════════════════════════
# Section C — can_i.py seam: consent_required / proposal response branches
# ═════════════════════════════════════════════════════════════════════════

async def _noop_check_ai_chat_limit(email):
    return None


def _patch_can_i_common(monkeypatch):
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_module, "check_ai_chat_limit", _noop_check_ai_chat_limit)


def test_can_i_seam_consent_required_branch_charges_no_usage(monkeypatch):
    _patch_can_i_common(monkeypatch)
    usage_calls = []

    async def spy_increment(uid):
        usage_calls.append(uid)

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", spy_increment)

    async def fake_agent(uid, question, history, screen, context):
        return {"consent_required": True}

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    result = asyncio.run(can_i_module.can_i({"question": "set up an allocation for me please"}, {"email": UID}))

    assert result["consent_required"] is True
    assert result["out_of_scope"] is False
    assert usage_calls == []


def test_can_i_seam_proposal_branch_charges_usage_once(monkeypatch):
    _patch_can_i_common(monkeypatch)
    usage_calls = []

    async def spy_increment(uid):
        usage_calls.append(uid)

    monkeypatch.setattr(can_i_module, "increment_ai_chat_usage", spy_increment)

    proposal = {
        "proposal": True, "proposal_id": "abc123", "kind": "create_allocation",
        "summary": "Create allocation 'Saving Challenge'",
        "consequence": "Reduces safe to spend by about £9 this period, less anything already paid in.",
        "params": {"name": "Saving Challenge"},
    }

    async def fake_agent(uid, question, history, screen, context):
        return {"proposal": proposal}

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)

    result = asyncio.run(can_i_module.can_i({"question": "set up an allocation for £9 a period"}, {"email": UID}))

    assert result["proposal"] == proposal
    assert result["headline"] == "Create allocation 'Saving Challenge'"
    assert "£9" in result["reply"]
    assert usage_calls == [UID]


# ═════════════════════════════════════════════════════════════════════════
# Section D — proposal infra: consent grant, execute (idempotent, expiry),
# cancel, created_via stamping, audit log
# ═════════════════════════════════════════════════════════════════════════

def _live_doc(kind, params, **overrides):
    now = datetime.now()
    doc = {
        "_id": "p-test", "user_id": UID, "kind": kind, "params": params,
        "summary": "s", "consequence": "c",
        "created_at": now, "expires_at": now + timedelta(minutes=15),
        "executed_at": None, "result": None, "cancelled_at": None,
    }
    doc.update(overrides)
    return doc


def _patch_consented_prefs(monkeypatch) -> "_FakeCol":
    """execute_proposal re-checks consent live at execute time (owner
    follow-up, 2026-08-30 — see revoke_agent_consent's own docstring), so
    every test that expects a proposal to actually DISPATCH needs a
    consenting preferences_col in place first. Tests that expect execute to
    reject BEFORE reaching that check (not found, cancelled, expired) don't
    need this."""
    fake_prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)
    return fake_prefs


def test_grant_agent_consent_sets_preference(monkeypatch):
    fake_prefs = _FakeCol()
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    result = asyncio.run(can_i_module.grant_agent_consent(user={"email": UID}))
    assert result["penny_agent_consent"]
    assert fake_prefs.docs[0]["penny_agent_consent"] == result["penny_agent_consent"]
    assert fake_prefs.docs[0]["user_id"] == UID


def test_revoke_agent_consent_clears_preference(monkeypatch):
    fake_prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    result = asyncio.run(can_i_module.revoke_agent_consent(user={"email": UID}))
    assert result == {"penny_agent_consent": None}
    assert fake_prefs.docs[0]["penny_agent_consent"] is None


def test_revoke_agent_consent_idempotent_when_never_consented(monkeypatch):
    fake_prefs = _FakeCol()  # no doc at all yet
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    result = asyncio.run(can_i_module.revoke_agent_consent(user={"email": UID}))
    assert result == {"penny_agent_consent": None}

    # Revoking again (already off) still succeeds, never errors.
    result2 = asyncio.run(can_i_module.revoke_agent_consent(user={"email": UID}))
    assert result2 == {"penny_agent_consent": None}


def test_run_penny_agent_dispatch_gate_still_blocks_after_revocation(monkeypatch):
    # Same live-lookup path as "never consented" (app.services.penny_agent
    # never caches consent) — revoking must reach the identical dispatch-time
    # refusal. Tools are still OFFERED (see the flow-fix tests above), the
    # gate now lives only at dispatch: a revoked user's model attempting a
    # propose tool must still get consent_required, never a real dispatch.
    _patch_consent(monkeypatch, consented=False)
    client = _ScriptedAsyncClient([_tool_call_payload("propose_create_allocation", {"name": "X"})])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("must never dispatch a propose tool after consent was revoked")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "set up an allocation for me", [], None, ""))
    assert result == {"consent_required": True}


def test_execute_proposal_rejects_after_consent_revoked(monkeypatch):
    # A proposal built WHILE consented, still sitting in its 15-minute
    # window unactioned, must not execute once consent is revoked — the
    # owner's explicit follow-up requirement. Not found/cancelled/expired
    # all short-circuit before this check, so this pins the one path that
    # previously would have dispatched.
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    fake_prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": None}])  # revoked
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    async def fail_executor(uid, params):
        raise AssertionError("must never dispatch a proposal after consent was revoked")

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"dismiss_recurring": fail_executor})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 403
    assert "revoked" in exc.value.detail.lower()


def test_execute_proposal_not_found_404(monkeypatch):
    fake_col = _FakeCol()
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("nope", user={"email": UID}))
    assert exc.value.status_code == 404


def test_execute_proposal_wrong_user_404(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"}, _id="p-other", user_id="someone-else")])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-other", user={"email": UID}))
    assert exc.value.status_code == 404


def test_execute_proposal_idempotent_double_execute(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    _patch_consented_prefs(monkeypatch)

    call_count = {"n": 0}

    async def fake_executor(uid, params):
        call_count["n"] += 1
        return {"ok": True, "key": params["key"]}

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"dismiss_recurring": fake_executor})

    result1 = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result1["executed"] is True
    assert result1["replayed"] is False
    assert call_count["n"] == 1

    result2 = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result2["executed"] is True
    assert result2["replayed"] is True
    assert result2["result"] == {"ok": True, "key": "Netflix"}
    assert call_count["n"] == 1  # not dispatched a second time


def test_execute_proposal_expired_rejects(monkeypatch):
    past = datetime.now() - timedelta(minutes=1)
    doc = _live_doc("dismiss_recurring", {"key": "Netflix"}, created_at=past - timedelta(minutes=15), expires_at=past)
    fake_col = _FakeCol([doc])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 410


def test_cancel_then_execute_rejects(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)

    cancel_result = asyncio.run(can_i_module.cancel_proposal("p-test", user={"email": UID}))
    assert cancel_result == {"cancelled": True, "proposal_id": "p-test"}
    assert fake_col.docs[0]["cancelled_at"] is not None

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 410


def test_execute_then_cancel_rejects(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    _patch_consented_prefs(monkeypatch)

    async def fake_executor(uid, params):
        return {"ok": True}

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"dismiss_recurring": fake_executor})

    asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.cancel_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 410


def test_cancel_already_cancelled_is_a_noop_success(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)

    asyncio.run(can_i_module.cancel_proposal("p-test", user={"email": UID}))
    result2 = asyncio.run(can_i_module.cancel_proposal("p-test", user={"email": UID}))
    assert result2 == {"cancelled": True, "proposal_id": "p-test"}


def test_execute_proposal_unknown_kind_500(monkeypatch):
    fake_col = _FakeCol([_live_doc("not_a_real_kind", {})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    _patch_consented_prefs(monkeypatch)
    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 500


def test_execute_proposal_logs_audit_line(monkeypatch, caplog):
    fake_col = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    _patch_consented_prefs(monkeypatch)

    async def fake_executor(uid, params):
        return {"ok": True}

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"dismiss_recurring": fake_executor})

    with caplog.at_level("INFO", logger="app.routers.can_i"):
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))

    audit_records = [r for r in caplog.records if "penny_proposal_audit" in r.message]
    assert len(audit_records) == 1
    # Observability fix (owner phone report 2026-08-28): this line used to be
    # logger.info(...), invisible under prod's effective logging threshold
    # (uvicorn --log-level warning) — promoted to .warning() so the audit
    # trail is actually visible in `journalctl -u wealth-api`. See the
    # promotion rationale comment above the logger.warning(...) call site.
    assert audit_records[0].levelname == "WARNING"
    audit_lines = [r.message for r in audit_records]
    assert f"uid={UID}" in audit_lines[0]
    assert "proposal_id=p-test" in audit_lines[0]
    assert "kind=dismiss_recurring" in audit_lines[0]
    assert "source=penny" in audit_lines[0]


def test_execute_create_allocation_stamps_created_via(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("create_allocation", {
        "name": "Saving Challenge", "amount_per_period": 9, "fill_account_id": "a1",
        "match_type": "description_contains", "match_value": "Saving", "recurrence": "every_period",
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    fake_allocations_col = _FakeCol()
    import app.db.collections as collections_module
    monkeypatch.setattr(collections_module, "allocations_col", fake_allocations_col)

    import app.routers.allocations as allocations_module

    async def fake_create_allocation(body, user):
        doc_id = "alloc1"
        fake_allocations_col.docs.append({"_id": doc_id, **body})
        return {"id": doc_id, "name": body["name"], "created_via": None}

    monkeypatch.setattr(allocations_module, "create_allocation", fake_create_allocation)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"]["created_via"] == "penny"
    assert fake_allocations_col.docs[0]["_id"] == "alloc1"
    assert fake_allocations_col.docs[0]["created_via"] == "penny"


def test_execute_add_planned_stamps_created_via(monkeypatch):
    future = (date.today() + timedelta(days=5)).isoformat()
    fake_proposals = _FakeCol([_live_doc("add_planned", {"name": "Car service", "amount": 150, "date": future, "account_id": None})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    fake_planned_col = _FakeCol()
    import app.db.collections as collections_module
    monkeypatch.setattr(collections_module, "planned_expenses_col", fake_planned_col)

    import app.routers.planned as planned_module

    async def fake_create_planned(body, user):
        doc_id = "planned1"
        fake_planned_col.docs.append({"_id": doc_id, **body})
        return {
            "planned": {
                "id": doc_id, "name": body["name"], "amount": body["amount"], "date": body["date"],
                "account_id": body.get("account_id"), "status": "planned", "created_via": None,
            },
            "impact": {"safe_to_spend_before": 100, "safe_to_spend_after": 90, "state_after": "comfortable"},
        }

    monkeypatch.setattr(planned_module, "create_planned_expense", fake_create_planned)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"]["planned"]["created_via"] == "penny"
    assert fake_planned_col.docs[0]["_id"] == "planned1"


def test_execute_create_commitment_stamps_created_via_and_sets_source(monkeypatch):
    target = (date.today() + timedelta(days=200)).isoformat()
    fake_proposals = _FakeCol([_live_doc("create_commitment", {"name": "Japan trip", "amount": 2000, "target_date": target, "funding_pots": []})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    fake_commitments_col = _FakeCol()
    import app.db.collections as collections_module
    monkeypatch.setattr(collections_module, "commitments_col", fake_commitments_col)

    import app.routers.commitments as commitments_module

    captured_body = {}

    async def fake_create_commitment(body, user):
        captured_body.update(body)
        doc_id = "commit1"
        fake_commitments_col.docs.append({"_id": doc_id, **body})
        return {"id": doc_id, "name": body["name"], "created_via": None}

    monkeypatch.setattr(commitments_module, "create_commitment", fake_create_commitment)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"]["created_via"] == "penny"
    assert captured_body["source"] == "can_i"
    assert fake_commitments_col.docs[0]["_id"] == "commit1"


def test_execute_mirror_choice_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("mirror_choice", {"trait_id": "t1", "choice": "keep"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.behaviour as behaviour_module

    captured = {}

    async def fake_set_mirror_choice(body, user):
        captured["trait_id"] = body.trait_id
        captured["choice"] = body.choice
        return {"ok": True, "trait_id": body.trait_id, "choice": body.choice}

    monkeypatch.setattr(behaviour_module, "set_mirror_choice", fake_set_mirror_choice)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"] == {"ok": True, "trait_id": "t1", "choice": "keep"}
    assert captured == {"trait_id": "t1", "choice": "keep"}


def test_execute_dismiss_recurring_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("dismiss_recurring", {"key": "Netflix"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.analytics as analytics_module

    captured = {}

    async def fake_dismiss_recurring(body, user):
        captured["key"] = body["key"]
        return {"ok": True}

    monkeypatch.setattr(analytics_module, "dismiss_recurring", fake_dismiss_recurring)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"] == {"ok": True}
    assert captured == {"key": "Netflix"}


# ═════════════════════════════════════════════════════════════════════════
# Section E — propose_set_card_apr (owner Doctrine amendment #2, 2026-08-30)
# ═════════════════════════════════════════════════════════════════════════
# "we probably want to add an agent skill to add Apr to credit cards too" —
# card terms were excluded from Penny Agent Mode v1 at launch (an LLM
# mishearing a rate has no independent check); the owner overrode that the
# same day, and the mitigation is a VERBATIM-PROVENANCE rule: apr_pct must
# appear as an exact number in the user's own words (this turn or an
# earlier one), never inferred. `_user_texts` is the mechanism
# app.services.penny_agent threads this through — see that module's own
# dispatch-loop comment — passed here directly via execute_tool's `args`
# dict exactly as the real loop injects it.

def _card_acc(id_, name, balance=-500.0, provider="NatWest", account_number=None):
    return Account(
        id=id_, name=name, type="credit_card", subtype="CREDIT_CARD",
        balance=balance, provider=provider, account_number=account_number,
    )


def _patch_card_apr_accounts(monkeypatch, accounts):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return accounts

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)


# ── Provenance ───────────────────────────────────────────────────────────

def test_propose_card_apr_provenance_in_current_message(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
        "_user_texts": ["set the APR on my corporate green amex to 24.9%"],
    }))
    assert result["proposal"] is True
    assert result["kind"] == "set_card_apr"
    assert result["params"] == {"account_id": "c1", "apr_pct": 24.9}
    assert result["summary"] == "Set Green Amex (American Express) standard APR to 24.9%."
    assert result["consequence"] == "Used for your card plan and interest projections."
    assert len(fake_proposals.docs) == 1


def test_propose_card_apr_provenance_from_earlier_turn(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
        "_user_texts": ["my amex is on 24.9 percent", "yes please set it"],
    }))
    assert result["proposal"] is True


def test_propose_card_apr_provenance_absent_needs_input_no_proposal(monkeypatch):
    fake_proposals = _FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", fake_proposals)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
        "_user_texts": ["set the APR on my amex"],
    }))
    assert result == {"needs_input": True, "ask": "What APR is Green Amex? Type the number and I'll set it."}
    assert fake_proposals.docs == []


def test_propose_card_apr_vague_number_not_provenanced(monkeypatch):
    # "roughly 25" literally contains the number 25, but the model here
    # supplies a more-precise invented figure (24.9) that never appears —
    # provenance must be an EXACT match, not "in the neighbourhood of".
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
        "_user_texts": ["what's a normal APR? just set mine to that, roughly 25"],
    }))
    assert result.get("needs_input") is True


def test_propose_card_apr_no_user_texts_at_all_needs_input(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
    }))
    assert result.get("needs_input") is True


def test_propose_card_apr_states_before_value_when_recorded(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol([
        {"_id": f"{UID}:c1", "apr_pct": 21.9},
    ]))
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9,
        "_user_texts": ["set the APR on my amex to 24.9%"],
    }))
    assert result["consequence"] == "Used for your card plan and interest projections. Currently recorded: 21.9%."


# ── Resolution ───────────────────────────────────────────────────────────

def test_propose_card_apr_resolves_by_id_directly(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_apr_accounts(monkeypatch, [
        _card_acc("c1", "Mastercard", provider="NatWest"),
        _card_acc("c2", "Mastercard", provider="NatWest"),
    ])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "c2", "apr_pct": 19.9,
        "_user_texts": ["set c2 to 19.9%"],
    }))
    assert result["proposal"] is True
    assert result["params"]["account_id"] == "c2"


def test_propose_card_apr_ambiguous_two_mastercards_includes_distinguishing_detail(monkeypatch):
    _patch_card_apr_accounts(monkeypatch, [
        _card_acc("c1", "Mastercard", provider="NatWest", balance=-120.50, account_number="512345001234"),
        _card_acc("c2", "Mastercard", provider="NatWest", balance=-980.00, account_number="512345006789"),
    ])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "mastercard", "apr_pct": 27.9,
        "_user_texts": ["set my mastercard apr to 27.9"],
    }))
    assert result.get("ambiguous") is True
    matches = {m["id"]: m for m in result["matches"]}
    assert set(matches) == {"c1", "c2"}
    assert matches["c1"]["last4"] == "1234"
    assert matches["c2"]["last4"] == "6789"
    assert matches["c1"]["balance_formatted"] != matches["c2"]["balance_formatted"]
    assert matches["c1"]["bank"] == "NatWest"


def test_propose_card_apr_no_credit_cards_is_tool_error(monkeypatch):
    _patch_card_apr_accounts(monkeypatch, [_acc("a1", "Current Account")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 24.9, "_user_texts": ["24.9%"],
    }))
    assert "error" in result


def test_propose_card_apr_no_matching_card_is_tool_error(monkeypatch):
    _patch_card_apr_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "visa", "apr_pct": 24.9, "_user_texts": ["24.9%"],
    }))
    assert "error" in result


# ── Bounds ───────────────────────────────────────────────────────────────

def test_propose_card_apr_negative_rejected():
    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": -1, "_user_texts": ["-1%"],
    }))
    assert "error" in result


def test_propose_card_apr_over_100_rejected():
    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {
        "card_ref": "amex", "apr_pct": 101, "_user_texts": ["101%"],
    }))
    assert "error" in result


def test_propose_card_apr_missing_apr_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_card_apr", {"card_ref": "amex"}))
    assert "error" in result


def test_propose_set_card_apr_registered_in_propose_tool_names():
    assert "propose_set_card_apr" in penny_tools_module.PROPOSE_TOOL_NAMES


def test_no_guardrail_or_unrelated_tool_broken_by_card_apr_addition():
    # Standing guard (mirrors the recategorisation amendment's own one)
    # extended for this addition too: adding a card-terms write tool must
    # never accidentally reach into the miscategorised-guardrail queue.
    names = penny_tools_module.PROPOSE_TOOL_NAMES
    banned_substrings = ("transfer_pair", "miscategorised", "resolve_movement")
    for name in names:
        for bad in banned_substrings:
            assert bad not in name, f"guardrail-queue tool leaked into propose set: {name}"


# ── Execute: dispatches to the real card_terms.py path, preserves promos ──

def test_execute_set_card_apr_dispatches_and_preserves_existing_promos(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_card_apr", {"account_id": "c1", "apr_pct": 24.9})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.card_terms as card_terms_module

    fake_accounts_col = _FakeCol([
        {"_id": "c1", "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": "Green Amex"},
    ])
    monkeypatch.setattr(card_terms_module, "accounts_col", fake_accounts_col)

    until = (date.today() + timedelta(days=30)).isoformat()
    fake_terms_col = _FakeCol([{
        "_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 21.9,
        "promos": [{"kind": "purchases", "apr_pct": 0.0, "until": until}],
        "min_payment_note": "min payment 3%", "bt_offers": [], "status": "confirmed",
        "confirmed_at": datetime.now(), "product_key": "amex-green", "usage": "carry",
    }])
    monkeypatch.setattr(card_terms_module, "card_terms_col", fake_terms_col)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True

    saved = fake_terms_col.docs[0]
    assert saved["apr_pct"] == 24.9
    assert saved["promos"] == [{"kind": "purchases", "apr_pct": 0.0, "until": until}]
    assert saved["min_payment_note"] == "min payment 3%"
    assert saved["usage"] == "carry"
    assert saved["product_key"] == "amex-green"


def test_execute_set_card_apr_no_existing_terms_still_works(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_card_apr", {"account_id": "c1", "apr_pct": 19.9})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.card_terms as card_terms_module

    fake_accounts_col = _FakeCol([
        {"_id": "c1", "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": "Basic Card"},
    ])
    monkeypatch.setattr(card_terms_module, "accounts_col", fake_accounts_col)
    fake_terms_col = _FakeCol()
    monkeypatch.setattr(card_terms_module, "card_terms_col", fake_terms_col)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert fake_terms_col.docs[0]["apr_pct"] == 19.9
    assert fake_terms_col.docs[0]["promos"] == []


def test_set_card_apr_executor_registered():
    assert can_i_module._PROPOSAL_EXECUTORS["set_card_apr"] is can_i_module._execute_set_card_apr
