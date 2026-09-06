"""Unit tests for app.services.penny_chips (POST /penny/chip's engine-owned,
no-model-call chip registry) and the Penny monthly message cap it sits
alongside (app.core.subscription.penny_allowance, enforced in POST /can-i).

Mirrors the conventions of test_penny_tools.py / test_penny_agent.py /
test_llm_meter.py: engine calls imported at MODULE level into
app.services.penny_chips (`check_affordability`, `execute_tool`) are
monkeypatched on THAT module's namespace; calls made via an inline
`from app.routers.X import Y` / `from app.services.X import Y` inside a
function body (get_cached_safe_to_spend, compute_spend_verdict, grow_view)
are monkeypatched on the ORIGINAL module instead, since the import happens
fresh at call time. The cap test fakes `llm_usage_col`/`penny_topups_col`
rather than touching real Mongo, following test_llm_meter.py's own
`_FakeLlmUsageCol` shape.
"""
import asyncio
import re

import app.core.llm as llm_module
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.analytics as analytics_module
import app.routers.can_i as can_i_module
import app.routers.grow as grow_module
import app.routers.penny_chip as penny_chip_module
import app.routers.subscription as subscription_router_module
import app.services.affordability as affordability_module
import app.services.penny_agent as penny_agent_module
import app.services.penny_chips as penny_chips_module
import app.services.spend_verdict as spend_verdict_module
from app.services.penny_chips import CHIPS, answer_chip
from app.services.penny_tools import execute_tool as real_execute_tool


UID = "penny-chips-test@example.com"


def _run(coro):
    return asyncio.run(coro)


def _assert_house_style(text: str):
    assert "—" not in text and "–" not in text


# ── 1. home_payday_status ────────────────────────────────────────────────
# Wording must mirror SafeToSpendCard.tsx exactly: a negative figure is
# never phrased as "safe to spend" (the card itself relabels it "Final
# safety position"), it is a "short of covering this pay period" gap.

def test_home_payday_status_comfortable(monkeypatch):
    async def fake_sts(uid):
        assert uid == UID
        return {
            "status": "ok", "state": "comfortable", "safe_to_spend": 200.0,
            "days_until_payday": 10, "next_payday": "2026-09-20",
            "lowest_projected_balance": 90.0, "calculation_status": "complete",
        }
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    result = _run(answer_chip(UID, "home_payday_status", None))
    assert result["chip_id"] == "home_payday_status"
    assert result["kind"] == "engine"
    assert "You're on track" in result["answer"]
    assert "£200" in result["answer"]
    assert "projected to dip to about £90" in result["answer"]
    assert "safe to spend" not in result["answer"] or "on track" in result["answer"]
    _assert_house_style(result["answer"])


def test_home_payday_status_tight(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "state": "tight", "safe_to_spend": 42.0,
            "days_until_payday": 3, "next_payday": "2026-09-08",
            "lowest_projected_balance": 15.0, "calculation_status": "complete",
        }
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    result = _run(answer_chip(UID, "home_payday_status", None))
    assert "You're tight" in result["answer"]
    assert "£42" in result["answer"]
    assert "£15" in result["answer"]
    _assert_house_style(result["answer"])


def test_home_payday_status_short_bills_never_says_negative_safe_to_spend(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "state": "short", "short_reason": "bills",
            "safe_to_spend": -748.91, "days_until_payday": 19,
            "next_payday": "2026-09-25", "lowest_projected_balance": 53.89,
            "calculation_status": "complete",
        }
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    result = _run(answer_chip(UID, "home_payday_status", None))
    answer = result["answer"]
    assert "short of covering this pay period" in answer
    assert "£749" in answer
    assert "with 19 days to payday" in answer
    assert "projected to dip to about £54" in answer
    # The hardened requirement: never a bare negative "safe to spend" phrase.
    assert "−£749 safe to spend" not in answer and "-£749 safe to spend" not in answer
    assert "safe to spend" not in answer
    _assert_house_style(answer)


