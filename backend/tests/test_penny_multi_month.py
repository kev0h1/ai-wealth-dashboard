"""G265: a multi-month question gets a real per-category aggregate over the
window, labelled deterministically, and the reply cannot claim a period the
tool did not return. Offline: fake collections, no network, no model.

Fixture world (today is 2026-10-11, so a 6 month window is 11 Apr to 11 Oct):
a synthetic user with a monthly Mortgage payment (Apr to Sep), a Travel
payment in August and one before the window, groceries with a refund, a custom
Padel category, shopping and eating out, plus rows that must never count:
savings moves, income, a USD payment and another user's spending.
"""
import asyncio
import json
from datetime import date, datetime

import pytest

import app.services.categories as categories_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module
import app.services.spend_verdict as spend_verdict_module
from app.services import penny_period
from app.services.penny_chart import validate_chart
from app.services.penny_table import validate_table
from tests.test_penny_category_routing import _Col
from tests.test_penny_golden_eval import _FinalResponse, _ToolCallResponse

UID = "g265-synthetic-user"
OTHER = "g265-someone-else"
TODAY = date(2026, 10, 11)
LABEL = "6 months, 11 Apr to 11 Oct"
PAY_LABEL = "this pay period, 25 Sep to 29 Oct"
MORTGAGE = 1124.44


def _row(cat, amount, when, kind="debit", custom="", uid=UID, currency="GBP", merchant="M"):
    return {"user_id": uid, "transaction_type": kind, "amount": amount, "currency": currency,
            "date": when, "category": cat, "custom_category": custom, "merchant_name": merchant,
            "description": merchant.upper(), "_id": f"{cat}-{when.isoformat()}-{amount}-{uid}-{kind}"}


def _world_rows():
    rows = [_row("Mortgage", MORTGAGE, datetime(2026, m, 28), merchant="Lender") for m in (4, 5, 6, 7, 8, 9)]
    rows += [
        _row("Travel", 879.98, datetime(2026, 8, 3), merchant="Airline"),
        _row("Travel", 200.0, datetime(2026, 3, 2), merchant="Airline"),  # before the window
        _row("Travel", 99.0, datetime(2026, 8, 4), currency="USD", merchant="Airline"),  # foreign currency
        _row("Groceries", 60.0, datetime(2026, 9, 2), merchant="Tesco"),
        _row("Groceries", 40.0, datetime(2026, 10, 2), merchant="Tesco"),
        _row("Groceries", 10.0, datetime(2026, 10, 3), kind="credit", merchant="Tesco"),  # refund, netted
        _row("Entertainment", 40.0, datetime(2026, 9, 5), custom="Padel", merchant="Court"),
        _row("Shopping", 120.0, datetime(2026, 6, 10), merchant="Shop"),
        _row("Eating Out", 30.0, datetime(2026, 5, 15), merchant="Pret"),
        _row("Savings", 500.0, datetime(2026, 9, 1), merchant="Pot"),  # movement: excluded
        _row("Income", 2000.0, datetime(2026, 9, 25), kind="credit", merchant="Employer"),  # income: excluded
        _row("Mortgage", 999.0, datetime(2026, 9, 28), uid=OTHER, merchant="Lender"),  # someone else
    ]
    return rows


@pytest.fixture
def world(monkeypatch):
    rows = _world_rows()
    for name in ("transactions_col", "yapily_transactions_col"):
        monkeypatch.setattr(spend_verdict_module, name, _Col(rows if name == "transactions_col" else []))
        monkeypatch.setattr(penny_tools_module, name, _Col(rows if name == "transactions_col" else []))
    monkeypatch.setattr(categories_module, "user_categories_col",
                        _Col([{"user_id": UID, "categories": [{"name": "Padel", "kind": "discretionary"}]}]))
    monkeypatch.setattr(penny_tools_module.timeutil, "user_today", lambda: TODAY)

    async def verdict(uid, offset=0):
        return {"period": {"start": "2026-09-25", "end": "2026-10-29"}, "notables": [],
                "majority": [{"category": "Mortgage", "spent": MORTGAGE, "payments_count": 1},
                             {"category": "Travel", "spent": 879.98, "payments_count": 1},
                             {"category": "Groceries", "spent": 30.0, "payments_count": 1}]}

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", verdict)
    return rows


