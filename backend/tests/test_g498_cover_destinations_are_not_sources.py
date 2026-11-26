"""G498: an account that needs money (payment or plan) is never a cover source."""
import json
from pathlib import Path

from tests.test_scenarios import _json_roundtrip, _moves, _run_scenario

SCEN = Path(__file__).parent / "scenarios"


def _snap(slug, monkeypatch):
    spec = json.loads((SCEN / f"{slug}.json").read_text())
    return _json_roundtrip(_run_scenario(spec, slug, monkeypatch))


def test_no_account_is_both_destination_and_source(monkeypatch):
    moves = _moves(_snap("g498-plan-short-account-is-not-a-payment-source", monkeypatch))
    assert len(moves) == 2
    assert not ({m["to"] for m in moves} & {m["from"] for m in moves})


def test_plan_short_account_is_not_a_payment_source(monkeypatch):
    moves = _moves(_snap("g498-plan-short-account-is-not-a-payment-source", monkeypatch))
    assert all(m["from"] != "acc-monzo" for m in moves)
    assert {(m["from"], m["to"], m["amount"]) for m in moves} == {
        ("acc-personal", "acc-premier", 140.0), ("acc-starling", "acc-monzo", 110.0),
    }


def test_existing_cover_scenarios_never_pass_money_through(monkeypatch):
    for slug in (
        "g414-plan-and-payment-shortfalls-covered", "g414-plan-only-shortfall-covered",
        "g422-own-savings-standing-order-covered-from-another-account",
        "g426-own-savings-order-with-payment-shortfall-one-combined-move",
        "g428-salary-account-short-after-card-payment-savings-covers-the-rest",
    ):
        moves = _moves(_snap(slug, monkeypatch))
        assert not ({m["to"] for m in moves} & {m["from"] for m in moves}), slug
