"""B38 — golden-question eval gate for Penny's tool-calling loop.

PENNY_TOOLS.md records that the routing bug which caused the whole
loop-first rebuild (a confident-but-wrong route for "How can I improve my
entertainment spending") had no regression net once the deterministic
ladder that bug lived in was deleted — the model now owns 100% of tool
selection, and nothing pinned which tool a given question SHOULD reach.
This file is that net: ~30 questions drawn from the four screen-by-screen
inventories in docs/penny/question-inventory/, each asserting which tool(s)
`run_penny_agent` selects for it, never the phrasing of the answer.

## How the fake model is driven, and why this is honest

No real OpenRouter call is made (every test here passes with
OPENROUTER_API_KEY unset — nothing here even imports httpx against a real
socket). What replaces the model is `_GoldenFakeClient`, a stand-in for
`httpx.AsyncClient` patched in exactly where `test_penny_agent.py` already
patches it (`penny_agent_module.httpx.AsyncClient`), so `run_penny_agent`
runs completely unmodified: the REAL system prompt, the REAL tool catalog
(`TOOL_SCHEMAS + PROPOSE_TOOL_SCHEMAS`, assembled by `penny_agent.py` itself
from `app.services.penny_tools`), the REAL per-round payload construction
(`_build_user_content`, date grounding, the consent lookup, the round/
wall-clock bookkeeping), and the REAL round-by-round loop mechanics all run
exactly as they would against a real model.

The one thing genuinely impossible to exercise without a network call is
the MODEL'S OWN judgement of which tool a question calls for — that
reasoning happens inside OpenRouter, not in this codebase. `_GoldenFakeClient`
does not pretend to replicate it with a second, hand-rolled classifier
(that would just be a second opinion to keep in sync, not a check on the
real one). Instead, each golden case is authored with an `anchors` list per
expected tool: a short phrase that must appear, verbatim and
case-insensitively, in that tool's OWN description exactly as it will be
sent to the model this round. Every anchor below was copied out of the real
`app.services.penny_tools.TOOL_SCHEMAS`/`_explain_tool_description()` text
at authoring time (see each case's own comment), not invented — so the
harness is asserting "the concept a person would actually ask about is
still where the catalog says it is", grounded in the live schema text, not
in a second copy of it. On its turn, the fake model:

1. Looks up the case's next expected tool NAME in the REAL `tools` array of
   the request `run_penny_agent` actually built this round. If the name is
   missing from the catalog entirely (removed, renamed, or gated off by a
   flag), the harness records `missing_from_catalog` and stops — this is
   the "missing tool" regression shape.
2. Checks that tool's REAL description (as sent this round, not a cached
   copy) contains at least one of the case's anchor phrases. If not — the
   description was edited, or swapped with another tool's — the harness
   records `anchor_mismatch` and stops. This is the "swapped descriptions"
   regression shape: swap two tools' text and the anchor that used to live
   in tool A's description is no longer there.
3. Otherwise it "calls" that tool, in that round, and moves on.

This means the harness's decision is genuinely driven by the real code's
own output, not a lookup table independent of it, and a routing regression
in the catalog (the wrong tool, a missing tool, or by extension a
description that no longer actually justifies the tool it is attached to)
changes what the harness can even attempt to call — exactly the class of
bug this item exists to catch.

## What this does NOT exercise

- **The model's own reasoning.** A real LLM's judgement of which tool a
  novel phrasing of a question calls for is not tested here at all — that
  would require a real OpenRouter call, which this suite must run without
  (OPENROUTER_API_KEY unset). This file catches a regression in the
  CATALOG (a tool disappearing, being renamed, or its description drifting
  away from the concept it is supposed to cover) and in the LOOP's own
  mechanics (rounds, dispatch, consent gating) — not a regression in the
  model's judgement itself, which no code-level test can pin.
- **Real tool execution.** `execute_tool` is replaced with a recorder that
  returns a canned `{"ok": True}` for any tool name (never real engine
  calls, no database access at all for these tests beyond the loop's own
  read-only `preferences_col.find_one` consent lookup) — this file is
  about SELECTION, not the figures a tool would actually return. Real
  execution against fixture data is a different, already-covered concern
  (`test_penny_tools.py`).
- **Propose (write) tools.** The golden set below sticks to the 20 read
  tools. A propose tool's dispatch is gated on `penny_agent_consent`
  (unset for every fixture uid here), which would make "was the right
  tool SELECTED" and "did dispatch complete" two different questions to
  thread through the same case — out of scope for the cheapest useful
  version of this gate.
"""
import asyncio

