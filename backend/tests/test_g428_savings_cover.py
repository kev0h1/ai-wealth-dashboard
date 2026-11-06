"""G428: when current accounts cannot cover a shortfall, the cover plan adds
at most ONE savings account for the rest. Current money first (two at most),
three sources in all, every source earmarked (G410), the savings leg labelled
source_kind savings, plain copy naming it, and a plain uncovered line when even
savings cannot cover. The destination is never a source, and a savings balance
is never spendable (Left to spend and Spend from are unchanged by it).
Invented accounts only."""
import app.routers.card_terms  # noqa: F401  H143: bind real handles before the fakes patch db_collections
import app.services.companion as companion  # noqa: F401
import app.services.debt_plan  # noqa: F401
from test_cover_plan_account_eligibility import _account, _bill, _find, _run


def _acc(sid, balance, name=None, provider="barclays", **extra):
    a = _account(sid, balance, name=name or f"Source {sid}", provider=provider)
    a.update(extra)
    return a


def _sav(sid, balance, name="Meadow Savings"):
    return _acc(sid, balance, name=name, subtype="SAVINGS")


def _dest():
    return _acc("dest", 124.0, name="Salary Current", provider="natwest")


def _go(monkeypatch, accounts, bill=1400.0):
    elig: dict = {}
    # Shortfall 1400 - 124 = 1276, rounded up to 1280, plus 10 = 1290 needed.
    items = _run(monkeypatch, [_bill("Card repayment", 2, bill, "dest", 124.0, kind="commitment")],
                 accounts=accounts, account_eligibility_out=elig)
    return items, elig


def _legs(elig):
    return {f["account_id"]: f for f in elig["dest"]["covered_by_move"]["from"]}


def test_current_accounts_first_then_one_savings_for_the_rest(monkeypatch):
    # Current headroom 100 and 50; savings headroom 4,990. Need 1,290.
    items, elig = _go(monkeypatch, [_dest(), _acc("a", 110.0), _acc("b", 60.0), _acc("c", 40.0), _sav("sv", 5000.0)])
    legs = _legs(elig)
    assert sorted(legs) == ["a", "b", "sv"]  # three at most; the third current account is not used
    assert legs["a"]["amount"] == 100.0 and legs["b"]["amount"] == 50.0 and legs["sv"]["amount"] == 1140.0
    assert legs["sv"]["source_kind"] == "savings"
    assert "source_kind" not in legs["a"] and "source_kind" not in legs["b"]
    cov = elig["dest"]["covered_by_move"]
    assert cov["amount"] == 1290.0 and cov["current_amount"] == 150.0 and cov["savings_amount"] == 1140.0
    assert elig["dest"]["short_after_cover"] == 0.0
    # Earmarks on every source, the savings account included.
    for sid, amt in (("a", 100.0), ("b", 50.0), ("sv", 1140.0)):
        assert elig[sid]["earmarked_total"] == amt
        assert elig[sid]["earmarks_out"][0]["to_account_id"] == "dest"
    assert "earmarked_total" not in elig["c"]
    move = _find(items, "move")
    assert move["cover_note"] == "Your other accounts can cover £150. A move of £1,140 from Barclays Meadow Savings would cover the rest."
    assert move["cover_split"] == {"current_amount": 150.0, "savings_amount": 1140.0, "savings_name": "Barclays Meadow Savings", "uncovered": 0.0}
    assert move.get("residual") is None and move["covered"] is True
    kinds = {m["move_map"]["from"]["account_id"]: m["move_map"]["from"].get("source_kind") for m in move["moves"]}
    assert kinds == {"a": None, "b": None, "sv": "savings"}


def test_savings_alone_covers_when_no_current_account_has_room(monkeypatch):
    items, elig = _go(monkeypatch, [_dest(), _acc("a", 12.0), _sav("sv", 5000.0)])
    assert list(_legs(elig)) == ["sv"]
    move = _find(items, "move")
    assert move["cover_note"] == "A move of £1,290 from Barclays Meadow Savings would cover it."


def test_the_largest_savings_account_is_the_single_savings_source(monkeypatch):
    _, elig = _go(monkeypatch, [_dest(), _acc("a", 110.0), _sav("sv1", 800.0, "Small Saver"), _sav("sv2", 6000.0, "Big Saver")])
    legs = _legs(elig)
    assert sorted(legs) == ["a", "sv2"] and legs["sv2"]["source_kind"] == "savings"


def test_savings_not_enough_gives_the_plain_uncovered_line_with_options(monkeypatch):
    # Current 100 + 50, savings headroom 390: covers 540 of the 1,276 shortfall.
    items, elig = _go(monkeypatch, [_dest(), _acc("a", 110.0), _acc("b", 60.0), _sav("sv", 400.0)])
    assert elig["dest"]["covered_by_move"]["amount"] == 540.0
    assert elig["dest"]["short_after_cover"] == 736.0
    move = _find(items, "move")
    assert move["cover_note"] == (
        "Your other accounts can cover £150. A move of £390 from Barclays Meadow Savings would cover more, "
        "but £736 is still uncovered. You could edit a plan or skip a payment on Upcoming instead."
    )
    assert move["cover_split"]["uncovered"] == 736.0 and move["covered"] is False


def test_no_savings_at_all_still_says_what_is_uncovered_with_options(monkeypatch):
    items, elig = _go(monkeypatch, [_dest(), _acc("a", 110.0), _acc("b", 60.0)])
    assert elig["dest"]["short_after_cover"] == 1126.0
    move = _find(items, "move")
    assert "cover_note" not in move
    assert move["residual"] == "These moves cover £150, but £1,126 is still uncovered. You could edit a plan or skip a payment on Upcoming instead."


def test_never_more_than_three_sources_and_the_destination_is_never_one(monkeypatch):
    twin = _acc("dest-twin", 9000.0, name="Salary Current", provider="natwest", sort_code="11-22-33", account_number="12345678")
    dest = _dest()
    dest.update(sort_code="112233", account_number="12345678")
    savings_twin = _sav("sv-twin", 9000.0, "Salary Current")
    savings_twin.update(sort_code="11-22-33", account_number="12345678")
    _, elig = _go(monkeypatch, [dest, twin, savings_twin, _acc("a", 110.0), _acc("b", 60.0), _acc("c", 80.0), _sav("sv", 400.0), _sav("sv2", 300.0)])
    legs = _legs(elig)
    assert len(legs) <= 3
    assert "dest" not in legs and "dest-twin" not in legs and "sv-twin" not in legs
    assert sum(1 for f in legs.values() if f.get("source_kind") == "savings") <= 1


def test_savings_balance_is_never_spendable(monkeypatch):
    # Same current accounts with and without a savings account: the current
    # accounts' Spend from figures are unchanged by it.
    base = [_dest(), _acc("a", 110.0), _acc("b", 60.0)]
    _, without = _go(monkeypatch, list(base))
    _, with_sv = _go(monkeypatch, base + [_sav("sv", 5000.0)])
    # The savings account is classed savings, so the pooled allocation (the
    # router, covered by the H140 scenario) gives it no Spend from at all.
    assert with_sv["sv"]["is_current_account"] is False
    for sid in ("a", "b"):
        assert with_sv[sid]["spend_from_headroom"] == without[sid]["spend_from_headroom"]
