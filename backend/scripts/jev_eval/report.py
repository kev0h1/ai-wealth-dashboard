"""G178 deliverable 5: read both result files (either or both may not exist
yet) and print + write `out/report.md` covering agreement with gold/silver
labels, confusion, calibration/ECE, the abstain curve, latency, and cost.

Every function below is pure (list[dict] in, dict/list out) so
`tests/test_jev_eval.py` can exercise the maths on a tiny hand-built
fixture without touching either result file.

Usage (from backend/):
    .venv/bin/python -m scripts.jev_eval.report
"""
from __future__ import annotations

import math
import statistics
import sys
from collections import Counter

from scripts.jev_eval.common import (
    DATASET_PATH, HAIKU_RESULTS_PATH, JEV_RESULTS_PATH, REPORT_PATH, read_jsonl,
)

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

    parts.append(render_section("Jev (jev-1.13)", jev_records))
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


def main() -> None:
    dataset_rows = read_jsonl(DATASET_PATH)
    jev_records = read_jsonl(JEV_RESULTS_PATH) or None
    haiku_records = read_jsonl(HAIKU_RESULTS_PATH) or None

    report = build_report(dataset_rows, jev_records, haiku_records)
    print(report)
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(f"\n(written to {REPORT_PATH})", file=sys.stderr)


if __name__ == "__main__":
    main()