def _call(args):
    return asyncio.run(penny_tools_module.execute_tool(UID, "get_category_spend", args))


def _by_cat(res):
    return {c["category"]: c for c in res["categories"]}


# ── 6 months, all categories ──────────────────────────────────────────────
def test_six_months_all_categories_is_a_real_aggregate_with_its_own_label(world):
    res = _call({"months": 6})
    assert res["period"] == {"label": LABEL, "start": "2026-04-11", "end": "2026-10-11",
                             "months": 6, "kind": "rolling_months"}
    cats = _by_cat(res)
    # the pay period alone would have said Mortgage 1 payment; the window has six
    assert cats["Mortgage"]["total"]["raw"] == round(6 * MORTGAGE, 2)
    assert cats["Mortgage"]["payments"] == 6
    assert cats["Mortgage"]["monthly_average"]["raw"] == round(6 * MORTGAGE / 6, 2)
    assert cats["Travel"]["total"]["raw"] == 879.98 and cats["Travel"]["payments"] == 1
    # custom_category wins, refunds are netted, the pre-window travel is out
    assert cats["Padel"]["total"]["raw"] == 40.0 and "Entertainment" not in cats
    assert cats["Groceries"]["total"]["raw"] == 90.0 and cats["Groceries"]["payments"] == 2
    # movements, income, foreign currency and other users never count
    assert "Savings" not in cats and "Income" not in cats
    assert res["total"]["raw"] == round(6 * MORTGAGE + 879.98 + 90.0 + 40.0 + 120.0 + 30.0, 2)
    assert res["monthly_average"]["raw"] == round(res["total"]["raw"] / 6, 2)
    ordered = [c["category"] for c in res["categories"]]
    assert ordered[0] == "Mortgage" and ordered[1] == "Travel"


def test_the_label_is_deterministic_and_handles_edges():
    assert penny_period.window_label(1, date(2026, 9, 11), date(2026, 10, 11)) == "1 month, 11 Sep to 11 Oct"
    assert penny_period.window_period(6, date(2026, 10, 11))["label"] == LABEL
    # crossing a year boundary names the years
    assert penny_period.window_period(12, date(2026, 10, 11))["label"] == "12 months, 11 Oct 2025 to 11 Oct 2026"
    # a month-end start clamps to the shorter month
    assert penny_period.window_period(1, date(2026, 3, 31))["start"] == "2026-02-28"
    assert penny_period.pay_period_period(date(2026, 9, 25), date(2026, 10, 29))["label"] == PAY_LABEL


def test_table_has_monthly_average_and_a_title_from_the_label(world):
    res = _call({"months": 6, "as_table": True, "_table_ok": True})
    table = validate_table(res["_table"])
    assert table["title"] == f"Spending by category, {LABEL}"
    assert [c["label"] for c in table["columns"]] == ["Category", "Total", "Payments", "Monthly average"]
    mortgage = next(r for r in table["rows"] if r["category"] == "Mortgage")
    assert mortgage["total"]["amount"] == round(6 * MORTGAGE, 2)
    assert mortgage["payments"] == 6 and mortgage["avg"]["amount"] == MORTGAGE
    assert "Excludes income" in table["note"]


def test_table_needs_the_loop_flag(world):
    assert "_table" not in _call({"months": 6, "as_table": True})


def test_chart_with_months_and_no_category_is_a_stacked_bar_of_top_four_plus_other(world):
    res = _call({"months": 6, "as_chart": "bar", "_chart_ok": True})
    chart = validate_chart(res["_chart"])
    assert chart["type"] == "stacked_bar"
    assert chart["title"] == f"Spending by month, {LABEL}"
    names = [s["name"] for s in chart["series"]]
    assert names == ["Mortgage", "Travel", "Shopping", "Groceries", "Other"]  # top four by total, then the rest
    months = [p["x"] for p in chart["series"][0]["points"]]
    assert months == ["Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"]
    by = {s["name"]: {p["x"]: p["y"]["amount"] for p in s["points"]} for s in chart["series"]}
    assert by["Mortgage"]["Jul 2026"] == MORTGAGE and by["Mortgage"]["Oct 2026"] == 0.0
    assert by["Travel"]["Aug 2026"] == 879.98
    assert by["Other"]["Sep 2026"] == 40.0 and by["Other"]["May 2026"] == 30.0  # Padel, Eating Out
    # every series together is the window total
    grand = sum(v for s in by.values() for v in s.values())
    assert round(grand, 2) == res["total"]["raw"]
    assert "Smaller categories grouped as Other" in chart["note"]


