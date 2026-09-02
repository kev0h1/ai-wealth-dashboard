"""Synthetic-fixture tests for the Money Shape engine's pure functions.

No DB involved — bucket_period/shares_of/verdict_for/trend_line_for/
average_for_window/average_verdict_for/evaluate_patterns/proposal_for all
take plain dicts, per app/services/money_shape.py's module docstring.
"""
from datetime import date

from app.services.categories import BUILTIN_CATEGORY_KINDS
from app.services.money_shape import (
    _build_jobs,
    average_for_window,
    average_verdict_for,
    bucket_period,
    evaluate_patterns,
    proposal_for,
    shares_of,
    trend_line_for,
    verdict_for,
)

KINDS = BUILTIN_CATEGORY_KINDS
SAVING_IDS = {"savings1"}


def txn(_id, amount, category, date_str, account_id="current", is_debit=True):
    return {
        "_id": _id,
        "amount": amount,
        "category": category,
        "date": date_str,
        "account_id": account_id,
        "is_debit": is_debit,
    }


# ── bucket_period ─────────────────────────────────────────────────────────────

def test_bucket_period_splits_income_fixed_free_moved_left():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 2000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 800.0, "Bills", "2026-07-02"),
        txn("t3", 150.0, "Eating Out", "2026-07-10"),
        # type1: Savings-category debit on a non-savings account
        txn("t4", 300.0, "Savings", "2026-07-03"),
        # Investment debit, not category "Savings" so not type1 -> counted via the extra clause
        txn("t5", 100.0, "Investment", "2026-07-15"),
        # Credit-card payment and bare Transfer: excluded from every job
        txn("t6", 200.0, "Debt", "2026-07-05"),
        txn("t7", 50.0, "Transfer", "2026-07-06"),
        # type2: unmatched credit landing on the savings account
        txn("t8", 500.0, "Transfer", "2026-07-20", account_id="savings1", is_debit=False),
        # withdrawal from the savings account -- movement-kind category, so
        # excluded from fixed/free just like Debt/Transfer everywhere else
        txn("t9", 50.0, "Transfer", "2026-07-25", account_id="savings1"),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["take_home"] == 2000.0
    assert b["fixed"] == 800.0
    assert b["free"] == 150.0
    assert b["moved"] == 300.0 + 100.0 + 500.0
    assert b["left_raw"] == 2000.0 - 800.0 - 150.0 - 900.0
    assert b["left"] == b["left_raw"]
    assert b["overspent"] == 0.0
    assert sum(b["shares"].values()) == 100


def test_bucket_period_investment_debit_counted_once_in_moved():
    """Investment-category debits are added to moved on top of the saving
    flow. type1 is strictly `category == "Savings"` debits (classify_saving_flow),
    so an Investment-category debit can never land in type1 too -- one field,
    one value, the filters are mutually exclusive by construction. There is
    no reachable path where the same transaction is both type1 and this
    "Investment extra" clause, so no id-based dedupe is needed here."""
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 1000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 300.0, "Investment", "2026-07-03"),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["moved"] == 300.0
    assert b["take_home"] == 1000.0


def test_bucket_period_income_credit_on_savings_account_counted_once_in_moved_not_take_home():
    """HIGH regression: a credit categorised Income that lands directly on a
    savings/ISA account (payday transfer straight into savings, refund into
    an ISA, etc.) is money MOVED, not money arriving -- it must be counted
    once, as moved (type2), and excluded from take_home even though its
    category kind is income."""
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 500.0, "Income", "2026-07-05", account_id="savings1", is_debit=False),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["take_home"] == 0.0
    assert b["moved"] == 500.0


def test_bucket_period_income_on_current_plus_matched_savings_transfer_each_counted_once():
    """Ordinary payday income landing on the current account, plus a
    same-day-ish matched transfer into savings (type1 debit + its mirror
    credit on the savings account), must count the income once (take_home)
    and the transfer once (moved via type1) -- the matched savings-side
    credit is neither type2 nor income."""
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 1000.0, "Income", "2026-07-01", account_id="current", is_debit=False),
        txn("t2", 300.0, "Savings", "2026-07-03", account_id="current"),  # type1
        # mirror credit on the savings account, matched to t2 by amount/date
        txn("t3", 300.0, "Other", "2026-07-04", account_id="savings1", is_debit=False),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["take_home"] == 1000.0
    assert b["moved"] == 300.0


