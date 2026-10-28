"""G355 steps 3 to 5: the goal draft is carried across turns, an account is only
"stated" when the user said it, and an existing set-aside is offered for
conversion rather than duplicated."""
import asyncio

import pytest

import app.routers.allocations as allocations_module
import app.routers.commitments as commitments_module
from app.services import penny_conversations as conversations
from app.services import penny_focus as focus
from app.services import penny_goal_schedule as pgs
from app.services.penny_tools import execute_tool
from tests.test_g351_penny_goal_schedule import KEVIN_WORDS, TODAY, UID, world  # noqa: F401  (autouse fixture)

PLAN = {"start_amount": 11.48, "step_amount": 0.04, "step_unit": "day", "count": 79, "start_date": "2026-10-30",
        "name": "Saving Challenge (2026)"}
SAID = ["My Monzo current account"]


def run(coro):
    return asyncio.run(coro)


def call(name, args, draft=None, texts=None):
    out = run(execute_tool(UID, name, {**args, "_draft": draft, "_user_texts": SAID if texts is None else texts}))
    return out, out.pop("_draft", "absent")


def sets(items):
    async def listing(user):
        return {"items": items}
    return listing


# ── Step 3: the draft ────────────────────────────────────────────────────────

def test_preview_returns_a_clean_draft_and_a_direct_call_returns_none():
    out, draft = call("preview_goal_schedule", {**PLAN, "funding_pot": "Saving Challenge"})
    assert draft["start_date"] == "2026-10-30" and draft["count"] == 79 and draft["start_pence"] == 1148
    assert draft["step_pence"] == 4 and draft["step_unit"] == "day" and draft["name"] == "Saving Challenge (2026)"
    assert draft["into_id"] == "pot" and draft["source_account_id"] == "cur"
    assert "_draft" not in run(execute_tool(UID, "preview_goal_schedule", PLAN))  # no agent, no draft key


def test_final_call_with_only_the_unit_builds_the_card_from_the_agreed_draft(world):
    _out, draft = call("preview_goal_schedule", {**PLAN, "funding_pot": "Saving Challenge", "source_account_id_or_name": "Monzo Current"})
    assert draft["source_basis"] == "stated"
    # Kevin's "Daily": the model passes only the unit, and nothing else changes.
    out, after = call("propose_create_scheduled_goal", {"step_unit": "day"}, draft)
    assert out["proposal"] is True and after is None  # the draft is spent
    params = out["params"]
    assert params["schedule"]["start_date"] == "2026-10-30" and params["schedule"]["count"] == 79
    assert params["schedule"]["start_pence"] == 1148 and params["source_account_id"] == "cur"
    assert params["name"] == "Saving Challenge (2026)" and params["funding_pots"] == [{"account_id": "pot", "count_existing": False}]
    assert params["schedule_preview"]["end_date"] == "2027-01-16" and params["schedule_preview"]["start_date"] == "2026-10-30"


def test_a_given_argument_changes_only_that_field():
    _out, draft = call("preview_goal_schedule", {**PLAN, "source_account_id_or_name": "Monzo Current"})
    out, new = call("preview_goal_schedule", {"start_amount": 12.0}, draft)
    assert new["start_pence"] == 1200 and new["count"] == 79 and new["start_date"] == "2026-10-30" and new["step_pence"] == 4
    assert new["source_account_id"] == draft["source_account_id"] and out["total"]["formatted"] == "£1,071.24"


def test_start_defaults_to_today_only_without_a_draft_or_a_stated_start():
    no_start = {k: v for k, v in PLAN.items() if k != "start_date"}
    out, draft = call("preview_goal_schedule", no_start)
    assert draft["start_date"] == TODAY.isoformat() and "I have taken today as the start date." in out["assumptions"]
    out2, draft2 = call("preview_goal_schedule", {"step_unit": "day"}, {**draft, "start_date": "2026-11-05"})
    assert draft2["start_date"] == "2026-11-05" and "I have taken today as the start date." not in out2["assumptions"]


def test_a_different_name_starts_a_fresh_goal():
    _out, draft = call("preview_goal_schedule", PLAN)
    out, new = call("preview_goal_schedule", {"description": "£50 a month for 6 months", "name": "Holiday"}, draft)
    assert new["name"] == "Holiday" and new["start_pence"] == 5000 and new["start_date"] == TODAY.isoformat()
    assert "source_account_id" not in new  # the old goal's account choice is not carried to a new goal
    assert new.get("count") == 6 and "convert_candidate" not in new


