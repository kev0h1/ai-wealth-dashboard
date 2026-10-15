"""G278: provider anchor, statement-period growth, fee classification, every
holding listed. Kevin's UAT shape of data as fixtures only; fake collections,
no Mongo, no network."""
import asyncio
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).parent))

import app.routers.investments as router  # noqa: E402
import app.services.investment_anchor as ia  # noqa: E402
import app.services.investment_growth as ig  # noqa: E402
from test_investment_growth_g271 import Col  # noqa: E402

TODAY = date(2026, 10, 15)
STMT = date(2026, 9, 4)
USER = "u@x.com"
FTSE = "Vanguard FTSE Global All Cap Index Fund Accumulation"
FTSE_KEY = "NAME:ftse"
SP = "S&P 500 UCITS ETF"
SP_KEY = ig.instrument_key(None, None, SP)
NOTE_FTSE_KEY = ig.instrument_key(None, None, FTSE)


def _dt(d):
    return datetime.combine(d, datetime.min.time())


def _note(i, amount, d, name=FTSE, units=None, kind=None, **extra):
    kind = kind or ("sale" if amount < 0 else "purchase")
    return {"_id": i, "account_id": "a1", "user_id": USER, "trade_date": _dt(d), "kind": kind,
            "amount": amount, "fund_name": name, "units": units, **extra}


def kevin_notes():
    return [
        _note("n0", -11.48, date(2026, 6, 5), units=0.04),
        _note("n1", 400.0, date(2026, 7, 1), units=1.3762),
        _note("n2", 400.0, date(2026, 8, 3), units=1.35),
        _note("n3", 400.0, date(2026, 9, 4), units=1.34),
        _note("n4", 400.0, date(2026, 10, 6), units=1.35),
        _note("n5", 4908.98, date(2026, 10, 13), SP, units=43.0),
    ]


def kevin_holdings():
    return [
        {"_id": "h1", "account_id": "a1", "user_id": USER, "name": FTSE, "isin": None, "instrument_key": FTSE_KEY,
         "units": 50.32, "statement_value": 14835.59, "book_cost": None},
        {"_id": "h2", "account_id": "a1", "user_id": USER, "name": "Cash", "type": "Cash", "isin": None,
         "instrument_key": "NAME:cash", "units": None, "statement_value": 0.06, "book_cost": None},
    ]


def kevin_period():
    return {
        "opening_value": 13170.84, "opening_date": "2026-06-05", "closing_value": 14835.65, "closing_date": "2026-09-04",
        "payments_in": 1200.0, "payments_in_shown": True,
        "payments_in_lines": [{"date": "2026-07-01", "amount": 400.0}, {"date": "2026-08-03", "amount": 400.0},
                              {"date": "2026-09-04", "amount": 400.0}],
        "withdrawals": 0.0, "withdrawal_lines": [], "fees": 12.0, "fee_lines": [{"date": "2026-06-05", "amount": 12.0}],
        "interest": 0.0,
        "purchases": [{"date": "2026-07-01", "fund_name": FTSE, "units": 1.3762, "amount": 400.0},
                      {"date": "2026-08-03", "fund_name": FTSE, "units": 1.35, "amount": 400.0},
                      {"date": "2026-09-04", "fund_name": FTSE, "units": 1.34, "amount": 400.0}],
    }


def _insts(ftse=300.0, sp=112.46):
    ex = lambda k, p: {"_id": k, "price": p, "price_date": TODAY.isoformat()}  # noqa: E731
    return {FTSE_KEY: ex(FTSE_KEY, ftse), NOTE_FTSE_KEY: ex(NOTE_FTSE_KEY, ftse), SP_KEY: ex(SP_KEY, sp)}


ANCHOR_IN = {"date": "2026-10-15", "provider_value": 20313.61, "provider_return": 1341.92,
             "provider_rate_of_return_pct": 14.61}


def _anchor(**over):
    a = ia.validate_anchor({**ANCHOR_IN, **over}, TODAY)
    a["entered_at"] = "2026-10-15T09:00:00"
    return a


# ── anchor maths ─────────────────────────────────────────────────────────

