# G239 2026-10-08: tier-2 judge model comparison on OpenRouter

Aggregates only (no merchant names, user ids or per-row data). Raw per-row outputs are under the gitignored `out/`. Reproduce with `run_openrouter.py` then `report.py --models ...` (see README).

## Setup

- Same frozen G178 dataset and split, not re-sampled: 274 rows, 88 gold (user-corrected), 186 silver (LLM-assigned), 43 rows with no transaction lines (4 of them gold). Split: tune 50, holdout 28, silver 186, unanswerable 10 (6 gold rows are labelled Transfer, an option no judge is offered, plus gold rows with no lines).
- Same v0 baseline prompt for all four models, temperature 0, `max_tokens` 200, `provider.data_collection = deny` on every request, nothing written to Mongo. Two deliberate changes from G178, applied identically to every model: (1) the reply schema also asks for a self-reported `confidence` between 0 and 1, because three of the four models give no probabilities and the abstain criterion needs some confidence (G178 Haiku had none); (2) `reasoning.effort = none` is sent, because reasoning-capable models otherwise spend the whole 200-token cap on hidden thinking and return nothing.
- Which Haiku id resolved: both `anthropic/claude-haiku-4-5` (as written at `categorisation.py:1550`) and `anthropic/claude-haiku-4.5` answered a 1-row call, and the response `model` field says `anthropic/claude-haiku-4.5` for both. So the hyphen id is an alias that OpenRouter resolves; production is not broken, and the hyphen id is not in the `/models` list. The comparison used the hyphen id.
- Confidence is self-reported by the model, so calibration here is verbalised-confidence calibration, not the probability-vector calibration of G178's Jev. Temperature scaling acts on the logit of the scalar, fitted on tune and applied to holdout. The fit grid tops out at T = 10, and openrouter/auto hit that ceiling, so its calibrated ECE is a best case.

## Per-model results

`typesafe/jev-router@mt1000` is the same model with `max_tokens` 1000. At the specified 200 cap, jev-router answered only 155 of 274 rows (119 truncated mid-reasoning), so the 200-token row is not a fair accuracy figure. The 1000-token row is the one to read for accuracy; the 200-token row is kept because it is the like-for-like run and shows the cap problem.

| model | answered | gold acc (of 88, no answer = miss) | holdout acc (answered) | agree with current judge | ECE raw / cal (holdout) | median / p95 latency | actual USD per 1k rows | run total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anthropic/claude-haiku-4-5 (current) | 230 | 37 = 42.0% | 50.0% (n=28) | n/a | 0.341 / 0.169 | 1792 / 3394 ms | $0.743 | $0.2036 |
| anthropic/claude-haiku-5.5 | 274 | 39 = 44.3% | 53.6% (n=28) | 73.5% | 0.207 / 0.205 | 1158 / 1702 ms | $0.069 | $0.0189 |
| typesafe/jev-router, 1000 tokens | 239 | 42 = 47.7% | 63.0% (n=27) | 70.8% | 0.252 / 0.244 | 1590 / 5515 ms | $0.432 | $0.1183 |
| typesafe/jev-router, 200 tokens | 155 | 30 = 34.1% | 76.5% (n=17) | 85.0% | 0.166 / 0.198 | 1567 / 2405 ms | $0.219 | $0.0600 |
| openrouter/auto | 274 | 38 = 43.2% | 50.0% (n=28) | 67.0% | 0.338 / 0.112 | 750 / 1405 ms | $0.060 | $0.0166 |

Notes on reading the table: the gold lead of any model over the current judge is 1 to 5 rows of 88, which is noise. The holdout has 28 rows. Latency is per call, run in parallel across models, so only the ordering is meaningful. Haiku 4.5 verbosely appends an explanation after its JSON (70 to 127 completion tokens against about 20 for the others), which is why it is the slowest and dearest per call.

Served models: haiku-4-5 always `anthropic/claude-haiku-4.5`; haiku-5.5 always `anthropic/claude-haiku-5.5`; openrouter/auto served `deepseek/deepseek-v4-flash-0731` on all 274 rows; typesafe/jev-router served `deepseek/deepseek-v4.1-flash` on 268 to 269 rows and otherwise Google Gemini Flash, GPT or Claude Sonnet variants (1 to 5 rows each). So on OpenRouter, "Jev" is a router over general LLMs, not TypeSafe's own System One model that G178 tested, and both routers land on a DeepSeek flash model almost every time.

