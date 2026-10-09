# G243 results (2026-10-08): Penny treated a category as a merchant, plus a tool-loop model comparison

Synthetic fixtures only (invented figures, a made-up user, a scratch `wealth_test_*` database dropped through the guarded path). Kevin's UAT data was read once, read-only, to confirm the trace. Raw per-run JSON lives under `/tmp/g243/` (not committed).

## Part A: the cause and the fix

### Trace (Kevin, 2026-10-08 20:44 UTC)

B38 persists a per-round tool trace on the `llm_usage` doc (`message_id`, `round`, `tools_called` as names only, `model`). For Kevin's user the turn at 2026-10-08 20:44 is a two-round message: round 1 `tools_called: ['search_transactions']` (18,232 prompt tokens), round 2 a plain answer. So the model did choose `search_transactions`, not `get_category_spend`, which confirms the report.

What the trace cannot say: tool arguments are deliberately not stored. Read-only counts for Kevin's user: Padel is one of four custom categories (Golf, Padel, Business, Family); 11 transactions carry `custom_category = "Padel"`, none in the other two bank collections; zero rows match "Padel" in description, merchant name or merchant key. The pre-fix `q` parameter also regex-matches category and custom category, so a `q="Padel"` call would have found all 11. The empty answer therefore came from a call that used `merchants="Padel"` (description and merchant fields only) or an equivalent narrowing. That is inferred, not recorded. Suggestion, not done: persist argument keys (not values) in the trace so the next routing bug is provable.

Root cause: the model was never told the user's categories, `get_category_spend` took an "exact category name" that only the model's guess could supply, and `search_transactions` had no category fallback.

### Fix (commit 7c5b0627, on top of the G241 merge 9fad9b1e, merged cleanly with no conflicts)

- `categories.resolve_category_name` (pure): case and whitespace insensitive, trailing-s tolerant, exact not substring ("Padel Club" does not resolve). It runs over `get_category_kinds`, the same built-in plus custom map the Spend page's kind logic uses. Nothing hardcodes "Padel".
- `get_category_spend` resolves the name before use, so "padel" works; a name that is no category returns `category_recognised: false`, a note pointing to `search_transactions`, and the category list (capped at 30), so a zero reads as "no such category".
- `search_transactions` reports `match_kind` (`text`, `category`, `filters`). When the text names one of the user's categories and the merchant-only match finds nothing, it falls back to that category (`matched_category`, `match_note`), so the model can say "your Padel category", not "payments to Padel". A `category` argument is resolved case-insensitively.
- Prompt: rule 17 in the uncached system block lists the user's categories (custom first, marked), capped at 40 names of 30 characters, control characters stripped. For Kevin's 25 categories it is about 600 characters, roughly 150 tokens per round, about $0.00015 per round at Haiku 4.5 input rates. It sits after the cache breakpoint, so the cached prefix is unaffected. The two tool descriptions changed, so their golden hashes were re-pinned (the cached tool prefix is rewritten once).
- Golden row `spend-09-custom-category-total` (expects `get_category_spend`), and `tests/test_penny_category_routing.py` executes the tools against a synthetic custom category with 11 transactions (ten of 18.50 and one of 40.00): total 225.00, 11 payments, via both `get_category_spend` and the search fallback.
- Offline tests: 9 new routing tests, 4 corpus tests, the golden eval, `test_no_raw_exception_leak` (its line-number allowlist moved by 68 lines), the PENNY_TOOLS-referencing suites (686 passed), `check_naive_dates` ok. PENNY_TOOLS.md rows updated.

## Part B: model comparison of the tool loop

### Method and honesty about sample size

