"""G334: Penny's consolidation planner and tool (pure planner, no DB)."""
import asyncio

import pytest

from app.services import penny_consolidation as pc
from app.services.penny_consolidation import plan_consolidation_legs


def _acc(aid, name, provider, subtype="TRANSACTION", typ="bank", **kw):
    return {"id": aid, "name": name, "provider": provider, "subtype": subtype, "type": typ, **kw}


def _elig(head, raw=None):
    return {"short": False, "headroom": raw if raw is not None else head,
            "spend_from_headroom": head, "account_headroom_raw": raw if raw is not None else head}


def kevin(**over):
    accounts = [
        _acc("bar", "Barclays Current", "ob-barclays"),
        _acc("nat", "NatWest Select", "ob-natwest"),
        _acc("star", "Starling Personal", "ob-starling"),
        _acc("hsbc", "HSBC Maingi K M", "ob-hsbc"),
        _acc("rev", "Revolut Main", "ob-revolut"),
        _acc("monzo", "Saving Challenge", "ob-monzo", subtype="SAVINGS"),
        _acc("amex", "Amex", "ob-amex", subtype="CREDIT_CARD", typ="credit_card"),
    ]
    elig = {
        "bar": _elig(40), "nat": _elig(146, 171), "star": _elig(54), "hsbc": _elig(0),
        "monzo": _elig(1594),
    }
    kw = dict(target_id="bar", eligibility=elig, accounts=accounts, pool=236.0, amount=None,
              include_savings=False, pot_ids={"monzo"}, name_tokens=["maingi", "k", "m"])
    kw.update(over)
    return plan_consolidation_legs(**kw)


def test_kevin_case_never_209():
    plan = kevin()
    assert [(l["name"], l["amount"]) for l in plan["legs"]] == [("NatWest Select", 146.0), ("Starling Personal", 54.0)]
    assert plan["total"] == 200.0
    assert "£209" not in plan["summary"]
    assert "£146.00 from NatWest Select" in plan["summary"]
    assert "£54.00 from Starling Personal" in plan["summary"]
    reasons = {s["account_id"]: s["reason"] for s in plan["skipped"]}
    assert reasons == {"hsbc": "nothing_spare", "rev": "no_data", "monzo": "set_aside_pot", "amex": "credit_card"}
    assert plan["shortfall"] == 0.0 and plan["pool"] == 236.0 and plan["floor"] == 5.0
    assert "Your HSBC account has nothing spare".lower() in plan["summary"].lower()


def test_amount_above_total_reports_shortfall():
    plan = kevin(amount=300)
    assert plan["total"] == 200.0 and plan["shortfall"] == 100.0 and plan["requested"] == 300.0
    assert "You asked about £300.00" in plan["summary"]


def test_amount_below_total_single_leg_and_keeps():
    plan = kevin(amount=100)
    assert len(plan["legs"]) == 1
    leg = plan["legs"][0]
    assert leg["amount"] == 100.0 and leg["keeps"] == 46.0 and plan["shortfall"] == 0.0
    assert "£100.00 from NatWest Select" in plan["summary"]


def test_pots_never_move_even_with_include_savings_but_plain_savings_can():
    plan = kevin(include_savings=True)
    assert all(l["account_id"] != "monzo" for l in plan["legs"])
    assert {s["account_id"]: s["reason"] for s in plan["skipped"]}["monzo"] == "set_aside_pot"
    base = kevin()
    plan2 = plan_consolidation_legs(
        target_id="bar", eligibility={"bar": _elig(0), "isa": _elig(80), "nat": _elig(146)},
        accounts=[_acc("bar", "Barclays", "ob-barclays"), _acc("nat", "NatWest", "ob-natwest"),
                  _acc("isa", "Easy Saver", "ob-natwest", subtype="SAVINGS")],
        pool=500.0, amount=None, include_savings=True, pot_ids=set(), name_tokens=[])
    assert [l["account_id"] for l in plan2["legs"]] == ["nat", "isa"]
    plan3 = plan_consolidation_legs(
        target_id="bar", eligibility={"isa": _elig(80), "nat": _elig(146)},
        accounts=[_acc("bar", "Barclays", "ob-barclays"), _acc("nat", "NatWest", "ob-natwest"),
                  _acc("isa", "Easy Saver", "ob-natwest", subtype="SAVINGS")],
        pool=500.0, amount=None, include_savings=False, pot_ids=set(), name_tokens=[])
    assert [l["account_id"] for l in plan3["legs"]] == ["nat"]
    assert {s["account_id"]: s["reason"] for s in plan3["skipped"]}["isa"] == "savings"
    assert base["total"] == 200.0


def test_holder_named_account_reads_your_bank_account():
    plan = kevin(eligibility={"bar": _elig(0), "hsbc": _elig(90), "nat": _elig(146)})
    names = [l["name"] for l in plan["legs"]]
    assert "Your HSBC account" in names
    assert "from your HSBC account" in plan["summary"]
    assert not any("Maingi" in s["name"] for s in plan["skipped"])


