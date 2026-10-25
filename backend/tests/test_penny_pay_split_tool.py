"""B60 step 2: the get_pay_split read tool."""
import asyncio

import app.routers.mcp as mcp_module
import app.services.money_shape as money_shape_module
import app.services.penny_pay_split as pay_split_module
from app.services.penny_pay_split import compare_shape
from app.services.penny_tools import TOOL_SCHEMAS, execute_tool

UID = "b60-pay-split"


def _shape(fixed=1740.0, moved=540.0, free=720.0, take_home=3000.0, status="ok"):
    def job(i, label, amt, share):
        return {"id": i, "label": label, "amount": amt, "share": share}
    return {
        "status": status, "period": {"label": "25 Sep to 24 Oct"}, "take_home": take_home, "overspent": 0.0,
        "total_out": fixed + moved + free,
        "jobs": [job("fixed", "Fixed (bills, debt, rent)", fixed, 58), job("moved", "Moved to savings", moved, 18),
                 job("free", "Free spending", free, 24), job("left", "Left over", 0.0, 0)],
        "verdict": "Of every £100 you take home, £58 is spoken for before you choose anything.",
        "what_works": {"state": "ok", "headline": "Calm starts ended with cash left over 3 times out of 4."},
        "averages": [{"months": 3, "label": "Last 3 months", "jobs": [{"id": "fixed", "share": 55}, {"id": "moved", "share": 15}, {"id": "free", "share": 25}, {"id": "left", "share": 5}]},
                     {"months": 24, "label": "Last 24 months", "jobs": []}],
    }


def _world(monkeypatch, shape, reference="conscious"):
    async def fake_shape(uid, ttl_hours=6):
        return shape

    async def fake_ref(uid):
        return reference
    monkeypatch.setattr(money_shape_module, "get_money_shape_cached", fake_shape)
    monkeypatch.setattr(pay_split_module, "_selected_reference", fake_ref)


def test_pay_split_compares_with_the_selected_reference(monkeypatch):
    _world(monkeypatch, _shape())
    res = asyncio.run(execute_tool(UID, "get_pay_split", {}))
    assert res["reference"]["id"] == "conscious" and res["reference"]["selected"] is True
    rows = {r["job"]: r for r in res["comparison"]}
    assert rows["Fixed costs"]["actual_pct"] == 58 and rows["Fixed costs"]["guide_pct"] == 60
    assert rows["Fixed costs"]["delta_pct"] == -2
    assert rows["Free spending"]["actual_pct"] == 24 and rows["Free spending"]["guide_pct"] == 20
    assert rows["Moved to savings"]["delta_pct"] == -2
    assert res["summary"] == (
        "For 25 Sep to 24 Oct, 58% of your take-home went to fixed costs against the 60% in the "
        "Conscious Spending Plan example, 24% to free spending against 20%, 18% moved to savings against 20%."
    )
    assert [a["months"] for a in res["averages"]] == [3] and res["averages"][0]["fixed_pct"] == 55
    assert res["what_works"][0].startswith("Calm starts")
    assert res["take_home"]["formatted"] == "£3,000.00"


def test_reference_argument_overrides_and_first_has_no_percentages(monkeypatch):
    _world(monkeypatch, _shape(), reference="50-30-20")
    res = asyncio.run(execute_tool(UID, "get_pay_split", {"reference": "first"}))
    assert res["reference"]["id"] == "first" and res["reference"]["selected"] is False
    assert all(r["guide_pct"] is None and r["delta_pct"] is None for r in res["comparison"])
    assert "no fixed percentage" in res["summary"]
    res = asyncio.run(execute_tool(UID, "get_pay_split", {"reference": "nonsense"}))
    assert res["reference"]["id"] == "50-30-20"


def test_thin_data_and_failure(monkeypatch):
    _world(monkeypatch, {"status": "thin", "jobs": None})
    assert asyncio.run(execute_tool(UID, "get_pay_split", {}))["insufficient_data"] is True

    async def boom(uid, ttl_hours=6):
        raise RuntimeError("secret internals")
    monkeypatch.setattr(money_shape_module, "get_money_shape_cached", boom)
    assert asyncio.run(execute_tool(UID, "get_pay_split", {})) == {"error": "pay split lookup failed"}


def test_compare_shape_is_penny_exact_like_the_typescript():
    comp = compare_shape(_shape(fixed=1000.01, moved=500.0, free=1499.99, take_home=3000.0), "50-30-20")
    rows = {r["id"]: r for r in comp["rows"]}
    assert rows["fixed"]["guide"] == 1500.0 and rows["moved"]["guide"] == 600.0 and rows["free"]["guide"] == 900.0
    assert round(sum(r["guide"] for r in comp["rows"]), 2) == 3000.0
    assert compare_shape(_shape(take_home=0), "50-30-20")["available"] is False
    mismatch = _shape()
    mismatch["total_out"] = 1.0
    assert compare_shape(mismatch, "conscious")["available"] is False


def test_pay_split_is_in_the_catalogue_and_the_connector():
    assert "get_pay_split" in {t["function"]["name"] for t in TOOL_SCHEMAS}
    assert mcp_module.TOOL_SCOPES["get_pay_split"] == "insights:read"
