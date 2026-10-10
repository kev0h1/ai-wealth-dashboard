# G246: removing the life simulator ("what if" scenario cards)

Kevin, 2026-10-09: the simulator no longer makes sense. Penny answers what-if
questions inline, with factual worked answers and no recommendations (G245
adds the growth calculator; G241's `calculate` and the read tools do the
rest). Capability boundary, Kevin's words: Penny may give factual information
and calculations, but never "invest in this" or "do this".

## What the simulator was

`POST /can-i` ran `looks_like_scenario` (a deterministic regex gate) BEFORE the
tool loop. A match skipped the model, extracted slots with one LLM call
(`parse_question`), and returned `{"scenario": true, "items": [...]}`. The
frontend rendered that as the "Here's what I understood" confirm card;
"Run it" pushed to `/scenario?items=...`, which called `POST /scenario/run`
(`services/scenario.simulate`, plus an LLM headline) and drew cash, debt, plans
and grow blocks. Nothing was ever written to Mongo by the simulator: it read
`savings_goals_col` and the shared cashflow and debt-plan caches only.

## Inventory (every use found by `git grep -i scenario`), keep or delete

### Backend, delete

| File | What it does | Decision |
| --- | --- | --- |
| `app/routers/scenario.py` (739 lines) | `looks_like_scenario`, `parse_question`, `/scenario/parse`, `/scenario/run`, lumpy headline composer | DELETE |
| `app/services/scenario.py` (907 lines) | `simulate`, `normalise_items`, cash/debt/plans/grow/absorb blocks | DELETE |
| `app/main.py` lines 51, 113 | imports and registers `scenario.router` | DELETE the registration |
| `app/routers/can_i.py` | imports `looks_like_scenario, parse_question`; "5. Scenario short-circuit" returning `scenario: true` | DELETE the import, the branch and its comments |
| `app/services/penny_agent.py` lines 3, 99 | docstring and budget-history comments naming the gate | EDIT the comments (gate no longer exists) |
| `app/services/penny_tools.py` line 11, 3780 | comments naming the scenario gate and `_build_cash_block` | EDIT |
| `app/services/penny_tools.py` `_NUMBERS_COPY["month_end_cash"]` (+ `explain` description list, `test_penny_tools.py` topic list) | explainer for the simulator's "month-end cash" figure, which only the /scenario page showed | DELETE the topic (the `explain` description changes, repinned) |
| `app/services/copy_style.py` line 25 | comment citing scenario.py's headline call as the origin of the currency guardrail | KEEP the helper, EDIT the comment only. `house_style` is shared by can_i, penny and others |
| `scripts/check_naive_dates.py` allowlist entries for both scenario files | per-file allowlist | DELETE the two entries |
| `backend/manual_scenario_check.py` (419 lines) | hand-run in-process check of `/scenario/*` | DELETE |
| `app/services/debt_plan.py` `scenario_b`, `_compute_scenario_b`; `penny_tools` `get_debt_position.scenario_b`; `test_penny_tools.py` scenario_b assertions | the debt planner's alternative (avalanche) plan: a different concept that shares only a word | KEEP unchanged (one stale comment at `debt_plan.py:1847` naming `app.services.scenario` as a consumer is EDITED) |
| `app/core/llm.py` | `pipeline` is a free-text label; no list of pipelines includes "scenario" | nothing to change |

### Backend tests

| File | Decision |
| --- | --- |
| `tests/test_scenario.py`, `tests/test_scenario_routing.py` | DELETE (they test only deleted code) |
| `tests/test_can_i.py` lines 271-277 (`looks_like_scenario` hook exists) | DELETE that test, header comment edited |
| `tests/test_penny_agent.py` ~1452 (Monzo budget regression asserts `not looks_like_scenario`) | KEEP the test, DROP the `looks_like_scenario` assertion (the question must still reach the tool loop); header comments edited |
| `tests/test_penny_tools.py` `month_end_cash` in the explain topic list | EDIT |
| `tests/test_llm_meter.py`, `test_llm_global_ceiling.py`, `test_admin_llm_usage.py` use `pipeline="scenario"` | KEEP: an arbitrary metering label in fixtures, not the simulator |
| ~30 other test files containing the word | KEEP: ordinary English ("the scenario this test is about"), or `_run_trim_scenario` style helpers. Checked line by line |

### Frontend

