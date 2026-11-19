"""G479 (Kevin 2026-11-19, option A): Left to spend follows each account's day-by-day timing.

Each counted current account contributes its LOWEST balance before payday (the lowest running balance
after any of its payments, or its closing balance if that is lower, or its overdraft), money in counted
only from its expected date. A dip below zero is a shortfall that reduces the total, never floored away.
A covered dip (G410) is penalised once. Hero, status, daily amount, How we got, Spend from, Upcoming,
the cover plan and Penny all read the same per-account figures.

Pure helpers over hand-built walks, the headline through the real `compute_safe_to_spend` over the usual
fakes (Kevin's production shape with invented names: 34.89 now, 77.91 out on 23 Nov, +649.59 predicted
later, payday 27 Nov), the own-transfer shapes the G436 review asked about, and a cross-surface check over
the committed H140 scenario snapshots. Figures are hand-derived in the comments.
"""
import asyncio
import json
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.routers.analytics as analytics
import app.services.account_available as aa
import app.services.penny_consolidation as pc
from app.services.account_walk import _run_account
import test_pooled_walk as tpw
from test_pooled_walk import UID, _accounts, _bill, _income, _wire

TODAY = date(2026, 11, 19)
OUT = Path(__file__).parent / "scenarios" / "out"


# ── The walk reading: lowest_point, dip_detail, dip_line ─────────────────────

def _walk(opening, *events):
    """events: (day, amount, is_income). Credits before debits on a shared day (G163)."""
    ordered = sorted(events, key=lambda e: (e[0], 0 if e[2] else 1))
    return _run_account("a", opening, [((d, "a", amt, inc, {}), 0) for d, amt, inc in ordered])


def test_a_bill_before_the_money_sets_the_low_point_and_the_money_cannot_rescue_it():
    # 34.89 - 77.91 = -43.02 on day 4, then + 649.59 on day 7 = 606.57.
    w = _walk(34.89, (4, 77.91, False), (7, 649.59, True))
    assert aa.lowest_point(w) == -43.02 and round(w.closing, 2) == 606.57


def test_money_that_lands_before_the_bill_leaves_no_dip_and_the_figure_is_the_balance_after_it():
    # 34.89 + 649.59 = 684.48 on day 3, - 77.91 = 606.57 on day 4: no dip, the figure is 606.57.
    w = _walk(34.89, (3, 649.59, True), (4, 77.91, False))
    assert aa.lowest_point(w) == 606.57 and aa.dip_detail(w, TODAY) is None


def test_money_and_a_bill_on_the_same_day_the_money_goes_first():
    w = _walk(34.89, (4, 649.59, True), (4, 77.91, False))
    assert aa.lowest_point(w) == 606.57 and aa.dip_detail(w, TODAY) is None


def test_an_account_that_only_receives_is_worth_its_closing_balance():
    assert aa.lowest_point(_walk(1000.0, (1, 3000.0, True))) == 4000.0


def test_an_account_with_nothing_happening_is_worth_its_balance_now():
    assert aa.lowest_point(_walk(15.0)) == 15.0


def test_an_account_overdrawn_today_is_short_today_even_when_money_is_expected():
    w = _walk(-150.0, (3, 1000.0, True))
    assert aa.lowest_point(w) == -150.0
    assert aa.dip_detail(w, TODAY) == {
        "short_by": 150.0, "short_on": "2026-11-19", "short_today": True, "money_in_date": "2026-11-22", "money_in_amount": 1000.0,
    }


def test_the_lowest_of_several_payments_is_the_figure():
    # 1,000 - 400 = 600, - 150 = 450, + 140 lands = 590, - 90 = 500: lowest after a payment is 450.
    assert aa.lowest_point(_walk(1000.0, (2, 400.0, False), (3, 150.0, False), (4, 140.0, True), (5, 90.0, False))) == 450.0