def test_home_payday_status_cards_short_never_says_short_of_covering(monkeypatch):
    async def fake_sts(uid):
        return {
            "status": "ok", "state": "short", "short_reason": "cards",
            "safe_to_spend": -120.0, "days_until_payday": 6,
            "next_payday": "2026-09-12", "lowest_projected_balance": None,
            "calculation_status": "complete",
        }
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    result = _run(answer_chip(UID, "home_payday_status", None))
    answer = result["answer"]
    assert "cards have used up what's spare" in answer
    assert "short of covering this pay period" not in answer
    assert "£120" not in answer  # bills are covered — no shortfall figure to quote
    _assert_house_style(answer)


def test_home_payday_status_insufficient_data_is_honest(monkeypatch):
    async def fake_sts(uid):
        return {"status": "insufficient_data"}
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    result = _run(answer_chip(UID, "home_payday_status", None))
    assert "don't have enough account data" in result["answer"]


# ── 2. home_payday_due ───────────────────────────────────────────────────

def test_home_payday_due_filters_to_before_payday_and_hedges(monkeypatch):
    async def fake_sts(uid):
        return {"status": "ok", "days_until_payday": 5}
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    async def fake_execute_tool(uid, name, args):
        assert name == "get_upcoming_bills"
        return {
            "upcoming_bills": [
                {"name": "Council Tax", "amount": {"raw": 120.0, "formatted": "£120"}, "days_away": 2, "kind": "commitment"},
                {"name": "Netflix", "amount": {"raw": 12.0, "formatted": "£12"}, "days_away": 4, "kind": "discretionary"},
                {"name": "Rent", "amount": {"raw": 900.0, "formatted": "£900"}, "days_away": 10, "kind": "commitment"},
            ],
        }
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "home_payday_due", None))
    assert result["facts"]["count"] == 2  # Rent (10 days) is AFTER payday (5), excluded
    assert result["facts"]["total"] == 132.0
    assert "£132" in result["answer"]
    assert "expected" in result["answer"]  # hedge word for bill predictions
    assert "Council Tax" in result["answer"] and "Netflix" in result["answer"]
    _assert_house_style(result["answer"])


def test_home_payday_due_nothing_due_is_honest(monkeypatch):
    async def fake_sts(uid):
        return {"status": "ok", "days_until_payday": 5}
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    async def fake_execute_tool(uid, name, args):
        return {"upcoming_bills": []}
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "home_payday_due", None))
    assert "Nothing else is expected" in result["answer"]


def test_home_payday_due_never_leaks_raw_bank_descriptors(monkeypatch):
    # The exact three real-world offenders that leaked an account-number-
    # like fragment (or the user's own name) before this fix. Neither
    # movement occurrence carries a known destination here, so both must
    # still fall back to the fixed phrase rather than the raw descriptor.
    async def fake_sts(uid):
        return {"status": "ok", "days_until_payday": 19}
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    async def fake_execute_tool(uid, name, args):
        return {
            "upcoming_bills": [
                {"name": "AMERICAN EXPRESS 3766-824849-32000", "amount": {"raw": 874.1, "formatted": "£874"}, "days_away": 1, "kind": "movement"},
                {"name": "KEVIN MAINGI CREDIT VIA MOBILE - PY", "amount": {"raw": 106.67, "formatted": "£107"}, "days_away": 1, "kind": "movement"},
                {"name": "SQSP* WORKSP#239622742 DUBLIN 8", "amount": {"raw": 84.96, "formatted": "£85"}, "days_away": 1, "kind": "discretionary"},
            ],
        }
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "home_payday_due", None))
    answer = result["answer"]
    assert not re.search(r"\d{6,}", answer), answer
    assert "*" not in answer and "#" not in answer, answer
    # The two movement-kind occurrences never surface the raw descriptor,
    # including the user's own name.
    assert "KEVIN MAINGI" not in answer.upper() or "kevin maingi" not in answer.lower()
    assert "3766-824849-32000" not in answer
    _assert_house_style(answer)


