"""G472: Penny can add, update or remove ONE card rate or offer without resending the whole list.

No model is called. Cards and banks are invented. The same Mongo-shaped fakes as the other
proposal tests stand in for the collections; the card-terms route and its validators run for real.
"""
import asyncio
import json
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException

import app.routers.can_i as can_i_module
import app.routers.card_terms as card_terms_module
import app.services.penny_tools as penny_tools_module
from app.core.models import Account
from app.services.penny_tools import PROPOSE_TOOL_NAMES, PROPOSE_TOOL_SCHEMAS, execute_tool
from tests.penny_proposal_fakes import FakeCollection as _FakeCol

UID = "kevin"
ADD = {"card_ref": "Harbour", "offer_type": "balance_transfer", "apr_pct": 0, "balance": 1455, "until": "2028-06-01"}
TEXT_ADD = ["add a 0% balance transfer of £1,455 ending 1 June 2028 on my Harbour card"]


def _card(id_, name, provider, number=None):
    return Account(id=id_, name=name, type="credit_card", subtype="CREDIT_CARD", balance=-500.0,
                   provider=provider, account_number=number)


def _stored(account_id="c1", **extra):
    doc = {
        "_id": f"{UID}:{account_id}", "user_id": UID, "account_id": account_id, "status": "confirmed",
        "apr_pct": 21.9, "cash_apr_pct": 27.9, "promos": [], "bt_offers": [{"ends": "2028-01-01", "fee_pct": 3.0, "note": "x"}],
        "min_payment_note": "3%", "usage": "carry", "product_key": "harbour-1",
        "statement_close_day": 4, "payment_due_day": 18, "payment_method": "manual",
        "statement_amount_override": {"close_date": "2028-01-04", "amount": 120.5},
    }
    doc.update(extra)
    return doc


@pytest.fixture
def world(monkeypatch):
    import app.routers.accounts as accounts_module
    import app.routers.analytics as analytics_module

    cards = [_card("c1", "Harbour Rewards", "Harbourbank", "5500 0000 0000 1111")]
    accounts_col = _FakeCol([{"_id": a.id, "user_id": UID, "type": "credit_card", "subtype": "CREDIT_CARD", "name": a.name} for a in cards])
    terms = _FakeCol([_stored()])
    proposals = _FakeCol()

    async def get_accounts(user):
        return world_state["cards"]

    async def no_refresh(uid):
        return None

    world_state = {"cards": cards, "accounts_col": accounts_col, "terms": terms, "proposals": proposals}
    monkeypatch.setattr(accounts_module, "get_accounts", get_accounts)
    monkeypatch.setattr(analytics_module, "_refresh_after_override", no_refresh)
    monkeypatch.setattr(card_terms_module, "accounts_col", accounts_col)
    monkeypatch.setattr(card_terms_module, "card_terms_col", terms)
    monkeypatch.setattr(penny_tools_module, "card_terms_col", terms)
    monkeypatch.setattr(penny_tools_module, "penny_proposals_col", proposals)
    monkeypatch.setattr(can_i_module, "penny_proposals_col", proposals)
    prefs = _FakeCol([{"user_id": UID, "penny_agent_consent": "2026-08-30T00:00:00"}])
    monkeypatch.setattr(penny_tools_module, "preferences_col", prefs)
    monkeypatch.setattr(can_i_module, "preferences_col", prefs)
    return world_state


def _propose(name, args, texts=None):
    args = dict(args)
    if texts is not None:
        args["_user_texts"] = texts
    return asyncio.run(execute_tool(UID, name, args))


def _confirm(world, proposal):
    """Replay the stored proposal through the real confirm route."""
    doc = next(d for d in world["proposals"].docs if d["_id"] == proposal["proposal_id"])
    now = datetime.now()
    doc.update(created_at=now, expires_at=now + timedelta(minutes=15))
    return asyncio.run(can_i_module.execute_proposal(proposal["proposal_id"], user={"email": UID}))