def test_bucket_period_overspent_clamps_left_to_zero():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 1000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 700.0, "Bills", "2026-07-02"),
        txn("t3", 500.0, "Eating Out", "2026-07-10"),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["left"] == 0.0
    assert b["overspent"] == 200.0
    assert b["left_raw"] == -200.0
    assert sum(b["shares"].values()) == 100
    assert b["shares"]["left"] == 0


def test_bucket_period_out_of_range_transactions_excluded():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 1000.0, "Income", "2026-06-30", is_debit=False),  # before period
        txn("t2", 1000.0, "Income", "2026-08-01", is_debit=False),  # after period
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["take_home"] == 0.0


# ── per-job category evidence ─────────────────────────────────────────────────

def _jobs_from_hero(hero: dict) -> list[dict]:
    """Mirrors the jobs-list assembly in compute_money_shape exactly (kept in
    sync deliberately) so the "categories"/"txn_type" contract can be tested
    without a DB."""
    return [
        {"id": "fixed", "amount": round(hero["fixed"], 2), "share": hero["shares"]["fixed"],
         "categories": hero["categories"]["fixed"], "txn_type": "debit"},
        {"id": "moved", "amount": round(hero["moved"], 2), "share": hero["shares"]["moved"],
         "categories": hero["categories"]["moved"], "txn_type": "debit"},
        {"id": "free", "amount": round(hero["free"], 2), "share": hero["shares"]["free"],
         "categories": hero["categories"]["free"], "txn_type": "debit"},
        {"id": "left", "amount": round(hero["left"], 2), "share": hero["shares"]["left"],
         "categories": hero["categories"]["left"], "txn_type": "credit"},
    ]


def test_jobs_carry_category_evidence_and_correct_txn_type_per_job():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 2000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 800.0, "Bills", "2026-07-02"),
        txn("t3", 150.0, "Eating Out", "2026-07-10"),
        txn("t4", 300.0, "Savings", "2026-07-03"),   # type1 -> moved
        txn("t5", 100.0, "Investment", "2026-07-15"),  # investment extra -> moved
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    jobs = _jobs_from_hero(b)
    by_id = {j["id"]: j for j in jobs}

    assert by_id["fixed"]["categories"] == ["Bills"]
    assert by_id["free"]["categories"] == ["Eating Out"]
    assert set(by_id["moved"]["categories"]) == {"Savings", "Investment"}
    assert by_id["left"]["categories"] == ["Income"]

    assert by_id["fixed"]["txn_type"] == "debit"
    assert by_id["moved"]["txn_type"] == "debit"
    assert by_id["free"]["txn_type"] == "debit"
    assert by_id["left"]["txn_type"] == "credit"


def test_moved_categories_exclude_income_kind_salary_landing_in_savings_account():
    """Reproduces the drill-through bug: a salary credit that lands directly
    on the savings/ISA account (categorised "Income" by the categoriser) is
    money MOVED -- its amount counts in the moved total -- but it must NOT
    appear in moved.categories, or /transactions?categories=Income&... would
    list the user's salary as spend moved to savings. left.categories must
    still list "Income" from the ordinary payday credit that actually made
    take_home."""
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        # salary mistakenly landing straight in the savings account -> type2,
        # category "Income" (INCOME kind), excluded from take_home already,
        # and now must ALSO be excluded from moved's category list.
        txn("t1", 500.0, "Income", "2026-07-05", account_id="savings1", is_debit=False),
        # a genuine movement-kind transfer -> type1, category "Savings"
        txn("t2", 300.0, "Savings", "2026-07-03", account_id="current"),
        # ordinary payday income on the current account -> take_home
        txn("t3", 1000.0, "Income", "2026-07-01", account_id="current", is_debit=False),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["moved"] == 300.0 + 500.0  # amount still counts both contributions
    assert b["categories"]["moved"] == ["Savings"]
    assert b["take_home"] == 1000.0
    assert b["categories"]["left"] == ["Income"]


def test_moved_categories_empty_when_only_contribution_is_non_movement_kind():
    """Same bug, but with no legitimate movement-kind contribution at all --
    moved.categories must be [] even though the moved amount is > 0."""
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 500.0, "Income", "2026-07-05", account_id="savings1", is_debit=False),
        txn("t2", 800.0, "Income", "2026-07-01", account_id="current", is_debit=False),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["moved"] == 500.0
    assert b["categories"]["moved"] == []
    assert b["take_home"] == 800.0
    assert b["categories"]["left"] == ["Income"]