def test_pool_smaller_than_headroom_caps_total():
    plan = kevin(pool=120.0)
    assert plan["total"] == 120.0
    assert [l["amount"] for l in plan["legs"]] == [120.0]


def test_pool_none_no_cap():
    plan = kevin(pool=None)
    assert plan["pool"] is None and plan["total"] == 200.0


def test_target_without_headroom_still_gets_legs():
    plan = kevin(eligibility={"nat": _elig(146), "star": _elig(54)})
    assert plan["target"]["own_headroom"] is None
    assert plan["total"] == 200.0


def test_excluded_account_and_floor():
    plan = kevin(accounts=[
        _acc("bar", "Barclays", "ob-barclays"),
        _acc("nat", "NatWest", "ob-natwest", cover_source_eligible=False),
        _acc("star", "Starling", "ob-starling", include_in_safe_to_spend=False),
        _acc("rev", "Revolut", "ob-revolut"),
    ], eligibility={"nat": _elig(100), "star": _elig(100), "rev": _elig(4.99)})
    assert plan["legs"] == []
    reasons = {s["account_id"]: s["reason"] for s in plan["skipped"]}
    assert reasons == {"nat": "excluded", "star": "excluded", "rev": "nothing_spare"}
    assert plan["summary"].startswith("Nothing can move into")


def test_no_sources_with_requested_amount():
    plan = kevin(eligibility={"bar": _elig(10)}, amount=50)
    assert plan["legs"] == [] and plan["total"] == 0.0
    assert plan["summary"].startswith("You asked about £50.00.")


@pytest.mark.parametrize("kw", [{}, {"amount": 300}, {"amount": 100}, {"eligibility": {}}, {"include_savings": True}])
def test_summaries_have_no_em_dash_or_exclamation(kw):
    s = kevin(**kw)["summary"]
    assert "—" not in s and "!" not in s and "–" not in s


def test_schema_registered_once_and_in_mcp_scopes():
    from app.routers import mcp
    from app.services import penny_tools
    names = [t["function"]["name"] for t in penny_tools.TOOL_SCHEMAS]
    assert names.count("plan_consolidation") == 1
    assert mcp.TOOL_SCOPES["plan_consolidation"] == "accounts:read"
    desc = pc.PLAN_CONSOLIDATION_SCHEMA["function"]["description"]
    assert "quote the summary verbatim" in desc and "never moves money" in desc


def test_executor_attaches_move_plan_block(monkeypatch):
    from types import SimpleNamespace
    from app.services import penny_tools

    accounts = [
        _acc("bar", "Barclays Current", "ob-barclays"), _acc("nat", "NatWest Select", "ob-natwest"),
        _acc("star", "Starling Personal", "ob-starling"),
    ]

    async def resolve(uid, name):
        return {"account": SimpleNamespace(id="bar", name="Barclays Current")}

    async def today(uid):
        return {"account_eligibility": {"nat": _elig(146), "star": _elig(54), "bar": _elig(0)}}

    async def pool(uid):
        return 236.0

    async def accs(uid):
        return accounts

    async def pots(uid):
        return set()

    async def tokens(uid):
        return []

    monkeypatch.setattr(penny_tools, "_resolve_account_for_propose", resolve)
    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(pc, "_load_accounts", accs)
    monkeypatch.setattr(pc, "_load_pot_ids", pots)
    import app.routers.companion as rc
    import app.services.notifications as notifications
    monkeypatch.setattr(rc, "_pooled_safe_to_spend", pool)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)

    res = asyncio.run(penny_tools.execute_tool("u", "plan_consolidation", {"target_account_id_or_name": "barclays"}))
    assert res["total"]["raw"] == 200.0 and res["total"]["formatted"] == "£200.00"
    block = res["_move_plan"]
    assert block["kind"] == "move_plan" and len(block["legs"]) == 2 and block["total"] == 200.0
    assert block["target"]["bank"] == "Barclays"
    assert res["summary"] == block["summary"]
    # connector path: the card block is stripped by the mask, the sentence survives
    from app.services.mcp_mask import mask_output
    masked = mask_output("plan_consolidation", res)
    assert "_move_plan" not in masked and masked["summary"] == res["summary"]


def test_executor_error_when_left_to_spend_unavailable(monkeypatch):
    from types import SimpleNamespace
    from app.services import penny_tools

    async def resolve(uid, name):
        return {"account": SimpleNamespace(id="bar", name="Barclays")}

    async def today(uid):
        return {"account_eligibility": None}

    monkeypatch.setattr(penny_tools, "_resolve_account_for_propose", resolve)
    monkeypatch.setattr(pc, "_load_today", today)
    res = asyncio.run(pc.exec_plan_consolidation("u", "barclays"))
    assert "Left to spend is not available" in res["error"]
