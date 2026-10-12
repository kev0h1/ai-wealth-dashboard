"""G253: search_transactions totals are per currency. Offline fake collections;
the fake aggregate mirrors the pipeline's grouping (type, currency) and its
stored-GBP rule, so the test pins the shape the tool builds from it."""
import asyncio
from datetime import date, datetime

import app.services.penny_tools as penny_tools_module
from tests.test_penny_category_routing import _Col as _BaseCol, _FakeTx, _match, _Cursor

UID = "g253-synthetic-user"
OTHER = "g253-other-user"


class _Col(_BaseCol):
    def aggregate(self, pipeline):
        groups: dict = {}
        for d in (x for x in self._docs if _match(x, pipeline[0]["$match"])):
            cur = d.get("currency") or "GBP"
            gbp = d["amount"] if cur == "GBP" else next(
                (d[f] for f in ("amount_gbp", "gbp_amount", "home_amount") if d.get(f) is not None), None)
            g = groups.setdefault((d.get("transaction_type"), cur), {
                "_id": {"t": d.get("transaction_type"), "c": cur}, "total": 0.0, "n": 0, "gbp_total": 0.0, "gbp_n": 0})
            g["total"] += d["amount"]
            g["n"] += 1
            if gbp is not None:
                g["gbp_total"] += gbp
                g["gbp_n"] += 1
        return _Cursor(list(groups.values()))


def _row(i, amt, cur, kind="debit", uid=UID, **kw):
    return {"_id": f"r{i}", "id": f"r{i}", "user_id": uid, "transaction_type": kind, "amount": amt,
            "currency": cur, "date": datetime(2026, 6, i), "description": "OPENROUTER", "merchant_name": None,
            "merchant_key": "openrouter", "category": "Bills", "account_id": "a1", **kw}


def _install(monkeypatch, rows):
    cs = (_Col(rows), _Col([]), _Col([]))
    monkeypatch.setattr(penny_tools_module, "_SEARCH_COLLECTIONS", cs)
    monkeypatch.setattr(penny_tools_module, "_doc_to_tx", _FakeTx.from_doc)

    async def no_category(uid, text):
        return None, []

    monkeypatch.setattr(penny_tools_module, "_resolve_user_category", no_category)
    monkeypatch.setattr(penny_tools_module.timeutil, "user_today", lambda: date(2026, 10, 10))


def search(uid=UID, **args):
    return asyncio.run(penny_tools_module.execute_tool(uid, "search_transactions", {"q": "OpenRouter", **args}))


def test_single_currency_unchanged(monkeypatch):
    _install(monkeypatch, [_row(1, 10.0, "GBP"), _row(2, 5.5, "GBP"), _row(3, 4.0, "GBP", "credit")])
    res = search()
    assert res["matched_count"] == 3
    assert res["mixed_currency"] is False
    assert res["matched_spent"] == {"raw": 15.5, "formatted": "£15.50"}
    assert res["matched_received"] == {"raw": 4.0, "formatted": "£4.00"}
    assert [t["currency"] for t in res["totals"]] == ["GBP"]
    assert res["totals"][0]["count"] == 3
    assert res["totals_summary"] == "Spent £15.50; Received £4.00"


def test_missing_currency_is_gbp(monkeypatch):
    row = _row(1, 3.0, None)
    del row["currency"]
    _install(monkeypatch, [row])
    assert search()["totals"][0]["currency"] == "GBP"


def test_single_foreign_currency_is_not_a_pound_figure(monkeypatch):
    _install(monkeypatch, [_row(1, 14.4, "USD"), _row(2, 30.0, "USD")])
    res = search()
    assert res["mixed_currency"] is False
    assert res["matched_spent"]["formatted"] == "USD 44.40"
    assert "£" not in res["totals_summary"]


def test_mixed_currencies_give_per_currency_totals_and_no_single_figure(monkeypatch):
    _install(monkeypatch, [_row(1, 14.4, "USD"), _row(2, 30.0, "USD"), _row(3, 5.0, "GBP")])
    res = search()
    assert res["mixed_currency"] is True
    assert res["matched_spent"] is None and res["matched_received"] is None
    by = {t["currency"]: t for t in res["totals"]}
    assert by["USD"]["spent"]["formatted"] == "USD 44.40" and by["USD"]["count"] == 2
    assert by["GBP"]["spent"]["formatted"] == "£5.00" and by["GBP"]["count"] == 1
    assert res["matched_count"] == 3
    assert res["totals_summary"] == "Spent USD 44.40 and £5.00"
    assert "never add them" in res["totals_note"]


def test_gbp_equivalent_only_over_rows_that_have_one(monkeypatch):
    _install(monkeypatch, [
        _row(1, 14.4, "USD", amount_gbp=11.06),
        _row(2, 30.0, "USD"),  # no stored GBP amount: never converted
        _row(3, 5.0, "GBP"),
    ])
    res = search()
    assert res["gbp_equivalent_rows"] == 2
    assert res["gbp_equivalent_spent"] == {"raw": 16.06, "formatted": "£16.06"}
    assert res["matched_count"] == 3


def test_no_gbp_equivalent_when_no_row_has_one(monkeypatch):
    _install(monkeypatch, [_row(1, 14.4, "USD"), _row(2, 30.0, "USD")])
    assert "gbp_equivalent_spent" not in search()


def test_totals_are_user_scoped(monkeypatch):
    _install(monkeypatch, [_row(1, 14.4, "USD"), _row(2, 99.0, "EUR", uid=OTHER)])
    res = search()
    assert [t["currency"] for t in res["totals"]] == ["USD"]
    other = search(uid=OTHER)
    assert [t["currency"] for t in other["totals"]] == ["EUR"]


def test_table_summary_for_mixed_rows_is_per_currency(monkeypatch):
    _install(monkeypatch, [_row(1, 14.4, "USD"), _row(2, 30.0, "USD"), _row(3, 5.0, "GBP")])
    res = asyncio.run(penny_tools_module._exec_search_transactions(UID, "OpenRouter", None, None, None, None, None, as_table=True))
    note = res["_table"]["note"]
    assert "Spent USD 44.40 and £5.00" in note
    assert "£49.40" not in note and "£49.4" not in note


def test_table_note_unchanged_for_single_currency(monkeypatch):
    _install(monkeypatch, [_row(1, 10.0, "GBP")])
    res = asyncio.run(penny_tools_module._exec_search_transactions(UID, "OpenRouter", None, None, None, None, None, as_table=True))
    assert "note" not in res["_table"]


def test_tool_description_and_prompt_state_the_mixed_rule():
    desc = next(t for t in penny_tools_module.TOOL_SCHEMAS if (t.get("function") or t)["name"] == "search_transactions")
    desc = (desc.get("function") or desc)["description"]
    assert "per currency" in desc and "never one pound" in desc
    import app.services.penny_agent as agent
    assert "more than one currency" in open(agent.__file__).read()
