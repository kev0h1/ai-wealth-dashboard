"""G351 step 3: Penny builds a scheduled goal from words, the server does the sums."""
import asyncio
from datetime import date, datetime, timedelta

import pytest
from fastapi import HTTPException

import app.db.collections as collections_module
import app.routers.allocations as allocations_module
import app.routers.can_i as can_i_module
import app.routers.commitments as commitments_module
import app.services.account_plan_sources as plan_sources
import app.services.companion as companion_module
import app.services.penny_goal_schedule as pgs
import app.services.penny_tools as penny_tools_module
import app.services.penny_conversations as conversations_module
from app.core import timeutil
from app.core.models import Account
from app.services.penny_tools import PROPOSE_TOOL_NAMES, TOOL_SCHEMAS, execute_tool
from tests.penny_proposal_fakes import FakeCollection as FakeCol
from tests.test_penny_proposals import UID, _patch_consented_prefs

TODAY = date(2026, 10, 28)
KEVIN_WORDS = "I'm doing the 4p challenge, starting at 4p and adding 4p a day for a year"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def world(monkeypatch):
    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)

    async def cfg(_uid):
        return {"type": "calendar_month"}

    async def label(_uid, account):
        return account["name"] if account else None

    monkeypatch.setattr(commitments_module, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments_module, "_source_display_name", label)
    proposals = FakeCol()
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(can_i_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(penny_tools_module, "preferences_col",
                        FakeCol([{"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}]))
    accounts = [Account(id="cur", name="Monzo Current Account", type="transaction", balance=100.0, provider="Monzo"),
                Account(id="pot", name="Saving Challenge", type="savings", balance=0.0, provider="Monzo")]

    async def resolve(uid, ref):
        if not ref:
            return {"account": None}
        hit = [a for a in accounts if a.id == ref or str(ref).lower() in a.name.lower()]
        return {"account": hit[0]} if hit else {"error": f"no account matching '{ref}'", "available": []}

    async def owned(_uid):
        return {"cur": {"name": "Monzo Current Account", "provider": "Monzo", "type": "BANK", "account_subtype": "TRANSACTION"},
                "pot": {"name": "Saving Challenge", "provider": "Monzo", "type": "BANK", "account_subtype": "SAVINGS_ACCOUNT"}}

    async def no_items(user):  # G355: the same-name lookup never reaches a real collection
        return {"items": []}

    monkeypatch.setattr(allocations_module, "list_allocations", no_items)
    monkeypatch.setattr(commitments_module, "list_commitments", no_items)
    monkeypatch.setattr(penny_tools_module, "_resolve_account_for_propose", resolve)
    monkeypatch.setattr(plan_sources, "owned_account_map", owned)
    state = {"found": "cur"}

    async def infer(_uid, wanted, _map, **_kw):
        return {k: state["found"] for k in wanted}

    monkeypatch.setattr(companion_module, "infer_plan_sources_batch", infer)
    return {"proposals": proposals, "state": state}


# ── The parser ───────────────────────────────────────────────────────────────

def _read(text, today=TODAY):
    parsed = pgs.parse_description(text, today)
    return parsed, pgs.build_schedule(parsed["fields"], today)


def test_parser_reads_kevins_sentence():
    parsed, (raw, needs) = _read(KEVIN_WORDS)
    assert needs == [] and raw == {"type": "arithmetic", "start_pence": 4, "step_pence": 4, "step_unit": "day",
                                   "start_date": "2026-10-28", "count": 365, "end_date": None}
    assert parsed["suggested_name"] == "4p challenge"


def test_parser_reads_the_start_date():
    _p, (raw, needs) = _read("the 4p challenge since 1 January 2026, adding 4p a day for 365 days")
    assert needs == [] and raw["start_date"] == "2026-01-01" and raw["count"] == 365


def test_parser_reads_a_weekly_rise_until_a_month():
    _p, (raw, needs) = _read("£1 the first week going up by £1 a week until December")
    assert needs == []
    assert (raw["start_pence"], raw["step_pence"], raw["step_unit"], raw["end_date"]) == (100, 100, "week", "2026-12-31")


def test_parser_reads_a_fixed_list_and_a_monthly_amount():
    _p, (raw, needs) = _read("£50, £60 and £75 over the next three months")
    assert needs == [] and raw["type"] == "fixed" and raw["amounts_pence"] == [5000, 6000, 7500]
    parsed, (raw, needs) = _read("£50 a month for 6 months")
    assert needs == [] and raw["step_pence"] == 0 and raw["step_unit"] == "period" and raw["count"] == 6
    assert any("pay period" in a for a in parsed["assumptions"])


def test_parser_reads_percent_of_pay_and_asks_for_the_pay():
    _p, (raw, needs) = _read("10% of my pay")
    assert raw is None and needs == ["pay_amount", "length"]
    _p, (raw, needs) = _read("put aside 10% of my £2,400 pay for 12 months")
    assert needs == [] and raw["type"] == "percent_of_pay" and raw["expected_pay_pence"] == 240_000 and raw["count"] == 12


def test_unparseable_text_returns_needs():
    _p, (raw, needs) = _read("something nice")
    assert raw is None and needs == ["start_amount", "step_unit", "length"]
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": "something nice"}))
    assert out["needs"] == ["description"] and "schedule" not in out  # nothing readable at all
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": "start at 4p"}))
    assert out["needs"] == ["step_unit", "length"] and out["parsed"] == {"start_pence": 4}


def test_explicit_fields_override_the_description():
    out = run(execute_tool(UID, "preview_goal_schedule", {"start_amount": 0.04, "step_amount": 0.04, "step_unit": "day", "count": 365}))
    assert out["total"]["formatted"] == "£2,671.80"


# ── The preview ──────────────────────────────────────────────────────────────

def test_preview_figures_for_kevins_challenge_with_a_detected_source():
    out = run(execute_tool(UID, "preview_goal_schedule", {
        "description": KEVIN_WORDS + " from 1 January 2026", "funding_pot": "Saving Challenge"}))
    assert "needs" not in out and "error" not in out
    assert out["total"] == {"raw": 2671.8, "formatted": "£2,671.80"}
    assert out["schedule_label"] == "4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days"
    oct_ = 4 * sum(range(274, 305))  # today is 28 Oct 2026: the live period is October, days 274 to 304
    assert out["this_period_amount"]["formatted"] == f"£{oct_ / 100:,.2f}"
    assert [n["start"] for n in out["next_periods"]] == ["2026-11-01", "2026-12-01"]
    assert out["end_date"] == "2026-12-31" and out["periods_count"] == 12
    assert "£2,671.80 in total" in out["summary"]
    assert out["source"] == {"account_id": "cur", "name": "Monzo Current Account", "basis": "recent-transfers"}
    assert out["source_basis"] == "recent-transfers" and out["into"]["name"] == "Saving Challenge"
    assert NOTHING_MOVES in out["source_sentence"]


NOTHING_MOVES = "Nothing moves until you move it."


def test_preview_basis_stated_assumed_and_missing(world):
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS, "source_account_id_or_name": "Monzo Current"}))
    assert out["source"]["basis"] == "stated"
    world["state"]["found"] = None
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS, "funding_pot": "Saving Challenge"}))
    assert out["source"]["basis"] == "assumed"  # the only current account


