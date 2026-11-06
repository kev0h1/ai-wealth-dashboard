"""G426: an unfunded own-savings standing order gets the G422 cover treatment
whether or not other items on its source account are short, and whether it is
still to come or pending.

Kevin's shape (invented figures): a current account holding £150 with a £300
standing order to the user's own saver and another bill on the same account.
One combined, earmarked cover move funds the walk deficit; the savings part is
the amber `savings_at_risk` fact and never a payment shortfall; letting the
order skip this month (an occurrence override, applied when the response is
built) removes the move and the earmark; nothing to cover it gives G422's plain
no-cover line.
"""
from app.services import companion
from app.services.account_walk import count_at_risk
from app.services.categories import MOVEMENT
from tests.test_allocation_shortfall import _bill
from tests.test_g422_savings_at_risk import _go, _sav_cards, _sto, _world


def _main(balance=150.0, other=500.0):
    accts = _world(other)
    accts[0]["balance"] = balance
    return accts


def _cards(items):
    return [i for i in items if i.get("type") == "move"]


def test_other_bill_short_too_gives_one_combined_earmarked_move(monkeypatch):
    # STO first (day 3), then a £100 bill (day 5). Walk: 150 - 300 = -150, -100 = -250.
    # Payments alone: 150 - 100 = +50, so the whole £250 is the savings part.
    bills = [_sto(300.0, days_away=3), _bill("Phone", 5, 100.0, "barclays", 150.0)]
    items, elig = _go(monkeypatch, bills, _main())
    cards = _cards(items)
    assert len(cards) == 1
    card = cards[0]
    assert card["amount"] == 260.0  # ceil5(250) + the £10 cushion
    assert [m["move_map"]["from"]["account_id"] for m in card["moves"]] == ["monzo"]
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["amount"] == 250.0 and fact["no_cover"] is False and fact["covered"] == 250.0
    assert card["savings_at_risk"] == fact
    assert "1 payment (£100) and a £300 savings transfer" in card["body"]
    assert elig["barclays"]["covered_by_move"]["amount"] == 260.0
    assert elig["barclays"]["short_after_cover"] == 0.0
    assert elig["monzo"]["earmarks_out"] == [{"to_account_id": "barclays", "to_name": "Barclays", "amount": 260.0}]
    # The saver the order pays into is never a source.
    assert "earmarks_out" not in elig["sav"]
    # The order rides the card as a savings row that can be let skip.
    rows = {b.get("key", b["label"]): b for b in card["plan_dest"]["bills"]}
    assert rows["STO SAVER"]["savings"] is True and rows["STO SAVER"]["can_skip"] is True
    assert "savings" not in rows["Phone"]


def test_payment_part_stays_the_only_payment_shortfall(monkeypatch):
    # Phone 100 (day 3), STO 300 (day 4), Gas 60 (day 6) on £150.
    # Walk low: 150 - 100 - 300 - 60 = -310. Payments alone: 150 - 100 - 60 = -10.
    bills = [_bill("Phone", 3, 100.0, "barclays", 150.0), _sto(300.0, days_away=4), _bill("Gas", 6, 60.0, "barclays", 150.0)]
    items, elig = _go(monkeypatch, bills, _main())
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["amount"] == 300.0
    assert len(_cards(items)) == 1


def test_savings_order_itself_is_never_a_bill_at_risk():
    sto = {"kind": MOVEMENT, "dest_account_id": "sav", "dest_account_spendable": False, "amount": 300}
    assert count_at_risk({"a": [sto]}) == 0
    assert count_at_risk({"a": [sto, {"kind": "commitment", "amount": 100}]}) == 1


def test_pending_variant_with_another_short_bill_is_one_combined_move(monkeypatch):
    bills = [_sto(300.0, days_away=0, pending=True), _bill("Phone", 5, 100.0, "barclays", 150.0)]
    items, elig = _go(monkeypatch, bills, _main())
    assert [i for i in items if i.get("type") == "unfunded_move"] == []
    cards = _cards(items)
    assert len(cards) == 1 and cards[0]["savings_at_risk"]["amount"] == 250.0
    assert elig["monzo"]["earmarks_out"][0]["amount"] == 260.0
    sto_row = next(b for b in cards[0]["plan_dest"]["bills"] if b["key"] == "STO SAVER")
    assert sto_row["can_skip"] is True and sto_row["savings"] is True


def test_not_yet_due_savings_only_account_with_a_second_unfunded_order(monkeypatch):
    bills = [_sto(300.0, days_away=3), _sto(100.0, days_away=4)]
    bills[1]["name"] = "STO SAVER TWO"
    items, elig = _go(monkeypatch, bills, _main())
    cards = _sav_cards(items)
    assert len(cards) == 1
    # 150 - 300 - 100 = -250; no payments, so all £250 is savings.
    assert elig["barclays"]["savings_at_risk"]["amount"] == 250.0
    assert len(cards[0]["plan_dest"]["bills"]) == 2


