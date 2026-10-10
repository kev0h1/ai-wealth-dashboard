"""G251: typed table blocks. Offline: fake collections, no network, no model.

Fixture world: a synthetic user with four OpenRouter card payments in USD (two
carry a GBP figure, a rate and a fee), one GBP payment, and another user's row
that must never appear.
"""
import asyncio
import copy
import json
from datetime import date, datetime

import pytest

import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module
from app.services import penny_conversations, penny_table
from app.services.penny_table import TableInvalid, validate_table
from tests.test_penny_category_routing import _Col, _FakeTx
from tests.test_penny_golden_eval import _FinalResponse, _ToolCallResponse

UID = "g251-synthetic-user"
OTHER = "g251-someone-else"


def _good():
    return {
        "title": "Transactions",
        "columns": [
            {"key": "date", "label": "Date", "kind": "date"},
            {"key": "desc", "label": "Description", "kind": "text"},
            {"key": "amt", "label": "Amount", "kind": "money"},
            {"key": "rate", "label": "FX rate", "kind": "rate"},
            {"key": "n", "label": "Count", "kind": "number"},
        ],
        "rows": [
            {"date": "2026-10-01", "desc": "OpenRouter", "amt": {"amount": -20.0, "currency": "USD"}, "rate": 1.3412, "n": 2},
            {"date": "2026-10-02", "desc": "Tesco", "amt": None, "rate": None, "n": 0},
        ],
        "note": "Two rows.",
    }


# ── validation ────────────────────────────────────────────────────────────
def test_valid_table_is_normalised_and_defaults_alignment():
    out = validate_table(_good())
    assert [c["align"] for c in out["columns"]] == ["left", "left", "right", "right", "right"]
    assert out["rows"][1]["amt"] is None and out["note"] == "Two rows."


def test_validation_does_not_mutate_input():
    raw = _good()
    before = copy.deepcopy(raw)
    validate_table(raw)
    assert raw == before


def test_caps_on_columns_and_rows():
    raw = _good()
    raw["columns"] = [{"key": f"c{i}", "label": "x", "kind": "text"} for i in range(13)]
    raw["rows"] = []
    with pytest.raises(TableInvalid):
        validate_table(raw)
    raw["columns"] = raw["columns"][:12]
    validate_table(raw)
    raw = _good()
    raw["rows"] = [{"desc": "r"}] * 51
    with pytest.raises(TableInvalid):
        validate_table(raw)
    raw["rows"] = raw["rows"][:50]
    validate_table(raw)


@pytest.mark.parametrize("key,bad", [
    ("amt", 12.5), ("amt", {"amount": "12", "currency": "GBP"}), ("amt", {"amount": 1, "currency": "gbp"}),
    ("amt", {"amount": float("nan"), "currency": "GBP"}), ("amt", {"amount": 1, "currency": "GBP", "x": 1}),
    ("date", "01/10/2026"), ("date", "2026-13-40"), ("date", 20261001),
    ("rate", 0), ("rate", -1.2), ("rate", "1.3"), ("rate", True),
    ("n", "3"), ("n", float("inf")), ("n", True), ("desc", 5), ("desc", "x" * 201),
])
def test_cell_typing_is_enforced(key, bad):
    raw = _good()
    raw["rows"][0][key] = bad
    with pytest.raises(TableInvalid):
        validate_table(raw)


@pytest.mark.parametrize("evil", [
    "<script>alert(1)</script>", "a <b>bold</b> move", "<img src=x onerror=alert(1)>",
    "<!-- c -->", "< a href=x>", "x\x00y",
])
def test_html_and_control_characters_are_rejected_everywhere(evil):
    for place in ("cell", "label", "title", "note"):
        raw = _good()
        if place == "cell":
            raw["rows"][0]["desc"] = evil
        elif place == "label":
            raw["columns"][1]["label"] = evil
        else:
            raw[place] = evil
        with pytest.raises(TableInvalid):
            validate_table(raw)