def test_preview_with_no_detectable_source_needs_one(monkeypatch, world):
    world["state"]["found"] = None

    async def two(_uid):
        base = {"provider": "Monzo", "type": "BANK", "account_subtype": "TRANSACTION"}
        return {"a": {**base, "name": "A"}, "b": {**base, "name": "B"}}

    monkeypatch.setattr(plan_sources, "owned_account_map", two)
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS}))
    assert out["source"] is None and out["needs"] == ["source_account"]


def test_preview_stored_source_for_an_existing_goal(monkeypatch):
    async def resolved(_uid, ref):
        return {"commitment": {"id": "g1", "name": "Japan", "source_account_id": "cur", "source_name": "Barclays Premier", "source_assumed": False}}

    monkeypatch.setattr(penny_tools_module, "_resolve_commitment_for_propose", resolved)
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS, "goal_ref": "Japan"}))
    assert out["source"] == {"account_id": "cur", "name": "Barclays Premier", "basis": "stored"}


def test_preview_refuses_a_finished_schedule():
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": "4p a day rising by 4p a day from 1 Jan 2025 for 30 days"}))
    assert "finished" in out["error"]


# ── The proposal ─────────────────────────────────────────────────────────────

def test_propose_requires_a_source_and_a_user_agreed_detection(world):
    base = {"name": "4p challenge", "description": KEVIN_WORDS, "funding_pot": "Saving Challenge"}
    out = run(execute_tool(UID, "propose_create_scheduled_goal", base))
    assert out["needs"] == ["source_account"] and out["suggested_source"]["basis"] == "recent-transfers"
    assert world["proposals"].docs == []  # nothing stored without a resolved source
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {**base, "use_detected_source": True}))
    assert out["proposal"] is True and len(world["proposals"].docs) == 1


