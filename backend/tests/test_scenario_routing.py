"""Unit tests for app.routers.scenario — the pure (no-DB, no-network) seams:
`looks_like_scenario` (deterministic routing classifier),
`resolve_relative_start` (deterministic relative-date resolution), and
`_lumpy_headline` (the server-composed headline for annual/one_off-
dominated scenarios, which deliberately never touches the LLM).

Also covers the wiring of `looks_like_scenario` into POST /can-i
(app.routers.can_i.can_i): a scenario-shaped question must short-circuit to
`parse_question` (shared with /scenario/parse) BEFORE the Penny tool loop
ever runs, while a plain affordability question must still reach that loop
(app.services.penny_agent.run_penny_agent) untouched. These call
`can_i_mod.can_i(...)` directly via `asyncio.run` (matching the
direct-async-call convention used in test_notifications.py/test_scenario.py,
rather than a real HTTP/DB round trip) and monkeypatch the LLM/DB boundaries
the function touches: `check_ai_chat_limit`/`increment_ai_chat_usage`
(subscription usage docs), `parse_question` (the scenario extraction LLM
call), `run_penny_agent` (the ground-up loop-first rebuild's own tool loop,
see PENNY_TOOLS.md) and `compute_safe_to_spend` (the deterministic refusal
fallback's own worked-example read). Each fake either returns a fixed value
or raises loudly if hit, so a routing regression that lets the wrong path
run fails the test rather than silently making a live call.
"""
import asyncio
from datetime import date

import app.routers.can_i as can_i_mod
from app.routers.scenario import _lumpy_headline, looks_like_scenario, resolve_relative_start


def _add_months(d: date, n: int) -> date:
    """Tiny local duplicate of the same month-arithmetic
    `_lumpy_headline`/`_spike_month_occurrences` use internally — kept
    separate so the test builds its expected fixture dates independently
    of the implementation under test."""
    total = d.year * 12 + (d.month - 1) + n
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


# ── looks_like_scenario ──────────────────────────────────────────────────

def test_monthly_cadence_is_scenario():
    assert looks_like_scenario("What if I start paying £450 a month for a car from October?")


def test_per_week_cadence_is_scenario():
    assert looks_like_scenario("What if I pick up a cleaner at £60 a week?")


def test_slash_mo_cadence_is_scenario():
    assert looks_like_scenario("What if the new phone plan is £35/mo?")


def test_future_month_commitment_is_scenario():
    assert looks_like_scenario("What if I take on a new car lease starting in October?")


def test_future_month_commitment_sign_up_for():
    assert looks_like_scenario("What if I sign up for a gym in November?")


def test_pay_rise_is_scenario():
    assert looks_like_scenario("What if I get a pay rise next year?")


def test_job_loss_is_scenario():
    assert looks_like_scenario("What if I lose my job?")


def test_redundancy_is_scenario():
    assert looks_like_scenario("What if I'm made redundant?")


def test_cancellation_is_scenario():
    assert looks_like_scenario("What if I cancel my gym membership?")


def test_get_rid_of_is_scenario():
    assert looks_like_scenario("What if I get rid of the car?")


def test_simple_weekend_spend_is_not_scenario():
    assert not looks_like_scenario("can I spend £45 this weekend")


def test_simple_dinner_spend_is_not_scenario():
    assert not looks_like_scenario("can I afford dinner tonight")


def test_spending_history_question_is_not_scenario():
    assert not looks_like_scenario("how much have I spent on groceries")


def test_bare_month_name_alone_is_not_scenario():
    # A month name with no commitment verb is too weak alone (e.g. an
    # ordinary Can-I question like "can I afford Christmas in December").
    assert not looks_like_scenario("can I afford a trip in December?")


def test_bare_commitment_verb_alone_is_not_scenario():
    # A commitment verb with no month/date reference is too weak alone.
    assert not looks_like_scenario("What if I switch to a cheaper energy tariff?")


