"""B38 — golden-question eval gate for Penny's tool-calling loop.

PENNY_TOOLS.md records that the deterministic keyword ladder deleted in the
loop-first rebuild once routed "How can I improve my entertainment
spending" to a confident, wrong answer by matching "entertainment" as a
synonym — and that once the ladder was deleted, nothing pinned which tool a
given question SHOULD reach. That ladder is gone; the model now owns 100%
of tool SELECTION.

**What this file actually catches, precisely stated:** CATALOG regressions
— a tool disappearing from the schema list offered to the model, a tool's
description drifting away from the concept it is supposed to cover, or a
golden case's own question no longer matching what its cited inventory
file actually documents. It does **not**, and cannot, catch a live model
misjudging a novel question — that is genuine routing JUDGEMENT, which
happens inside OpenRouter, not in this codebase, and no code-level test can
pin it without a real model call (which this suite must run without, see
below). The distinction matters: this is a net under the CATALOG the model
reads, not a stand-in for the model's own reasoning.

~30 questions are drawn from the four screen-by-screen inventories in
docs/penny/question-inventory/, each asserting which tool(s)
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
the MODEL'S OWN judgement of which tool a question calls for. Each golden
case therefore declares which tool(s) it expects, and the fake model
"calls" that tool on its turn — but only after checking, against the REAL
request payload `run_penny_agent` actually built this round, that calling
it is still honest:

1. Looks up the case's next expected tool NAME in the REAL `tools` array of
   the request. If the name is missing from the catalog entirely (removed,
   renamed, or gated off by a flag), the harness records
   `missing_from_catalog` and stops.
2. Computes a sha256 of that tool's REAL description (as sent this round,
   normalised whitespace, never a cached copy) and compares it against a
   PINNED hash captured at authoring time (`PINNED_TOOL_DESCRIPTION_HASHES`
   below). If the live hash no longer matches, the harness records
   `description_changed` and stops.

   This replaces an earlier version of this file that checked for a short
   anchor SUBSTRING instead of a full-description hash — an independent
   review (2026-09-28) found that check gave a false pass: a description
   rewritten into something unrelated but that happened to still contain
   the anchor phrase (e.g. get_safe_to_spend's description replaced with
   weather-forecast copy that kept the words "how much the user can
   afford" somewhere in it) sailed straight through. A hash of the WHOLE
   normalised description has no such blind spot — ANY drift changes it,
   whether or not the old anchor phrase happens to survive. See
   `test_break_description_drift_with_old_anchor_phrase_preserved_is_caught`
   for a permanent regression test proving exactly that false pass is now
   caught. The trade-off, honestly stated: a hash tells you THAT a
   description changed, never WHAT changed or whether the change was
   harmless — re-reading the tool's real description and re-pinning (see
   `--repin` below) is a deliberate manual step, not automated away.

   B42: one tool's description (`explain`) legitimately varies with the
   process environment (`MCP_CONNECTOR_ENABLED`, read at call time — A17).
   Pinning a single hash of "the live description" for that tool bakes in
   whichever environment state happened to be live when the pin was
   captured, so the exact same suite then passes in one environment and
   fails in another with no code drift at all — this is what made every
   integrate pass fail on `explain`. `ENV_VARIANT_TOOLS` and
   `_canonical_variant_hash` (below) pin such a tool by building BOTH
   variants explicitly and hashing the sorted pair, so the pin is the same
   value regardless of this process's own environment, while still
   changing the moment either variant's own wording drifts.
3. Otherwise it "calls" that tool, in that round, and moves on.

This means the harness's decision is genuinely driven by the real code's
own output, not a lookup table independent of it, and a routing regression
in the catalog (the wrong tool, a missing tool, or a description that has
silently drifted) changes what the harness can even attempt to call —
exactly the class of bug this item exists to catch.

### Re-pinning after an intentional description edit

When a tool's description is deliberately rewritten, every golden case
that names it will start failing with `description_changed:<tool>` — this
is expected, not a bug. Re-pin from `backend/`, with `app.services.
penny_tools` importable (`PYTHONPATH=.` if running the file directly
rather than through pytest):

    PYTHONPATH=. .venv/bin/python -m tests.test_penny_golden_eval --repin

This rewrites `PINNED_TOOL_DESCRIPTION_HASHES` below in place with the
live hash of every tool name already a key in it (it never adds or removes
a key — a brand new golden case still needs one hand-added entry, the same
as adding the case itself). Review the resulting diff before committing it,
the same discipline as any other pinned-fixture update: a `--repin` that
silently absorbed an unintended drift would defeat the whole point of
pinning.

## What this does NOT exercise

- **The model's own reasoning.** A real LLM's judgement of which tool a
  novel phrasing of a question calls for is not tested here at all — that
  would require a real OpenRouter call, which this suite must run without
  (OPENROUTER_API_KEY unset). This file catches a regression in the
  CATALOG (a tool disappearing, being renamed, or its description
  drifting) and in the LOOP's own mechanics (rounds, dispatch, consent
  gating), plus a golden case's own question falling out of step with the
  inventory file it cites — not a regression in the model's judgement
  itself, which no code-level test can pin.
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
import hashlib
import pathlib
import sys

import pytest

import app.services.penny_agent as penny_agent_module
import app.services.penny_tools as penny_tools_module

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


def _normalise_description(text: str) -> str:
    """Collapse whitespace only — never lowercase or otherwise fold the
    text, since a hash is meant to catch ANY drift, not just drift a
    case-insensitive comparison would notice."""
    return " ".join((text or "").split())


def _description_sha256(text: str) -> str:
    return hashlib.sha256(_normalise_description(text).encode("utf-8")).hexdigest()


# ── B42: flag-independent pins for env-variant descriptions ────────────────
#
# `explain`'s description (app.services.penny_tools._explain_tool_description)
# is the one tool description in this catalog that legitimately varies by
# process environment: it reads MCP_CONNECTOR_ENABLED at call time, so the
# text actually sent to the model differs between a connector-off process
# (no `mcp_connector` clause) and a connector-on one (see that function's
# own docstring for why — A17/F16). Before B42, PINNED_TOOL_DESCRIPTION_HASHES
# pinned whichever single variant happened to be live in the process that
# captured the pin, so this suite passed in a worktree (no backend/.env,
# flag unset/false) and failed wherever backend/.env sets the flag true —
# the shared tree scripts/integrate.py actually tests in, which is why
# every integrate pass failed on test_golden_tool_selection
# [spend-04-jargon-moved]. The description had not drifted; the PIN was
# environment-dependent.
#
# `ENV_VARIANT_TOOLS` names every tool description known to vary with the
# process environment, mapped to a function that builds each variant
# EXPLICITLY (never by reading the ambient flag) — B42's fix adds a
# `connector_enabled` override parameter to `_explain_tool_description` for
# exactly this. For a tool listed here, both `_GoldenFakeClient.post`
# (below) and `--repin` compute a pin that is provably independent of
# whatever MCP_CONNECTOR_ENABLED happens to be in the process running the
# suite, while still changing the moment either variant's own wording
# drifts (see `_canonical_variant_hash` immediately below).
ENV_VARIANT_TOOLS = {
    "explain": penny_tools_module._explain_tool_description,
}


def _canonical_variant_hash(builder):
    """For an env-variant tool, build BOTH variants explicitly (`True` and
    `False` passed directly to `builder`, never read off the ambient
    environment or this process's already-imported flag), hash each
    individually, then hash the two variant hashes sorted and joined with a
    separator. Sorting makes the combined result independent of which
    variant happens to be live in the calling process — the same canonical
    hash comes out whether this process's own MCP_CONNECTOR_ENABLED is true
    or false, because neither is ever consulted.

    Returns `(true_hash, false_hash, canonical_hash)`: the two individual
    hashes let a caller check that a REQUEST's live description is one of
    the two known-good variants (catches corruption or a swapped
    description); `canonical_hash` is what actually gets pinned in
    `PINNED_TOOL_DESCRIPTION_HASHES` and is what catches wording drift in
    EITHER variant, since changing either one changes the sorted pair and
    therefore this hash."""
    true_hash = _description_sha256(builder(True))
    false_hash = _description_sha256(builder(False))
    canonical_hash = hashlib.sha256(
        "\x1e".join(sorted([true_hash, false_hash])).encode("utf-8")
    ).hexdigest()
    return true_hash, false_hash, canonical_hash


# Pinned sha256 hashes of each golden tool's full, real description text
# (normalised per `_normalise_description`), captured at authoring time
# directly from the live `app.services.penny_tools.TOOL_SCHEMAS`. The
# harness recomputes this same hash from the REAL description sent in each
# round's request payload and fails the moment it no longer matches — see
# the module docstring for why this replaced a substring-anchor check, and
# "Re-pinning" above for how to refresh these after an intentional edit.
# `explain`'s entry is the one exception: it is the CANONICAL hash from
# `_canonical_variant_hash`, not a single-description hash — see the
# ENV_VARIANT_TOOLS block above for why, and B42.
PINNED_TOOL_DESCRIPTION_HASHES = {
    "calculate": "5cc43cf069e72da75ac0c00009a45e4fd89714c56d245d3a297931f9696ae2d0",
    "check_affordability": "96f7e3bc9eab7718e3c8382f10b4a8396da740931003787c9b87afeabe55b7f8",
    "explain": "a9c9de9075e1f2b0b57bbdc875e0e216a5ea8269ea39b13b1c0990c2b198a91e",
    "get_account_activity": "a177a9327880d3e518b6164b375da8926fb345a9ac20b3675904c6ed1e20e3f7",
    "get_accounts": "635f1a49e599affcc455cba594ddffdd6e69d5ec17d29aa41e701a1bbba83c9b",
    "get_category_spend": "e96c666d2f3b75b3fca8fcd200c352eb680f237bc117e89a01577c497e2fa179",
    "get_debt_position": "4384fc55409fa7e83abb58d1edd609406ee2d36085f5fe3839e36da194480fbf",
    "get_goals": "d504516898d9a2b0cbc4fec716a7d88b89d4b2160a50265ee55226f37a27a2ec",
    "get_insights": "3a6f2039c14cae734953e189a4328f17d54111b25cfdfed1b17acbdc03763796",
    "get_mirror": "62c640cc13425dff91c281793ad8570f1ec4f0858d82ccfed6ca421781cce73e",
    "get_recurring_payments": "e4caca1797c55e0241e0c70d74a473c5ece947dd2c1e51875b00ecfb18117156",
    "get_safe_to_spend": "baaa1f0578aa7c514542cd4e8f2d39c18cef781080f06572eeabcf59ad41e0c6",
    "get_savings_position": "2abe7641269e463cf0a5e5b6b0e95e1acaf0b4766932bd5a39b49e1295dc7de9",
    "get_spend_verdict": "2a8e965e78811fdea43e7b2a8c9a34ff178888e1367add2383fcbf1093200a36",
    "get_tax_position": "2cb73ca7b40a8670724cd6014cb33e60b0c03d09a536976fef57bfaddc1e67f7",
    "get_today_brief": "c1b006e6ee70be2d273bfea5582f4a7ae72fe41411f36370726ee6a4325cacc6",
    "get_upcoming_bills": "924033842d2e0d1cc61b44cc97c3a8fc7864fee85752d3790ea1b7ed12c3bce4",
    "search_transactions": "e011209a2b1d5d7878f3e38fa22a2789451780f36f458899340d05175050bfaa",
}


class _GoldenFakeClient:
    """See module docstring. `expected_tools` is the golden case's own
    declared shape; `self.outcome` starts `"ok"` and is set to
    `"missing_from_catalog:<tool>"` or `"description_changed:<tool>"` the
    moment the REAL catalog sent this round can't honestly justify the
    next expected tool — callers must check `outcome == "ok"` before
    trusting `self.attempted` at all. `self.detail` carries the
    human-readable elaboration (naming the tool and, for a hash mismatch,
    the re-pin command) that assertion messages surface."""

    def __init__(self, expected_tools: list[str]):
        self._expected = expected_tools
        self.calls: list[dict] = []
        self.attempted: list[str] = []
        self.outcome = "ok"
        self.detail = ""

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
            self.detail = (
                f"{tool_name} is missing from the tool catalog run_penny_agent actually sent "
                f"this round (removed, renamed, or gated off by a flag)."
            )
            return _FinalResponse("HEADLINE: n/a\nREPLY: n/a")

        pinned_hash = PINNED_TOOL_DESCRIPTION_HASHES.get(tool_name)
        if pinned_hash is None:
            self.outcome = f"unpinned_tool:{tool_name}"
            self.detail = (
                f"{tool_name} has no entry in PINNED_TOOL_DESCRIPTION_HASHES — add one "
                f"(e.g. via --repin, see module docstring) before this case can run."
            )
            return _FinalResponse("HEADLINE: n/a\nREPLY: n/a")

        live_hash = _description_sha256(fn.get("description") or "")
        variant_builder = ENV_VARIANT_TOOLS.get(tool_name)
        if variant_builder is None:
            # The common case: one fixed description, hashed and compared
            # directly against the pin, exactly as before B42.
            description_ok = live_hash == pinned_hash
            compare_hash = pinned_hash
        else:
            # B42: this tool's description legitimately varies with the
            # process environment (e.g. `explain` and MCP_CONNECTOR_ENABLED).
            # Build both variants EXPLICITLY (never by reading the ambient
            # flag) so this check gives the identical answer regardless of
            # what this process's own environment happens to hold. The
            # live description sent this round must be ONE of the two
            # known-good variants (catches corruption/a swapped
            # description), AND the canonical hash of the pair — driven by
            # the current source code, not by this process's environment —
            # must still match the pin (catches wording drift in either
            # variant).
            true_hash, false_hash, canonical_hash = _canonical_variant_hash(variant_builder)
            description_ok = live_hash in (true_hash, false_hash) and canonical_hash == pinned_hash
            compare_hash = canonical_hash
        if not description_ok:
            self.outcome = f"description_changed:{tool_name}"
            self.detail = (
                f"{tool_name}'s description changed (live sha256 {live_hash[:12]}... != "
                f"pinned {compare_hash[:12]}...). Description changed, re-read the case and "
                f"re-pin with `PYTHONPATH=. .venv/bin/python -m tests.test_penny_golden_eval "
                f"--repin` (run from backend/, review the diff before committing it)."
            )
            return _FinalResponse("HEADLINE: n/a\nREPLY: n/a")

        self.attempted.append(tool_name)
        return _ToolCallResponse(tool_name, call_id=f"call_{round_index + 1}")


def run_case(monkeypatch, question, screen, expected_tools):
    """Drives one golden case through the REAL `run_penny_agent` loop with
    `_GoldenFakeClient` standing in for OpenRouter and a recording stub
    standing in for `execute_tool` (see module docstring's "What this does
    NOT exercise"). Returns the client (for `.outcome`/`.detail`/`.calls`),
    the ordered list of tool names actually dispatched, and the loop's own
    return value."""
    client = _GoldenFakeClient(expected_tools)
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
# expected ordered tool sequence, a `source_quote` (a short substring
# copied VERBATIM from the named inventory file at authoring time — never
# the full question, which is usually a paraphrase, not a quote — see
# `test_golden_set_questions_are_grounded_in_their_named_inventory_file`),
# and a one-line "why" so a future routing change can argue with the case
# rather than just flip it. Every tool in `expected` must have a pinned
# hash in PINNED_TOOL_DESCRIPTION_HASHES above.
#
# Three cases were relabelled during the 2026-09-28 review after their
# original `source` turned out not to actually document the question's own
# concept (the review's gap 2): the Home screen has no subscriptions/
# recurring content of its own (that lives in insights-accounts-mirror.md's
# "PART 4 — SUBSCRIPTIONS / COMMITMENTS / RECURRING"), the cross-screen
# "Can I...?" quick-ask chip is documented on the Penny sheet in
# home-and-penny.md rather than on the Planning screen, and multi-period
# category comparison is spend.md's own "Over time" content rather than
# anything in the Insights tab. Ids keep their original numeric suffix
# where it caused no confusion, appending a fresh number only where the
# file changed, to keep this diff legible rather than renumbering every
# sibling case.

GOLDEN_CASES = [
    # ── docs/penny/question-inventory/home-and-penny.md (8) ─────────────
    dict(
        id="home-01-safe-to-spend",
        source="home-and-penny.md",
        question="How much can I safely spend before payday?",
        screen="home",
        expected=["get_safe_to_spend"],
        source_quote="how much can I spend",
        why="The Home hero's own 'how much can I spend' question, get_safe_to_spend's reason for existing.",
    ),
    dict(
        id="home-02-todays-brief",
        source="home-and-penny.md",
        question="What is Penny suggesting I do today?",
        screen="home",
        expected=["get_today_brief"],
        source_quote="companion items",
        why="A3 (the Brief companion feed) is get_today_brief's own worked example, distinct from get_upcoming_bills' whole-list shape.",
    ),
    dict(
        id="home-03-payday-plan",
        source="home-and-penny.md",
        question="What's my payday plan for this pay period?",
        screen="penny",
        expected=["get_today_brief"],
        source_quote="What is a payday plan?",
        why="'Payday plan' is a Brief item type covered by A3's own worked questions; must not be confused with get_upcoming_bills.",
    ),
    dict(
        id="home-04-safe-then-bills",
        source="home-and-penny.md",
        question="How much can I safely spend, and what bills are coming up before my next payday?",
        screen="home",
        expected=["get_safe_to_spend", "get_upcoming_bills"],
        source_quote="how much can I spend",
        why="A compound ask needing two tools in sequence, the shape most likely to regress if the loop stops after one tool call.",
    ),
    dict(
        id="home-05-account-activity",
        source="home-and-penny.md",
        question="Why did my ISA balance change this week?",
        screen="accounts",
        expected=["get_account_activity"],
        source_quote="Is my ISA counted in net worth?",
        why="A named-account balance-change question is get_account_activity's own worked example, never search_transactions (which cannot match an account name).",
    ),
    dict(
        id="home-06-affordability",
        source="home-and-penny.md",
        question="Can I afford a £2,000 holiday next August?",
        screen="penny",
        expected=["check_affordability"],
        source_quote="Can I spend £45 this weekend?",
        why="check_affordability backs the Penny sheet's own cross-screen 'Ask Penny: Can I spend...' quick ask, not a Planning-page element; relabelled from planning-grow-debt.md in the 2026-09-28 review (gap 2), which never documents an affordability chip.",
    ),
    dict(
        id="home-07-mirror",
        source="home-and-penny.md",
        question="What is the Mirror, and why does it say I'm a weekend spender?",
        screen="penny",
        expected=["get_mirror"],
        source_quote="the Mirror and why does it have opinions about me",
        why="The behavioural-portrait 'why do you say this about me' shape maps to get_mirror, never get_insights (a different kind of tip).",
    ),
    dict(
        id="home-08-tax-position",
        source="home-and-penny.md",
        question="How much of my personal allowance do I have left this tax year?",
        screen="penny",
        expected=["get_tax_position"],
        source_quote="Is this about MY situation or general rules?",
        why="A personal tax figure must ground on the user's own numbers via get_tax_position, never general tax knowledge.",
    ),

    # ── docs/penny/question-inventory/spend.md (9) ──────────────────────
    dict(
        id="spend-01-verdict",
        source="spend.md",
        question="Am I overspending this pay period?",
        screen="spend",
        expected=["get_spend_verdict"],
        source_quote="running high across the board",
        why="The core 'am I overspending' shape get_spend_verdict exists for; its reading sentence must be quoted verbatim.",
    ),
    dict(
        id="spend-02-category-detail",
        source="spend.md",
        question="How much have I spent on Eating Out this period, and where did it go?",
        screen="spend",
        expected=["get_category_spend"],
        source_quote="by single payment or by merchant total",
        why="Category-detail with top merchants is get_category_spend's own worked shape, not the whole-verdict tool.",
    ),
    dict(
        id="spend-03-merchant-search",
        source="spend.md",
        question="How much did I spend at Tesco in April?",
        screen="spend",
        expected=["search_transactions"],
        source_quote="where do I find one specific payment",
        why="A named merchant plus a date range is search_transactions' own worked example; get_category_spend has no merchant/date filter at all.",
    ),
    dict(
        id="spend-04-jargon-moved",
        source="spend.md",
        question="What does 'moved' mean on my Spend page? Why is it shown in green?",
        screen="spend",
        expected=["explain"],
        source_quote='does "moved" mean',
        why="A jargon-definition ask ('what does X mean') routes to explain's registry, never a live-figures tool.",
    ),
    dict(
        id="spend-05-headline-reconcile",
        source="spend.md",
        question="Why doesn't my Out figure match what my bank statement shows?",
        screen="spend",
        expected=["explain"],
        source_quote="different from my bank's",
        why="A headline-number reconciliation ask is explain's registry category, grounded rather than the model guessing an explanation.",
    ),
    dict(
        id="spend-06-advice-shaped",
        source="spend.md",
        question="What's driving my Entertainment spend this period, and how can I cut it?",
        screen="spend",
        expected=["get_category_spend"],
        source_quote="what would make it go away",
        why="The exact motivating bug this rebuild fixed (an advice-shaped spend question) must still ground on get_category_spend's own facts, never a prescriptive answer with no tool call.",
    ),
    dict(
        id="spend-07-prior-period",
        source="spend.md",
        question="Was I over usual on Groceries last pay period?",
        screen="spend",
        expected=["get_spend_verdict"],
        source_quote="Can I still act on last month?",
        why="Same tool as spend-01 but exercises the prior-period argument, a distinct regression surface from the current-period default.",
    ),
    dict(
        id="spend-08-how-do-i",
        source="spend.md",
        question="How do I recategorise a transaction so it always files that way from now on?",
        screen="spend",
        expected=["explain"],
        source_quote="recategorise from there",
        why="An app-action walkthrough ask routes to explain's registry, never a live tool.",
    ),
    dict(
        id="spend-09-multi-month",
        source="spend.md",
        question="How much did I spend on Eating Out over the last 3 months?",
        screen="insights",
        expected=["get_category_spend"],
        source_quote="£X this period · £Y (Z%) more/less than last",
        why="Exercises get_category_spend's `months` argument path; relabelled from insights-accounts-mirror.md in the 2026-09-28 review (gap 2) — multi-period comparison is spend.md's own 'Over time' content, not anything in the Insights tab.",
    ),

    # ── docs/penny/question-inventory/planning-grow-debt.md (7) ─────────
    dict(
        id="plan-01-debt-position",
        source="planning-grow-debt.md",
        question="How much debt do I have across my cards, and how much interest am I paying a month?",
        screen="planning",
        expected=["get_debt_position"],
        source_quote="a month in interest right now",
        why="The core debt-position shape (Planning's debt row) maps directly to get_debt_position.",
    ),
    dict(
        id="plan-02-named-goal",
        source="planning-grow-debt.md",
        question="How is my Japan trip goal progressing?",
        screen="planning",
        expected=["get_goals"],
        source_quote="per pay period slice",
        why="A named-goal progress ask is get_goals' own worked example, distinct from get_savings_position's whole-buffer figure.",
    ),
    dict(
        id="plan-03-savings-buffer",
        source="planning-grow-debt.md",
        question="How much is in my savings buffer, and am I on track for my target?",
        screen="planning",
        expected=["get_savings_position"],
        source_quote="against a 1-month target",
        why="The whole-buffer/target-percent-funded shape is get_savings_position's own reason for existing, distinct from a single named goal.",
    ),
    dict(
        id="plan-05-calculate",
        source="planning-grow-debt.md",
        question="If I paid an extra £50.32 a week off my card for 6 months, roughly how much would that add up to?",
        screen="planning",
        expected=["calculate"],
        source_quote="clears every carried card by",
        why="Multi-step arithmetic the model must never do in its head routes to calculate, restated repeatedly in PENNY_TOOLS.md's own doctrine.",
    ),
    dict(
        id="plan-06-jargon-buffer",
        source="planning-grow-debt.md",
        question="What does 'buffer' mean on the Grow screen?",
        screen="planning",
        expected=["explain"],
        source_quote="Buffer mini readout",
        why="A jargon-term case on Planning/Grow rather than Spend, proving explain routes the same way regardless of which screen asks.",
    ),
    dict(
        id="plan-07-avalanche",
        source="planning-grow-debt.md",
        question="What would it take to clear my most expensive card first?",
        screen="planning",
        expected=["get_debt_position"],
        source_quote="DEAREST CARD FIRST",
        why="The avalanche 'what it would take' agency block still grounds on get_debt_position's own per-card facts, never a model-invented plan.",
    ),
    dict(
        id="plan-08-money-basics",
        source="planning-grow-debt.md",
        question="What is an ISA, and should I use one instead of a regular savings account?",
        screen="planning",
        expected=["explain"],
        source_quote="WHY am I being told about ISA limits?",
        why="General UK money education, not personal to the user, routes to explain's registry rather than get_savings_position.",
    ),

    # ── docs/penny/question-inventory/insights-accounts-mirror.md (6) ───
    dict(
        id="insights-01-best-tip",
        source="insights-accounts-mirror.md",
        question="What's the best money-saving tip you've got for me right now?",
        screen="insights",
        expected=["get_insights"],
        source_quote="start with the top one",
        why="'What's the best insight' is get_insights' own worked example; rank 1 must be reproduced, never re-ranked.",
    ),
    dict(
        id="insights-02-account-balance",
        source="insights-accounts-mirror.md",
        question="Which accounts do I have connected, and what's my Monzo balance?",
        screen="accounts",
        expected=["get_accounts"],
        source_quote="which accounts add up to this number?",
        why="A specific-account-balance ask is get_accounts' own worked shape, and the required first stop before get_account_activity when names collide.",
    ),
    dict(
        id="insights-03-pot-activity",
        source="insights-accounts-mirror.md",
        question="What was the first payment into my Saving Challenge pot?",
        screen="accounts",
        expected=["get_account_activity"],
        source_quote="is this account filed as \"Current\" when it's a savings pot?",
        why="Named-pot activity is get_account_activity's own worked example; the app keeps no other balance-history chart for it.",
    ),
    dict(
        id="insights-04-mirror-aim",
        source="insights-accounts-mirror.md",
        question="What traits has the Mirror picked up about me, and how is my spending aim going?",
        screen="mirror",
        expected=["get_mirror"],
        source_quote="WHAT YOU'RE WORKING ON",
        why="Traits plus aim-progress in one ask, exercising the other half of get_mirror's own description from home-07.",
    ),
    dict(
        id="insights-06-jargon-dormant",
        source="insights-accounts-mirror.md",
        question="What does 'dormant' mean next to one of my accounts?",
        screen="accounts",
        expected=["explain"],
        source_quote='2.12 "Inactive" (dormant) collapsed bucket',
        why="A third jargon-term case, triggered from the Accounts surface, proving explain's routing is screen-agnostic.",
    ),
    dict(
        id="insights-07-recurring",
        source="insights-accounts-mirror.md",
        question="What subscriptions am I paying right now, and when does Netflix renew?",
        screen="home",
        expected=["get_recurring_payments"],
        source_quote="when does this renew",
        why="Naming a specific recurring bill/renewal date is get_recurring_payments' own worked example; relabelled from home-and-penny.md in the 2026-09-28 review (gap 2) — subscriptions/recurring content is documented in this file's own 'PART 4 — SUBSCRIPTIONS / COMMITMENTS / RECURRING', not on the Home screen.",
    ),
]

# Sanity on the golden set's own shape — catches a typo in this file itself
# (a case whose expected tool has no pinned hash, or that is missing its
# own grounding quote) before it ever reaches the harness.
for _case in GOLDEN_CASES:
    for _tool in _case["expected"]:
        assert _tool in PINNED_TOOL_DESCRIPTION_HASHES, f"{_case['id']}: no pinned hash for {_tool}"
    assert _case.get("source_quote"), f"{_case['id']}: missing source_quote"

_SOURCE_COUNTS = {
    "home-and-penny.md": 8, "spend.md": 9, "planning-grow-debt.md": 7,
    "insights-accounts-mirror.md": 6,
}

_INVENTORY_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / "docs" / "penny" / "question-inventory"


def test_golden_set_spread_across_all_four_inventory_files():
    """Guards against the brief's own instruction ('a spread, not 30 from
    one file') silently eroding as cases are added or removed later."""
    counts: dict[str, int] = {}
    for case in GOLDEN_CASES:
        counts[case["source"]] = counts.get(case["source"], 0) + 1
    assert counts == _SOURCE_COUNTS
    assert sum(counts.values()) == len(GOLDEN_CASES)
    assert 28 <= len(GOLDEN_CASES) <= 32


def test_golden_set_questions_are_grounded_in_their_named_inventory_file():
    """B38 review (gap 2): the spread test above only ever compared each
    case's SELF-DECLARED `source` label against a fixed count — it never
    opened a single file in docs/penny/question-inventory/, so relabelling
    a case to the wrong file (or a file that never actually covers the
    question's own concept) silently passed. Each case now carries a
    `source_quote`: a short substring copied VERBATIM from the real
    inventory file at authoring time (never the full `question`, which is
    usually a paraphrase inspired by the file's content, not a literal
    quote from it). This test opens the four real files exactly once and
    asserts every case's quote is actually there, so a genuinely
    mislabelled case — or a quote that bit-rotted after the inventory doc
    was later edited — fails here with the case id named, rather than
    only in a reviewer's head."""
    contents = {
        name: (_INVENTORY_DIR / name).read_text(encoding="utf-8")
        for name in sorted({c["source"] for c in GOLDEN_CASES})
    }
    for case in GOLDEN_CASES:
        assert case["source_quote"] in contents[case["source"]], (
            f"{case['id']}: source_quote {case['source_quote']!r} not found in "
            f"docs/penny/question-inventory/{case['source']} — is `source` labelled correctly?"
        )


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[c["id"] for c in GOLDEN_CASES])
def test_golden_tool_selection(monkeypatch, case):
    client, dispatched, result = run_case(
        monkeypatch, case["question"], case["screen"], case["expected"],
    )
    assert client.outcome == "ok", (
        f"{case['id']} ({case['question']!r}): {client.detail or client.outcome}. "
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
# the eval gate itself would have caught these real regression shapes,
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
    client, dispatched, result = run_case(monkeypatch, case["question"], case["screen"], case["expected"])
    assert client.outcome == "missing_from_catalog:get_safe_to_spend", (
        f"expected the harness to name home-01-safe-to-spend as broken by a missing tool, got {client.outcome!r}"
    )
    assert dispatched != case["expected"]


def test_break_swapped_descriptions_is_caught(monkeypatch):
    """Simulates the item's own named example: two tools' descriptions
    swapped (a plausible copy-paste-during-refactor mistake). plan-05
    (calculate, formerly plan-04's slot before the affordability case moved
    to Home) and plan-01 (get_debt_position) each end up with the wrong
    description attached, so their pinned hash no longer matches."""
    import copy

    mutated = copy.deepcopy(penny_agent_module.TOOL_SCHEMAS)
    by_name = {entry["function"]["name"]: entry["function"] for entry in mutated}
    a, b = by_name["calculate"], by_name["get_debt_position"]
    a["description"], b["description"] = b["description"], a["description"]
    monkeypatch.setattr(penny_agent_module, "TOOL_SCHEMAS", mutated)

    calc_case = next(c for c in GOLDEN_CASES if c["id"] == "plan-05-calculate")
    client, dispatched, _ = run_case(monkeypatch, calc_case["question"], calc_case["screen"], calc_case["expected"])
    assert client.outcome == "description_changed:calculate", (
        f"expected plan-05-calculate to fail on the swapped description, got {client.outcome!r}"
    )
    assert dispatched != calc_case["expected"]

    debt_case = next(c for c in GOLDEN_CASES if c["id"] == "plan-01-debt-position")
    client, dispatched, _ = run_case(monkeypatch, debt_case["question"], debt_case["screen"], debt_case["expected"])
    assert client.outcome == "description_changed:get_debt_position", (
        f"expected plan-01-debt-position to fail on the swapped description, got {client.outcome!r}"
    )
    assert dispatched != debt_case["expected"]


def test_break_description_drift_with_old_anchor_phrase_preserved_is_caught(monkeypatch):
    """The exact false pass an independent review found (2026-09-28, gap
    1): a substring-anchor check cannot tell a genuine drift from a
    description that happens to still contain the anchor phrase. Rewrites
    get_safe_to_spend's live description into unrelated weather-forecast
    copy that DELIBERATELY still contains the phrase this file's old
    anchor-based version keyed on ('how much the user can afford'), proving
    the pinned-hash check catches it where a substring check did not."""
    import copy

    mutated = copy.deepcopy(penny_agent_module.TOOL_SCHEMAS)
    for entry in mutated:
        if entry["function"]["name"] == "get_safe_to_spend":
            entry["function"]["description"] = (
                "Weather forecast for the user's local area: temperature, rain "
                "chance, and wind for today and the next few days. (Keeps the "
                "phrase 'how much the user can afford' only to prove an old "
                "substring-anchor check would have missed this drift.)"
            )
    monkeypatch.setattr(penny_agent_module, "TOOL_SCHEMAS", mutated)

    case = next(c for c in GOLDEN_CASES if c["id"] == "home-01-safe-to-spend")
    client, dispatched, _ = run_case(monkeypatch, case["question"], case["screen"], case["expected"])
    assert client.outcome == "description_changed:get_safe_to_spend", (
        f"expected the pinned-hash check to catch a drifted description even though it still "
        f"contains the old anchor phrase, got {client.outcome!r}"
    )
    assert dispatched != case["expected"]


# ── B42: proving the pin is flag-independent but still catches drift ──────
#
# B38's pin for `explain` was captured in whatever single environment state
# the authoring process happened to hold, so the golden set passed in a
# worktree (MCP_CONNECTOR_ENABLED unset) and failed wherever
# backend/.env sets it true — every integrate pass, since integrate runs
# the suite in the shared tree. These tests prove the fix directly at the
# level the regression actually showed up: running the real golden cases
# with `penny_tools_module.MCP_CONNECTOR_ENABLED` forced both ways.

_EXPLAIN_CASES = [c for c in GOLDEN_CASES if c["expected"] == ["explain"]]


@pytest.mark.parametrize("connector_enabled", [True, False], ids=["connector-on", "connector-off"])
def test_golden_explain_cases_pass_regardless_of_connector_flag(monkeypatch, connector_enabled):
    """The exact regression this item fixes: before B42, one of these two
    parametrisations failed on every single explain case (whichever state
    didn't match the pin's authoring environment) with
    `description_changed:explain`, even though the description had not
    drifted at all — see test_golden_tool_selection[spend-04-jargon-moved]
    in the failure this file's docstring section quotes."""
    monkeypatch.setattr(penny_tools_module, "MCP_CONNECTOR_ENABLED", connector_enabled)
    assert _EXPLAIN_CASES, "no golden case expects exactly ['explain'] — update this test's filter"
    for case in _EXPLAIN_CASES:
        client, dispatched, result = run_case(
            monkeypatch, case["question"], case["screen"], case["expected"],
        )
        assert client.outcome == "ok", (
            f"{case['id']} ({case['question']!r}) failed with MCP_CONNECTOR_ENABLED="
            f"{connector_enabled}: {client.detail or client.outcome}"
        )
        assert dispatched == case["expected"]
        assert result is not None


@pytest.mark.parametrize("connector_enabled", [True, False], ids=["connector-on", "connector-off"])
def test_break_explain_wording_drift_is_caught_regardless_of_connector_flag(monkeypatch, connector_enabled):
    """Canonicalising the pin across both flag states must not blind the
    harness to a genuine wording change in either variant — mutates the
    live `explain` description (whichever text the process's own flag
    state produces) and proves the harness still reports
    `description_changed:explain`, in BOTH flag states, not just the one
    that happened to author the pin."""
    import copy

    mutated = copy.deepcopy(penny_agent_module.TOOL_SCHEMAS)
    for entry in mutated:
        if entry["function"]["name"] == "explain":
            entry["function"]["description"] = entry["function"]["description"] + " (drifted)"
    monkeypatch.setattr(penny_agent_module, "TOOL_SCHEMAS", mutated)
    monkeypatch.setattr(penny_tools_module, "MCP_CONNECTOR_ENABLED", connector_enabled)

    case = _EXPLAIN_CASES[0]
    client, dispatched, _ = run_case(monkeypatch, case["question"], case["screen"], case["expected"])
    assert client.outcome == "description_changed:explain", (
        f"expected drifted explain wording to be caught with MCP_CONNECTOR_ENABLED="
        f"{connector_enabled}, got {client.outcome!r}"
    )
    assert dispatched != case["expected"]


def test_explain_variants_differ_by_connector_flag():
    """Sanity check on the canonicalisation itself: the two variants this
    file pins together must actually be different texts (otherwise
    canonicalising them would be a no-op that happened to look correct).
    If this ever fails, MCP_CONNECTOR_ENABLED stopped affecting `explain`'s
    description and ENV_VARIANT_TOOLS['explain'] should be removed instead."""
    true_text = penny_tools_module._explain_tool_description(True)
    false_text = penny_tools_module._explain_tool_description(False)
    assert true_text != false_text
    assert "mcp_connector" in true_text
    assert "mcp_connector" not in false_text


def test_env_variant_pin_matches_freshly_computed_canonical_hash():
    """Direct unit check that PINNED_TOOL_DESCRIPTION_HASHES['explain'] is
    genuinely the canonical (flag-independent) hash `_canonical_variant_hash`
    computes today, decoupled from the full run_penny_agent machinery
    `test_golden_explain_cases_pass_regardless_of_connector_flag` exercises."""
    for tool_name, builder in ENV_VARIANT_TOOLS.items():
        _, _, canonical_hash = _canonical_variant_hash(builder)
        assert PINNED_TOOL_DESCRIPTION_HASHES.get(tool_name) == canonical_hash, (
            f"{tool_name}'s pin is stale — re-pin with `PYTHONPATH=. .venv/bin/python "
            f"-m tests.test_penny_golden_eval --repin` (run from backend/)."
        )


def test_no_flag_dependent_description_builder_missing_from_env_variant_registry():
    """Guards ENV_VARIANT_TOOLS (the flag-independent canonicalisation
    registry above) against silently going stale. B42's root cause was one
    description builder (`_explain_tool_description`) reading an
    environment flag at call time with nothing in this file accounting for
    it — if a FUTURE tool description gains the same shape (reads
    MCP_CONNECTOR_ENABLED, another os.environ/os.getenv value, or a
    `settings.` attribute inside a `_..._description` builder function) and
    nobody adds it to ENV_VARIANT_TOOLS, its pin would go right back to
    being silently environment-dependent, exactly the B42 bug, and this
    test would be the only thing to catch that before another integrate
    pass did."""
    import inspect
    import re

    source = inspect.getsource(penny_tools_module)
    builder_pattern = re.compile(r"^def (_\w*description\w*)\(", re.MULTILINE)
    env_markers = ("MCP_CONNECTOR_ENABLED", "os.environ", "os.getenv", "settings.")
    flagged = set()
    for match in builder_pattern.finditer(source):
        name = match.group(1)
        func = getattr(penny_tools_module, name, None)
        if func is None:
            continue
        body = inspect.getsource(func)
        if any(marker in body for marker in env_markers):
            flagged.add(name)
    registered_builder_names = {
        getattr(builder, "__name__", None) for builder in ENV_VARIANT_TOOLS.values()
    }
    assert flagged == registered_builder_names, (
        f"description builder(s) read an environment-derived value with no matching "
        f"entry in ENV_VARIANT_TOOLS: {flagged - registered_builder_names}. Add a "
        f"canonicalisation entry (see ENV_VARIANT_TOOLS above) before pinning, or this "
        f"pin will again be environment-dependent (B42)."
    )


# ── --repin: refresh the pinned hashes after an intentional edit ──────────
#
# Runnable directly (not via pytest): from backend/, with app.services.
# penny_tools importable —
#     PYTHONPATH=. .venv/bin/python -m tests.test_penny_golden_eval --repin
# Rewrites PINNED_TOOL_DESCRIPTION_HASHES above in place; review the diff
# before committing it.

def _live_hashes_for(tool_names):
    from app.services.penny_tools import PROPOSE_TOOL_SCHEMAS, TOOL_SCHEMAS

    catalog = {
        entry["function"]["name"]: entry["function"]["description"]
        for entry in TOOL_SCHEMAS + PROPOSE_TOOL_SCHEMAS
    }
    # B42: an env-variant tool (see ENV_VARIANT_TOOLS) is repinned from its
    # own explicit True/False builder, never from whatever single variant
    # happens to be baked into the live catalog this process imported —
    # that catalog entry reflects only THIS process's ambient
    # MCP_CONNECTOR_ENABLED, exactly the dependency B42 removed from the pin.
    missing = [
        name for name in tool_names
        if name not in catalog and name not in ENV_VARIANT_TOOLS
    ]
    if missing:
        raise SystemExit(f"--repin: tool(s) no longer exist in the catalog: {missing}")
    hashes = {}
    for name in tool_names:
        variant_builder = ENV_VARIANT_TOOLS.get(name)
        if variant_builder is None:
            hashes[name] = _description_sha256(catalog[name])
        else:
            _, _, canonical_hash = _canonical_variant_hash(variant_builder)
            hashes[name] = canonical_hash
    return hashes


def _repin(path=None):
    """Rewrites this file's own `PINNED_TOOL_DESCRIPTION_HASHES` dict in
    place with freshly computed hashes for every tool name already a key
    in it — never adds or removes a key, so a brand new golden case still
    needs one hand-added entry, the same as authoring the case itself.
    Returns `{tool_name: new_hash}` for every hash that actually changed."""
    target = pathlib.Path(path or __file__)
    old = dict(PINNED_TOOL_DESCRIPTION_HASHES)
    new = _live_hashes_for(sorted(old))

    lines = ["PINNED_TOOL_DESCRIPTION_HASHES = {\n"]
    for name in sorted(new):
        lines.append(f'    "{name}": "{new[name]}",\n')
    lines.append("}\n")
    block = "".join(lines)

    src = target.read_text(encoding="utf-8")
    start_marker = "PINNED_TOOL_DESCRIPTION_HASHES = {\n"
    start = src.index(start_marker)
    end = src.index("\n}\n", start) + len("\n}\n")
    target.write_text(src[:start] + block + src[end:], encoding="utf-8")

    return {name: new[name] for name in new if new[name] != old.get(name)}


if __name__ == "__main__":
    if "--repin" in sys.argv:
        _changed = _repin()
        if _changed:
            print(f"re-pinned {len(_changed)} tool description hash(es): {sorted(_changed)}")
        else:
            print("no descriptions changed, nothing to re-pin")
    else:
        print(
            "usage: PYTHONPATH=. .venv/bin/python -m tests.test_penny_golden_eval --repin\n"
            "(run from backend/; review the diff before committing it)"
        )