## Abstain thresholds (all answerable rows, self-reported confidence)

| model | max coverage at 90% accuracy (raw / cal) | max coverage at 95% accuracy (raw / cal) | best accuracy point (raw) |
| --- | --- | --- | --- |
| anthropic/claude-haiku-4-5 | none | none | 84.6% at 50.9% coverage (threshold 0.95) |
| anthropic/claude-haiku-5.5 | 12.8% / 12.8% | none | 91.4% at 12.8% (0.93) |
| typesafe/jev-router, 1000 tokens | none | none | 86.8% at 15.9% (0.97) |
| typesafe/jev-router, 200 tokens | none | none | 87.5% at 25.8% (0.97) |
| openrouter/auto | none | none | 68.7% at 36.1% (0.95) |

Every model is overconfident (raw holdout ECE 0.17 to 0.34) and none reaches 95% accuracy at any coverage.

## Miss-cause analysis (new in G239)

Rows with no transaction lines (43) versus the rest (231):

| model | no-lines rows: behaviour | rows with lines: accuracy (answered) | Other predicted, rows with lines |
| --- | --- | --- | --- |
| anthropic/claude-haiku-4-5 | declines all 43 (asks for example lines), 0 scored | 65.2% (1 no answer) | 11.7% |
| anthropic/claude-haiku-5.5 | answers Other on all 43 | 59.3% | 13.9% |
| typesafe/jev-router, 1000 tokens | answers Other on all 43 | 64.3% (35 no answer) | 7.7% |
| openrouter/auto | answers Other on all 43 | 58.4% | 11.3% |

Every model that answers a row with no lines answers Other, which is wrong by construction (no label is Other). Only Haiku 4.5 does the right thing, which is to decline. This is the cleanest single lesson: a replacement judge must be told to abstain when there is nothing to read, or it manufactures 43 false Others. Those 43 rows are 16% of the dataset, so the headline gold figures understate every model on rows that can be judged.

Dominant miss causes, in words, from the top-10 confusion cells (full cells are reproducible with the report command):

1. Over-picking Other for ordinary retail and services. Across all four models the largest single cell is Shopping labelled but Other predicted (Haiku 4.5 6 rows, 5.5 20, router 16, auto 18), followed by Bills, Eating Out, Transport and Travel predicted as Other. This is the same G178 finding, and it is much stronger in the three non-current models, partly because the 43 no-line rows are in these counts.
2. Subscriptions versus Software (and Entertainment versus Subscriptions). Haiku 4.5 gets 5 gold Subscriptions rows as Software; auto gets 10 Software rows as Subscriptions across all rows. The categories overlap and the stored labels follow one user's habit, so this is partly label ambiguity, not model error.
3. Health labelled but Entertainment (or Other) predicted (3 to 4 gold rows for each model; Entertainment for Haiku 4.5, 5.5 and the router, Other for auto).
4. Bills spread across Subscriptions, Shopping, Car finance and Other: Bills is the weakest gold category for every model (6 to 9 of 10 missed).
5. Transfer gold rows (6, never an offered option) are predicted as Income by most models (Haiku 4.5 mostly says Other), since none was told Transfer exists, which is a dataset-design limit rather than a judge fault.
6. Eating Out is the best category (about 12 to 14 of 17 to 18 correct); the confusions it does have are with Shopping, Travel and Entertainment.

## Data policy findings

- `GET /api/v1/models` exposes no per-model data policy, retention or training field for any of the four. `/models/{id}/endpoints` lists upstream providers but again no policy field. Anthropic haiku 4.5 lists Anthropic, Amazon Bedrock, Google and Azure endpoints; haiku 5.5 lists those plus Claude Platform on AWS; `typesafe/jev-router` and `openrouter/auto` list no endpoints (virtual routers).
- Every request carried `provider.data_collection = deny`, and all four models returned HTTP 200, so a deny-compatible upstream exists for each at the time of the run. For `openrouter/auto` and `typesafe/jev-router` the deny setting constrains which upstreams the router may choose, but the upstream is chosen per call and changed during the run for jev-router (five different served models), so the policy is only as good as the filter, and I did not record the upstream provider per row, only the served model.
- Not verified: the account-level privacy toggles on the OpenRouter dashboard, and what any upstream actually retains. Before any production use of a router model, confirm per upstream.

