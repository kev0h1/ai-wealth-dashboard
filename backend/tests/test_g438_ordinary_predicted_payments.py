"""G438 rule 1 (Kevin 2026-11-07): anything seen twice with a recognisable
pattern is a predicted payment, whatever it is. Predicted money in offsets
payments on the same day or after it. Anything on Upcoming counts for a
suggested move when its account would be short. No own-account exemption, no
savings at risk state, no savings-wording recognition. Invented data only."""
import json
import pathlib
from datetime import date, timedelta

import test_companion_shortfall as sh
import test_unfunded_move as um
from app.services import account_walk, companion
from app.services.categories import MOVEMENT


def _savings_order(amount, account_id, days_away=1):
    """A recurring transfer into the user's OWN savings (a saver that is not
    spendable), shaped like analytics' upcoming bill rows."""
    bill = um._mv_bill("REGULAR SAVER", amount, account_id, pending=False, days_away=days_away, dest_account_id="saver")
    bill["dest_account_spendable"] = False
    bill["pending"] = False
    return bill


def test_an_own_savings_order_gets_an_ordinary_move(monkeypatch):
    accounts = [um._account("chase", 50.0, name="Chase Everyday"), um._account("other", 500.0, name="Other Current"),
                um._account("saver", 1000.0, name="Regular Saver", subtype="SAVINGS")]
    items, _ = um._run(monkeypatch, [_savings_order(300.0, "chase")], accounts=accounts)
    moves = [i for i in items if i["type"] == "move"]
    assert len(moves) == 1, [i["type"] for i in items]
    move = moves[0]
    assert move["plan_dest"]["account_id"] == "chase"
    assert move["covered"] is True
    sources = {m["move_map"]["from"]["account_id"] for m in move["moves"]}
    assert sources == {"other"}  # never the saver the order pays into
    assert [b["label"] for b in move["plan_dest"]["bills"]] == ["Regular Saver"]
    assert not any(i["type"] == "unfunded_move" for i in items)


def test_no_savings_at_risk_state_in_the_payload(monkeypatch):
    accounts = [um._account("chase", 50.0), um._account("other", 500.0), um._account("saver", 1000.0, subtype="SAVINGS")]
    items, _ = um._run(monkeypatch, [_savings_order(300.0, "chase")], accounts=accounts)
    blob = json.dumps(items, default=str)
    for word in ("savings_at_risk", "own_savings_elsewhere", "savings_shortfall", "Savings at risk", "Let it skip"):
        assert word not in blob, word
    assert not hasattr(companion, "_savings_at_risk_fact")
    assert not hasattr(account_walk, "is_savings_order") and not hasattr(account_walk, "payment_only_walk")
    try:
        import app.services.own_savings  # noqa: F401
    except ModuleNotFoundError:
        pass
    else:
        raise AssertionError("own_savings is gone")


def test_no_savings_at_risk_in_the_frontend():
    root = pathlib.Path(__file__).resolve().parents[2] / "frontend"
    needles = ("savings_at_risk", "savingsAtRisk", "isSavingsOrder", "own_savings_elsewhere", "Let it skip this month")
    hits = []
    for folder in ("app", "components", "lib", "scripts"):
        for path in (root / folder).rglob("*"):
            if path.suffix not in {".ts", ".tsx", ".mjs"} or "node_modules" in path.parts:
                continue
            text = path.read_text(errors="ignore")
            hits += [f"{path.relative_to(root)}: {n}" for n in needles if n in text]
    assert hits == []


def test_a_standing_order_to_own_savings_is_the_first_bounce_like_any_payment():
    order = sh.bill("Regular Saver", 3, 300, kind=MOVEMENT)
    phone = sh.bill("Phone", 5, 40, kind="commitment")
    events = [(3, "acc", 300.0, False, order), (5, "acc", 40.0, False, phone)]
    _, mins, short, bounced = sh.walk(events)
    assert mins["acc"] == -340.0
    assert sh._gate_recommendation("acc", mins["acc"], short, bounced) is order
    # and the at-risk badge counts both the order and the Phone bill it starved
    assert account_walk.count_at_risk(bounced) == 2


def test_money_in_offsets_payments_on_the_same_day_or_after_it():
    pay = sh.bill("Council Tax", 5, 300, kind="commitment")
    # money in the same day: credited first, nothing bounces
    same_day = [(5, "acc", 300.0, False, pay), (5, "acc", 300.0, True, sh.income("Wages", 5, 300))]
    _, mins, short, bounced = sh.walk(same_day)
    assert mins["acc"] >= 0 and "acc" not in bounced
    # money in earlier: offsets the later payment
    earlier = [(2, "acc", 300.0, True, sh.income("Wages", 2, 300)), (5, "acc", 300.0, False, pay)]
    _, mins, short, bounced = sh.walk(earlier)
    assert mins["acc"] >= 0 and "acc" not in bounced
    # money in AFTER the payment does not rescue it
    later = [(5, "acc", 300.0, False, pay), (8, "acc", 300.0, True, sh.income("Wages", 8, 300))]
    _, mins, short, bounced = sh.walk(later)
    assert mins["acc"] == -300.0 and "acc" in bounced