def _doc(world, account_id="c1"):
    return next(d for d in world["terms"].docs if d["_id"] == f"{UID}:{account_id}")


def _strip(p):
    return {k: v for k, v in p.items() if k != "id"}


def _untouched(doc):
    assert doc["bt_offers"] == [{"ends": "2028-01-01", "fee_pct": 3.0, "note": "x"}]
    assert doc["statement_amount_override"] == {"close_date": "2028-01-04", "amount": 120.5}
    assert (doc["statement_close_day"], doc["payment_due_day"], doc["payment_method"]) == (4, 18, "manual")
    assert doc["min_payment_note"] == "3%" and doc["product_key"] == "harbour-1"


# ── registration ───────────────────────────────────────────────────────────
def test_four_tools_registered_and_executors_present():
    names = {"propose_set_card_rates", "propose_add_card_offer", "propose_update_card_offer", "propose_remove_card_offer"}
    assert names <= PROPOSE_TOOL_NAMES
    assert {"set_card_rates", "add_card_offer", "update_card_offer", "remove_card_offer"} <= set(can_i_module._PROPOSAL_EXECUTORS)
    schema = {t["function"]["name"]: t["function"] for t in PROPOSE_TOOL_SCHEMAS}
    assert schema["propose_update_card_offer"]["parameters"]["required"] == ["card_ref", "offer_id"]
    assert set(schema["propose_add_card_offer"]["parameters"]["required"]) == {"card_ref", "offer_type", "apr_pct", "until"}


