"""G337: one naming rule for accounts in move plans (holder names never shown, bland names get their bank)."""
import pytest

from app.services.penny_consolidation import plan_consolidation_legs, source_label

TOKENS = ["maingi", "k", "m"]


@pytest.mark.parametrize("display,provider,tokens,expected", [
    ("HSBC Maingi K M", "ob-hsbc", TOKENS, "your HSBC account"),
    ("Maingi K M", "ob-hsbc", [], "your HSBC account"),
    ("K M Maingi", "ob-hsbc", [], "your HSBC account"),
    ("Personal", "ob-starling", TOKENS, "Starling Personal"),
    ("The Number One", "ob-natwest", TOKENS, "NatWest The Number One"),
    ("Premier Current Account", "ob-barclays", TOKENS, "Barclays Premier Current Account"),
    ("Barclays Premier", "ob-barclays", TOKENS, "Barclays Premier"),
    ("Revolut Kevin Maingi", "ob-revolut", ["kevin", "mbithi", "maingi"], "your Revolut account"),
    ("Maingi K M", "bank", [], "your account"),
    ("Personal", "bank", TOKENS, "Personal"),
])
def test_source_label(display, provider, tokens, expected):
    assert source_label(display, provider, tokens) == expected


def _acc(aid, name, provider, **kw):
    return {"id": aid, "name": name, "provider": provider, "subtype": "TRANSACTION", "type": "bank", **kw}


def _elig(head):
    return {"short": False, "headroom": head, "spend_from_headroom": head, "account_headroom_raw": head}


def _plan(tokens):
    accounts = [
        _acc("t", "Premier Current Account", "ob-barclays"),
        _acc("a", "The Number One", "ob-natwest"),
        _acc("b", "Personal", "ob-starling"),
        _acc("c", "Revolut Main", "ob-revolut"),
        _acc("d", "Maingi K M", "ob-hsbc"),
    ]
    elig = {"t": _elig(10), "a": _elig(146.29), "b": _elig(54.02), "c": _elig(12.03), "d": _elig(11.39)}
    return plan_consolidation_legs(
        target_id="t", eligibility=elig, accounts=accounts, pool=500.0, amount=None,
        include_savings=False, pot_ids=set(), name_tokens=tokens)


@pytest.mark.parametrize("tokens", [TOKENS, []])
def test_kevin_summary_has_no_holder_name_and_names_banks(tokens):
    plan = _plan(tokens)
    s = plan["summary"]
    assert "Maingi" not in s and "K M" not in s
    assert "NatWest The Number One" in s and "Starling Personal" in s
    assert "into Barclays Premier Current Account" in s
    assert "from your HSBC account" in s
    assert [l["name"] for l in plan["legs"]] == [
        "NatWest The Number One", "Starling Personal", "Revolut Main", "Your HSBC account"]
    assert plan["target"]["name"] == "Barclays Premier Current Account"


def test_target_holder_named_reads_into_your_bank_account():
    accounts = [_acc("t", "Maingi K M", "ob-barclays"), _acc("a", "Personal", "ob-starling")]
    plan = plan_consolidation_legs(
        target_id="t", eligibility={"a": _elig(50)}, accounts=accounts, pool=100.0, amount=None,
        include_savings=False, pot_ids=set(), name_tokens=TOKENS)
    assert plan["summary"].startswith("You could move up to £50.00 into your Barclays account")


@pytest.mark.parametrize("display,expected", [
    ("Plan A", "HSBC Plan A"),
    ("Savings A", "HSBC Savings A"),
    ("ISA S&S", "HSBC ISA S&S"),
    ("Flex E Account", "HSBC Flex E Account"),
    ("Pepper Dr Fund", "HSBC Pepper Dr Fund"),
    ("Maingi K M", "your HSBC account"),
    ("K M Maingi", "your HSBC account"),
    ("Dr Pepper Fund", "your HSBC account"),
])
def test_tokenless_person_shape(display, expected):
    assert source_label(display, "ob-hsbc", []) == expected
