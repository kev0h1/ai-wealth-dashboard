# G178: TypeSafe Jev vs Haiku, tier-2 categorisation judge eval

Evaluates TypeSafe Jev's "System One" Choice primitive
(`POST https://api.typesafe.ai/v1/systemone`, model `jev-1.13`) as a
candidate replacement for the existing Haiku-tier categorisation judge
(ENGINE.md's ladder tier 2 -- `llm_name_check` / `categorise_others_bg` in
`app.services.categorisation`, `anthropic/claude-haiku-4-5`).

Everything here is offline evaluation tooling. Nothing in this directory is
imported by the running API/worker, and nothing here writes to the app's
Mongo database except the standard OpenRouter usage-metering row
`run_haiku.py` produces as a side effect of reusing the real call path
(`app.core.llm.openrouter_chat` -- see that script's own docstring).

## Setup

Kevin adds `TYPESAFE_API_KEY=<key>` to the shared tree's `backend/.env`
(`/root/ai-wealth-dashboard/backend/.env`). Every script in this directory
loads that file explicitly by absolute path (`common.load_real_env()`,
called before any `app.*` import) -- it does NOT rely on this worktree
having its own `backend/.env` (it doesn't; that file is gitignored and this
worktree was created fresh). `OPENROUTER_API_KEY` is already present in the
real `.env` (used for the Haiku baseline).

## Run order

All commands below are run from `backend/`:

```bash
# 1. Build the eval set (Mongo reads only -- writes only out/dataset.jsonl, gitignored)
.venv/bin/python -m scripts.jev_eval.dataset

# 2. Build the criteria/options set as part of run_jev.py -- nothing to run standalone;
#    options.py is a pure library imported by run_jev.py and covered by tests/test_jev_eval.py.

# 3. Prove the Jev request shape with no network and no key required
.venv/bin/python -m scripts.jev_eval.run_jev --dry-run

# 4. Once TYPESAFE_API_KEY exists, run the live Jev pass (resumable)
.venv/bin/python -m scripts.jev_eval.run_jev --limit 10   # small proof first
.venv/bin/python -m scripts.jev_eval.run_jev              # full 258, resumable if interrupted

# 5. Baseline: the same rows through the existing Haiku prompt path.
#    --dry-run needs no OPENROUTER_API_KEY and makes no network call.
.venv/bin/python -m scripts.jev_eval.run_haiku --dry-run
#    A small, cheap proof run -- always do this before a full run:
.venv/bin/python -m scripts.jev_eval.run_haiku --limit 5
#    The FULL baseline spends real OpenRouter credit (~$0.20 for 258 rows at
#    Kevin's own estimate, unverified beyond that). Only run it on Kevin's
#    go-ahead -- the script refuses an unbounded run without one of:
.venv/bin/python -m scripts.jev_eval.run_haiku --limit 258 --confirm-full-run

# 6. Report (works with only one of the two result files present)
.venv/bin/python -m scripts.jev_eval.report
```

Both runners are resumable: a row already present in
`out/jev_results.jsonl` / `out/haiku_results.jsonl` (matched by `row_id`,
`f"{scope}:{uid_hash}:{merchant_key}"`) is skipped, so an interrupted run
can just be re-invoked with the same flags.

## What the key is for

`TYPESAFE_API_KEY` authenticates the live Jev Choice calls
(`Authorization: Bearer <key>`) in `run_jev.py`. Nothing else in this
toolkit needs it -- `dataset.py` is Mongo-only, `--dry-run` on either
runner needs no key, and `run_haiku.py`'s live run needs
`OPENROUTER_API_KEY` (already present) instead.

## Known limitations (read before trusting the numbers)

- **Recurring-veto join is best-effort.** `cashflow_cache.engine_vetoed_recurring`
  stores `series_key`'s output, not `canonical_merchant_key`'s; the two
  agree when `merchant_name` is present but can diverge on
  description-derived keys. A veto can be missed (never fabricated), see
  `mongo_helpers.fetch_veto_index`'s own docstring.
- **Global-scope dataset rows can span multiple real users.** A merchant
  key promoted to the global catalog can have matching transactions from
  several of this shared tester DB's 6 users; each example line carries its
  own `uid_hash`, but the row-level `uid_hash` is `""` for scope="global"
  rows (there is no single owning user to hash). This is intentional, not a
  gap: a global catalog entry is, by construction (the Firewall Rule's
  promotion gates), not one user's private fact, so pooling examples across
  users for it is the same thing the real catalog does.
- **Jev cost is unverified.** TypeSafe had not published per-token pricing
  at the time of writing; `report.py` uses a $42/billion-input-tokens
  placeholder (applied to input+output tokens, since no separate output
  rate exists to apply) and labels every number derived from it
  "UNVERIFIED" in the report. Haiku's cost is real (`usage.cost` from the
  OpenRouter response, recorded verbatim).
- **`run_haiku.py` asks one question per merchant** (all of that merchant's
  up-to-three example lines, one final category), adapted from
  `categorise_others_bg`'s per-(label, direction)-key batch shape so the
  two runners answer a directly comparable question (see that script's own
  docstring for exactly what was copied verbatim vs adapted, and why
  `llm_name_check` was read but not used as the reuse target).
- **Zero-example rows.** A `merchant_categories` document whose merchant key
  no longer matches any live transaction (data changed since caching) still
  ships as a dataset row with `examples: []` and a real label; neither judge
  has anything to look at for it. `dataset.py` prints a count of these when
  it runs.

## Go/no-go recommendation

Suggested criteria for treating Jev as a viable tier-2 replacement:

1. **Accuracy**: Jev's agreement with the GOLD (user-corrected) label set
   must be at least as good as Haiku's on the same rows. Silver agreement
   is supporting evidence only -- silver labels are themselves LLM output
   from the pipeline being replaced, so matching silver is a weaker signal
   than matching gold, and a judge that disagrees with silver but agrees
   with gold more often is the more interesting outcome, not a regression.
2. **Calibration**: Expected Calibration Error (ECE) under 0.1, so a
   confidence-based abstain/ask-the-user gate (ENGINE.md's Ask Budget Rule,
   tier 4) can actually be built on top of it.
3. **A usable abstain threshold**: some confidence threshold in the abstain
   curve at which coverage is 80% or more AND accuracy among covered rows is
   95% or more -- i.e. Jev can answer 4 in 5 merchants outright and be
   right at least 19 times out of 20 when it does, leaving the rest for
   tier 3 (web search) or tier 4 (ask), rather than silently degrading tier
   2's accuracy across the board.

None of these are met or failed by this harness -- it only produces the
numbers in `out/report.md`. The recommendation itself is Kevin's call, same
as running the full Haiku baseline is.
