"""G178 deliverable 5: read both result files (either or both may not exist
yet) and print + write `out/report.md` covering agreement with gold/silver
labels, confusion, calibration/ECE, the abstain curve, latency, and cost.

Every function below is pure (list[dict] in, dict/list out) so
`tests/test_jev_eval.py` can exercise the maths on a tiny hand-built
fixture without touching either result file.

Tuning-round options (see README.md, "Tuning round"):
    --variant <name>            which results files to read (default v0_baseline)
    --bucket tune|holdout|silver|all
    --calibrate-from tune       fit temperature on the tune bucket, apply to --bucket
    --compare v0_baseline,...   one summary table across variants for --bucket
    --errors                    write out/errors.<variant>.<bucket>.md (the ONLY
                                place merchant names appear; gitignored)

Printed tables are aggregates only.

Usage (from backend/):
    .venv/bin/python -m scripts.jev_eval.report
"""
from __future__ import annotations

import argparse
import math
import statistics
import sys
from collections import Counter

from scripts.jev_eval import calibrate
from scripts.jev_eval.common import (
    DATASET_PATH, OUT_DIR, read_jsonl, results_path, row_id as make_row_id,
)
from scripts.jev_eval.split import load_split, make_split
from scripts.jev_eval.variants import VARIANTS, get_variant

ABSTAIN_THRESHOLDS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]
JEV_PRICE_PER_BILLION_INPUT_TOKENS_USD = 42.0  # placeholder, UNVERIFIED -- see README.md


def agreement(records: list[dict], label_source: str) -> dict:
    """Accuracy of `choice == label` restricted to rows whose gold/silver
    provenance (`label_source`) matches, and which actually got an answer."""
    subset = [r for r in records if r.get("label_source") == label_source and r.get("choice") is not None]
    n = len(subset)
    correct = sum(1 for r in subset if r["choice"] == r["label"])
    return {"n": n, "correct": correct, "accuracy": (correct / n) if n else None}


def confusion_pairs(records: list[dict], top_n: int = 10) -> list[dict]:
    c: Counter = Counter()
    for r in records:
        if r.get("choice") and r.get("label") and r["choice"] != r["label"]:
            c[(r["label"], r["choice"])] += 1
    return [{"true": k[0], "pred": k[1], "count": v} for k, v in c.most_common(top_n)]


def calibration_and_ece(records: list[dict], n_buckets: int = 10) -> tuple[list[dict], float | None]:
    """Bucket rows by confidence into `n_buckets` equal-width deciles;
    per-bucket accuracy vs. mean confidence, and the overall
    (sample-size-weighted) Expected Calibration Error."""
    buckets: list[list[tuple[bool, float]]] = [[] for _ in range(n_buckets)]
    for r in records:
        conf = r.get("confidence")
        if conf is None or r.get("choice") is None or r.get("label") is None:
            continue
        idx = min(int(conf * n_buckets), n_buckets - 1)
        buckets[idx].append((r["choice"] == r["label"], conf))

    total_n = sum(len(b) for b in buckets)
    table = []
    ece = 0.0
    for i, b in enumerate(buckets):
        lo, hi = i / n_buckets, (i + 1) / n_buckets
        n = len(b)
        if n == 0:
            table.append({"bucket": f"{lo:.1f}-{hi:.1f}", "n": 0, "accuracy": None, "mean_confidence": None})
            continue
        acc = sum(1 for correct, _ in b if correct) / n
        mean_conf = sum(cv for _, cv in b) / n
        table.append({"bucket": f"{lo:.1f}-{hi:.1f}", "n": n, "accuracy": acc, "mean_confidence": mean_conf})
        ece += (n / total_n) * abs(acc - mean_conf)
    return table, (ece if total_n else None)


def abstain_curve(records: list[dict], thresholds: list[float] = ABSTAIN_THRESHOLDS) -> list[dict]:
    """Coverage (fraction of rows the judge would answer if it abstained
    below `threshold`) and accuracy among the covered rows, at each
    threshold."""
    scored = [
        (r.get("confidence"), r["choice"] == r["label"])
        for r in records
        if r.get("confidence") is not None and r.get("choice") is not None and r.get("label") is not None
    ]
    total = len(scored)
    out = []
    for t in thresholds:
        covered = [correct for conf, correct in scored if conf >= t]
        n = len(covered)
        out.append({
            "threshold": t,
            "coverage": (n / total) if total else None,
            "accuracy": (sum(1 for c in covered if c) / n) if n else None,
            "n": n,
        })
    return out