def test_propose_card_text_and_params():
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {
        "name": "4p challenge", "description": KEVIN_WORDS + " from 1 January 2026", "funding_pot": "Saving Challenge",
        "source_account_id_or_name": "Monzo Current"}))
    assert out["kind"] == "create_commitment"
    assert out["summary"] == ("Start the '4p challenge' goal: 4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days, "
                              "from Monzo Current Account into Saving Challenge, total £2,671.80")
    assert out["before"] == "No goal"
    assert out["after"] == "Total £2,671.80, from Monzo Current Account"
    oct_ = f"£{4 * sum(range(274, 305)) / 100:,.2f}"
    assert out["consequence"] == f"Creates the goal and reserves this period's {oct_}. Nothing moves until you move it."
    p = out["params"]
    assert p["source_account_id"] == "cur" and p["funding_pots"] == [{"account_id": "pot", "count_existing": False}]
    assert p["schedule"]["type"] == "arithmetic" and "deactivate_allocation_id" not in p
    for text in (out["summary"], out["after"], out["consequence"]):
        assert "—" not in text and "!" not in text


def test_propose_needs_a_name_and_surfaces_parser_needs():
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {"description": "£50, £60 and £75", "source_account_id_or_name": "Monzo"}))
    assert out["needs"] == ["name"]
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {"name": "X", "description": "start at 4p"}))
    assert out["needs"] == ["step_unit", "length"]


# ── Executing, and converting a set-aside ────────────────────────────────────

def _execute(world, monkeypatch):
    _patch_consented_prefs(monkeypatch)
    created, paused = {}, []

    async def fake_create(body, user):
        created.update(body)
        return {"id": "c1", "name": body["name"]}

    async def fake_pause(allocation_id, body, user):
        paused.append((allocation_id, body))
        return {"id": allocation_id}

    class Col:
        async def update_one(self, *a, **k):
            return None

    monkeypatch.setattr(commitments_module, "create_commitment", fake_create)
    monkeypatch.setattr(allocations_module, "update_allocation", fake_pause)
    monkeypatch.setattr(collections_module, "commitments_col", Col())
    pid = world["proposals"].docs[0]["_id"]
    return run(can_i_module.execute_proposal(pid, user={"email": UID})), created, paused


def test_execute_creates_the_goal_with_schedule_and_source(world, monkeypatch):
    run(execute_tool(UID, "propose_create_scheduled_goal", {
        "name": "4p challenge", "description": KEVIN_WORDS, "funding_pot": "Saving Challenge", "source_account_id_or_name": "Monzo Current"}))
    result, created, paused = _execute(world, monkeypatch)
    assert result["result"]["id"] == "c1"
    assert created["schedule"]["step_unit"] == "day" and created["source_account_id"] == "cur" and created["source"] == "can_i"
    assert "amount" not in created and paused == []


def test_conversion_pauses_the_named_set_aside_only_on_execute(world, monkeypatch):
    async def listing(user):
        return {"items": [
            {"id": "a1", "name": "Saving Challenge (2026)", "active": True, "fill_account_id": "pot", "source_account_id": "cur", "source_name": "Monzo Current Account"},
            {"id": "a2", "name": "Holiday", "active": True, "fill_account_id": "pot"}]}

    monkeypatch.setattr(allocations_module, "list_allocations", listing)
    paused_early = []

    async def spy(*a, **k):
        paused_early.append(a)
        return {}

    monkeypatch.setattr(allocations_module, "update_allocation", spy)
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {
        "name": "4p challenge", "description": KEVIN_WORDS, "convert_from_set_aside": "Saving Challenge"}))
    assert out["proposal"] is True and paused_early == []  # proposing changes nothing
    assert out["params"]["deactivate_allocation_id"] == "a1" and out["params"]["source_account_id"] == "cur"
    assert out["params"]["funding_pots"] == [{"account_id": "pot", "count_existing": False}]
    assert "Confirming also pauses the 'Saving Challenge (2026)' set-aside." in out["consequence"]
    assert "Progress starts from today; the set-aside's past fills stay where they are." in out["consequence"]
    result, created, paused = _execute(world, monkeypatch)
    assert paused == [("a1", {"active": False})] and "deactivate_allocation_id" not in created


