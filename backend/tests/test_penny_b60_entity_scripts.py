"""B60 step 6: per-entity replay scripts, through the real can_i route.

Each script drives one entity the way Kevin's rule says it must work: find or
view it with the read tool (the focus is stored where the tool produces one),
propose a change (a card with before and after), confirm it through the real
execute endpoint with consent on, verify the read tool now shows the new value,
then undo by re-editing (a second proposal back to the original, executed).
The scripted model and the database loaders are faked; the propose tools, the
resolvers, the focus, the proposal store, the execute dispatch and the consent
gate are real. Write routers are replaced by small state mutators, the same
pattern the dispatch tests in test_penny_proposals_twins.py use, except for the
safety buffer and the card APR, which run the real routers over fake collections.

Entities: goal, set-aside, safety buffer, card APR, offline account, account rule,
prediction (edit_occurrence), connect bank (record-only), plus a consent-off script.
"""
import asyncio
import json
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest

import app.routers.accounts as accounts_module
import app.routers.allocations as allocations_module
import app.routers.analytics as analytics_module
import app.routers.can_i as can_i_module
import app.routers.card_terms as card_terms_module
import app.routers.commitments as commitments_module
import app.routers.finexer as finexer_module
import app.routers.manual_accounts as manual_accounts_module
import app.routers.savings as savings_module
import app.services.notifications as notifications_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_set_asides as penny_set_asides
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services import penny_conversations as svc
from tests.penny_proposal_fakes import FakeCollection as _FakeCol
from tests.test_penny_agent import _ScriptedAsyncClient, _final_payload, _tool_call_payload
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)
from tests.test_penny_proposals_twins import _alloc_item

UID = "kevin-b60"
USER = {"email": UID}


def run(coro):
    return asyncio.run(coro)


@pytest.fixture
def world(monkeypatch, cols):  # noqa: F811
    convs, _props = cols
    proposals = _FakeCol()
    prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": "x"}])

    async def allowance(uid):
        return None

    async def consented(query, proj=None):
        return {"penny_agent_consent": True}

    monkeypatch.setattr(can_i_module, "penny_allowance", allowance)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", consented)
    for module in (penny_tools_module, can_i_module):
        monkeypatch.setattr(module, "penny_proposals_col", proposals)
        monkeypatch.setattr(module, "preferences_col", prefs)

    async def no_sync(uid):
        return None
    monkeypatch.setattr(penny_tools_module, "last_bank_sync", no_sync)
    return SimpleNamespace(cid=run(svc.create_conversation(UID))["id"], convs=convs, clients=[], proposals=proposals, prefs=prefs)


def ask(world, monkeypatch, question, script):
    client = _ScriptedAsyncClient(script)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    world.clients.append(client)
    return run(can_i_module.can_i({"question": question, "conversation_id": world.cid, "history": []}, USER))


def tool_result(world) -> dict:
    """The newest tool message the scripted model was shown."""
    messages = world.clients[-1].calls[1]["messages"]
    return json.loads(next(m for m in reversed(messages) if m["role"] == "tool")["content"])


def view(world, monkeypatch, question, tool, args=None):
    ask(world, monkeypatch, question, [
        _tool_call_payload(tool, args or {}),
        _final_payload("HEADLINE: Here it is\nREPLY: That is what I can see."),
    ])
    return tool_result(world)


def propose(world, monkeypatch, question, tool, args):
    res = ask(world, monkeypatch, question, [_tool_call_payload(tool, args)])
    assert "proposal" in res, res
    return res["proposal"]


def confirm(proposal) -> dict:
    return run(can_i_module.execute_proposal(proposal["proposal_id"], user=USER))


def focus_of(world) -> dict | None:
    turns = [t for t in world.convs.docs[0]["turns"] if t["role"] == "assistant"]
    return turns[-1].get("last_result")


