"""F3: `/mcp` Streamable HTTP connector.

Follows the same conventions as tests/test_penny_tools.py: plain
`asyncio.run`, no TestClient/real Mongo, module-level names monkeypatched
directly on `app.routers.mcp`/`app.services.mcp_mask`'s own namespace.
`execute_tool` is monkeypatched throughout (per the F3 brief: "tools/call
runs execute_tool (monkeypatched)"), so these tests exercise the connector's
own transport, scope, allowance and masking logic, not the tool executors
themselves (already covered by tests/test_penny_tools.py).
"""
import asyncio

import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.mcp as mcp
import app.services.mcp_mask as mcp_mask


# ── shared fakes ─────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *a, **k):
        return self

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for r in self._rows:
            yield r


class _FakeAuditCol:
    """Stands in for `mcp_calls_col`: enough of the Motor collection surface
    for check_mcp_allowance's count_documents, _write_audit's insert_one,
    and GET /mcp/audit's find(...).sort(...)."""

    def __init__(self, seed: list[dict] | None = None):
        self.docs: list[dict] = list(seed or [])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def count_documents(self, query):
        uid = query.get("user_id")
        ym = query.get("year_month")
        return sum(1 for d in self.docs if d.get("user_id") == uid and d.get("year_month") == ym)

    def find(self, query, proj=None):
        uid = query.get("user_id")
        ym = query.get("year_month")
        rows = [d for d in self.docs if d.get("user_id") == uid and d.get("year_month") == ym]
        return _FakeCursor(rows)


class _FakeSubscription:
    def __init__(self, tier_name: str, mcp_limit):
        self.tier_name = tier_name
        self._mcp_limit = mcp_limit

    def limit(self, key: str):
        assert key == "mcp_tool_calls_per_month"
        return self._mcp_limit


def _principal(scopes=None):
    return {
        "uid": "user@example.com",
        "client": "session",
        "scopes": set(scopes if scopes is not None else mcp.V1_SCOPES),
    }


def _patch_subscription(monkeypatch, tier_name="connect", mcp_limit=2000):
    async def fake_get_subscription(uid):
        return _FakeSubscription(tier_name, mcp_limit)
    # F9: check_mcp_allowance now delegates to app.core.subscription.mcp_allowance,
    # which resolves the tier through that module's OWN get_subscription
    # reference (not app.routers.mcp's, which no longer imports it at all),
    # so the fake has to be installed there.
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)


def _patch_audit(monkeypatch, seed=None):
    fake_col = _FakeAuditCol(seed)
    # `mcp.mcp_calls_col` backs _write_audit's insert_one and GET /mcp/audit's
    # own find(...); `mcp_allowance`'s count_documents (F9) lazily re-imports
    # mcp_calls_col from app.db.collections, so both names need to point at
    # the SAME fake for a write in one to be visible to a count in the other.
    monkeypatch.setattr(mcp, "mcp_calls_col", fake_col)
    monkeypatch.setattr(db_collections_module, "mcp_calls_col", fake_col)
    # No MCP call packs (F9) in play for these tests — an empty collection
    # keeps settle_mcp_packs/mcp_allowance's pack lookup a no-op.
    monkeypatch.setattr(db_collections_module, "mcp_call_packs_col", _FakeAuditCol())
    return fake_col


def _run(coro):
    return asyncio.run(coro)


# ── JSON-RPC method handling ────────────────────────────────────────────

def test_initialize_handshake_shape():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {},
    }))
    assert resp["id"] == 1
    result = resp["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert result["capabilities"] == {"tools": {}}
    assert result["serverInfo"]["name"] == "sorted"
    assert "version" in result["serverInfo"]


def test_notifications_initialized_is_a_notification_with_no_response():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "method": "notifications/initialized", "params": {},
    }))
    assert resp is None


def test_ping_returns_empty_result():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": "abc", "method": "ping",
    }))
    assert resp == {"jsonrpc": "2.0", "id": "abc", "result": {}}


def test_unknown_method_returns_method_not_found():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 2, "method": "resources/list",
    }))
    assert resp["error"]["code"] == -32601


def test_unknown_method_as_notification_yields_no_response():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "method": "resources/list",
    }))
    assert resp is None


# ── tools/list ───────────────────────────────────────────────────────────

def test_tools_list_excludes_search_transactions_and_every_propose_tool():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 3, "method": "tools/list",
    }))
    names = {t["name"] for t in resp["result"]["tools"]}
    assert "search_transactions" not in names
    assert not any(n.startswith("propose_") for n in names)
    assert "get_accounts" in names
    assert "get_spend_verdict" in names
    # B17 (2026-09-08, B12 stage 5) added `preview_trend_intent` to
    # TOOL_SCHEMAS as a read tool, scoped "insights:read" in mcp.py's own
    # TOOL_SCOPES — 18 + 1 = 19.
    assert "preview_trend_intent" in names
    assert len(names) == 19


