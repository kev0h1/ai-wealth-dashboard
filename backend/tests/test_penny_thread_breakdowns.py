"""G254: Kevin's DigitalOcean thread (2026-10-10). Offline: fake collections and
a scripted model, no network, no real database.

Covers the four fixes: loop failure handling (repair once, show safe prose,
never the out-of-scope refusal for a failure), forgiving merchant / amount /
fuzzy search, last-result memory on the stored conversation, and honest FX
reporting. Fixture world: a synthetic user with DIGITALOCEAN.COM USD rows and
no fx fields, plus another user's identically named rows that must never leak.
"""
import asyncio
import json
from datetime import date, datetime

import app.routers.can_i as can_i_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_search as penny_search
import app.services.penny_tools as penny_tools_module
from app.services import penny_conversations as svc
from tests.test_penny_agent import _final_payload, _ScriptedAsyncClient, _tool_call_payload
from tests.test_penny_category_routing import _Col as _BaseCol, _FakeTx
from tests.test_penny_conversations import cols  # noqa: F401  (fixture)

UID = "g254-synthetic-user"
OTHER = "g254-other-user"


class _Col(_BaseCol):
    def distinct(self, field, query=None):
        from tests.test_penny_category_routing import _match

        async def _go():
            return sorted({d[field] for d in self._docs if d.get(field) is not None and _match(d, query or {})})
        return _go()


def _rows():
    mk = lambda i, day, amt, desc, **kw: {  # noqa: E731
        "_id": f"do-{i}", "id": f"do-{i}", "user_id": UID, "transaction_type": "debit", "amount": amt,
        "currency": "GBP", "date": datetime(2026, 6, day), "description": desc, "merchant_name": None,
        "merchant_key": "digitalocean.com", "category": "Bills", "account_id": "acc-1", **kw}
    return [
        mk(1, 1, 11.06, "DIGITALOCEAN.COM"),
        mk(2, 15, 7.5, "DIGITALOCEAN.COM"),
        mk(3, 28, 22.0, "DIGITALOCEAN.COM", original_amount=14.4),
        {"_id": "tesco-1", "id": "tesco-1", "user_id": UID, "transaction_type": "debit", "amount": 31.2,
         "currency": "GBP", "date": datetime(2026, 6, 2), "description": "TESCO STORES", "merchant_name": "Tesco",
         "merchant_key": "tesco", "category": "Groceries", "account_id": "acc-2"},
        {"_id": "garden-1", "id": "garden-1", "user_id": UID, "transaction_type": "debit", "amount": 9.0,
         "currency": "GBP", "date": datetime(2026, 6, 3), "description": "DIGITAL GARDEN CENTRE",
         "merchant_name": "Digital Garden Centre", "merchant_key": "digital garden centre", "category": "Shopping",
         "account_id": "acc-2"},
        {"_id": "other-1", "id": "other-1", "user_id": OTHER, "transaction_type": "debit", "amount": 5.0,
         "currency": "GBP", "date": datetime(2026, 6, 1), "description": "DIGITALOCEAN.COM", "merchant_name": None,
         "merchant_key": "digitalocean.com", "category": "Bills", "account_id": "acc-x"},
    ]


def _install(monkeypatch, rows=None):
    cs = (_Col(rows if rows is not None else _rows()), _Col([]), _Col([]))
    monkeypatch.setattr(penny_tools_module, "_SEARCH_COLLECTIONS", cs)
    monkeypatch.setattr(penny_tools_module, "_doc_to_tx", _FakeTx.from_doc)

    async def no_category(uid, text):
        return None, []

    monkeypatch.setattr(penny_tools_module, "_resolve_user_category", no_category)
    monkeypatch.setattr(penny_tools_module.timeutil, "user_today", lambda: date(2026, 10, 10))


def search(**args):
    return asyncio.run(penny_tools_module.execute_tool(UID, "search_transactions", args))