def walk(world, monkeypatch, *, find, forward, verify_forward, back, verify_back, focus=None):
    """find / forward / back are (question, tool, args[, expected before, after]) tuples."""
    if find:
        found = view(world, monkeypatch, *find)
        if focus:
            stored = focus_of(world)
            assert stored and stored["kind"] == focus[0] and stored["ids"] == focus[1]
        yield "found", found
    question, tool, args, before, after = forward
    first = propose(world, monkeypatch, question, tool, args)
    assert (first["before"], first["after"]) == (before, after)
    assert first["summary"]
    assert not first.get("destructive")
    done = confirm(first)
    assert done["executed"] is True
    yield "confirmed", done
    yield "verified", verify_forward(view(world, monkeypatch, *verify_forward.read))
    question, tool, args, before, after = back
    second = propose(world, monkeypatch, question, tool, args)
    assert (second["before"], second["after"]) == (before, after)
    assert second["proposal_id"] != first["proposal_id"]
    assert confirm(second)["executed"] is True
    yield "undone", verify_back(view(world, monkeypatch, *verify_back.read))


def _verifier(read, check):
    def verify(result):
        check(result)
        return result
    verify.read = read
    return verify


def _drive(gen):
    return {step: value for step, value in gen}


# ── goal (commitment) ───────────────────────────────────────────────────────

def test_goal_script(monkeypatch, world):
    state = {"amount": 2000.0}
    target = (date.today() + timedelta(days=200)).isoformat()

    async def fake_list(user):
        return {"items": [{"id": "c1", "name": "Japan trip", "amount": state["amount"], "target_date": target,
                           "status": "active", "progress": 500.0}]}

    async def fake_update(commitment_id, body, user):
        state["amount"] = body["amount"]
        return {"id": commitment_id, "amount": state["amount"]}

    monkeypatch.setattr(commitments_module, "list_commitments", fake_list)
    monkeypatch.setattr(commitments_module, "update_commitment", fake_update)
    steps = _drive(walk(
        world, monkeypatch,
        find=("How is my Japan goal doing", "get_goals"),
        focus=("commitment", ["Japan trip"]),
        forward=("Make the Japan trip goal 2500", "propose_update_commitment",
                 {"commitment_ref": "Japan trip", "amount": 2500}, "£2,000.00", "£2,500.00"),
        verify_forward=_verifier(("What is my Japan goal now", "get_goals"),
                                 lambda r: r["goals"][0]["amount"]["raw"] == 2500.0 or pytest.fail(r)),
        back=("Put the Japan goal back to 2000", "propose_update_commitment",
              {"commitment_ref": "Japan trip", "amount": 2000}, "£2,500.00", "£2,000.00"),
        verify_back=_verifier(("And now", "get_goals"), lambda r: r["goals"][0]["amount"]["raw"] == 2000.0 or pytest.fail(r)),
    ))
    assert steps["found"]["goals"][0]["name"] == "Japan trip" and state["amount"] == 2000.0


# ── set-aside (allocation) ──────────────────────────────────────────────────

def test_set_aside_script(monkeypatch, world):
    state = {"amount": 120.0}

    async def fake_list(user):
        return {"items": [_alloc_item(id_="a2", name="Holiday", amount_per_period=state["amount"])]}

    async def fake_update(allocation_id, body, user):
        state["amount"] = body["amount_per_period"]
        return {"id": allocation_id}

    async def fake_accounts(user):
        return [SimpleNamespace(id="acc1", name="HSBC Savings")]

    async def fake_cfg(uid):
        return {}

    async def no_conflict(*a, **k):
        return False

    monkeypatch.setattr(allocations_module, "list_allocations", fake_list)
    monkeypatch.setattr(allocations_module, "update_allocation", fake_update)
    monkeypatch.setattr(allocations_module, "_pay_cfg", fake_cfg)
    monkeypatch.setattr(allocations_module, "_conflicts", no_conflict)
    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(penny_set_asides, "get_pay_period_for_date", lambda today, cfg: (date(2026, 9, 25), date(2026, 10, 29)))
    monkeypatch.setattr(penny_set_asides.timeutil, "user_today", lambda: date(2026, 10, 25))
    steps = _drive(walk(
        world, monkeypatch,
        find=("What are my set asides", "get_set_asides"),
        focus=("allocation", ["a2"]),
        forward=("Make that pot 150", "propose_update_allocation", {"amount_per_period": 150},
                 "£120.00 per period", "£150.00 per period"),
        verify_forward=_verifier(("What are my set asides now", "get_set_asides"),
                                 lambda r: r["set_asides"][0]["target"]["formatted"] == "£150.00" or pytest.fail(r)),
        back=("Change it back to 120", "propose_update_allocation", {"allocation_ref": "Holiday", "amount_per_period": 120},
              "£150.00 per period", "£120.00 per period"),
        verify_back=_verifier(("And now", "get_set_asides"),
                              lambda r: r["set_asides"][0]["target"]["formatted"] == "£120.00" or pytest.fail(r)),
    ))
    assert steps["found"]["set_asides"][0]["name"] == "Holiday" and state["amount"] == 120.0


