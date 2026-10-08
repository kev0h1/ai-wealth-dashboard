"""G212: Home cover plan card for an account with no transfer source, one
test per branch against the Kevin-approved wording (2026-10-04), plus the
naming rule (holder-named accounts become "{Bank} account" in sentences)."""
from datetime import date

import pytest

from app.services.companion import (
    _bank_name_of,
    _is_holder_named,
    no_source_copy,
)

TODAY = date(2026, 10, 8)
PAYDAY = date(2026, 10, 30)


def _bills(overdue: int, current: int, due="2026-10-12"):
    rows = [{"label": "Rent", "amount": 100, "expected_date": "2026-10-01", "days_past_due": 7} for _ in range(overdue)]
    rows += [{"label": "Bill", "amount": 100, "expected_date": due, "days_past_due": 0} for _ in range(current)]
    return rows


def _copy(**kw):
    base = dict(
        dest_name="MR KEVIN MBITHI MAINGI",
        provider="barclays",
        shortfall=3653,
        is_overdraft=False,
        bill_amount=620,
        bill_name="Rent",
        bill_weekday="Friday",
        balance=940,
        needs_total=4593,
        bills=_bills(7, 7),
        today=TODAY,
        payday=PAYDAY,
        user_tokens=["kevin", "maingi"],
    )
    base.update(kw)
    return no_source_copy(**base)


def test_holder_named_headline_lead_body_row():
    out = _copy()
    assert out["headline"] == "Your Barclays account is £3,653 short before payday."
    assert out["brief_lead"] == {"value": "£3,653", "companion": "to find before 30 Oct"}
    assert out["body"] == (
        "Your £620 Rent payment is expected Friday, but there isn't enough in this account "
        "for it, and none of your other accounts can safely top it up right now."
    )
    assert out["dest_row"] == {
        "title": "Barclays · Mr Kevin Mbithi Maingi",
        "detail": "£940 in the account · £4,593 for 14 payments: 7 overdue, 7 due by 12 Oct",
    }


def test_normally_named_account_uses_its_display_name_and_plain_row():
    out = _copy(dest_name="PREMIER CURRENT", provider="hsbc", user_tokens=["kevin", "maingi"])
    assert out["headline"] == "Premier Current is £3,653 short before payday."
    assert out["dest_row"]["title"] == "Premier Current"
    assert "Mr Kevin" not in out["headline"]


def test_holder_named_without_known_bank():
    out = _copy(provider="Bank")
    assert out["headline"] == "Your account is £3,653 short before payday."
    assert out["dest_row"]["title"] == "Mr Kevin Mbithi Maingi"


def test_holder_named_by_profile_tokens_without_title():
    out = _copy(dest_name="KEVIN MAINGI", provider="ob-natwest")
    assert out["headline"].startswith("Your NatWest account is")


def test_overdraft_branch_keeps_meaning_and_naming():
    out = _copy(is_overdraft=True, shortfall=12.5, balance=-12.5, bill_amount=None, bill_name=None, bill_weekday=None, bills=[])
    assert out["headline"] == "Your Barclays account is £12.50 overdrawn."
    assert out["body"].startswith("This account is overdrawn right now, and none of your other accounts")
    assert out["brief_lead"] == {"value": "£12", "companion": "to get back above £0"}
    assert out["dest_row"]["detail"] == "£12.50 overdrawn right now"


@pytest.mark.parametrize("overdue,current,expected", [
    (0, 1, "£940 in the account · £4,593 for 1 payment due by 12 Oct"),
    (0, 3, "£940 in the account · £4,593 for 3 payments due by 12 Oct"),
    (2, 0, "£940 in the account · £4,593 for 2 payments, all overdue"),
    (1, 0, "£940 in the account · £4,593 for 1 overdue payment"),
    (1, 2, "£940 in the account · £4,593 for 3 payments: 1 overdue, 2 due by 12 Oct"),
])
def test_row_detail_variants(overdue, current, expected):
    assert _copy(bills=_bills(overdue, current))["dest_row"]["detail"] == expected


def test_no_payday_date_falls_back():
    assert _copy(payday=None)["brief_lead"]["companion"] == "to find before payday"


def test_copy_rules():
    for kw in ({}, {"dest_name": "PREMIER CURRENT"}, {"is_overdraft": True, "bills": []}):
        out = _copy(**kw)
        text = " ".join([out["headline"], out["body"], out["brief_lead"]["value"], out["brief_lead"]["companion"],
                         out["dest_row"]["title"], out["dest_row"]["detail"]])
        assert "—" not in text and "–" not in text
        assert "held" not in text and "payday." not in out["headline"].replace("before payday.", "")
        assert "MAINGI" not in text and "PREMIER" not in text


def test_helpers():
    assert _bank_name_of("ob-barclays") == "Barclays"
    assert _bank_name_of("NATWEST") == "NatWest"
    assert _bank_name_of("Bank") is None and _bank_name_of(None) is None
    assert _is_holder_named("Mrs Jane Doe", []) is True
    assert _is_holder_named("Bills Pot", ["kevin", "maingi"]) is False
    assert _is_holder_named("Kevin Maingi", ["kevin", "maingi"]) is True
    assert _is_holder_named("Kevin Savings", ["kevin", "maingi"]) is False