def test_structure_is_enforced():
    for mutate in (
        lambda r: r["rows"][0].update({"ghost": "x"}),
        lambda r: r["columns"].append({"key": "date", "label": "Dup", "kind": "text"}),
        lambda r: r["columns"][0].update({"key": "Bad Key"}),
        lambda r: r["columns"][0].update({"kind": "html"}),
        lambda r: r["columns"][0].update({"align": "center"}),
        lambda r: r["columns"][0].update({"onclick": "x"}),
        lambda r: r.update({"extra": 1}),
        lambda r: r.update({"title": ""}),
        lambda r: r.update({"rows": "nope"}),
    ):
        raw = _good()
        mutate(raw)
        with pytest.raises(TableInvalid):
            validate_table(raw)
    for junk in (None, [], "table", 5):
        with pytest.raises(TableInvalid):
            validate_table(junk)


def test_clean_text_strips_markup_so_data_never_costs_the_table():
    assert penny_table.clean_text("<b>Pad</b>el\x00\n club") == "bPad/bel club"
    raw = _good()
    raw["rows"][0]["desc"] = penny_table.clean_text("<script>x</script>")
    validate_table(raw)


# ── search_transactions rows ──────────────────────────────────────────────
def _fx_rows():
    base = {"user_id": UID, "transaction_type": "debit", "category": "Software", "custom_category": ""}
    return [
        {**base, "id": "a", "amount": 20.0, "currency": "USD", "date": datetime(2026, 10, 4),
         "description": "OPENROUTER INC", "merchant_name": "OpenRouter",
         "amount_gbp": 15.1, "fx_rate": 1.3245, "fee": 0.45},
        {**base, "id": "b", "amount": 10.0, "currency": "USD", "date": datetime(2026, 9, 28),
         "description": "OPENROUTER INC", "merchant_name": "OpenRouter", "amount_gbp": 7.48, "fx_rate": 1.3369},
        {**base, "id": "c", "amount": 5.0, "currency": "GBP", "date": datetime(2026, 9, 20),
         "description": "OPENROUTER TOPUP", "merchant_name": "OpenRouter"},
        {**base, "id": "d", "user_id": OTHER, "amount": 999.0, "currency": "USD", "date": datetime(2026, 10, 1),
         "description": "OPENROUTER INC", "merchant_name": "OpenRouter"},
    ]


def _install(monkeypatch, rows):
    cols = (_Col(rows), _Col([]), _Col([]))
    monkeypatch.setattr(penny_tools_module, "_SEARCH_COLLECTIONS", cols)
    monkeypatch.setattr(penny_tools_module, "transactions_col", cols[0])
    monkeypatch.setattr(penny_tools_module, "yapily_transactions_col", cols[1])

    class Tx(_FakeTx):
        pass

    monkeypatch.setattr(penny_tools_module, "_doc_to_tx", Tx.from_doc)

    async def no_cats(uid, name):
        return None, []

    monkeypatch.setattr(penny_tools_module, "_resolve_user_category", no_cats)


def _search(args):
    return asyncio.run(penny_tools_module.execute_tool(UID, "search_transactions", args))


def test_search_builds_a_table_with_fx_columns_from_real_fields(monkeypatch):
    _install(monkeypatch, _fx_rows())
    res = _search({"q": "openrouter", "as_table": True, "_table_ok": True})
    table = validate_table(res["_table"])
    assert [c["key"] for c in table["columns"]] == ["date", "description", "category", "amount", "gbp", "rate", "fee"]
    assert len(table["rows"]) == 3  # the other user's row is never present
    first = table["rows"][0]
    assert first["date"] == "2026-10-04"
    assert first["amount"] == {"amount": -20.0, "currency": "USD"}
    assert first["gbp"] == {"amount": -15.1, "currency": "GBP"}
    assert first["rate"] == 1.3245
    assert first["fee"] == {"amount": -0.45, "currency": "USD"}
    assert table["rows"][1]["fee"] is None  # a missing value stays null, never text
    assert table["rows"][2]["gbp"] == {"amount": -5.0, "currency": "GBP"}
    assert "None" not in json.dumps(table)
    assert 999.0 not in [r["amount"]["amount"] for r in table["rows"] if r["amount"]]


