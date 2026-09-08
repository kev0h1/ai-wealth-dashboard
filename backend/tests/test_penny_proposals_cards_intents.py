"""Tests for B17 (2026-09-08, B12 stages 4-5): Penny can propose full card
terms (status, promos, balance-transfer offers, minimum-payment note,
product key, usage — not just APR, see `test_penny_proposals.py`'s Section E
for the original `propose_set_card_apr`), record/preview/undo a trend
intent, and mark-opened/save-context/dismiss/pin an insight plus label/
unlabel a merchant. See docs/penny/action-inventory.md and PENNY_TOOLS.md's
"Write tools (propose-only)" table for the doctrine these extend.

Same fakes/conventions as tests/test_penny_proposals_accounts.py (no
mongomock in this environment — `_FakeCol` stands in for a Motor
collection), copied rather than imported so this file stays independently
runnable, extended with `$exists` support (`_resolve_insight_for_propose`
queries `retired_at: {"$exists": False}`, mirroring GET /savings-insights'
own query). CORE PRINCIPLE under test throughout: Penny PROPOSES, never
executes — every new `_exec_propose_*` executor here must return a stored
proposal dict (never mutate real data), and only
POST /penny/proposals/{id}/execute (replaying the SAME router function the
app's own confirm sheet/Spend page/InsightCard calls) ever turns one into a
real write.
"""
import asyncio
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_tools import execute_tool

UID = "kevin"


class _FakeCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    async def to_list(self, n=None):
        return list(self._docs)