def ids(res):
    return sorted(r["id"] for r in res["transactions"])


DO_IDS = ["do-1", "do-2", "do-3"]


# ── Merchant search: normalised on both sides ────────────────────────────

def test_spaced_and_suffixed_names_match_the_dotcom_merchant(monkeypatch):
    _install(monkeypatch)
    for name in ("Digital Ocean", "DigitalOcean LLC", "digitalocean.com", "DIGITAL OCEAN INC", "Digital-Ocean"):
        for key in ("q", "merchants"):
            res = search(**{key: name})
            assert ids(res) == DO_IDS, (name, key)
            assert res["match_kind"] == "text"
            assert res["matched_count"] == 3


def test_loose_match_does_not_pull_in_a_different_merchant(monkeypatch):
    _install(monkeypatch)
    res = search(q="Digital Ocean")
    assert "garden-1" not in ids(res)
    assert search(q="Tesco")["matched_count"] == 1


def test_search_is_user_scoped(monkeypatch):
    _install(monkeypatch)
    res = search(q="DigitalOcean")
    assert "other-1" not in ids(res)
    res = asyncio.run(penny_tools_module.execute_tool(OTHER, "search_transactions", {"q": "Digital Ocean"}))
    assert ids(res) == ["other-1"]


def test_normalisation_helpers():
    assert penny_search.loose_name("DigitalOcean LLC") == penny_search.loose_name("Digital Ocean") == "digitalocean"
    assert penny_search.loose_name("DIGITALOCEAN.COM") == "digitalocean"
    assert penny_search.loose_regex("ab") is None  # too short to match safely
    assert penny_search.loose_name("LLC") == "llc"  # never normalised to nothing


# ── Amount and date search ───────────────────────────────────────────────

def test_amount_by_home_amount_original_amount_or_description(monkeypatch):
    rows = _rows()
    rows.append({**rows[0], "_id": "do-4", "id": "do-4", "amount": 11.06, "date": datetime(2026, 5, 1),
                 "description": "DIGITALOCEAN.COM AMOUNT IN USD 14.40 ON 01 MAY VISA 1.3451 FINAL GBP AMOUNT "
                                "INCLUDES NON-STERLING TRANS FEE £0.32 BCC"})
    _install(monkeypatch, rows)
    assert ids(search(amount=11.06)) == ["do-1", "do-4"]
    # "$14.40" / "USD 14.40" as the search text, an original_amount field, and a description figure.
    for text in ("$14.40", "USD 14.40", "14.40"):
        assert ids(search(q=text)) == ["do-3", "do-4"], text
    assert ids(search(merchants="Digital Ocean", amount="$14.40")) == ["do-3", "do-4"]
    assert ids(search(q="$14.40", date_from="2026-05-01", date_to="2026-05-01")) == ["do-4"]
    # not a prefix of a longer number
    assert search(amount=4.4)["count"] == 0


def test_date_and_month_search(monkeypatch):
    _install(monkeypatch)
    assert ids(search(merchants="Digital Ocean", date_from="2026-06-01", date_to="2026-06-01")) == ["do-1"]
    assert ids(search(merchants="Digital Ocean", date_from="2026-06-01", date_to="2026-06-30")) == DO_IDS


def test_account_filter_still_composes_with_loose_names(monkeypatch):
    _install(monkeypatch)

    class _Acc:
        id, name, provider = "acc-2", "Barclays Current", "barclays"

    async def fake_accounts(user=None):
        return [_Acc()]

    import app.routers.accounts as accounts_router
    monkeypatch.setattr(accounts_router, "get_accounts", fake_accounts)
    res = search(q="Digital Ocean", account="Barclays")
    assert res["account_recognised"] is True
    assert ids(res) == []  # the DigitalOcean rows are on acc-1


# ── Fuzzy fallback ───────────────────────────────────────────────────────