- Harness: `backend/scripts/penny_model_eval.py` (imports G241's `penny_live_eval.py` for scratch-DB and key handling). The real `run_penny_agent` loop, system prompt, tool catalogue, `calculate` and `explain`; other tools answer from fixtures. 33 questions: G241's 19 live rows (17 arithmetic, 2 controls) plus 14 routing rows in `tests/penny_routing_corpus.py`, each with one correct first tool (category spend including Padel and Golf as custom categories, merchant search, goals, bills, safe to spend, explain, calculator, accounts, affordability, prior period).
- Production payload unchanged (`max_tokens` 500, temperature 0, `tool_choice` auto) with only `model` swapped. Every request carries `provider.data_collection = deny` (merged by `openrouter_chat`). One run per model, so a difference of one or two questions is noise. The fixtures are small and generous (tools always return clean data), so absolute accuracy is flattering; only the ordering and the failure kinds mean anything.
- Spend guards: estimate printed before each run, refuse without `--limit` or `--confirm-full-run`, refuse above `--budget-usd` or above 3 USD, stop when actual `usage.cost` reaches the budget. The estimate assumes no prompt caching ($1.63 for Haiku 4.5) and the actual runs cost far less because the 33 questions ran back to back on a warm cache.
- Scoring: "routing tool" is the first tool called on the 14 routing rows (one correct tool each). "Answer" is the expected figure present in the reply (all 33; a refusal of a question that should be answered is wrong; the weather control must be declined; the advice control may be declined). G241 rows are not scored for tool strictness here because several have more than one defensible route (for example `check_affordability` for "if I spend 40 what is left" gives the right figure).
- Proof first (`--limit 3`, Padel plus a literal sum plus a goal question): all six models called tools and finished the loop, so none was marked "cannot run the loop".

### Per-model results

The saved run JSONs were rescored with `--rescore` after the advice control (ctl-02) was reclassified as an acceptable decline.

| model | routing tool correct | answers correct | wrongful refusals | median / p95 latency | cost per question (warm cache) | run total | served model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-haiku-4-5 (current) | 13/14 | 30/33 | 1 | 3.8 / 6.6 s | $0.0057 | $0.187 | anthropic/claude-haiku-4.5 on all 33 |
| anthropic/claude-haiku-5.5 | 13/14 | 33/33 | 0 | 3.8 / 8.2 s | $0.0008 | $0.028 | anthropic/claude-haiku-5.5 on all 33 |
| google/gemini-3.8-flash | 14/14 | 32/33 | 1 | 7.0 / 15.8 s | $0.0044 | $0.145 | google/gemini-3.8-flash on all 33 |
| google/gemini-3.5-flash-lite | 12/14 | 29/33 | 1 | 2.5 / 5.5 s | $0.0012 | $0.040 | google/gemini-3.5-flash-lite on all 33 |
| openrouter/auto | 13/14 | 32/33 | 0 | 5.9 / 21.0 s | $0.0026 | $0.085 | five models: gemini-2.5-flash 9, gpt-6-luna 9, deepseek-v4.1-flash 10, deepseek-v4-flash-0731 2, glm-5.3-flash 4 |
| typesafe/jev-router | 10/14 | 24/33 | 9 | 10.0 / 15.0 s | $0.0043 | $0.141 | gemini-3.8-flash 24, gpt-6-luna 8, deepseek-v4.1-flash 5 |
| typesafe/jev-router, `reasoning.effort = none` | 9/14 | 21/33 | 11 | 10.3 / 20.9 s | $0.0046 | $0.153 | gemini-3.8-flash 25, gpt-6-luna 8, deepseek-v4.1-flash 1 |

Cold-cache note: production's own trace shows a Haiku 4.5 question costing about $0.026 when round 1 misses the cache ($0.0232 for the 18k-token round, then $0.0027), against $0.0057 averaged here. Scale the cost column accordingly; the ordering holds, and Haiku 5.5 is about a tenth of Haiku 4.5 on price either way.

What the misses were:

- Haiku 4.5: refused "Split 243 between three people" (the G241 out-of-scope rule 5 still bites this phrasing on the current model); answered "save 200 a month for 6 months" without the savings balance and the goal-date projection with the wrong date.
- Haiku 5.5: no wrong answers; two answers took a different first tool (`check_affordability` for a what-is-left sum, `get_debt_position` before `get_accounts` for a card balance) and still got the figure.
- Gemini 3.8 flash: every routing row correct; refused the goal-date projection; slowest of the direct models (p95 15.8 s, three rounds on average 2.5).
- Gemini 3.5 flash lite: fastest and cheap, but wrong figures on three arithmetic rows and a refusal.
- openrouter/auto: good accuracy, but five different upstream models in 33 questions and a p95 of 21 s; picked `get_debt_position` for the card balance and got it wrong.
- typesafe/jev-router: calls tools, but in 9 of 33 questions the served reasoning model spent the 500-token cap on hidden thinking (`finish_reason = length`, empty content, 470 to 780 completion tokens) and the loop returned a refusal. Sending `reasoning.effort = none` did not help (11). So it can start the loop but cannot finish it at the production token cap; no full-fidelity result is possible without raising `max_tokens`, which changes the production payload and cost. As in G239, "Jev" on OpenRouter is a router over general models (mostly Gemini 3.8 flash here), not TypeSafe's own model.

### The Padel question

| model | before the fix (pre-fix code, Haiku 4.5 only) | after the fix |
| --- | --- | --- |
| anthropic/claude-haiku-4-5 | `search_transactions` on both of 2 runs, answer wrong (no Padel found), matching Kevin's trace | `get_category_spend`, correct (225) |
| the other five | not run pre-fix (cost) | `get_category_spend`, correct (225), including the router-served openrouter/auto (gpt-6-luna) and jev (gemini-3.8-flash) |

The pre-fix run used the commit before the fix with a fixture whose merchant-text search finds nothing (as Kevin saw) and no category list in the prompt. It reproduces the wrong-tool choice on the current model twice in two runs; with n=2 it shows the failure is easy to trigger, not its rate. After the fix, one run per model, all six chose the category tool; the prompt list and the descriptions are doing the work, since the fixture only covers the search fallback.

## Data-policy facts (as G239 recorded them)

- `GET /api/v1/models` has no data-policy, retention or training field for any of the six. `/models/{id}/endpoints` lists upstream providers only: Haiku 4.5 (Anthropic, Amazon Bedrock, Azure, Google), Haiku 5.5 (those plus Claude Platform on AWS), both Gemini models (Google, Google AI Studio); `openrouter/auto` and `typesafe/jev-router` list no endpoints (virtual routers).
- Every request carried `provider.data_collection = deny` and all six returned HTTP 200, so a deny-compatible upstream existed at run time. For the two routers the deny filter constrains the upstream choice per call; the served model changed within a run (up to five models), the upstream provider was not recorded, only the served model per row.
- Not verified: OpenRouter account-level privacy toggles, and what any upstream retains.
- `hyphen` id: `anthropic/claude-haiku-4-5` (production's `_MODEL`) is not in `/models` but resolves to `anthropic/claude-haiku-4.5`, as G239 found.

## Spend

Proofs $0.083, the pre-fix Padel runs $0.031, six full runs $0.626, Jev with reasoning off $0.153: total about $0.89 of the roughly $10 budget. No single-model estimate exceeded $3 (largest $1.63, conservative uncached).

## Recommendation

1. Part A is the fix that matters and is model independent; ship it regardless of model.
2. Keep Haiku 4.5 for now. Nothing here is strong enough to justify a switch on one 33-question run.
3. Haiku 5.5 is the one worth a real trial: best answers here (33/33, no refusals), the same median latency, and about a tenth of the cost per question. Trial it behind a flag on a larger and harder set (real-shaped multi-tool questions, cold cache, the cost trace in `llm_usage`) before changing `_MODEL`; its categorisation result in G239 was weaker, but that is a different task.
4. Gemini 3.8 flash: no-go as the default (best routing, but about twice the p95 latency and extra rounds). Gemini 3.5 flash lite: no-go (fastest and cheap, wrong figures on three rows). openrouter/auto: no-go (unstable upstream, p95 21 s, one wrong tool). typesafe/jev-router: no-go (cannot finish the loop at the production token cap; it did start it).

## Not done

No tool arguments are persisted, so Kevin's exact call is inferred. Only Haiku 4.5 was run pre-fix. One run per model; no repeats to measure variance. Fixtures are clean and small; real tool payloads are larger and noisier.