def test_anchor_net_paid_in_is_value_minus_return():
    a = _anchor()
    assert ia.anchor_net_paid_in(a) == 18971.69
    assert a["source"] == "user" and a["provider_rate_of_return_pct"] == 14.61


def test_anchor_accepts_total_paid_in_instead_of_return():
    a = ia.validate_anchor({"date": "2026-10-15", "provider_value": 20313.61, "total_paid_in": 18971.69}, TODAY)
    assert ia.anchor_net_paid_in(a) == 18971.69 and a["provider_return"] is None


@pytest.mark.parametrize("bad", [
    {"provider_value": -5}, {"provider_value": "x"}, {"provider_value": float("nan")},
    {"date": "2026-10-16"}, {"date": "nope"}, {"date": "1999-01-01"},
    {"total_paid_in": 100.0},                      # both return and total paid in
    {"provider_return": None},                     # neither
    {"provider_return": 99999999.0},               # negative paid in
    {"provider_rate_of_return_pct": "abc"}, {"provider_rate_of_return_pct": -150},
])
def test_anchor_validation_rejects(bad):
    with pytest.raises(ValueError):
        ia.validate_anchor({**ANCHOR_IN, **bad}, TODAY)


def test_lifetime_gain_at_the_anchor_matches_our_value_minus_net_paid_in():
    life = ia.build_lifetime(_anchor(), 20342.64, [], [], TODAY, "Vanguard", 20342.64)
    assert life["net_paid_in_at_anchor"] == 18971.69 and life["paid_in"] == 18971.69
    assert life["growth_abs"] == 1370.95
    assert life["rate_of_return"] == {"pct": 14.61, "as_of": "2026-10-15", "label": "from Vanguard",
                                      "note": "Money-weighted, as shown by your provider. Sorted does not recompute it."}


def test_contribution_after_the_anchor_is_tracked_forward():
    notes = [_note("n6", 400.0, date(2026, 10, 20))]
    today = date(2026, 10, 21)
    life = ia.build_lifetime(_anchor(), 20742.64, notes, [], today, "Vanguard", 20342.64)
    assert life["paid_in_after"] == 400.0 and life["paid_in"] == 19371.69
    assert life["growth_abs"] == 1370.95  # a contribution is not growth


def test_notes_on_or_before_the_anchor_date_are_not_counted_again():
    notes = [_note("n6", 400.0, date(2026, 10, 15)), _note("n7", 400.0, date(2026, 10, 6))]
    life = ia.build_lifetime(_anchor(), 20342.64, notes, [], TODAY, "Vanguard", 20342.64)
    assert life["paid_in_after"] == 0.0


def test_withdrawal_after_the_anchor_lowers_paid_in():
    sale = _note("n8", -1000.0, date(2026, 10, 20), units=3.0, kind="sale")
    life = ia.build_lifetime(_anchor(), 19342.64, [sale], [], date(2026, 10, 21), "Vanguard", 20342.64)
    assert life["withdrawn_after"] == 1000.0 and life["paid_in"] == 17971.69
    assert life["growth_abs"] == 1370.95


def test_a_fee_after_the_anchor_is_neither_a_contribution_nor_a_withdrawal():
    fee = _note("n9", -3.0, date(2026, 10, 20), kind="fee")
    life = ia.build_lifetime(_anchor(), 20339.64, [fee], [], date(2026, 10, 21), "Vanguard", 20342.64)
    assert life["withdrawn_after"] == 0.0 and life["growth_abs"] == 1367.95  # the fee is part of growth


def test_reanchoring_replaces_and_keeps_history():
    first = _anchor()
    second = _anchor(date="2026-10-15", provider_value=20400.0, provider_return=1400.0)
    second["entered_at"] = "2026-10-16T09:00:00"
    new, hist = ia.replace_anchor(first, second, [])
    assert new["provider_value"] == 20400.0 and len(hist) == 1
    assert hist[0]["provider_value"] == 20313.61 and hist[0]["replaced_at"] == "2026-10-16T09:00:00"
    assert ia.anchor_net_paid_in(new) == 19000.0


