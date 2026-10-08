"""G238: ONE per-account "after payments and plans" figure.

Upcoming's account sheet (frontend/lib/upcomingPlans.ts `accountPlan`) and
Home's "Spend from" used to compute two different numbers for the same
account: the sheet deducted the plans attributed to the account from its
end-of-period closing balance, Home deducted only the account's own bills and
a buffer. This module is the single server-side definition both read.

  after_payments            the account's end-of-period balance after its
                            payments: the SAME walk figure the allocation
                            shortfall card (G217) already uses as "closing".
  plans_reserved            remaining of active allocations and goals whose
                            paying account is this one (G230 rules: chosen
                            source, or a source inferred from recent
                            transfers, which makes the figure estimated).
                            Unassigned plans are NOT attributed; they stay
                            pool-only (the pooled Safe to Spend deducts them).
  after_payments_and_plans  after_payments - plans_reserved.
  uncertain                 an attributed plan has no readable amount, or may
                            overlap a forecast move (G235 rule, ported from
                            `assessPlanOverlap`): the figure is None and must
                            not be shown as Spend from.

All sums are in integer pence. Pure functions: no I/O.
"""
from __future__ import annotations

from app.services.allocation_shortfall import _remaining_pence, has_plan_source

# Same tolerance as frontend PLAN_OVERLAP_TOLERANCE (G235).
PLAN_OVERLAP_TOLERANCE = 0.15


def _plan_remaining_pence(plan: dict) -> int:
    """Pence still owing; 0 when the plan is inactive or unreadable (callers
    check readability separately)."""
    return _remaining_pence(plan) or 0


def _is_card_repayment(move: dict, credit_account_ids: set[str]) -> bool:
    if str(move.get("category") or "").strip().lower() == "debt":
        return True
    dest = move.get("dest_account_id")
    return bool(dest and str(dest) in credit_account_ids)


def assess_overlap(
    plans: list[dict], movements: list[dict], credit_account_ids: set[str],
) -> dict[str, bool]:
    """record key -> overlap uncertain, for every plan that is active, owing
    money and has a source. Mirrors the client `assessPlanOverlap` (G235):
    a plan is uncertain when it shares a source and a receiving pot with
    another owing plan, or when a forecast movement from its source could be
    its own contribution (goes to one of its destinations, or has an unknown
    destination, is not a card repayment and sits within +/-15% of the slice).
    `movements` are movement bills inside the window; credit-card and observed_pending ones are skipped here."""
    out: dict[str, bool] = {}
    for idx, plan in enumerate(plans):
        if not plan.get("active") or _plan_remaining_pence(plan) == 0 or not has_plan_source(plan):
            continue
        src = str(plan.get("source_account_id"))
        dests = set(plan.get("destination_account_ids") or [])
        shared = any(
            j != idx and other.get("active") and _plan_remaining_pence(other) > 0
            and str(other.get("source_account_id")) == src and has_plan_source(other)
            and dests & set(other.get("destination_account_ids") or [])
            for j, other in enumerate(plans)
        )
        slice_ = _plan_remaining_pence(plan) / 100
        move = False
        for m in movements:
            # Same exclusions as the client: card charges and observed-pending
            # (settling) moves. An overdue, unobserved `pending` move still counts.
            if m.get("is_credit_card") or m.get("observed_pending"):
                continue
            if str(m.get("account_id") or "") != src:
                continue
            dest = m.get("dest_account_id")
            if dest:
                if str(dest) in dests:
                    move = True
                    break
            elif (
                not _is_card_repayment(m, credit_account_ids)
                and abs(abs(float(m.get("amount") or 0)) - slice_) <= slice_ * PLAN_OVERLAP_TOLERANCE
            ):
                move = True
                break
        out[str(idx)] = shared or move
    return out


def compute_account_positions(
    plans: list[dict],
    closing_by_account: dict[str, float | None],
    *,
    movements: list[dict] | None = None,
    credit_account_ids: set[str] | None = None,
) -> dict[str, dict]:
    """Per-account position for every account in `closing_by_account`."""
    movements = movements or []
    overlap = assess_overlap(plans, movements, credit_account_ids or set())
    out: dict[str, dict] = {}
    for sid, closing in closing_by_account.items():
        assigned = [
            (idx, p) for idx, p in enumerate(plans)
            if p.get("active") and has_plan_source(p) and str(p.get("source_account_id")) == sid
        ]
        uncertain = any(
            _remaining_pence(p) is None or overlap.get(str(idx), False) for idx, p in assigned
        )
        estimated = any(
            p.get("source_basis") == "recent-transfers" and (_remaining_pence(p) is None or _plan_remaining_pence(p) > 0)
            for _, p in assigned
        )
        reserved = sum(_plan_remaining_pence(p) for _, p in assigned if _remaining_pence(p) is not None)
        after_payments = None if closing is None else int(round(float(closing) * 100))
        after_plans = None if (after_payments is None or uncertain) else after_payments - reserved
        out[sid] = {
            "after_payments": None if after_payments is None else round(after_payments / 100, 2),
            "plans_reserved": round(reserved / 100, 2),
            "after_payments_and_plans": None if after_plans is None else round(after_plans / 100, 2),
            "uncertain": bool(uncertain),
            "estimated": bool(estimated),
        }
    return out



def seed_spend_from(position: dict) -> float:
    """The per-account figure `cap_spend_from_to_pool` then clamps to the pool:
    after payments and plans, or 0 (not shown) when it is uncertain or unknown."""
    if position.get("uncertain") or position.get("after_payments_and_plans") is None:
        return 0.0
    return float(position["after_payments_and_plans"])