def test_skip_this_month_removes_the_move_and_the_earmark(monkeypatch):
    # An occurrence override removes the order from the response before the
    # engine runs, so the next compute is the world without it.
    with_order = [_sto(300.0, days_away=3), _bill("Phone", 5, 100.0, "barclays", 150.0)]
    _items, elig = _go(monkeypatch, with_order, _main())
    assert elig["monzo"].get("earmarks_out")
    skipped = [b for b in with_order if b["name"] != "STO SAVER"]
    items, elig2 = _go(monkeypatch, skipped, _main())
    assert _cards(items) == []
    assert "savings_at_risk" not in elig2["barclays"]
    assert "covered_by_move" not in elig2["barclays"]
    assert not elig2["monzo"].get("earmarks_out")


def test_nothing_can_cover_it_gives_the_plain_line_with_another_bill_short(monkeypatch):
    bills = [_sto(300.0, days_away=3), _bill("Phone", 5, 100.0, "barclays", 150.0)]
    items, elig = _go(monkeypatch, bills, _main(other=5.0))
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["no_cover"] is True and fact["note"] == companion.SAVINGS_NO_COVER_NOTE
    assert all("earmarks_out" not in e for e in elig.values())
    for banned in ("—", "–"):
        assert banned not in fact["note"]


def test_savings_orders_into_a_spendable_account_keep_the_unfunded_move_item(monkeypatch):
    # The G42 "may stay put" item still covers a pending move into an own
    # spendable account (a pooled transfer): a different case from savings.
    items, elig = _go(monkeypatch, [_sto(300.0, days_away=0, pending=True, spendable=True)], _main())
    assert [i for i in items if i.get("type") == "unfunded_move"]
    assert "savings_at_risk" not in elig["barclays"]


def test_funded_order_that_drains_the_account_so_a_later_bill_bounces_is_skippable(monkeypatch):
    # £400: the £300 order is funded (100 left), then a £150 bill bounces (-50).
    # Payments alone: 400 - 150 = +250, so the whole £50 is the savings part and
    # the funded order is the one to let skip.
    bills = [_sto(300.0, days_away=3), _bill("Phone", 5, 150.0, "barclays", 400.0)]
    items, elig = _go(monkeypatch, bills, _main(balance=400.0))
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["amount"] == 50.0
    assert [o["name"] for o in fact["orders"]] == ["STO SAVER"]
    card = _cards(items)[0]
    row = next(b for b in card["plan_dest"]["bills"] if b.get("key") == "STO SAVER")
    assert row["can_skip"] is True and row["savings"] is True


def test_funded_earlier_order_and_bounced_later_order_both_skippable(monkeypatch):
    # £500: order A £300 funded (200 left), order B £400 bounces (-200). Removing
    # either raises the low point, so both contribute to the £200 gap.
    a = _sto(300.0, days_away=2)
    b = _sto(400.0, days_away=4)
    b["name"] = "STO SAVER TWO"
    items, elig = _go(monkeypatch, [a, b], _main(balance=500.0))
    fact = elig["barclays"]["savings_at_risk"]
    assert fact["amount"] == 200.0
    assert sorted(o["name"] for o in fact["orders"]) == ["STO SAVER", "STO SAVER TWO"]
    card = _sav_cards(items)[0]
    assert sorted(b.get("key") for b in card["plan_dest"]["bills"]) == ["STO SAVER", "STO SAVER TWO"]


def test_payments_short_on_their_own_keep_the_payment_part_beside_the_savings_part(monkeypatch):
    # £100: Rent £300 is £200 short on its own; the later £20 order adds £20 more.
    bills = [_bill("Rent", 2, 300.0, "barclays", 100.0), _sto(20.0, days_away=4)]
    _items, elig = _go(monkeypatch, bills, _main(balance=100.0))
    # Walk low -220; payments alone -200, so the savings part is 20.
    assert elig["barclays"]["savings_at_risk"]["amount"] == 20.0


def test_at_risk_counts_a_cascaded_bill_only_when_it_also_bounces_without_the_order():
    from app.services.account_walk import payment_only_walk, walk_events

    sto = {"kind": MOVEMENT, "dest_account_id": "sav", "dest_account_spendable": False, "amount": 300, "name": "o"}
    phone = {"kind": "commitment", "amount": 100, "name": "phone"}
    gas = {"kind": "commitment", "amount": 200, "name": "gas"}
    events = [(1, "a", 300.0, False, sto), (2, "a", 100.0, False, phone), (3, "a", 200.0, False, gas)]
    _r, _m, _s, bounced = walk_events(events, {"a": 150.0})
    _pm, po = payment_only_walk(events, {"a": 150.0})
    assert count_at_risk(bounced) == 2          # the old badge: both cascade
    assert count_at_risk(bounced, po) == 1      # only gas bounces on its own
    repay = {"kind": MOVEMENT, "is_card_repayment": True, "amount": 500, "name": "card"}
    ev2 = [(1, "a", 300.0, False, sto), (2, "a", 500.0, False, repay)]
    _r, _m, _s, b2 = walk_events(ev2, {"a": 150.0})
    assert count_at_risk(b2, payment_only_walk(ev2, {"a": 150.0})[1]) == 1  # a card repayment always counts
