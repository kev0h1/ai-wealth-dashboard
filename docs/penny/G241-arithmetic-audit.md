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
