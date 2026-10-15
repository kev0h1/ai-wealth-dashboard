"""G268: one definition of spending (app.services.spending).

One test per row of Kevin's table (2026-10-14), the own-account business
transfer ("AURIQ AURIQ TIDE", 15,000) against a third-party Business payment,
and the reconciliation: for one fixture period the donut total, the pace day-N
total, the period comparison "this period" figure, money shape's Out, Spend's
Out and Penny's category tools are all the same number.

No network and no real database: collections are fakes.
"""
import asyncio
from datetime import datetime, timedelta

import pytest

import app.routers.transactions as transactions_router
import app.services.pace as pace
import app.services.penny_tools as penny_tools
import app.services.spend_verdict as spend_verdict
import app.services.spending as spending
from app.core import timeutil
from app.services.categories import BUILTIN_CATEGORY_KINDS, CategoryKinds
from app.services.money_shape import bucket_period
from app.services.spending import (
    CardAccount,
    SpendingContext,
    card_accounts_from_docs,
    find_card_repayment_ids,
    classify_flow,
    find_own_move_ids,
    is_spending,
    spend_amount,
    txn_flow,
)

UID = "g268-fixture-user"
KINDS = CategoryKinds({**BUILTIN_CATEGORY_KINDS, "Business": "discretionary", "Gifts": "discretionary", "Fees": "discretionary"})

# The user's identity: a name and the digits of their other (connected) account.
IDENTITY = {
    "name_tokens": ["kevin", "maingi"],
    "own_ids": {"20202020"},
    "own_map": {"20202020": {"account_id": "savings-acc", "type": "bank", "subtype": "savings"}},
}

TODAY = timeutil.user_today()
START = TODAY - timedelta(days=9)


def _dt(days_after_start: int) -> datetime:
    d = START + timedelta(days=days_after_start)
    return datetime(d.year, d.month, d.day, 12, 0, 0)


_n = [0]


def doc(category, amount, *, debit=True, day=1, desc="", merchant="", account="cur", currency="GBP", **extra):
    _n[0] += 1
    return {
        "_id": f"t{_n[0]}", "amount": float(amount), "date": _dt(day), "category": category,
        "transaction_type": "debit" if debit else "credit", "description": desc,
        "merchant_name": merchant, "account_id": account, "currency": currency, **extra,
    }


# The user's connected NatWest World Mastercard.
CARDS = card_accounts_from_docs([
    {"_id": "card-nw", "name": "World Mastercard", "provider": "NATWEST", "account_number": "40001234"},
])


def ctx_for(docs, identity=IDENTITY, cards=CARDS):
    return SpendingContext.from_docs(docs, KINDS, identity, cards)


# ── One test per row of Kevin's table ────────────────────────────────────────

def test_row_everyday_purchases_count():
    docs = [doc("Shopping", 40), doc("Eating Out", 18), doc("Groceries", 62), doc("Travel", 880)]
    ctx = ctx_for(docs)
    assert all(is_spending(d, ctx) for d in docs)
    assert sum(spend_amount(d, ctx) for d in docs) == pytest.approx(1000)


def test_row_bills_and_subscriptions_count():
    docs = [doc("Bills", 90), doc("Subscriptions", 12.99), doc("Software", 9)]
    ctx = ctx_for(docs)
    assert all(is_spending(d, ctx) for d in docs)


def test_row_whole_mortgage_payment_counts_as_housing():
    d = doc("Mortgage", 1124)
    assert spend_amount(d, ctx_for([d])) == pytest.approx(1124)  # the whole payment, not interest only


def test_row_loan_repayments_such_as_car_finance_count():
    d = doc("Car finance", 250)
    assert is_spending(d, ctx_for([d]))


def test_row_fees_interest_gifts_and_family_count():
    docs = [doc("Fees", 12), doc("Gifts", 50), doc("Other", 9, desc="OVERDRAFT INTEREST")]
    ctx = ctx_for(docs)
    assert all(is_spending(d, ctx) for d in docs)


def test_row_transfers_between_own_accounts_do_not_count():
    d = doc("Transfer", 500, desc="TO SAVINGS POT")
    flow = txn_flow(d, ctx_for([d]))
    assert not flow.counts_as_spend and flow.signed(500) == 0 and flow.reason == "movement"