def test_fuzzy_match_reports_what_it_matched(monkeypatch):
    _install(monkeypatch)
    res = search(q="Digtal Ocean")  # typo: no exact or loose match
    assert res["match_kind"] == "fuzzy"
    assert res["matched_merchant"] == "digitalocean.com"
    assert ids(res) == DO_IDS
    assert "closest merchant" in res["match_note"]


def test_nonsense_name_stays_empty_and_unfuzzed(monkeypatch):
    _install(monkeypatch)
    res = search(q="Zzxqv Holdings")
    assert res["count"] == 0 and res["match_kind"] == "text"
    assert "matched_merchant" not in res


def test_fuzzy_never_crosses_users(monkeypatch):
    rows = [r for r in _rows() if r["user_id"] == OTHER]
    _install(monkeypatch, rows)
    assert search(q="Digtal Ocean")["count"] == 0


# ── last_result ids ──────────────────────────────────────────────────────

def test_transaction_ids_last_result_resolves_exactly_those_rows(monkeypatch):
    _install(monkeypatch)
    res = search(transaction_ids="last_result", _last_result_ids=["do-1", "do-3", "other-1", "tesco-1"])
    assert ids(res) == ["do-1", "do-3", "tesco-1"]  # the other user's id is never returned
    assert res["match_kind"] == "ids"


def test_last_result_without_any_stored_result_says_so(monkeypatch):
    _install(monkeypatch)
    res = search(transaction_ids="last_result")
    assert res["last_result_available"] is False and res["count"] == 0


def test_search_returns_ids_only_when_the_loop_asks(monkeypatch):
    _install(monkeypatch)
    assert "_result_ids" not in search(q="Digital Ocean")
    assert sorted(search(q="Digital Ocean", _ids_ok=True)["_result_ids"]) == DO_IDS


# ── FX honesty ───────────────────────────────────────────────────────────

def test_rows_with_no_fx_fields_report_zero_rates(monkeypatch):
    _install(monkeypatch)
    res = search(q="Digital Ocean")
    assert res["fx_fields"]["rows_stating_a_rate"] == 0 and res["fx_fields"]["of"] == 3
    assert all("fx" not in r for r in res["transactions"])


def test_a_rate_written_in_the_description_is_reported(monkeypatch):
    rows = _rows()
    rows[0]["description"] = ("DIGITALOCEAN.COM AMOUNT IN USD 14.40 ON 01 MAY VISA 1.3451 FINAL GBP AMOUNT "
                              "INCLUDES NON-STERLING TRANS FEE £0.32 BCC")
    _install(monkeypatch, rows)
    res = search(q="Digital Ocean")
    assert res["fx_fields"]["rows_stating_a_rate"] == 1
    fx = next(r["fx"] for r in res["transactions"] if r["id"] == "do-1")
    assert fx == {"original_currency": "USD", "original_amount": 14.4, "rate": 1.3451, "fee_gbp": 0.32}


# ── Loop failure handling ────────────────────────────────────────────────

def _run(responses, monkeypatch, **kw):
    client = _ScriptedAsyncClient(responses)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_execute(uid, name, args):
        return {"ok": True}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute)
    return client, asyncio.run(penny_agent_module.run_penny_agent("kevin", "do they have fx rates", [], None, "", **kw))


def test_unparseable_answer_is_repaired_once(monkeypatch):
    client, result = _run([
        _final_payload("Which transactions do you mean?"),
        _final_payload("HEADLINE: No rate stored\nREPLY: The data does not include a rate."),
    ], monkeypatch)
    assert result["headline"] == "No rate stored" and "prose_fallback" not in result
    assert len(client.calls) == 2
    repair = client.calls[1]["messages"][-1]
    assert repair["role"] == "user" and "HEADLINE:" in repair["content"] and "REPLY:" in repair["content"]
    assert client.calls[1]["messages"][-2] == {"role": "assistant", "content": "Which transactions do you mean?"}


