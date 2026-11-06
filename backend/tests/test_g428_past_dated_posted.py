"""G428 part 3: a predicted payment dated before today that has already posted
is closed, never walked a second time (`_build_cashflow_response`).

The ordinary close is by series key (same wording, same account, within the
amount band). The G428 fallback covers the same standing order posting under
reworded text. Invented names and figures only."""
from datetime import timedelta

import app.core.timeutil as timeutil
from test_pending_observed import _freeze, _pattern, _run_build_response, _settled_txn

ACC = "acc-main"


def _vanguard(**over):
    base = dict(
        key="ACME INVEST DD", avg_amount=400.0, avg_interval=60,
        account_id=ACC, category="Investing",
        next_date=(timeutil.user_today() - timedelta(days=4)).isoformat(),
    )
    base.update(over)
    return _pattern(**base)


def _posted(desc, amount=400.0, account=ACC, category="Investing", days_ago=4):
    t = _settled_txn(desc, amount, timeutil.user_today() - timedelta(days=days_ago), account_id=account)
    t["category"] = category
    return t


def _bills(resp):
    return [b for b in resp["upcoming_bills"] if b["name"] == "ACME INVEST DD"]


def test_same_wording_posted_payment_is_closed_not_counted_again(monkeypatch):
    _freeze(monkeypatch)
    resp = _run_build_response(monkeypatch, [_vanguard()], observed=[_posted("ACME INVEST DD")])
    assert _bills(resp) == []


def test_unposted_past_payment_stays_as_an_overdue_walk_item(monkeypatch):
    _freeze(monkeypatch)
    resp = _run_build_response(monkeypatch, [_vanguard()], observed=[])
    bills = _bills(resp)
    assert len(bills) == 1 and bills[0]["pending"] is True and bills[0]["days_past_due"] == 4
    assert bills[0]["days_away"] == 0  # rolled to today, walked once


def test_reworded_posted_payment_is_closed_once(monkeypatch):
    _freeze(monkeypatch)
    resp = _run_build_response(monkeypatch, [_vanguard()], observed=[_posted("ACME INVESTMENTS UK REF 7731")])
    assert _bills(resp) == []


def test_reworded_debit_closes_one_occurrence_only(monkeypatch):
    # Two overdue occurrences of the same series (interval 2 days apart is not
    # realistic, so use two patterns) share one posted debit: only one closes.
    _freeze(monkeypatch)
    a = _vanguard(key="ACME INVEST DD")
    b = _vanguard(key="ACME INVEST DD TWO")
    resp = _run_build_response(monkeypatch, [a, b], observed=[_posted("ACME INVESTMENTS UK REF 7731")])
    names = sorted(x["name"] for x in resp["upcoming_bills"] if x["name"].startswith("ACME INVEST DD"))
    assert len(names) == 1


def test_other_category_account_or_amount_never_closes_it(monkeypatch):
    _freeze(monkeypatch)
    for tx in (
        _posted("SHOP PURCHASE", category="Shopping"),
        _posted("ACME INVESTMENTS UK", account="acc-other"),
        _posted("ACME INVESTMENTS UK", amount=380.0),
    ):
        resp = _run_build_response(monkeypatch, [_vanguard()], observed=[tx])
        assert len(_bills(resp)) == 1, tx["description"]


def test_a_debit_that_belongs_to_another_recurring_series_never_closes_it(monkeypatch):
    _freeze(monkeypatch)
    other = _pattern(key="OTHER SERIES", avg_amount=400.0, avg_interval=60, account_id=ACC, category="Investing",
                     next_date=(timeutil.user_today() + timedelta(days=20)).isoformat())
    resp = _run_build_response(monkeypatch, [_vanguard(), other], observed=[_posted("OTHER SERIES")])
    assert len(_bills(resp)) == 1


def test_two_matching_orphan_debits_are_ambiguous_and_leave_the_ask(monkeypatch):
    _freeze(monkeypatch)
    resp = _run_build_response(monkeypatch, [_vanguard()], observed=[_posted("ACME A"), _posted("ACME B")])
    assert len(_bills(resp)) == 1


def test_a_future_dated_occurrence_is_never_closed_by_the_fallback(monkeypatch):
    _freeze(monkeypatch)
    future = _vanguard(next_date=(timeutil.user_today() + timedelta(days=3)).isoformat())
    resp = _run_build_response(monkeypatch, [future], observed=[_posted("ACME INVESTMENTS UK", days_ago=1)])
    assert len(_bills(resp)) == 1