def test_row_savings_investment_and_pension_do_not_count():
    docs = [doc("Savings", 200), doc("Investment", 400, desc="VANGUARD"), doc("Investment", 300, desc="PENSION CONTRIBUTION")]
    ctx = ctx_for(docs)
    assert not any(is_spending(d, ctx) for d in docs)
    assert sum(spend_amount(d, ctx) for d in docs) == 0


def test_row_credit_card_repayment_does_not_count():
    d = doc("Debt", 300, desc="NW WORLD MASTERCAR")
    flow = txn_flow(d, ctx_for([d]))
    assert not flow.counts_as_spend and flow.reason == "card_repayment"


def test_a_debt_loan_repayment_counts():
    loan = doc("Debt", 180, desc="STUDENT LOANS CO SLC")
    flow = txn_flow(loan, ctx_for([loan]))
    assert flow.counts_as_spend and flow.reason == "loan_repayment"
    assert spend_amount(loan, ctx_for([loan])) == pytest.approx(180)
    # a loan whose text names the user's card provider is still a loan
    lloyds_style = doc("Debt", 90, desc="NATWEST PERSONAL LOAN")
    assert is_spending(lloyds_style, ctx_for([lloyds_style]))


def test_a_debt_row_with_a_credit_landing_on_a_card_is_excluded():
    pay = doc("Debt", 250, day=2, desc="STO 0123")
    landed = doc("Transfer", 250, debit=False, day=2, account="card-nw", desc="PAYMENT RECEIVED")
    ctx = ctx_for([pay, landed], cards=[CardAccount("card-nw", frozenset(), frozenset(), None)])
    assert txn_flow(pay, ctx).reason == "card_repayment"


def test_a_debt_row_whose_text_has_the_card_last_four_is_excluded():
    d = doc("Debt", 120, desc="TO CARD ENDING 1234")
    assert txn_flow(d, ctx_for([d])).reason == "card_repayment"


def test_a_debt_row_with_no_evidence_and_no_card_accounts_counts():
    d = doc("Debt", 75, desc="SOME CREDITOR")
    ctx = ctx_for([d], cards=[])
    assert txn_flow(d, ctx).counts_as_spend
    assert find_card_repayment_ids([d], KINDS, []) == set()


def test_a_debt_debit_leaving_a_card_is_not_a_repayment():
    d = doc("Debt", 60, account="card-nw", desc="NW WORLD MASTERCAR")
    assert find_card_repayment_ids([d], KINDS, CARDS) == set()


def test_row_refund_nets_off_spending():
    purchase = doc("Shopping", 100, day=1)
    refund = doc("Shopping", 40, debit=False, day=3)
    ctx = ctx_for([purchase, refund])
    assert spend_amount(refund, ctx) == pytest.approx(-40)
    assert spend_amount(purchase, ctx) + spend_amount(refund, ctx) == pytest.approx(60)
    # A refund is not income: it never reaches the income total either.
    flow = txn_flow(refund, ctx)
    assert flow.kind == "refund" and not flow.counts_as_spend


def test_income_is_not_spending():
    d = doc("Income", 2500, debit=False)
    assert txn_flow(d, ctx_for([d])).kind == "income"


# ── Business: own account is a movement, a third party is spending ───────────

def _business_period():
    own = doc("Business", 15000, day=4, desc="AURIQ AURIQ TIDE", merchant="Auriq Auriq Tide")
    # The incoming leg lands on the (connected) business account two days later.
    credit = doc("Transfer", 15000, debit=False, day=5, account="tide-acc", desc="FASTER PAYMENT RECEIVED")
    third_party = doc("Business", 500, day=6, desc="ACME SUPPLIES LTD", merchant="Acme Supplies Ltd")
    fee = doc("Business", 30, day=6, desc="TIDE PLATFORM LIMI", merchant="Tide Platform Limi")
    return own, credit, third_party, fee


def test_business_payment_to_own_account_is_a_movement():
    own, credit, third_party, fee = _business_period()
    ctx = ctx_for([own, credit, third_party, fee])
    flow = txn_flow(own, ctx)
    assert not flow.counts_as_spend and flow.reason == "own_account"
    assert spend_amount(own, ctx) == 0


def test_business_payment_to_a_third_party_counts():
    own, credit, third_party, fee = _business_period()
    ctx = ctx_for([own, credit, third_party, fee])
    assert is_spending(third_party, ctx)
    assert spend_amount(third_party, ctx) == pytest.approx(500)


