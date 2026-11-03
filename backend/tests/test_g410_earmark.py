"""G410: the earmark. A live suggested cover move is set aside in its source
and shown as covering its destination's shortfall; it is derived from the
same legs and move gate every compute, so it clears by itself.

Fields (all ABSENT when nothing is earmarked), on `account_eligibility`:
  source:      earmarks_out [{to_account_id, to_name, amount}], earmarked_total
  destination: covered_by_move {amount, from: [{account_id, name, amount}]},
               short_after_cover = max(0, shortfall - covered amount)
The walk verdict (after_payments, low_point) and the pooled Left to spend are
never touched. Harness helpers are the ones test_cover_plan_account_eligibility
already uses (fake Mongo, real compute_today_items).
"""
import asyncio

import app.routers.card_terms  # noqa: F401  H143: bind real handles before the fakes patch db_collections
import app.services.companion as companion
import app.services.debt_plan  # noqa: F401
from test_cover_plan_account_eligibility import _account, _bill, _find, _run


def _accounts(src_balance=1000.0, dest_balance=124.0):
    return [
        _account("dest", dest_balance, name="Meadow Current", provider="natwest"),
        _account("src", src_balance, name="Harbour Current", provider="barclays"),
    ]


def _bills(amount=400.0, dest_balance=124.0):
    return [_bill("Rent share", 2, amount, "dest", dest_balance, kind="commitment")]


def _compute(monkeypatch, *, accounts=None, bills=None, **kw):
    elig = {}
    items = _run(monkeypatch, bills if bills is not None else _bills(),
                 accounts=accounts or _accounts(), account_eligibility_out=elig, **kw)
    return items, elig


def test_earmark_applied_to_source_and_destination(monkeypatch):
    items, elig = _compute(monkeypatch)
    move = _find(items, "move")
    assert move is not None
    # Shortfall 400 - 124 = 276, rounded up to 280, plus 10 = 290: one leg of 290.
    assert move["amount"] == 290
    src, dest = elig["src"], elig["dest"]
    assert src["earmarked_total"] == 290.0
    assert src["earmarks_out"] == [{"to_account_id": "dest", "to_name": "Meadow Current", "amount": 290.0}]
    # Source Spend from already excludes it: after payments 1000 - 290.
    assert src["spend_from_headroom"] == round(src["after_payments_and_plans"] - 290.0, 2)
    assert dest["covered_by_move"] == {
        "amount": 290.0,
        "from": [{"account_id": "src", "name": "Harbour Current", "amount": 290.0}],
        "shortfall": 276.0,  # the S3.1 figure the move was sized from
    }


def test_destination_is_covered_not_short_but_the_walk_verdict_is_unchanged(monkeypatch):
    _, elig = _compute(monkeypatch)
    dest = elig["dest"]
    assert dest["short_after_cover"] == 0.0
    # The walk still says short (124 - 400 = -276); only the display fields change.
    assert dest["after_payments"] == -276.0
    assert dest["low_point"] == -276.0
    assert "earmarks_out" not in dest and "earmarked_total" not in dest


def test_no_earmark_keys_when_nothing_is_short(monkeypatch):
    _, elig = _compute(monkeypatch, bills=_bills(amount=50.0))
    for entry in elig.values():
        for key in ("earmarks_out", "earmarked_total", "covered_by_move", "short_after_cover"):
            assert key not in entry


def test_cleared_when_the_transfer_has_arrived(monkeypatch):
    # The matched own-account transfer has posted: the destination balance now
    # includes it, the source balance no longer does. The walk finds no
    # shortfall, so no move is sized and nothing is earmarked.
    items, elig = _compute(
        monkeypatch,
        accounts=_accounts(src_balance=710.0, dest_balance=414.0),
        bills=_bills(amount=400.0, dest_balance=414.0),
    )
    assert _find(items, "move") is None
    for entry in elig.values():
        assert "earmarked_total" not in entry and "covered_by_move" not in entry


def test_shrinks_on_partial_cover(monkeypatch):
    # The only source holds little, so the leg is smaller than the shortfall.
    items, elig = _compute(monkeypatch, accounts=_accounts(src_balance=100.0))
    move = _find(items, "move")
    assert move is not None
    covered = elig["dest"]["covered_by_move"]["amount"]
    assert 0 < covered < 276
    assert elig["src"]["earmarked_total"] == covered
    assert elig["dest"]["short_after_cover"] == round(276.0 - covered, 2) > 0


def test_shrinks_when_a_set_aside_takes_part_of_the_source(monkeypatch):
    _, full = _compute(monkeypatch)
    _, reduced = _compute(monkeypatch, accounts=_accounts(src_balance=1000.0), reserved_by_source={"src": 800.0})
    assert reduced["dest"]["covered_by_move"]["amount"] < full["dest"]["covered_by_move"]["amount"]
    assert reduced["dest"]["short_after_cover"] > 0


def test_cleared_when_the_protected_payment_is_paid_skipped_edited_or_removed(monkeypatch):
    # Paid, skipped or removed: the payment is out of the window list.
    _, gone = _compute(monkeypatch, bills=[])
    # Edited down to what the balance already covers.
    _, edited = _compute(monkeypatch, bills=_bills(amount=100.0))
    for elig in (gone, edited):
        for entry in elig.values():
            assert "earmarked_total" not in entry and "covered_by_move" not in entry
    # Edited to a smaller shortfall: the earmark shrinks with it (shortfall 56 -> 60 + 10 = 70).
    _, smaller = _compute(monkeypatch, bills=_bills(amount=180.0))
    assert smaller["dest"]["covered_by_move"]["amount"] == 70.0
    assert smaller["src"]["earmarked_total"] == 70.0


def test_cleared_when_other_money_covers_the_destination(monkeypatch):
    _, elig = _compute(monkeypatch, accounts=_accounts(dest_balance=524.0), bills=_bills(dest_balance=524.0))
    for entry in elig.values():
        assert "earmarked_total" not in entry and "covered_by_move" not in entry


def test_cleared_on_dismiss_and_the_row_reverts_to_plain_short(monkeypatch):
    items, _ = _compute(monkeypatch)
    item_id = _find(items, "move")["id"]

    async def _dismissed(uid):
        return {item_id}

    monkeypatch.setattr(companion, "_get_dismissed", _dismissed)
    items2, elig = _compute(monkeypatch)
    assert _find(items2, "move") is None
    for entry in elig.values():
        for key in ("earmarks_out", "earmarked_total", "covered_by_move", "short_after_cover"):
            assert key not in entry
    assert elig["dest"]["after_payments"] == -276.0  # plain short
    assert elig["src"]["spend_from_headroom"] == elig["src"]["after_payments_and_plans"]


def test_uncertain_source_discloses_no_deduction(monkeypatch):
    """An unreadable plan makes every position uncertain: Available is unchanged (no reserve),
    so the source shows no set-aside line either."""
    _, elig = _compute(monkeypatch, plans_fail=True)
    assert elig["src"]["uncertain"] is True
    assert "earmarks_out" not in elig["src"] and "earmarked_total" not in elig["src"]
