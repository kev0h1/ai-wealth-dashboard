"""G241 — arithmetic / comparison / what-if / projection corpus for Penny.

One corpus, two consumers:

* `tests/test_penny_calculator_corpus.py` (offline, deterministic, runs in
  CI): every case's `reference` (the expression a correct model should hand
  to the `calculate` tool, plus the named inputs it fetched) is evaluated
  by the REAL calculator and must equal `expected` exactly. The pass bar
  for these rows is 100%, because the calculator is deterministic code, not
  model judgement.
* `scripts/penny_live_eval.py` (live OpenRouter, run by hand, never in CI):
  drives the real `run_penny_agent` loop with a SYNTHETIC fixture world
  (`FIXTURES` below, invented figures for a made-up user, never real data)
  and checks the reply contains one of `expect_any`. Bar for the live rows:
  every row answered (not refused) and containing the expected figure.

`kind` is one of arithmetic / comparison / what-if / projection / control.
`control` rows are NOT arithmetic: they pin that an off-topic question is
still declined and an advice-shaped one is still facts-only.

Every figure here is fixture arithmetic: nothing in this file is a claim
about a real user or a real rate.
"""

TODAY = "2026-10-08"  # fixed so projection rows are stable

CASES = [
    dict(
        id="calc-01-literal-minus", kind="arithmetic", screen="home",
        question="what is 1,250 minus 380",
        tools=[], expect_any=["870"],
        reference=dict(expression="1250 - 380", inputs={}, expected=870.0),
    ),
    dict(
        id="calc-02-percent-of", kind="arithmetic", screen="home",
        question="What is 15% of £2,400?",
        tools=[], expect_any=["360"],
        reference=dict(expression="pct(2400, 15)", inputs={}, expected=360.0),
    ),
    dict(
        id="calc-03-currency-strings", kind="arithmetic", screen="home",
        question="Take £1,250.00 away from £4,310.50",
        tools=[], expect_any=["3,060.50", "3060.50"],
        reference=dict(expression="£4,310.50 - £1,250.00", inputs={}, expected=3060.5),
    ),
    dict(
        id="calc-04-split", kind="arithmetic", screen="other",
        question="Split a £132.60 bill four ways",
        tools=[], expect_any=["33.15"],
        reference=dict(expression="132.60 / 4", inputs={}, expected=33.15),
    ),
    dict(
        id="calc-05-goal-gap", must_calc=False, kind="arithmetic", screen="planning",
        question="How much more do I need to reach my Japan goal?",
        tools=["get_goals"], expect_any=["750"],
        reference=dict(expression="shortfall(target, saved)",
                       inputs={"target": "£2,000", "saved": "£1,250"}, expected=750.0),
    ),
    dict(
        id="calc-06-spend-left", kind="what-if", screen="home",
        question="If I spend £40 today what is left?",
        tools=["get_safe_to_spend"], expect_any=["372"],
        reference=dict(expression="safe - 40", inputs={"safe": "£412"}, expected=372.0),
    ),
    dict(
        id="calc-07-bills-total", kind="arithmetic", screen="upcoming",
        question="Add up all my bills this pay period",
        tools=["get_upcoming_bills"], expect_any=["1,060.49", "1,060", "1060"],
        reference=dict(expression="sum(850, 10.99, 142, 22.50, 35)", inputs={}, expected=1060.49),
    ),
    dict(
        id="calc-08-net-total", kind="arithmetic", screen="accounts",
        question="What is my total across all my accounts, counting the card as a debt?",
        tools=["get_accounts"], expect_any=["5,180", "5180"],
        reference=dict(expression="current + savings + card",
                       inputs={"current": "£1,250.00", "savings": "£4,310.50", "card": "−£380.00"},
                       expected=5180.5),
    ),
    dict(
        id="calc-09-grocery-compare", must_calc=False, kind="comparison", screen="spend",
        question="What did I spend on groceries this period versus last?",
        tools=["get_spend_verdict"], expect_all=["286.40", "331.15"],
        reference=dict(expression="this - last",
                       inputs={"this": "£286.40", "last": "£331.15"}, expected=-44.75),
    ),
    dict(
        id="calc-10-weekly-average", must_calc=False, kind="arithmetic", screen="spend",
        question="What is my average weekly grocery spend over the last 3 months?",
        tools=["get_category_spend"], expect_any=["79.3", "£79"],
        reference=dict(expression="per_week(total, days)", inputs={"total": "£1,020", "days": 90},
                       expected=79.3333333333),
    ),
    dict(
        id="calc-11-save-over-months", kind="what-if", screen="grow",
        question="If I save £200 a month, how much will my savings be in 6 months?",
        tools=["get_savings_position"], expect_any=["5,510", "5510"],
        reference=dict(expression="current + 200 * 6",
                       inputs={"current": "£4,310.50"}, expected=5510.5),
    ),
    dict(
        id="calc-12-annual-saving", kind="what-if", screen="spend",
        question="How much would I save over a year if I cut £12 a week from takeaways?",
        tools=[], expect_any=["624"],
        reference=dict(expression="12 * 52", inputs={}, expected=624.0),
    ),
    dict(
        id="calc-13-days-to-payday", must_calc=False, kind="arithmetic", screen="home",
        question="How many days until payday?",
        tools=["get_safe_to_spend"], expect_any=["9 days", "nine days"],
        reference=dict(expression='days_between("2026-10-08", "2026-10-17")', inputs={}, expected=9),
    ),
    dict(
        id="calc-14-reach-goal-date", kind="projection", screen="planning",
        question="When will I reach my £2,000 Japan goal at my current rate?",
        tools=["get_goals"], expect_any=["March 2027", "Mar 2027", "5 months", "five months"],
        reference=dict(expression="periods_to_reach(target, saved, rate)",
                       inputs={"target": "£2,000", "saved": "£1,250", "rate": "£150"},
                       expected=5, project=dict(period="month", from_date="2026-10-08"),
                       projected_date="2027-03-08"),
    ),
    dict(
        id="calc-15-interest-per-year", kind="arithmetic", screen="debt",
        question="What is a year of interest on £380 at 24.9% APR?",
        tools=[], expect_any=["94.6"],
        reference=dict(expression="pct(380, 24.9)", inputs={}, expected=94.62),
    ),
    dict(
        id="calc-16-price-off", kind="arithmetic", screen="other",
        question="What is 20% off £86.50?",
        tools=[], expect_any=["69.20", "69.2"],
        reference=dict(expression="86.50 - pct(86.50, 20)", inputs={}, expected=69.2),
    ),
    dict(
        id="calc-17-switch-saving-year", kind="what-if", screen="insights",
        question="If I switched broadband and saved £10 a month, what is that over a year?",
        tools=[], expect_any=["120"],
        reference=dict(expression="10 * 12", inputs={}, expected=120.0),
    ),
    # Controls: pinned so the scope narrowing does not swing too far.
    dict(
        id="ctl-01-weather-still-declined", kind="control", screen="home",
        question="What is the weather like in London tomorrow?",
        tools=[], expect_declined=True,
    ),
    dict(
        id="ctl-02-advice-stays-facts", kind="control", screen="grow",
        question="Which ISA provider should I open an account with?",
        tools=[], expect_no_any=["you should open", "I recommend", "best provider"],
        declined_ok=True,
    ),
]

