"""Tests for B15 (2026-09-08, B12 stage 2): propose-only write tools for the
preferences that change money maths — pay period, income, pension, child
benefit, debt target/tracking-start, cover-plan exclusions, hide balances.
See docs/penny/action-inventory.md and PENNY_TOOLS.md's "Write tools
(propose-only)" table for the doctrine these extend.

Same fakes/conventions as tests/test_penny_proposals.py and
tests/test_penny_proposals_twins.py (no mongomock in this environment —
`_FakeCol` stands in for a Motor collection), copied rather than imported
so this file stays independently runnable. CORE PRINCIPLE under test
throughout: Penny PROPOSES, never executes — every new `_exec_propose_*`
executor here must return a stored proposal dict (never mutate real data),
and only POST /penny/proposals/{id}/execute (replaying app.routers.
preferences.update_preferences, the SAME function PATCH /preferences
calls) ever turns one into a real write.
"""
import asyncio
from datetime import date, datetime, timedelta

import pytest

import app.routers.can_i as can_i_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_tools import execute_tool

UID = "kevin"


def _acc(id_, name, balance=100.0, provider="Test Bank", type_="transaction"):
    return Account(id=id_, name=name, type=type_, balance=balance, provider=provider)


class _FakeCol:
    """Twin of test_penny_proposals.py's own _FakeCol — enough of
    find_one()/insert_one()/update_one() (exact-key-equality query
    matching, sufficient for every use here) to drive the real
    proposal/execute code without touching real Mongo."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


def _live_doc(kind, params, **overrides):
    now = datetime.now()
    doc = {
        "_id": "p-test", "user_id": UID, "kind": kind, "params": params,
        "summary": "s", "consequence": "c",
        "created_at": now, "expires_at": now + timedelta(minutes=15),
        "executed_at": None, "result": None, "cancelled_at": None,
    }
    doc.update(overrides)
    return doc


def _patch_consented_prefs(monkeypatch, extra=None) -> "_FakeCol":
    doc = {"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}
    if extra:
        doc.update(extra)
    fake_prefs = _FakeCol([doc])
    monkeypatch.setattr(can_i_module, "preferences_col", fake_prefs)
    return fake_prefs


def _patch_tool_prefs(monkeypatch, doc=None) -> "_FakeCol":
    """`penny_tools._current_prefs` reads through `penny_tools.preferences_col`
    (a separate module-level reference from can_i's own). Also patches
    `penny_tools.penny_proposals_col` with a fresh fake (every happy-path
    test here ends in `_create_proposal`, which inserts into it) — every
    caller needs both, so one helper does both rather than making every
    test call two setup functions."""
    fake_prefs = _FakeCol([{"user_id": UID, **(doc or {})}] if doc is not None else [])
    monkeypatch.setattr(penny_tools_module, "preferences_col", fake_prefs)
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", _FakeCol())
    return fake_prefs


# ═════════════════════════════════════════════════════════════════════════
# Section A — propose_set_pay_period
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_pay_period_calendar_month_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {"config": {"type": "calendar_month"}}))
    assert result["proposal"] is True
    assert result["kind"] == "set_pay_period"
    assert result["params"] == {"pay_period_config": {"type": "calendar_month"}}
    assert "calendar month" in result["summary"]


def test_propose_set_pay_period_monthly_pay_date_states_anchor_in_words(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "monthly_pay_date", "day": 25},
    }))
    assert result["proposal"] is True
    assert result["params"] == {"pay_period_config": {"type": "monthly_pay_date", "day": 25}}
    assert "monthly" in result["summary"] and "25th" in result["summary"]


def test_propose_set_pay_period_biweekly_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "biweekly", "weekday": 5, "referenceDate": "2026-08-14"},
    }))
    assert result["proposal"] is True
    assert result["params"] == {
        "pay_period_config": {"type": "biweekly", "weekday": 5, "referenceDate": "2026-08-14"},
    }
    assert "every two weeks" in result["summary"] and "Friday" in result["summary"]


def test_propose_set_pay_period_last_weekday_of_month_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "last_weekday_of_month", "weekday": 5},
    }))
    assert result["proposal"] is True
    assert "last Friday" in result["summary"]


def test_propose_set_pay_period_states_old_and_new(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"pay_period_config": {"type": "calendar_month"}})
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "monthly_pay_date", "day": 25},
    }))
    assert "calendar month" in result["summary"] and "monthly" in result["summary"]


def test_propose_set_pay_period_missing_config_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {}))
    assert "error" in result


def test_propose_set_pay_period_unsupported_type_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {"config": {"type": "weekly", "weekday": 1}}))
    assert "error" in result


def test_propose_set_pay_period_monthly_pay_date_day_out_of_range_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "monthly_pay_date", "day": 31},
    }))
    assert "error" in result


def test_propose_set_pay_period_biweekly_bad_date_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "biweekly", "weekday": 1, "referenceDate": "not-a-date"},
    }))
    assert "error" in result


def test_propose_set_pay_period_weekday_out_of_range_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pay_period", {
        "config": {"type": "last_weekday_of_month", "weekday": 9},
    }))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section B — propose_set_income
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_income_happy_path_no_prior_value(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_income", {"amount_annual": 58000}))
    assert result["proposal"] is True
    assert result["kind"] == "set_income"
    assert result["params"] == {"income_value": 58000}
    assert "£58,000" in result["summary"]


def test_propose_set_income_states_old_and_new(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"income_value": 52000})
    result = asyncio.run(execute_tool(UID, "propose_set_income", {"amount_annual": 58000}))
    assert "£52,000" in result["summary"] and "£58,000" in result["summary"]


def test_propose_set_income_negative_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_income", {"amount_annual": -100}))
    assert "error" in result


def test_propose_set_income_non_numeric_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_income", {"amount_annual": "lots"}))
    assert "error" in result


def test_propose_set_income_bracket_only_needs_input_no_proposal():
    result = asyncio.run(execute_tool(UID, "propose_set_income", {"bracket": "100k_125k"}))
    assert result.get("needs_input") is True
    assert "proposal" not in result


def test_propose_set_income_missing_both_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_income", {}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section C — propose_set_pension_contributions
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_pension_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"pension_annual": 2000})
    result = asyncio.run(execute_tool(UID, "propose_set_pension_contributions", {"amount_annual": 4000}))
    assert result["proposal"] is True
    assert result["kind"] == "set_pension"
    assert result["params"] == {"pension_annual": 4000}
    assert "£2,000" in result["summary"] and "£4,000" in result["summary"]


def test_propose_set_pension_negative_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pension_contributions", {"amount_annual": -1}))
    assert "error" in result


def test_propose_set_pension_missing_amount_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_pension_contributions", {}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section D — propose_set_child_benefit
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_child_benefit_happy_path_true(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_child_benefit", {"receiving": True}))
    assert result["proposal"] is True
    assert result["kind"] == "set_child_benefit"
    assert result["params"] == {"has_child_benefit": True}
    assert "receiving" in result["summary"]


def test_propose_set_child_benefit_states_old_and_new(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"has_child_benefit": True})
    result = asyncio.run(execute_tool(UID, "propose_set_child_benefit", {"receiving": False}))
    assert "from receiving to not receiving" in result["summary"]


def test_propose_set_child_benefit_non_bool_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_child_benefit", {"receiving": "yes"}))
    assert "error" in result


def test_propose_set_child_benefit_missing_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_child_benefit", {}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section E — propose_set_debt_target
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_debt_target_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"debt_target_months": 12})
    result = asyncio.run(execute_tool(UID, "propose_set_debt_target", {"months": 18}))
    assert result["proposal"] is True
    assert result["kind"] == "set_debt_target"
    assert result["params"] == {"debt_target_months": 18}
    assert "12" in result["summary"] and "18" in result["summary"]


def test_propose_set_debt_target_zero_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_debt_target", {"months": 0}))
    assert "error" in result


def test_propose_set_debt_target_too_large_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_debt_target", {"months": 361}))
    assert "error" in result


def test_propose_set_debt_target_non_numeric_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_debt_target", {"months": "soon"}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section F — propose_set_debt_tracking_start
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_debt_tracking_start_full_date_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_debt_tracking_start", {"date": "2026-09-01"}))
    assert result["proposal"] is True
    assert result["kind"] == "set_debt_tracking_start"
    assert result["params"] == {"debt_tracking_start": "2026-09-01"}


def test_propose_set_debt_tracking_start_year_month_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    result = asyncio.run(execute_tool(UID, "propose_set_debt_tracking_start", {"date": "2026-09"}))
    assert result["proposal"] is True
    assert result["params"] == {"debt_tracking_start": "2026-09"}
    assert "Sep 2026" in result["summary"]


def test_propose_set_debt_tracking_start_bad_date_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_debt_tracking_start", {"date": "not-a-date"}))
    assert "error" in result


def test_propose_set_debt_tracking_start_missing_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_debt_tracking_start", {}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section G — propose_set_cover_plan_exclusions
# ═════════════════════════════════════════════════════════════════════════

def _patch_accounts(monkeypatch, accounts):
    import app.routers.accounts as accounts_module

    async def fake_get_accounts(user):
        return accounts

    monkeypatch.setattr(accounts_module, "get_accounts", fake_get_accounts)


def test_propose_set_cover_plan_exclusions_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"cover_plan_excluded_accounts": []})
    _patch_accounts(monkeypatch, [_acc("a1", "ISA"), _acc("a2", "Current Account")])
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": ["ISA"]}))
    assert result["proposal"] is True
    assert result["kind"] == "set_cover_plan_exclusions"
    assert result["params"] == {"cover_plan_excluded_accounts": ["a1"]}
    assert "ISA" in result["summary"]


def test_propose_set_cover_plan_exclusions_resolves_by_id(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    _patch_accounts(monkeypatch, [_acc("a1", "ISA"), _acc("a2", "Current Account")])
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": ["a1", "a2"]}))
    assert result["proposal"] is True
    assert sorted(result["params"]["cover_plan_excluded_accounts"]) == ["a1", "a2"]


def test_propose_set_cover_plan_exclusions_empty_list_clears(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"cover_plan_excluded_accounts": ["a1"]})
    _patch_accounts(monkeypatch, [_acc("a1", "ISA")])
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": []}))
    assert result["proposal"] is True
    assert result["params"] == {"cover_plan_excluded_accounts": []}
    assert "Stop excluding" in result["summary"]


def test_propose_set_cover_plan_exclusions_unknown_account_is_tool_error(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    _patch_accounts(monkeypatch, [_acc("a1", "ISA")])
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": ["not a real account"]}))
    assert "error" in result


def test_propose_set_cover_plan_exclusions_ambiguous_account(monkeypatch):
    _patch_tool_prefs(monkeypatch)
    _patch_accounts(monkeypatch, [_acc("a1", "Joint Savings"), _acc("a2", "Joint Savings Pot")])
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": ["joint"]}))
    assert result.get("ambiguous") is True


def test_propose_set_cover_plan_exclusions_not_a_list_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_cover_plan_exclusions", {"account_refs": "ISA"}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section H — propose_set_hide_balances
# ═════════════════════════════════════════════════════════════════════════

def test_propose_set_hide_balances_hide_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"hide_net_worth": False})
    result = asyncio.run(execute_tool(UID, "propose_set_hide_balances", {"hidden": True}))
    assert result["proposal"] is True
    assert result["kind"] == "set_hide_balances"
    assert result["params"] == {"hide_net_worth": True}
    assert result["summary"] == "Hide your balances"


def test_propose_set_hide_balances_show_happy_path(monkeypatch):
    _patch_tool_prefs(monkeypatch, {"hide_net_worth": True})
    result = asyncio.run(execute_tool(UID, "propose_set_hide_balances", {"hidden": False}))
    assert result["summary"] == "Show your balances again"


def test_propose_set_hide_balances_non_bool_is_tool_error():
    result = asyncio.run(execute_tool(UID, "propose_set_hide_balances", {"hidden": "yes"}))
    assert "error" in result


# ═════════════════════════════════════════════════════════════════════════
# Section I — execute dispatches to the real update_preferences path
# ═════════════════════════════════════════════════════════════════════════

def test_execute_set_income_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_income", {"income_value": 58000})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.preferences as preferences_module

    captured = {}

    async def fake_update(body, user):
        captured["body"] = body
        captured["user"] = user
        return {"hide_net_worth": False, "dark_mode": False}

    monkeypatch.setattr(preferences_module, "update_preferences", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["body"] == {"income_value": 58000}
    assert captured["user"] == {"email": UID}
    assert result["executed"] is True


def test_execute_set_pay_period_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_pay_period", {"pay_period_config": {"type": "calendar_month"}})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.preferences as preferences_module

    captured = {}

    async def fake_update(body, user):
        captured["body"] = body
        return {"hide_net_worth": False, "dark_mode": False}

    monkeypatch.setattr(preferences_module, "update_preferences", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["body"] == {"pay_period_config": {"type": "calendar_month"}}
    assert result["executed"] is True


def test_execute_set_hide_balances_uses_real_update_preferences_and_wipes_cache(monkeypatch):
    """Unlike the tests above (which replace update_preferences entirely to
    prove dispatch/param-passing), this one runs the REAL router function
    to prove the shared executor picks up its response-cache wipe, exactly
    as a Settings PATCH would — the whole point of replaying through
    `update_preferences` rather than writing to preferences_col directly."""
    fake_proposals = _FakeCol([_live_doc("set_hide_balances", {"hide_net_worth": True})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.preferences as preferences_module

    fake_prefs_for_route = _FakeCol([{"user_id": UID, "hide_net_worth": False}])
    monkeypatch.setattr(preferences_module, "preferences_col", fake_prefs_for_route)

    invalidated = []

    async def fake_ainvalidate(uid):
        invalidated.append(uid)

    monkeypatch.setattr(preferences_module.response_cache, "ainvalidate", fake_ainvalidate)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert result["executed"] is True
    assert invalidated == [UID]
    assert fake_prefs_for_route.docs[0]["hide_net_worth"] is True


def test_execute_set_child_benefit_dispatches_real_route(monkeypatch):
    fake_proposals = _FakeCol([_live_doc("set_child_benefit", {"has_child_benefit": True})])
    monkeypatch.setattr(can_i_module, "penny_proposals_col", fake_proposals)
    _patch_consented_prefs(monkeypatch)

    import app.routers.preferences as preferences_module

    captured = {}

    async def fake_update(body, user):
        captured["body"] = body
        return {"hide_net_worth": False, "dark_mode": False}

    monkeypatch.setattr(preferences_module, "update_preferences", fake_update)

    result = asyncio.run(can_i_module.execute_proposal("p-test", user={"email": UID}))
    assert captured["body"] == {"has_child_benefit": True}
    assert result["executed"] is True


# ═════════════════════════════════════════════════════════════════════════
# Section J — registration + consent gate (unchanged doctrine, new tools)
# ═════════════════════════════════════════════════════════════════════════

_NEW_TOOL_NAMES = {
    "propose_set_pay_period", "propose_set_income", "propose_set_pension_contributions",
    "propose_set_child_benefit", "propose_set_debt_target", "propose_set_debt_tracking_start",
    "propose_set_cover_plan_exclusions", "propose_set_hide_balances",
}

_NEW_KIND_NAMES = {
    "set_pay_period", "set_income", "set_pension", "set_child_benefit",
    "set_debt_target", "set_debt_tracking_start", "set_cover_plan_exclusions", "set_hide_balances",
}


def test_all_new_tools_registered_in_propose_tool_names():
    assert _NEW_TOOL_NAMES <= penny_tools_module.PROPOSE_TOOL_NAMES


def test_all_new_kinds_registered_in_proposal_executors():
    assert _NEW_KIND_NAMES <= set(can_i_module._PROPOSAL_EXECUTORS.keys())


def test_new_kinds_all_share_the_preferences_executor():
    for kind in _NEW_KIND_NAMES:
        assert can_i_module._PROPOSAL_EXECUTORS[kind] is can_i_module._execute_update_preferences


def test_consent_required_for_new_propose_tool_without_consent(monkeypatch):
    import json

    import app.services.penny_agent as penny_agent_module
    from app.services.penny_agent import run_penny_agent

    class _FakeResponse:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

    class _ScriptedAsyncClient:
        def __init__(self, responses):
            self._responses = list(responses)
            self.calls = []

        def __call__(self, *a, **kw):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            self.calls.append(json)
            return self._responses[min(len(self.calls) - 1, len(self._responses) - 1)]

    async def fake_find_one(query, proj=None):
        return None  # not consented

    monkeypatch.setattr(penny_agent_module.preferences_col, "find_one", fake_find_one)

    tool_call_payload = _FakeResponse({
        "choices": [{
            "message": {
                "content": None,
                "tool_calls": [{
                    "id": "call_1", "type": "function",
                    "function": {
                        "name": "propose_set_hide_balances",
                        "arguments": json.dumps({"hidden": True}),
                    },
                }],
            },
        }],
    })
    client = _ScriptedAsyncClient([tool_call_payload])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fail_execute_tool(uid, name, args):
        raise AssertionError("must never execute a propose tool without consent")

    monkeypatch.setattr(penny_agent_module, "execute_tool", fail_execute_tool)

    result = asyncio.run(run_penny_agent(UID, "hide my balances", [], None, ""))
    assert result == {"consent_required": True}