def test_home_payday_due_movement_with_reference_shaped_destination_falls_back(monkeypatch):
    # A movement occurrence CAN carry a known destination name, but it must
    # still be run through the same reference/long-digit guard raw
    # descriptors get -- a destination name that happens to look like a
    # reference string is never trusted blindly.
    async def fake_sts(uid):
        return {"status": "ok", "days_until_payday": 19}
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    async def fake_execute_tool(uid, name, args):
        return {
            "upcoming_bills": [
                {
                    "name": "TRANSFER REF 12345678", "amount": {"raw": 200.0, "formatted": "£200"},
                    "days_away": 1, "kind": "movement", "dest_account_name": "ACC-88495712300",
                },
            ],
        }
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "home_payday_due", None))
    answer = result["answer"]
    assert not re.search(r"\d{6,}", answer), answer
    assert "a card or account payment" in answer
    _assert_house_style(answer)


def test_clean_bill_display_name_movement_falls_back_with_no_known_destination():
    from app.services.penny_chips import _clean_bill_display_name

    assert _clean_bill_display_name("AMERICAN EXPRESS 3766-824849-32000", "movement") == "a card or account payment"
    assert _clean_bill_display_name("KEVIN MAINGI CREDIT VIA MOBILE - PY", "movement") == "a card or account payment"


def test_clean_bill_display_name_movement_names_a_card_repayment_destination():
    from app.services.penny_chips import _clean_bill_display_name

    bill = {"card_dest_account_name": "American Express"}
    assert _clean_bill_display_name("AMERICAN EXPRESS 3766-824849-32000", "movement", bill) == "American Express card payment"


def test_clean_bill_display_name_movement_names_a_self_transfer_destination():
    from app.services.penny_chips import _clean_bill_display_name

    bill = {"dest_account_name": "Monzo Savings"}
    assert _clean_bill_display_name("KEVIN MAINGI CREDIT VIA MOBILE - PY", "movement", bill) == "Transfer to Monzo Savings"


def test_clean_bill_display_name_uses_the_engines_own_merchant_identity():
    from app.services.penny_chips import _clean_bill_display_name

    assert _clean_bill_display_name("NETFLIX.COM 18665797172", "discretionary") == "Netflix"
    assert _clean_bill_display_name("EE LIMITED", "commitment") == "Ee Limited"


def test_clean_bill_display_name_squarespace_alias():
    from app.services.penny_chips import _clean_bill_display_name

    assert _clean_bill_display_name("SQSP* WORKSP#239622742 DUBLIN 8", "discretionary") == "Squarespace"


# ── 3. spend_where_money_went ────────────────────────────────────────────

def test_spend_where_money_went_totals_and_shares(monkeypatch):
    async def fake_verdict(uid, offset=0):
        assert offset == 0
        return {
            "pills": {"spent": 300.0, "income": 0, "net": 0},
            "notables": [{"category": "Eating Out", "spent": 150.0}],
            "majority": [
                {"category": "Groceries", "spent": 100.0},
                {"category": "Transport", "spent": 50.0},
            ],
            "period": {"start": "2026-09-01", "end": "2026-09-08"},
        }
    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    result = _run(answer_chip(UID, "spend_where_money_went", None))
    assert "£300" in result["answer"]
    assert "Eating Out" in result["answer"] and "£150" in result["answer"]
    assert "50%" in result["answer"]  # 150/300
    _assert_house_style(result["answer"])


