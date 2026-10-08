"""G178 tuning round: temperature scaling for Jev's probability vectors.

Pure functions, no scipy. Jev returns a probability per option; we treat
log(p) as logits, divide by a temperature T and renormalise. T > 1 softens
an overconfident judge, T < 1 sharpens an underconfident one. T is fitted
by grid search minimising negative log-likelihood of the gold label on one
bucket (tune), then applied unchanged to another (holdout).

The argmax never changes under scaling, so the answer is untouched; only
the confidence moves.
"""
from __future__ import annotations

import math

#: Jev rounds probabilities to 2 decimal places, so a printed 0.0 means
#: "under 0.005". Floor at 1e-3 before taking logs.
EPS = 1e-3

#: Geometric grid from 0.25 to 10.
TEMPERATURE_GRID = [0.25 * (40 ** (i / 199)) for i in range(200)]


def scaled_probs(probs: dict[str, float], temperature: float) -> dict[str, float]:
    logits = {k: math.log(max(float(v), EPS)) / temperature for k, v in probs.items()}
    m = max(logits.values())
    exps = {k: math.exp(v - m) for k, v in logits.items()}
    total = sum(exps.values())
    return {k: v / total for k, v in exps.items()}


def _fit_rows(records: list[dict]) -> list[tuple[dict, str]]:
    return [
        (r["probabilities"], r["label"])
        for r in records
        if r.get("probabilities") and r.get("label") in (r.get("probabilities") or {})
    ]


def nll(records: list[dict], temperature: float) -> float | None:
    rows = _fit_rows(records)
    if not rows:
        return None
    total = 0.0
    for probs, label in rows:
        total -= math.log(max(scaled_probs(probs, temperature)[label], 1e-12))
    return total / len(rows)


def fit_temperature(records: list[dict], grid: list[float] = TEMPERATURE_GRID) -> float:
    """Grid-search the NLL-minimising temperature. Returns 1.0 (no change)
    when no row has a usable probability vector and in-vector gold label."""
    best_t, best = 1.0, None
    for t in grid:
        v = nll(records, t)
        if v is not None and (best is None or v < best):
            best_t, best = t, v
    return best_t


def apply_temperature(records: list[dict], temperature: float) -> list[dict]:
    """Copies of `records` with `confidence` replaced by the calibrated
    probability of the recorded choice (raw value kept as raw_confidence).
    Rows without a probability vector keep their raw confidence."""
    out = []
    for r in records:
        rec = dict(r)
        probs = r.get("probabilities")
        if probs:
            sp = scaled_probs(probs, temperature)
            choice = r.get("choice")
            rec["raw_confidence"] = r.get("confidence")
            rec["confidence"] = sp[choice] if choice in sp else max(sp.values())
        out.append(rec)
    return out
