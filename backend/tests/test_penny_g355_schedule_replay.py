"""G355: replay Kevin's UAT thread (Wed 28 Oct 2026, the savings challenge) through
the real `can_i` route, the real agent loop and the real tools with a scripted
model. Only the database loaders and the model are faked.

What went wrong on UAT, and what is asserted here:
  * "Friday" was answered by the model's own arithmetic and weekday (29 Oct is a
    Thursday): the amount, weekday and day number now come from the tool, and a
    wrong weekday beside a date in a reply is corrected.
  * "My Monzo current account" matched nothing and the failure listed raw holder
    names: the resolver now finds it by bank and kind, and lists safe labels only.
  * "Daily" reset the plan (start date and source changed, "Barclays" said "as you
    said"): the draft rides across turns, a one-word answer changes one field, and
    an account is only "stated" when the user said it.
  * The existing "Saving Challenge (2026)" set-aside was never offered for
    conversion: it is now.
"""
import asyncio
import json
from datetime import date
from types import SimpleNamespace

import pytest

import app.routers.accounts as accounts_module
import app.routers.allocations as allocations_module
import app.routers.can_i as can_i_module
import app.routers.commitments as commitments_module
import app.services.account_plan_sources as plan_sources
import app.services.companion as companion_module
import app.services.notifications as notifications_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module
from app.core import timeutil
from app.core.models import Account
from app.services import penny_conversations as svc
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_agent import _FakeResponse, _final_payload, _tool_call_payload
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)

UID = "kevin-g355"
USER = {"email": UID}
TODAY = date(2026, 10, 28)  # a Wednesday
NAME = "Saving Challenge (2026)"

ACCOUNTS = [
    Account(id="bar", name="Premier Current Account", type="transaction", subtype="TRANSACTION", balance=900.0, provider="ob-barclays"),
    Account(id="mon", name="Kevin Mbithi Maingi", type="transaction", subtype="TRANSACTION", balance=120.0, provider="monzo"),
    Account(id="pot", name=NAME, type="savings", subtype="SAVINGS_ACCOUNT", balance=10.0, provider="monzo"),
]
SET_ASIDE = {"id": "a1", "name": NAME, "active": True, "fill_account_id": "pot", "source_account_id": "mon",
             "source_name": "your Monzo account", "amount_per_period": 23.0}
PLAN = {"name": NAME, "start_amount": 11.48, "step_amount": 0.04, "step_unit": "day", "count": 79, "start_date": "2026-10-30"}


def run(coro):
    return asyncio.run(coro)


class Model:
    """Scripted model: each step is a response, or a function of the request payload
    returning one, so a reply can be built from what the tool really returned."""

    def __init__(self, script):
        self.script, self.calls = list(script), []

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        item = self.script[min(len(self.calls), len(self.script)) - 1]
        return item(json) if callable(item) else item


def last_tool(call: dict) -> dict:
    return json.loads(next(m for m in reversed(call["messages"]) if m["role"] == "tool")["content"])


def reply_from(build):
    """A final answer built from the tool result in the request."""
    return lambda call: _final_payload(build(last_tool(call)))


@pytest.fixture
def world(monkeypatch, cols):  # noqa: F811
    convs, _props = cols
    proposals = _FakeCol()

    async def allowance(uid):
        return None

    async def consented(query, proj=None):
        return {"penny_agent_consent": True}

    async def accounts(user):
        return list(ACCOUNTS)

    async def tokens(uid):
        return ["kevin", "mbithi", "maingi"]

    async def cfg(_uid):
        return {"type": "monthly_pay_date", "day": 30}  # the live period runs 30 Sep to Thu 29 Oct

    async def owned(_uid):
        return {
            "bar": {"name": "Premier Current Account", "provider": "ob-barclays", "type": "BANK", "account_subtype": "TRANSACTION"},
            "mon": {"name": "Kevin Mbithi Maingi", "provider": "monzo", "type": "BANK", "account_subtype": "TRANSACTION"},
            "pot": {"name": NAME, "provider": "monzo", "type": "BANK", "account_subtype": "SAVINGS_ACCOUNT"},
        }

    async def infer(_uid, wanted, _map, **_kw):
        return {}

    async def set_asides(user):
        return {"items": [SET_ASIDE]}

    async def no_goals(user):
        return {"items": []}

    monkeypatch.setattr(timeutil, "user_today", lambda: TODAY)
    monkeypatch.setattr(can_i_module, "penny_allowance", allowance)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", consented)
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(penny_tools_module, "preferences_col", _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}]))
    monkeypatch.setattr(accounts_module, "get_accounts", accounts)
    monkeypatch.setattr(notifications_module, "_user_name_tokens", tokens)
    monkeypatch.setattr(commitments_module, "_pay_cfg", cfg)
    monkeypatch.setattr(commitments_module, "list_commitments", no_goals)
    monkeypatch.setattr(allocations_module, "list_allocations", set_asides)
    monkeypatch.setattr(plan_sources, "owned_account_map", owned)
    monkeypatch.setattr(companion_module, "infer_plan_sources_batch", infer)
    return SimpleNamespace(cid=run(svc.create_conversation(UID))["id"], convs=convs, models=[], history=[])