def test_hypothetical_single_account_move_arithmetic_is_not_scenario():
    # Regression, 2026-08-31 (owner-reported bug, verbatim): "If we move
    # 825£ from my Monzo account, how much will be left" got the generic
    # out-of-scope refusal live. The scenario gate was the prime suspect
    # (an "If we..." hypothetical), but this is a single, immediate balance
    # question, not an ongoing or future-dated money CHANGE: no cadence word
    # (no "a month"/"weekly"/...), no income-change or cancellation phrase,
    # and "move ... from" is not the commitment-verb pattern ("move TO", a
    # relocation) the two-signal branch looks for. Diagnosis found the real
    # cause was the wall-clock budget, not this gate (see
    # app.services.penny_agent's own dated comment on its timeout
    # constants) - this test locks in that the gate itself was never the
    # bug and must keep NOT catching this phrasing shape.
    assert not looks_like_scenario(
        "If we move 825£ from my Monzo account, how much will be left"
    )
    assert not looks_like_scenario("If I move £200 from my savings, what's left?")


# ── resolve_relative_start ───────────────────────────────────────────────

def test_bare_future_month_resolves_this_year():
    today = date(2026, 8, 21)
    # October is still ahead of August this year.
    assert resolve_relative_start("start paying from October", today) == "2026-10-01"


def test_bare_past_month_resolves_next_year():
    today = date(2026, 8, 21)
    # March has already passed this year -> next occurrence is next year.
    assert resolve_relative_start("start paying from March", today) == "2027-03-01"


def test_current_month_resolves_next_year():
    today = date(2026, 8, 21)
    # Naming the CURRENT month reads as "next year's version of this
    # month", not "starting immediately" (mirrors can_i.py's
    # _months_until_target: delta<=0 rolls forward a full year).
    assert resolve_relative_start("start paying from August", today) == "2027-08-01"


def test_next_year_with_no_month_shifts_current_month():
    today = date(2026, 8, 21)
    assert resolve_relative_start("what if I get a pay rise next year", today) == "2027-08-01"


def test_month_plus_next_year_shifts_an_extra_year():
    today = date(2026, 8, 21)
    assert resolve_relative_start("start paying from October next year", today) == "2027-10-01"


def test_explicit_year_defers_to_model():
    today = date(2026, 8, 21)
    # An explicit 4-digit year is more precise than we can safely
    # second-guess -- None means "leave whatever the model produced".
    assert resolve_relative_start("start paying from October 2028", today) is None


def test_no_date_signal_returns_none():
    today = date(2026, 8, 21)
    assert resolve_relative_start("what if I lose my job", today) is None


def test_earliest_named_month_wins():
    today = date(2026, 1, 5)
    # December is named FIRST by string position in this sentence (before
    # "November" later on) -- earliest-in-the-question wins, not
    # calendar/list order, mirroring can_i.py's own tie-break logic
    # (verified directly against can_i.py's _months_until_target: it
    # resolves "december" here too, min() on (index, month)).
    assert resolve_relative_start("save for the December trip before November", today) == "2026-12-01"


# ── _lumpy_headline ──────────────────────────────────────────────────────
# Fixed `today` passed explicitly (the function accepts an override purely
# for deterministic testing) so these never depend on the wall-clock date
# the suite happens to run on.

def test_lumpy_headline_annual_in_removal_single_occurrence():
    today = date(2026, 8, 21)
    # Starts 20 months out: only ONE anniversary (offset 20) falls inside
    # the 24-month horizon (the next, offset 32, doesn't) -- exercises the
    # single-occurrence branch (bare month name, no "each year").
    items = [{
        "label": "Car insurance", "amount": 1200.0, "direction": "in",
        "cadence": "annual", "starts": _add_months(today, 20).isoformat(),
        "ends": None, "kind": "removal", "category": None,
    }]
    payload = {"recurring_delta": 100.0}
    headline = _lumpy_headline(items, payload, today=today)
    assert headline == (
        "Cancelling Car insurance frees up about £100 a month on average, "
        "with the full £1,200 landing in April."
    )
    # Direction-aware ("in" -> frees up / landing), steady figure and spike
    # figure both present but never blended into one claim, house-style
    # clean (no dashes, £ not "pounds").
    assert "£100" in headline and "£1,200" in headline
    assert "frees up" in headline
    assert "—" not in headline and "–" not in headline and "pounds" not in headline