def test_the_same_goal_under_a_looser_name_keeps_the_draft():
    _out, draft = call("preview_goal_schedule", PLAN)
    _out, new = call("preview_goal_schedule", {"name": "savings challenge", "step_unit": "week"}, draft)
    assert new["start_date"] == "2026-10-30" and new["step_unit"] == "week" and new["name"] == "savings challenge"


def test_a_new_length_replaces_the_old_end():
    _out, draft = call("preview_goal_schedule", {**PLAN, "count": None, "end_date": "2027-01-16"})
    assert draft["end_date"] == "2027-01-16" and "count" not in draft
    _out, new = call("preview_goal_schedule", {"count": 30}, draft)
    assert new["count"] == 30 and "end_date" not in new


def test_draft_sentence_and_focus_block():
    _out, draft = call("preview_goal_schedule", {**PLAN, "funding_pot": "Saving Challenge", "source_account_id_or_name": "Monzo Current"})
    text = focus.focus_block({"tool": "preview_goal_schedule", "kind": "goal_draft", "draft": draft})
    assert text.startswith("\n\nDRAFT goal: £11.48 a day, rising by 4p a day, from Fri 30 Oct 2026 for 79 days")
    assert "source Monzo Current Account (stated, settled)" in text and "into Saving Challenge" in text
    assert "never re-ask a settled field" in text and "'Daily' or 'Monzo'" in text


def test_clean_draft_caps_and_rejects_junk():
    assert focus.clean_draft("x") is None and focus.clean_draft({"bogus": 1}) is None
    d = focus.clean_draft({"name": "x" * 500, "count": True, "start_pence": 5, "step_unit": "hour", "start_date": "nope",
                           "end_date": "2027-01-16", "source_basis": "stated", "amounts_pence": [1, 2], "evil": "x",
                           "convert_candidate": {"kind": "set_aside", "id": "a1", "name": "N"}})
    assert d == {"name": "x" * 80, "start_pence": 5, "end_date": "2027-01-16", "source_basis": "stated",
                 "amounts_pence": [1, 2], "convert_candidate": {"kind": "set_aside", "id": "a1", "name": "N"}}


def test_with_draft_rides_on_other_focus_and_tombstones():
    acct = {"tool": "get_accounts", "kind": "account", "ids": ["cur"], "labels": {"cur": "Monzo"}, "args": {}}
    d = {"name": "N", "count": 3}
    carried = focus.with_draft(acct, d)
    assert carried["kind"] == "account" and carried["draft"] == d and focus.draft_of(carried) == d
    assert focus.with_draft(carried, None)["kind"] == "account" and "draft" not in focus.with_draft(carried, None)
    only = focus.with_draft(None, d)
    assert only["kind"] == "goal_draft" and focus.draft_of(only) == d
    assert focus.with_draft(None, None) is None
    tomb = focus.with_draft(only, None, tombstone=True)
    assert tomb["kind"] == "goal_draft" and focus.draft_of(tomb) is None and focus.focus_block(tomb) == ""


def test_the_stored_turn_keeps_the_draft_for_the_server_only():
    d = {"name": "N", "count": 3, "start_pence": 100}
    turn = conversations.clean_turn("assistant", "Here is the plan.", last_result=focus.with_draft(None, d))
    assert turn["last_result"]["draft"] == d
    doc = {"_id": "c", "turns": [turn]}
    assert all("last_result" not in t for t in conversations._full(doc)["turns"])
    assert conversations._full(doc, internal=True)["turns"][0]["last_result"]["draft"] == d


# ── Step 4: never attribute a choice to the user ─────────────────────────────

def test_an_account_the_user_never_named_is_the_models_pick():
    out, draft = call("preview_goal_schedule", {**PLAN, "source_account_id_or_name": "Monzo Current"}, texts=["Can you set up a plan"])
    assert out["source_basis"] == "model" and draft["source_basis"] == "model"
    assert out["source_sentence"] == "I have picked Monzo Current Account as the account the money leaves from, please check it. Nothing moves until you move it."
    assert "as you said" not in out["source_sentence"]
    needs, _d = call("propose_create_scheduled_goal", {**PLAN, "source_account_id_or_name": "Monzo Current"}, texts=["Can you set up a plan"])
    assert needs["needs"] == ["source_account"] and needs["suggested_source"]["basis"] == "model" and "proposal" not in needs
    ok, _d = call("propose_create_scheduled_goal", {**PLAN, "source_account_id_or_name": "Monzo Current", "use_detected_source": True}, texts=["Can you set up a plan"])
    assert ok["proposal"] is True


def test_naming_the_bank_later_makes_the_carried_pick_stated():
    _out, draft = call("preview_goal_schedule", {**PLAN, "source_account_id_or_name": "Monzo Current"}, texts=["set it up"])
    assert draft["source_basis"] == "model"
    out, _d = call("propose_create_scheduled_goal", {"step_unit": "day"}, draft, texts=["set it up", "My Monzo current account"])
    assert out["proposal"] is True and out["params"]["source_account_id"] == "cur"


