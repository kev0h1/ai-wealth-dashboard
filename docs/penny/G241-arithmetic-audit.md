# G241 audit: why Penny refuses or fumbles simple arithmetic

Status: written before any fix (2026-10-08). Sections marked "After" are
appended once the fix is built and measured. Item: G241, owner claude.

## 1. Kevin's wording is not recorded, so what was reproduced

Penny does not persist question text anywhere (no conversation collection,
no question field on `llm_usage`), so Kevin's exact failing question cannot
be recovered. What the trace store does hold, for Kevin's own user id only
(read-only aggregate, no question text exists to quote):

* 30 Penny messages in `llm_usage` (56 metered rounds). Only the six most
  recent carry B38 tool traces.
* Two messages on 2026-10-02 (12:22 and 12:48) each cost one round, called
  no tool, and produced 9 and 17 completion tokens. A real answer is never
  that short (a normal final answer is 50 to 130 tokens). Nine tokens is the
  size of the bare `OUT_OF_SCOPE` sentinel the system prompt tells the model
  to emit. This is consistent with, not proof of, the arithmetic refusal Kevin
  saw. The same shape (one round, no tool, tiny completion) is exactly what
  the reproduction below produces.
* One message (2026-10-03 17:39) did use `calculate`, so the tool is wired
  and reachable when the model decides the question is about money.

Because the wording is lost, the live code path was exercised instead.
`backend/scripts/penny_live_eval.py` drives the real `run_penny_agent` loop
(real system prompt, real tool catalogue, real `calculate`, real OpenRouter,
`anthropic/claude-haiku-4-5`) against a synthetic fixture world (invented
figures, no real user data, metering rows written to a throwaway
`wealth_test_*` database that is dropped afterwards). Corpus:
`backend/tests/penny_arithmetic_corpus.py`.

## 2. Today's behaviour, measured (before any change)

17 arithmetic, comparison, what-if and projection questions plus 2 controls,
run once each against unmodified code:

| outcome | rows |
|---|---|
| answered correctly, through `calculate` or a figure a tool returned | 7 |
| wrongly refused (generic "outside what I can work out" reply) | 7 |
| right figure but computed in the model's head, no `calculate` (rule 1 breach) | 2 |
| wrong | 1 |
| correctly declined (weather, "which ISA provider") | 2 |

Wrongly refused, all one round, no tool, `OUT_OF_SCOPE`:

* "what is 1,250 minus 380"
* "What is 15% of £2,400?"
* "Split a £132.60 bill four ways"
* "What is 20% off £86.50?"
* "What is a year of interest on £380 at 24.9% APR?"
* "If I switched broadband and saved £10 a month, what is that over a year?"
* "If I save £200 a month, how much will I have in 6 months?" (refused even
  though it is plainly about the user's own savings)

Wrong (1):

* "What is my average weekly grocery spend over the last 3 months?" answered
  "£85 per week". `get_category_spend` returns a 3-month total of £1,020 but
  not the window it covered (it is 90 days, 12.86 weeks), so the model
  assumed 12 weeks. Correct is about £79.33.

Right figure, wrong method (2), no `calculate` call:

* "How much more do I need to reach my Japan goal?" produced "£750 to go".
* "When will I reach my £2,000 Japan goal at my current rate?" answered
  "in 5 periods, which aligns with your target date" with no calculation and
  no projected date; it restated the goal's own target date.

Full per-question results are in `docs/penny/question-matrix.md`.

## 3. Causes, with file:line

1. **Rule 5 of the system prompt sends money-adjacent arithmetic to
   `OUT_OF_SCOPE`.** `backend/app/services/penny_agent.py:382-385`: "If the
   question is not about the user's own money ... respond with EXACTLY one
   line ... OUT_OF_SCOPE". A bare sum, percentage or split uses only numbers
   the user typed, so the model reads it as not about "the user's own money"
   and declines before any tool is offered a turn. The loop treats the
   sentinel as a failure (`penny_agent.py:915-938`, returns `None`), and the
   seam in `backend/app/routers/can_i.py` (fallback, headline at line 521)
   renders the fixed "That one's outside what I can work out from your
   numbers." with `out_of_scope: True`. This is the dominant cause: 7 of 7
   refusals.
2. **The calculator exists but is narrow, so even routed questions are
   fragile.** `backend/app/services/safe_calc.py` (owner-approved
   2026-08-30) is a sound AST whitelist, but it accepts only bare numeric
   literals (`_check`, line 171-223: names, strings and everything else are
   rejected). So the model must transcribe every figure by hand into the
   expression. It cannot take "£1,250.00" or the currency minus "−£380.00"
   straight from a tool result (a parse failure), has no `avg`/`sum`, no
   "needed to reach a target", no "periods to reach at a rate", no date
   projection, and the result carries no formatted GBP string and no record
   of which inputs were used. `penny_tools.py:648-690` (schema),
   `penny_tools.py:3940-3948` (`_exec_calculate`).
3. **Rule 1 is not enforced.** `penny_agent.py:358-364` says arithmetic goes
   through `calculate`, but nothing checks it. Two live rows computed in the
   model's head (see section 2). PENNY_TOOLS.md already lists this as an
   honest failure mode ("instruction-enforced, not mechanically enforced").
4. **A data tool omits what arithmetic needs.** `get_category_spend`'s
   `last_n_months` (`penny_tools.py:2976`) has no window dates or day count,
   which caused the wrong weekly average. `search_transactions`
   (`penny_tools.py:2186-2214`) returns at most 20 rows and
   `count: len(rows)`; it has no matched total, so any "how much have I spent
   at X over N months" is a sum of a truncated list (predicted wrong, not run
   live because it needs real transactions).