def latency_stats(records: list[dict]) -> dict:
    lat = sorted(r["latency_ms"] for r in records if isinstance(r.get("latency_ms"), (int, float)))
    if not lat:
        return {"median_ms": None, "p95_ms": None, "n": 0}
    p95_idx = min(int(math.ceil(0.95 * len(lat))) - 1, len(lat) - 1)
    return {"median_ms": statistics.median(lat), "p95_ms": lat[p95_idx], "n": len(lat)}


def jev_cost_per_1000(records: list[dict], price_per_billion_input_tokens: float = JEV_PRICE_PER_BILLION_INPUT_TOKENS_USD) -> float | None:
    """UNVERIFIED placeholder pricing (input+output tokens at the same
    per-billion-input-token rate, since TypeSafe has not published a
    separate output rate at the time of writing) -- label every figure
    derived from this as unverified in any surface that shows it."""
    usages = [r.get("usage") for r in records if r.get("usage")]
    if not usages:
        return None
    per_row_tokens = [
        (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0) for u in usages
    ]
    mean_tokens = sum(per_row_tokens) / len(per_row_tokens)
    return mean_tokens * (price_per_billion_input_tokens / 1e9) * 1000


def haiku_cost_per_1000(records: list[dict]) -> float | None:
    costs = [r.get("cost_usd") for r in records if isinstance(r.get("cost_usd"), (int, float))]
    if not costs:
        return None
    return (sum(costs) / len(costs)) * 1000


def _fmt_pct(x: float | None) -> str:
    return "n/a" if x is None else f"{x * 100:.1f}%"


def _fmt_usd(x: float | None) -> str:
    return "n/a" if x is None else f"${x:.4f}"


def render_section(name: str, records: list[dict] | None) -> str:
    if not records:
        return f"## {name}\n\n_No results file yet -- run the corresponding runner first._\n"

    gold = agreement(records, "user")
    silver = agreement(records, "llm")
    confusion = confusion_pairs(records)
    calib_table, ece = calibration_and_ece(records)
    abstain = abstain_curve(records)
    lat = latency_stats(records)

    lines = [f"## {name}", ""]
    lines.append(f"- Agreement with GOLD (user-corrected) labels: {gold['correct']}/{gold['n']} = {_fmt_pct(gold['accuracy'])}")
    lines.append(f"- Agreement with SILVER (llm-assigned) labels: {silver['correct']}/{silver['n']} = {_fmt_pct(silver['accuracy'])}")
    lines.append(f"- Latency: median {lat['median_ms']} ms, p95 {lat['p95_ms']} ms (n={lat['n']})")
    lines.append(f"- Expected Calibration Error (ECE): {ece:.4f}" if ece is not None else "- ECE: n/a")
    lines.append("")

    lines.append("### Top confusions (true -> predicted)")
    if confusion:
        lines.append("| true | predicted | count |")
        lines.append("| --- | --- | --- |")
        for c in confusion:
            lines.append(f"| {c['true']} | {c['pred']} | {c['count']} |")
    else:
        lines.append("_none_")
    lines.append("")

    lines.append("### Calibration (confidence decile -> accuracy)")
    lines.append("| bucket | n | accuracy | mean confidence |")
    lines.append("| --- | --- | --- | --- |")
    for row in calib_table:
        mean_conf_str = "n/a" if row["mean_confidence"] is None else f"{row['mean_confidence']:.2f}"
        lines.append(f"| {row['bucket']} | {row['n']} | {_fmt_pct(row['accuracy'])} | {mean_conf_str} |")
    lines.append("")

    lines.append("### Abstain curve (coverage / accuracy at confidence threshold)")
    lines.append("| threshold | coverage | accuracy | n |")
    lines.append("| --- | --- | --- | --- |")
    for row in abstain:
        lines.append(f"| {row['threshold']:.2f} | {_fmt_pct(row['coverage'])} | {_fmt_pct(row['accuracy'])} | {row['n']} |")
    lines.append("")

    return "\n".join(lines)