def test_search_omits_columns_no_row_carries(monkeypatch):
    rows = [r for r in _fx_rows() if r["id"] == "c"]
    for r in rows:
        r["category"] = None
    _install(monkeypatch, rows)
    res = _search({"q": "openrouter", "as_table": True, "_table_ok": True})
    keys = [c["key"] for c in res["_table"]["columns"]]
    assert keys == ["date", "description", "category", "amount"]  # category falls back to Other
    assert "fee" not in keys and "rate" not in keys and "gbp" not in keys


def test_search_needs_both_the_arg_and_the_loop_flag(monkeypatch):
    _install(monkeypatch, _fx_rows())
    assert "_table" not in _search({"q": "openrouter", "as_table": True})
    assert "_table" not in _search({"q": "openrouter", "_table_ok": True})
    assert "_table" not in _search({"q": "openrouter"})


def test_search_table_caps_at_fifty_and_notes_the_rest(monkeypatch):
    base = _fx_rows()[2]
    rows = [{**base, "id": f"r{i}", "date": datetime(2026, 1, 1 + i % 28)} for i in range(70)]
    _install(monkeypatch, rows)
    res = _search({"q": "openrouter", "as_table": True, "_table_ok": True})
    assert len(res["_table"]["rows"]) == 50 and "of 70" in res["_table"]["note"]
    plain = _search({"q": "openrouter"})
    assert plain["count"] == 20


def test_search_scrubs_markup_from_merchant_names(monkeypatch):
    rows = [{**_fx_rows()[2], "merchant_name": "<img src=x onerror=1>Evil", "description": "x"}]
    _install(monkeypatch, rows)
    res = _search({"q": "x", "as_table": True, "_table_ok": True})
    assert "<" not in json.dumps(res["_table"])


# ── get_category_spend rows ───────────────────────────────────────────────
def test_category_spend_table_has_a_row_per_month_including_empty_ones(monkeypatch):
    import app.services.categories as categories_module
    rows = [
        {"user_id": UID, "transaction_type": "debit", "amount": 12.0, "currency": "GBP",
         "date": datetime(2026, 10, 2), "category": "Eating Out", "custom_category": "", "merchant_name": "Pret"},
        {"user_id": UID, "transaction_type": "debit", "amount": 30.0, "currency": "GBP",
         "date": datetime(2026, 8, 15), "category": "Eating Out", "custom_category": "", "merchant_name": "Nando's"},
    ]
    _install(monkeypatch, rows)
    monkeypatch.setattr(penny_tools_module, "transactions_col", _Col(rows))
    monkeypatch.setattr(penny_tools_module, "yapily_transactions_col", _Col([]))
    monkeypatch.setattr(penny_tools_module.timeutil, "user_today", lambda: date(2026, 10, 8))

    async def resolve(uid, name):
        return "Eating Out", ["Eating Out"]

    async def verdict(uid, offset=0):
        return {"period": {"start": "2026-09-18", "end": "2026-10-17"},
                "notables": [], "majority": [{"category": "Eating Out", "spent": 12.0, "payments_count": 1}]}

    monkeypatch.setattr(penny_tools_module, "_resolve_user_category", resolve)
    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", verdict)
    res = asyncio.run(penny_tools_module.execute_tool(
        UID, "get_category_spend", {"category": "eating out", "months": 3, "as_table": True, "_table_ok": True}))
    table = validate_table(res["_table"])
    by = {r["month"]: r for r in table["rows"]}
    assert by["Oct 2026"]["spent"]["amount"] == 12.0 and by["Oct 2026"]["payments"] == 1
    assert by["Sep 2026"]["spent"]["amount"] == 0.0
    assert by["Aug 2026"]["spent"]["amount"] == 30.0
    no_flag = asyncio.run(penny_tools_module.execute_tool(
        UID, "get_category_spend", {"category": "eating out", "months": 3, "as_table": True}))
    assert "_table" not in no_flag
    default_months = asyncio.run(penny_tools_module.execute_tool(
        UID, "get_category_spend", {"category": "eating out", "as_table": True, "_table_ok": True}))
    assert default_months["last_n_months"]["months"] == 6
    top = asyncio.run(penny_tools_module.execute_tool(
        UID, "get_category_spend", {"as_table": True, "_table_ok": True}))
    assert [c["key"] for c in top["_table"]["columns"]] == ["category", "spent", "payments"]