def test_lumpy_headline_annual_out_new_outgoing_two_occurrences():
    today = date(2026, 8, 21)
    # Starts 2 months out: TWO anniversaries (offsets 2 and 14) fall inside
    # the horizon -- exercises the "each year" branch (do not enumerate
    # both dates, name the recurring month once).
    items = [{
        "label": "Car insurance", "amount": 1200.0, "direction": "out",
        "cadence": "annual", "starts": _add_months(today, 2).isoformat(),
        "ends": None, "kind": "new_outgoing", "category": None,
    }]
    payload = {"recurring_delta": -100.0}
    headline = _lumpy_headline(items, payload, today=today)
    assert headline == (
        "Car insurance costs about £100 a month on average, "
        "with the full £1,200 leaving in October each year."
    )
    assert "£100" in headline and "£1,200" in headline
    assert "costs" in headline and "leaving" in headline
    # The steady £100 and the spike £1,200 must never be attached to each
    # other's time period -- distinct sentence clauses, not a blended claim.
    assert "£100" not in headline.split("with the full")[1]
    assert "—" not in headline and "–" not in headline and "pounds" not in headline


def test_lumpy_headline_one_off():
    today = date(2026, 8, 21)
    items = [{
        "label": "Deposit", "amount": 500.0, "direction": "out",
        "cadence": "one_off", "starts": _add_months(today, 5).isoformat(),
        "ends": None, "kind": "new_outgoing", "category": None,
    }]
    payload = {"recurring_delta": 0.0}
    headline = _lumpy_headline(items, payload, today=today)
    assert headline == (
        "Deposit costs about £500 in January 2027, a one-off rather than an ongoing change."
    )
    # A one_off must NOT get the "a month on average" steady-equivalent
    # clause -- its steady figure is deliberately 0, so stating it as a
    # monthly rate would be exactly the kind of false relationship this
    # composer exists to avoid.
    assert "a month on average" not in headline
    assert "—" not in headline and "–" not in headline and "pounds" not in headline


# ── /can-i wiring: looks_like_scenario short-circuits to parse_question ─────

class _RaisingFake:
    """Stand-in for a dependency that must NOT be reached on the path under
    test. Raising loudly (rather than e.g. returning None) means a routing
    regression that lets the wrong branch run fails the test with a clear
    "this got called" error instead of a confusing downstream KeyError."""

    def __getattr__(self, name):
        def _boom(*args, **kwargs):
            raise AssertionError(f"{name} should not have been called on this path")
        return _boom


async def _noop_check_ai_chat_limit(email):
    return None


async def _noop_increment_ai_chat_usage(email):
    return None


def _patch_common(monkeypatch):
    """Shared plumbing every /can-i test below needs: a usable-looking API
    key (never read from .env — just a dummy truthy string so the
    `if not OPENROUTER_API_KEY` guard at the top of can_i() passes) and a
    no-op subscription-limit check/increment (never touches
    subscription_usage_col)."""
    monkeypatch.setattr(can_i_mod, "OPENROUTER_API_KEY", "test-key")
    monkeypatch.setattr(can_i_mod, "check_ai_chat_limit", _noop_check_ai_chat_limit)
    monkeypatch.setattr(can_i_mod, "increment_ai_chat_usage", _noop_increment_ai_chat_usage)