def build_report(dataset_rows: list[dict], jev_records: list[dict] | None, haiku_records: list[dict] | None) -> str:
    parts = ["# G178 Jev vs Haiku eval report", ""]
    if dataset_rows:
        gold_n = sum(1 for r in dataset_rows if r.get("label_source") == "user")
        silver_n = sum(1 for r in dataset_rows if r.get("label_source") == "llm")
        vetoed_n = sum(1 for r in dataset_rows if r.get("engine_vetoed_recurring"))
        parts.append(f"Dataset: {len(dataset_rows)} rows ({gold_n} gold / {silver_n} silver), {vetoed_n} engine-vetoed-recurring.")
        parts.append("")

    used = sorted({r.get("model_used") for r in (jev_records or []) if r.get("model_used")})
    if used:
        parts.append("Jev versioned model id(s) reported by the API: " + ", ".join(used))
        parts.append("")
    parts.append(render_section("Jev (jev-latest)", jev_records))
    parts.append("")
    parts.append(render_section("Haiku baseline (anthropic/claude-haiku-4-5)", haiku_records))
    parts.append("")

    jev_cost = jev_cost_per_1000(jev_records) if jev_records else None
    haiku_cost = haiku_cost_per_1000(haiku_records) if haiku_records else None
    parts.append("## Cost per 1,000 rows")
    parts.append(f"- Jev: {_fmt_usd(jev_cost)} (UNVERIFIED -- ${JEV_PRICE_PER_BILLION_INPUT_TOKENS_USD:.0f}/billion input tokens placeholder, applied to input+output tokens; TypeSafe has not published pricing at time of writing)")
    parts.append(f"- Haiku: {_fmt_usd(haiku_cost)} (from recorded `usage.cost` / `cost_usd`, real OpenRouter pricing)")
    parts.append("")

    return "\n".join(parts)


# ── tuning-round reporting ──────────────────────────────────────────────────

COVERAGE_TARGETS = (0.80, 0.90, 0.95)
MIN_COVERED_N = 5


def in_bucket(records: list[dict], split: dict[str, str] | None, bucket: str) -> list[dict]:
    """Records whose row is in `bucket`. "all" keeps everything; when no
    split is available every record is kept (nothing is unanswerable).
    The gold buckets (tune, holdout) also keep unanswerable gold rows so
    they can be counted separately; partition_answerable removes them
    from every score."""
    if bucket == "all" or split is None:
        return list(records)
    keep = {bucket, "unanswerable"} if bucket in ("tune", "holdout") else {bucket}
    return [r for r in records if split.get(r.get("row_id")) in keep]


def partition_answerable(records: list[dict], split: dict[str, str] | None) -> tuple[list[dict], list[dict]]:
    """(answerable rows that got a choice, unanswerable rows). Unanswerable
    rows are tagged by the split (zero examples or an excluded gold label)
    and never count towards accuracy."""
    answerable, unanswerable = [], []
    for r in records:
        if split is not None and split.get(r.get("row_id")) == "unanswerable":
            unanswerable.append(r)
        elif r.get("choice") is not None:
            answerable.append(r)
    return answerable, unanswerable


def accuracy(records: list[dict]) -> float | None:
    if not records:
        return None
    return sum(1 for r in records if r["choice"] == r["label"]) / len(records)


def other_rate(records: list[dict]) -> float | None:
    if not records:
        return None
    return sum(1 for r in records if r["choice"] == "Other") / len(records)


def coverage_at_accuracy(records: list[dict], targets=COVERAGE_TARGETS, min_n: int = MIN_COVERED_N) -> list[dict]:
    """For each target accuracy, the largest coverage reachable by answering
    only at or above some confidence threshold while accuracy among the
    covered rows stays at or above the target (and at least `min_n` rows are
    covered, so a lucky handful cannot qualify)."""
    scored = sorted(
        ((r["confidence"], r["choice"] == r["label"]) for r in records
         if r.get("confidence") is not None and r.get("choice") is not None and r.get("label") is not None),
        key=lambda x: -x[0],
    )
    total = len(scored)
    rows = []
    for target in targets:
        best = {"target": target, "coverage": None, "threshold": None, "n": 0}
        correct = 0
        for i, (conf, ok) in enumerate(scored, 1):
            correct += ok
            # only evaluate at the end of a run of tied confidences
            if i < total and scored[i][0] == conf:
                continue
            if i >= min_n and correct / i >= target:
                best = {"target": target, "coverage": i / total, "threshold": conf, "n": i}
        rows.append(best)
    return rows


def agreement_between(jev: list[dict], haiku: list[dict]) -> dict:
    """Fraction of rows (both judges answered) where the two choices match."""
    h = {r["row_id"]: r["choice"] for r in haiku if r.get("choice") is not None and "row_id" in r}
    pairs = [(r["choice"], h[r["row_id"]]) for r in jev if r.get("choice") is not None and r.get("row_id") in h]
    n = len(pairs)
    same = sum(1 for a, b in pairs if a == b)
    return {"n": n, "same": same, "rate": (same / n) if n else None}


def fit_calibration(jev_all: list[dict], split: dict[str, str] | None, fit_bucket: str = "tune") -> float:
    fit_rows, _ = partition_answerable(in_bucket(jev_all, split, fit_bucket), split)
    return calibrate.fit_temperature(fit_rows)