def test_the_dip_names_its_depth_its_date_and_the_money_that_follows():
    w = _walk(34.89, (4, 77.91, False), (7, 649.59, True))
    d = aa.dip_detail(w, TODAY)
    assert d == {"short_by": 43.02, "short_on": "2026-11-23", "money_in_date": "2026-11-26", "money_in_amount": 649.59}
    assert aa.dip_line(d, TODAY) == "£43 short on 23 Nov, before about £650 is expected on 26 Nov"
    assert aa.dip_line(d, TODAY, account_name="Meadow Current") == "Meadow Current: £43 short on 23 Nov, before about £650 is expected on 26 Nov"


def test_a_dip_with_no_money_after_it_says_only_when_it_is_short():
    d = aa.dip_detail(_walk(34.89, (0, 77.91, False)), TODAY)
    assert d == {"short_by": 43.02, "short_on": "2026-11-19", "short_today": True}
    assert aa.dip_line(d, TODAY) == "£43 short today"


def test_two_credits_on_the_day_after_a_dip_are_added_up():
    d = aa.dip_detail(_walk(10.0, (1, 60.0, False), (3, 40.0, True), (3, 25.0, True)), TODAY)
    assert d["money_in_date"] == "2026-11-22" and d["money_in_amount"] == 65.0


def test_copy_has_no_em_dash_no_exclamation_and_hedges_the_prediction():
    line = aa.dip_line({"short_by": 43.02, "short_on": "2026-11-23", "money_in_date": "2026-11-26", "money_in_amount": 649.59}, TODAY)
    assert "\u2014" not in line and "!" not in line and "about" in line and "expected" in line


# ── The headline, through the real compute_safe_to_spend ─────────────────────

@pytest.fixture(autouse=True)
def _today(monkeypatch):
    monkeypatch.setattr(tpw, "TODAY", TODAY)


def _acc(i, name, bal):
    return {"_id": i, "name": name, "balance": bal, "type": "bank", "subtype": "CURRENT", "currency": "GBP"}


def _headline(monkeypatch, accounts, bills=(), incomes=(), inflows=(), payday_offset=8):
    _wire(monkeypatch, bills=list(bills), incomes=list(incomes), accounts=accounts, payday_offset=payday_offset)
    if inflows:
        real = analytics._build_cashflow_response

        async def with_inflows(cached, uid=None, **kw):
            resp = await real(cached, uid=uid, **kw)
            resp["internal_inflows"] = list(inflows)
            return resp

        monkeypatch.setattr(analytics, "_build_cashflow_response", with_inflows)
    return asyncio.run(analytics.compute_safe_to_spend(UID))


def _predicted(name, amount, days, acct):
    return _income(name, amount, days, acct=acct, occurrences=2, amounts_recent=[amount, amount])


def test_kevins_case_the_account_is_short_before_the_money_lands(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 4, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 7, "hb")],
    )
    # 34.89 - 77.91 = -43.02 on 23 Nov; + 649.59 on 26 Nov = 606.57. The lowest is -43.02: short, not 606.57.
    assert out["safe_to_spend"] == -43.02 and out["state"] == "short"
    assert out["left_to_spend_lines"]["accounts_total"] == -43.02
    assert [d["line"] for d in out["left_to_spend_lines"]["dips"]] == ["£43 short on 23 Nov, before about £650 is expected on 26 Nov"]
    d = out["left_to_spend_lines"]["dips"][0]
    assert (d["account_id"], d["short_by"], d["money_in_amount"]) == ("hb", 43.02, 649.59)


def test_the_same_figures_with_the_money_landing_first_leave_no_dip(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 4, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 3, "hb")],
    )
    # 34.89 + 649.59 = 684.48 on 22 Nov, - 77.91 = 606.57 on 23 Nov.
    assert out["safe_to_spend"] == 606.57 and out["left_to_spend_lines"]["dips"] == []
    assert out["state"] == "comfortable"


