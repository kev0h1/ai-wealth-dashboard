# G459: Penny conversation audit, multi-turn eval set and model comparison (2026-11-12)

Nothing in this item changes the model, the prompts or the tools. Every fix below is a proposed ticket. All figures in committed files are invented (synthetic user, invented banks and amounts); the UAT extracts used for Part 1 live only under `/tmp/g459/` and are not committed.

## 1. What was read, and how much there is

| Source | Scope | Size |
| --- | --- | --- |
| `penny_conversations` (UAT, the owner's account only) | stored chat text | **1 conversation**, 5 user and 5 assistant turns. Conversations expire after 7 days (PRIVACY.md chat-session row) and the owner's 2026-11-12 production thread is on production, which this item does not read. |
| `llm_usage`, `pipeline = penny` (UAT, same user) | model, tokens, cost, latency, `tools_called` names per round | 255 rounds, 130 messages (2026-09-06 to 2026-11-06). Tool names exist only from B38 (2026-10-02): **208 rounds, 105 messages** carry them. |
| The owner's production challenge thread | the failure list in the first G459 board note | 1 thread, used as the anchor case. |

The read was a single script using only `count_documents` and `find` on a plain `pymongo` client (no app imports, so no write path), filtered on one `user_id`, URI never printed. Raw extracts: `/tmp/g459/convs.json`, `/tmp/g459/usage.json`.

Honest limit: stored text is one conversation. The trace gives breadth (105 messages) but only tool names, never arguments, results or reply text, so it supports pattern counts, not per-reply grading. Reply-level grading is therefore done on the eval set, which is the reason it exists.

Rubric used (codes are this report's own; the board notes name the five classes but not sub-codes):

- Grounding: G1 a claim about state no tool result shows; G2 a figure no tool or the user supplied; G3 parameters the user never gave, used in a proposal; G4 an action reported as done while only proposed; G5 a degraded or partial figure stated flat.
- Context: C1 text lost to the 300-character history cut; C2 a short reply ("Yes") that loses its referent; C3 re-asking something already given; C4 tool results or earlier figures not carried.
- Tools: T1 no tool exists for the request; T2 wrong tool; T3 arguments the tool does not define; T4 redundant calls; T5 a money answer given without a data tool.
- Arithmetic: A1 sums or projections without `calculate` or the schedule engine; A2 wrong inputs to either.
- Needless questions: Q1 asking for something fetchable or already given; Q2 an open menu when the intent is clear.

## 2. Part 1 counts (anonymised)

### 2a. The one stored UAT conversation (5 assistant turns)

| Class | Count | Paraphrased example |
| --- | --- | --- |
| Grounding | 1 probable (G3), 1 possible (G4) | The user answered "all of them" to a menu of card payment fields without giving a single value; the next turn proposed a payment method and paying account anyway. Two turns later Penny wrote that the card "is now set" to a named account while the change was still a proposal card (whether the user had tapped confirm in between cannot be seen). |
| Context | 1 (C1) | An assistant turn of about 460 characters ended with its question at character 430; history keeps 300, so the question the user was answering is not in the next request. |
| Tools | 0 clear; 1 tool-output gap | The proposal card text said "paying account changed" without naming the account, and the user had to ask which. |
| Arithmetic | 0 | none in this thread |
| Needless questions | 1 (Q2, mild) | After the card was chosen, Penny listed four editable fields as an open question instead of asking only for the missing values. |

### 2b. The owner's production thread (board note, not re-read)

One failure in each class in four turns: arithmetic (first amount one step too high and a total a few pounds high in a 4p-a-day challenge, A1/A2), context (a bare "Yes" to a pot question that sat at the end of a long reply, so Penny asked which pot again, C1+C2+Q1), tools (asked to track a payment out of a pot, no tool covers it, Penny reached for a credit-in set-aside and asked for an incoming payment, T1/T2+Q1), grounding (claimed the goal "already tracks" the payments while the screen said it did not, G1).

### 2c. Rule checks on the 105-message tool trace (no reply text, so patterns only)

| Pattern | Count | Reading |
| --- | --- | --- |
| Format-repair round (2 or more rounds, no tool called in any) | 8 of 105 (7.6%) | The model answered outside the headline/reply shape and the loop spent a second paid round restating it. |
| Answered with no data tool (1 round, no tool) | 5 of 105 (4.8%) | Not all wrong (greetings, explainers); T5 cannot be confirmed without text. |
| Same tool called twice in one message | 3 of 105 (2.9%) | T4. |
| Three or more rounds | 12 of 105 (11.4%) | Tool chaining; one hit the 4-round cap (`plan_consolidation`, `get_accounts`, `plan_consolidation`). |
| Proposal churn | 9 `propose_create_scheduled_goal` calls across two threads on one evening, 7 of them within about three minutes | Consistent with a goal draft being re-proposed because the thread lost it (C4); the text is gone, so this is an inference. |
| Messages ending in a proposal | 23 of 105 (22%), 10 of them in one round | Proposal tools are a large share of use. |
| Cost, latency, tokens (Haiku 4.5, all 105) | mean $0.0145 per message, p95 $0.035; latency p50 4.6 s, p95 7.5 s; mean 23.3k prompt tokens per round, 80% cached; 29 of 208 rounds fully cold | The 71-tool catalogue is most of the prompt. |
| Completion length | max 320 tokens, p95 228 | `max_tokens` 500 is never hit by Haiku 4.5 in production. |

## 3. The eval set

Location: `backend/tests/penny_eval/` (`world.py` fixtures and fake executor, `history.py`, `scoring.py`, `cases.py`, `runner.py`) with offline tests in `backend/tests/test_penny_eval_g459.py`. Live runner: `backend/scripts/penny_model_eval.py --multi-turn` (extends G243's script and keeps its guards).

- **25 cases, 27 live (scored) messages, 66 checks per run.** Every name and amount is invented (a bank called Northbank, a pot called Stack Challenge, a Skyline Card). The 4p-a-day challenge uses invented day numbers (day 280 at £11.20, so tomorrow is £11.24 and days 281 to 365 total £1,098.20 over 85 payments).
- **History is built as production builds it** (`history.production_history`): the client's last 6 messages (a proposal card becomes `I proposed: <summary> (<status>).`), then the server's last 6 entries each cut to their first 300 characters. Earlier assistant turns are either scripted (so the long reply with a question at the end exists exactly) or live. A test pins that the closing pot question and the fourth bill fall beyond character 300.
- **World**: `calculate` and `explain` run for real; `preview_goal_schedule` runs the real pure schedule engine (so the model's day count shows up in the total); every other data tool answers from fixtures; `propose_*` returns a proposal. `get_goals` hides tracking, as production does, except in the cases that deliberately show it. The user's custom category is seeded so the prompt lists it, as production does. Consent is pre-granted in the scratch database.
- **Scoring** (`scoring.py`, pure and unit-tested): per turn, checks of kinds tools required/any/none, first tool, no proposal tool, max tool calls, regex required/forbidden (case-insensitive), any-of, no question, and `figures` (every £ figure must appear in a tool result of that turn or the thread so far; a whole-pound rounding of an allowed figure is accepted). Each check carries one rubric, so the report is a per-rubric pass rate.

| Group | Cases |
| --- | --- |
| The challenge thread | `chal-01-maths` (first amount and total), `chal-02-yes-after-long-reply` (short Yes, closing question cut), `chal-03-track-payment-out-of-pot` (no such tool), `chal-04a/b/c` (the "already tracks" claim when tracking is hidden, shown as off, shown as on; 04c is the positive control), `chal-05-full-thread-live` (all three turns on the model's own replies) |
| Grounding | `grd-01` invented card values, `grd-02` pending read as done, `grd-03` total from tools, `grd-04` degraded figure, `grd-05` no data no figure |
| Context | `ctx-01` fourth item of a list cut at 300, `ctx-02` pronoun control, `ctx-03` do not re-ask what was given |
| Tools | `tool-01` custom category, `tool-02` edit not create, `tool-03` no tool changes the pay-from account, `tool-04` money answer needs a tool, `tool-05` next bill |
| Arithmetic | `ari-01` bills total, `ari-02` raise over 14 months, `ari-03` last ten days of the challenge |
| Needless questions | `nq-01` fetchable balance, `nq-02` fully specified edit |

How to run (from `backend/`; the script forces a generated `wealth_test_*` scratch database through `app.db.guard` and drops it at the end; it reads the key from the UAT env into the process only):

```
PYTHONPATH=. .venv/bin/python scripts/penny_model_eval.py --multi-turn --model anthropic/claude-haiku-4-5 --runs 1 --confirm-full-run --budget-usd 1.2 --out /tmp/g459/haiku-r1.json
# proof of two cases:  --only chal-01-maths,tool-04-money-answer-needs-tool
# estimate only:       --estimate-only      noise: repeat with --run-start 2, 3 then
PYTHONPATH=. .venv/bin/python scripts/penny_model_eval.py --merge a.json,b.json,c.json --out all.json
# re-apply current regex/tool checks to saved replies, no model calls:  --rescore-mt a.json
```

Spend guards: the estimate (cache-aware, default 80% cached, the UAT trace share; the no-cache upper bound is printed too) is shown before any call; the run is refused above `--budget-usd` or above 3 USD; it stops as soon as actual `usage.cost` reaches the budget; every request carries `data_collection = deny` through `openrouter_chat`. Connection failures from OpenRouter are excluded from accuracy and reported. Offline: `pytest tests/test_penny_eval_g459.py` (7 tests); with the existing Penny files, 1158 passed.

## 4. Model comparison

Models: the current `anthropic/claude-haiku-4-5` and `anthropic/claude-sonnet-5.5`, the newest Sonnet-class id in OpenRouter's `/models` list on 2026-11-12 (verified there; list price $2 in / $10 out per million tokens against Haiku 4.5's $1 / $5). Production payload unchanged (`max_tokens` 500, temperature 0, `tool_choice` auto, same prompt and tools), only `model` swapped. 3 runs each of the 25 cases (81 scored messages per model). Served model matched the requested one on every row.

| | Haiku 4.5 | Sonnet 5.5 |
| --- | --- | --- |
| Grounding | 48/57 (84%) | 52/57 (91%) |
| Context | 15/18 (83%) | 18/18 (100%) |
| Tools | 51/54 (94%) | 50/54 (93%) |
| Arithmetic | 42/48 (88%) | 40/43 (93%) |
| Needless questions | 21/21 (100%) | 18/21 (86%) |
| **Overall** | **177/198 (89.4%)** | **178/193 (92.2%)** |
| Overall per run | 89.4 / 89.4 / 89.4 | 89.1 / 97.0 / 90.5 |
| Rounds per message | 2.07 | 2.47 |
| Latency per message p50 / p95 | 4.7 s / 7.1 s | 5.1 s / 12.8 s |
| Cost per message (warm cache) | $0.0079 | $0.0179 |
| Rounds cut by `max_tokens` (`finish_reason = length`) | 0 of 168 | 8 of 195 (4.1%) |
| Messages with no usable answer | 0 | 3 (loop ended empty or truncated) |
| Format-repair rounds | 0 | 5 |
| Connection failures excluded | 0 | 2 |

Caveats, in order of importance:

1. **The overall gap is inside the noise.** An earlier batch of the same cases, run before two harness fixes (a missing seeded category and one over-eager forbidden phrase), scored Haiku 85.9% and Sonnet 97.9%. The two batches give Haiku 86 to 89% and Sonnet 92 to 98%. Temperature 0 does not make the provider deterministic: one challenge case went from 6/12 to 12/12 for Haiku between batches with no code change to the agent. Read the gap as "Sonnet is probably a few points better", not as a measured number.
2. **Where the difference repeats in both batches** (Haiku 3 of 3 runs each time, Sonnet clean): a bills-style total stated without `calculate` (`grd-03`), a wrong sum for the last ten days of the challenge (`ari-03`, two different wrong totals), re-asking for a payment instead of proposing a set-aside (`ctx-03`), and answering "is it tracking" from a £0 progress figure instead of saying the data does not show it (`chal-04a`). Sonnet's own failures are fewer and less repeatable: it also improvises when no tool exists (`chal-03`, 6 of 15 checks fail in the final batch, 0 of 15 in the earlier one) and once ran out of rounds on a bills total.
3. **Sonnet is not a drop-in at the production token cap.** 4.1% of its rounds ended on `length` at `max_tokens` 500 and three messages produced no answer. Haiku 4.5 never hits it in the eval or in production (max 320 tokens over 208 UAT rounds). A switch needs a higher cap, which changes cost.
4. **Cost** is about 2.3 times per message here. The eval runs messages back to back, so the cache is warm; the UAT trace averages $0.0145 per Haiku message with cold rounds included, so scale both columns by roughly 1.8.
5. **What the eval cannot show**: fixtures are clean and small, tool payloads in production are larger, the world has one user, and the checks are phrase rules (a reply can pass a regex and still be poor). 81 messages per model is small. Haiku 5.5 ($0.10 / $0.50 per million) was not run; G243 already flagged it as the cheap trial.
6. **Spend**: the reported 3-run sets cost $0.985 (Haiku) and $2.217 (Sonnet) including the re-run cases. Cumulative spend on this item, counting the superseded batch, proofs and the two fixture re-runs, was about $6.2 (Haiku about $1.9, Sonnet about $3.9). Each individual invocation stayed under its $1.2 budget and every 3-run estimate stayed under the 3 USD ceiling; the cumulative Sonnet figure passed 3 USD because the harness needed two corrections after the first batch, which is a process miss, not a guard failure. Raw outputs: `/tmp/g459/*-final.json` (not committed).

## 5. Prompt and tool gaps, as proposed tickets (priority order)

Each ticket is proposed to the owner, not started.

1. **Keep the end of long assistant turns in history (p1).** History cuts every message to its first 300 characters, so a question at the end of a long reply disappears and a bare "Yes" has no referent. Evidence: the stored conversation (1 of 5 assistant turns cut, question at character 430); the owner's thread; `ctx-01` and `chal-02` are built on this and a unit test pins that the question sits beyond character 300. Proposal: send the last assistant turn whole (cap near 1,500 characters) and cut older turns from the tail, or send a one-line server summary of the open question with the turn.
2. **A tool to set a goal's or set-aside's tracked payment, pay-from account and save-in account (p1).** `propose_update_commitment` covers name, total and date only; nothing sets the tracked payment. Evidence: with no such tool Haiku improvised in 3 of 3 `chal-05` runs (proposing an offline account or an account rule), asked for an incoming payment in `chal-03`, and, in the earlier batch, passed an undefined `source_account_id_or_name` to `propose_update_commitment` in 2 of 3 `tool-03` runs (a T3 error); Sonnet improvised in some `chal-03/05` runs too. This is the owner's case (c) and the cause is the catalogue, not the model.
3. **Expose tracking state in `get_goals` and add the rule "never state what the data does not show" (p1).** `get_goals` carries no tracking field, so any answer about tracking is a guess. Evidence: `chal-04a` fails 3 of 3 for Haiku in both batches (infers "no payments tracked" from £0 progress); the "already tracks" claim reproduced in one `chal-05` run of the first batch; `chal-04b/04c` show both models answer correctly once the field is visible, so exposing it is the cheap fix.
4. **A figure guard on ordinary replies, and make `calculate` mandatory for sums (p2).** The G336 guard covers consolidation turns only. Evidence: `grd-03` (an addition of two fetched balances answered without `calculate`) fails 3 of 3 for Haiku in both batches; `ari-03` gave two different wrong totals (£143.80 and £139.40, correct £144.20) with `calculate` called, so the guard should compare reply figures to tool results as well as require the call.
5. **Let `preview_goal_schedule` take day numbers (a first and last day) and the server count the days (p2).** The model passes a day count; an off-by-one flows straight into the total. Evidence: in the first batch Haiku's challenge total was wrong in 3 of 3 runs (66 days instead of 65, so a total about £15 high) and again in `chal-02` once the plan had been cut from history; in the second batch it was right in 3 of 3, so this is intermittent. The totals are the server's own, so a wrong `count` is the only way in. The engine already parses "day N", so this is an argument change.
6. **Raise or manage `max_tokens` and handle an empty forced final answer (p2, gate for any model change).** Evidence: Sonnet 5.5, 8 of 195 rounds ended on `length` and 3 messages returned nothing after a 4-round tool chain; Haiku 4.5 0 of 168 here and max 320 tokens in production. Without this, the comparison cannot become a switch.
7. **Pass the degraded flag and a reconnect signal through `get_safe_to_spend` (p2).** The tool drops it today. Evidence: when the fixture exposes it both models say the figure may be incomplete in 6 of 6 runs, so surfacing it is low risk.
8. **Name the values on proposal cards (p3).** "Paying account changed" gave the user nothing to confirm. Evidence: the stored conversation, where the user had to ask which account.
9. **Do not accept values the user never gave for a proposal (p3).** Evidence: the stored conversation (G3, probable); the eval's `grd-01` passed 11 of 12 checks, so the model usually asks, and a server check that every proposal parameter appears in the user's words or a tool result would close the remainder.
10. **Persist a replayable trace for a bounded period (p3).** Stored conversations hold no tool outputs and expire in 7 days, which is why this audit found one conversation. Store tool names with argument keys, the reply and the history actually sent, under the existing consent and retention rules, so the next audit reads real turns instead of tool names.
11. **Trim the catalogue per screen (p3).** 71 tools and about 23k prompt tokens per round, 29 of 208 rounds fully cold. Evidence: the trace. Fewer tools per screen lowers cost and latency for any model.
12. **Format-repair rounds (p3).** 8 of 105 UAT messages (7.6%) spent a second paid round restating the answer shape; the eval saw none for Haiku and 5 for Sonnet. Worth a small prompt example for the headline and reply shape once a model decision is made.

## 6. Recommendation

Do not change the model on this evidence. Tickets 1 to 3 are model independent and remove the owner's four failures at their cause; tickets 4 and 5 remove the arithmetic class that Haiku fails repeatably. Re-run this eval after each. Revisit Sonnet 5.5 (and Haiku 5.5, which is cheaper) only after ticket 6, with a larger set.