def test_a_failed_pause_is_surfaced_after_the_goal_is_created(world, monkeypatch):
    async def listing(user):
        return {"items": [{"id": "a1", "name": "Saving Challenge (2026)", "active": True, "fill_account_id": "pot", "source_account_id": "cur", "source_name": "Monzo Current Account"}]}

    monkeypatch.setattr(allocations_module, "list_allocations", listing)
    run(execute_tool(UID, "propose_create_scheduled_goal", {"name": "4p challenge", "description": KEVIN_WORDS, "convert_from_set_aside": "Saving Challenge"}))
    _patch_consented_prefs(monkeypatch)
    created = {}

    async def fake_create(body, user):
        created.update(body)
        return {"id": "c1", "name": body["name"]}

    async def boom(*a, **k):
        raise RuntimeError("db down")

    class Col:
        async def update_one(self, *a, **k):
            return None

    monkeypatch.setattr(commitments_module, "create_commitment", fake_create)
    monkeypatch.setattr(allocations_module, "update_allocation", boom)
    monkeypatch.setattr(collections_module, "commitments_col", Col())
    result = run(can_i_module.execute_proposal(world["proposals"].docs[0]["_id"], user={"email": UID}))["result"]
    assert result["set_aside_paused"] is False
    assert result["message"] == ("The goal is set up, but the 'Saving Challenge (2026)' set-aside could not be paused; "
                                 "pause it from Upcoming so it is not counted twice.")
    assert "deactivate_allocation_name" not in created and "deactivate_allocation_id" not in created


def test_start_date_default_is_stated_as_an_assumption():
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS}))
    assert "I have taken today as the start date." in out["assumptions"]
    out = run(execute_tool(UID, "preview_goal_schedule", {"description": KEVIN_WORDS + " from 1 January 2026"}))
    assert "I have taken today as the start date." not in out["assumptions"]


def test_conversion_ambiguous_set_aside_returns_matches(monkeypatch):
    async def listing(user):
        return {"items": [{"id": "a1", "name": "Saving A", "active": True}, {"id": "a2", "name": "Saving B", "active": True}]}

    monkeypatch.setattr(allocations_module, "list_allocations", listing)
    out = run(execute_tool(UID, "propose_create_scheduled_goal", {"name": "X", "description": KEVIN_WORDS, "convert_from_set_aside": "saving"}))
    assert out["ambiguous"] is True and len(out["matches"]) == 2


# ── Editing, get_goals and registration ──────────────────────────────────────

def test_update_commitment_accepts_a_schedule(monkeypatch):
    async def resolved(_uid, ref):
        return {"commitment": {"id": "g1", "name": "Challenge", "schedule_label": "4p a day, rising by 4p a day, from 1 Jan 2026 for 365 days",
                               "schedule": {"type": "arithmetic", "start_pence": 4, "step_pence": 4, "step_unit": "day",
                                            "start_date": "2026-01-01", "count": 365, "end_date": None}}}

    monkeypatch.setattr(penny_tools_module, "_resolve_commitment_for_propose", resolved)
    out = run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Challenge", "step_amount": 0.05}))
    assert out["kind"] == "update_commitment" and out["params"]["commitment_id"] == "g1"
    assert out["params"]["schedule"]["step_pence"] == 5 and out["params"]["schedule"]["start_date"] == "2026-01-01"
    assert out["before"].startswith("4p a day") and out["after"].startswith("Total £")


def test_update_commitment_without_a_schedule_is_unchanged(monkeypatch):
    async def resolved(_uid, ref):
        return {"commitment": {"id": "g1", "name": "Japan", "amount": 100, "target_date": "2027-01-01"}}

    monkeypatch.setattr(penny_tools_module, "_resolve_commitment_for_propose", resolved)
    out = run(execute_tool(UID, "propose_update_commitment", {"commitment_ref": "Japan", "name": "Japan 2027"}))
    assert out["kind"] == "update_commitment" and out["params"] == {"commitment_id": "g1", "name": "Japan 2027"}