def test_once_the_money_has_landed_the_figure_is_606_57_again(monkeypatch):
    # The balance now holds the credit (34.89 + 649.59 = 684.48) and only the bill is left to pay.
    out = _headline(monkeypatch, [_acc("hb", "Harbour Current", 684.48)], bills=[_bill("Homebridge housing", 77.91, 4, acct="hb")])
    assert out["safe_to_spend"] == 606.57 and out["left_to_spend_lines"]["dips"] == []


def test_the_money_dated_today_is_not_counted_so_a_bill_today_is_short_today(monkeypatch):
    # An occurrence dated today that has not been observed may already be in the balance, so it is not
    # money in (account_available.money_in_out_window): 34.89 - 77.91 = -43.02 today.
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 0, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 0, "hb")],
    )
    assert out["safe_to_spend"] == -43.02
    assert [d["line"] for d in out["left_to_spend_lines"]["dips"]] == ["£43 short today"]


def test_money_and_a_bill_dated_payday_are_the_next_period_and_change_nothing(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 8, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 8, "hb")],
    )
    assert out["safe_to_spend"] == 34.89 and out["left_to_spend_lines"]["dips"] == []


def test_the_day_before_payday_still_counts(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("hb", "Harbour Current", 34.89)],
        bills=[_bill("Homebridge housing", 77.91, 7, acct="hb")],
        incomes=[_predicted("Transfer from another bank", 649.59, 7, "hb")],
    )
    # Same day, credits first: 34.89 + 649.59 - 77.91 = 606.57.
    assert out["safe_to_spend"] == 606.57


def test_one_account_dips_and_another_has_room_the_total_is_the_signed_sum(monkeypatch):
    out = _headline(
        monkeypatch, [_acc("md", "Meadow Current", 124.0), _acc("hb", "Harbour Current", 1000.0)],
        bills=[_bill("Rent share", 400.0, 2, acct="md")],
        incomes=[_predicted("Side income", 500.0, 5, "md")],
    )
    # Meadow 124 - 400 = -276, + 500 = 224: contributes -276. Harbour 1,000. Total 724.
    assert out["safe_to_spend"] == 724.0
    assert [(d["account_name"], d["short_by"]) for d in out["left_to_spend_lines"]["dips"]] == [("Meadow Current", 276.0)]
    assert out["left_to_spend_lines"]["dips"][0]["line"].startswith("Meadow Current: £276 short on ")


def test_a_dip_nothing_covers_reduces_the_total_by_exactly_the_shortfall(monkeypatch):
    accounts = [_acc("md", "Meadow Current", 124.0), _acc("hb", "Harbour Current", 12.0)]
    bills = [_bill("Rent share", 400.0, 2, acct="md")]
    incomes = [_predicted("Side income", 500.0, 5, "md")]
    out = _headline(monkeypatch, accounts, bills=bills, incomes=incomes)
    healthy = _headline(monkeypatch, accounts, bills=[], incomes=[])
    assert out["safe_to_spend"] == -264.0  # 12 + (124 - 400)
    assert round(healthy["safe_to_spend"] - out["safe_to_spend"], 2) == 400.0  # 136 - (-264): the whole bill, since the money lands after it


def test_a_covered_dip_is_penalised_once_the_cover_plan_never_moves_the_headline():
    # finalise_account_available: Harbour sets 290 aside, Meadow's -276 is covered by 290 in. The pair is
    # 710 + 14 = 724 = 1,000 + (-276), the same as with no cover plan, so the dip is counted once.
    import app.services.companion as companion

    elig = {
        "hb": {"is_current_account": True, "headroom": 990.0, "spend_from_headroom": 710.0,
               "earmarks_out": [{"to_account_id": "md", "to_name": "Meadow", "amount": 290.0}], "earmarked_total": 290.0},
        "md": {"is_current_account": True, "headroom": 0.0, "spend_from_headroom": -276.0},
    }
    companion.finalise_account_available(elig)
    assert (elig["hb"]["spend_from_headroom"], elig["md"]["spend_from_headroom"]) == (710.0, 14.0)
    assert round(sum(e["spend_from_headroom"] for e in elig.values()), 2) == 724.0
    assert (elig["md"]["contribution"], elig["md"]["uncovered_shortfall"]) == (14.0, 0.0)


