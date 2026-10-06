"""G217: set-aside (allocation) shortfalls, kept apart from bill shortfalls.

An account can clear every payment this pay period and still go short once the
set-asides assigned to it (allocations and goal contributions) are applied.
That is a plan the user chose, not a payment at risk, so it is computed here,
separately, and never feeds the bill walk (`walk_sort_key` lockstep) or any
bill shortfall output.

The arithmetic deliberately mirrors the account sheet's own line
(`frontend/lib/upcomingPlans.ts` `accountPlan`): the sheet's "£X more needed
for plans" and this card's "£X short this period" are the same number.

  gap = max(0, -(closing - reserved)) - max(0, -closing)

so a bill-driven deficit is never attributed to a set-aside. All sums are in
integer pence.
"""
from __future__ import annotations

import math
from typing import Any

from app.core.config import ALLOCATION_SHORTFALL_FLOOR_PENCE


def _pence(value: Any) -> int | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v < 0:
        return None
    return int(round(v * 100))


def has_plan_source(plan: dict) -> bool:
    """Same predicate as the frontend's `hasPlanSource`."""
    sid = plan.get("source_account_id")
    if not sid:
        return False
    basis = plan.get("source_basis")
    return basis == "chosen" or (plan.get("kind") == "allocation" and basis == "recent-transfers")


def _remaining_pence(plan: dict) -> int | None:
    """Pence still owing, or None when the plan cannot be read.

    Parity with the sheet's `amountUnavailable`: remaining, period_amount and
    filled_amount (None is fine for a goal) must all be finite and non-negative.
    """
    if not plan.get("active"):
        return 0
    filled = plan.get("filled_amount")
    if _pence(plan.get("period_amount")) is None or (filled is not None and _pence(filled) is None):
        return None
    return _pence(plan.get("remaining"))


def compute_allocation_gaps(
    plans: list[dict],
    closing_by_account: dict[str, float],
    *,
    movement_out: dict[str, list[str | None]] | None = None,
    floor_pence: int | None = None,
) -> list[dict]:
    """One entry per account whose set-asides push it short, material only.

    `plans` are `GET /account-plans` rows. `closing_by_account` is each
    account's end-of-period balance after payments (the same walk the bill
    engine ran). `movement_out` maps an account to the destinations of its
    forecast own-transfers this period (None when the destination is unknown):
    a dated move might also fill a plan, so the combined total is unknown and,
    like the sheet, nothing is claimed.

    An account is skipped (calm, never guessed) when any assigned plan has an
    unreadable amount, when plans share a source and a receiving pot, or when
    a forecast transfer might double-count. An account with no allocation
    still owing money is skipped too: a goal-only gap has no set-aside to
    reduce here.
    """
    floor = ALLOCATION_SHORTFALL_FLOOR_PENCE if floor_pence is None else floor_pence
    movement_out = movement_out or {}
    by_account: dict[str, list[dict]] = {}
    for plan in plans:
        if plan.get("active") and has_plan_source(plan):
            by_account.setdefault(str(plan["source_account_id"]), []).append(plan)

    out: list[dict] = []
    for account_id in sorted(by_account):
        assigned = by_account[account_id]
        if account_id not in closing_by_account:
            continue
        closing = int(round(float(closing_by_account[account_id]) * 100))
        amounts = [(_remaining_pence(p), p) for p in assigned]
        if any(a is None for a, _ in amounts):
            continue  # an unreadable amount: say nothing rather than guess
        owing = [(a, p) for a, p in amounts if a and a > 0]
        if not owing:
            continue
        if any(
            dest is None or dest in (p.get("destination_account_ids") or [])
            for dest in movement_out.get(account_id, [])
            for _, p in owing
        ):
            continue
        if _shares_receiving_pot(owing):
            continue
        reserved = sum(a for a, _ in owing)
        after = closing - reserved
        gap = max(0, -after) - max(0, -closing)
        if gap < max(1, floor):
            continue
        allocations = sorted(
            ((a, p) for a, p in owing if p.get("kind") == "allocation"),
            key=lambda t: (-t[0], str(t[1].get("name") or "").lower(), str(t[1].get("record_id") or "")),
        )
        if not allocations:
            continue
        estimated = any(p.get("source_basis") == "recent-transfers" for _, p in allocations)
        out.append({
            "account_id": account_id,
            "gap_pence": gap,
            "gap": round(gap / 100, 2),
            "estimated": estimated,
            "allocations": [
                {
                    "id": str(p.get("record_id") or ""),
                    "name": p.get("name") or "Set-aside",
                    "remaining": round(a / 100, 2),
                    "period_amount": round((_pence(p.get("period_amount")) or 0) / 100, 2),
                }
                for a, p in allocations
            ],
        })
    # Largest gap first, then account id, so several short accounts always
    # surface in the same order.
    out.sort(key=lambda g: (-g["gap_pence"], g["account_id"]))
    return out


def _shares_receiving_pot(owing: list[tuple[int, dict]]) -> bool:
    """Two plans on one source that fill the same pot may describe one pot of
    money; the sheet declines to total them, so this does too."""
    for i, (_, a) in enumerate(owing):
        a_dest = set(a.get("destination_account_ids") or [])
        for _, b in owing[i + 1:]:
            if a_dest & set(b.get("destination_account_ids") or []):
                return True
    return False


def suggested_reduced_amount(allocation: dict, gap: float) -> float:
    """The per-period amount that clears `gap` for this period, never below the
    £0.01 the edit form accepts."""
    cut = min(gap, allocation["remaining"])
    return max(0.01, round(allocation["period_amount"] - cut, 2))