def test_job_categories_sorted_by_contribution_descending():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 2000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 100.0, "Groceries", "2026-07-02"),
        txn("t3", 500.0, "Bills", "2026-07-03"),
        txn("t4", 300.0, "Transport", "2026-07-04"),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    # Groceries/Bills/Transport are all COMMITMENT (fixed); order must follow
    # summed contribution descending: Bills 500 > Transport 300 > Groceries 100.
    assert b["categories"]["fixed"] == ["Bills", "Transport", "Groceries"]


def test_moved_categories_include_investment_only_when_present():
    start, end = date(2026, 7, 1), date(2026, 7, 31)
    txns = [
        txn("t1", 1000.0, "Income", "2026-07-01", is_debit=False),
        txn("t2", 200.0, "Savings", "2026-07-03"),
    ]
    b = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    assert b["categories"]["moved"] == ["Savings"]


# ── shares_of ─────────────────────────────────────────────────────────────────

def test_shares_of_largest_remainder_sums_to_100():
    # 40 / 45 / 7.5 / 7.5 -- ties broken by dict insertion order (fixed,
    # moved, free, left), so free gets the remainder point ahead of left.
    shares = shares_of(fixed=800.0, moved=900.0, free=150.0, left=150.0, overspent=0.0)
    assert shares == {"fixed": 40, "moved": 45, "free": 8, "left": 7}
    assert sum(shares.values()) == 100


def test_shares_of_overspent_uses_fixed_moved_free_as_denominator():
    shares = shares_of(fixed=700.0, moved=0.0, free=500.0, left=0.0, overspent=200.0)
    assert sum(shares.values()) == 100
    assert shares["left"] == 0


def test_shares_of_zero_total_is_all_zero():
    assert shares_of(0.0, 0.0, 0.0, 0.0, 0.0) == {"fixed": 0, "moved": 0, "free": 0, "left": 0}


# ── verdict_for ───────────────────────────────────────────────────────────────

def test_verdict_for_normal():
    assert verdict_for(40, 8, 0.0) == (
        "Of every £100 you take home, £40 is spoken for before you choose anything. "
        "£8 is yours to spend freely."
    )


def test_verdict_for_overspent():
    assert verdict_for(58, 42, 200.0) == (
        "Of every £100 you take home, £58 was spoken for before you chose anything, "
        "and spending went £200 past what came in."
    )


# ── trend_line_for ────────────────────────────────────────────────────────────

def test_trend_line_none_below_three_periods():
    assert trend_line_for([40, 42]) is None


def test_trend_line_up_at_threshold():
    assert trend_line_for([40, 41, 43]) == "Fixed share is up 3 points over three pay periods."


def test_trend_line_down_at_threshold():
    assert trend_line_for([43, 41, 40]) == "Fixed share is down 3 points over three pay periods."


def test_trend_line_steady_below_threshold():
    assert trend_line_for([40, 41, 42]) == "Fixed share has held steady over three pay periods."


def test_trend_line_n_words_six():
    assert trend_line_for([40, 41, 42, 43, 44, 50]) == (
        "Fixed share is up 10 points over six pay periods."
    )


def test_trend_line_uses_digits_above_six():
    fixed_shares = [30] * 11 + [45]  # n=12, delta=15
    assert trend_line_for(fixed_shares) == "Fixed share is up 15 points over 12 pay periods."


def test_trend_line_steady_uses_digits_above_six():
    fixed_shares = [40] * 8  # n=8, delta=0
    assert trend_line_for(fixed_shares) == "Fixed share has held steady over 8 pay periods."


# ── "periods" assembly (compute_money_shape's per-period response entry) ──────

def _periods_response_from(valid_periods_full: list[dict]) -> list[dict]:
    """Mirrors the "periods" list assembly in compute_money_shape exactly
    (kept in sync deliberately) so newest-first ordering and per-period shape
    can be tested without a DB. ``valid_periods_full`` are bucket_period
    dicts with a "label" key attached, in whatever order the caller passes."""
    return [
        {
            "start": p["start"].isoformat(),
            "end": p["end"].isoformat(),
            "label": p["label"],
            "take_home": round(p["take_home"], 2),
            "overspent": round(p["overspent"], 2),
            "jobs": _build_jobs(p["fixed"], p["moved"], p["free"], p["left"], p["shares"], p["categories"]),
            "verdict": verdict_for(p["shares"]["fixed"], p["shares"]["free"], p["overspent"]),
        }
        for p in valid_periods_full
    ]