def test_a_shortfall_that_is_only_part_covered_keeps_the_rest_as_uncovered():
    import app.services.companion as companion

    elig = {
        "hb": {"is_current_account": True, "headroom": 90.0, "spend_from_headroom": 50.0,
               "earmarks_out": [{"to_account_id": "md", "to_name": "Meadow", "amount": 100.0}], "earmarked_total": 100.0},
        "md": {"is_current_account": True, "headroom": 0.0, "spend_from_headroom": -276.0},
    }
    companion.finalise_account_available(elig)
    assert elig["md"]["spend_from_headroom"] == -176.0
    assert (elig["md"]["contribution"], elig["md"]["uncovered_shortfall"]) == (0.0, 176.0)


# ── Own transfers (the G436 review's question): what each shape gives ────────

def _transfer(amount, day, src, dst):
    return (
        _bill("Move to savings pot", amount, day, acct=src, kind=analytics.MOVEMENT, dest_account_id=dst, dest_account_spendable=True),
        {"name": "Move to savings pot", "amount": amount, "days_away": day, "account_id": dst, "source_account_id": src},
    )


def test_transfer_a_predicted_800_from_1000_to_500_with_no_bills_still_nets_to_1500(monkeypatch):
    bill, inflow = _transfer(800.0, 5, "a1", "b1")
    out = _headline(monkeypatch, [_acc("a1", "Account A", 1000.0), _acc("b1", "Account B", 500.0)], bills=[bill], inflows=[inflow])
    # A: 1,000 - 800 = 200 (lowest 200). B: 500 + 800 = 1,300 with no payment of its own, so its figure is its
    # closing 1,300. 200 + 1,300 = 1,500: the transfer nets to zero.
    assert out["left_to_spend_lines"]["accounts_total"] == 1500.0 and out["safe_to_spend"] == 1500.0


def test_transfer_b_the_same_transfer_that_already_happened_today_is_1500(monkeypatch):
    out = _headline(monkeypatch, [_acc("a1", "Account A", 200.0), _acc("b1", "Account B", 1300.0)])
    assert out["safe_to_spend"] == 1500.0


def test_transfer_c_a_transfer_that_lands_before_the_receivers_bill_covers_its_dip(monkeypatch):
    bill, inflow = _transfer(800.0, 5, "a1", "b1")
    b_bill = _bill("Insurance", 900.0, 7, acct="b1")
    out = _headline(monkeypatch, [_acc("a1", "Account A", 1000.0), _acc("b1", "Account B", 500.0)], bills=[bill, b_bill], inflows=[inflow])
    # B: 500 + 800 (day 5) = 1,300, - 900 (day 7) = 400: no dip. A: 200. 200 + 400 = 600, which is also
    # 1,000 + 500 - 900: the transfer nets to zero and B's bill is covered by it.
    assert out["safe_to_spend"] == 600.0 and out["left_to_spend_lines"]["dips"] == []


def test_transfer_d_a_receiver_payment_before_the_credit_lands_means_it_no_longer_nets_a_doctrine_question(monkeypatch):
    bill, inflow = _transfer(800.0, 5, "a1", "b1")
    b_bill = _bill("Insurance", 100.0, 2, acct="b1")
    out = _headline(monkeypatch, [_acc("a1", "Account A", 1000.0), _acc("b1", "Account B", 500.0)], bills=[bill, b_bill], inflows=[inflow])
    # B: 500 - 100 = 400 (day 2), then + 800 (day 5) = 1,200. Its lowest after a payment is 400, because the
    # credit lands after the payment. A: 200. Total 600 where the closing figures would give 200 + 1,200 = 1,400.
    assert out["safe_to_spend"] == 600.0


# ── Every surface reads the same stored figures (committed H140 snapshots) ───

