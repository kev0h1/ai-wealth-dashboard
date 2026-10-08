"""G193: copy for the Home "Covered" card, one test per branch (Kevin-approved
wording, 2026-10-03). No em dashes, British English, no "Sorted:" prefix, no
"held aside", account names re-cased from the provider's upper case."""
import pytest

from app.services.companion import celebration_payload


def _stored(**kw):
    base = {"_id": "abc", "_window_end": "2026-10-30"}
    base.update(kw)
    return base


def test_multi_bill_unverified_move():
    out = celebration_payload(
        _stored(_dest_needs_total=843, _dest_bill_count=4), "THE NUMBER ONE"
    )
    assert out["headline"] == "The Number One has enough for what's due"
    assert out["body"] == (
        "This account has enough, so the 4 payments due from this account "
        "before payday should go through."
    )
    assert out["brief_lead"] == {"value": "£843", "companion": "due before 30 Oct"}
    assert out["type"] == "celebration" and out["id"] == "celebrate:abc"


def test_multi_bill_observed_move():
    out = celebration_payload(
        _stored(_dest_needs_total=843, _dest_bill_count=4), "THE NUMBER ONE", move_landed=True
    )
    assert out["body"] == (
        "Your move landed, so the 4 payments due from this account before payday should go through."
    )


def test_single_bill_both_variants():
    st = _stored(_bill_name="NATWEST CREDIT CARD", _bill_amount=62, _dest_needs_total=62, _dest_bill_count=1)
    landed = celebration_payload(st, "Current", move_landed=True)["body"]
    plain = celebration_payload(st, "Current")["body"]
    assert landed.startswith("Your move landed, so the £62 ") and landed.endswith(" payment should go through.")
    assert plain.startswith("This account has enough, so the £62 ") and plain.endswith(" payment should go through.")


def test_overdraft_both_variants():
    st = _stored(_is_overdraft=True)
    assert celebration_payload(st, "Current", move_landed=True)["body"] == (
        "Your move landed and the account is back above £0."
    )
    out = celebration_payload(st, "Current")
    assert out["body"] == "The account is back above £0."
    assert out["brief_lead"] == {"value": "Above £0", "companion": "overdrawn balance cleared"}


def test_no_name():
    out = celebration_payload(_stored(_dest_needs_total=300, _dest_bill_count=2), None)
    assert out["headline"] == "That account has enough for what's due"


def test_no_amounts_and_no_payday_date():
    out = celebration_payload({"_id": "x"}, "Bills")
    assert out["brief_lead"] == {"value": "Covered", "companion": "before payday"}
    assert out["body"] == "This account has enough, so the payments due before payday should go through."
    out2 = celebration_payload({"_id": "x", "_dest_needs_total": 50, "_dest_bill_count": 2}, "Bills")
    assert out2["brief_lead"]["companion"] == "due before payday"


def test_mixed_case_name_untouched():
    assert celebration_payload(_stored(), "Bills Pot")["headline"] == "Bills Pot has enough for what's due"


@pytest.mark.parametrize("kw", [
    {"_dest_needs_total": 843, "_dest_bill_count": 4},
    {"_bill_amount": 62, "_bill_name": "Rent"},
    {"_is_overdraft": True},
    {},
])
@pytest.mark.parametrize("landed", [True, False])
def test_copy_rules(kw, landed):
    out = celebration_payload(_stored(**kw), "THE NUMBER ONE", move_landed=landed)
    text = " ".join([out["headline"], out["body"], out["brief_lead"]["value"], out["brief_lead"]["companion"]])
    assert "—" not in text and "–" not in text
    assert "Sorted" not in text and "held aside" not in text and "are safe" not in text
    assert "THE NUMBER ONE" not in text