def ask(world, monkeypatch, question, script):
    model = Model(script)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", model)
    world.models.append(model)
    body = {"question": question, "conversation_id": world.cid, "history": list(world.history[-6:])}
    out = run(can_i_module.can_i(body, USER))
    world.history += [{"role": "user", "content": question}, {"role": "assistant", "content": out.get("reply") or out.get("headline") or ""}]
    return out


def stored(world) -> list[dict]:
    return [t for t in world.convs.docs[0]["turns"] if t["role"] == "assistant"]


def draft_of(world) -> dict | None:
    return (stored(world)[-1].get("last_result") or {}).get("draft")


def tool_result(world, turn_index=-1) -> dict:
    return last_tool(world.models[turn_index].calls[-1])


def propose_call(**args):
    return _tool_call_payload("propose_create_scheduled_goal", args)


# ── The thread ───────────────────────────────────────────────────────────────

def test_the_friday_question_gets_the_servers_amount_weekday_and_day_number(world, monkeypatch):
    def reply(t):
        on = t["on_date"]
        return ("HEADLINE: Friday's amount\nREPLY: Your current pay period runs until 29 Oct (Friday). "
                f"The first transaction on {on['label']} is {on['amount']['formatted']}, day {on['day_number']} of {on['of_total']}, "
                f"and {on['days_left']} days are left from there.")

    out = ask(world, monkeypatch, "Okay so that 11.40 will increase by 4p, so on Friday the first transaction will be how much", [
        _tool_call_payload("preview_goal_schedule", {**PLAN, "ask_date": "Friday"}),
        reply_from(reply),
    ])
    t = tool_result(world)
    assert t["on_date"]["date"] == "2026-10-30" and t["on_date"]["weekday"] == "Friday"
    assert t["on_date"]["amount"] == {"raw": 11.48, "formatted": "£11.48"} and t["on_date"]["day_number"] == 1
    assert t["on_date"]["days_left"] == 79 and t["on_date"]["of_total"] == 79  # Kevin's day 287 to 365
    assert t["today"] == {"date": "2026-10-28", "weekday": "Wednesday", "label": "Wed 28 Oct 2026"}
    assert t["current_period"]["end"] == "2026-10-29" and t["current_period"]["weekday_end"] == "Thursday"
    assert "£11.48" in out["reply"] and "Fri 30 Oct 2026" in out["reply"] and "day 1 of 79" in out["reply"]
    assert "29 Oct (Thursday)" in out["reply"] and "(Friday)" not in out["reply"]  # the weekday guard
    prompt = json.dumps(world.models[0].calls[0]["messages"][0])
    assert "Never do date, weekday or amount arithmetic yourself" in prompt