def _coverage_table(rows: list[dict]) -> list[str]:
    out = ["| target accuracy | max coverage | confidence threshold | rows covered |", "| --- | --- | --- | --- |"]
    for r in rows:
        thr = "n/a" if r["threshold"] is None else f"{r['threshold']:.2f}"
        out.append(f"| {_fmt_pct(r['target'])} | {_fmt_pct(r['coverage'])} | {thr} | {r['n']} |")
    return out


def render_judge_section(name: str, records: list[dict] | None, split: dict[str, str] | None, bucket: str,
                         temperature: float | None = None, other_records: list[dict] | None = None,
                         other_name: str = "") -> str:
    if not records:
        return f"## {name}\n\n_No results file yet -- run the corresponding runner first._\n"
    scoped = in_bucket(records, split, bucket)
    answerable, unanswerable = partition_answerable(scoped, split)
    errors = sum(1 for r in scoped if r.get("choice") is None and r not in unanswerable)

    lines = [f"## {name}", ""]
    lines.append(f"- Answerable rows: {len(answerable)}; accuracy on answerable rows: {_fmt_pct(accuracy(answerable))}")
    lines.append(f"- Unanswerable (zero examples or excluded gold label, not scored): {len(unanswerable)}")
    if errors:
        lines.append(f"- Rows with no answer (errors): {errors}")
    lines.append(f"- Share of answers that are Other: {_fmt_pct(other_rate(answerable))}")
    if bucket == "all":
        gold = agreement([r for r in answerable], "user")
        silver = agreement([r for r in answerable], "llm")
        lines.append(f"- Gold: {gold['correct']}/{gold['n']} = {_fmt_pct(gold['accuracy'])}; silver: {silver['correct']}/{silver['n']} = {_fmt_pct(silver['accuracy'])}")
    if other_records:
        o_scoped, _ = partition_answerable(in_bucket(other_records, split, bucket), split)
        ag = agreement_between(answerable, o_scoped)
        lines.append(f"- Agreement with {other_name}: {ag['same']}/{ag['n']} = {_fmt_pct(ag['rate'])}")
    lat = latency_stats(scoped)
    lines.append(f"- Latency: median {lat['median_ms']} ms, p95 {lat['p95_ms']} ms (n={lat['n']})")

    has_conf = any(r.get("confidence") is not None for r in answerable)
    if has_conf:
        _, ece = calibration_and_ece(answerable)
        lines.append(f"- ECE raw: {ece:.4f}" if ece is not None else "- ECE raw: n/a")
        calibrated = None
        if temperature is not None:
            calibrated = calibrate.apply_temperature(answerable, temperature)
            _, ece_c = calibration_and_ece(calibrated)
            lines.append(f"- Temperature fitted on tune: T = {temperature:.2f}; ECE calibrated: {ece_c:.4f}" if ece_c is not None else "- ECE calibrated: n/a")
        lines += ["", "### Coverage at accuracy, raw confidence"] + _coverage_table(coverage_at_accuracy(answerable))
        if calibrated is not None:
            lines += ["", "### Coverage at accuracy, calibrated confidence"] + _coverage_table(coverage_at_accuracy(calibrated))
    lines.append("")

    lines.append("### Top confusions (true -> predicted)")
    conf = confusion_pairs(answerable)
    if conf:
        lines += ["| true | predicted | count |", "| --- | --- | --- |"]
        lines += [f"| {c['true']} | {c['pred']} | {c['count']} |" for c in conf]
    else:
        lines.append("_none_")
    lines.append("")
    return "\n".join(lines)


def build_variant_report(variant: str, bucket: str, split: dict[str, str] | None, jev: list[dict] | None,
                         haiku: list[dict] | None, calibrate_from: str | None) -> str:
    temperature = fit_calibration(jev, split, calibrate_from) if (calibrate_from and jev) else None
    parts = [f"# G178 report: variant {variant}, bucket {bucket}", ""]
    if split is not None:
        counts = Counter(split.values())
        parts.append("Split: " + ", ".join(f"{b} {counts.get(b, 0)}" for b in ("tune", "holdout", "silver", "unanswerable")))
        parts.append("")
    parts.append(render_judge_section(f"Jev ({variant})", jev, split, bucket, temperature, haiku, "Haiku"))
    parts.append(render_judge_section(f"Haiku ({variant})", haiku, split, bucket, None, jev, "Jev"))
    return "\n".join(parts)