## Spend

Final runs: $0.2036 + $0.0189 + $0.0600 + $0.1183 + $0.0166 = $0.4174. Discarded proof and debugging calls (5-row proofs, reasoning and parsing tests, one cross-contaminated file) about $0.02. Total about $0.44 of the $5 cap; no model's full-run estimate was near $2 (largest $0.47, a conservative fallback for dynamic pricing).

## Go / no-go against the bar

Bar: (1) at least as accurate as the current judge on gold, (2) a threshold with 80%+ coverage at 95%+ accuracy, (3) cost and latency recorded.

| model | (1) gold vs current (37) | (2) 80% coverage at 95% | (3) recorded | verdict |
| --- | --- | --- | --- | --- |
| anthropic/claude-haiku-4-5 | the benchmark | not met (best 84.6% at 51%) | yes | stays as is |
| anthropic/claude-haiku-5.5 | met (39, within noise), but 59.3% against 65.2% on rows with lines | not met (12.8% at 90%) | yes | no-go as a drop-in; candidate only if cost matters |
| typesafe/jev-router | met at 1000 tokens (42), not at the specified 200 (30) | not met | yes | no-go |
| openrouter/auto | met (38, within noise) | not met (best 68.7% at 36%) | yes | no-go |

Recommendations:

- Haiku 4.5 (current): keep. Best accuracy where there is something to read, the only model that declines rows with no lines, and still no usable confidence.
- Haiku 5.5: the only real alternative. Roughly equal gold accuracy at about one eleventh of the cost per row ($0.069 against $0.743 per 1k) and about 35% lower median latency, but it lost 6 points on rows with lines and answers Other on rows with no lines. If the aim is cost, trial it behind a guard that skips rows with no lines and compare on a bigger sample before switching; do not switch on this evidence alone. It does not meet the calibration or abstain bar.
- typesafe/jev-router: no-go. At the specified token cap it fails to answer 43% of rows because it routes to a reasoning model; with a larger cap it is similar to Haiku 4.5 on gold but about 1.6 times slower at p95 and about 0.6 times the cost of Haiku 4.5. It is not the Jev model G178 tested.
- openrouter/auto: no-go. Cheapest and fastest (it served a DeepSeek flash model every time) but below the others on rows with lines, and its routing is not controllable, which is a problem for a pipeline that needs a stable, auditable judge.
- None of the four meets the 95% accuracy abstain bar, so none can back a "confident enough to skip asking the user" gate on verbalised confidence. A calibrated probability (as Jev's own API gave, ECE 0.12 after calibration in G178) remains the better route to that; the G178 recommendation stands.

Caveats: 88 gold rows and a 28-row holdout, so differences under about 5 rows are noise; 43 rows cannot be judged by anyone; silver labels are Haiku-family output, which favours Haiku 4.5 on silver agreement; v0 holdout was not perfectly blind (see the G178 section).

---

# G178 results: TypeSafe Jev vs Haiku as the tier-2 categorisation judge

Run date: 2026-10-04. Aggregates only (no merchant names, user ids or per-row data).

Jev: alias `jev-latest`, which the API reported as `jev-1.13.0` on every row. Haiku: `anthropic/claude-haiku-4-5` via OpenRouter. Both judged the same 274 merchant rows with zero failed calls.

## Dataset

- 274 rows: 88 gold (user-corrected labels) and 186 silver (LLM-assigned labels). 1 row is engine-vetoed recurring.
- 43 rows (4 of them gold) have zero transaction lines, so neither judge has anything to read. They stay in every figure below, not excluded, because the report does not treat them specially. Those 43 rows are where the two judges agree most (42 of 43, almost always on "Other"), which inflates Jev vs Haiku agreement. Gold accuracy excluding them is given below.
- 6 gold rows are labelled Transfer, which is outside the judges' option set, so neither judge can match them.

## Latency (the headline question: can Jev speed up categorisation?)

| Judge | Median | p95 | Full run wall time |
| --- | --- | --- | --- |
| Jev | 231 ms | 297 ms | 1m07s (264 rows in the main run) |
| Haiku | 906.5 ms | 1835 ms | 4m43s (259 rows in the main run) |

Jev is about 3.9x faster at the median and 6.2x faster at p95, per call, run sequentially.

## Accuracy

| Comparison | Agreement |
| --- | --- |
| Jev vs gold (88) | 39/88 = 44.3% |
| Haiku vs gold (88) | 36/88 = 40.9% |
| Jev vs Haiku (gold rows) | 52/88 = 59.1% |
| Jev vs silver (186) | 83/186 = 44.6% |
| Haiku vs silver (186) | 108/186 = 58.1% |
| Jev vs Haiku (all 274) | 190/274 = 69.3% |

Excluding the 43 zero-example rows: gold 84 rows, Jev 39/84 = 46.4%, Haiku 36/84 = 42.9%. Across all 231 rows with examples, Jev 121/231 = 52.4%, Haiku 144/231 = 62.3%, agreement between them 148/231 = 64.1%.

The gold lead is 3 rows out of 88, which is not a meaningful difference. Both judges are poor on gold. The dominant error for both is predicting "Other" for Shopping, Bills, Eating Out and Transport merchants. Jev is further from the silver labels, which are Haiku-family output, as expected.

## Calibration (Jev)

ECE 0.3221 (Haiku gives no confidence, so n/a).

| Confidence | n | Accuracy | Mean confidence |
| --- | --- | --- | --- |
| 0.1-0.2 | 1 | 0.0% | 0.17 |
| 0.2-0.3 | 2 | 50.0% | 0.26 |
| 0.3-0.4 | 17 | 35.3% | 0.36 |
| 0.4-0.5 | 30 | 30.0% | 0.45 |
| 0.5-0.6 | 20 | 35.0% | 0.53 |
| 0.6-0.7 | 31 | 25.8% | 0.65 |
| 0.7-0.8 | 25 | 36.0% | 0.75 |
| 0.8-0.9 | 37 | 43.2% | 0.85 |
| 0.9-1.0 | 111 | 59.5% | 0.97 |

Jev is substantially overconfident: at 0.9 or above it is right 59.5% of the time. (These calibration and abstain figures are measured against each row's stored label, gold and silver combined.)

## Coverage at accuracy (Jev abstain curve)

| Threshold | Coverage | Accuracy | n |
| --- | --- | --- | --- |
| 0.50 | 81.8% | 47.3% | 224 |
| 0.60 | 74.5% | 48.5% | 204 |
| 0.70 | 63.1% | 52.6% | 173 |
| 0.80 | 54.0% | 55.4% | 148 |
| 0.90 | 40.5% | 59.5% | 111 |
| 0.95 | 32.1% | 67.0% | 88 |

No threshold reaches 95% accuracy at any coverage; the best is 67.0% accuracy at 32.1% coverage.

## Cost

- Jev: $0.0778 per 1,000 rows, UNVERIFIED (placeholder of $42 per billion input and output tokens, as TypeSafe has not published pricing). About $0.02 for the 274-row run.
- Haiku: $0.488 per 1,000 rows (recorded OpenRouter `usage.cost`). Total spent on this baseline: $0.128 across the 5-row proof and the main run.

## Go / no-go against the stated criteria

1. Jev at least as accurate as Haiku on gold: nominally met (44.3% vs 40.9%), but within noise (3 rows) and both are low.
2. ECE under 0.1: NOT met (0.3221).
3. Threshold giving 80%+ coverage at 95%+ accuracy: NOT met (best accuracy at any threshold is 67.0%).

Recommendation for Kevin to decide: no-go as a drop-in tier-2 judge, because it fails the calibration and abstain criteria so no confidence gate can be built on it. Its real advantage is speed (about 4x faster at the median, about 6x at p95) and likely lower cost. Note the shared weakness (over-using "Other"), which looks like a prompt and criteria issue worth tuning before judging either model on accuracy, and the dataset is small (88 gold rows).

## Tuning round (2026-10-04)

Methodology:

1. Frozen stratified split (seed 178): tune 50, holdout 28, silver 186, unanswerable 10 (gold rows with no example lines or an unofferable movement label). Unanswerable rows are never scored.
2. Every decision uses the tune bucket only. The holdout was run once at the end with the chosen variant.
3. Variants ladder: v0 baseline, v1 instructions (Other as last resort), v2 richer state header, v3 curated public brand examples. Haiku mirrors the v2 wording and state header.
4. One calibration temperature is fitted on tune (grid search, minimum NLL) and applied unchanged to holdout. Accuracy is unaffected by calibration.
5. Aggregates only, no merchant names or user text. v0 holdout results were glanced at once during harness testing before this round, so the holdout is not perfectly blind for v0.

### Miss-cause classification (tune)

Not completed in this run. The per-row errors file could not be read in the runner session (blocked as PII handling), so the cause counts (unknown merchant, ambiguous description, option-description gap, ignored direction cue, custom user category, Other despite a clear business type) are outstanding and need a human or an approved reading of `out/errors.v0_baseline.tune.md`. The confusion tables give a partial view: on tune, v0 Jev's most common misses are Other for Bills, Subscriptions and Eating Out (6 of 25 misses), and Haiku's most common miss is Software for Subscriptions (3 of 28).

### Tune comparison across variants (50 answerable rows)

| variant | Jev acc | Other share | ECE raw | ECE calibrated (own T) | Haiku acc | Jev-Haiku agreement |
| --- | --- | --- | --- | --- | --- | --- |
| v0_baseline | 50.0% | 18.0% | 0.277 | 0.161 | 44.0% (v0 wording) | 54.0% |
| v1_instructions | 54.0% | 18.0% | 0.219 | 0.082 | n/a | n/a |
| v2_richer_state | 50.0% | 10.0% | 0.233 | 0.175 | 48.0% (v2 wording) | 66.0% |
| v3_curated_examples | 50.0% | 18.0% | 0.225 | 0.158 | n/a | n/a |

Chosen variant: v0_baseline. The best alternative, v1, gains 2 rows (27 against 25), below the 3-row bar, so the simpler baseline stands. No variant reaches 90% accuracy at any coverage on tune.

### Calibration, v0 (fitted on tune, T = 1.66)

| bucket | ECE raw | ECE calibrated |
| --- | --- | --- |
| tune | 0.277 | 0.161 |
| holdout | 0.231 | 0.116 |

Coverage at accuracy on tune, v0: 80% target gives 42.0% coverage raw (threshold 0.82) and 40.0% calibrated (0.57); 90% and 95% are unreachable, raw and calibrated.

### Holdout, once (28 answerable rows)

| measure | Jev v0 | Haiku (v2 wording) |
| --- | --- | --- |
| Accuracy | 50.0% (14/28) | 53.6% (15/28) |
| Other share | 35.7% | 14.3% |
| Agreement | 18/28 = 64.3% | 18/28 = 64.3% |
| ECE raw / calibrated | 0.231 / 0.116 | n/a |
| Coverage at 80% (raw / cal) | 35.7% / 35.7% | n/a |
| Coverage at 90% and 95% (raw) | 21.4% (6 rows, threshold 0.97) | n/a |
| Coverage at 90% and 95% (cal) | 17.9% (5 rows, threshold 0.80) | n/a |
| Latency median / p95 | 232 ms / 295 ms | 835 ms / 1816 ms |
| Cost | about $0.0778 per 1,000 rows (unverified placeholder) | $0.0167 for 28 rows (about $0.60 per 1,000) |

Haiku with the v0 wording scored 50.0% on the same holdout rows. Spend this round: Haiku v2 runs $0.048 (78 rows), Jev about $0.02 at the placeholder rate.

### Tune against holdout

| measure | tune (n=50) | holdout (n=28) |
| --- | --- | --- |
| Jev v0 accuracy | 50.0% | 50.0% |
| Haiku v2 accuracy | 48.0% | 53.6% |
| Jev-Haiku agreement | 66.0% (Haiku v2 vs Jev v2), 58.0% (Haiku v2 vs Jev v0) | 64.3% |
| Jev v0 ECE raw | 0.277 | 0.231 |
| Jev v0 ECE calibrated | 0.161 | 0.116 |
| Jev Other share | 18.0% | 35.7% |

### Go criteria re-scored on holdout

1. Jev at least as accurate as Haiku: NOT met on holdout (50.0% against 53.6%, one row), within noise.
2. ECE under 0.1: NOT met (0.231 raw, 0.116 calibrated, close but above).
3. 80% coverage at 95% accuracy: NOT met (best 21.4% coverage at 90%+ accuracy, raw).

### Caveats

The holdout is 28 rows, many labels are single-row, and one row is 3.6 points, so the Jev and Haiku accuracy gap is noise. Prompt tuning moved tune accuracy by at most 2 rows. The holdout Other share (35.7%) is high and is where most Jev misses sit. The calibration temperature transferred well (ECE roughly halved on holdout) but not enough to pass the criterion.
