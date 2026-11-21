"""G486: Upcoming's By account row and the account page's "Available to spend" read one stored figure.

Both surfaces read `account_eligibility[<id>].spend_from_headroom` from the same `/today` payload, and both
show the same working: `after_payments_and_money_in` less goals and set-asides, less moves set aside, plus
moves counted in. The payload for each current account must therefore balance on that one identity, and the
accounts must add up to Left to spend. Covered, short, cover-move/earmark and goal cases from the committed
H140 snapshots; the frontend half is `frontend/scripts/g486-upcoming-available.test.mjs`.
"""
import json
from pathlib import Path

import pytest

OUT = Path(__file__).parent / "scenarios" / "out"

CASES = {
    "covered": "g481-kevins-shape-money-in-offsets-the-bill-and-is-not-short",
    "short": "g481-kevins-shape-without-the-income-is-short",
    "cover_move_and_earmark": "g481-one-account-is-short-another-has-room-the-move-covers-it",
    "goal": "g465-daily-goal-counts-only-payments-from-its-start",
}


def _snap(name):
    return json.loads((OUT / f"{name}.json").read_text())


def _current(snap):
    return {k: v for k, v in snap["account_eligibility"].items() if v.get("is_current_account", True) and not v.get("uncertain")}


@pytest.mark.parametrize("kind", CASES)
def test_every_current_account_figure_is_its_working(kind):
    snap = _snap(CASES[kind])
    elig = _current(snap)
    assert elig
    for account_id, e in elig.items():
        working = (
            e["after_payments_and_money_in"]
            - e.get("plans_reserved", 0.0)
            - e.get("earmarked_total", 0.0)
            + e.get("moves_in_total", 0.0)
        )
        # The working both surfaces list adds up to the single stored figure, to the penny.
        assert round(working, 2) == e["spend_from_headroom"], (kind, account_id)


@pytest.mark.parametrize("kind", CASES)
def test_the_stored_figures_add_up_to_the_headline(kind):
    snap = _snap(CASES[kind])
    total = round(sum(e["spend_from_headroom"] for e in _current(snap).values()), 2)
    assert total == snap["safe_to_spend"]["safe_to_spend"], kind


def test_a_short_account_keeps_its_signed_figure():
    snap = _snap(CASES["short"])
    (e,) = _current(snap).values()
    assert e["spend_from_headroom"] == -72.86 and e["short"] is True


def test_a_cover_move_is_counted_once_on_each_leg():
    snap = _snap(CASES["cover_move_and_earmark"])
    hb, md = snap["account_eligibility"]["acc-hb"], snap["account_eligibility"]["acc-md"]
    # The source gives up the earmark, the destination counts the same move in: the pair nets to zero.
    assert hb["earmarked_total"] == md["moves_in_total"] == 90.0
    assert hb["spend_from_headroom"] == 910.0 and md["spend_from_headroom"] == 14.0 and md["spend_from_requires_move"] is True


def test_a_goal_comes_off_its_source_account_before_the_figure():
    snap = _snap(CASES["goal"])
    mz = snap["account_eligibility"]["acc-mz"]
    assert mz["plans_reserved"] == 136.84
    assert mz["spend_from_headroom"] == round(mz["after_payments_and_money_in"] - 136.84, 2) == 233.16