def test_a_line_request_becomes_the_stacked_bar_with_a_note(world):
    chart = validate_chart(_call({"months": 6, "as_chart": "line", "_chart_ok": True})["_chart"])
    assert chart["type"] == "stacked_bar" and "stacked bars" in chart["note"]


def test_a_pie_over_months_shares_the_window_by_category(world):
    chart = validate_chart(_call({"months": 6, "as_chart": "donut", "_chart_ok": True})["_chart"])
    assert chart["type"] == "donut" and chart["title"] == f"Spending by category, {LABEL}"
    shares = {p["x"]: p["y"]["amount"] for p in chart["series"][0]["points"]}
    assert shares["Mortgage"] == round(6 * MORTGAGE, 2)


def test_user_scoping_other_users_rows_are_never_read(world):
    assert _by_cat(_call({"months": 6}))["Mortgage"]["payments"] == 6  # not 7 with the other user's row


def test_months_are_clamped_and_junk_is_ignored(world):
    assert _call({"months": 99})["period"]["months"] == 24
    assert _call({"months": 0}).get("period", {}).get("kind") == "pay_period"
    assert _call({"months": "soon"}).get("period", {}).get("kind") == "pay_period"


# ── single category over 6 months ─────────────────────────────────────────
def test_single_category_over_six_months_carries_the_same_label_shape(world):
    res = _call({"category": "travel", "months": 6, "as_table": True, "_table_ok": True})
    assert res["period"]["label"] == LABEL and res["period"]["months"] == 6
    assert res["last_n_months"]["spent"]["raw"] == 880.0 or res["last_n_months"]["spent"]["raw"] == 879.98
    assert res["last_n_months"]["monthly_average"]["raw"] == round(879.98 / 6, 2)
    assert res["last_n_months"]["window"]["from"] == "2026-04-11" and res["last_n_months"]["window"]["to"] == "2026-10-11"
    assert res["this_period"]["period"]["label"] == PAY_LABEL
    table = validate_table(res["_table"])
    assert table["title"] == f"Travel by month, {LABEL}"
    assert next(r for r in table["rows"] if r["month"] == "Aug 2026")["spent"]["amount"] == 879.98


def test_single_category_chart_title_comes_from_the_label(world):
    chart = validate_chart(_call({"category": "travel", "months": 6, "as_chart": "bar", "_chart_ok": True})["_chart"])
    assert chart["title"] == f"Travel by month, {LABEL}"


# ── no months: the pay period, labelled as such ───────────────────────────
def test_no_months_is_the_current_pay_period_and_says_so(world):
    res = _call({"as_table": True, "_table_ok": True})
    assert res["period"]["label"] == PAY_LABEL and res["period"]["kind"] == "pay_period" and res["period"]["months"] is None
    assert res["period"]["start"] == "2026-09-25" and res["period"]["end"] == "2026-10-29"
    assert validate_table(res["_table"])["title"] == f"Top spending, {PAY_LABEL}"
    assert "categories" not in res and [c["category"] for c in res["top_categories"]][0] == "Mortgage"


def test_no_months_chart_is_titled_with_the_pay_period(world):
    chart = validate_chart(_call({"as_chart": "donut", "_chart_ok": True})["_chart"])
    assert chart["title"] == f"Spending by category, {PAY_LABEL}"