def test_tools_list_entries_carry_scope_text_and_input_schema():
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 4, "method": "tools/list",
    }))
    by_name = {t["name"]: t for t in resp["result"]["tools"]}
    accounts_tool = by_name["get_accounts"]
    assert "Scope: accounts:read." in accounts_tool["description"]
    assert accounts_tool["inputSchema"]["type"] == "object"
    plans_tool = by_name["get_goals"]
    assert "Scope: plans:read." in plans_tool["description"]
    insights_tool = by_name["get_insights"]
    assert "Scope: insights:read." in insights_tool["description"]


# ── tools/call: happy path, masking, audit ──────────────────────────────

def test_tools_call_runs_execute_tool_and_returns_masked_json_text(monkeypatch):
    _patch_subscription(monkeypatch)
    audit = _patch_audit(monkeypatch)

    async def fake_execute_tool(uid, name, args):
        assert uid == "user@example.com"
        assert name == "get_accounts"
        return {
            "accounts": [
                {"id": "a1", "name": "Halifax", "account_number": "12345678", "sort_code": "12-34-56"},
            ],
        }
    monkeypatch.setattr(mcp, "execute_tool", fake_execute_tool)

    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 5, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    result = resp["result"]
    assert result["isError"] is False
    text = result["content"][0]["text"]
    assert result["content"][0]["type"] == "text"
    assert "account_number" not in text
    assert "sort_code" not in text
    assert "Halifax" in text

    assert len(audit.docs) == 1
    doc = audit.docs[0]
    assert doc["tool"] == "get_accounts"
    assert doc["ok"] is True
    assert doc["client"] == "session"
    assert doc["dropped_keys"] == 2


def test_tools_call_writes_audit_doc_ok_false_when_tool_returns_an_error(monkeypatch):
    _patch_subscription(monkeypatch)
    audit = _patch_audit(monkeypatch)

    async def fake_execute_tool(uid, name, args):
        return {"error": "accounts lookup failed: boom"}
    monkeypatch.setattr(mcp, "execute_tool", fake_execute_tool)

    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 6, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    assert resp["result"]["isError"] is True
    assert audit.docs[0]["ok"] is False


# ── scope enforcement ────────────────────────────────────────────────────

def test_tools_call_denied_when_scope_not_granted(monkeypatch):
    _patch_subscription(monkeypatch)
    _patch_audit(monkeypatch)

    async def forbidden(uid, name, args):
        raise AssertionError("execute_tool must not run when scope is denied")
    monkeypatch.setattr(mcp, "execute_tool", forbidden)

    principal = _principal(scopes={"plans:read", "insights:read"})  # no accounts:read
    resp = _run(mcp.handle_jsonrpc_request(principal, {
        "jsonrpc": "2.0", "id": 7, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    assert resp["error"]["code"] == -32001
    assert resp["error"]["data"]["required_scope"] == "accounts:read"


def test_tools_call_unknown_tool_is_invalid_params(monkeypatch):
    _patch_subscription(monkeypatch)
    _patch_audit(monkeypatch)
    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 8, "method": "tools/call",
        "params": {"name": "search_transactions", "arguments": {}},
    }))
    assert resp["error"]["code"] == -32602


# ── monthly allowance ────────────────────────────────────────────────────

def test_tools_call_allowance_reached(monkeypatch):
    _patch_subscription(monkeypatch, tier_name="connect", mcp_limit=2)
    audit = _patch_audit(monkeypatch, seed=[
        {"user_id": "user@example.com", "year_month": _this_year_month(), "tool": "get_accounts"},
        {"user_id": "user@example.com", "year_month": _this_year_month(), "tool": "get_accounts"},
    ])

    async def forbidden(uid, name, args):
        raise AssertionError("execute_tool must not run once the allowance is spent")
    monkeypatch.setattr(mcp, "execute_tool", forbidden)

    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 9, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    assert resp["error"]["code"] == -32000
    assert resp["error"]["data"]["used"] == 2
    assert resp["error"]["data"]["limit"] == 2
    # A denied call writes no audit doc of its own (checked before any work).
    assert len(audit.docs) == 2


def test_tools_call_tier_with_zero_allowance_gets_a_distinct_error(monkeypatch):
    _patch_subscription(monkeypatch, tier_name="standard", mcp_limit=0)
    _patch_audit(monkeypatch)

    async def forbidden(uid, name, args):
        raise AssertionError("execute_tool must not run on a tier with no connector allowance")
    monkeypatch.setattr(mcp, "execute_tool", forbidden)

    resp = _run(mcp.handle_jsonrpc_request(_principal(), {
        "jsonrpc": "2.0", "id": 10, "method": "tools/call",
        "params": {"name": "get_accounts", "arguments": {}},
    }))
    assert resp["error"]["code"] == -32002
    assert resp["error"]["code"] != -32000
    assert "Connect and Max" in resp["error"]["message"]


