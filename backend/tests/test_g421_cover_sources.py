"""G421: a suggested cover uses the fewest sources, at most two. One account
with room covers it alone (largest headroom first); otherwise two; if even two
cannot cover it the move covers what it can and the rest stays short_after_cover.
The destination is never a source, under any id. Invented accounts only."""
import app.routers.card_terms  # noqa: F401  H143: bind real handles before the fakes patch db_collections
import app.services.companion as companion  # noqa: F401
import app.services.debt_plan  # noqa: F401
from test_cover_plan_account_eligibility import _account, _bill, _find, _run


def _dest(**extra):
    d = _account("dest", 124.0, name="Meadow Current", provider="natwest")
    d.update(extra)
    return d


def _src(sid, balance, name=None, provider="barclays", **extra):
    a = _account(sid, balance, name=name or f"Source {sid}", provider=provider)
    a.update(extra)
    return a


def _go(monkeypatch, accounts):
    elig: dict = {}
    # Shortfall 400 - 124 = 276, rounded up to 280, plus 10 = 290 needed.
    items = _run(monkeypatch, [_bill("Rent share", 2, 400.0, "dest", 124.0, kind="commitment")],
                 accounts=accounts, account_eligibility_out=elig)
    return items, elig


def _from_ids(elig):
    return [f["account_id"] for f in elig["dest"]["covered_by_move"]["from"]]


def test_one_big_source_covers_alone(monkeypatch):
    items, elig = _go(monkeypatch, [_dest(), _src("a", 1000.0), _src("b", 400.0), _src("c", 400.0)])
    assert _from_ids(elig) == ["a"]
    assert elig["dest"]["covered_by_move"]["amount"] == 290.0
    assert elig["dest"]["short_after_cover"] == 0.0


def test_the_largest_single_source_wins_not_the_first(monkeypatch):
    _, elig = _go(monkeypatch, [_dest(), _src("a", 350.0), _src("b", 1500.0), _src("c", 800.0)])
    assert _from_ids(elig) == ["b"]


def test_two_sources_when_none_covers_alone(monkeypatch):
    _, elig = _go(monkeypatch, [_dest(), _src("a", 200.0), _src("b", 150.0), _src("c", 100.0)])
    assert _from_ids(elig) == ["a", "b"]
    assert elig["dest"]["covered_by_move"]["amount"] == 290.0
    assert elig["dest"]["short_after_cover"] == 0.0


def test_never_three_or_more_sources_and_partial_cover_is_honest(monkeypatch):
    # Four small sources: any three would cover it, two cannot.
    items, elig = _go(monkeypatch, [_dest(), _src("a", 120.0), _src("b", 110.0), _src("c", 110.0), _src("d", 110.0)])
    legs = elig["dest"]["covered_by_move"]["from"]
    assert len(legs) == 2
    covered = elig["dest"]["covered_by_move"]["amount"]
    assert 0 < covered < 290
    assert elig["dest"]["short_after_cover"] == round(276.0 - covered, 2) > 0
    move = _find(items, "move")
    assert len({m["move_map"]["from"]["account_id"] for m in move["moves"]}) == 2


def test_the_destination_is_never_its_own_source_under_a_second_id(monkeypatch):
    # The same real account linked twice: same sort code and account number.
    twin = _src("dest-twin", 5000.0, name="Meadow Current", provider="natwest",
                sort_code="11-22-33", account_number="12345678")
    dest = _dest(sort_code="112233", account_number="12345678")
    _, elig = _go(monkeypatch, [dest, twin, _src("a", 400.0)])
    assert "dest-twin" not in _from_ids(elig)
    assert "dest-twin" not in elig["dest"].get("covered_by_move", {}).get("from", [])


def test_a_holder_named_duplicate_of_the_destination_is_excluded(monkeypatch):
    # Same bank, same holder-style name, same trailing digits, no sort code.
    dest = _dest(name="Mr Sam Example", provider="natwest", account_number="****4321")
    twin = _src("dest-copy", 5000.0, name="Mr Sam Example", provider="natwest", account_number="****4321")
    _, elig = _go(monkeypatch, [dest, twin, _src("a", 400.0)])
    assert _from_ids(elig) == ["a"]


def test_a_different_account_with_the_same_name_is_still_a_source(monkeypatch):
    # Same name but different trailing digits: a genuinely different account.
    dest = _dest(name="Everyday Account", provider="natwest", account_number="****4321")
    other = _src("other", 5000.0, name="Everyday Account", provider="natwest", account_number="****9876")
    _, elig = _go(monkeypatch, [dest, other])
    assert _from_ids(elig) == ["other"]


def test_cover_rows_carry_the_g337_display_label(monkeypatch):
    holder = _src("holder", 1000.0, name="Mr Sam Example", provider="barclays")
    _, elig = _go(monkeypatch, [_dest(), holder])
    row = elig["dest"]["covered_by_move"]["from"][0]
    assert row["display_label"] == "your Barclays account"