def test_reconciliation_line_names_both_values():
    life = ia.build_lifetime(_anchor(), 20342.64, [], [], TODAY, "Vanguard", 20342.64)
    rc = life["reconciliation"]
    assert rc["ours"] == 20342.64 and rc["provider_value"] == 20313.61 and rc["difference"] == 29.03
    none = ia.build_lifetime(_anchor(provider_value=20342.64, provider_return=1370.95), 20342.64, [], [], TODAY, "Vanguard", 20342.64)
    assert none["reconciliation"] is None


# ── account level: Kevin's shape ─────────────────────────────────────────

def _patch(monkeypatch, acc, notes=None, holdings=None, insts=None):
    monkeypatch.setattr(ig, "investment_valuations_col", Col())
    monkeypatch.setattr(ig, "investment_holdings_col", Col(holdings if holdings is not None else kevin_holdings()))
    monkeypatch.setattr(ig, "investment_notes_col", Col(notes if notes is not None else kevin_notes()))
    ins = insts or _insts()

    async def _get(keys):
        return ins
    monkeypatch.setattr(ig, "get_instruments", _get)
    monkeypatch.setattr(ig, "user_today", lambda: TODAY)
    return acc


def kevin_acc(**extra):
    return {"_id": "a1", "user_id": USER, "provider": "Vanguard", "account_type": "ISA", "currency": "GBP",
            "total_value": 14835.65, "statement_date": _dt(STMT), "statement_periods": [kevin_period()], **extra}


def test_every_holding_is_listed_including_the_etf_created_by_a_note(monkeypatch):
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc()), "all"))
    names = {h["name"]: h for h in g["holdings"]}
    assert set(names) == {FTSE, "Cash", SP}
    etf = names[SP]
    assert etf["units"] == 43.0 and etf["price"] == 112.46 and etf["value"] == round(43 * 112.46, 2)
    assert etf["gain_abs"] == round(43 * 112.46 - 4908.98, 2)
    ftse = names[FTSE]
    assert ftse["units"] == round(50.32 + 1.35, 4) and ftse["price"] == 300.0
    assert names["Cash"]["units"] is None


def test_etf_without_a_price_reads_no_price_yet(monkeypatch):
    insts = _insts()
    del insts[SP_KEY]
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc(), insts=insts), "all"))
    etf = next(h for h in g["holdings"] if h["name"] == SP)
    assert etf["price"] is None and etf["units"] == 43.0 and etf["value"] == 4908.98


def test_value_is_priced_and_header_difference_is_named(monkeypatch):
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc(total_value=15096.06)), "all"))
    expect = round(50.32 * 300.0 + 0.06 + 1.35 * 300.0 + 43 * 112.46, 2)
    assert g["value"] == expect
    header = round(15096.06 + 400 + 4908.98, 2)
    assert g["header_value"] == header
    assert g["value_note_kind"] == "notes_at_cost" and "value_note" not in g


def test_lifetime_is_primary_and_uses_the_anchor(monkeypatch):
    acc = kevin_acc(total_value=15096.06, anchor=_anchor())
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, acc), "all"))
    life = g["lifetime"]
    assert life["net_paid_in_at_anchor"] == 18971.69 and life["paid_in_after"] == 0.0
    assert life["growth_abs"] == round(g["value"] - 18971.69, 2)
    assert life["rate_of_return"]["label"] == "from Vanguard"
    assert life["reconciliation"]["provider_value"] == 20313.61
    assert "Vanguard showed £20,313.61 on 15 Oct" in life["reconciliation"]["text"]
    assert g["method_label"] == "Simple gain, not a time-weighted return"


def test_use_provider_value_is_a_display_override_for_that_date_only(monkeypatch):
    acc = kevin_acc(total_value=15096.06, anchor={**_anchor(), "use_provider_value": True})
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, acc), "all"))
    assert g["value"] == 20313.61 and g["value_source"] == "provider"
    assert g["lifetime"]["growth_abs"] == 1341.92  # the provider's own return
    # the next day the override no longer applies, and nothing was rewritten
    nxt = date(2026, 10, 16)
    monkeypatch.setattr(ig, "user_today", lambda: nxt)
    g2 = asyncio.run(ig.account_growth(acc, "all", nxt))
    assert g2["value_source"] == "sorted" and g2["value"] != 20313.61
    assert acc["anchor"]["provider_value"] == 20313.61


def test_no_anchor_means_no_lifetime(monkeypatch):
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc()), "all"))
    assert g["lifetime"] is None and g["anchor"] is None