Not causes (checked): the greeting short-circuit, the 3 to 160 character
length gate (`can_i.py:300`, none of the rows is near 160), the round cap
(4) and `max_tokens` (500) did not fire on any arithmetic row; no
refusal rule for explaining the user's own numbers exists, so none was
narrowed. The "facts, never advice" rule 3 and the advice-shaped rule 8 are
untouched.

## 4. Existing calculator, for the record

PENNY_TOOLS.md already lists `calculate(expression)` (row 75). The G241
brief asks for "a deterministic calculator tool"; it is therefore extended,
not duplicated. Details are in the "After" sections below.

## 5. After: what was changed

Files: `backend/app/services/penny_agent.py` (rules 1 and 5),
`backend/app/services/safe_calc.py`, `backend/app/services/penny_tools.py`
(`calculate` schema and executor, `get_category_spend`, `search_transactions`,
`get_goals`), `PENNY_TOOLS.md` (G241 section, `calculate` row).

Refusal rules, as asked: rule 5 was narrowed (the only rule that wrongly
refused). It now opens "Basic arithmetic is NEVER out of scope" and keeps the
`OUT_OF_SCOPE` sentinel for questions with no money, number or date angle.
Nothing about advice was touched: rule 3 (facts, never advice), rule 8
(advice-shaped questions get facts), rule 9 (tax is general mechanics) and the
propose-only consent gate are byte-identical. A control row pins that "Which
ISA provider should I open an account with?" is still declined and the weather
question still declined.

`calculate`, extended not duplicated (one calculator, one parser):

* named `inputs` (numbers, `£1,250.00`, `−£380`, `{"raw": n}` money values);
  names resolve only from `inputs` and the AST walk is unchanged, so a name
  not supplied, a name that is a function, `x.y`, `x[0]`, lambdas,
  comprehensions and `__import__` are all still rejected (tests:
  `tests/test_safe_calc_g241.py`);
* `£`, thousands commas after a `£`, Unicode minus and dashes, `×`, `÷`;
* `sum`, `avg`, `shortfall` (needed to reach a target), `periods_to_reach`
  (whole periods at a stated rate), `per_week`, `pct_change`, `share`;
* output adds `inputs_used` (the working) and `result_formatted` for a `unit`
  (gbp uses the currency minus);
* a date projection (`project_from` + `period`) returns `projected_date` and
  a pre-hedged `projected_text`: "At the same rate, roughly March 2027. That is
  an estimate, not a promise, and it moves if the rate does."

Small read-tool fixes the matrix exposed:

* `get_category_spend.last_n_months` now carries `window` (from, to, days) and
  a server-computed `average_per_week`. Without it the model assumed 12 weeks
  for 3 months and answered £85 instead of £79.33, and on a later run
  divided by 13; both were run-to-run variance in a model doing arithmetic,
  so the figure is now a lookup.
* `search_transactions` now returns `matched_count`, `matched_spent`,
  `matched_received` and `truncated`, summed in Mongo over every match. It
  previously returned at most 20 rows with `count: len(rows)`, so a merchant
  or category total over months was a sum of a truncated list.
* `get_goals` now carries a server-derived `remaining` (never negative), so
  "how much more do I need" is a lookup. The model still did that subtraction
  in its head twice after the prompt told it not to (Haiku does not reliably
  follow "never subtract"), which is why this one is data, not instruction.

Not done, deliberately: no mechanical guard that a figure came from a tool
(rule 1 stays instruction-enforced, as PENNY_TOOLS.md already says); no new
tool for the priority-plan ladder, card utilisation (no credit limit stored)
or recurring price history; no frontend change (so no `tsc`).

## 6. Eval, pass bar and results

Shared corpus: `backend/tests/penny_arithmetic_corpus.py` (17 arithmetic,
comparison, what-if and projection rows plus 2 controls, all with invented
fixture figures).

* **Deterministic half (CI, `tests/test_penny_calculator_corpus.py`):** every
  row's reference expression, evaluated by the real calculator, must equal its
  expected value. **Bar: 100%**, and it is 17 of 17. Each row is also routed
  through the B38 fake-model harness (the expected data tools then
  `calculate` must be reachable against the real catalogue and pinned
  description hashes), 17 of 17. Four golden description pins were
  re-approved with `--repin` (`calculate`, `get_goals`, `search_transactions`,
  `get_category_spend`), each a deliberate change.
