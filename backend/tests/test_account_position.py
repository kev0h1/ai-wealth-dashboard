"""G238: the shared per-account "after payments and plans" figure.

Fixture: tests/fixtures/g238_account_position.json, also loaded by
frontend/scripts/g238-account-position.test.mjs, so the server and the sheet's
client fallback arithmetic cannot drift.
"""
import json
import pathlib

import pytest

from app.services.account_position import compute_account_positions, seed_spend_from
from app.services.companion import cap_spend_from_to_pool

CASES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "g238_account_position.json").read_text()
)["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_positions_and_spend_from(case):
    positions = compute_account_positions(
        case["plans"], case["closing"], movements=case["movements"], credit_account_ids=set(case.get("credit_account_ids", [])),
        low_point_by_account=case["low_point"],
    )
    elig = {}
    for sid, pos in positions.items():
        elig[sid] = {"headroom": 999.0, "spend_from_headroom": seed_spend_from(pos)}
    cap_spend_from_to_pool(elig, case["pool"])
    for sid, want in case["expected"].items():
        got = positions[sid]
        for key in ("after_payments", "plans_reserved", "after_payments_and_plans", "uncertain", "estimated", "low_point", "low_point_and_plans"):
            assert got[key] == want[key], (case["name"], sid, key)
        assert elig[sid]["spend_from_headroom"] == want["spend_from"], (case["name"], sid)


def test_kevins_barclays_is_61_04_not_108():
    case = next(c for c in CASES if c["name"] == "kevin_barclays_japan")
    positions = compute_account_positions(case["plans"], case["closing"], movements=case["movements"], low_point_by_account=case["low_point"])
    elig = {"barclays": {"headroom": 124.0, "spend_from_headroom": seed_spend_from(positions["barclays"])}}
    cap_spend_from_to_pool(elig, 108)
    assert elig["barclays"]["spend_from_headroom"] == 61.04


def test_card_repayment_to_a_credit_account_is_not_overlap():
    plans = [CASES[0]["plans"][0]]
    moves = [{"account_id": "barclays", "dest_account_id": "amex", "amount": 80, "category": "Transfer", "kind": "movement"}]
    pos = compute_account_positions(plans, {"barclays": 141.04}, movements=moves, credit_account_ids={"amex"})
    assert pos["barclays"]["uncertain"] is False
    assert pos["barclays"]["after_payments_and_plans"] == 61.04


def test_inactive_and_zero_remaining_plans_reserve_nothing():
    plan = dict(CASES[0]["plans"][0], remaining=0)
    pos = compute_account_positions([plan], {"barclays": 141.04})
    assert pos["barclays"]["plans_reserved"] == 0
    assert pos["barclays"]["after_payments_and_plans"] == 141.04
    off = dict(CASES[0]["plans"][0], active=False)
    assert compute_account_positions([off], {"barclays": 141.04})["barclays"]["plans_reserved"] == 0


def test_unknown_closing_is_not_shown():
    pos = compute_account_positions([], {"barclays": None})["barclays"]
    assert pos["after_payments_and_plans"] is None
    assert seed_spend_from(pos) == 0.0