def test_since_statement_growth_excludes_paid_in(monkeypatch):
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc(total_value=15096.06)), "all"))
    ss = g["since_statement"]
    assert ss["closing_value"] == 14835.65 and ss["paid_in"] == 5308.98
    assert ss["growth_abs"] == round(g["value"] - 14835.65 - 5308.98, 2)


# ── statement periods ────────────────────────────────────────────────────

def test_period_growth_is_closing_minus_opening_minus_payments_in():
    g = ia.period_growth(kevin_period())
    assert g["growth_abs"] == 464.81  # 14,835.65 - 13,170.84 - 1,200
    assert g["fees"] == 12.0 and g["interest"] == 0.0
    assert g["before_fees_and_interest"] == 476.81
    assert g["from"] == "2026-06-05" and g["to"] == "2026-09-04"


def test_period_with_no_opening_value_reports_no_growth_never_an_estimate():
    p = {**kevin_period(), "opening_value": None}
    assert ia.period_growth(p) is None and ia.chain_periods([p]) is None


def test_periods_chain_only_when_contiguous():
    a = kevin_period()
    b = {**a, "opening_value": 14835.65, "opening_date": "2026-09-04", "closing_value": 15500.0,
         "closing_date": "2026-12-04", "payments_in": 600.0, "fees": 12.0, "interest": 1.0}
    chain = ia.chain_periods([a, b])
    assert chain["periods"] == 2 and chain["growth_abs"] == round(464.81 + (15500 - 14835.65 - 600), 2)
    assert chain["from"] == "2026-06-05" and chain["to"] == "2026-12-04"
    gap = {**b, "opening_date": "2026-10-20"}
    assert ia.chain_periods([a, gap])["periods"] == 1


def test_period_upsert_is_idempotent_and_clean_period_never_estimates():
    p = kevin_period()
    once = ia.upsert_period([], p)
    twice = ia.upsert_period(once, dict(p))
    assert len(twice) == 1
    parsed = {"period": {"opening_value": "n/a", "purchases": [
        {"date": "2026-07-01", "fund_name": FTSE, "units": 1.3762, "amount": -400.0},
        {"date": None, "fund_name": FTSE, "units": 1.0, "amount": 5},       # no date: skipped
        {"date": "2026-07-02", "fund_name": "", "units": 1.0, "amount": 5}, # no name: skipped
    ], "fees": [{"date": "2026-06-05", "amount": -12.0}]}}
    cp = ia.clean_period(parsed, 14835.65, date(2026, 9, 4))
    assert cp["opening_value"] is None and cp["purchases"] == [
        {"date": "2026-07-01", "fund_name": FTSE, "units": 1.3762, "amount": 400.0}]
    assert cp["fees"] == 12.0 and ia.clean_period({}, 1.0, None) is None


def test_per_purchase_gain_uses_units_times_todays_price_and_dedupes(monkeypatch):
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc()), "all"))
    buys = g["purchases"]
    # three statement lines, the same three notes (de-duplicated), 6 Oct and the ETF; the fee is not a purchase
    assert len(buys) == 5 and all(b["amount"] > 0 for b in buys)
    first = next(b for b in buys if b["date"] == "2026-07-01")
    assert first["gain_abs"] == round(1.3762 * 300.0 - 400.0, 2)
    etf = next(b for b in buys if b["fund_name"] == SP)
    assert etf["gain_abs"] == round(43 * 112.46 - 4908.98, 2)


# ── fee classification ───────────────────────────────────────────────────

def test_fee_driven_sale_is_a_fee_not_a_purchase_or_withdrawal():
    fee_lines = kevin_period()["fee_lines"]
    n = _note("n0", -11.48, date(2026, 6, 5), units=0.04)
    assert ia.is_fee_note(n, fee_lines) is True            # matches a statement fee line
    assert ia.is_fee_note(n, []) is False                  # no fee context at all
    assert ia.is_fee_note({**n, "kind": "fee"}, []) is True
    assert ia.is_fee_note({**n, "description": "Account fee"}, []) is True
    assert ia.is_fee_note(_note("p", 400.0, date(2026, 7, 1)), fee_lines) is False  # a purchase never is
    big = _note("b", -900.0, date(2026, 6, 5))
    assert ia.is_fee_note(big, fee_lines) is False         # a real withdrawal is not a fee


