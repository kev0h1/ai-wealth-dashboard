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
        "plan_period": {"start": "2026-10-30", "end": "2026-11-26", "label": "30 Oct to 26 Nov"},
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
    assert res["plan_period"]["label"] == "30 Oct to 26 Nov"
    assert "The plan covers 30 Oct to 26 Nov." in res["summary"]
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


def test_risk_copy_never_falls_back_to_the_engines_raw_copy(monkeypatch):
    risk = {"account_id": "a9", "name": "Mr K Maingi", "shortfall": 120, "copy": "£300 leaves Mr K Maingi on payday and nothing expected in covers it."}
    _world(monkeypatch, preview=_item(payday_split_risk=risk))

    async def fake_accounts(uid):
        return [{"id": "a9", "name": "Mr K Maingi", "provider": "natwest"}]
    monkeypatch.setattr(consolidation_module, "_load_accounts", fake_accounts)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    copy = res["payday_split_risk"]["copy"]
    assert "Maingi" not in copy and copy == "£120 leaves your NatWest account on payday and nothing expected in covers it."


def test_payday_plan_says_when_over_pay_and_what_was_left_out(monkeypatch):
    """G350: the over-pay sentence and the left-out list reach Penny, hedged."""
    item = _item(
        total=2300.0,
        over_salary={"total": 2300, "pay": 2000, "short": 300, "over_pay": True, "spare": 0},
        left_out=[
            {"name": "Saving Challenge", "kind": "set_aside", "amount": 120},
            {"name": "Japan", "kind": "goal", "amount": 80},
            {"name": "Monzo Bills", "kind": "usual", "amount": 50},
            {"name": "Spare pot", "kind": "destination", "amount": 40},
        ],
    )
    item["dests"][0].update({"move": 2300, "reasons": [{"name": "Saving Challenge", "kind": "set_aside", "amount": 120}]})
    item["salary"]["keeps"] = [{"name": "Japan", "kind": "goal", "amount": 100, "source_assumed": True}]
    _world(monkeypatch, preview=item)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert res["over_salary"]["short"]["formatted"] == "£300"
    assert res["dests"][0]["reasons"][0]["name"] == "Saving Challenge"
    assert res["salary"]["keeps"][0]["name"] == "Japan" and res["salary"]["keeps"][0]["source_assumed"] is True
    assert "The plan keeps £100 for Japan in NatWest Select." in res["summary"]
    assert ("These moves add up to £2,300, more than the ~£2,000 pay expected. £300 "
            "would need to come from other accounts.") in res["summary"]
    assert "Left out this month: Saving Challenge £120, Japan £80, Monzo Bills £50 and 1 more." in res["summary"]
    assert "will" not in res["summary"].split()


def test_payday_plan_without_over_pay_has_no_over_salary_or_left_out(monkeypatch):
    _world(monkeypatch, preview=_item())
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert res["over_salary"] is None and res["left_out"] == []
    assert "Left out" not in res["summary"] and "more than" not in res["summary"]


def test_payday_plan_over_spare_but_within_pay_wording(monkeypatch):
    item = _item(total=900.0, over_salary={"total": 900, "pay": 2000, "short": 400, "over_pay": False, "spare": 500})
    _world(monkeypatch, preview=item)
    res = asyncio.run(execute_tool(UID, "get_payday_plan", {}))
    assert ("These moves add up to £900, but NatWest Select can only spare £500 after what it keeps "
            "for its own bills. £400 would need to come from other accounts.") in res["summary"]