def test_get_goals_exposes_source_and_schedule(monkeypatch):
    async def listing(user):
        return {"items": [{"id": "g1", "name": "Challenge", "status": "active", "amount": 2671.8, "target_date": "2026-12-31",
                           "progress": 0, "per_period_slice": 383.4, "source_account_id": "cur", "source_name": "Monzo Current Account",
                           "source_assumed": True, "schedule_label": "4p a day", "this_period_amount": 383.4,
                           "next_periods": [{"start": "2026-12-01", "end": "2026-12-31", "amount": 423.4}]},
                          {"id": "g2", "name": "Japan", "status": "active", "amount": 100, "progress": 0}]}

    monkeypatch.setattr(commitments_module, "list_commitments", listing)
    goals = run(execute_tool(UID, "get_goals", {}))["goals"]
    assert goals[0]["source_name"] == "Monzo Current Account" and goals[0]["source_assumed"] is True and goals[0]["source_account_id"] == "cur"
    assert goals[0]["this_period_amount"]["formatted"] == "£383.40" and goals[0]["next_periods"][0]["amount"]["formatted"] == "£423.40"
    assert "schedule_label" not in goals[1] and goals[1]["source_name"] is None and goals[1]["source_assumed"] is None


def test_registration_and_consent_gating():
    assert "propose_create_scheduled_goal" in PROPOSE_TOOL_NAMES  # gated by agent consent like every propose tool
    assert "preview_goal_schedule" in {t["function"]["name"] for t in TOOL_SCHEMAS}
    schema = next(t for t in penny_tools_module.PROPOSE_TOOL_SCHEMAS if t["function"]["name"] == "propose_update_commitment")
    assert "step_amount" in schema["function"]["parameters"]["properties"]
    from app.services.penny_agent import _propose_tool_catalogue
    assert "propose_create_scheduled_goal" in _propose_tool_catalogue().split("plans and aims:")[1].split(";")[0]


# ── Revision lifecycle ──────────────────────────────────────────────────────

def _scheduled_proposal(*, proposal_id="old", expires_at=None, conversation_id=None):
    doc = {
        "_id": proposal_id, "user_id": UID, "kind": "create_commitment",
        "params": {"name": "Challenge", "schedule": {"type": "fixed", "start_date": "2026-10-28", "amounts_pence": [1000]},
                   "funding_pots": [{"account_id": "pot", "count_existing": False}], "source_account_id": "cur",
                   "source_account_name": "Monzo Current Account", "destination_names": ["Saving Challenge"]},
        "summary": "old", "consequence": "old", "before": "No goal", "after": "old", "entity": "Challenge",
        "created_at": datetime.now(), "expires_at": expires_at or datetime.now() + timedelta(minutes=15),
        "executed_at": None, "cancelled_at": None, "execution_claim": None,
    }
    if conversation_id:
        doc["conversation_id"] = conversation_id
    return doc


def _revision_world(monkeypatch, doc):
    proposals = FakeCol([doc])
    prefs = FakeCol([{"user_id": UID, "penny_agent_consent": "yes", "penny_consent_generation": 0}])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(can_i_module, "preferences_col", prefs)
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(penny_tools_module, "preferences_col", prefs)
    async def eligible_accounts(_uid):
        return {
            "cur": {"name": "Monzo Current Account", "type": "BANK", "account_subtype": "TRANSACTION", "currency": "GBP"},
            "pot": {"name": "Saving Challenge", "type": "BANK", "account_subtype": "SAVINGS_ACCOUNT", "currency": "GBP"},
        }
    monkeypatch.setattr(plan_sources, "owned_account_map", eligible_accounts)
    return proposals


def _revision_body(source="cur"):
    return {"source_account_id": source, "schedule": {"type": "fixed", "start_date": "2026-10-28", "amounts_pence": [1500, 2500]}}