def test_fee_note_lowers_value_but_not_cost_or_paid_in():
    h = [{"_id": "h1", "account_id": "a1", "name": FTSE, "instrument_key": FTSE_KEY, "units": 10.0,
          "statement_value": 3000.0, "book_cost": 2500.0}]
    fee = _note("f", -12.0, date(2026, 9, 10), units=0.04, kind="fee")
    pos = ig.build_positions(STMT, h, [fee], _insts(), [])
    row = pos["rows"][0]
    assert row["cost"] == 2500.0 and row["value"] == 3000.0 - 12.0 and row["units"] == 9.96
    assert pos["paid_in"] == 2500.0


def test_header_paid_in_since_excludes_a_fee():
    acc = kevin_acc()
    notes = kevin_notes() + [_note("f", -12.0, date(2026, 10, 10), units=0.04, kind="fee")]
    d = asyncio.run(router._investment_display(acc, notes))
    assert d["paid_in_since"] == 5308.98 and d["added_since"] == round(5308.98 - 12.0, 2)


# ── endpoints: user scoping, set, re-anchor, clear, override ─────────────

@pytest.fixture
def api(monkeypatch):
    accs = Col([kevin_acc(), {**kevin_acc(), "_id": "b1", "user_id": "other@x.com"}])
    monkeypatch.setattr(router, "investment_accounts_col", accs)
    _patch(monkeypatch, None)
    return accs


def _run(coro):
    return asyncio.run(coro)


def test_anchor_endpoints_are_user_scoped(api):
    other = {"email": "other@x.com"}
    for call in (
        lambda: router.set_investment_anchor("a1", dict(ANCHOR_IN), other),
        lambda: router.clear_investment_anchor("a1", other),
        lambda: router.set_anchor_override("a1", {"use_provider_value": True}, other),
    ):
        with pytest.raises(HTTPException) as e:
            _run(call())
        assert e.value.status_code == 404
    assert "anchor" not in api.docs["a1"]


def test_set_reanchor_clear_flow(api):
    me = {"email": USER}
    out = _run(router.set_investment_anchor("a1", dict(ANCHOR_IN), me))
    assert out["lifetime"]["net_paid_in_at_anchor"] == 18971.69
    stored = api.docs["a1"]["anchor"]
    assert stored["source"] == "user" and stored["entered_at"]
    _run(router.set_investment_anchor("a1", {**ANCHOR_IN, "provider_value": 20400.0, "provider_return": 1400.0}, me))
    assert api.docs["a1"]["anchor"]["provider_value"] == 20400.0
    assert len(api.docs["a1"]["anchor_history"]) == 1
    assert api.docs["a1"]["anchor_history"][0]["provider_value"] == 20313.61
    on = _run(router.set_anchor_override("a1", {"use_provider_value": True}, me))
    assert on["value_source"] == "provider"
    with pytest.raises(HTTPException) as e:
        _run(router.set_anchor_override("a1", {"use_provider_value": "yes"}, me))
    assert e.value.status_code == 422
    cleared = _run(router.clear_investment_anchor("a1", me))
    assert cleared["lifetime"] is None and "anchor" not in api.docs["a1"]
    assert len(api.docs["a1"]["anchor_history"]) == 2
    assert api.docs["b1"].get("anchor") is None


def test_anchor_endpoint_rejects_bad_input_with_a_sentence(api):
    with pytest.raises(HTTPException) as e:
        _run(router.set_investment_anchor("a1", {**ANCHOR_IN, "provider_value": -1}, {"email": USER}))
    assert e.value.status_code == 422 and "value" in e.value.detail
    with pytest.raises(HTTPException):
        _run(router.set_anchor_override("a1", {"use_provider_value": True}, {"email": USER}))  # no anchor yet