import pytest

import app.services.penny_agent as penny_agent_module

# ── Fake OpenRouter client, driven by the REAL request payload ────────────


class _FinalResponse:
    def __init__(self, text: str):
        self.status_code = 200
        self._payload = {"choices": [{"message": {"content": text}}]}

    def json(self):
        return self._payload


class _ToolCallResponse:
    def __init__(self, name: str, call_id: str):
        self.status_code = 200
        self._payload = {
            "choices": [{
                "message": {
                    "content": None,
                    "tool_calls": [{
                        "id": call_id,
                        "type": "function",
                        "function": {"name": name, "arguments": "{}"},
                    }],
                },
            }],
        }

    def json(self):
        return self._payload


class _GoldenFakeClient:
    """See module docstring. `expected_tools`/`anchors` are the golden
    case's own declared shape; `self.outcome` starts `"ok"` and is set to
    `"missing_from_catalog:<tool>"` or `"anchor_mismatch:<tool>"` the
    moment the REAL catalog sent this round can't honestly justify the
    next expected tool — callers must check `outcome == "ok"` before
    trusting `self.attempted` at all."""

    def __init__(self, expected_tools: list[str], anchors: list[list[str]]):
        self._expected = expected_tools
        self._anchors = anchors
        self.calls: list[dict] = []
        self.attempted: list[str] = []
        self.outcome = "ok"

    def __call__(self, *args, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        self.calls.append(json)
        round_index = len(self.calls) - 1
        if self.outcome != "ok" or round_index >= len(self._expected):
            names = ", ".join(self._expected) or "nothing"
            return _FinalResponse(f"HEADLINE: done\nREPLY: answered using {names}.")

        tool_name = self._expected[round_index]
        catalog = {
            entry["function"]["name"]: entry["function"]
            for entry in (json.get("tools") or [])
            if isinstance(entry, dict) and isinstance(entry.get("function"), dict)
        }
        fn = catalog.get(tool_name)
        if fn is None:
            self.outcome = f"missing_from_catalog:{tool_name}"
            return _FinalResponse("HEADLINE: n/a\nREPLY: n/a")

        description = (fn.get("description") or "").lower()
        anchors = self._anchors[round_index]
        if not any(anchor.lower() in description for anchor in anchors):
            self.outcome = f"anchor_mismatch:{tool_name}"
            return _FinalResponse("HEADLINE: n/a\nREPLY: n/a")

        self.attempted.append(tool_name)
        return _ToolCallResponse(tool_name, call_id=f"call_{round_index + 1}")


def run_case(monkeypatch, question, screen, expected_tools, anchors):
    """Drives one golden case through the REAL `run_penny_agent` loop with
    `_GoldenFakeClient` standing in for OpenRouter and a recording stub
    standing in for `execute_tool` (see module docstring's "What this does
    NOT exercise"). Returns the client (for `.outcome`/`.calls`), the
    ordered list of tool names actually dispatched, and the loop's own
    return value."""
    client = _GoldenFakeClient(expected_tools, anchors)
    monkeypatch.setattr(penny_agent_module.httpx, "AsyncClient", client)

    dispatched: list[str] = []

    async def fake_execute_tool(uid, name, args):
        dispatched.append(name)
        return {"ok": True}

    monkeypatch.setattr(penny_agent_module, "execute_tool", fake_execute_tool)

    result = asyncio.run(penny_agent_module.run_penny_agent(
        "golden-eval-uid", question, [], screen, "",
    ))
    return client, dispatched, result


# ── The golden set ──────────────────────────────────────────────────────────
#
# Each case: id, source inventory file, question, screen context, the
# expected ordered tool sequence, one anchor-phrase list per expected tool
# (copied verbatim from the real TOOL_SCHEMAS description at authoring
# time), and a one-line "why" so a future routing change can argue with the
# case rather than just flip it. 30 cases, spread across all four inventory
# files rather than concentrated in one.

GOLDEN_CASES = [
    # ── docs/penny/question-inventory/home-and-penny.md (8) ─────────────
    dict(
        id="home-01-safe-to-spend",
        source="home-and-penny.md",
        question="How much can I safely spend before payday?",
        screen="home",
        expected=["get_safe_to_spend"],
        anchors=[["how much the user can afford"]],
        why="The Home hero's own 'how much can I spend' question, get_safe_to_spend's reason for existing.",
    ),
    dict(
        id="home-02-todays-brief",
        source="home-and-penny.md",
        question="What is Penny suggesting I do today?",
        screen="home",
        expected=["get_today_brief"],
        anchors=[["currently asking/suggesting on home"]],
        why="A3 (the Brief companion feed) is get_today_brief's own worked example, distinct from get_upcoming_bills' whole-list shape.",
    ),
    dict(
        id="home-03-payday-plan",
        source="home-and-penny.md",
        question="What's my payday plan for this pay period?",
        screen="penny",
        expected=["get_today_brief"],
        anchors=[["what's my payday plan"]],
        why="'Payday plan' is named explicitly inside get_today_brief's description; must not be confused with get_upcoming_bills.",
    ),
    dict(
        id="home-04-safe-then-bills",
        source="home-and-penny.md",
        question="How much can I safely spend, and what bills are coming up before my next payday?",
        screen="home",
        expected=["get_safe_to_spend", "get_upcoming_bills"],
        anchors=[["how much the user can afford"], ["what's due, what's coming up"]],
        why="A compound ask needing two tools in sequence, the shape most likely to regress if the loop stops after one tool call.",
    ),
    dict(
        id="home-05-account-activity",
        source="home-and-penny.md",
        question="Why did my ISA balance change this week?",
        screen="accounts",
        expected=["get_account_activity"],
        anchors=[["why did my balance change"]],
        why="A named-account balance-change question is get_account_activity's own worked example, never search_transactions (which cannot match an account name).",
    ),
    dict(
        id="home-06-recurring",
        source="home-and-penny.md",
        question="What subscriptions am I paying right now, and when does Netflix renew?",
        screen="home",
        expected=["get_recurring_payments"],
        anchors=[["what subscriptions am i paying"]],
        why="Naming a specific recurring bill/renewal date is get_recurring_payments' own worked example, not the whole-list get_upcoming_bills.",
    ),
    dict(
        id="home-07-mirror",
        source="home-and-penny.md",
        question="What is the Mirror, and why does it say I'm a weekend spender?",
        screen="penny",
        expected=["get_mirror"],
        anchors=[["what is the mirror"]],
        why="The behavioural-portrait 'why do you say this about me' shape maps to get_mirror, never get_insights (a different kind of tip).",
    ),
    dict(
        id="home-08-tax-position",
        source="home-and-penny.md",
        question="How much of my personal allowance do I have left this tax year?",
        screen="penny",
        expected=["get_tax_position"],
        anchors=[["how much personal allowance do i have left"]],
        why="A personal tax figure must ground on the user's own numbers via get_tax_position, never general tax knowledge.",
    ),

    # ── docs/penny/question-inventory/spend.md (8) ──────────────────────
    dict(
        id="spend-01-verdict",
        source="spend.md",
        question="Am I overspending this pay period?",
        screen="spend",
        expected=["get_spend_verdict"],
        anchors=[["how is my spending going"]],
        why="The core 'am I overspending' shape get_spend_verdict exists for; its reading sentence must be quoted verbatim.",
    ),
    dict(
        id="spend-02-category-detail",
        source="spend.md",
        question="How much have I spent on Eating Out this period, and where did it go?",
        screen="spend",
        expected=["get_category_spend"],
        anchors=[["how much did i spend on x"]],
        why="Category-detail with top merchants is get_category_spend's own worked shape, not the whole-verdict tool.",
    ),
    dict(
        id="spend-03-merchant-search",
        source="spend.md",
        question="How much did I spend at Tesco in April?",
        screen="spend",
        expected=["search_transactions"],
        anchors=[["how much did i spend at x"]],
        why="A named merchant plus a date range is search_transactions' own worked example; get_category_spend has no merchant/date filter at all.",
    ),
    dict(
        id="spend-04-jargon-moved",
        source="spend.md",
        question="What does 'moved' mean on my Spend page? Why is it shown in green?",
        screen="spend",
        expected=["explain"],
        anchors=[["jargon term"]],
        why="A jargon-definition ask ('what does X mean') routes to explain's registry, never a live-figures tool.",
    ),
    dict(
        id="spend-05-headline-reconcile",
        source="spend.md",
        question="Why doesn't my Out figure match what my bank statement shows?",
        screen="spend",
        expected=["explain"],
        anchors=[["headline number"]],
        why="A headline-number reconciliation ask is explain's registry category, grounded rather than the model guessing an explanation.",
    ),
    dict(
        id="spend-06-advice-shaped",
        source="spend.md",
        question="What's driving my Entertainment spend this period, and how can I cut it?",
        screen="spend",
        expected=["get_category_spend"],
        anchors=[["how can i cut my x"]],
        why="The exact motivating bug this rebuild fixed (an advice-shaped spend question) must still ground on get_category_spend's own facts, never a prescriptive answer with no tool call.",
    ),
    dict(
        id="spend-07-prior-period",
        source="spend.md",
        question="Was I over usual on Groceries last pay period?",
        screen="spend",
        expected=["get_spend_verdict"],
        anchors=[["was i over usual on x"]],
        why="Same tool as spend-01 but exercises the prior-period argument, a distinct regression surface from the current-period default.",
    ),
    dict(
        id="spend-08-how-do-i",
        source="spend.md",
        question="How do I recategorise a transaction so it always files that way from now on?",
        screen="spend",
        expected=["explain"],
        anchors=[["how-do-i walkthrough"]],
        why="An app-action walkthrough ask routes to explain's registry, never a live tool.",
    ),

    # ── docs/penny/question-inventory/planning-grow-debt.md (8) ─────────
    dict(
        id="plan-01-debt-position",
        source="planning-grow-debt.md",
        question="How much debt do I have across my cards, and how much interest am I paying a month?",
        screen="planning",
        expected=["get_debt_position"],
        anchors=[["credit-card debt position"]],
        why="The core debt-position shape (Planning's debt row) maps directly to get_debt_position.",
    ),
    dict(
        id="plan-02-named-goal",
        source="planning-grow-debt.md",
        question="How is my Japan trip goal progressing?",
        screen="planning",
        expected=["get_goals"],
        anchors=[["target amount and target date"]],
        why="A named-goal progress ask is get_goals' own worked example, distinct from get_savings_position's whole-buffer figure.",
    ),
    dict(
        id="plan-03-savings-buffer",
        source="planning-grow-debt.md",
        question="How much is in my savings buffer, and am I on track for my target?",
        screen="planning",
        expected=["get_savings_position"],
        anchors=[["savings buffer"]],
        why="The whole-buffer/target-percent-funded shape is get_savings_position's own reason for existing, distinct from a single named goal.",
    ),
    dict(
        id="plan-04-affordability",
        source="planning-grow-debt.md",
        question="Can I afford a £2,000 holiday next August?",
        screen="planning",
        expected=["check_affordability"],
        anchors=[["can i afford/spend x"]],
        why="check_affordability owns the amount+timeframe arithmetic; the model must extract the £ figure and hand it over, never eyeball it itself.",
    ),
    dict(
        id="plan-05-calculate",
        source="planning-grow-debt.md",
        question="If I paid an extra £50.32 a week off my card for 6 months, roughly how much would that add up to?",
        screen="planning",
        expected=["calculate"],
        anchors=[["generic arithmetic calculator"]],
        why="Multi-step arithmetic the model must never do in its head routes to calculate, restated repeatedly in PENNY_TOOLS.md's own doctrine.",
    ),
    dict(
        id="plan-06-jargon-buffer",
        source="planning-grow-debt.md",
        question="What does 'buffer' mean on the Grow screen?",
        screen="planning",
        expected=["explain"],
        anchors=[["jargon term"]],
        why="A jargon-term case on Planning/Grow rather than Spend, proving explain routes the same way regardless of which screen asks.",
    ),
    dict(
        id="plan-07-avalanche",
        source="planning-grow-debt.md",
        question="What would it take to clear my most expensive card first?",
        screen="planning",
        expected=["get_debt_position"],
        anchors=[["per-card breakdown"]],
        why="The avalanche 'what it would take' agency block still grounds on get_debt_position's own per-card facts, never a model-invented plan.",
    ),
    dict(
        id="plan-08-money-basics",
        source="planning-grow-debt.md",
        question="What is an ISA, and should I use one instead of a regular savings account?",
        screen="planning",
        expected=["explain"],
        anchors=[["money-basics"]],
        why="General UK money education, not personal to the user, routes to explain's registry rather than get_savings_position.",
    ),

    # ── docs/penny/question-inventory/insights-accounts-mirror.md (6) ───
    dict(
        id="insights-01-best-tip",
        source="insights-accounts-mirror.md",
        question="What's the best money-saving tip you've got for me right now?",
        screen="insights",
        expected=["get_insights"],
        anchors=[["saving ideas"]],
        why="'What's the best insight' is get_insights' own worked example; rank 1 must be reproduced, never re-ranked.",
    ),
    dict(
        id="insights-02-account-balance",
        source="insights-accounts-mirror.md",
        question="Which accounts do I have connected, and what's my Monzo balance?",
        screen="accounts",
        expected=["get_accounts"],
        anchors=[["which accounts the user has"]],
        why="A specific-account-balance ask is get_accounts' own worked shape, and the required first stop before get_account_activity when names collide.",
    ),
    dict(
        id="insights-03-pot-activity",
        source="insights-accounts-mirror.md",
        question="What was the first payment into my Saving Challenge pot?",
        screen="accounts",
        expected=["get_account_activity"],
        anchors=[["first/earliest/latest payment into x pot"]],
        why="Named-pot activity is get_account_activity's own worked example; the app keeps no other balance-history chart for it.",
    ),
    dict(
        id="insights-04-mirror-aim",
        source="insights-accounts-mirror.md",
        question="What traits has the Mirror picked up about me, and how is my spending aim going?",
        screen="mirror",
        expected=["get_mirror"],
        anchors=[["how is my aim going"]],
        why="Traits plus aim-progress in one ask, exercising the other half of get_mirror's own description from home-07.",
    ),
    dict(
        id="insights-05-multi-month",
        source="insights-accounts-mirror.md",
        question="How much did I spend on Eating Out over the last 3 months?",
        screen="insights",
        expected=["get_category_spend"],
        anchors=[["last n months"]],
        why="Exercises get_category_spend's `months` argument path, a distinct regression surface from spend-02's current-period-only case.",
    ),
    dict(
        id="insights-06-jargon-dormant",
        source="insights-accounts-mirror.md",
        question="What does 'dormant' mean next to one of my accounts?",
        screen="accounts",
        expected=["explain"],
        anchors=[["jargon term"]],
        why="A third jargon-term case, triggered from the Accounts surface, proving explain's routing is screen-agnostic.",
    ),
]

# Sanity on the golden set's own shape — catches a typo in this file itself
# (a case missing its own anchors list, or an anchors list too short for
# its own expected-tools list) before it ever reaches the harness.
for _case in GOLDEN_CASES:
    assert len(_case["anchors"]) == len(_case["expected"]), _case["id"]

_SOURCE_COUNTS = {
    "home-and-penny.md": 8, "spend.md": 8, "planning-grow-debt.md": 8,
    "insights-accounts-mirror.md": 6,
}


def test_golden_set_spread_across_all_four_inventory_files():
    """Guards against the brief's own instruction ('a spread, not 30 from
    one file') silently eroding as cases are added or removed later."""
    counts: dict[str, int] = {}
    for case in GOLDEN_CASES:
        counts[case["source"]] = counts.get(case["source"], 0) + 1
    assert counts == _SOURCE_COUNTS
    assert sum(counts.values()) == len(GOLDEN_CASES)
    assert 28 <= len(GOLDEN_CASES) <= 32


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["id"] for c in GOLDEN_CASES])
def test_golden_tool_selection(monkeypatch, case):
    client, dispatched, result = run_case(
        monkeypatch, case["question"], case["screen"], case["expected"], case["anchors"],
    )
    assert client.outcome == "ok", (
        f"{case['id']} ({case['question']!r}): harness outcome {client.outcome!r}, "
        f"expected tool sequence {case['expected']} to be reachable. {case['why']}"
    )
    assert dispatched == case["expected"], (
        f"{case['id']} ({case['question']!r}): expected tools {case['expected']}, "
        f"got {dispatched}. {case['why']}"
    )
    assert result is not None