def test_still_unparseable_after_repair_shows_the_models_safe_prose(monkeypatch):
    client, result = _run([_final_payload("REPLY: The data has no stored rate."),
                           _final_payload("There is no stored rate on these rows.")], monkeypatch)
    assert len(client.calls) == 2  # retried once, not more
    assert result["prose_fallback"] is True and result["headline"] == ""
    assert result["reply"] == "There is no stored rate on these rows."


def test_empty_answer_twice_is_a_failure_not_a_refusal(monkeypatch):
    client, result = _run([_final_payload(""), _final_payload("   ")], monkeypatch)
    assert result == {"loop_failed": True} and len(client.calls) == 2


def test_safe_prose_strips_labels_control_characters_and_caps():
    assert penny_agent_module.safe_prose("HEADLINE: x\nREPLY: Hello there friend\x00") == "x\nHello there friend"
    assert penny_agent_module.safe_prose("OUT_OF_SCOPE") == ""
    assert penny_agent_module.safe_prose("short") == ""
    assert len(penny_agent_module.safe_prose("a" * 5000)) == 1200


def test_out_of_scope_sentinel_keeps_the_canned_refusal(monkeypatch):
    client, result = _run([_final_payload("OUT_OF_SCOPE")], monkeypatch)
    assert result is None and len(client.calls) == 1  # no repair for an explicit decline


def _answer(monkeypatch, agent_result):
    async def fake_agent(*a, **k):
        return agent_result

    async def allowance(uid):
        return None

    monkeypatch.setattr(can_i_module, "run_penny_agent", fake_agent)
    monkeypatch.setattr(can_i_module, "penny_allowance", allowance)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")
    return asyncio.run(can_i_module._can_i_answer({"question": "do they have fx rates"}, {"email": "kevin"}))


def test_router_reports_a_loop_failure_with_a_retry_not_the_refusal(monkeypatch):
    out = _answer(monkeypatch, {"loop_failed": True})
    assert out["reply"] == "Something went wrong on my side. Try asking again."
    assert out["retry"] is True and out["out_of_scope"] is False
    assert "outside what I can work out" not in json.dumps(out)


def test_router_keeps_the_refusal_only_for_the_sentinel(monkeypatch):
    out = _answer(monkeypatch, None)
    assert out["out_of_scope"] is True and "outside what I can work out" in out["headline"]


def test_router_passes_prose_through(monkeypatch):
    out = _answer(monkeypatch, {"headline": "", "reply": "There is no stored rate.", "tools_used": [], "prose_fallback": True})
    assert out["reply"] == "There is no stored rate." and out["out_of_scope"] is False and "retry" not in out


# ── Conversation memory ──────────────────────────────────────────────────

