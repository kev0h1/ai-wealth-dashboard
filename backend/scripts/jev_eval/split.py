"""G178 tuning round: frozen, stratified tune/holdout split.

`make_split` tags every dataset row with one bucket:

  - "tune" / "holdout": GOLD rows (label_source == "user") that a judge can
    actually answer, split per label (stratified) with a seeded shuffle.
  - "unanswerable": GOLD rows with zero example lines, or whose gold label
    is one of EXCLUDED_FROM_CHOICE (e.g. Transfer), which is never offered
    as an option. Tagged, never split, excluded from accuracy.
  - "silver": every non-gold row (supporting evidence only).

Deterministic: same rows and seed always give the same split, independent
of row order. CLI: `python -m scripts.jev_eval.split` writes out/split.json.
"""
from __future__ import annotations

import json
import random
import sys
from collections import Counter, defaultdict

from scripts.jev_eval.common import (
    DATASET_PATH, EXCLUDED_FROM_CHOICE, OUT_DIR, ensure_out_dir, read_jsonl,
    print_err, row_id as make_row_id,
)

SPLIT_PATH = OUT_DIR / "split.json"
BUCKETS = ("tune", "holdout", "silver", "unanswerable")


def _rid(row: dict) -> str:
    return make_row_id(row["scope"], row["uid_hash"], row["merchant_key"])


def is_unanswerable(row: dict) -> bool:
    return len(row.get("examples") or []) == 0 or row.get("label") in EXCLUDED_FROM_CHOICE


def make_split(rows: list[dict], seed: int = 178, tune_fraction: float = 0.6) -> dict[str, str]:
    out: dict[str, str] = {}
    by_label: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        rid = _rid(row)
        if row.get("label_source") != "user":
            out[rid] = "silver"
        elif is_unanswerable(row):
            out[rid] = "unanswerable"
        else:
            by_label[row["label"]].append(rid)

    for label in sorted(by_label):
        ids = sorted(by_label[label])
        random.Random(f"{seed}:{label}").shuffle(ids)
        n = len(ids)
        n_tune = n if n == 1 else max(1, min(n - 1, round(n * tune_fraction)))
        for i, rid in enumerate(ids):
            out[rid] = "tune" if i < n_tune else "holdout"
    return out


def load_split() -> dict[str, str] | None:
    if not SPLIT_PATH.exists():
        return None
    return json.loads(SPLIT_PATH.read_text(encoding="utf-8"))


def filter_rows_by_bucket(rows: list[dict], bucket: str, split: dict[str, str] | None) -> list[dict]:
    """`bucket` in tune|holdout|silver|all. Raises SystemExit when a bucket
    other than all is requested and no split is available."""
    if bucket == "all":
        return rows
    if bucket not in ("tune", "holdout", "silver"):
        raise SystemExit(f"unknown bucket {bucket!r}; choose tune, holdout, silver or all")
    if split is None:
        raise SystemExit(f"{SPLIT_PATH} is missing -- run `python -m scripts.jev_eval.split` first.")
    return [r for r in rows if split.get(_rid(r)) == bucket]


def main() -> None:
    rows = read_jsonl(DATASET_PATH)
    if not rows:
        print_err(f"{DATASET_PATH} is empty or missing -- run `python -m scripts.jev_eval.dataset` first.")
        sys.exit(1)
    split = make_split(rows)
    ensure_out_dir()
    SPLIT_PATH.write_text(json.dumps(split, indent=1, sort_keys=True), encoding="utf-8")
    print(f"wrote {SPLIT_PATH} ({len(split)} rows)")
    print("\nrows per bucket:")
    for b in BUCKETS:
        print(f"  {b}: {sum(1 for v in split.values() if v == b)}")
    print("\nrows per label (gold answerable: tune / holdout):")
    per: dict[str, Counter] = defaultdict(Counter)
    for row in rows:
        b = split[_rid(row)]
        if b in ("tune", "holdout"):
            per[row["label"]][b] += 1
    for label in sorted(per):
        print(f"  {label}: {per[label]['tune']} / {per[label]['holdout']}")


if __name__ == "__main__":
    main()