# ── Deliberately breaking routing: proves the gate has teeth ──────────────
#
# Each test below mutates the REAL catalog (`penny_agent_module.TOOL_SCHEMAS`,
# the same module attribute `run_penny_agent` reads every call) for the
# scope of one test only, via monkeypatch, then re-runs an affected golden
# case and asserts the harness names the failure. This is what "break
# routing deliberately... and show which golden cases fail" (the item's own
# verification step) looks like as a permanent regression test: it proves
# the eval gate itself would have caught these two real regression shapes,
# without leaving routing broken for any other test in the suite.

def _tool_names(schemas):
    return [entry["function"]["name"] for entry in schemas]


def test_break_missing_tool_is_caught(monkeypatch):
    """Simulates a tool being dropped from the catalog entirely (e.g. an
    accidental deletion, or a flag wrongly gating it off) — home-01 expects
    get_safe_to_spend, which after this mutation no longer exists in the
    list `run_penny_agent` actually offers the model."""
    mutated = [
        entry for entry in penny_agent_module.TOOL_SCHEMAS
        if entry["function"]["name"] != "get_safe_to_spend"
    ]
    assert "get_safe_to_spend" not in _tool_names(mutated)  # sanity on the mutation itself
    monkeypatch.setattr(penny_agent_module, "TOOL_SCHEMAS", mutated)

    case = next(c for c in GOLDEN_CASES if c["id"] == "home-01-safe-to-spend")
    client, dispatched, result = run_case(
        monkeypatch, case["question"], case["screen"], case["expected"], case["anchors"],
    )
    assert client.outcome == "missing_from_catalog:get_safe_to_spend", (
        f"expected the harness to name home-01-safe-to-spend as broken by a missing tool, got {client.outcome!r}"
    )
    assert dispatched != case["expected"]