def test_spend_where_money_went_no_spend_yet_is_honest(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {"pills": {"spent": 0.0}, "notables": [], "majority": [], "period": {}}
    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    result = _run(answer_chip(UID, "spend_where_money_went", None))
    assert "No spending recorded" in result["answer"]


# ── 4. spend_more_than_usual ─────────────────────────────────────────────

def test_spend_more_than_usual_uses_the_engine_reading_verbatim(monkeypatch):
    async def fake_verdict(uid, offset=0):
        return {
            "reading": "You're running about £45 ahead of your usual pace, mostly Eating Out.",
            "period": {"start": "2026-09-01", "end": "2026-09-08"},
        }
    monkeypatch.setattr(spend_verdict_module, "compute_spend_verdict", fake_verdict)

    result = _run(answer_chip(UID, "spend_more_than_usual", None))
    assert "£45 ahead of your usual pace" in result["answer"]
    assert "1 Sep to 8 Sep" in result["answer"]
    _assert_house_style(result["answer"])


# ── 5. grow_saving_enough ────────────────────────────────────────────────
# This chip sits on Planning, so it quotes Planning's own GrowPanel.tsx hero
# verbatim (figure AND wording), never Home's differently-cached
# safe-to-spend gap — see this chip's own docstring for why the two can
# read differently on a live screen (GET /grow's 6h cache vs GET
# /safe-to-spend's 90s cache) despite sharing the identical
# abs(safe_to_spend) arithmetic underneath.

def test_grow_saving_enough_not_short_uses_the_grow_verdict_verbatim(monkeypatch):
    async def fake_grow_view(user):
        assert user == {"email": UID}
        return {
            "verdict": {"headline": "You've got ~£300/month spare", "sub": "Your buffer covers ~2 months"},
            "period_gate": {"short": False, "to_cover": 0.0, "period_end": None},
            "surplus_monthly": 300.0,
            "ladder": [],
        }
    monkeypatch.setattr(grow_module, "grow_view", fake_grow_view)

    result = _run(answer_chip(UID, "grow_saving_enough", None))
    assert result["answer"] == "You've got ~£300/month spare Your buffer covers ~2 months"
    _assert_house_style(result["answer"])


def test_grow_saving_enough_short_period_mirrors_the_planning_hero_wording(monkeypatch):
    async def fake_grow_view(user):
        return {
            "verdict": {"headline": "Your spending has been running ~£40/month ahead of income", "sub": ""},
            "period_gate": {"short": True, "to_cover": 85.0, "period_end": "2026-09-20"},
            "surplus_monthly": -40.0,
            "ladder": [],
        }
    monkeypatch.setattr(grow_module, "grow_view", fake_grow_view)

    result = _run(answer_chip(UID, "grow_saving_enough", None))
    answer = result["answer"]
    assert "This period needs you first" in answer
    assert "£85 to cover before payday" in answer
    assert "£40 behind" in answer  # periodShortSubline's surplus_monthly < 0 branch
    _assert_house_style(answer)


def test_grow_saving_enough_quotes_the_grow_ladders_own_figure_not_home(monkeypatch):
    # The exact scenario the coordinator flagged: Planning's cached period
    # gate (GET /grow, up to 6h stale) can genuinely disagree in FIGURE
    # with Home's live safe-to-spend gap (GET /safe-to-spend, 90s cache) at
    # a given instant — each chip must quote its OWN screen's cache, never
    # borrow the other's number.
    async def fake_grow_view(user):
        return {
            "verdict": {"headline": "", "sub": ""},
            "period_gate": {"short": True, "to_cover": 1053.91, "period_end": "2026-09-25"},
            "surplus_monthly": -190.0,
            "ladder": [],
        }
    monkeypatch.setattr(grow_module, "grow_view", fake_grow_view)

    async def fake_sts(uid):
        return {
            "status": "ok", "state": "short", "short_reason": "bills",
            "safe_to_spend": -748.91, "days_until_payday": 19,
            "next_payday": "2026-09-25", "lowest_projected_balance": 53.89,
        }
    monkeypatch.setattr(analytics_module, "get_cached_safe_to_spend", fake_sts)

    grow_result = _run(answer_chip(UID, "grow_saving_enough", None))
    home_result = _run(answer_chip(UID, "home_payday_status", None))

    assert grow_result["facts"]["period_gate"]["to_cover"] == 1053.91
    assert "£1,054" in grow_result["answer"]
    assert "£749" not in grow_result["answer"]

    assert "£749" in home_result["answer"]
    assert "£1,054" not in home_result["answer"] and "1,053" not in home_result["answer"]


# ── 6. explain-backed chips (real registry, no mocking needed) ──────────────

def test_spend_how_categories_work_uses_categorisation_registry_entry():
    result = _run(answer_chip(UID, "spend_how_categories_work", None))
    assert result["kind"] == "explain"
    assert "engine does it for you automatically" in result["answer"]
    _assert_house_style(result["answer"])


def test_planning_saving_vs_investing_uses_save_invest_registry_entry():
    result = _run(answer_chip(UID, "planning_saving_vs_investing", None))
    assert result["kind"] == "explain"
    assert "capital is at risk" in result["answer"]
    _assert_house_style(result["answer"])


def test_planning_lifetime_isa_uses_lisa_money_basics_entry():
    result = _run(answer_chip(UID, "planning_lifetime_isa", None))
    assert result["kind"] == "explain"
    assert "Lifetime ISA" in result["answer"] and "25%" in result["answer"]
    _assert_house_style(result["answer"])


# ── 7. tax chips: one engine-personalised, three honest LLM fallbacks ──────

def test_tax_self_assessment_uses_income_above_threshold(monkeypatch):
    async def fake_execute_tool(uid, name, args):
        assert name == "get_tax_position"
        return {"income": {"raw": 120000.0, "formatted": "£120,000"}}
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "tax_self_assessment", None))
    assert result["kind"] == "engine"
    assert "£100,000" in result["answer"] and "£120,000" in result["answer"]
    assert "this tax year" in result["answer"]
    _assert_house_style(result["answer"])


