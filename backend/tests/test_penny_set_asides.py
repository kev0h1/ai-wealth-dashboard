"""B59 step 4: the set-asides read tool and the complete write-tools prompt."""
import asyncio
from datetime import date
from types import SimpleNamespace

import app.routers.accounts as accounts_module
import app.routers.allocations as allocations_module
import app.routers.mcp as mcp_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module
from app.services import penny_set_asides
from app.services.penny_tools import PROPOSE_TOOL_NAMES, TOOL_SCHEMAS, execute_tool
from tests.test_penny_proposals_twins import _alloc_item

UID = "b59-set-asides"


def _world(monkeypatch, items):
    async def fake_list(user):
        return {"items": items}

    async def fake_accounts(user):
        return [SimpleNamespace(id="acc1", name="HSBC Savings")]

    async def fake_cfg(uid):
        return {}

    monkeypatch.setattr(allocations_module, "list_allocations", fake_list)
    monkeypatch.setattr(allocations_module, "_pay_cfg", fake_cfg)
    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(penny_set_asides, "get_pay_period_for_date", lambda today, cfg: (date(2026, 9, 25), date(2026, 10, 29)))
    monkeypatch.setattr(penny_set_asides.timeutil, "user_today", lambda: date(2026, 10, 25))


def test_get_set_asides_lists_pots_with_ids_and_how_to_edit(monkeypatch):
    items = [_alloc_item(id_="a1", name="Holiday", amount_per_period=120.0),
             _alloc_item(id_="a2", name="Digital saver", amount_per_period=30.0, active=False)]
    _world(monkeypatch, items)
    res = asyncio.run(execute_tool(UID, "get_set_asides", {}))
    assert res["count"] == 2 and [r["id"] for r in res["set_asides"]] == ["a1", "a2"]
    holiday = res["set_asides"][0]
    assert holiday["target"]["formatted"] == "£120.00" and holiday["fill_account"] == "HSBC Savings"
    assert holiday["status"] == "active" and res["set_asides"][1]["status"] == "paused"
    assert res["how_to_edit"] == "Ask me to change it, or open Upcoming in the app."
    assert res["period"]["label"].startswith("this pay period, 25 Sep to 29 Oct")


def test_get_set_asides_with_none_says_so(monkeypatch):
    _world(monkeypatch, [])
    res = asyncio.run(execute_tool(UID, "get_set_asides", {}))
    assert res["set_asides"] == [] and "no set-asides" in res["note"]


def test_get_set_asides_failure_is_a_designed_error(monkeypatch):
    _world(monkeypatch, [])

    async def boom(user):
        raise RuntimeError("secret internals")
    monkeypatch.setattr(allocations_module, "list_allocations", boom)
    res = asyncio.run(execute_tool(UID, "get_set_asides", {}))
    assert res == {"error": "set-asides lookup failed"}


def test_get_set_asides_is_in_the_catalogue_and_the_connector():
    assert "get_set_asides" in {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert mcp_module.TOOL_SCOPES["get_set_asides"] == "plans:read"


def test_every_propose_tool_is_named_in_the_rendered_prompt():
    prompt = penny_agent_module._SYSTEM_PROMPT + penny_agent_module._WRITE_TOOLS_ADDENDUM
    missing = [n for n in PROPOSE_TOOL_NAMES if n not in prompt]
    assert not missing, missing
    assert "other:" not in penny_agent_module._propose_tool_catalogue(), "an ungrouped propose tool needs a group"


def test_prompt_states_nothing_is_out_of_reach():
    add = penny_agent_module._WRITE_TOOLS_ADDENDUM
    assert "21. Nothing the app can do is out of your reach" in add
    assert "never say something cannot be edited here or from this screen" in add
    for needle in ("scanning a receipt", "uploading a statement or contract note", "deleting the account", "turning consent on or off"):
        assert needle in add
    new_rules = add[add.index("20. Amounts"):]
    assert "—" not in new_rules and "!" not in new_rules