* **Offline golden eval:** `tests/test_penny_golden_eval.py` 100% (all
  original cases and break-tests pass), no model call.
* **Live half (manual, `scripts/penny_live_eval.py`, never CI):** real
  `anthropic/claude-haiku-4-5` via OpenRouter, real prompt and real tool
  catalogue, synthetic fixtures. Bar: no wrongful refusal, every arithmetic
  figure through `calculate` or a server-derived field, controls still
  declined, figure present in the reply.

| | answered | refused | mental maths | wrong | declined (correct) |
|---|---|---|---|---|---|
| before (19 rows) | 7 | 7 | 2 | 1 | 2 |
| after (19 rows) | 16 | 0 | 0 | 1 | 2 |

The after column is the final full run plus one re-run of the weekly-average
row after the last code change (`average_per_week` was added after that full
run, when the row came back at £78.46, dividing 3 months by 13 weeks instead
of using the 90-day window). Three other rows were re-run mid-way while the
prompt and fixtures were being tuned; every run is counted in the cost below.

### Residual (not fixed, stated plainly)

* **Row 68, "If I save £200 a month, how much will my savings be in 6
  months?"** still answers "£1,200" on every run: the model reads it as the
  amount saved and does not fetch the current balance to add (£4,310.50 would
  give £5,510.50). The arithmetic is now done by `calculate`; the model's
  reading of an ambiguous question is judgement, which no code gate in this
  repo can pin (the B38 harness header says the same). An extra prompt
  sentence ("start from the real current figure") did not change it and was
  removed to keep tokens down. Follow-up: a `project_balance` style tool or an
  `ask` nudge when a what-if names "my savings" with no starting figure. The
  original wording ("how much will I have in 6 months?") was reworded to the
  one above; both read the same to the model.
* The model is non-deterministic even at temperature 0 across rounds, so the
  live half is a sample, not a proof. The offline half is the proof for the
  calculator; routing judgement is not provable offline.

## 7. Cost and token impact

All figures are the provider-reported `cost_usd` from the metering rows
(`llm_usage`) the loop writes, read from the throwaway test database.

* **Total live spend for this item: about $0.70** (before-fix runs about
  $0.30, after-fix runs about $0.40), well under the $2 cap. Nineteen
  questions are about $0.14 per full pass.
* **Per question, steady state (prompt cache warm):** a one-round refusal
  $0.0022; a two-round `calculate` answer $0.0051; a three-round data tool
  plus `calculate` $0.0085; a four-round $0.0111. Mean per question
  about $0.0066 across the 17 arithmetic rows (cache-write outlier excluded). A refusal costs 44% of an answer and helps no
  one, so the fix adds spend only where a user was previously turned away.
* **First call after any prefix change** pays a cache write: $0.0256 against
  $0.0050 warm. Each deploy that changes the prompt or tool catalogue incurs
  it once per five-minute cache window per model route.
* **Token impact of the new definitions on every call:** the fixed prefix
  (system prompt plus all tool schemas) grew from 18,087 to 18,411 prompt
  tokens per round, +324 tokens or +1.8%, almost all of it cached
  (17,993 cached). A cached round costs about $0.0022 to $0.0023, so the
  change is about +1% on a warm cached round (control rows: $0.00223 before,
  $0.00226 after). The `calculate` schema itself got shorter in characters
  (about 2,190 down to 1,760) but gained an `inputs` object and three
  parameters; the rest is the two prompt rules. No extra model rounds are
  added to questions that were already answered.
* Live eval runtime: 1 to 4 rounds per question, each about 1.5 to 2.5 s.

Margin note (Penny is the margin lever): the dominant cost is the roughly
18k-token cached prefix on every round, not the new tool. If margin pressure
returns, the lever is trimming the 63-key `explain` registry description and
the 46 propose-tool schemas, which are offered on every round whether or not
the question is an action.

## 8. Follow-ups (not built)

1. Priority-plan ladder (Planning E2, "which rung am I on"): no read tool
   returns `GET /grow`'s rungs; only `explain` copy and `get_savings_position`'s
   period gate exist. Add `get_priority_plan`.
2. Card utilisation: no credit limit is stored (already BLOCKED on the
   Accounts redesign), so "what share of my limit" cannot be answered; Penny
   should say so, and does not invent a figure.
3. Recurring price history: "which bills went up" needs per-series amount
   history; `get_recurring_payments` carries only the typical amount.
4. Interest-aware payoff projection ("pay £300 a month, when is the Visa
   clear"): `calculate` can divide but not amortise. The engine's own
   `get_debt_position` projection is the right source; a what-if variant of it
   is the follow-up. Until then Penny should quote the engine's clear date.
5. A mechanical rule-1 guard (flag a reply whose figures are not in any tool
   result) remains unbuilt; the live eval's `mental_maths` outcome is the
   current detector.
6. What-ifs on "my savings or balance" with no stated starting figure (the
   row 68 residual).
7. `search_transactions` totals are not home-currency filtered the way
   `get_category_spend` is; fine for a UK-only user, wrong for a multi-currency
   one.