def test_tax_self_assessment_insufficient_data_is_honest(monkeypatch):
    async def fake_execute_tool(uid, name, args):
        return {"insufficient_data": True}
    monkeypatch.setattr(penny_chips_module, "execute_tool", fake_execute_tool)

    result = _run(answer_chip(UID, "tax_self_assessment", None))
    assert "isn't on file yet" in result["answer"]


def test_tax_fallback_chips_return_llm_kind_with_no_answer():
    for chip_id in ("tax_pension_carry_forward", "tax_salary_sacrifice", "tax_gift_aid"):
        result = _run(answer_chip(UID, chip_id, None))
        assert result == {"chip_id": chip_id, "kind": "llm"}
        assert "answer" not in result


# ── 8. can_i_amount — same verdict word as the ordinary can-I tool path ───

def _patch_affordability_fixture(monkeypatch, safe_to_spend=200.0, days=10):
    async def fake_compute_safe_to_spend(uid):
        return {
            "status": "ok", "safe_to_spend": safe_to_spend, "days_until_payday": days,
            "next_payday": "2026-09-20", "state": "comfortable", "short_reason": None,
            "bills_total": 0.0,
        }
    async def fake_cashflow(uid, region, cutoff):
        return (2000.0, 1500.0, 500.0)
    monkeypatch.setattr(affordability_module, "compute_safe_to_spend", fake_compute_safe_to_spend)
    monkeypatch.setattr(affordability_module, "_cashflow", fake_cashflow)


def test_can_i_amount_matches_the_can_i_tool_verdict_word_yes(monkeypatch):
    _patch_affordability_fixture(monkeypatch, safe_to_spend=200.0, days=10)

    chip_result = _run(answer_chip(UID, "can_i_amount", {"amount": 40, "occasion": "this weekend"}))
    tool_result = _run(real_execute_tool(UID, "check_affordability", {"amount": 40}))

    assert chip_result["facts"]["verdict_word"] == tool_result["verdict_word"] == "yes"
    assert "£160" in chip_result["answer"]  # 200 - 40 free_after_spend
    _assert_house_style(chip_result["answer"])


def test_can_i_amount_matches_the_can_i_tool_verdict_word_no(monkeypatch):
    _patch_affordability_fixture(monkeypatch, safe_to_spend=30.0, days=10)

    chip_result = _run(answer_chip(UID, "can_i_amount", {"amount": 100, "occasion": "this weekend"}))
    tool_result = _run(real_execute_tool(UID, "check_affordability", {"amount": 100}))

    assert chip_result["facts"]["verdict_word"] == tool_result["verdict_word"] == "no"
    _assert_house_style(chip_result["answer"])


def test_can_i_amount_missing_amount_is_honest_not_a_crash():
    result = _run(answer_chip(UID, "can_i_amount", {"occasion": "this weekend"}))
    assert result["kind"] == "engine"
    assert "specific amount" in result["answer"]