def test_the_whole_thread_with_a_monzo_conversion(world, monkeypatch):
    # (2) the plan: the preview holds the draft and offers the conversion
    first = ask(world, monkeypatch, "so Friday will be day 287 out of 365 so the money will increase by 4p from day 287 to 365, do the arithmetic and create a plan for this", [
        _tool_call_payload("preview_goal_schedule", {**PLAN, "funding_pot": NAME}),
        reply_from(lambda t: f"HEADLINE: The plan\nREPLY: {t['summary']} Which account should the money leave from?"),
    ])
    t = tool_result(world)
    assert t["total"] == {"raw": 1030.16, "formatted": "£1,030.16"}
    assert "from Fri 30 Oct 2026 for 79 days" in t["summary"] and "finishing Sat 16 Jan 2027" in t["summary"]
    assert "Nothing is due this pay period, because it starts on Fri 30 Oct 2026" in t["summary"]
    assert t["next_periods"][0]["start"] == "2026-10-30" and t["next_periods"][0]["start_weekday"] == "Friday"
    assert t["existing_match"]["id"] == "a1" and "I can convert it into this goal so it is not counted twice." in t["summary"]
    assert "source_account" in t["needs"]
    d = draft_of(world)
    assert (d["start_date"], d["count"], d["start_pence"], d["step_pence"], d["step_unit"]) == ("2026-10-30", 79, 1148, 4, "day")
    assert d["name"] == NAME and d["into_id"] == "pot" and d["convert_candidate"]["id"] == "a1" and "source_account_id" not in d
    assert "Which account should the money leave from?" in first["reply"]

    # (3) "My Monzo current account": the model passes the user's words; the resolver finds the Monzo current account
    second = ask(world, monkeypatch, "My Monzo current account", [
        propose_call(source_account_id_or_name="My Monzo current account"),
        reply_from(lambda t: "HEADLINE: Convert it?\nREPLY: You already have a set-aside called Saving Challenge (2026). Should I convert it into this goal?"),
    ])
    t = tool_result(world)
    assert t["needs"] == ["convert_decision"] and t["candidate"]["id"] == "a1"
    assert "DRAFT goal: £11.48 a day, rising by 4p a day, from Fri 30 Oct 2026 for 79 days" in json.dumps(world.models[1].calls[0]["messages"][0], ensure_ascii=False)
    d = draft_of(world)
    assert d["source_account_id"] == "mon" and d["source_basis"] == "stated" and d["start_date"] == "2026-10-30"
    assert "Maingi" not in second["reply"]

    # (4) "Daily": only the unit changes; the plan is the agreed one, and the conversion still waits
    third = ask(world, monkeypatch, "Daily", [
        propose_call(step_unit="day", use_detected_source=False),
        reply_from(lambda t: "HEADLINE: Convert it?\nREPLY: Should I convert the existing Saving Challenge (2026) set-aside into this goal?"),
    ])
    t = tool_result(world)
    assert t["needs"] == ["convert_decision"] and "proposal" not in third
    d = draft_of(world)
    assert (d["start_date"], d["count"], d["source_account_id"]) == ("2026-10-30", 79, "mon")

    # (5) "Convert it": the card is the last agreed draft, with the pause
    final = ask(world, monkeypatch, "Yes, convert it", [
        propose_call(convert_from_set_aside=NAME),
    ])
    proposal = final["proposal"]
    params = proposal["params"]
    assert params["schedule"] == {"type": "arithmetic", "start_pence": 1148, "step_pence": 4, "step_unit": "day",
                                  "start_date": "2026-10-30", "count": 79, "end_date": None}
    assert params["source_account_id"] == "mon" and params["name"] == NAME
    assert params["schedule_preview"]["start_date"] == "2026-10-30" and params["schedule_preview"]["end_date"] == "2027-01-16"
    assert params["deactivate_allocation_id"] == "a1" and params["funding_pots"] == [{"account_id": "pot", "count_existing": False}]
    assert "your Monzo account" in proposal["summary"] and "Maingi" not in json.dumps(proposal) and "as you said" not in json.dumps(proposal)
    # the draft is spent: the proposal turn leaves a tombstone, not the old draft
    assert draft_of(world) is None and stored(world)[-1]["last_result"]["kind"] == "goal_draft"
    assert svc.clean_turn("assistant", "x", last_result=stored(world)[-1]["last_result"]) is not None


def test_ambiguous_and_unknown_accounts_never_list_a_holder_name(world, monkeypatch):
    ask(world, monkeypatch, "so Friday will be day 287 out of 365, make a plan", [
        _tool_call_payload("preview_goal_schedule", {**PLAN, "funding_pot": NAME}),
        reply_from(lambda t: "HEADLINE: The plan\nREPLY: Which account should the money leave from?"),
    ])
    ask(world, monkeypatch, "Monzo", [
        propose_call(source_account_id_or_name="Monzo"),
        reply_from(lambda t: "HEADLINE: Which one\nREPLY: Do you mean " + " or ".join(m["name"] for m in t["matches"]) + "?"),
    ])
    t = tool_result(world)
    names = [m["name"] for m in t["matches"]]
    assert "your Monzo account, current" in names and any("Saving Challenge (2026), savings" in n for n in names)
    asked = ask(world, monkeypatch, "Nationwide", [
        propose_call(source_account_id_or_name="Nationwide flex"),
        reply_from(lambda t: "HEADLINE: Not found\nREPLY: I could not match that. Your accounts are " + "; ".join(t["available"]) + "."),
    ])
    t = tool_result(world)
    assert "Barclays Premier Current Account, current" in t["available"] and "your Monzo account, current" in t["available"]
    everything = json.dumps(t) + json.dumps(tool_result(world, 1)) + asked["reply"]
    assert "Maingi" not in everything and "Mbithi" not in everything and "Kevin" not in everything