# ── safety buffer ───────────────────────────────────────────────────────────

def test_safety_buffer_script(monkeypatch, world):
    goals = _FakeCol([{"_id": UID, "user_id": UID, "target_type": "months", "target_months": 3, "account_ids": ["a1"]}])

    async def cashflow(uid, cutoff):
        return 3000.0, 2000.0, 100.0

    async def insights(user):
        return {"configured": True}

    async def bank(uid):
        return [{"_id": "a1", "name": "Marcus Savings", "provider": "marcus"}]

    async def manual(uid):
        return []

    async def current(uid, goal):
        return 1500.0

    async def sts(uid):
        return {"status": "insufficient_data"}

    async def tokens(uid):
        return []

    monkeypatch.setattr(savings_module, "savings_goals_col", goals)
    monkeypatch.setattr(savings_module, "_cashflow", cashflow)
    monkeypatch.setattr(savings_module, "savings_insights", insights)
    monkeypatch.setattr(savings_module, "_bank_accounts", bank)
    monkeypatch.setattr(savings_module, "_manual_accounts", manual)
    monkeypatch.setattr(notifications_module, "_user_name_tokens", tokens)
    monkeypatch.setattr(penny_tools_module, "savings_goals_col", goals)
    monkeypatch.setattr(penny_tools_module, "_cashflow", cashflow)
    monkeypatch.setattr(penny_tools_module, "_current_savings", current)
    monkeypatch.setattr(penny_tools_module, "compute_safe_to_spend", sts)
    steps = _drive(walk(
        world, monkeypatch,
        find=("What's my safety buffer", "get_savings_position"),
        forward=("Change my buffer to 6 months", "propose_set_savings_goal", {"target_type": "months", "target_months": 6},
                 "3 months of spending (about £6,000)", "6 months of spending (about £12,000)"),
        verify_forward=_verifier(("What's my safety buffer now", "get_savings_position"),
                                 lambda r: (r["target_months"], r["target_type"]) == (6, "months") or pytest.fail(r)),
        back=("Put it back to 3 months", "propose_set_savings_goal", {"target_type": "months", "target_months": 3},
              "6 months of spending (about £12,000)", "3 months of spending (about £6,000)"),
        verify_back=_verifier(("And now", "get_savings_position"), lambda r: r["target_months"] == 3 or pytest.fail(r)),
    ))
    assert steps["found"]["target_months"] == 3 and steps["found"]["account_names"] == ["Marcus Savings"]
    assert goals.docs[0]["target_months"] == 3 and goals.docs[0]["account_ids"] == ["a1"], "the accounts survive both edits"


# ── card APR ────────────────────────────────────────────────────────────────

def test_card_apr_script(monkeypatch, world):
    card = Account(id="c1", name="Green Amex", type="credit_card", subtype="CREDIT_CARD", balance=-500.0, provider="NatWest")
    terms = _FakeCol([{
        "_id": f"{UID}:c1", "user_id": UID, "account_id": "c1", "apr_pct": 21.9, "promos": [], "bt_offers": [],
        "status": "confirmed", "confirmed_at": datetime.now(), "usage": "carry",
    }])

    async def fake_accounts(user):
        return [card]

    async def fake_plan(uid):
        apr = terms.docs[0]["apr_pct"]
        return {"status": "ok", "totals": {"debt": 500.0}, "cards": [{
            "name": "Green Amex", "debt": 500.0, "rate_schedule": [{"from": None, "until": None, "apr_pct": apr, "source": "user", "kind": "standard"}],
        }]}

    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(card_terms_module, "accounts_col", _FakeCol([
        {"_id": "c1", "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": "Green Amex"}]))
    monkeypatch.setattr(card_terms_module, "card_terms_col", terms)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", terms)
    monkeypatch.setattr(penny_tools_module, "get_debt_plan_cached", fake_plan)

    def apr(result):
        return result["cards"][0]["rate_schedule"][0]["apr_pct"]
    steps = _drive(walk(
        world, monkeypatch,
        find=("What APR is on my Green Amex", "get_debt_position"),
        forward=("Set my Green Amex APR to 24.9%", "propose_set_card_apr", {"card_ref": "Green Amex", "apr_pct": 24.9},
                 "21.9%", "24.9%"),
        verify_forward=_verifier(("What APR is my Green Amex now", "get_debt_position"), lambda r: apr(r) == 24.9 or pytest.fail(r)),
        back=("Put it back to 21.9%", "propose_set_card_apr", {"card_ref": "Green Amex", "apr_pct": 21.9}, "24.9%", "21.9%"),
        verify_back=_verifier(("And now", "get_debt_position"), lambda r: apr(r) == 21.9 or pytest.fail(r)),
    ))
    assert apr(steps["found"]) == 21.9 and terms.docs[0]["usage"] == "carry", "a card APR edit keeps the rest of the terms"