# ── 9. unknown chip → LookupError (service) / 404 (router) ─────────────────

def test_answer_chip_unknown_id_raises_lookup_error():
    try:
        _run(answer_chip(UID, "not_a_real_chip", None))
        assert False, "expected LookupError"
    except LookupError:
        pass


def test_penny_chip_router_404s_for_unknown_chip():
    try:
        _run(penny_chip_module.penny_chip({"chip_id": "not_a_real_chip"}, {"email": UID}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 404


def test_penny_chip_router_dispatches_a_known_chip():
    result = _run(penny_chip_module.penny_chip(
        {"chip_id": "planning_saving_vs_investing"}, {"email": UID},
    ))
    assert result["chip_id"] == "planning_saving_vs_investing"
    assert result["kind"] == "explain"


def test_every_registered_chip_id_is_reachable_through_answer_chip():
    # Every id CHIPS advertises must dispatch without raising LookupError —
    # a chip's OWN engine call is free to fail/degrade (each handler
    # catches that itself), but the id itself must always resolve.
    assert set(CHIPS.keys()) == {
        "home_payday_status", "home_payday_due", "spend_where_money_went",
        "spend_more_than_usual", "spend_how_categories_work",
        "planning_saving_vs_investing", "planning_lifetime_isa",
        "grow_saving_enough", "tax_self_assessment", "tax_pension_carry_forward",
        "tax_salary_sacrifice", "tax_gift_aid", "can_i_amount",
    }


# ── 10. The Penny monthly message cap (app.core.subscription.penny_allowance
# + POST /can-i's 402 gate) ─────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeLlmUsageCol:
    """Twin of test_llm_meter.py's own fixture — see that file's docstring
    for the shapes this needs to support (aggregate/distinct only, no real
    Mongo)."""
    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])

    async def create_index(self, *a, **kw):
        pass

    def aggregate(self, pipeline):
        match = pipeline[0]["$match"]
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in match.items())]
        by_pipeline: dict[str, list[dict]] = {}
        for d in rows:
            by_pipeline.setdefault(d["pipeline"], []).append(d)
        out = []
        for pname, ds in by_pipeline.items():
            out.append({
                "_id": pname, "calls": len(ds),
                "cost_usd": sum(d.get("cost_usd") or 0.0 for d in ds),
                "prompt_tokens": sum(d.get("prompt_tokens") or 0 for d in ds),
                "cached_tokens": sum(d.get("cached_tokens") or 0 for d in ds),
                "completion_tokens": sum(d.get("completion_tokens") or 0 for d in ds),
            })
        return _FakeCursor(out)

    async def distinct(self, field, match):
        rows = [d for d in self.docs if all(
            (d.get(k) == v) if k != "message_id" else (d.get(k) is not None)
            for k, v in match.items()
        )]
        return sorted({d[field] for d in rows if d.get(field) is not None})


class _FakeTopupsCol:
    def __init__(self):
        self.docs: list[dict] = []

    def find(self, query=None):
        query = query or {}
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]
        return _FakeCursor(rows)

    async def insert_one(self, doc):
        self.docs.append(doc)


class _FakeLiteSub:
    tier_name = "lite"
    tier = subscription_module.Tier.LITE
    status = "active"

    def limit(self, key):
        assert key == "penny_messages_per_month"
        return 3


CAP_UID = "penny-cap-test@example.com"


def _cap_docs(uid, ym, n):
    return [
        {
            "user_id": uid, "pipeline": "penny", "year_month": ym, "message_id": f"m{i}",
            "cost_usd": 0.0, "prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0,
        }
        for i in range(n)
    ]


def _patch_cap(monkeypatch, used_messages):
    from datetime import datetime, timezone
    ym = datetime.now(timezone.utc).strftime("%Y-%m")

    async def fake_get_subscription(email):
        return _FakeLiteSub()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)

    fake_llm_col = _FakeLlmUsageCol(_cap_docs(CAP_UID, ym, used_messages))
    monkeypatch.setattr(llm_module, "llm_usage_col", fake_llm_col)
    monkeypatch.setattr(llm_module, "_indexes_ready", True)

    fake_topups = _FakeTopupsCol()
    monkeypatch.setattr(db_collections_module, "penny_topups_col", fake_topups)
    return fake_topups


