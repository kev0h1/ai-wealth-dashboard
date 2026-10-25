"""B60 step 1: the get_payday_plan read tool."""
import asyncio

import app.routers.mcp as mcp_module
import app.services.companion as companion_module
import app.services.penny_consolidation as consolidation_module
from app.services.penny_tools import TOOL_SCHEMAS, execute_tool

UID = "b60-payday"


def _item(**over):
    base = {
        "id": "payday_plan:x", "type": "payday_plan", "headline": "h", "body": "b", "covered": True,
        "total": 450.0, "trimmed": False, "preview": True, "next_pay": "2026-10-30", "estimated": False,
        "salary": {"account_id": "a1", "name": "NatWest Select", "provider": "natwest", "amount": 2000, "stays": 1550},
        "dests": [
            {"account_id": "a2", "name": "Monzo Bills", "bills_total": 300, "bill_count": 4,
             "spend_typical": 100, "buffer": 50, "move": 450, "usual": None, "target": 450},
        ],
        "payday_split": {"total": 300, "count": 4, "expected_in": 2000,
                         "accounts": [{"account_id": "a2", "name": "Monzo Bills", "out": 300}]},
    }
    base.update(over)
    return base


def _world(monkeypatch, live=None, preview=None):
    calls = []

    async def fake_items(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        calls.append((payday_preview, persist))
        pool = preview if payday_preview else live
        return [pool] if pool else []

    async def fake_accounts(uid):
        return [{"id": "a1", "name": "NatWest Select", "provider": "natwest"},
                {"id": "a2", "name": "Monzo Bills", "provider": "monzo"}]

    async def fake_tokens(uid):
        return []

    import app.services.notifications as notifications_module
    monkeypatch.setattr(companion_module, "compute_today_items", fake_items)
    monkeypatch.setattr(consolidation_module, "_load_accounts", fake_accounts)
    monkeypatch.setattr(notifications_module, "_user_name_tokens", fake_tokens)
    return calls


def test_payday_plan_falls_back_to_preview_and_never_persists(monkeypatch):
    calls = _world(monkeypatch, preview=_item())
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert calls == [(False, False), (True, False)]
    assert res["next_pay"] == "2026-10-30" and res["preview"] is True
    assert res["total"]["formatted"] == "£450"
    assert res["payday_split"] == {"total": 300, "count": 4, "expected_in": 2000,
                                   "accounts": [{"name": "Monzo Bills", "out": 300}]}
    assert res["summary"].startswith("Your next pay is expected around 30 Oct.")
    assert "£450 to Monzo Bills" in res["summary"]
    assert "will" not in res["summary"].split()


def test_payday_plan_live_item_and_risk_copy(monkeypatch):
    risk = {"account_id": "a2", "name": "Monzo Bills", "shortfall": 120, "copy": "unused"}
    calls = _world(monkeypatch, live=_item(preview=False, payday_split_risk=risk))
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert calls == [(False, False)]
    assert res["payday_split_risk"]["copy"] == "£300 leaves Monzo Bills on payday and nothing expected in covers it."
    assert res["summary"].endswith(res["payday_split_risk"]["copy"])


def test_payday_plan_names_holder_named_accounts_by_bank(monkeypatch):
    _world(monkeypatch, preview=_item(salary={"account_id": "a1", "name": "Mr K Maingi", "provider": "natwest",
                                              "amount": 2000, "stays": 1550}))

    async def fake_accounts(uid):
        return [{"id": "a1", "name": "Mr K Maingi", "provider": "natwest"}]
    monkeypatch.setattr(consolidation_module, "_load_accounts", fake_accounts)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert "Maingi" not in res["salary"]["name"] and "NatWest" in res["salary"]["name"]


def test_payday_plan_without_data_and_failure(monkeypatch):
    _world(monkeypatch)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert res["insufficient_data"] is True

    async def boom(*a, **k):
        raise RuntimeError("secret internals")
    monkeypatch.setattr(companion_module, "compute_today_items", boom)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert res == {"error": "payday plan lookup failed"}


def test_payday_plan_is_in_the_catalogue_and_the_connector():
    assert "get_payday_plan" in {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert mcp_module.TOOL_SCOPES["get_payday_plan"] == "accounts:read"