# ── offline account ─────────────────────────────────────────────────────────

def test_offline_account_script(monkeypatch, world):
    accounts = _FakeCol([{"_id": "m1", "user_id": UID, "name": "Cash ISA", "account_type": "savings", "balance": 1000.0}])

    async def fake_accounts(user):
        doc = accounts.docs[0]
        return [Account(id="m1", name=doc["name"], type="savings", subtype="savings", balance=doc["balance"],
                        provider="Offline", manual=True)]

    async def fake_update(acc_id, body, user):
        accounts.docs[0].update({k: v for k, v in body.items()})
        return {"id": acc_id}

    monkeypatch.setattr(accounts_module, "get_accounts", fake_accounts)
    monkeypatch.setattr(penny_tools_module, "manual_accounts_col", accounts)
    monkeypatch.setattr(manual_accounts_module, "update_manual_account", fake_update)

    def balance(result):
        return result["accounts"][0]["balance"]["raw"]
    steps = _drive(walk(
        world, monkeypatch,
        find=("How much is in my Cash ISA", "get_accounts"),
        focus=("account", ["m1"]),
        forward=("Update my Cash ISA to 1500", "propose_update_offline_account", {"account_ref": "Cash ISA", "balance": 1500},
                 "£1,000.00", "£1,500.00"),
        verify_forward=_verifier(("What is in it now", "get_accounts"), lambda r: balance(r) == 1500.0 or pytest.fail(r)),
        back=("Actually put it back to 1000", "propose_update_offline_account", {"account_ref": "Cash ISA", "balance": 1000},
              "£1,500.00", "£1,000.00"),
        verify_back=_verifier(("And now", "get_accounts"), lambda r: balance(r) == 1000.0 or pytest.fail(r)),
    ))
    assert steps["found"]["accounts"][0]["kind"] == "Offline"


# ── account rule ────────────────────────────────────────────────────────────

def test_account_rule_script(monkeypatch, world):
    # No read tool lists mirror rules (a gap recorded in docs/penny/action-inventory.md), so
    # the find step is the resolver reading the rule by name and verify reads the stored rule.
    rules = _FakeCol([{"_id": "r1", "user_id": UID, "name": "Salary mirror", "match_type": "description_contains",
                       "match_value": "ACME", "sign": "credit", "active": True, "target_account_id": "m1"}])

    async def fake_update(rule_id, body, user):
        rules.docs[0].update(body)
        return {"id": rule_id}

    monkeypatch.setattr(penny_tools_module, "manual_account_rules_col", rules)
    monkeypatch.setattr(manual_accounts_module, "update_rule", fake_update)
    first = propose(world, monkeypatch, "Pause my Salary mirror rule", "propose_update_account_rule",
                    {"rule_ref": "Salary mirror", "active": False})
    assert (first["before"], first["after"], first["entity"]) == ("Active", "Paused", "Salary mirror")
    assert confirm(first)["executed"] is True and rules.docs[0]["active"] is False
    second = propose(world, monkeypatch, "Turn it back on", "propose_update_account_rule",
                     {"rule_ref": "Salary mirror", "active": True})
    assert (second["before"], second["after"]) == ("Paused", "Active")
    assert confirm(second)["executed"] is True and rules.docs[0]["active"] is True


# ── prediction (upcoming bill occurrence) ───────────────────────────────────

