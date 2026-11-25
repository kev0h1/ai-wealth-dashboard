"""G500: saved per-occurrence decisions apply to the dated card statement payments."""
from datetime import date

from app.services.card_statements import apply_statement_overrides

TODAY = date(2026, 11, 25)
END = date(2026, 12, 20)
KEY = "card-statement:acc-card:2026-10-28"


def _bill(key=KEY, expected="2026-11-25", original="2026-11-09", amount=120.0, **extra):
    return {"name": key, "amount": amount, "expected_date": expected, "original_date": original,
            "days_away": 0, "is_card_repayment": True, "edited": False, "pending": True, **extra}


def _ov(**kw):
    return {"key": KEY, "date": "2026-11-09", "scope": "one", "skip": False,
            "new_date": None, "new_amount": None, **kw}


def test_dismissed_statement_payment_is_dropped_even_when_shown_overdue():
    # Kevin's shape: due 9 Nov, shown today (25 Nov) as overdue, dismissed under the due date.
    assert apply_statement_overrides([_bill()], [_ov(skip=True)], TODAY, END) == []


def test_skip_matches_expected_date_when_not_overdue():
    b = _bill(expected="2026-11-30", original=None)
    assert apply_statement_overrides([b], [_ov(date="2026-11-30", skip=True)], TODAY, END) == []


def test_next_statement_is_not_suppressed():
    nxt = _bill(key="card-statement:acc-card:2026-11-28", expected="2026-12-09", original=None)
    out = apply_statement_overrides([_bill(), nxt], [_ov(skip=True)], TODAY, END)
    assert out == [nxt]


def test_other_card_and_learned_series_untouched():
    other = _bill(key="card-statement:acc-other:2026-10-28")
    learned = {"name": "AMEX 1234", "amount": 50.0, "expected_date": "2026-11-09"}
    out = apply_statement_overrides([other, learned], [_ov(skip=True)], TODAY, END)
    assert out == [other, learned]


def test_edited_amount_and_date_are_honoured():
    out = apply_statement_overrides([_bill()], [_ov(new_amount=80.0, new_date="2026-11-30")], TODAY, END)
    assert len(out) == 1
    b = out[0]
    assert b["amount"] == 80.0 and b["expected_date"] == "2026-11-30" and b["days_away"] == 5
    assert b["edited"] is True and b["pending"] is False and b["original_date"] is None


def test_edited_amount_only_keeps_date():
    out = apply_statement_overrides([_bill()], [_ov(new_amount=80.0)], TODAY, END)
    assert out[0]["amount"] == 80.0 and out[0]["expected_date"] == "2026-11-25" and out[0]["edited"] is True


def test_date_moved_past_window_drops_bill():
    assert apply_statement_overrides([_bill()], [_ov(new_date="2027-01-05")], TODAY, END) == []


def test_override_for_a_different_date_does_not_apply():
    assert apply_statement_overrides([_bill()], [_ov(date="2026-10-01", skip=True)], TODAY, END) == [_bill()]


def test_no_overrides_returns_same_list():
    bills = [_bill()]
    assert apply_statement_overrides(bills, [], TODAY, END) is bills
