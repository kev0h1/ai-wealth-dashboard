"""G422: an own-savings standing order its source cannot fund this period.

Kevin 2026-11-06: fund it like a plan when money exists elsewhere (one G414
combined cover move, earmarked, amber, never a payment shortfall); when nothing
can cover it, one plain line says so. The app never moves or cancels anything.
"""
from datetime import timedelta

from app.services import companion
from app.services.categories import MOVEMENT
from tests.test_allocation_shortfall import _account, _bill, _plan, _run
from tests.test_unfunded_move import _mv_bill


def _sto(amount=250.0, *, account="barclays", dest="sav", days_away=3, pending=False, spendable=False):
    bill = _mv_bill("STO SAVER", amount, account, pending=pending, days_away=days_away, dest_account_id=dest)
    bill["dest_account_spendable"] = spendable
    return bill


def _world(other_balance):
    return [
        _account("barclays", 50.0, name="Barclays"),
        _account("monzo", other_balance, name="Monzo"),
        _account("sav", 1000.0, name="Saver", subtype="SAVINGS"),
    ]


def _go(monkeypatch, bills, accounts, plans=None):
    elig: dict = {}
    items = _run(monkeypatch, bills, plans or [], accounts, eligibility=elig)
    return items, elig


def _sav_cards(items):
    return [i for i in items if i.get("savings_at_risk")]


def test_spare_money_elsewhere_gives_one_amber_cover_move(monkeypatch):
    items, elig = _go(monkeypatch, [_sto()], _world(500.0))
    cards = _sav_cards(items)
    assert len(cards) == 1
    card = cards[0]
    assert card["type"] == "move" and card["covered"] is True
    assert card["amount"] == 210.0  # £200 gap + the usual £10 cushion
    assert [m["move_map"]["from"]["account_id"] for m in card["moves"]] == ["monzo"]
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["amount"] == 200.0 and fact["covered"] == 210.0 and fact["no_cover"] is False
    assert fact["note"].startswith("Savings at risk. A suggested move from")
    assert elig["barclays"]["covered_by_move"]["amount"] == 210.0
    assert elig["barclays"]["short_after_cover"] == 0.0
    assert elig["monzo"]["earmarks_out"][0]["amount"] == 210.0
    # The savings account the order pays into is never the cover source.
    assert "earmarks_out" not in elig["sav"]
    # A savings gap is never a payment shortfall: no payment card, and the
    # standing order is not a bill at risk.
    assert all(i.get("type") != "unfunded_move" for i in items)


def test_no_money_anywhere_gives_no_move_and_the_plain_line(monkeypatch):
    items, elig = _go(monkeypatch, [_sto()], _world(5.0))
    assert _sav_cards(items) == []
    assert not [i for i in items if i.get("type") == "move"]
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["no_cover"] is True and fact["covered"] == 0.0
    assert fact["note"] == companion.SAVINGS_NO_COVER_NOTE
    assert "covered_by_move" not in elig["barclays"]
    assert all("earmarks_out" not in e for e in elig.values())
    for banned in ("—", "–"):
        assert banned not in fact["note"]


def test_partial_cover_says_so_and_suggests_pausing(monkeypatch):
    items, elig = _go(monkeypatch, [_sto()], _world(100.0))
    card = _sav_cards(items)[0]
    assert card["covered"] is False and card["amount"] == 90.0  # the source keeps its £10
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["no_cover"] is False
    assert "even after the suggested move" in fact["note"] and "pause or cancel" in fact["note"]
    assert elig["barclays"]["short_after_cover"] == 110.0


def test_standing_order_that_fits_is_left_alone(monkeypatch):
    items, elig = _go(monkeypatch, [_sto(40.0)], _world(500.0))
    assert _sav_cards(items) == []
    assert "savings_at_risk" not in elig["barclays"]


def test_payment_shortfall_account_gets_one_combined_move_with_the_savings_part_split_out(monkeypatch):
    # G426 supersedes G422's "keeps its own path": the account still has ONE
    # cover move, but the savings part is the amber fact, not a payment gap.
    bills = [_bill("Phone", 3, 100.0, "barclays", 50.0), _sto(250.0)]
    items, elig = _go(monkeypatch, bills, _world(1000.0))
    cards = [i for i in items if i.get("type") == "move"]
    assert len(cards) == 1 and cards[0]["savings_at_risk"]["amount"] == 250.0
    # Walk deficit 50 + 100 + 250 - 50 = 300; the payments alone (50 - 100) are £50 short.
    assert elig["barclays"]["savings_at_risk"]["amount"] == 250.0