def _this_year_month() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m")


# ── transport: malformed JSON, GET, DELETE ──────────────────────────────

class _FakeRequest:
    def __init__(self, body: bytes):
        self._body = body

    async def body(self):
        return self._body


def test_malformed_json_returns_parse_error(monkeypatch):
    # F7: mcp_post no longer calls check_rate_limit itself (the old per-IP
    # "/mcp" rule was replaced by per-principal limits applied per message,
    # after JSON parsing succeeds), so there is nothing to stub out here any
    # more before resolve_mcp_principal.
    async def fake_principal(request):
        return _principal()
    monkeypatch.setattr(mcp, "resolve_mcp_principal", fake_principal)

    resp = _run(mcp.mcp_post(_FakeRequest(b"{not json")))
    import json as _json
    body = _json.loads(resp.body)
    assert body["error"]["code"] == -32700


def test_get_returns_405():
    resp = _run(mcp.mcp_get())
    assert resp.status_code == 405


def test_delete_returns_204():
    resp = _run(mcp.mcp_delete())
    assert resp.status_code == 204


# ── mcp_mask.py: masking rules ───────────────────────────────────────────

def test_mask_removes_account_number_and_sort_code_at_any_depth():
    result = {
        "accounts": [
            {"id": "a1", "name": "Halifax", "account_number": "123", "meta": {"sort_code": "12-34-56", "iban": "GB..."}},
        ],
    }
    masked = mcp_mask.mask_output("get_accounts", result)
    assert "account_number" not in masked["accounts"][0]
    assert "sort_code" not in masked["accounts"][0]["meta"]
    assert "iban" not in masked["accounts"][0]["meta"]
    assert masked["accounts"][0]["name"] == "Halifax"


def test_mask_removes_consent_and_token_keys():
    result = {"consent_id": "c1", "provider_account_id": "p1", "access_token": "t", "refresh_token": "r", "ok": True}
    masked = mcp_mask.mask_output("get_accounts", result)
    assert masked == {"ok": True}


def test_mask_drops_account_activity_transaction_rows():
    result = {
        "account_id": "a1",
        "money_in": {"raw": 100.0},
        "top_transactions": [{"id": "t1", "date": "2026-09-01", "description": "Tesco", "amount": {"raw": 5.0}}],
        "first_transaction": {"id": "t1", "date": "2026-09-01", "description": "Tesco", "amount": {"raw": 5.0}},
        "last_transaction": {"id": "t2", "date": "2026-09-02", "description": "Amazon", "amount": {"raw": 8.0}},
    }
    masked = mcp_mask.mask_output("get_account_activity", result)
    assert "top_transactions" not in masked
    assert "first_transaction" not in masked
    assert "last_transaction" not in masked
    assert masked["money_in"] == {"raw": 100.0}


def test_mask_drops_generic_transaction_shaped_lists_for_any_tool():
    """The generic rule (2) must fire even for a tool with no tool-specific
    case at all, and even under a made-up key name. This is what proves
    it's structural rather than a per-tool allow-list."""
    result = {
        "some_new_field": [
            {"merchant": "Tesco", "amount": 5.0, "date": "2026-09-01"},
            {"description": "Amazon", "amount": 8.0, "date": "2026-09-02"},
        ],
        "keep_me": "aggregate stays",
    }
    masked = mcp_mask.mask_output("get_insights", result)
    assert "some_new_field" not in masked
    assert masked["keep_me"] == "aggregate stays"


def test_mask_keeps_aggregates_without_a_date_key():
    result = {
        "top_merchants": [{"merchant": "Tesco", "spent": {"raw": 120.0}}],
        "series": [{"name": "Netflix", "typical_amount": {"raw": 12.0}, "next_expected_date": "2026-09-20"}],
    }
    masked = mcp_mask.mask_output("get_category_spend", result)
    assert masked == result


def test_mask_drops_unresolved_largest_for_get_spend_verdict_only():
    result = {
        "unresolved": {
            "count": 2,
            "largest": {"display_name": "Someone", "amount": {"raw": 40.0}, "date": "2026-09-03"},
        },
    }
    masked = mcp_mask.mask_output("get_spend_verdict", result)
    assert "largest" not in masked["unresolved"]
    assert masked["unresolved"]["count"] == 2

    # The same shape under a DIFFERENT tool name is not covered by this
    # tool-specific rule (display_name/amount/date isn't the generic
    # transaction shape either, since it has no description/merchant key).
    untouched = mcp_mask.mask_output("get_insights", result)
    assert "largest" in untouched["unresolved"]


def test_mask_output_and_count_reports_how_many_keys_were_dropped():
    result = {"account_number": "1", "sort_code": "2", "name": "ok"}
    masked, dropped = mcp_mask.mask_output_and_count("get_accounts", result)
    assert dropped == 2
    assert masked == {"name": "ok"}