def test_a_provider_fee_with_the_same_name_is_not_evidence_of_own_account():
    own, credit, third_party, fee = _business_period()
    ctx = ctx_for([own, credit, third_party, fee])
    assert is_spending(fee, ctx)  # "TIDE PLATFORM LIMI" is a fee, not the user's account


def test_own_account_is_found_by_another_account_number():
    d = doc("Business", 2000, desc="TFR 20202020 BUSINESS SAVER")
    assert find_own_move_ids([d], KINDS, IDENTITY) == {d["_id"]}


def test_a_credit_on_the_same_account_is_a_refund_not_a_partner():
    purchase = doc("Business", 70, day=2)
    same_account_credit = doc("Transfer", 70, debit=False, day=3)  # same account "cur"
    assert find_own_move_ids([purchase, same_account_credit], KINDS, IDENTITY) == set()


def test_a_credit_pairs_only_one_debit():
    a = doc("Business", 100, day=2)
    b = doc("Business", 100, day=2)
    c = doc("Transfer", 100, debit=False, day=3, account="other")
    assert len(find_own_move_ids([a, b, c], KINDS, IDENTITY)) == 1


def test_the_users_name_alone_never_flags_a_row():
    rent = doc("Other", 900, desc="MR K MAINGI RENT REF 7")
    business = doc("Business", 300, desc="KEVIN MAINGI")
    mortgage = doc("Mortgage", 1124, desc="MORTGAGE KEVIN MAINGI REF 1")
    assert find_own_move_ids([rent, business, mortgage], KINDS, IDENTITY) == set()


def test_the_users_name_with_a_pair_match_flags_the_row():
    out = doc("Business", 300, day=2, desc="KEVIN MAINGI")
    inn = doc("Transfer", 300, debit=False, day=3, account="tide-acc")
    assert find_own_move_ids([out, inn], KINDS, IDENTITY) == {out["_id"]}


def test_a_purchase_does_not_pair_with_a_salary_credit_of_the_same_amount():
    purchase = doc("Shopping", 100, day=2, account="card-c")
    salary = doc("Income", 100, debit=False, day=3, account="cur")
    assert find_own_move_ids([purchase, salary], KINDS, IDENTITY) == set()
    # even an Other/Business debit may not pair with Income
    other = doc("Other", 100, day=2, account="card-c")
    assert find_own_move_ids([other, salary], KINDS, IDENTITY) == set()


def test_a_purchase_never_pairs_by_amount_even_with_a_transfer_credit():
    purchase = doc("Groceries", 100, day=2, account="card-c")
    transfer_in = doc("Transfer", 100, debit=False, day=3, account="cur")
    assert find_own_move_ids([purchase, transfer_in], KINDS, IDENTITY) == set()


def test_a_purchase_does_not_pair_with_the_free_leg_of_a_savings_transfer():
    savings_out = doc("Savings", 100, day=2, account="cur")           # movement debit
    free_leg = doc("Income", 100, debit=False, day=2, account="pot")  # its incoming leg, tagged Income
    business = doc("Business", 100, day=3, account="card-c")
    # the movement debit claims its leg first, so the Business debit finds no partner
    assert find_own_move_ids([business, savings_out, free_leg], KINDS, IDENTITY) == set()
    # and a Transfer-categorised free leg is claimed the same way
    leg2 = doc("Transfer", 100, debit=False, day=2, account="pot")
    assert find_own_move_ids([business, savings_out, leg2], KINDS, IDENTITY) == set()


def test_the_closest_dated_partner_is_preferred():
    out = doc("Business", 250, day=5, account="cur")
    far = doc("Transfer", 250, debit=False, day=1, account="tide-acc")
    near = doc("Transfer", 250, debit=False, day=5, account="tide-acc")
    other_debit = doc("Business", 250, day=1, account="cur")
    # `out` (day 5) must take the day-5 credit, leaving the day-1 credit for the day-1 debit.
    own = find_own_move_ids([far, near, out, other_debit], KINDS, IDENTITY)
    assert own == {out["_id"], other_debit["_id"]}


def test_a_business_payment_does_not_pair_with_an_unrelated_other_credit():
    acme = doc("Business", 500, day=2, account="A", desc="ACME SUPPLIES LTD")
    stray = doc("Other", 500, debit=False, day=3, account="B", desc="PAYMENT FROM SOMEONE")
    assert find_own_move_ids([acme, stray], KINDS, IDENTITY) == set()


