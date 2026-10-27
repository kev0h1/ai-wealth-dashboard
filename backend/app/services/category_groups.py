"""Read-model helpers for the category grouping editor (G347).

The editor deliberately consumes Money Shape's persisted evidence.  It must
not re-classify live transactions: a saved choice should be visible even when
the underlying feed is temporarily unavailable.
"""
from __future__ import annotations

import hashlib
import json

from app.services.categories import (
    BUILTIN_CATEGORIES, BUILTIN_CATEGORY_KINDS, COMMITMENT, DISCRETIONARY,
    EXCLUDED, INCOME, MOVEMENT, normalise_name,
)

EDITABLE_KINDS = (COMMITMENT, DISCRETIONARY, MOVEMENT, EXCLUDED)
EVIDENCE_KEYS = ("fixed", "moved", "free", "excluded", "income")


def revision_for(custom: list[dict]) -> str:
    """Stable revision over persisted custom metadata, independent of order."""
    canonical = sorted(
        (
            str(c.get("name", "")),
            str(c.get("kind", "")),
            str(c.get("default_kind", c.get("kind", ""))),
        )
        for c in custom
    )
    encoded = json.dumps(canonical, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def evidence_index(shape: dict) -> dict[str, dict]:
    """Normalise the optional persisted evidence list by category name."""
    result: dict[str, dict] = {}
    for item in shape.get("group_evidence") or []:
        if isinstance(item, dict) and isinstance(item.get("name"), str):
            key = normalise_name(item["name"])
            prior = result.setdefault(key, {"name": item["name"], **{k: 0.0 for k in EVIDENCE_KEYS}, "editable_amount": 0.0})
            for field in (*EVIDENCE_KEYS, "editable_amount"):
                prior[field] += _number(item.get(field))
    return result


def _number(value) -> float:
    return float(value) if isinstance(value, (int, float)) else 0.0


def rows_for(custom: list[dict], shape: dict) -> list[dict]:
    """Combine category metadata with persisted classified contributions."""
    thin = shape.get("status") != "ok" or not shape.get("period")
    evidence = evidence_index(shape)
    rows: list[dict] = []
    for name in BUILTIN_CATEGORIES:
        kind = BUILTIN_CATEGORY_KINDS[name]
        rows.append(_row(name, kind, kind, False, _builtin_reason(name), evidence.get(normalise_name(name)), thin))
    for category in custom:
        name = category["name"]
        kind = category["kind"]
        default = category.get("default_kind") or kind
        rows.append(_row(name, kind, default, kind != INCOME, "Income is managed automatically." if kind == INCOME else None, evidence.get(normalise_name(name)), thin))
    known = {normalise_name(row["name"]) for row in rows}
    for key, contribution in evidence.items():
        if key not in known:
            rows.append(_row(contribution["name"], DISCRETIONARY, DISCRETIONARY, False,
                             "This category has no saved meaning yet, so it counts as Free.", contribution, thin))
    return rows


def _row(name, kind, default_kind, editable, reason, evidence, thin) -> dict:
    contributions = {
        key: (None if thin else _number((evidence or {}).get(key)))
        for key in EVIDENCE_KEYS
    }
    if thin:
        amount = editable_amount = None
    elif kind == INCOME:
        amount = contributions["income"]
        editable_amount = None if not editable else _number((evidence or {}).get("editable_amount"))
    else:
        amount = sum(contributions[key] or 0.0 for key in EVIDENCE_KEYS[:-1])
        editable_amount = None if not editable else _number((evidence or {}).get("editable_amount"))
    return {
        "name": name,
        "kind": kind,
        "default_kind": default_kind,
        "editable": editable,
        "reason": reason,
        "amount": amount,
        "editable_amount": editable_amount,
        "contributions": contributions,
        "allowed_kinds": list(EDITABLE_KINDS) if editable else [],
    }


def response_for(custom: list[dict], shape: dict) -> dict:
    rows = rows_for(custom, shape)
    return {
        "revision": revision_for(custom),
        "period": shape.get("period") if shape.get("status") == "ok" else None,
        "rows": rows,
        "spending_total": (_spending_total(shape) if shape.get("status") == "ok" else None),
        "changed_count": sum(1 for c in custom if c.get("kind") != (c.get("default_kind") or c.get("kind"))),
    }


def _spending_total(shape: dict) -> float:
    """Only Fixed and Free are spending; Moved/excluded are not Out."""
    return sum(_number(job.get("amount")) for job in (shape.get("jobs") or []) if job.get("id") in {"fixed", "free"})


def _builtin_reason(name: str) -> str:
    if name == "Debt":
        return "Loan repayments count in Fixed. Card repayments are excluded because the purchases already count."
    if name == "Transfer":
        return "Confirmed transfers between your accounts count in Moved. Unmatched transfers are not counted in the split."
    if name in ("Savings", "Investment"):
        return "Money transferred into savings or investments is counted once in Moved."
    if name == "Income":
        return "Income is managed automatically."
    return "Built-in categories are fixed."