def test_an_account_the_user_never_named_is_not_attributed_to_them(world, monkeypatch):
    ask(world, monkeypatch, "so Friday will be day 287 out of 365, make a plan", [
        _tool_call_payload("preview_goal_schedule", {**PLAN, "funding_pot": NAME}),
        reply_from(lambda t: "HEADLINE: The plan\nREPLY: Which account should the money leave from?"),
    ])
    # The model picks Barclays on its own, with the user's words never naming it.
    out = ask(world, monkeypatch, "Daily", [
        _tool_call_payload("preview_goal_schedule", {"step_unit": "day", "source_account_id_or_name": "Barclays Premier"}),
        reply_from(lambda t: f"HEADLINE: Source\nREPLY: {t['source_sentence']}"),
    ])
    t = tool_result(world)
    assert t["source_basis"] == "model" and "as you said" not in t["source_sentence"] and "as you said" not in out["reply"]
    assert t["source_sentence"].startswith("I have picked Barclays Premier Current Account as the account the money leaves from, please check it.")
    assert t["start_label"] == "Fri 30 Oct 2026" and t["total"]["formatted"] == "£1,030.16"  # "Daily" did not reset the plan
    assert draft_of(world)["source_basis"] == "model"
    # Proposing on that pick without the user's say-so needs the account, and creates nothing.
    again = ask(world, monkeypatch, "Convert it", [
        propose_call(convert_from_set_aside=NAME, source_account_id_or_name="Barclays Premier"),
        reply_from(lambda t: "HEADLINE: Which account\nREPLY: Which account should the money leave from?"),
    ])
    t = tool_result(world)
    assert t["needs"] == ["source_account"] and t["suggested_source"]["basis"] == "model" and "proposal" not in again
    # Now the user names the bank: stated, and the proposal is made.
    done = ask(world, monkeypatch, "My Monzo current account", [
        propose_call(source_account_id_or_name="My Monzo current account"),
    ])
    assert done["proposal"]["params"]["source_account_id"] == "mon" and done["proposal"]["params"]["deactivate_allocation_id"] == "a1"


def test_a_model_cannot_supply_its_own_draft_or_evidence(world, monkeypatch):
    out = ask(world, monkeypatch, "Daily", [
        _tool_call_payload("preview_goal_schedule", {
            **PLAN, "source_account_id_or_name": "Barclays Premier",
            "_draft": {"name": NAME, "start_pence": 1, "count": 5}, "_user_texts": ["barclays premier"]}),
        reply_from(lambda t: f"HEADLINE: Source\nREPLY: {t['source_sentence']}"),
    ])
    t = tool_result(world)
    assert t["source_basis"] == "model" and t["total"]["formatted"] == "£1,030.16"
    assert "as you said" not in out["reply"]


def test_a_different_goal_starts_fresh(world, monkeypatch):
    ask(world, monkeypatch, "make a plan", [
        _tool_call_payload("preview_goal_schedule", {**PLAN, "funding_pot": NAME}),
        reply_from(lambda t: "HEADLINE: The plan\nREPLY: ok"),
    ])
    assert draft_of(world)["start_date"] == "2026-10-30"
    ask(world, monkeypatch, "Actually a holiday fund, £50 a month for 6 months", [
        _tool_call_payload("preview_goal_schedule", {"name": "Holiday", "description": "£50 a month for 6 months"}),
        reply_from(lambda t: f"HEADLINE: Holiday\nREPLY: {t['summary']}"),
    ])
    d = draft_of(world)
    assert d["name"] == "Holiday" and d["start_date"] == "2026-10-28" and d["start_pence"] == 5000 and "into_id" not in d
    assert "existing_match" not in tool_result(world)


# ── G356: Kevin's 28 Oct 2026 17:30 thread ───────────────────────────────────

KEVIN_1730 = ("Okay I want to set up a plan to contribute to my savings challenge, the first day will be on Friday the next "
              "period, a figure of 11.48 and will increase by 4p everyday, I will be on day 287/365 on Friday so come up with "
              "a plan for contributions I will need to make until day 365")


@pytest.fixture
def world3(world, monkeypatch):
    """Three Monzo accounts (the holder-named current account, the challenge pot and a
    holiday pot) and no existing set-aside, as in the 17:30 thread."""
    accs = [*ACCOUNTS, Account(id="hol", name="Holiday", type="savings", subtype="SAVINGS_ACCOUNT", balance=5.0, provider="monzo")]

    async def accounts(user):
        return list(accs)

    async def none(user):
        return {"items": []}

    async def last_friday(_uid):
        return {"type": "last_friday"}  # Kevin's real periods: the live one ends Thu 29 Oct

    monkeypatch.setattr(accounts_module, "get_accounts", accounts)
    monkeypatch.setattr(allocations_module, "list_allocations", none)
    monkeypatch.setattr(commitments_module, "_pay_cfg", last_friday)
    return world