def test_revision_replaces_pending_proposal_and_old_id_cannot_execute(monkeypatch):
    proposals = _revision_world(monkeypatch, _scheduled_proposal())
    fresh = run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body(), {"email": UID}))
    assert fresh["proposal_id"] != "old" and "proposal" not in fresh
    assert fresh["params"]["source_account_name"] == "Monzo Current Account"
    assert fresh["params"]["destination_names"] == ["Saving Challenge"]
    assert fresh["params"]["schedule_preview"]["periods"][0]["amount"] == 15
    old = run(proposals.find_one({"_id": "old"}))
    assert old["cancelled_at"] is not None and old["superseded_reason"] == "scheduled_goal_revision"
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.execute_proposal("old", {"email": UID}))
    assert exc.value.status_code == 410


def test_revision_rejects_unowned_or_malformed_input_without_superseding(monkeypatch):
    proposals = _revision_world(monkeypatch, _scheduled_proposal())
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body("not-owned"), {"email": UID}))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body("pot"), {"email": UID}))
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", {"source_account_id": "cur", "schedule": {"type": "fixed"}}, {"email": UID}))
    assert exc.value.status_code == 400
    assert run(proposals.find_one({"_id": "old"}))["cancelled_at"] is None


def test_revision_loses_to_execution_claim_and_expiry(monkeypatch):
    claimed = _scheduled_proposal()
    claimed["execution_claim"] = "confirm-won"
    _revision_world(monkeypatch, claimed)
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body(), {"email": UID}))
    assert exc.value.status_code == 409

    expired = _scheduled_proposal(expires_at=datetime.now() - timedelta(seconds=1))
    _revision_world(monkeypatch, expired)
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body(), {"email": UID}))
    assert exc.value.status_code == 410


def test_revision_fails_closed_after_supersession_if_fresh_creation_fails(monkeypatch):
    proposals = _revision_world(monkeypatch, _scheduled_proposal())

    async def fail(*_args, **_kwargs):
        raise RuntimeError("database down")

    monkeypatch.setattr(penny_tools_module, "_create_proposal", fail)
    with pytest.raises(HTTPException) as exc:
        run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body(), {"email": UID}))
    assert exc.value.status_code == 409
    assert run(proposals.find_one({"_id": "old"}))["cancelled_at"] is not None
    assert len(proposals.docs) == 1


def test_revision_moves_the_stored_conversation_reference_to_the_fresh_card(monkeypatch):
    _revision_world(monkeypatch, _scheduled_proposal(conversation_id="chat-1"))
    calls = []

    async def link(uid, cid, proposal_id):
        calls.append(("link", uid, cid, proposal_id))

    async def replace(uid, old_id, fresh):
        calls.append(("replace", uid, old_id, fresh["proposal_id"], fresh["params"]["schedule_preview"]))

    monkeypatch.setattr(can_i_module.penny_conversations, "link_proposal", link)
    monkeypatch.setattr(can_i_module.penny_conversations, "replace_pending_proposal", replace)
    fresh = run(can_i_module.revise_scheduled_goal_proposal("old", _revision_body(), {"email": UID}))
    assert calls[0] == ("link", UID, "chat-1", fresh["proposal_id"])
    assert calls[1][0:4] == ("replace", UID, "old", fresh["proposal_id"])
    assert calls[1][4]["schedule"] == fresh["params"]["schedule"]


def test_restored_superseded_card_follows_fresh_pending_proposal_with_safe_params(monkeypatch):
    old = _scheduled_proposal()
    old.update({"cancelled_at": datetime.now(), "superseded_by": "fresh"})
    fresh = _scheduled_proposal(proposal_id="fresh")
    fresh["params"]["schedule_preview"] = {"schedule": fresh["params"]["schedule"], "periods": []}
    proposals = FakeCol([old, fresh])
    monkeypatch.setattr(conversations_module, "penny_proposals_col", proposals)
    doc = {"turns": [{"proposal": {"proposal_id": "old", "kind": "create_commitment", "summary": "old", "consequence": "old", "status": "pending"}}]}
    run(conversations_module._live_proposal_statuses(UID, doc))
    block = doc["turns"][0]["proposal"]
    assert block["proposal_id"] == "fresh" and block["status"] == "pending"
    assert block["params"]["schedule_preview"] == fresh["params"]["schedule_preview"]
    assert set(block["params"]) <= {"schedule_preview", "schedule", "name", "source_account_id", "source_account_name", "destination_names", "funding_pots", "deactivate_allocation_id", "deactivate_allocation_name"}
