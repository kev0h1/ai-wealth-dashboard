# G178: TypeSafe Jev vs Haiku, tier-2 categorisation judge eval

Evaluates TypeSafe Jev's "System One" Choice primitive
(`POST https://api.typesafe.ai/v1/systemone`, model alias `jev-latest`, overridable with `--model`, e.g. `jev-1.13.0`; the versioned id the API reports is recorded per row as `model_used`) as a
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

## Tuning round

Methodology, so a round can be repeated and its numbers trusted:

1. **Frozen stratified split.** `split.py` tags every dataset row once
   (seed 178, 60% tune) and writes `out/split.json`. Gold rows (user
   corrections) are split per label so each label appears on both sides
   where it has two or more rows; single-row labels stay in tune. Silver rows
   are bucketed `silver` and are supporting evidence only. Do not regenerate
   the split once a round has started: the file is the freeze.
2. **Holdout is scored once.** Every tuning decision uses the tune bucket
   only. The holdout bucket is run at the very end, with the chosen variant,
   and its number is the one reported.
3. **Unanswerable rows are excluded from accuracy.** Gold rows with no example
   lines, or whose gold label is a movement kind that is never offered as an
   option (Transfer, Savings, Debt, Investment), cannot be answered by either
   judge. They are tagged `unanswerable`, counted separately in every report
   and never scored.
4. **Variants ladder** (`variants.py`, each adds to the last):
   `v0_baseline` (today's behaviour, byte for byte), `v1_instructions` (Other
   is a last resort), `v2_richer_state` (a summary header: lines seen, typical
   amount, repeating amounts, account types, direction mix),
   `v3_curated_examples` (curated public UK brand names per category from
   `curated_examples.py`). Haiku receives the same instruction wording and
   state header via `run_haiku --variant`. Curated names are authored by us and
   carry no user text, so the firewall rule holds: global options never carry
   user text, and user-scope options append that user's own examples after the
   curated ones.
5. **Calibration is fitted on tune.** `calibrate.py` fits one temperature by
   grid search on tune-bucket probability vectors (minimum NLL, no scipy) and
   applies it unchanged to the bucket being reported. Argmax never changes, so
   accuracy is unaffected; only confidence moves.
6. **Aggregates only.** Printed tables never show merchant names. The
   `--errors` flag writes `out/errors.<variant>.<bucket>.md` (gitignored) for
   the diagnosis step; do not paste it into a prompt or commit it.

Results files are per variant: `out/jev_results.<variant>.jsonl` and
`out/haiku_results.<variant>.jsonl`. On first use of `v0_baseline`, the legacy
un-suffixed files are copied across, so the earlier runs are reused and no
spend is repeated. Both runners stay resumable by `row_id`.

Commands, in order (from `backend/`; the live ones spend credit, so run them
only with Kevin's go-ahead):

```bash
# 0. Freeze the split (reads out/dataset.jsonl only)
.venv/bin/python -m scripts.jev_eval.split

# 1. Score v0 from the existing results, no new spend
.venv/bin/python -m scripts.jev_eval.report --variant v0_baseline --bucket tune --calibrate-from tune --errors
.venv/bin/python -m scripts.jev_eval.report --variant v0_baseline --bucket holdout --calibrate-from tune   # context only; do not tune on it

# 2. Dry-run each new variant first (no network)
.venv/bin/python -m scripts.jev_eval.run_jev --variant v3_curated_examples --bucket tune --dry-run

# 3. Jev ladder on tune
for v in v1_instructions v2_richer_state v3_curated_examples; do
  .venv/bin/python -m scripts.jev_eval.run_jev --variant $v --bucket tune
done

# 4. Haiku with the v2 wording on tune
.venv/bin/python -m scripts.jev_eval.run_haiku --variant v2_richer_state --bucket tune --limit 100 --confirm-full-run

# 5. Compare on tune, calibration fitted on tune
.venv/bin/python -m scripts.jev_eval.report --compare v0_baseline,v1_instructions,v2_richer_state,v3_curated_examples --bucket tune
.venv/bin/python -m scripts.jev_eval.report --variant v3_curated_examples --bucket tune --calibrate-from tune --errors

# 6. Final: the chosen variant on holdout, once (shown for v3)
.venv/bin/python -m scripts.jev_eval.run_jev --variant v3_curated_examples --bucket holdout
.venv/bin/python -m scripts.jev_eval.run_haiku --variant v2_richer_state --bucket holdout --limit 100 --confirm-full-run
.venv/bin/python -m scripts.jev_eval.report --variant v3_curated_examples --bucket holdout --calibrate-from tune
```