def test_pending_order_gets_the_savings_card_not_the_unfunded_move_item(monkeypatch):
    # G426: a pending (due or overdue, unseen) own-savings order is spoken for
    # by the savings cover move, never the G42 "may stay put" item.
    items, elig = _go(monkeypatch, [_sto(pending=True, days_away=0)], _world(500.0))
    assert [i for i in items if i.get("type") == "unfunded_move"] == []
    assert len(_sav_cards(items)) == 1
    assert elig["barclays"]["savings_at_risk"]["amount"] == 200.0


def test_transfer_into_a_spendable_account_is_not_savings(monkeypatch):
    items, elig = _go(monkeypatch, [_sto(spendable=True)], _world(500.0))
    assert _sav_cards(items) == []
    assert "savings_at_risk" not in elig["barclays"]


def test_plan_gap_and_savings_gap_share_one_combined_move(monkeypatch):
    plans = [_plan("alloc-travel", "Travel", "barclays", 100.0, dest=("pot",))]
    items, elig = _go(monkeypatch, [_sto()], _world(1000.0), plans)
    cards = [i for i in items if i.get("type") == "move"]
    assert len(cards) == 1
    card = cards[0]
    assert card["amount"] == 310.0  # £200 savings + £100 plan + one £10 cushion
    assert len(card["moves"]) == 1
    assert card["savings_at_risk"]["amount"] == 200.0
    assert elig["barclays"]["covered_by_move"]["amount"] == 310.0
    assert elig["barclays"]["short_after_cover"] == 0.0


def test_pure_gap_helper_ignores_card_repayments_and_mixed_bounces():
    base = {"kind": MOVEMENT, "dest_account_id": "sav", "dest_account_spendable": False, "amount": 100}
    mins = {"a": -50.0}
    assert companion._savings_order_gaps(mins, {"a": [base]}, set()) == {"a": {"gap": 50.0, "payment_gap": 0.0, "orders": [base]}}
    assert companion._savings_order_gaps(mins, {"a": [base]}, {"a"}) == {}
    assert companion._savings_order_gaps(mins, {"a": [{**base, "is_card_repayment": True}]}, set()) == {}
    # G426: a real bounce on the same account no longer hides the savings part.
    mixed = companion._savings_order_gaps(mins, {"a": [base, {"kind": "commitment", "amount": 5}]}, set(), {"a": -20.0})
    assert mixed == {"a": {"gap": 30.0, "payment_gap": 20.0, "orders": [base]}}
    assert companion._savings_order_gaps(mins, {"a": [{**base, "dest_account_id": None}]}, set()) == {}


def test_penny_reads_the_same_sentence_from_the_engine_fact(monkeypatch):
    from app.services.penny_consolidation import earmark_facts

    _items, elig = _go(monkeypatch, [_sto()], _world(5.0))
    accounts = [{"id": "barclays", "name": "Barclays", "provider": "barclays"}]
    facts = earmark_facts(eligibility=elig, accounts=accounts, name_tokens=[])
    row = facts["savings_at_risk"][0]
    assert row["no_cover"] is True
    assert row["sentence"].endswith(companion.SAVINGS_NO_COVER_NOTE)
    assert facts["by_account"]["barclays"]["savings_at_risk"] is row
    plain = earmark_facts(eligibility={"x": {"short": False}}, accounts=accounts, name_tokens=[])
    assert "savings_at_risk" not in plain


def test_dismissed_combined_card_is_not_resurfaced_as_a_savings_card(monkeypatch):
    import app.services.companion as comp

    plans = [_plan("alloc-travel", "Travel", "barclays", 100.0, dest=("pot",))]
    items0, _ = _go(monkeypatch, [_sto()], _world(1000.0), plans)
    card = next(i for i in items0 if i.get("type") == "move")
    dismissed_id = card["id"]
    assert dismissed_id.startswith("allocation_shortfall:barclays:")

    async def _get_dismissed(uid):
        return {dismissed_id}

    monkeypatch.setattr(comp, "_get_dismissed", _get_dismissed)
    items, elig = _go(monkeypatch, [_sto()], _world(1000.0), plans)
    assert [i for i in items if i.get("type") == "move"] == []
    assert _sav_cards(items) == []
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["no_cover"] is False
    assert fact["covered"] == 0.0
    assert fact["note"] == comp.SAVINGS_UNSIZED_NOTE
    assert "covered_by_move" not in elig["barclays"]