def _snap(prefix):
    path = next(OUT.glob(f"{prefix}*.json"))
    return json.loads(path.read_text())


def _stub_penny(monkeypatch, snap):
    import app.services.notifications as notifications

    async def today(uid):
        return {"account_eligibility": snap["account_eligibility"]}

    async def accounts(uid):
        return [{**a, "name": a["name"]} for a in snap["accounts"]]

    async def pots(uid):
        return set()

    async def tokens(uid):
        return []

    monkeypatch.setattr(pc, "_load_today", today)
    monkeypatch.setattr(pc, "_load_accounts", accounts)
    monkeypatch.setattr(pc, "_load_pot_ids", pots)
    monkeypatch.setattr(notifications, "_user_name_tokens", tokens)


def test_hero_account_figures_and_penny_agree_on_kevins_case(monkeypatch):
    snap = _snap("g479-bill-before-the-income")
    sts, elig = snap["safe_to_spend"], snap["account_eligibility"]
    hb = elig["acc-hb"]
    # Hero (Left to spend), the account's Available, its contribution and shortfall, and the headline lines.
    assert sts["safe_to_spend"] == hb["spend_from_headroom"] == -43.02 == sts["left_to_spend_lines"]["accounts_total"] == sts["lowest_projected_balance"]
    assert (hb["contribution"], hb["uncovered_shortfall"]) == (0.0, 43.02)
    dip = sts["left_to_spend_lines"]["dips"][0]
    assert {k: dip[k] for k in ("short_by", "short_on", "money_in_date", "money_in_amount")} == hb["dips_below_zero"] | {} == {
        "short_by": 43.02, "short_on": "2026-11-23", "money_in_date": "2026-11-26", "money_in_amount": 649.59}
    # Daily amount: the pace pot is Left to spend, which is not positive, so there is no daily amount to show.
    assert sts["safe_to_spend"] <= 0
    # Penny reads the same per-account figures and says it in the engine's own sentence.
    _stub_penny(monkeypatch, snap)
    out = asyncio.run(pc.spend_from_extras("u"))
    # Penny names the account in her own label ("Barclays Harbour Current"); the words after it are the engine's.
    assert [d["sentence"].split(": ", 1)[1] for d in out["short_before_money_arrives"]] == [dip["line"] + "."]
    assert "lowest balance before payday" in out["left_to_spend_basis"]


def test_hero_and_account_figures_agree_when_a_move_covers_the_dip(monkeypatch):
    snap = _snap("g479-one-account-dips-another-has-room")
    sts, elig = snap["safe_to_spend"], snap["account_eligibility"]
    assert round(sum(e["spend_from_headroom"] for e in elig.values()), 2) == sts["safe_to_spend"] == 724.0
    assert elig["acc-md"]["uncovered_shortfall"] == 0.0 and elig["acc-md"]["covered_by_move"]["amount"] == 290.0
    assert elig["acc-hb"]["earmarked_total"] == 290.0
    _stub_penny(monkeypatch, snap)
    out = asyncio.run(pc.spend_from_extras("u"))
    assert out["short_before_money_arrives"][0]["sentence"].split(": ", 1)[1] == sts["left_to_spend_lines"]["dips"][0]["line"].split(": ", 1)[1] + "."


def test_when_nothing_dips_there_is_no_dip_anywhere(monkeypatch):
    snap = _snap("g479-income-lands-before-the-bill")
    assert snap["safe_to_spend"]["left_to_spend_lines"]["dips"] == []
    assert "dips_below_zero" not in snap["account_eligibility"]["acc-hb"]
    _stub_penny(monkeypatch, snap)
    out = asyncio.run(pc.spend_from_extras("u"))
    assert "short_before_money_arrives" not in out


def test_the_cache_versions_moved_so_an_old_payload_cannot_contradict_the_new_rule():
    import app.services.response_cache as rc

    assert analytics.SAFE_TO_SPEND_CALCULATION_VERSION >= 5 and rc.SHAPE_VERSION >= 13
