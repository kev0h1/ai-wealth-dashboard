"""B60 step 4: propose_connect_bank is proposal-first and record-only."""
import asyncio

import app.routers.can_i as can_i_module
import app.services.penny_tools as penny_tools
from app.content.regulatory import AGENT_DISCLOSURE, TRADING_NAME_DISCLOSURE
from app.services.penny_agent import _WRITE_TOOLS_ADDENDUM
from app.services.penny_tools import PROPOSE_TOOL_NAMES, execute_tool
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_proposals import _live_doc, _patch_consented_prefs

UID = "b60-connect"


def _props(monkeypatch):
    props = _FakeCol()
    monkeypatch.setattr(penny_tools, "penny_proposals_col", props)
    monkeypatch.setattr(penny_tools, "preferences_col", _FakeCol([{"user_id": UID}]))
    return props


def test_proposal_carries_the_disclosure_and_names_the_bank(monkeypatch):
    props = _props(monkeypatch)
    res = asyncio.run(execute_tool(UID, "propose_connect_bank", {"bank": "  Monzo "}))
    assert res["kind"] == "connect_bank" and res["summary"] == "Connect Monzo through Finexer"
    assert res["params"] == {"bank": "Monzo"} and res["entity"] == "Monzo"
    assert res["consequence"] == (
        f"{TRADING_NAME_DISCLOSURE} {AGENT_DISCLOSURE} Tap Continue to Finexer to review permissions and "
        "connect. Nothing is connected until you finish with Finexer."
    )
    assert len(props.docs) == 1
    generic = asyncio.run(execute_tool(UID, "propose_connect_bank", {}))
    assert generic["summary"] == "Connect a bank through Finexer" and generic["params"] == {"bank": None}


def test_executor_is_record_only(monkeypatch):
    _patch_consented_prefs(monkeypatch)
    props = _FakeCol([_live_doc("connect_bank", {"bank": "Monzo"})])
    props.docs[0]["user_id"] = UID
    monkeypatch.setattr(can_i_module, "penny_proposals_col", props)
    monkeypatch.setattr(can_i_module, "preferences_col", _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}]))
    out = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert out["executed"] is True
    assert out["result"] == {"recorded": True, "open": "bank_picker", "bank": "Monzo"}


def test_registered_and_prompted():
    assert "propose_connect_bank" in PROPOSE_TOOL_NAMES and "connect_bank" in can_i_module._PROPOSAL_EXECUTORS
    assert "To connect a bank, call propose_connect_bank; the user taps Continue to Finexer on the card." in _WRITE_TOOLS_ADDENDUM
    desc = next(t for t in penny_tools.PROPOSE_TOOL_SCHEMAS if t["function"]["name"] == "propose_connect_bank")["function"]["description"]
    assert "never connects a bank herself" in desc