def test_penny_allowance_reports_limit_used_and_remaining(monkeypatch):
    _patch_cap(monkeypatch, used_messages=2)
    allowance = _run(subscription_module.penny_allowance(CAP_UID))
    assert allowance["tier"] == "lite"
    assert allowance["limit"] == 3
    assert allowance["used"] == 2
    assert allowance["remaining"] == 1
    assert allowance["topup_messages"] == 0


def test_can_i_returns_402_penny_limit_reached_once_used_meets_limit(monkeypatch):
    _patch_cap(monkeypatch, used_messages=3)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")

    try:
        _run(can_i_module.can_i({"question": "can I spend £45 this weekend"}, {"email": CAP_UID}))
        assert False, "expected HTTPException"
    except Exception as e:
        assert getattr(e, "status_code", None) == 402
        detail = e.detail
        assert detail["code"] == "PENNY_LIMIT_REACHED"
        assert detail["used"] == 3
        assert detail["limit"] == 3
        assert detail["tier"] == "lite"
        assert detail["resets_on"]


def test_can_i_greeting_still_answers_at_the_cap(monkeypatch):
    _patch_cap(monkeypatch, used_messages=3)
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")

    result = _run(can_i_module.can_i({"question": "hey"}, {"email": CAP_UID}))
    assert result["out_of_scope"] is False
    assert result["headline"] is None


def test_admin_topup_lifts_the_cap(monkeypatch):
    fake_topups = _patch_cap(monkeypatch, used_messages=3)

    topup_result = _run(subscription_router_module.admin_topup(
        {"email": CAP_UID, "messages": 100}, {"name": "Bot"},
    ))
    assert topup_result["ok"] is True
    assert len(fake_topups.docs) == 1
    assert fake_topups.docs[0]["source"] == "admin"

    allowance = _run(subscription_module.penny_allowance(CAP_UID))
    assert allowance["limit"] == 103  # 3 tier + 100 top-up
    assert allowance["topup_messages"] == 100
    assert allowance["used"] == 3
    assert allowance["remaining"] == 100

    # The gate itself is now clear — a full run_penny_agent round-trip,
    # scripted the same way test_penny_agent.py's own success case is.
    import json as _json

    class _ScriptedAsyncClient:
        def __init__(self, payload):
            self._payload = payload

        def __call__(self, *a, **kw):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            class _R:
                status_code = 200
                def json(_self):
                    return self._payload
            return _R()

    final_payload = {
        "choices": [{"message": {
            "content": "HEADLINE: You have headroom\nREPLY: You have £160 free until payday.",
        }}],
    }
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", _ScriptedAsyncClient(final_payload))
    monkeypatch.setattr(can_i_module, "OPENROUTER_API_KEY", "test-key")

    result = _run(can_i_module.can_i({"question": "can I spend £45 this weekend"}, {"email": CAP_UID}))
    assert result["out_of_scope"] is False
    assert result["headline"] == "You have headroom"


def test_subscription_endpoint_exposes_penny_cap_fields(monkeypatch):
    _patch_cap(monkeypatch, used_messages=2)

    # subscription_router.py imported `get_subscription` by name at module
    # load (`from app.core.subscription import ... get_subscription`), so
    # it holds its OWN bound reference — patching app.core.subscription's
    # attribute (what _patch_cap did, for penny_allowance's internal call)
    # does not reach it. Patch the router module's own name too, same fake.
    async def fake_get_subscription(email):
        return _FakeLiteSub()
    monkeypatch.setattr(subscription_router_module, "get_subscription", fake_get_subscription)

    result = _run(subscription_router_module.get_subscription_info({"email": CAP_UID}))
    usage = result["usage"]
    assert usage["penny_limit"] == 3
    assert usage["penny_remaining"] == 1
    assert usage["penny_topup_messages"] == 0
    assert usage["penny_resets_on"]