def _monthly_period(month: int, take_home=1000.0, fixed=500.0, label=None) -> dict:
    start, end = date(2026, month, 1), date(2026, month, 28)
    txns = [
        txn(f"i{month}", take_home, "Income", f"2026-{month:02d}-01", is_debit=False),
        txn(f"b{month}", fixed, "Bills", f"2026-{month:02d}-02"),
    ]
    p = bucket_period(txns, KINDS, SAVING_IDS, start, end)
    p["label"] = label or end.strftime("%b")
    return p


def test_periods_response_is_newest_first_and_matches_input_count():
    p_jun, p_jul, p_aug = _monthly_period(6), _monthly_period(7), _monthly_period(8)
    # compute_money_shape builds valid_periods_full newest -> oldest by
    # walking backward from today; feed it in that same order here.
    valid_periods_full = [p_aug, p_jul, p_jun]

    periods_response = _periods_response_from(valid_periods_full)

    assert len(periods_response) == 3
    assert [p["label"] for p in periods_response] == ["Aug", "Jul", "Jun"]
    assert periods_response[0]["take_home"] == 1000.0
    assert [j["id"] for j in periods_response[0]["jobs"]] == ["fixed", "moved", "free", "left"]
    assert periods_response[0]["verdict"] == verdict_for(
        p_aug["shares"]["fixed"], p_aug["shares"]["free"], p_aug["overspent"]
    )


# ── average_for_window / average_verdict_for ──────────────────────────────────

def _period_dict(start, end, take_home, fixed, moved, free, overspent, category_totals) -> dict:
    """Minimal bucket_period-shaped dict -- only the keys average_for_window
    actually reads (take_home/fixed/moved/free/overspent/category_totals/
    start/end)."""
    left_raw = take_home - fixed - free - moved
    left = 0.0 if left_raw < 0 else left_raw
    return {
        "start": start, "end": end,
        "take_home": take_home, "fixed": fixed, "moved": moved, "free": free, "left": left,
        "overspent": overspent,
        "category_totals": category_totals,
    }


def _totals(fixed=None, moved=None, free=None, left=None) -> dict:
    return {"fixed": fixed or {}, "moved": moved or {}, "free": free or {}, "left": left or {}}


def test_average_for_window_none_below_two_periods():
    p = _period_dict(date(2026, 6, 1), date(2026, 6, 30), 1000.0, 400.0, 100.0, 100.0, 0.0, _totals())
    assert average_for_window([], 3) is None
    assert average_for_window([p], 3) is None


def test_average_for_window_mean_arithmetic_and_shares_sum_to_100():
    totals = _totals(
        fixed={"Bills": 400.0}, moved={"Savings": 100.0}, free={"Eating Out": 100.0}, left={"Income": 1000.0},
    )
    p_jul = _period_dict(date(2026, 7, 1), date(2026, 7, 31), 1000.0, 400.0, 100.0, 100.0, 0.0, totals)
    p_jun = _period_dict(date(2026, 6, 1), date(2026, 6, 30), 1000.0, 400.0, 100.0, 100.0, 0.0, totals)
    avg = average_for_window([p_jul, p_jun], 3)  # newest first

    assert avg["months"] == 3
    assert avg["period_count"] == 2
    assert avg["start"] == "2026-06-01"  # oldest.start
    assert avg["end"] == "2026-07-31"    # newest.end
    assert avg["label"] == "Last 3 months"
    assert avg["take_home"] == 1000.0
    assert avg["overspent"] == 0.0

    jobs = {j["id"]: j for j in avg["jobs"]}
    assert jobs["fixed"]["amount"] == 400.0
    assert jobs["fixed"]["categories"] == ["Bills"]
    assert jobs["fixed"]["txn_type"] == "debit"
    assert jobs["moved"]["txn_type"] == "debit"
    assert jobs["free"]["txn_type"] == "debit"
    assert jobs["left"]["amount"] == 400.0  # mean of take_home-fixed-free-moved each period
    assert jobs["left"]["categories"] == ["Income"]
    assert jobs["left"]["txn_type"] == "credit"
    assert sum(j["share"] for j in avg["jobs"]) == 100

    assert avg["verdict"] == (
        "Over the last two pay periods, £40 of every £100 you took home was spoken for "
        "before you chose anything. £10 was yours to spend freely."
    )