def test_money_out_and_back_from_a_friend_is_not_a_move():
    out = doc("Other", 20, day=2, account="A", desc="PAID TO FRIEND")
    back = doc("Other", 20, debit=False, day=4, account="B", desc="FRIEND PAID BACK")
    assert find_own_move_ids([out, back], KINDS, IDENTITY) == set()


def test_a_genuine_tide_pair_with_evidence_is_found_by_transfer_category_name_or_number():
    for credit_kwargs in (
        {"category": "Transfer", "desc": "FASTER PAYMENT"},
        {"category": "Other", "desc": "KEVIN MAINGI"},
        {"category": "Other", "desc": "FROM 20202020"},
    ):
        out = doc("Business", 15000, day=4, account="cur", desc="AURIQ AURIQ TIDE")
        inn = doc(credit_kwargs["category"], 15000, debit=False, day=5, account="tide-acc", desc=credit_kwargs["desc"])
        assert out["_id"] in find_own_move_ids([out, inn], KINDS, IDENTITY), credit_kwargs


def test_runway_burn_excludes_own_account_moves():
    from app.routers.analytics import _avg_monthly_burn
    debits = [
        {"_id": "a", "amount": 1000.0, "date": datetime.now() - timedelta(days=40), "category": "Shopping"},
        {"_id": "b", "amount": 15000.0, "date": datetime.now() - timedelta(days=39), "category": "Business"},
    ]
    with_move = _avg_monthly_burn(debits, own_move_ids={"b"})
    without = _avg_monthly_burn(debits[:1])
    assert with_move == pytest.approx(without)
    assert _avg_monthly_burn(debits) > with_move


def test_a_linked_row_is_own_account():
    d = doc("Business", 90, linked_offline_account_id="offline-1")
    assert find_own_move_ids([d], KINDS, IDENTITY) == {d["_id"]}


def test_classify_flow_is_pure_and_matches_the_table():
    assert classify_flow(KINDS, "Shopping", True).kind == "spend"
    assert classify_flow(KINDS, "Shopping", False).kind == "refund"
    assert classify_flow(KINDS, "Savings", True).kind == "movement"
    assert classify_flow(KINDS, "Income", False).kind == "income"
    assert classify_flow(KINDS, "Business", True, own_move=True).reason == "own_account"


# ── Reconciliation: one fixture period, one Out ──────────────────────────────

def _period_docs():
    own, credit, third_party, fee = _business_period()
    return [
        doc("Shopping", 100, day=1),
        doc("Shopping", 40, debit=False, day=3),            # refund nets
        doc("Groceries", 62.5, day=2),
        doc("Mortgage", 1124, day=2),
        doc("Travel", 880, day=5),
        doc("Other", 25, day=6, desc="CORNER SHOP"),         # still to categorise
        third_party, fee,
        own, credit,                                          # moved, not spent
        doc("Savings", 200, day=2),
        doc("Investment", 400, day=3),
        doc("Debt", 300, day=4, desc="NW WORLD MASTERCAR"),
        doc("Transfer", 150, day=4),
        doc("Income", 3000, debit=False, day=0),
    ]


def _verdict_txns(docs, ctx):
    """The same shape spend_verdict._load_period_txns builds."""
    return [{
        "date": d["date"].date(), "category": d["category"], "amount": abs(d["amount"]),
        "debit": d["transaction_type"] == "debit", "description": d["description"],
        "merchant_name": d["merchant_name"], "merchant_key": "", "id": d["_id"],
        "account_id": d["account_id"], "own_move": ctx.is_own_move(d["_id"]),
        "card_repayment": ctx.is_card_repayment(d["_id"]),
    } for d in docs]


EXPECTED_OUT = 100 - 40 + 62.5 + 1124 + 880 + 25 + 500 + 30  # 2681.5