def test_generic_words_are_not_evidence():
    from app.core.models import Account
    barclays = Account(id="bar", name="Premier Current Account", type="transaction", balance=1.0, provider="ob-barclays")
    assert pgs.stated_by_user(barclays, ["My Monzo current account"]) is False
    assert pgs.stated_by_user(barclays, ["my barclays one"]) is True
    assert pgs.stated_by_user(barclays, ["the premier"]) is True
    assert pgs.stated_by_user(barclays, None) is True  # no conversation given, nothing to second-guess


@pytest.mark.parametrize("basis,has_as_you_said", [
    ("stated", False), ("model", False), ("stored", False), ("recent-transfers", False), ("assumed", False)])
def test_as_you_said_never_appears(basis, has_as_you_said):
    sentence = pgs.source_sentence({"name": "Monzo", "basis": basis})
    assert ("as you said" in sentence) is has_as_you_said


# ── Step 5: convert, do not duplicate ────────────────────────────────────────

SET_ASIDE = {"id": "a1", "name": "Saving Challenge (2026)", "active": True, "fill_account_id": "pot",
             "source_account_id": "cur", "source_name": "Monzo Current Account", "amount_per_period": 23.0}


def test_preview_offers_the_conversion_and_reports_the_match(monkeypatch):
    monkeypatch.setattr(allocations_module, "list_allocations", sets([SET_ASIDE]))
    out, draft = call("preview_goal_schedule", {**PLAN, "name": "savings challenge"})
    assert out["existing_match"] == {"kind": "set_aside", "id": "a1", "name": "Saving Challenge (2026)",
                                     "amount_per_period": {"raw": 23.0, "formatted": "£23.00"}}
    assert out["summary"].endswith("You already have a set-aside called Saving Challenge (2026). I can convert it into this goal so it is not counted twice.")
    assert draft["convert_candidate"]["id"] == "a1"


def test_propose_waits_for_a_conversion_decision(monkeypatch):
    monkeypatch.setattr(allocations_module, "list_allocations", sets([SET_ASIDE]))
    _out, draft = call("preview_goal_schedule", {**PLAN, "source_account_id_or_name": "Monzo Current"})
    out, kept = call("propose_create_scheduled_goal", {"step_unit": "day"}, draft)
    assert out["needs"] == ["convert_decision"] and out["candidate"]["id"] == "a1" and "proposal" not in out
    assert kept["convert_candidate"]["id"] == "a1" and kept["start_date"] == "2026-10-30"
    # convert: the proposal carries the pause, the stated source is kept
    done, spent = call("propose_create_scheduled_goal", {"convert_from_set_aside": "Saving Challenge"}, kept)
    assert done["proposal"] is True and spent is None
    assert done["params"]["deactivate_allocation_id"] == "a1" and done["params"]["source_account_id"] == "cur"
    assert done["params"]["funding_pots"] == [{"account_id": "pot", "count_existing": False}]
    assert done["params"]["schedule"]["start_date"] == "2026-10-30"


def test_alongside_creates_without_a_pause_and_the_choice_sticks(monkeypatch):
    monkeypatch.setattr(allocations_module, "list_allocations", sets([SET_ASIDE]))
    _out, draft = call("preview_goal_schedule", {**PLAN, "source_account_id_or_name": "Monzo Current"})
    done, _spent = call("propose_create_scheduled_goal", {"create_alongside": True}, draft)
    assert done["proposal"] is True and "deactivate_allocation_id" not in done["params"]
    first, kept = call("propose_create_scheduled_goal", {"create_alongside": True, "source_account_id_or_name": "Barclays"}, draft)
    assert first.get("proposal") is not True and kept["create_alongside"] is True  # blocked on the account, decision kept


def test_an_existing_goal_with_the_name_is_offered_for_a_schedule_change(monkeypatch):
    async def goals(user):
        return {"items": [{"id": "g1", "name": "Saving Challenge", "schedule_label": "Equal amounts each pay period"}]}

    monkeypatch.setattr(commitments_module, "list_commitments", goals)
    out, _d = call("propose_create_scheduled_goal", {**PLAN, "source_account_id_or_name": "Monzo Current"})
    assert out["needs"] == ["convert_decision"] and out["candidate"]["kind"] == "goal"
    assert "I can change its schedule instead" in out["summary"]


def test_no_match_means_no_offer():
    out, draft = call("preview_goal_schedule", {**PLAN, "name": "Holiday"})
    assert "existing_match" not in out and "convert_candidate" not in draft