# ── the text-versus-period guard ──────────────────────────────────────────
@pytest.mark.parametrize("text,periods,expected,n", [
    # match: the claimed span is the returned span, left alone
    ("Your spending across the last 6 months was £9,000.", [penny_period.window_period(6, TODAY)],
     "Your spending across the last 6 months was £9,000.", 0),
    ("Over six months you spent £9,000.", [penny_period.window_period(6, TODAY)],
     "Over six months you spent £9,000.", 0),
    # mismatch: the table is this pay period, the text claims six months
    ("The table below shows your spending totals across the last 6 months",
     [penny_period.pay_period_period(date(2026, 9, 25), date(2026, 10, 29))],
     f"The table below shows your spending totals across {PAY_LABEL}", 1),
    # mismatch the other way
    ("This pay period you spent £500.", [penny_period.window_period(6, TODAY)], f"{LABEL}, you spent £500.", 1),
    ("You spent £500 this month.", [penny_period.window_period(6, TODAY)], "You spent £500 this month.", 0),
    ("Spending over the past 3 months", [penny_period.window_period(6, TODAY)], f"Spending over {LABEL}", 1),
    # no period phrase: untouched
    ("Mortgage is the biggest category at £6,747.", [penny_period.window_period(6, TODAY)],
     "Mortgage is the biggest category at £6,747.", 0),
    # an unrelated span (a promo length) is not a period claim
    ("The 0% offer runs for 12 months.", [penny_period.window_period(6, TODAY)],
     "The 0% offer runs for 12 months.", 0),
    # no tool period at all: nothing to compare with
    ("Across the last 6 months", [], "Across the last 6 months", 0),
])
def test_guard_text(text, periods, expected, n):
    assert penny_period.guard_text(text, periods) == (expected, n)


_W6 = penny_period.window_period(6, TODAY)
_P0 = penny_period.pay_period_period(date(2026, 9, 25), date(2026, 10, 29))
_PL = penny_period.pay_period_period(date(2026, 8, 25), date(2026, 9, 24), -1)
_W12 = penny_period.window_period(12, TODAY)


# True positives, negatives and the ambiguous cases the review asked for.
@pytest.mark.parametrize("text,periods,expected,n", [
    # true positives: one false claim, rewritten to a label of the right kind
    ("You spent £500 over the last 3 months.", [_W6], f"You spent £500 over {LABEL}.", 1),
    ("Across the past three months it was £900.", [_W6], f"Across {LABEL}, it was £900.", 1),
    ("Over the last 3 months you spent £5,000.", [_W6], f"Over {LABEL}, you spent £5,000.", 1),
    ("This pay period you spent £800.", [_PL], f"Last pay period, 25 Aug to 24 Sep, you spent £800.", 1),
    ("The last 6 months came to £900.", [_P0], f"This pay period, 25 Sep to 29 Oct, came to £900.", 1),
    ("Over the last year you spent £9k.", [_W6], f"Over {LABEL}, you spent £9k.", 1),
    ("The past year was £9k.", [_W6], f"The period of {LABEL}, was £9k.", 1),
    ("Your 3-month average is £400.", [_W6], f"Your average over {LABEL}, is £400.", 1),
    # a calendar month is no tool period: never relabelled
    ("This month you spent £400.", [_P0], "This month you spent £400.", 0),
    ("Last month you spent £300.", [_W6], "Last month you spent £300.", 0),
    ("In the last month you spent £300.", [_W6], "In the last month you spent £300.", 0),
    # look ahead: a repayment or cost, not the span the figures cover
    ("Over 12 months you would repay £50.", [_W6], "Over 12 months you would repay £50.", 0),
    ("Across 24 months the interest is £90.", [_W6], "Across 24 months the interest is £90.", 0),
    ("Over 12 months costs £30 in fees.", [_W6], "Over 12 months costs £30 in fees.", 0),
    # two different mismatched claims never both become one label
    ("The last 3 months were £500, but the last 4 months were £700.", [_W6],
     "The last 3 months were £500, but the last 4 months were £700.", 0),
    # negatives: the claim is backed, or is not a period claim
    ("Over the last year you spent £9k.", [_W12], "Over the last year you spent £9k.", 0),
    ("Your 6-month average is £1,500.", [_W6], "Your 6-month average is £1,500.", 0),
    ("This pay period you spent £800.", [_P0], "This pay period you spent £800.", 0),
    ("The last pay period was £700.", [_PL], "The last pay period was £700.", 0),
    ("Your 0% deal runs over 12 months.", [_W6], "Your 0% deal runs over 12 months.", 0),
    ("The contract term is across 24 months.", [_W6], "The contract term is across 24 months.", 0),
    ("You opened it 3 months ago, over the last 6 months you spent £5.", [_W6],
     "You opened it 3 months ago, over the last 6 months you spent £5.", 0),
    ("Repay it over 12 months at £100.", [_W6], "Repay it over 12 months at £100.", 0),
    ("Interest is charged during 6 months.", [_P0], "Interest is charged during 6 months.", 0),
    ("It was the last 3 months ago.", [_W6], "It was the last 3 months ago.", 0),
    # ambiguous: several different period phrases, never make a false sentence
    ("In the last 6 months you spent £5k, and this pay period £800.", [_W6],
     "In the last 6 months you spent £5k, and this pay period £800.", 0),
    ("Last pay period was higher; this pay period is lower.", [_PL],
     "Last pay period was higher; this pay period is lower.", 0),
    ("The last 3 months and this pay period.", [_W6, _P0], f"The period of {LABEL}, and this pay period.", 1),
    ("Your 3-month average beat the last 6 months.", [_W6], "Your 3-month average beat the last 6 months.", 0),
])
def test_guard_only_rewrites_unambiguous_mismatches(text, periods, expected, n):
    assert penny_period.guard_text(text, periods) == (expected, n)