| File | What it does | Decision |
| --- | --- | --- |
| `app/scenario/page.tsx`, `ScenarioPage.tsx` | the `/scenario` page | DELETE |
| `components/PennyConversation.tsx` | `ScenarioMsg`, `ScenarioConfirmCard`, "Here's what I understood", "Run it" (`runScenario` pushes `/scenario?items=`), CADENCE options, draft helpers, the `res.scenario` branch in the answer handler | DELETE the card path; keep every other message kind and the shared `PennyProposal`/consent cards |
| `lib/api.ts` | `ScenarioItem` and `Scenario*Block` types, `ScenarioRunResponse`, `scenarioRun`; `CanIResponse.{scenario,items,rejected,prefilled,clarify}` | DELETE |
| `components/PennySheet.tsx` line 470, `components/Sidebar.tsx` line 27 | comments naming `ScenarioPage` | EDIT comments |
| `lib/comingUp.tsx`, `lib/preferencesSnapshot.ts` | the word in ordinary prose ("one sentence per scenario", "reconcile scenarios") | KEEP unchanged: unrelated vocabulary |
| `app/design/g100-scenario-canvas/` (+ `app/design/page.tsx` entry at ~545) | G100 design preview of the /scenario canvas | DELETE and drop the index entry |
| `app/design/g176-*`, `g124-upcoming-refine`, `cards-page`, `planning-ladder-timeline`, `home-brief-cards` fixtures and clients | `SCENARIOS` / `?state=` are preview example states | KEEP: unrelated vocabulary, checked each |
| `scripts/*.test.mjs` containing "scenario" (g176, g187, coming-up-dates, preferences-snapshot, scroll-nav-detect, serial-queue, build-mobile-guard, manual/g45) | test prose and fixture names | KEEP: unrelated |
| Links: `git grep` for `/scenario`, `scenarioRun`, `href`/`router.push` | only `PennyConversation.runScenario`; no nav, sidebar, tour or deep-link entry | nothing else to remove |

### Docs

| File | Decision |
| --- | --- |
| `PENNY_TOOLS.md` | there was never a scenario TOOL (the gate ran before the loop); remove the gate mentions (lines ~500, 601, 648), add a removal note |
| `DESIGN.md`, `PRODUCT.md` | no scenario bullets exist in either (searched); nothing to remove. The surface map in `CLAUDE.md` does not list it |
| `docs/penny/question-inventory/home-and-penny.md` B8, `planning-grow-debt.md` G1/G2 and route table row, `docs/penny/action-inventory.md` row 223 | mark REMOVED by G246; what-if rows now answered inline |
| `docs/design/H113-preview-inventory.md` | note that `g100-scenario-canvas` was removed with the page it designed |
| `docs/security/*`, `docs/mobile-porting/11-debt-plan.md`, `docs/pricing/*` | pentest records and the debt plan's scenario B: unrelated or historical, KEEP |
| `TODO.md` | board history, never edited by hand |
| Memory "Life simulator" (`/root/.claude/...`) | outside the repo; the coordinator marks it removed |

### Stored data

The simulator persisted nothing of its own (no collection, no cache name).
`backend/scripts/archive_scenarios.py` counts three possible traces and deletes
nothing unless run with `--apply --yes --user <email>`: collections whose name
contains "scenario", `response_cache` names containing "scenario", and
`llm_usage` rows with `pipeline == "scenario"` (cost/audit metering, deleted
only with `--include-usage-rows`). Count mode against this host's database on
2026-10-09: no scenario-named collection, 0 response_cache documents, 13
`llm_usage` rows across 2 users (metering history, retained). It was not run
with `--apply`.

## Questions the simulator used to catch, and where they go now

Added to the golden corpus (`backend/tests/penny_arithmetic_corpus.py`) before
any deletion, each with its deterministic tool path and an inline answer shape:

| Question | Path | Inline answer |
| --- | --- | --- |
| "if I move £825 from Monzo, how much will be left" | `get_accounts` then `calculate` (balance minus 825) | the remaining balance with the working, no card |
| "if I spend £40 today what is left" | `get_safe_to_spend` then `calculate` | what is left of Safe to Spend, working shown |
| "what if my rent goes up by £100" | `get_upcoming_bills` then `calculate` (rent plus 100) | the new monthly figure, hedged as an estimate |
| "what would happen if I contribute £300 a month at an interest of 6.5%" | `calculate` with `growth` (G245) | future value, paid in, growth, hedged, longer periods offered |
| "if I save £200 a month, how much will my savings be in 6 months" | `get_accounts` then `calculate` with `growth` and `starting_balance` | balance plus contributions |

Not carried over, deliberately: multi-item projections over 24 months
(cash, debt-free date and plan feasibility together). Penny now answers the
single figure asked, from live numbers, and does not model a change to the
user's standing finances as a card.