def test_average_for_window_category_union_sorted_by_combined_contribution():
    p1 = _period_dict(
        date(2026, 6, 1), date(2026, 6, 30), 1000.0, 400.0, 0.0, 0.0, 0.0,
        _totals(fixed={"Bills": 300.0, "Groceries": 100.0}),
    )
    p2 = _period_dict(
        date(2026, 7, 1), date(2026, 7, 31), 1000.0, 350.0, 0.0, 0.0, 0.0,
        _totals(fixed={"Bills": 200.0, "Transport": 150.0}),
    )
    avg = average_for_window([p2, p1], 6)
    # Combined: Bills 300+200=500, Transport 150, Groceries 100 -> descending.
    fixed_job = next(j for j in avg["jobs"] if j["id"] == "fixed")
    assert fixed_job["categories"] == ["Bills", "Transport", "Groceries"]


def test_average_verdict_for_normal_form_word_and_digit():
    assert average_verdict_for(2, 40, 10, 0.0, 600.0, 1000.0) == (
        "Over the last two pay periods, £40 of every £100 you took home was spoken for "
        "before you chose anything. £10 was yours to spend freely."
    )
    assert average_verdict_for(7, 40, 10, 0.0, 600.0, 1000.0) == (
        "Over the last 7 pay periods, £40 of every £100 you took home was spoken for "
        "before you chose anything. £10 was yours to spend freely."
    )


def test_average_verdict_for_overspent_form_when_outflow_exceeds_take_home():
    assert average_verdict_for(2, 50, 0, 200.0, 1200.0, 1000.0) == (
        "Over the last two pay periods, £50 of every £100 you took home was spoken for "
        "before you chose anything, and spending went £200 past what came in on average."
    )


def test_average_verdict_for_boundary_outflow_equal_to_take_home_uses_normal_form():
    # outflow_mean == take_home_mean exactly -> not "exceeds", normal form.
    assert average_verdict_for(2, 40, 10, 0.0, 1000.0, 1000.0) == (
        "Over the last two pay periods, £40 of every £100 you took home was spoken for "
        "before you chose anything. £10 was yours to spend freely."
    )


# ── evaluate_patterns ─────────────────────────────────────────────────────────

def _period(label, early_hit, left_raw, first3=100.0):
    return {"label": label, "early_saving_hit": early_hit, "left_raw": left_raw, "first3_discretionary": first3}


def test_evaluate_patterns_thin_below_four_periods():
    periods = [_period("Jan", True, 10.0), _period("Feb", True, 10.0), _period("Mar", False, -10.0)]
    result = evaluate_patterns(periods)
    assert result["state"] == "thin"
    assert result["periods_available"] == 3
    assert result["headline"] == "Not enough history yet."
    assert result["pattern_id"] is None


def test_evaluate_patterns_no_pattern_when_nothing_qualifies():
    # Same first3_discretionary everywhere -> calm_start has 0 misses (disqualified).
    # early_saving_hit never true -> 0 hits (disqualified). No candidate qualifies.
    periods = [
        _period("Jan", False, 10.0),
        _period("Feb", False, -10.0),
        _period("Mar", False, 10.0),
        _period("Apr", False, -10.0),
    ]
    result = evaluate_patterns(periods)
    assert result["state"] == "no_pattern"
    assert result["headline"] == "No clear pattern yet across 4 pay periods."
    assert result["pattern_id"] is None


def test_evaluate_patterns_early_saving_qualifies_with_exact_headline_and_evidence():
    # 4 hits (3 left-over, 1 not) vs 2 misses (0 left-over): hit_rate .75,
    # miss_rate 0, gap .75 >= .3 -- qualifies. Flat first3_discretionary
    # everywhere keeps calm_start from also qualifying (0 misses there).
    periods = [
        _period("Mar", True, 50.0),
        _period("Apr", True, 50.0),
        _period("May", False, -5.0),
        _period("Jun", True, 50.0),
        _period("Jul", True, -5.0),
        _period("Aug", False, -5.0),
    ]
    result = evaluate_patterns(periods)
    assert result["state"] == "ok"
    assert result["pattern_id"] == "early_saving"
    assert result["headline"] == (
        "Pay periods where you moved money to savings in the first week "
        "ended with cash left over 3 times out of 4."
    )
    assert result["flag_labels"] == {"hit": "early", "miss": "late"}
    assert [e["flag"] for e in result["evidence"]] == ["hit", "hit", "miss", "hit", "hit", "miss"]
    assert [e["period"] for e in result["evidence"]] == ["Mar", "Apr", "May", "Jun", "Jul", "Aug"]
    assert result["evidence"][0]["left_over"] == 50.0


