"""G496: the structured last-resort suggestion for an account that still has an
uncovered gap after every other source (current-account spare, then savings).

Read-only and a recommendation only: it names the active goals and set-asides
paid from that account and how much reviewing each could free. It never reserves
or moves anything, and it never decides for the user (plans and set-asides never
trade cash automatically).
"""
from __future__ import annotations

_EPS = 0.005


def _gbp(x: float) -> str:
    n = int(round(x))
    return f"{'−' if n < 0 else ''}£{abs(n):,}"


def build_last_resort(account_id: str, gap: float, plans: list[dict]) -> dict | None:
    """`plans` are the `GET /account-plans` rows. Returns None unless there is
    an uncovered gap and at least one eligible goal or set-aside."""
    gap = round(float(gap or 0.0), 2)
    if gap <= 0.5 or not account_id:
        return None
    eligible = []
    for p in plans:
        if not p.get("active") or p.get("plan_kind") == "card_repayment":
            continue
        if p.get("kind") not in ("goal", "allocation"):
            continue
        if str(p.get("source_account_id") or "") != str(account_id):
            continue
        remaining = round(float(p.get("remaining") or 0.0), 2)
        if remaining <= _EPS:
            continue
        eligible.append((remaining, str(p.get("name") or "").strip() or "Plan", p))
    if not eligible:
        return None
    eligible.sort(key=lambda e: (-e[0], e[1].lower(), str(e[2].get("id") or "")))
    options = [
        {
            "plan_id": str(p.get("id") or ""),
            "record_id": str(p.get("record_id") or ""),
            "kind": "goal" if p.get("kind") == "goal" else "set_aside",
            "name": name,
            "remaining": remaining,
            "frees": round(min(remaining, gap), 2),
            "covers_gap": remaining >= gap - _EPS,
        }
        for remaining, name, p in eligible
    ]
    total = round(min(sum(o["remaining"] for o in options), gap), 2)
    first = options[0]
    noun = "goal" if first["kind"] == "goal" else "set-aside"
    if len(options) == 1:
        sentence = (
            f"If you still need it, reviewing your {first['name']} {noun} "
            f"could free up to {_gbp(first['frees'])}."
        )
    else:
        sentence = (
            f"If you still need it, reviewing your {first['name']} {noun} "
            f"or another plan on this account could free up to {_gbp(total)}."
        )
    return {
        "gap": gap,
        "total_frees": total,
        "covers_gap": sum(o["remaining"] for o in options) >= gap - _EPS,
        "sentence": sentence,
        "options": options,
    }