# Synthetic fixture world used only by the live runner. Money values use the
# same {"raw", "formatted"} shape as app.services.penny_tools._money.
def _m(v):
    body = f"£{abs(v):,.2f}" if v != int(v) else f"£{abs(v):,.0f}"
    return {"raw": v, "formatted": ("−" + body) if v < 0 else body}


FIXTURES = {
    "get_safe_to_spend": {
        "state": "comfortable", "safe_to_spend": _m(412),
        "payday": {"next_payday": "2026-10-17", "days_to_payday": 9},
        "card_growth": _m(0),
    },
    "get_goals": {"goals": [{
        "name": "Japan", "amount": _m(2000), "progress": _m(1250),
        "remaining": _m(750), "target_date": "2027-06-30",
        "per_period_slice": _m(150), "usual_slice": _m(150),
        "periods_left": 5, "on_track": True, "status": "active",
    }]},
    "get_accounts": {"accounts": [
        {"id": "a1", "name": "Everyday", "kind": "Current", "balance": _m(1250.00)},
        {"id": "a2", "name": "Rainy day", "kind": "Savings", "balance": _m(4310.50)},
        {"id": "a3", "name": "Visa", "kind": "Credit", "balance": _m(-380.00)},
    ]},
    "get_upcoming_bills": {"bills": [
        {"name": "Rent", "amount": _m(850), "date": "2026-10-12"},
        {"name": "Netflix", "amount": _m(10.99), "date": "2026-10-14"},
        {"name": "Council tax", "amount": _m(142), "date": "2026-10-15"},
        {"name": "Phone", "amount": _m(22.50), "date": "2026-10-16"},
        {"name": "Gym", "amount": _m(35), "date": "2026-10-16"},
    ]},
    "get_savings_position": {"savings_balance": _m(4310.50), "monthly_surplus": _m(200)},
    "get_category_spend": {
        "category": "Groceries", "period": {"start": "2026-09-18", "end": "2026-10-17"},
        "this_period": {"spent": _m(286.40), "payments_count": 14},
        "last_n_months": {
            "months": 3, "spent": _m(1020.00), "payments_count": 41,
            "window": {"from": "2026-07-10", "to": "2026-10-08", "days": 90},
            "average_per_week": _m(79.33),
        },
        "top_merchants": [],
    },
    "check_affordability": {
        "verdict": "Yes, £40 today fits, with £372 of safe to spend left.",
        "amount": _m(40), "safe_to_spend": _m(412), "remaining_after": _m(372),
    },
}

# get_spend_verdict varies by period_offset (0 = this period, -1 = last).
VERDICT_BY_OFFSET = {
    0: {"period": {"start": "2026-09-18", "end": "2026-10-17"},
        "pills": {"spent": _m(1812.30), "income": _m(2650)},
        "majority": [{"category": "Groceries", "spent": _m(286.40), "payments_count": 14}],
        "notables": []},
    -1: {"period": {"start": "2026-08-18", "end": "2026-09-17"},
         "pills": {"spent": _m(1764.10), "income": _m(2650)},
         "majority": [{"category": "Groceries", "spent": _m(331.15), "payments_count": 17}],
         "notables": []},
}