def test_no_consent_means_no_proposal(monkeypatch, world):
    import app.services.penny_agent as agent

    async def not_consented(query, proj=None):
        return None

    class _Resp:
        status_code = 200

        def __init__(self, name, args):
            self._p = {"choices": [{"message": {"content": None, "tool_calls": [
                {"id": "c", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}}]}

        def json(self):
            return self._p

    class _Client:
        def __init__(self, resp):
            self.resp = resp

        def __call__(self, *a, **k):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return self.resp

    async def boom(uid, name, args):
        raise AssertionError("a propose tool must never run without consent")

    monkeypatch.setattr(agent.preferences_col, "find_one", not_consented)
    monkeypatch.setattr(agent, "execute_tool", boom)
    for name, args in (("propose_add_card_offer", ADD), ("propose_set_card_rates", {"card_ref": "Harbour", "purchase_apr_pct": 23.2}),
                       ("propose_update_card_offer", {"card_ref": "Harbour", "offer_id": "x", "apr_pct": 1}),
                       ("propose_remove_card_offer", {"card_ref": "Harbour", "offer_id": "x"})):
        monkeypatch.setattr(agent.httpx, "AsyncClient", _Client(_Resp(name, args)))
        assert asyncio.run(agent.run_penny_agent(UID, "x", [], None, "")) == {"consent_required": True}
    assert world["proposals"].docs == []


# ── rates ──────────────────────────────────────────────────────────────────
def test_set_rates_proposes_then_changes_only_the_rates(world):
    r = _propose("propose_set_card_rates", {"card_ref": "Harbour", "purchase_apr_pct": 23.2, "cash_apr_pct": 29.9},
                 ["set my Harbour purchase rate to 23.2% and cash 29.9%"])
    assert r["proposal"] is True and r["kind"] == "set_card_rates"
    assert r["params"] == {"account_id": "c1", "apr_pct": 23.2, "cash_apr_pct": 29.9}
    assert "purchase rate to 23.2%" in r["summary"]
    assert _doc(world)["apr_pct"] == 21.9  # a proposal writes nothing
    _confirm(world, r)
    doc = _doc(world)
    assert (doc["apr_pct"], doc["cash_apr_pct"]) == (23.2, 29.9)
    _untouched(doc)


def test_set_one_rate_leaves_the_other(world):
    r = _propose("propose_set_card_rates", {"card_ref": "Harbour", "cash_apr_pct": 31.5}, ["cash rate is 31.5%"])
    _confirm(world, r)
    assert (_doc(world)["apr_pct"], _doc(world)["cash_apr_pct"]) == (21.9, 31.5)


def test_a_rate_the_user_never_typed_is_asked_for_not_invented(world):
    r = _propose("propose_set_card_rates", {"card_ref": "Harbour", "purchase_apr_pct": 24.9}, ["set my Harbour purchase rate to 23.2%"])
    assert r.get("needs_input") is True and "proposal" not in r
    assert _propose("propose_set_card_rates", {"card_ref": "Harbour", "purchase_apr_pct": 24.9})["needs_input"] is True  # no words at all
    assert world["proposals"].docs == []


def test_rates_out_of_range_and_empty_are_refused(world):
    assert "error" in _propose("propose_set_card_rates", {"card_ref": "Harbour", "purchase_apr_pct": 140}, ["140"])
    assert "error" in _propose("propose_set_card_rates", {"card_ref": "Harbour"}, ["x"])


# ── add ────────────────────────────────────────────────────────────────────
def test_add_offer_proposes_and_adds_one_with_an_id(world):
    r = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    assert r["proposal"] is True and r["kind"] == "add_card_offer"
    assert "0% balance transfer offer until 1 Jun 2028 on £1,455.00" in r["summary"]
    assert r["params"]["fields"] == {"offer_type": "balance_transfer", "apr_pct": 0.0, "until": "2028-06-01", "balance": 1455.0}
    assert _doc(world)["promos"] == []
    _confirm(world, r)
    doc = _doc(world)
    assert len(doc["promos"]) == 1
    offer = doc["promos"][0]
    assert offer["id"] and offer["offer_type"] == "balance_transfer" and offer["kind"] == "balance_transfer"
    assert (offer["apr_pct"], offer["balance"], offer["until"]) == (0.0, 1455.0, "2028-06-01")
    assert (doc["apr_pct"], doc["cash_apr_pct"]) == (21.9, 27.9)
    _untouched(doc)


def test_add_keeps_the_offers_already_there_and_reads_the_list_at_confirm_time(world):
    r = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    # another offer lands between the proposal and the confirm
    _doc(world)["promos"] = [{"kind": "purchases", "apr_pct": 0.0, "until": "2028-03-01", "id": "keepme"}]
    _confirm(world, r)
    promos = _doc(world)["promos"]
    assert [p["id"] for p in promos][0] == "keepme" and len(promos) == 2


def test_an_invented_balance_or_revert_rate_is_asked_for(world):
    assert _propose("propose_add_card_offer", ADD, ["add a 0% balance transfer ending 1 June 2028"])["needs_input"] is True
    with_revert = {**ADD, "revert_apr_pct": 24.9}
    assert _propose("propose_add_card_offer", with_revert, TEXT_ADD)["needs_input"] is True
    assert _propose("propose_add_card_offer", with_revert, TEXT_ADD + ["then 24.9%"])["proposal"] is True


def test_cap_of_four_offers_is_enforced(world):
    _doc(world)["promos"] = [
        {"kind": "purchases", "apr_pct": 0.0, "until": f"2028-0{m}-01", "id": f"o{m}"} for m in (1, 2, 3, 4)
    ]
    r = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    assert "error" in r and "4" in r["error"]
    assert world["proposals"].docs == []


def test_duplicate_offer_is_refused_and_a_different_balance_is_not(world):
    _confirm(world, _propose("propose_add_card_offer", ADD, TEXT_ADD))
    dup = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    assert "error" in dup
    other = _propose("propose_add_card_offer", {**ADD, "balance": 900}, ["add a 0% balance transfer of £900 ending 1 June 2028"])
    assert other["proposal"] is True


def test_bad_date_and_missing_fields_are_refused(world):
    assert "error" in _propose("propose_add_card_offer", {**ADD, "until": "1st June"}, TEXT_ADD)
    assert "error" in _propose("propose_add_card_offer", {**ADD, "until": "2020-01-01"}, TEXT_ADD)
    assert "error" in _propose("propose_add_card_offer", {"card_ref": "Harbour", "apr_pct": 0}, ["0"])


# ── update and remove ──────────────────────────────────────────────────────
def _with_two_offers(world):
    first = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    _confirm(world, first)
    second = _propose("propose_add_card_offer", {**ADD, "offer_type": "purchase", "balance": None, "apr_pct": 0, "until": "2027-09-01"},
                      ["add a 0% purchase offer until 2027-09-01, 0"])
    _confirm(world, second)
    return {p["offer_type"]: p["id"] for p in _doc(world)["promos"]}


def test_update_changes_only_the_given_fields_and_keeps_the_id(world):
    ids = _with_two_offers(world)
    before = {p["id"]: dict(p) for p in _doc(world)["promos"]}
    r = _propose("propose_update_card_offer", {"card_ref": "Harbour", "offer_id": ids["balance_transfer"], "balance": 1200, "revert_apr_pct": 24.9},
                 ["it is down to £1,200 now and reverts to 24.9%"])
    assert r["proposal"] is True and r["kind"] == "update_card_offer"
    _confirm(world, r)
    after = {p["id"]: p for p in _doc(world)["promos"]}
    assert set(after) == set(before)  # ids preserved
    changed = after[ids["balance_transfer"]]
    assert (changed["balance"], changed["revert_apr_pct"]) == (1200.0, 24.9)
    assert (changed["apr_pct"], changed["until"], changed["offer_type"]) == (0.0, "2028-06-01", "balance_transfer")
    assert after[ids["purchase"]] == before[ids["purchase"]]  # the other offer is byte for byte the same
    _untouched(_doc(world))


def test_update_can_clear_a_balance_with_null(world):
    ids = _with_two_offers(world)
    r = _propose("propose_update_card_offer", {"card_ref": "Harbour", "offer_id": ids["balance_transfer"], "balance": None}, ["clear it"])
    _confirm(world, r)
    assert "balance" not in next(p for p in _doc(world)["promos"] if p["id"] == ids["balance_transfer"])


def test_update_with_nothing_to_change_is_refused(world):
    ids = _with_two_offers(world)
    assert "error" in _propose("propose_update_card_offer", {"card_ref": "Harbour", "offer_id": ids["purchase"]}, ["x"])


def test_remove_drops_only_that_offer(world):
    ids = _with_two_offers(world)
    r = _propose("propose_remove_card_offer", {"card_ref": "Harbour", "offer_id": ids["purchase"]})
    assert r["proposal"] is True and r["kind"] == "remove_card_offer"
    _confirm(world, r)
    assert [p["id"] for p in _doc(world)["promos"]] == [ids["balance_transfer"]]
    _untouched(_doc(world))


def test_unknown_and_foreign_ids_are_rejected(world):
    ids = _with_two_offers(world)
    world["cards"].append(_card("c2", "Meadow Plus", "Meadowbank", "4000 0000 0000 2222"))
    world["terms"].docs.append(_stored("c2", promos=[{"kind": "purchases", "apr_pct": 0.0, "until": "2028-05-01", "id": "foreign1"}]))
    for name, extra in (("propose_update_card_offer", {"apr_pct": 5}), ("propose_remove_card_offer", {})):
        for bad in ("nope", "foreign1", ""):
            r = _propose(name, {"card_ref": "Harbour", "offer_id": bad, **extra}, ["5"])
            assert "error" in r, (name, bad)
    assert len(_doc(world)["promos"]) == 2 and ids


def test_confirm_time_rejects_an_id_that_vanished(world):
    ids = _with_two_offers(world)
    r = _propose("propose_remove_card_offer", {"card_ref": "Harbour", "offer_id": ids["purchase"]})
    _doc(world)["promos"] = [p for p in _doc(world)["promos"] if p["id"] != ids["purchase"]]  # removed elsewhere meanwhile
    with pytest.raises(HTTPException) as err:
        _confirm(world, r)
    assert err.value.status_code == 409


def test_an_already_ended_offer_blocks_a_change_until_it_is_removed(world):
    _doc(world)["promos"] = [{"kind": "purchases", "apr_pct": 0.0, "until": "2020-01-01", "id": "old1"}]
    r = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    assert "error" in r and "old1" in r["error"]


# ── which card ─────────────────────────────────────────────────────────────
def test_ambiguous_card_asks_and_never_guesses(world):
    world["cards"].append(_card("c2", "Harbour Cashback", "Harbourbank", "5500 0000 0000 2222"))
    r = _propose("propose_add_card_offer", ADD, TEXT_ADD)
    assert r["ambiguous"] is True and {m["last4"] for m in r["matches"]} == {"1111", "2222"}
    assert world["proposals"].docs == []


def test_card_found_by_last_four_digits(world):
    world["cards"].append(_card("c2", "Harbour Cashback", "Harbourbank", "5500 0000 0000 2222"))
    for ref in ("2222", "ending 2222", "card ending in 2222"):
        r = _propose("propose_set_card_rates", {"card_ref": ref, "purchase_apr_pct": 23.2}, ["23.2"])
        assert r["proposal"] is True and r["params"]["account_id"] == "c2", ref
    assert "error" in _propose("propose_set_card_rates", {"card_ref": "9999", "purchase_apr_pct": 23.2}, ["23.2"])


def test_no_such_card_is_an_error_not_a_guess(world):
    assert "error" in _propose("propose_add_card_offer", {**ADD, "card_ref": "Zebra"}, TEXT_ADD)


# ── Penny can see the ids; whole-list saves keep the new fields ────────────
def test_get_accounts_exposes_each_offers_id_type_rate_balance_end_and_revert(world, monkeypatch):
    ids = _with_two_offers(world)
    r = _propose("propose_update_card_offer", {"card_ref": "Harbour", "offer_id": ids["balance_transfer"], "revert_apr_pct": 24.9}, ["24.9"])
    _confirm(world, r)

    async def last_sync(uid):
        return None

    monkeypatch.setattr(penny_tools_module, "last_bank_sync", last_sync)
    out = asyncio.run(execute_tool(UID, "get_accounts", {}))
    promos = out["accounts"][0]["card_terms"]["promos"]
    bt = next(p for p in promos if p["offer_type"] == "balance_transfer")
    assert bt["id"] == ids["balance_transfer"]
    assert (bt["apr_pct"], bt["balance"], bt["until"], bt["revert_apr_pct"]) == (0.0, 1455.0, "2028-06-01", 24.9)
    assert all(p["id"] for p in promos)
    assert out["accounts"][0]["card_terms"]["cash_apr_pct"] == 27.9


def test_whole_list_schema_accepts_the_new_fields():
    schema = next(t for t in PROPOSE_TOOL_SCHEMAS if t["function"]["name"] == "propose_set_card_terms")
    props = schema["function"]["parameters"]["properties"]["promos"]["items"]["properties"]
    assert {"kind", "apr_pct", "until", "id", "offer_type", "balance", "revert_apr_pct", "as_of"} <= set(props)


def test_whole_list_save_keeps_id_type_balance_revert_and_as_of(world):
    promo = {"kind": "balance_transfer", "apr_pct": 0, "until": "2028-06-01", "id": "keep-me", "offer_type": "balance_transfer",
             "balance": 1455, "revert_apr_pct": 24.9, "as_of": "2026-11-01"}
    r = _propose("propose_set_card_terms", {"card_ref": "Harbour", "promos": [promo]})
    assert r["proposal"] is True and r["params"]["promos"][0]["id"] == "keep-me"
    _confirm(world, r)
    saved = _doc(world)["promos"][0]
    assert (saved["id"], saved["offer_type"], saved["balance"], saved["revert_apr_pct"], saved["as_of"]) == \
        ("keep-me", "balance_transfer", 1455.0, 24.9, "2026-11-01")
