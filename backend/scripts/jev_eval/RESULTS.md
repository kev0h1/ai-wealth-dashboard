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