def test_break_swapped_descriptions_is_caught(monkeypatch):
    """Simulates the item's own named example: two tools' descriptions
    swapped (a plausible copy-paste-during-refactor mistake). plan-04
    (check_affordability) and plan-01 (get_debt_position) each lose the
    anchor phrase that used to justify calling them, because that text now
    lives on the OTHER tool."""
    import copy

    mutated = copy.deepcopy(penny_agent_module.TOOL_SCHEMAS)
    by_name = {entry["function"]["name"]: entry["function"] for entry in mutated}
    a, b = by_name["check_affordability"], by_name["get_debt_position"]
    a["description"], b["description"] = b["description"], a["description"]
    monkeypatch.setattr(penny_agent_module, "TOOL_SCHEMAS", mutated)

    affordability_case = next(c for c in GOLDEN_CASES if c["id"] == "plan-04-affordability")
    client, dispatched, _ = run_case(
        monkeypatch, affordability_case["question"], affordability_case["screen"],
        affordability_case["expected"], affordability_case["anchors"],
    )
    assert client.outcome == "anchor_mismatch:check_affordability", (
        f"expected plan-04-affordability to fail on the swapped description, got {client.outcome!r}"
    )
    assert dispatched != affordability_case["expected"]

    debt_case = next(c for c in GOLDEN_CASES if c["id"] == "plan-01-debt-position")
    client, dispatched, _ = run_case(
        monkeypatch, debt_case["question"], debt_case["screen"],
        debt_case["expected"], debt_case["anchors"],
    )
    assert client.outcome == "anchor_mismatch:get_debt_position", (
        f"expected plan-01-debt-position to fail on the swapped description, got {client.outcome!r}"
    )
    assert dispatched != debt_case["expected"]