def test_loop_returns_the_result_ids_and_injects_them_next_turn(monkeypatch):
    seen_args = []

    async def fake_execute(uid, name, args):
        seen_args.append(args)
        return {"transactions": [{"id": "do-1"}], "_result_ids": ["do-1", "do-2"], "count": 2}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute)
    client = _ScriptedAsyncClient([
        _tool_call_payload("search_transactions", {"merchants": "Digital Ocean"}),
        _final_payload("HEADLINE: Two payments\nREPLY: Two payments to DigitalOcean."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)
    first = asyncio.run(penny_agent_module.run_penny_agent("kevin", "digital ocean", [], None, ""))
    assert first["last_result"] == {"tool": "search_transactions", "args": {"merchants": "Digital Ocean"}, "ids": ["do-1", "do-2"]}
    assert seen_args[0]["_ids_ok"] is True and "_last_result_ids" not in seen_args[0]
    assert "last_result is available" not in json.dumps(client.calls[0]["messages"][0])

    client2 = _ScriptedAsyncClient([
        _tool_call_payload("search_transactions", {"transaction_ids": "last_result"}),
        _final_payload("HEADLINE: No rate stored\nREPLY: The data does not include a rate."),
    ])
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client2)
    second = asyncio.run(penny_agent_module.run_penny_agent(
        "kevin", "do they have fx rates on all these", [], None, "", last_result=first["last_result"]))
    system = json.dumps(client2.calls[0]["messages"][0])
    assert "last_result is available" in system and "2 transactions" in system and "Digital Ocean" in system
    assert seen_args[1]["_last_result_ids"] == ["do-1", "do-2"]
    # the follow-up keeps the same result set for the turn after it
    assert second["last_result"]["ids"] == ["do-1", "do-2"]
    assert second["last_result"]["args"] == {"merchants": "Digital Ocean"}


def test_clean_last_result_is_ids_only_and_bounded():
    out = svc.clean_last_result({"tool": "search_transactions", "args": {"q": "x" * 90, "bad": {"n": 1}},
                                 "ids": [f"id{i}" for i in range(500)], "transactions": [{"amount": 1}]})
    assert set(out) == {"tool", "args", "ids"} and len(out["ids"]) == 200 and len(out["args"]["q"]) == 40
    assert "bad" not in out["args"]
    assert svc.clean_last_result({"tool": "get_accounts", "ids": ["a"]}) is None
    assert svc.clean_last_result({"tool": "search_transactions", "ids": []}) is None


def test_conversation_stores_last_result_and_hides_it_from_the_client(cols, monkeypatch):  # noqa: F811
    convs, _ = cols
    cid = asyncio.run(svc.create_conversation("a"))["id"]
    seen = {}

    async def fake_answer(body, user, last_result=None):
        seen["last_result"] = last_result
        return {"reply": "Here.", "headline": "h", "_last_result": {"tool": "search_transactions", "args": {"q": "x"}, "ids": ["t1", "t2"]}}

    monkeypatch.setattr(can_i_module, "_can_i_answer", fake_answer)
    out = asyncio.run(can_i_module.can_i({"question": "digital ocean", "conversation_id": cid}, {"email": "a"}))
    assert "_last_result" not in out and "last_result" not in out
    assert convs.docs[0]["turns"][1]["last_result"]["ids"] == ["t1", "t2"]
    assert seen["last_result"] is None  # nothing stored before the first answer
    # the next turn, however many turns later, receives the stored ids
    asyncio.run(can_i_module.can_i({"question": "do they have fx rates", "conversation_id": cid}, {"email": "a"}))
    assert seen["last_result"]["ids"] == ["t1", "t2"]
    # the client's copy of the chat never carries the ids; the export does
    assert all("last_result" not in t for t in asyncio.run(svc.get_conversation("a", cid))["turns"])
    assert "last_result" in asyncio.run(svc.export_conversations("a"))[0]["turns"][1]


def test_a_failed_turn_is_not_stored_and_offers_a_retry(cols, monkeypatch):  # noqa: F811
    convs, _ = cols
    cid = asyncio.run(svc.create_conversation("a"))["id"]

    async def fake_answer(body, user, last_result=None):
        return {"reply": "Something went wrong on my side. Try asking again.", "headline": "x", "retry": True}

    monkeypatch.setattr(can_i_module, "_can_i_answer", fake_answer)
    out = asyncio.run(can_i_module.can_i({"question": "do they have fx rates", "conversation_id": cid}, {"email": "a"}))
    assert out["retry"] is True and convs.docs[0]["turns"] == []


def test_another_users_chat_gives_no_last_result(cols):  # noqa: F811
    cid = asyncio.run(svc.create_conversation("a"))["id"]
    asyncio.run(svc.append_turns("a", cid, [
        svc.clean_turn("user", "q"),
        svc.clean_turn("assistant", "a", last_result={"tool": "search_transactions", "ids": ["t1"]})]))
    assert asyncio.run(svc.latest_last_result("a", cid))["ids"] == ["t1"]
    assert asyncio.run(svc.latest_last_result("b", cid)) is None