def test_a_skipped_ambiguity_is_logged(caplog):
    caplog.set_level("WARNING")
    penny_period.guard_text("In the last 6 months you spent £5k, and this pay period £800.", [_W6])
    assert "penny_period_guard_skip" in caplog.text
    caplog.clear()
    penny_period.guard_text("Last pay period was higher; this pay period is lower.", [_PL])
    assert "penny_period_guard_skip" in caplog.text


def test_guard_counts_rewrites():
    before = penny_period.GUARD_REWRITES
    penny_period.guard_text("last 6 months", [penny_period.pay_period_period(date(2026, 9, 25), date(2026, 10, 29))])
    assert penny_period.GUARD_REWRITES == before + 1


class _Client:
    def __init__(self, tool_args, reply):
        self.calls, self._args, self._reply = [], tool_args, reply

    def __call__(self, *a, **k):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        if len(self.calls) == 1:
            return _ToolCallResponse("get_category_spend", "c1", self._args)
        return _FinalResponse(self._reply)


def _run_loop(monkeypatch, result, reply, caplog=None):
    client = _Client({"as_table": True}, reply)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    async def fake_exec(uid, name, args):
        return result

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_exec)
    return asyncio.run(penny_agent_module.run_penny_agent(UID, "aggregate my spending over the last 6 months", [], "spend", ""))


def _pay_result():
    return {"period": penny_period.pay_period_period(date(2026, 9, 25), date(2026, 10, 29)),
            "top_categories": [{"category": "Mortgage", "spent": {"raw": 1124.44, "formatted": "£1,124"}, "payments_count": 1}]}


def test_loop_rewrites_a_false_period_claim_to_the_tools_label(monkeypatch, caplog):
    caplog.set_level("WARNING")
    out = _run_loop(monkeypatch, _pay_result(),
                    "HEADLINE: Your last 6 months\nREPLY: The table below shows your spending totals across the last 6 months.")
    assert out["reply"] == f"The table below shows your spending totals across {PAY_LABEL}."
    assert out["headline"] == f"Your {PAY_LABEL}"
    assert "penny_period_guard_rewrite" in caplog.text


def test_loop_leaves_a_matching_claim_alone(monkeypatch, caplog):
    caplog.set_level("WARNING")
    result = {"period": penny_period.window_period(6, TODAY), "total": {"raw": 9000.0, "formatted": "£9,000"}}
    reply = f"HEADLINE: Six months\nREPLY: Across {LABEL} you spent £9,000, or the last 6 months at £1,500 a month."
    out = _run_loop(monkeypatch, result, reply)
    assert out["reply"] == f"Across {LABEL} you spent £9,000, or the last 6 months at £1,500 a month."
    assert "penny_period_guard_rewrite" not in caplog.text


def test_loop_leaves_a_reply_with_no_period_phrase_alone(monkeypatch):
    out = _run_loop(monkeypatch, _pay_result(), "HEADLINE: Biggest category\nREPLY: Mortgage is your biggest category.")
    assert out["reply"] == "Mortgage is your biggest category."


def test_loop_without_a_tool_period_does_not_rewrite(monkeypatch):
    out = _run_loop(monkeypatch, {"count": 0}, "HEADLINE: Nothing\nREPLY: Nothing across the last 6 months.")
    assert out["reply"] == "Nothing across the last 6 months."


def test_system_prompt_tells_the_model_to_state_the_label():
    p = penny_agent_module._SYSTEM_PROMPT
    assert "18. Periods" in p and "exactly as that label" in p and "months" in p