def test_holdings_endpoint_lists_the_note_only_etf(api, monkeypatch):
    monkeypatch.setattr(router, "investment_holdings_col", Col(kevin_holdings()))
    monkeypatch.setattr(router, "investment_notes_col", Col(kevin_notes()))
    monkeypatch.setattr(router, "get_instruments", ig.get_instruments)  # the patched, in-memory prices
    out = _run(router.get_investment_holdings("a1", {"email": USER}))
    names = [o["name"] for o in out]
    assert SP in names and FTSE in names and "Cash" in names
    etf = next(o for o in out if o["name"] == SP)
    assert etf["units"] == 43.0 and etf["current_price"] == 112.46 and etf["from_contract_notes"] is True
    assert etf["gain_abs"] == round(43 * 112.46 - 4908.98, 2)


def test_anchor_is_erased_with_the_account():
    # the anchor lives on the investment_accounts document, which erase_user already sweeps by user_id
    from app.db.collections import ERASURE_MANIFEST
    assert "investment_accounts_col" in ERASURE_MANIFEST


# ── Penny ────────────────────────────────────────────────────────────────

def test_penny_tool_leads_with_the_anchor_and_labels_the_provider_rate(monkeypatch):
    import app.db.collections as colls
    import app.services.penny_tools as pt
    from test_investment_growth_g271 import _Cur
    acc = kevin_acc(total_value=15096.06, anchor=_anchor())

    class _AccCol:
        def find(self, filt=None, proj=None):
            return _Cur([acc])
    monkeypatch.setattr(colls, "investment_accounts_col", _AccCol())
    _patch(monkeypatch, acc)
    direct = asyncio.run(ig.account_growth(acc, "all"))
    out = asyncio.run(pt.execute_tool(USER, "get_investment_growth", {}))
    row = out["accounts"][0]
    assert row["basis"] == "anchor"
    assert row["growth"]["raw"] == direct["lifetime"]["growth_abs"]
    assert row["paid_in"]["raw"] == direct["lifetime"]["paid_in"]
    assert row["rate_of_return"]["label"] == "from Vanguard" and row["rate_of_return"]["formatted"] == "+14.61%"
    assert "Vanguard showed £20,313.61" in row["reconciliation"]
    assert "since_statement" in row and row["statement_periods"]["growth"]["raw"] == 464.81
    assert row["purchases"] and "Capital at risk" in out["capital_at_risk"]


def test_parser_prompts_ask_for_the_period_and_the_fee_kind():
    import inspect
    import app.services.pdf as pdf
    st = inspect.getsource(pdf.llm_parse_investment_statement)
    for needle in ('"period"', "opening_value", "payments_in", "purchases", "Never estimate"):
        assert needle in st
    assert "'fee'" in inspect.getsource(pdf.llm_parse_contract_note)


# ── re-parse script ─────────────────────────────────────────────────────

def test_reparse_script_is_honest_about_what_is_stored():
    sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
    import reparse_investment_statements as rp
    accs = [{"_id": "a"}, {"_id": "b", "statement_text": "x"}, {"_id": "c", "statement_periods": [kevin_period()]}]
    p = rp.plan(accs)
    assert p == {"has_period": ["c"], "has_text": ["b"], "needs_reupload": ["a"]}
    import inspect
    assert "does not keep the PDF" in inspect.getsource(rp)
    # the upload itself stores no text: nothing in investment_upload writes statement_text
    assert "statement_text" not in inspect.getsource(router.investment_upload)


def test_undated_statement_lines_are_counted_not_silently_lost(monkeypatch):
    p = kevin_period()
    p["payments_in_lines"] = p["payments_in_lines"] + [{"date": None, "amount": 250.0}]
    g = asyncio.run(ig.account_growth(_patch(monkeypatch, kevin_acc(statement_periods=[p])), "all"))
    assert g["undated_payment_lines"] == 1
    # an undated line is never counted as a contribution after the anchor
    life = ia.build_lifetime(_anchor(date="2026-06-01", provider_value=14000.0, provider_return=500.0), 15000.0, [], [p], date(2026, 9, 10), "Vanguard", None)
    assert life["paid_in_after"] == 1200.0


def test_display_flags_whether_the_statement_was_read_for_periods():
    d = asyncio.run(router._investment_display(kevin_acc(), []))
    assert d["has_statement_periods"] is True
    bare = {k: v for k, v in kevin_acc().items() if k != "statement_periods"}
    assert asyncio.run(router._investment_display(bare, []))["has_statement_periods"] is False