def test_every_surface_reconciles_to_one_out_figure(monkeypatch):
    docs = _period_docs()
    ctx = ctx_for(docs)
    txns = _verdict_txns(docs, ctx)

    # Spend's Out (and the chip, which shows this total): the verdict's own bucketing.
    cat_agg, moved_groups, _income = spend_verdict.bucket_transactions(txns, KINDS)
    spend_out = sum(r["spent"] for r in cat_agg.values())
    assert spend_out == pytest.approx(EXPECTED_OUT)
    # The own-account move is shown as moved between accounts, not spent.
    assert moved_groups["own_accounts"]["amount"] == pytest.approx(15000 + 150)

    # Donut total: the charts read the per-row `spend_amount`, summed per category.
    per_cat: dict[str, float] = {}
    for d in docs:
        per_cat[d["category"]] = per_cat.get(d["category"], 0.0) + spend_amount(d, ctx)
    donut_total = sum(v for v in per_cat.values() if v > 0)
    assert donut_total == pytest.approx(spend_out)

    # Period comparison "this period": the same rows summed over the period.
    period_compare_this = sum(spend_amount(d, ctx) for d in docs)
    assert period_compare_this == pytest.approx(spend_out)

    # Pace day-N total: the last point of the pace series.
    days = (TODAY - START).days + 1
    series = spend_verdict.build_pace_series(
        txns, KINDS, START, days, 0.0, True, total_curve_fn=None, period_days=days,
    )
    assert series[-1]["actual"] == pytest.approx(spend_out)

    # Money shape's Out: Fixed plus Free.
    ms_txns = [{
        "_id": d["_id"], "amount": d["amount"], "category": d["category"],
        "date": d["date"].date().isoformat(), "account_id": d["account_id"],
        "is_debit": d["transaction_type"] == "debit",
    } for d in docs]
    shape = bucket_period(ms_txns, KINDS, set(), START, TODAY, ctx.own_move_ids, ctx.card_repayment_ids)
    assert shape["fixed"] + shape["free"] == pytest.approx(spend_out)

    # Penny's multi-month aggregate (G265) and its stacked chart read the same bucketing.
    async def fake_load(uid, start, end):
        return txns

    async def fake_kinds(uid):
        return KINDS

    monkeypatch.setattr(penny_tools, "_load_period_txns", fake_load)
    monkeypatch.setattr(penny_tools, "get_category_kinds", fake_kinds)
    result = asyncio.run(penny_tools._all_categories_window(UID, 1, False, None))
    assert result["total"]["raw"] + result["uncategorised_total"]["raw"] == pytest.approx(spend_out, abs=0.01)
    by_name = {c["category"]: c["total"]["raw"] for c in result["categories"]}
    assert by_name["Business"] == pytest.approx(530)  # 500 + 30, never the 15,000


def test_penny_category_tool_rows_match_spends_business_total(monkeypatch):
    docs = _period_docs()
    ctx = ctx_for(docs)

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def __aiter__(self):
            async def gen():
                for r in self.rows:
                    yield r
            return gen()

    class Col:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query, proj=None):
            types = query["transaction_type"]["$in"]
            return Cursor([r for r in self.rows if r["transaction_type"] in types])

    async def fake_kinds(uid):
        return KINDS

    async def fake_ctx(uid, start, end, **kw):
        return ctx

    monkeypatch.setattr(penny_tools, "transactions_col", Col(docs))
    monkeypatch.setattr(penny_tools, "yapily_transactions_col", Col([]))
    monkeypatch.setattr(penny_tools, "get_category_kinds", fake_kinds)
    monkeypatch.setattr(penny_tools, "build_spending_context", fake_ctx)
    rows = asyncio.run(penny_tools._category_txn_rows(UID, "Business", _dt(0), _dt(9)))
    assert sum(penny_tools._row_signed(r) for r in rows) == pytest.approx(530)
    rows = asyncio.run(penny_tools._category_txn_rows(UID, "Shopping", _dt(0), _dt(9)))
    assert sum(penny_tools._row_signed(r) for r in rows) == pytest.approx(60)  # 100 less the 40 refund
    assert len(penny_tools._top_merchants(rows)) == 1


def test_account_activity_splits_own_account_money_out_as_movement():
    docs = _period_docs()
    ctx = ctx_for(docs)

    class Acc:
        id = "cur"
        name = "Current"
        balance = 0.0

    summary = penny_tools._summarise_account_activity(
        Acc(), [d for d in docs if d["account_id"] == "cur"], KINDS, ctx,
    )
    assert summary["money_out_spend"]["raw"] == pytest.approx(EXPECTED_OUT + 40)  # refund is a credit here
    assert summary["money_out_movement"]["raw"] == pytest.approx(15000 + 200 + 400 + 300 + 150)