def test_tool_schema_says_months_with_no_category_aggregates():
    fn = next(t["function"] for t in penny_tools_module.TOOL_SCHEMAS if t["function"]["name"] == "get_category_spend")
    assert "every category" in fn["description"] and "period.label" in fn["description"]
    assert "aggregates every category" in fn["parameters"]["properties"]["months"]["description"]


# ── the other window-taking tools (audit) ─────────────────────────────────
def test_search_totals_cover_exactly_the_requested_range_and_say_so(monkeypatch):
    from tests.test_penny_table import _fx_rows, _install, _search
    _install(monkeypatch, _fx_rows())
    inside = _search({"q": "openrouter", "date_from": "2026-09-25", "date_to": "2026-10-10"})
    assert inside["matched_count"] == 2  # Oct 4 and Sep 28; Sep 20 is outside, the other user's row never counts
    assert inside["period"]["label"] == "25 Sep to 10 Oct" and inside["period"]["start"] == "2026-09-25"
    everything = _search({"q": "openrouter"})
    assert everything["matched_count"] == 3 and "period" not in everything
    only_from = _search({"q": "openrouter", "date_from": "2026-09-25"})
    assert only_from["matched_count"] == 2 and only_from["period"]["label"] == "from 25 Sep 2026"


def test_a_search_range_of_whole_months_claims_that_many_months():
    p = penny_period.range_period(date(2026, 4, 11), date(2026, 10, 11))
    assert p["months"] == 6
    assert penny_period.range_period(date(2026, 4, 12), date(2026, 10, 11))["months"] is None
    assert penny_period.range_period(None, None) is None


def test_spend_verdict_period_is_labelled_by_offset(monkeypatch):
    async def verdict(uid, offset=0):
        return {"period": {"start": "2026-08-25", "end": "2026-09-24"}, "notables": [], "majority": []}

    monkeypatch.setattr(penny_tools_module, "compute_spend_verdict", verdict)
    res = asyncio.run(penny_tools_module.execute_tool(UID, "get_spend_verdict", {"period_offset": -1}))
    assert res["period"]["label"] == "last pay period, 25 Aug to 24 Sep" and res["period"]["offset"] == -1
    # a "this pay period" claim does not match last period's result
    assert penny_period.guard_text("this pay period", penny_period.collect_periods(res))[1] == 1


def test_collect_periods_puts_the_headline_period_last(world):
    res = _call({"category": "travel", "months": 6})
    labels = [p["label"] for p in penny_period.collect_periods(res)]
    assert labels[-1] == LABEL and PAY_LABEL in labels


# ── fail-safe: a guard bug never costs the user their answer ──────────────
def test_guard_text_returns_the_original_if_it_raises(monkeypatch, caplog):
    def boom(text, periods):
        raise RuntimeError("guard bug")

    monkeypatch.setattr(penny_period, "_guard_text", boom)
    assert penny_period.guard_text("Across the last 3 months", [_W6]) == ("Across the last 3 months", 0)
    assert "penny_period_guard_error" in caplog.text


def test_guard_reply_returns_the_originals_if_it_raises(monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("guard bug")

    monkeypatch.setattr(penny_period, "guard_text", boom)
    assert penny_period.guard_reply("Head", "Across the last 3 months", [_W6]) == ("Head", "Across the last 3 months")
    assert "penny_period_guard_error" in caplog.text


def test_loop_completes_with_the_original_reply_if_the_guard_raises(monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("guard bug")

    monkeypatch.setattr(penny_agent_module.penny_period, "guard_reply", boom)
    out = _run_loop(monkeypatch, _pay_result(),
                    "HEADLINE: Your last 6 months\nREPLY: The table below shows totals across the last 6 months.")
    assert out["reply"] == "The table below shows totals across the last 6 months."
    assert out["headline"] == "Your last 6 months" and out["tools_used"] == ["get_category_spend"]
    assert "penny_period_guard_error at call site" in caplog.text


def test_prose_fallback_survives_a_raising_guard(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("guard bug")

    monkeypatch.setattr(penny_agent_module.penny_period, "guard_reply", boom)
    assert penny_agent_module._guarded("Totals across the last 6 months.", [_W6], "u") == "Totals across the last 6 months."
