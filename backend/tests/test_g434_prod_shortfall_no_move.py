"""G434: production showed a red "Short" with "No covering move is suggested" on
a current account whose only deficit was a standing order into the user's own
Regular Saver, while two other current accounts had room.

Cause: the order was recognised as an own-savings order only through a LEARNED
own destination (`dest_account_id`). A saver the matcher has not paired yet
(not connected, or fewer than two matching credits) left the order an ordinary
own-account movement, which the movement-only gate keeps out of the cover
engine, and the client then read the server's negative position as a red
payment shortfall. The built-in Savings category now recognises the order too;
a movement with neither a learned destination nor that category keeps the
amber "may stay put" exemption.

Invented figures: three current accounts and a saver.
"""
import app.routers.card_terms  # noqa: F401  (H143: pre-import before any collection patching)
import app.services.debt_plan  # noqa: F401
from app.services import companion, response_cache
from app.services.account_walk import count_at_risk, is_savings_order, walk_events
from app.services.categories import MOVEMENT
from tests.test_allocation_shortfall import _account, _bill
from tests.test_g422_savings_at_risk import _go, _sto


def _world():
    return [
        _account("a", 150.0, name="Current A"),
        _account("b", 600.0, name="Current B"),
        _account("c", 200.0, name="Current C"),
        _account("sav", 1000.0, name="Saver", subtype="SAVINGS"),
    ]


def _unlinked(category="Savings", **kw):
    bill = _sto(300.0, account="a", days_away=3, **kw)
    bill["dest_account_id"] = None
    bill["dest_account_spendable"] = None
    bill["category"] = category
    return bill


def _cards(items):
    return [i for i in items if i.get("type") == "move"]


def test_unconnected_saver_with_savings_category_gets_the_amber_cover_move(monkeypatch):
    items, elig = _go(monkeypatch, [_unlinked()], _world())
    cards = _cards(items)
    assert len(cards) == 1 and cards[0]["savings_at_risk"]["amount"] == 150.0
    assert cards[0]["amount"] == 160.0  # £150 gap + the £10 cushion
    # Two other current accounts had room; the one with most headroom funds it.
    assert [m["move_map"]["from"]["account_id"] for m in cards[0]["moves"]] == ["b"]
    a = elig["a"]
    fact = a["savings_at_risk"]
    assert fact["no_cover"] is False and fact["covered"] == 160.0
    assert fact["note"].startswith("Savings at risk. A suggested move from")
    assert a["covered_by_move"]["amount"] == 160.0 and a["short_after_cover"] == 0.0
    assert elig["b"]["earmarks_out"][0]["amount"] == 160.0
    # The order falls back to a plain destination label when none is learned.
    assert fact["orders"][0]["to_name"] == "Savings"
    # Never a payment shortfall or a bill at risk.
    assert not [i for i in items if i.get("type") == "unfunded_move"]


def test_connected_saver_with_a_learned_destination_behaves_the_same(monkeypatch):
    items, elig = _go(monkeypatch, [_sto(300.0, account="a", days_away=3)], _world())
    assert len(_cards(items)) == 1
    fact = elig["a"]["savings_at_risk"]
    assert fact["amount"] == 150.0 and fact["covered"] == 160.0
    # The saver the order pays into is never the cover source.
    assert "earmarks_out" not in elig["sav"]


def test_other_category_without_a_learned_destination_keeps_the_stay_put_exemption(monkeypatch):
    # "Transfer" with no learned destination may be to anyone: not own savings.
    items, elig = _go(monkeypatch, [_unlinked("Transfer")], _world())
    assert _cards(items) == []
    assert "savings_at_risk" not in elig["a"]


def test_savings_category_with_nothing_to_cover_it_gives_the_plain_line(monkeypatch):
    world = _world()
    world[1]["balance"] = 5.0
    world[2]["balance"] = 5.0
    world[3]["balance"] = 5.0
    _items, elig = _go(monkeypatch, [_unlinked()], world)
    fact = elig["a"]["savings_at_risk"]
    assert fact["no_cover"] is True and fact["note"] == companion.SAVINGS_NO_COVER_NOTE


def test_savings_order_predicate():
    base = {"kind": MOVEMENT, "dest_account_id": None, "dest_account_spendable": None, "category": "Savings"}
    assert is_savings_order(base)
    assert is_savings_order({**base, "category": "Investment"})
    assert not is_savings_order({**base, "category": "Transfer"})
    # G434: the engine's own-savings-held-elsewhere recognition (savings wording plus own-money evidence).
    assert is_savings_order({**base, "category": "Transfer", "own_savings_elsewhere": True})
    assert not is_savings_order({**base, "category": "Transfer", "own_savings_elsewhere": False})
    assert not is_savings_order({**base, "is_card_repayment": True})
    assert not is_savings_order({**base, "is_credit_card": True})
    assert not is_savings_order({**base, "kind": "commitment"})
    assert is_savings_order({**base, "category": "Transfer", "dest_account_id": "sav", "dest_account_spendable": False})
    # A learned spendable destination is a pooled move whatever the category says.
    assert not is_savings_order({**base, "dest_account_id": "cur", "dest_account_spendable": True})


def test_savings_category_order_is_not_a_bill_at_risk():
    sto = {"kind": MOVEMENT, "category": "Savings", "amount": 300, "name": "o"}
    phone = {"kind": "commitment", "amount": 100, "name": "phone"}
    events = [(1, "a", 300.0, False, sto), (2, "a", 100.0, False, phone)]
    _r, _m, _s, bounced = walk_events(events, {"a": 150.0})
    assert count_at_risk(bounced) == 1  # the phone bill bounces behind the order
    from app.services.account_walk import payment_only_walk
    _pm, po = payment_only_walk(events, {"a": 150.0})
    assert count_at_risk(bounced, po) == 0  # payments alone clear: savings at risk, not a bill


def test_response_cache_shape_was_bumped_past_g419():
    # G421-G428 changed what /today carries without a bump; entries stamped 9 must be rejected.
    assert response_cache.SHAPE_VERSION >= 10