def test_prediction_script(monkeypatch, world):
    state = {"amount": 320.0}

    async def upcoming(uid):
        return {"upcoming_bills": [{"name": "Car insurance", "date": "2026-10-14",
                                    "amount": penny_tools_module._money(state["amount"], 2)}]}

    async def recurring(uid):
        return {"series": [{"name": "Car insurance"}]}

    async def detail(uid, key, date_str):
        return {"amount": state["amount"]}

    async def fake_edit(body, user):
        state["amount"] = body["new_amount"]
        return {"ok": True}

    monkeypatch.setattr(penny_tools_module, "_exec_get_upcoming_bills", upcoming)
    monkeypatch.setattr(penny_tools_module, "_exec_get_recurring_payments", recurring)
    monkeypatch.setattr(penny_tools_module, "_find_occurrence_detail", detail)
    monkeypatch.setattr(analytics_module, "edit_upcoming", fake_edit)
    steps = _drive(walk(
        world, monkeypatch,
        find=("What bills are coming up", "get_upcoming_bills"),
        focus=("occurrence", ["Car insurance"]),
        forward=("Change the car insurance on 14 Oct to 350", "propose_edit_occurrence",
                 {"key_or_name": "Car insurance", "date": "2026-10-14", "new_amount": 350, "scope": "one"},
                 "£320.00", "£350.00"),
        verify_forward=_verifier(("What bills are coming up now", "get_upcoming_bills"),
                                 lambda r: r["upcoming_bills"][0]["amount"]["raw"] == 350.0 or pytest.fail(r)),
        back=("Put it back to 320", "propose_edit_occurrence",
              {"key_or_name": "Car insurance", "date": "2026-10-14", "new_amount": 320, "scope": "one"},
              "£350.00", "£320.00"),
        verify_back=_verifier(("And now", "get_upcoming_bills"),
                              lambda r: r["upcoming_bills"][0]["amount"]["raw"] == 320.0 or pytest.fail(r)),
    ))
    assert steps["found"]["upcoming_bills"][0]["name"] == "Car insurance" and state["amount"] == 320.0


# ── connect a bank: record-only ─────────────────────────────────────────────

def test_connect_bank_script_records_only(monkeypatch, world):
    calls = []

    async def link_must_not_run(*a, **k):
        calls.append("finexer_link")
        raise AssertionError("Penny must never start a Finexer connection")

    monkeypatch.setattr(finexer_module, "finexer_link", link_must_not_run)
    # The execute endpoint's own authorisation CAS bumps penny_execution_sequence; nothing else may change.
    def settings():
        return {k: v for k, v in world.prefs.docs[0].items() if k != "penny_execution_sequence"}
    prefs_before = json.dumps(settings(), default=str)
    card = propose(world, monkeypatch, "Connect my Monzo account", "propose_connect_bank", {"bank": "Monzo"})
    assert card["kind"] == "connect_bank" and card["summary"] == "Connect Monzo through Finexer"
    assert "Sorted is a trading name of AURIQ LTD." in card["consequence"] and "firm reference number 925695" in card["consequence"]
    assert "Nothing is connected until you finish with Finexer." in card["consequence"]
    done = confirm(card)
    assert done["executed"] is True and done["result"] == {"recorded": True, "open": "bank_picker", "bank": "Monzo"}
    assert calls == [] and json.dumps(settings(), default=str) == prefs_before, "confirming writes nothing else"
    stored = [d for d in world.proposals.docs if d["_id"] == card["proposal_id"]][0]
    assert stored["executed_at"] is not None and len(world.proposals.docs) == 1


# ── consent off: the propose attempt asks for consent, it never says cannot ─

@pytest.mark.parametrize("question, tool, args", [
    ("Set my emergency fund to £2,000", "propose_set_savings_goal", {"target_type": "amount", "target_amount": 2000}),
    ("Connect my Monzo account", "propose_connect_bank", {"bank": "Monzo"}),
    ("Make my Holiday set aside 150", "propose_update_allocation", {"allocation_ref": "Holiday", "amount_per_period": 150}),
], ids=["buffer", "connect", "set-aside"])
def test_consent_off_yields_the_consent_prompt(monkeypatch, world, question, tool, args):
    async def not_consented(query, proj=None):
        return {}
    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", not_consented)
    res = ask(world, monkeypatch, question, [_tool_call_payload(tool, args)])
    assert res["consent_required"] is True and "proposal" not in res
    assert "tap allow" in res["reply"]
    for word in ("cannot", "can't", "unable", "not able"):
        assert word not in res["reply"].lower()
    assert world.proposals.docs == [], "no proposal row is ever built without consent"