class _FakeCol:
    """Twin of test_penny_proposals_accounts.py's own _FakeCol, extended
    with `$exists` support in `_match` — `_resolve_insight_for_propose`
    queries `{"retired_at": {"$exists": False}}`, the same filter GET
    /savings-insights itself uses, so the fake needs to understand it too."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict) and "$exists" in v:
                if (k in d) != v["$exists"]:
                    return False
                continue
            if d.get(k) != v:
                return False
        return True

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

    async def replace_one(self, filt, doc, upsert=False):
        for i, d in enumerate(self.docs):
            if self._match(d, filt):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))

    async def delete_one(self, filt):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not self._match(d, filt)]

        class _Result:
            deleted_count = before - len(self.docs)

        return _Result()


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


def _card_acc(id_, name, balance=-500.0, provider="NatWest"):
    return Account(id=id_, name=name, type="credit_card", subtype="CREDIT_CARD", balance=balance, provider=provider)


def _patch_card_accounts(monkeypatch, accounts):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return accounts

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)


def _insight(insight_id, title, category, **overrides):
    d = {"user_id": UID, "insight_id": insight_id, "title": title, "category": category, "pinned": False}
    d.update(overrides)
    return d


# ═════════════════════════════════════════════════════════════════════════
# Section A — propose_set_card_terms (B17 stage 4)
# ═════════════════════════════════════════════════════════════════════════

def test_propose_card_terms_apr_only_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "apr_pct": 24.9}))
    assert result["proposal"] is True
    assert result["kind"] == "set_card_terms"
    assert result["params"] == {"account_id": "c1", "apr_pct": 24.9}
    assert result["summary"] == "Set Green Amex (American Express) to standard APR to 24.9%."
    assert len(fake_proposals.docs) == 1


def test_propose_card_terms_promo_and_apr_combo_summary(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Amex Gold", provider="American Express")])

    until = "2027-03-14"
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "apr_pct": 24.9,
        "promos": [{"kind": "purchases", "apr_pct": 0, "until": until}],
    }))
    assert result["proposal"] is True
    assert result["summary"] == "Set Amex Gold (American Express) to 0% until 14 Mar 2027, then 24.9%."
    assert result["consequence"] == "Feeds this card's repayment projection and what Cards shows for it."


def test_propose_card_terms_bt_offers_and_min_payment_note(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex",
        "bt_offers": [{"ends": "2027-01-01", "fee_pct": 3.0, "note": "intro offer"}],
        "min_payment_note": "3% of balance or £25, whichever is greater",
    }))
    assert result["proposal"] is True
    assert result["params"]["bt_offers"] == [{"ends": "2027-01-01", "fee_pct": 3.0, "note": "intro offer"}]
    assert result["params"]["min_payment_note"] == "3% of balance or £25, whichever is greater"
    assert "1 balance-transfer offer" in result["summary"]


def test_propose_card_terms_usage_and_product_key(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "usage": "carry", "product_key": "amex-green",
    }))
    assert result["params"] == {"account_id": "c1", "usage": "carry", "product_key": "amex-green"}


def test_propose_card_terms_clearing_promos_with_empty_list(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "promos": []}))
    assert result["params"]["promos"] == []
    assert "no active promo" in result["summary"]


def test_propose_card_terms_skipped_status_only(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol())
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "status": "skipped"}))
    assert result["proposal"] is True
    assert result["params"] == {"account_id": "c1", "status": "skipped"}
    assert "skipped" in result["summary"]


def test_propose_card_terms_skipped_with_other_fields_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "status": "skipped", "apr_pct": 24.9,
    }))
    assert "error" in result


def test_propose_card_terms_states_current_apr_when_changed(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", _FakeCol([
        {"_id": f"{UID}:c1", "apr_pct": 21.9},
    ]))
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])

    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "apr_pct": 24.9}))
    assert "Currently recorded APR: 21.9%." in result["consequence"]


# ── Validation mirrors save_card_terms exactly ──────────────────────────

def test_propose_card_terms_no_fields_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex"}))
    assert "error" in result


def test_propose_card_terms_bad_status_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "status": "pending"}))
    assert "error" in result


def test_propose_card_terms_bad_usage_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "usage": "monthly"}))
    assert "error" in result


def test_propose_card_terms_promo_without_date_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "promos": [{"kind": "purchases", "apr_pct": 0}],
    }))
    assert "error" in result
    assert "until" in result["error"]


def test_propose_card_terms_apr_out_of_range_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "apr_pct": 150}))
    assert "error" in result


def test_propose_card_terms_promo_apr_out_of_range_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "promos": [{"kind": "purchases", "apr_pct": 99, "until": "2027-03-14"}],
    }))
    assert "error" in result


def test_propose_card_terms_too_many_promos_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    promos = [{"kind": "purchases", "apr_pct": 0, "until": "2027-03-14"} for _ in range(5)]
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "amex", "promos": promos}))
    assert "error" in result


def test_propose_card_terms_bt_offer_fee_out_of_range_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "bt_offers": [{"fee_pct": 50}],
    }))
    assert "error" in result


def test_propose_card_terms_malformed_promo_shape_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {
        "card_ref": "amex", "promos": [{"kind": "not-a-kind", "apr_pct": 0, "until": "2027-03-14"}],
    }))
    assert "error" in result


# ── Resolution ───────────────────────────────────────────────────────────

def test_propose_card_terms_ambiguous_card(monkeypatch):
    _patch_card_accounts(monkeypatch, [
        _card_acc("c1", "Mastercard", provider="NatWest"),
        _card_acc("c2", "Mastercard", provider="NatWest"),
    ])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "mastercard", "apr_pct": 19.9}))
    assert result.get("ambiguous") is True


def test_propose_card_terms_unknown_card_is_tool_error(monkeypatch):
    _patch_card_accounts(monkeypatch, [_card_acc("c1", "Green Amex", provider="American Express")])
    result = asyncio.run(execute_tool(UID, "propose_set_card_terms", {"card_ref": "visa", "apr_pct": 19.9}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section B — propose_record_trend_intent / propose_undo_trend_intent
# (B17 stage 5)
# ═════════════════════════════════════════════════════════════════════════

def test_propose_record_trend_intent_new_normal(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_record_trend_intent", {
        "category": "Groceries", "answer": "new_normal",
    }))
    assert result["proposal"] is True
    assert result["kind"] == "record_trend_intent"
    assert result["params"] == {"category": "Groceries", "answer": "new_normal"}
    assert result["summary"] == "File Groceries as your new normal from now on"
    assert "usual figure for Groceries adjusts" in result["consequence"]
    assert len(fake_proposals.docs) == 1


def test_propose_record_trend_intent_one_off(monkeypatch):
    _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_record_trend_intent", {
        "category": "Eating Out", "answer": "one_off",
    }))
    assert result["proposal"] is True
    assert "one-off overspend" in result["summary"]
    assert "Doesn't change your usual figures" in result["consequence"]


def test_propose_record_trend_intent_bad_answer_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_record_trend_intent", {
        "category": "Groceries", "answer": "sometimes",
    }))
    assert "error" in result


def test_propose_record_trend_intent_blank_category_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_record_trend_intent", {
        "category": "   ", "answer": "one_off",
    }))
    assert "error" in result


def test_propose_undo_trend_intent_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_undo_trend_intent", {"category": "Groceries"}))
    assert result["proposal"] is True
    assert result["kind"] == "undo_trend_intent"
    assert result["params"] == {"category": "Groceries"}
    assert len(fake_proposals.docs) == 1


def test_propose_undo_trend_intent_blank_category_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_undo_trend_intent", {"category": ""}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section C — preview_trend_intent (read tool, never a proposal)
# ═════════════════════════════════════════════════════════════════════════

def test_preview_trend_intent_one_off_short_circuits_no_engine_call(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)

    async def fail_preview(uid, category):
        raise AssertionError("must never call the engine for answer='one_off'")

    import app.services.spend_impact as spend_impact_module
    monkeypatch.setattr(spend_impact_module, "compute_intent_preview", fail_preview)

    result = asyncio.run(execute_tool(UID, "preview_trend_intent", {"category": "Groceries", "answer": "one_off"}))
    assert result["title"] == "Keep Groceries as a one-off?"
    assert "doesn't change your usual figures" in result["lines"][0]
    assert fake_proposals.docs == []


def test_preview_trend_intent_new_normal_delegates_to_engine(monkeypatch):
    _patch_proposals_col(monkeypatch)

    async def fake_preview(uid, category):
        assert uid == UID and category == "Groceries"
        return {"title": "File Groceries as your new normal?", "lines": ["This raises your usual Groceries by about £40 a period."]}

    import app.services.spend_impact as spend_impact_module
    monkeypatch.setattr(spend_impact_module, "compute_intent_preview", fake_preview)

    result = asyncio.run(execute_tool(UID, "preview_trend_intent", {"category": "Groceries", "answer": "new_normal"}))
    assert result["title"] == "File Groceries as your new normal?"
    assert "£40" in result["lines"][0]


def test_preview_trend_intent_not_notable_is_tool_error(monkeypatch):
    async def fake_preview(uid, category):
        raise ValueError(f"'{category}' is not currently over usual, nothing to preview")

    import app.services.spend_impact as spend_impact_module
    monkeypatch.setattr(spend_impact_module, "compute_intent_preview", fake_preview)

    result = asyncio.run(execute_tool(UID, "preview_trend_intent", {"category": "Rent", "answer": "new_normal"}))
    assert "error" in result


def test_preview_trend_intent_bad_answer_is_tool_error():
    result = asyncio.run(execute_tool(UID, "preview_trend_intent", {"category": "Groceries", "answer": "maybe"}))
    assert "error" in result


def test_preview_trend_intent_registered_as_read_tool():
    names = [s["function"]["name"] for s in penny_tools_module.TOOL_SCHEMAS]
    assert "preview_trend_intent" in names
    assert "preview_trend_intent" not in penny_tools_module.PROPOSE_TOOL_NAMES


# ═════════════════════════════════════════════════════════════════════════
# Section D — insight propose tools (resolution shared across all four)
# ═════════════════════════════════════════════════════════════════════════

def test_propose_mark_insight_opened_resolves_by_title(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_mark_insight_opened", {"insight_ref": "mortgage"}))
    assert result["proposal"] is True
    assert result["kind"] == "mark_insight_opened"
    assert result["params"] == {"insight_id": "i1"}
    assert "Low-stakes" in result["consequence"]
    assert len(fake_proposals.docs) == 1


def test_propose_mark_insight_opened_resolves_by_id_directly(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
        _insight("i2", "Your mortgage might be overpriced (refreshed)", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_mark_insight_opened", {"insight_ref": "i2"}))
    assert result["params"] == {"insight_id": "i2"}


def test_propose_dismiss_insight_ambiguous_title(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym"),
        _insight("i2", "Gym membership savings", "gym"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_dismiss_insight", {"insight_ref": "gym"}))
    assert result.get("ambiguous") is True
    assert {m["insight_id"] for m in result["matches"]} == {"i1", "i2"}


def test_propose_dismiss_insight_unknown_ref_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_dismiss_insight", {"insight_ref": "broadband"}))
    assert "error" in result


def test_propose_dismiss_insight_ignores_retired(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym", retired_at=datetime.now()),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_dismiss_insight", {"insight_ref": "gym"}))
    assert "error" in result


def test_propose_dismiss_insight_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_dismiss_insight", {"insight_ref": "gym"}))
    assert result["proposal"] is True
    assert result["kind"] == "dismiss_insight"
    assert result["params"] == {"insight_id": "i1"}
    assert len(fake_proposals.docs) == 1


def test_propose_pin_insight_missing_pinned_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_pin_insight", {"insight_ref": "gym"}))
    assert "error" in result


def test_propose_pin_insight_states_already_set(monkeypatch):
    _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym", pinned=True),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_pin_insight", {"insight_ref": "gym", "pinned": True}))
    assert "already set this way" in result["summary"]


def test_propose_pin_insight_unpin_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Gym membership check", "gym", pinned=True),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_pin_insight", {"insight_ref": "gym", "pinned": False}))
    assert result["proposal"] is True
    assert result["params"] == {"insight_id": "i1", "pinned": False}
    assert len(fake_proposals.docs) == 1


def test_propose_save_insight_context_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_save_insight_context", {
        "insight_ref": "mortgage", "answers": {"rate": "4.5", "outstanding": "250000"},
    }))
    assert result["proposal"] is True
    assert result["kind"] == "save_insight_context"
    assert result["params"] == {"insight_id": "i1", "context": {"rate": "4.5", "outstanding": "250000"}}
    assert len(fake_proposals.docs) == 1


def test_propose_save_insight_context_unknown_field_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_save_insight_context", {
        "insight_ref": "mortgage", "answers": {"favourite_colour": "blue"},
    }))
    assert "error" in result


def test_propose_save_insight_context_blank_answers_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_save_insight_context", {
        "insight_ref": "mortgage", "answers": {"rate": "   "},
    }))
    assert "error" in result


def test_propose_save_insight_context_not_a_dict_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Your mortgage might be overpriced", "mortgage"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_save_insight_context", {
        "insight_ref": "mortgage", "answers": "4.5%",
    }))
    assert "error" in result


def test_propose_save_insight_context_no_workflow_for_category_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_insights_col", _FakeCol([
        _insight("i1", "Odd category insight", "not_a_real_category"),
    ]))
    result = asyncio.run(execute_tool(UID, "propose_save_insight_context", {
        "insight_ref": "Odd category insight", "answers": {"x": "y"},
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section E — propose_label_merchant / propose_remove_merchant_label
# ═════════════════════════════════════════════════════════════════════════

def _patch_unknown_bills(monkeypatch, bills):
    import app.routers.savings_insights as si_module

    async def fake_get_unknown_bills(user):
        return {"unknown_bills": bills, "label_options": si_module.LABEL_OPTIONS}

    monkeypatch.setattr(si_module, "get_unknown_bills", fake_get_unknown_bills)


def test_propose_label_merchant_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    _patch_unknown_bills(monkeypatch, [
        {"merchant_key": "VIRGIN MEDIA", "display_name": "Virgin Media", "monthly_amount": 40.0, "occurrences": 3},
    ])
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol())

    result = asyncio.run(execute_tool(UID, "propose_label_merchant", {"merchant": "virgin media", "label": "broadband"}))
    assert result["proposal"] is True
    assert result["kind"] == "label_merchant"
    assert result["params"] == {"merchant_key": "VIRGIN MEDIA", "category": "broadband"}
    assert len(fake_proposals.docs) == 1


def test_propose_label_merchant_skip(monkeypatch):
    _patch_proposals_col(monkeypatch)
    _patch_unknown_bills(monkeypatch, [
        {"merchant_key": "RANDOM CO", "display_name": "Random Co", "monthly_amount": 10.0, "occurrences": 2},
    ])
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol())

    result = asyncio.run(execute_tool(UID, "propose_label_merchant", {"merchant": "Random Co", "label": "skip"}))
    assert result["params"]["category"] == "skip"
    assert "not a bill" in result["summary"]


def test_propose_label_merchant_bad_label_is_tool_error(monkeypatch):
    _patch_unknown_bills(monkeypatch, [
        {"merchant_key": "VIRGIN MEDIA", "display_name": "Virgin Media", "monthly_amount": 40.0, "occurrences": 3},
    ])
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol())

    result = asyncio.run(execute_tool(UID, "propose_label_merchant", {"merchant": "virgin media", "label": "not_a_real_label"}))
    assert "error" in result


def test_propose_label_merchant_unknown_merchant_is_tool_error(monkeypatch):
    _patch_unknown_bills(monkeypatch, [
        {"merchant_key": "VIRGIN MEDIA", "display_name": "Virgin Media", "monthly_amount": 40.0, "occurrences": 3},
    ])
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol())

    result = asyncio.run(execute_tool(UID, "propose_label_merchant", {"merchant": "totally unknown merchant", "label": "broadband"}))
    assert "error" in result


def test_propose_label_merchant_resolves_existing_label_for_relabel(monkeypatch):
    _patch_proposals_col(monkeypatch)
    _patch_unknown_bills(monkeypatch, [])
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol([
        {"user_id": UID, "merchant_key": "VIRGIN MEDIA", "category": "broadband"},
    ]))

    result = asyncio.run(execute_tool(UID, "propose_label_merchant", {"merchant": "virgin media", "label": "mobile"}))
    assert result["proposal"] is True
    assert result["params"]["merchant_key"] == "VIRGIN MEDIA"


def test_propose_remove_merchant_label_happy_path(monkeypatch):
    fake_proposals = _patch_proposals_col(monkeypatch)
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol([
        {"user_id": UID, "merchant_key": "VIRGIN MEDIA", "category": "broadband"},
    ]))
    result = asyncio.run(execute_tool(UID, "propose_remove_merchant_label", {"merchant_key": "virgin"}))
    assert result["proposal"] is True
    assert result["kind"] == "remove_merchant_label"
    assert result["params"] == {"merchant_key": "VIRGIN MEDIA"}
    assert len(fake_proposals.docs) == 1


def test_propose_remove_merchant_label_not_found_is_tool_error(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol())
    result = asyncio.run(execute_tool(UID, "propose_remove_merchant_label", {"merchant_key": "nope"}))
    assert "error" in result


def test_propose_remove_merchant_label_ambiguous(monkeypatch):
    monkeypatch.setattr(penny_tools_module, "savings_labels_col", _FakeCol([
        {"user_id": UID, "merchant_key": "TESCO EXPRESS", "category": "groceries"},
        {"user_id": UID, "merchant_key": "TESCO METRO", "category": "groceries"},
    ]))
    result = asyncio.run(execute_tool(UID, "propose_remove_merchant_label", {"merchant_key": "tesco"}))
    assert result.get("ambiguous") is True


# ═════════════════════════════════════════════════════════════════════════
# Section F — registration
# ═════════════════════════════════════════════════════════════════════════

_NEW_TOOL_NAMES = {
    "propose_set_card_terms", "propose_record_trend_intent", "propose_undo_trend_intent",
    "propose_mark_insight_opened", "propose_save_insight_context", "propose_dismiss_insight",
    "propose_pin_insight", "propose_label_merchant", "propose_remove_merchant_label",
}

_NEW_KIND_NAMES = {
    "set_card_terms", "record_trend_intent", "undo_trend_intent",
    "mark_insight_opened", "save_insight_context", "dismiss_insight",
    "pin_insight", "label_merchant", "remove_merchant_label",
}


def test_all_new_tools_registered_in_propose_tool_names():
    assert _NEW_TOOL_NAMES <= penny_tools_module.PROPOSE_TOOL_NAMES
    assert len(_NEW_TOOL_NAMES) == 9


def test_all_new_kinds_registered_in_proposal_executors():
    assert _NEW_KIND_NAMES <= set(can_i_module._PROPOSAL_EXECUTORS.keys())


def test_no_guardrail_or_unrelated_tool_leaked_by_b17():
    names = penny_tools_module.PROPOSE_TOOL_NAMES
    banned_substrings = ("transfer_pair", "miscategorised", "resolve_movement")
    for name in names:
        for bad in banned_substrings:
            assert bad not in name, f"guardrail-queue tool leaked into propose set: {name}"


# ═════════════════════════════════════════════════════════════════════════
# Section G — executors (can_i.py replays the real router functions)
# ═════════════════════════════════════════════════════════════════════════

def test_execute_set_card_terms_merges_apr_and_promo_preserving_other_fields(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_card_terms", {
        "account_id": "c1", "apr_pct": 24.9,
        "promos": [{"kind": "purchases", "apr_pct": 0.0, "until": "2027-03-14"}],
    })])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.card_terms as card_terms_module

    monkeypatch.setattr(card_terms_module, "accounts_col", _FakeCol([
        {"_id": "c1", "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": "Green Amex"},
    ]))
    fake_terms_col = _FakeCol([{
        "_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 21.9, "promos": [],
        "min_payment_note": "min payment 3%", "bt_offers": [], "status": "confirmed",
        "confirmed_at": datetime.now(), "product_key": "amex-green", "usage": "carry",
    }])
    monkeypatch.setattr(card_terms_module, "card_terms_col", fake_terms_col)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True

    saved = fake_terms_col.docs[0]
    assert saved["apr_pct"] == 24.9
    assert saved["promos"] == [{"kind": "purchases", "apr_pct": 0.0, "until": "2027-03-14"}]
    # Untouched fields carried forward from the existing doc.
    assert saved["min_payment_note"] == "min payment 3%"
    assert saved["usage"] == "carry"
    assert saved["product_key"] == "amex-green"


def test_execute_set_card_terms_skipped_replays_route_directly(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_card_terms", {"account_id": "c1", "status": "skipped"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.card_terms as card_terms_module

    monkeypatch.setattr(card_terms_module, "accounts_col", _FakeCol([
        {"_id": "c1", "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": "Basic Card"},
    ]))
    fake_terms_col = _FakeCol([{
        "_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 21.9, "promos": [],
        "min_payment_note": "note", "bt_offers": [], "status": "confirmed",
        "confirmed_at": datetime.now(), "product_key": None, "usage": "clear_monthly",
    }])
    monkeypatch.setattr(card_terms_module, "card_terms_col", fake_terms_col)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    saved = fake_terms_col.docs[0]
    assert saved["status"] == "skipped"
    assert saved["apr_pct"] is None
    assert saved["promos"] == []
    # save_card_terms's own skipped branch preserves usage from the existing doc.
    assert saved["usage"] == "clear_monthly"


def test_execute_record_trend_intent_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("record_trend_intent", {"category": "Groceries", "answer": "new_normal"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.checkpoints as checkpoints_module

    captured = {}

    async def fake_record_intent(uid, category, answer):
        captured["args"] = (uid, category, answer)
        return {"category": category, "answer": answer}

    monkeypatch.setattr(checkpoints_module, "record_intent", fake_record_intent)
    monkeypatch.setattr(checkpoints_module.response_cache, "invalidate", lambda uid: None)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["args"] == (UID, "Groceries", "new_normal")
    assert result["result"]["ok"] is True


def test_execute_undo_trend_intent_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("undo_trend_intent", {"category": "Groceries"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.spend_verdict as spend_verdict_module

    captured = {}

    async def fake_delete_intent(uid, category):
        captured["args"] = (uid, category)
        return True

    monkeypatch.setattr(spend_verdict_module, "delete_intent", fake_delete_intent)
    monkeypatch.setattr(spend_verdict_module.response_cache, "invalidate", lambda uid: None)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["args"] == (UID, "Groceries")
    assert result["result"] == {"ok": True, "category": "Groceries"}


def test_execute_mark_insight_opened_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("mark_insight_opened", {"insight_id": "i1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.savings_insights as si_module

    fake_insights = _FakeCol([{"_id": "x1", "user_id": UID, "insight_id": "i1"}])
    monkeypatch.setattr(si_module, "savings_insights_col", fake_insights)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert fake_insights.docs[0]["card_opened_at"] is not None


def test_execute_dismiss_insight_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("dismiss_insight", {"insight_id": "i1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.savings_insights as si_module

    fake_insights = _FakeCol([{"_id": "x1", "user_id": UID, "insight_id": "i1", "savings_estimate": None}])
    monkeypatch.setattr(si_module, "savings_insights_col", fake_insights)
    monkeypatch.setattr(si_module, "preferences_col", _FakeCol())

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"] == {"status": "retired"}
    assert fake_insights.docs[0]["spotlight_retired"] is True


def test_execute_pin_insight_toggles_only_when_state_differs(monkeypatch):
    _patch_consented_prefs(monkeypatch)
    import app.routers.savings_insights as si_module

    # Already pinned + pinned=True requested -> no-op, toggle never called.
    fake_proposals_noop = _FakeCol([_live_doc("pin_insight", {"insight_id": "i1", "pinned": True})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals_noop)
    fake_insights_noop = _FakeCol([{"_id": "x1", "user_id": UID, "insight_id": "i1", "pinned": True}])
    monkeypatch.setattr(si_module, "savings_insights_col", fake_insights_noop)

    async def fail_toggle(insight_id, user):
        raise AssertionError("must not toggle when already in the desired state")

    monkeypatch.setattr(si_module, "toggle_pin_insight", fail_toggle)
    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["result"] == {"pinned": True}

    # Not pinned + pinned=True requested -> real toggle called.
    fake_proposals_flip = _FakeCol([_live_doc("pin_insight", {"insight_id": "i2", "pinned": True}, _id="p-test2")])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals_flip)
    fake_insights_flip = _FakeCol([{"_id": "x2", "user_id": UID, "insight_id": "i2", "pinned": False}])
    monkeypatch.setattr(si_module, "savings_insights_col", fake_insights_flip)

    called = {}

    async def real_toggle(insight_id, user):
        called["insight_id"] = insight_id
        return {"pinned": True}

    monkeypatch.setattr(si_module, "toggle_pin_insight", real_toggle)
    result2 = asyncio.run(can_i_module.execute_proposal("p-test2", user={"email": UID}))
    assert called["insight_id"] == "i2"
    assert result2["result"] == {"pinned": True}


def test_execute_save_insight_context_runs_background_regen(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("save_insight_context", {"insight_id": "i1", "context": {"rate": "4.5"}})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.savings_insights as si_module

    fake_insights = _FakeCol([{"_id": "x1", "user_id": UID, "insight_id": "i1", "category": "mortgage"}])
    monkeypatch.setattr(si_module, "savings_insights_col", fake_insights)

    called = {}

    async def fake_refresh(uid, category, context=None):
        called["args"] = (uid, category, context)

    monkeypatch.setattr(si_module, "_refresh_single_insight", fake_refresh)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert fake_insights.docs[0]["user_context"] == {"rate": "4.5"}
    assert called["args"] == (UID, "mortgage", {"rate": "4.5"})


def test_execute_label_merchant_runs_background_regen(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("label_merchant", {"merchant_key": "VIRGIN MEDIA", "category": "broadband"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.savings_insights as si_module

    fake_labels = _FakeCol()
    monkeypatch.setattr(si_module, "savings_labels_col", fake_labels)

    called = {}

    async def fake_refresh(uid, category):
        called["args"] = (uid, category)

    monkeypatch.setattr(si_module, "_refresh_single_insight", fake_refresh)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert fake_labels.docs[0]["merchant_key"] == "VIRGIN MEDIA"
    assert fake_labels.docs[0]["category"] == "broadband"
    assert called["args"] == (UID, "broadband")


def test_execute_remove_merchant_label_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("remove_merchant_label", {"merchant_key": "VIRGIN MEDIA"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.savings_insights as si_module

    fake_labels = _FakeCol([{"user_id": UID, "merchant_key": "VIRGIN MEDIA", "category": "broadband"}])
    monkeypatch.setattr(si_module, "savings_labels_col", fake_labels)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert fake_labels.docs == []


# ═════════════════════════════════════════════════════════════════════════
# Section H — consent-required path unchanged for the new kinds
# ═════════════════════════════════════════════════════════════════════════

def test_execute_set_card_terms_rejects_after_consent_revoked(monkeypatch):
    fake_col = _FakeCol([_live_doc("set_card_terms", {"account_id": "c1", "apr_pct": 24.9})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    fake_prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": None}])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    async def fail_executor(uid, params):
        raise AssertionError("must never dispatch a proposal after consent was revoked")

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"set_card_terms": fail_executor})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 403


def test_execute_dismiss_insight_rejects_without_consent(monkeypatch):
    fake_col = _FakeCol([_live_doc("dismiss_insight", {"insight_id": "i1"})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_col)
    fake_prefs = _FakeCol([{"user_id": UID}])  # never consented
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)

    async def fail_executor(uid, params):
        raise AssertionError("must never dispatch without consent")

    monkeypatch.setattr(can_i_module, "_PROPOSAL_EXECUTORS", {"dismiss_insight": fail_executor})

    with pytest.raises(HTTPException) as exc:
        asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert exc.value.status_code == 403