def test_evaluate_patterns_calm_start_qualifies():
    # first3_discretionary: three periods at 10, three at 100. Median of the
    # six values is (10+100)/2 = 55, so "calm" (<=55) is the three 10s and
    # "fast" (>55) is the three 100s. Every calm period ends with cash left
    # over, every fast period doesn't.
    periods = [
        {"label": "Mar", "early_saving_hit": False, "left_raw": 20.0, "first3_discretionary": 10.0},
        {"label": "Apr", "early_saving_hit": False, "left_raw": 20.0, "first3_discretionary": 10.0},
        {"label": "May", "early_saving_hit": False, "left_raw": 20.0, "first3_discretionary": 10.0},
        {"label": "Jun", "early_saving_hit": False, "left_raw": -20.0, "first3_discretionary": 100.0},
        {"label": "Jul", "early_saving_hit": False, "left_raw": -20.0, "first3_discretionary": 100.0},
        {"label": "Aug", "early_saving_hit": False, "left_raw": -20.0, "first3_discretionary": 100.0},
    ]
    result = evaluate_patterns(periods)
    assert result["state"] == "ok"
    assert result["pattern_id"] == "calm_start"
    assert result["headline"] == (
        "Pay periods that started calm, under £55 of free spending "
        "in the first three days, ended with cash left over 3 times out of 3."
    )
    assert result["flag_labels"] == {"hit": "calm", "miss": "fast"}


# ── proposal_for (The Consent Rule) ────────────────────────────────────────────

def test_proposal_for_requires_ok_state_and_a_known_pattern():
    trait = {"id": "saving_habit", "title": "Regular Saver", "choice": "change"}
    assert proposal_for("no_pattern", "early_saving", trait) is None
    assert proposal_for("thin", "early_saving", trait) is None
    assert proposal_for("ok", None, trait) is None
    assert proposal_for("ok", "some_future_pattern", trait) is None


def test_proposal_for_requires_change_choice():
    assert proposal_for("ok", "early_saving", None) is None
    assert proposal_for("ok", "early_saving", {"id": "saving_habit", "choice": None}) is None
    assert proposal_for("ok", "early_saving", {"id": "saving_habit", "choice": "keep"}) is None
    assert proposal_for("ok", "calm_start", None) is None
    assert proposal_for("ok", "calm_start", {"id": "saving_habit", "choice": None}) is None
    assert proposal_for("ok", "calm_start", {"id": "saving_habit", "choice": "keep"}) is None


def test_proposal_for_early_saving_fires_only_on_change():
    trait = {"id": "saving_habit", "title": "Regular Saver", "choice": "change"}
    proposal = proposal_for("ok", "early_saving", trait)
    assert proposal == {
        "headline": "Move your payday transfer to the first week?",
        "body": (
            "Your early periods ended with cash left over more often. Penny can help "
            "you set this up in Planning, you approve before anything moves."
        ),
        "penny_ask": "Help me move my regular savings transfer to the first week of my pay period",
    }


def test_proposal_for_calm_start_fires_only_on_change():
    trait = {"id": "saving_habit", "title": "Regular Saver", "choice": "change"}
    proposal = proposal_for("ok", "calm_start", trait)
    assert proposal == {
        "headline": "Give the first three days a number?",
        "body": (
            "Your calm starts ended with cash left over more often. Penny can help you set "
            "a first-week allocation in Planning, you approve before anything moves."
        ),
        "penny_ask": "Help me set an allocation for the first week of my pay period",
    }


# ── router: no more ?horizon param / 400 ───────────────────────────────────────

def test_router_has_no_horizon_param_and_returns_cached_blob_verbatim():
    """Kevin's scope-selector redirect removed the ?horizon query param
    entirely -- the frontend switches client-side using periods/averages, so
    the router takes no query param at all and no longer 400s on anything."""
    import asyncio
    import inspect

    import app.routers.money_shape as money_shape_router

    sig = inspect.signature(money_shape_router.money_shape)
    assert "horizon" not in sig.parameters

    async def fake_get_cached(uid):
        return {"status": "ok", "fake_marker": uid}

    original = money_shape_router.get_money_shape_cached
    money_shape_router.get_money_shape_cached = fake_get_cached
    try:
        result = asyncio.run(money_shape_router.money_shape(user={"email": "kevin"}))
    finally:
        money_shape_router.get_money_shape_cached = original

    assert result == {"status": "ok", "fake_marker": "kevin"}