def _first_turn(world, monkeypatch):
    return ask(world, monkeypatch, KEVIN_1730, [
        _tool_call_payload("preview_goal_schedule", {"description": KEVIN_1730, "funding_pot": NAME, "name": "Savings challenge"}),
        reply_from(lambda t: f"HEADLINE: Your plan\nREPLY: Perfect. Your plan is set up: {t['summary']} Which account should this money leave from?"),
    ])


def test_1730_turn_one_counts_days_and_does_not_claim_the_plan_is_set_up(world3, monkeypatch):
    out = _first_turn(world3, monkeypatch)
    t = tool_result(world3)
    assert t["start_date"] == "2026-10-30" and t["end_date"] == "2027-01-16" and t["periods_count"] is not None
    assert t["schedule"]["count"] == 79 and t["total"]["formatted"] == "£1,030.16"
    assert t["summary"].startswith("Here is the plan")
    assert "I have counted from your day 287, so day 365 is Sat 16 Jan 2027." in t["assumptions"]
    assert [p["amount"]["formatted"] for p in t["next_periods"]][:3] == ["£336.56", "£367.92", "£325.68"]
    assert "is ready to confirm" in out["reply"] and "is set up" not in out["reply"] and not out["reply"].startswith("Perfect")
    d = draft_of(world3)
    assert d["count"] == 79 and "end_date" not in d
    assert d["day_number"] == 287 and d["last_day"] == 365 and d["start_date"] == "2026-10-30"


def test_1730_stated_source_is_settled_and_the_card_matches_the_draft(world3, monkeypatch):
    _first_turn(world3, monkeypatch)
    second = ask(world3, monkeypatch, "It will leave from my Monzo current account", [
        _tool_call_payload("preview_goal_schedule", {"source_account_id_or_name": "It will leave from my Monzo current account"}),
        reply_from(lambda t: f"HEADLINE: Source\nREPLY: {t['source_sentence']}"),
    ])
    t = tool_result(world3)
    assert t["source"]["account_id"] == "mon" and t["source"]["confirmed"] is True and t["source_basis"] == "stated"
    assert t["source_sentence"].startswith("The money leaves from ") and t["source_sentence"].endswith(".")
    assert "?" not in second["reply"] and "source_account" not in t.get("needs", [])
    assert "source_candidates" not in draft_of(world3)
    final = ask(world3, monkeypatch, "Yes please", [propose_call(name="Savings challenge")])
    params = final["proposal"]["params"]
    assert params["source_account_id"] == "mon"
    assert params["schedule"] == {"type": "arithmetic", "start_pence": 1148, "step_pence": 4, "step_unit": "day",
                                  "start_date": "2026-10-30", "count": 79, "end_date": None}
    assert params["schedule_preview"]["start_date"] == "2026-10-30" and params["schedule_preview"]["end_date"] == "2027-01-16"


def test_1730_monzo_alone_is_ambiguous_then_the_current_account_resolves_within_it(world3, monkeypatch):
    _first_turn(world3, monkeypatch)
    ask(world3, monkeypatch, "Monzo", [
        _tool_call_payload("preview_goal_schedule", {"source_account_id_or_name": "Monzo"}),
        reply_from(lambda t: "HEADLINE: Which one\nREPLY: Do you mean " + " or ".join(m["name"] for m in t["source_problem"]["matches"]) + "?"),
    ])
    t = tool_result(world3)
    assert t["source_problem"]["ambiguous"] is True and len(t["source_problem"]["matches"]) == 3
    assert sorted(draft_of(world3)["source_candidates"]) == ["hol", "mon", "pot"]
    ask(world3, monkeypatch, "The current account", [
        _tool_call_payload("preview_goal_schedule", {"source_account_id_or_name": "The current account"}),
        reply_from(lambda t: f"HEADLINE: Source\nREPLY: {t['source_sentence']}"),
    ])
    t = tool_result(world3)
    assert t["source"]["account_id"] == "mon" and t["source"]["confirmed"] is True
    d = draft_of(world3)
    assert d["source_account_id"] == "mon" and "source_candidates" not in d
    assert (d["start_date"], d["count"]) == ("2026-10-30", 79)