def test_load_spend_txns_and_pace_use_the_definition(monkeypatch):
    docs = _period_docs()
    ctx = ctx_for(docs)

    class Cursor:
        def __init__(self, rows):
            self.rows = rows

        def __aiter__(self):
            async def gen():
                for r in self.rows:
                    yield r
            return gen()

    class Col:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query, proj=None):
            return Cursor(self.rows)

    async def fake_ctx(uid, start, end, **kw):
        return ctx

    monkeypatch.setattr(pace, "transactions_col", Col(docs))
    monkeypatch.setattr(pace, "yapily_transactions_col", Col([]))
    monkeypatch.setattr(pace, "build_spending_context", fake_ctx)
    rows = asyncio.run(pace.load_spend_txns(UID, START, TODAY, kind_map=KINDS))
    assert sum(r["amount"] for r in rows) == pytest.approx(EXPECTED_OUT)


def test_transactions_api_stamps_spend_amount(monkeypatch):
    docs = _period_docs() + [doc("Shopping", 10, currency="KES")]

    class Col:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query):
            rows = self.rows

            class C:
                async def to_list(self, n):
                    return list(rows)
            return C()

    async def fake_kinds(uid):
        return KINDS

    async def fake_identity(uid):
        return IDENTITY

    monkeypatch.setattr(transactions_router, "transactions_col", Col(docs))
    monkeypatch.setattr(transactions_router, "yapily_transactions_col", Col([]))
    monkeypatch.setattr(transactions_router, "statement_transactions_col", Col([]))
    monkeypatch.setattr(transactions_router, "get_category_kinds", fake_kinds)
    monkeypatch.setattr(transactions_router, "user_identity", fake_identity)

    async def fake_cards(uid):
        return CARDS

    monkeypatch.setattr(transactions_router, "load_card_accounts", fake_cards)
    out = asyncio.run(transactions_router.all_transactions(days=365, user={"email": UID}))
    by_desc = {t.description or t.category: t for t in out}
    assert sum(t.spend_amount for t in out) == pytest.approx(EXPECTED_OUT)
    own = next(t for t in out if t.description == "AURIQ AURIQ TIDE")
    assert own.spend_amount == 0
    foreign = next(t for t in out if t.currency == "KES")
    assert foreign.spend_amount == 0
    assert by_desc  # sanity: the response is non-empty


def test_build_spending_context_reads_identity_and_window(monkeypatch):
    docs = _period_docs()

    class Col:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query, proj=None):
            rows = self.rows

            class C:
                async def to_list(self, n):
                    return list(rows)
            return C()

    async def fake_identity(uid):
        return IDENTITY

    monkeypatch.setattr(spending, "transactions_col", Col(docs))
    monkeypatch.setattr(spending, "yapily_transactions_col", Col([]))
    monkeypatch.setattr(spending, "user_identity", fake_identity)

    async def fake_cards(uid):
        return CARDS

    monkeypatch.setattr(spending, "load_card_accounts", fake_cards)
    ctx = asyncio.run(spending.build_spending_context(UID, _dt(0), _dt(9), kinds=KINDS))
    own = next(d for d in docs if d["description"] == "AURIQ AURIQ TIDE")
    assert ctx.is_own_move(own["_id"])


def test_statement_import_rows_get_zero_spend_amount(monkeypatch):
    stmt = doc("Shopping", 77, desc="STATEMENT ROW")
    bank = doc("Shopping", 23, desc="BANK ROW")

    class Col:
        def __init__(self, rows):
            self.rows = rows

        def find(self, query):
            rows = self.rows

            class C:
                async def to_list(self, n):
                    return list(rows)
            return C()

    async def fake_kinds(uid):
        return KINDS

    async def fake_identity(uid):
        return IDENTITY

    monkeypatch.setattr(transactions_router, "transactions_col", Col([bank]))
    monkeypatch.setattr(transactions_router, "yapily_transactions_col", Col([]))
    monkeypatch.setattr(transactions_router, "statement_transactions_col", Col([stmt]))
    monkeypatch.setattr(transactions_router, "get_category_kinds", fake_kinds)
    monkeypatch.setattr(transactions_router, "user_identity", fake_identity)

    async def fake_cards(uid):
        return CARDS

    monkeypatch.setattr(transactions_router, "load_card_accounts", fake_cards)
    out = asyncio.run(transactions_router.all_transactions(days=365, user={"email": UID}))
    by_desc = {t.description: t.spend_amount for t in out}
    assert by_desc == {"BANK ROW": 23.0, "STATEMENT ROW": 0.0}