def build_compare(variants: list[str], bucket: str, split: dict[str, str] | None) -> str:
    header = ["variant", "n answerable", "Jev acc", "Other share", "ECE raw", "ECE cal", "cov@90 raw", "cov@90 cal", "Haiku acc", "Jev-Haiku agree"]
    lines = [f"# G178 variant comparison, bucket {bucket}", "",
             "| " + " | ".join(header) + " |", "|" + " --- |" * len(header)]
    for v in variants:
        jev = read_jsonl(results_path("jev", v))
        haiku = read_jsonl(results_path("haiku", v))
        if not jev:
            lines.append(f"| {v} | no results |" + " |" * (len(header) - 2))
            continue
        ans, _ = partition_answerable(in_bucket(jev, split, bucket), split)
        t = fit_calibration(jev, split, "tune")
        cal = calibrate.apply_temperature(ans, t)
        _, ece = calibration_and_ece(ans)
        _, ece_c = calibration_and_ece(cal)
        c_raw = coverage_at_accuracy(ans)[1]["coverage"]
        c_cal = coverage_at_accuracy(cal)[1]["coverage"]
        h_ans, _ = partition_answerable(in_bucket(haiku, split, bucket), split)
        ag = agreement_between(ans, h_ans) if h_ans else {"rate": None}
        f4 = lambda x: "n/a" if x is None else f"{x:.3f}"
        lines.append("| " + " | ".join([
            v, str(len(ans)), _fmt_pct(accuracy(ans)), _fmt_pct(other_rate(ans)), f4(ece), f4(ece_c),
            _fmt_pct(c_raw), _fmt_pct(c_cal), _fmt_pct(accuracy(h_ans)) if h_ans else "n/a", _fmt_pct(ag["rate"]),
        ]) + " |")
    lines.append("")
    lines.append("ECE cal uses a temperature fitted on the tune bucket of the same variant.")
    return "\n".join(lines)


def build_errors_dump(variant: str, bucket: str, split: dict[str, str] | None, dataset_rows: list[dict],
                      jev: list[dict], haiku: list[dict]) -> str:
    """Per-row misses WITH merchant names: for the diagnosis step only,
    written to the gitignored out/ directory and never printed."""
    by_id = {make_row_id(r["scope"], r["uid_hash"], r["merchant_key"]): r for r in dataset_rows}
    h = {r["row_id"]: r for r in haiku if "row_id" in r}
    answerable, _ = partition_answerable(in_bucket(jev, split, bucket), split)
    wrong = sorted((r for r in answerable if r["choice"] != r["label"]), key=lambda r: -(r.get("confidence") or 0))
    lines = [f"# Jev misses: variant {variant}, bucket {bucket}", "",
             f"{len(wrong)} wrong of {len(answerable)} answerable. Contains merchant names; do not commit or paste into any prompt.", ""]
    for r in wrong:
        ds = by_id.get(r["row_id"], {})
        desc = (ds.get("examples") or [{}])[0].get("description", "")
        hc = (h.get(r["row_id"]) or {}).get("choice")
        lines.append(f"- {r['merchant_key']!r} | {desc!r} | gold {r['label']} | Jev {r['choice']} ({r.get('confidence')}) | Haiku {hc}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--variant", default="v0_baseline")
    ap.add_argument("--bucket", default="all", choices=["tune", "holdout", "silver", "all"])
    ap.add_argument("--calibrate-from", choices=["tune"], default=None)
    ap.add_argument("--compare", default=None, help="comma-separated variant names")
    ap.add_argument("--errors", action="store_true")
    args = ap.parse_args()

    dataset_rows = read_jsonl(DATASET_PATH)
    split = load_split() or (make_split(dataset_rows) if dataset_rows else None)

    if args.compare:
        names = [n.strip() for n in args.compare.split(",") if n.strip()]
        for n in names:
            get_variant(n)
        text = build_compare(names, args.bucket, split)
        print(text)
        return

    get_variant(args.variant)
    jev = read_jsonl(results_path("jev", args.variant)) or None
    haiku = read_jsonl(results_path("haiku", args.variant)) or None
    text = build_variant_report(args.variant, args.bucket, split, jev, haiku, args.calibrate_from)
    print(text)
    path = OUT_DIR / f"report.{args.variant}.{args.bucket}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"\n(written to {path})", file=sys.stderr)
    if args.errors:
        if not jev:
            print("no Jev results for this variant; nothing to dump", file=sys.stderr)
        else:
            epath = OUT_DIR / f"errors.{args.variant}.{args.bucket}.md"
            epath.write_text(build_errors_dump(args.variant, args.bucket, split, dataset_rows, jev, haiku or []), encoding="utf-8")
            print(f"(errors dump with merchant names written to {epath})", file=sys.stderr)


if __name__ == "__main__":
    main()