def test_scenario_question_short_circuits_before_fact_gathering(monkeypatch):
    _patch_common(monkeypatch)

    async def fake_parse_question(uid, question):
        return {
            "items": [{
                "label": "Car finance", "amount": 450.0, "direction": "out",
                "cadence": "monthly", "starts": "2026-10-01", "ends": None,
                "kind": "new_outgoing", "category": None,
            }],
            "rejected": [],
            "prefilled": False,
            "clarify": None,
        }

    monkeypatch.setattr(can_i_mod, "parse_question", fake_parse_question)
    # Any of these being called at all proves the Can-I fact-gathering path
    # ran, which the scenario short-circuit must pre-empt entirely.
    monkeypatch.setattr(can_i_mod, "compute_safe_to_spend", _RaisingFake())
    monkeypatch.setattr(can_i_mod, "commitments_col", _RaisingFake())

    body = {"question": "What if I start paying £450 a month for a car from October?"}
    result = asyncio.run(can_i_mod.can_i(body, {"email": "test-scenario@example.com"}))

    assert result["scenario"] is True
    assert result["items"] and result["items"][0]["label"] == "Car finance"
    assert result["rejected"] == []
    assert result["clarify"] is None
    assert result["out_of_scope"] is False
    assert result["facts"] == []
    assert result["reply"]  # non-empty, confirm-card-appropriate copy
    assert result["headline"]
    for s in (result["reply"], result["headline"]):
        assert "—" not in s and "–" not in s and "pounds" not in s.lower()


def test_plain_affordability_question_still_takes_can_i_path(monkeypatch):
    _patch_common(monkeypatch)

    # Any call to parse_question at all proves the scenario short-circuit
    # wrongly hijacked a plain one-off spend question.
    async def _boom_parse_question(uid, question):
        raise AssertionError("parse_question should not be called on the plain Can-I path")

    monkeypatch.setattr(can_i_mod, "parse_question", _boom_parse_question)

    # Ground-up rebuild, 2026-08-26: the plain (non-scenario) path is now the
    # Penny tool loop, not an inline fact pack — proving the question reached
    # it (not the scenario path) means stubbing run_penny_agent itself and
    # asserting its well-formed answer comes back through unchanged.
    async def fake_run_penny_agent(uid, question, history, screen, context):
        return {"headline": "You have headroom", "reply": "You have £100 free until payday.", "tools_used": []}

    monkeypatch.setattr(can_i_mod, "run_penny_agent", fake_run_penny_agent)

    body = {"question": "can I spend £45 this weekend"}
    result = asyncio.run(can_i_mod.can_i(body, {"email": "test-plain@example.com"}))

    assert not result.get("scenario")  # absent or False on the normal Can-I path
    assert result["out_of_scope"] is False
    assert result["reply"] == "You have £100 free until payday."
    assert result["headline"] == "You have headroom"


def test_scenario_clarify_case_reads_as_a_sensible_reply(monkeypatch):
    _patch_common(monkeypatch)

    async def fake_parse_question(uid, question):
        return {"items": [], "rejected": [], "prefilled": False, "clarify": "Give me a rough monthly figure and I'll run it."}

    monkeypatch.setattr(can_i_mod, "parse_question", fake_parse_question)
    monkeypatch.setattr(can_i_mod, "compute_safe_to_spend", _RaisingFake())
    monkeypatch.setattr(can_i_mod, "commitments_col", _RaisingFake())

    # "new job" fires the income-change regex (see looks_like_scenario) with
    # no figure named at all -- exactly the shape that should come back
    # empty from extraction.
    body = {"question": "What if I get a new job next year?"}
    result = asyncio.run(can_i_mod.can_i(body, {"email": "test-clarify@example.com"}))

    assert result["scenario"] is True
    assert result["items"] == []
    assert result["clarify"] == "Give me a rough monthly figure and I'll run it."
    # The thread must still read as a sensible answer, not an empty card.
    assert result["reply"] == "Give me a rough monthly figure and I'll run it."
    assert result["headline"]
    assert result["out_of_scope"] is False
    assert result["facts"] == []