# ── the loop keeps rows out of the model ──────────────────────────────────
class _Client:
    def __init__(self, tool_args):
        self.calls, self._args = [], tool_args

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        if len(self.calls) == 1:
            return _ToolCallResponse("search_transactions", "c1", self._args)
        return _FinalResponse("HEADLINE: OpenRouter payments\nREPLY: Here are your 3 OpenRouter payments, £27.58 in total.")


def test_loop_attaches_the_table_and_gives_the_model_a_marker_not_rows(monkeypatch):
    client = _Client({"q": "openrouter", "as_table": True})
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    seen = {}

    async def fake_exec(uid, name, args):
        seen.update(args)
        return {"count": 3, "matched_count": 3, "transactions": [{"id": "x", "description": "ROW"}],
                "_table": _good()}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_exec)
    out = asyncio.run(penny_agent_module.run_penny_agent(UID, "tabulate my openrouter transactions", [], "spend", ""))
    assert seen["_table_ok"] is True
    assert out["table"]["title"] == "Transactions"
    tool_msg = next(m for m in client.calls[1]["messages"] if m["role"] == "tool")
    body = json.loads(tool_msg["content"])
    assert "_table" not in body and "transactions" not in body and body["table"]["shown"] is True
    assert "OpenRouter" not in tool_msg["content"] and "Tesco" not in tool_msg["content"]


def test_loop_drops_an_invalid_table_and_keeps_the_rows(monkeypatch):
    client = _Client({"q": "x", "as_table": True})
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_exec(uid, name, args):
        bad = _good()
        bad["rows"][0]["desc"] = "<script>"
        return {"count": 1, "transactions": [{"id": "x"}], "_table": bad}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_exec)
    out = asyncio.run(penny_agent_module.run_penny_agent(UID, "tabulate", [], "spend", ""))
    assert "table" not in out
    tool_msg = next(m for m in client.calls[1]["messages"] if m["role"] == "tool")
    assert "_table" not in tool_msg["content"]


def test_system_prompt_has_the_tabulate_rule():
    p = penny_agent_module._SYSTEM_PROMPT
    assert "as_table: true" in p and "Never type a markdown table" in p


def test_as_table_is_in_both_tool_schemas_and_mcp_strips_internal_keys():
    for name in ("search_transactions", "get_category_spend"):
        fn = next(t["function"] for t in penny_tools_module.TOOL_SCHEMAS if t["function"]["name"] == name)
        assert fn["parameters"]["properties"]["as_table"]["type"] == "boolean"
    import inspect
    from app.routers import mcp
    assert 'startswith("_")' in inspect.getsource(mcp)


# ── storage: text plus the same table, nothing else ───────────────────────
def test_clean_turn_stores_a_valid_table_on_assistant_turns_only():
    t = penny_conversations.clean_turn("assistant", "Here you go.", table=_good())
    assert t["table"] == validate_table(_good()) and set(t) == {"role", "text", "ts", "table"}
    assert "table" not in penny_conversations.clean_turn("user", "tabulate", table=_good())
    bad = _good()
    bad["rows"][0]["desc"] = "<b>"
    assert "table" not in penny_conversations.clean_turn("assistant", "Here you go.", table=bad)
    assert "table" not in penny_conversations.clean_turn("assistant", "Here you go.")
