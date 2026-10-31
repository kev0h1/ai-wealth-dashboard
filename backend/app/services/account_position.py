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

G366 (money engine step 4): the positions are DERIVED FROM THE WALK OUTPUT.
`compute_account_positions_from_walks` reads each account's closing from the
closing walk's `AccountWalk` (companion's W2, `walk_events(walks_out=...)`) and
its low point from the source low-point walk's `AccountWalk` (W3,
`source_low_walk`), so After payments, Lowest (`low_point`), the Spend from seed
(`seed_spend_from`), source safety (`source_min_run`) and the Accounts list
warning are all read from one pair of objects instead of two hand-built maps.
`compute_account_positions` is unchanged: it stays the one kernel (the
frontend parity fixture calls it with plain numbers), and
`cap_spend_from_to_pool` stays the one pool cap. NO behaviour change: where the
old hand assembly and the walk results differ, the difference is a keyword
whose default is the OLD behaviour (PD1 to PD4 below), not unified silently.

| Id  | Difference | Keyword | Default (old behaviour) | Other value |
|-----|------------|---------|--------------------------|-------------|
| PD1 | Which accounts get a position | `accounts` | `"eligible"`: every id passed (every entry of `account_eligibility_out`, i.e. every source-eligible account, walked or not) | `"walked"`: only an account the closing walk touched |
| PD2 | Closing for an account the closing walk never touched (no bill, no funded inflow, not the preview salary account: an idle account, a manual account) | `closing_fallback` | `"live"`: its live balance, else 0.0 (what `running.get(sid, live_balances.get(sid, 0.0))` gave; an overdraft account seeded into `running` is the same live balance) | `"none"`: closing unknown, so After payments and the plan figures are None |
| PD3 | Low point taken before the allocation reservation | `low_point_basis` | `"pre_reservation"`: the walk's own `low_point`, because `plans_reserved` already takes the plans off once (R3 not deducted twice) | `"post_reservation"`: `low_point` less `reserved_by_source[sid]`, the figure `source_capacity` uses (R3 deducted a second time for an allocation-funded plan) |
| PD4 | Preview salary on the low-point walk | `source_low_walk(preview_salary=...)` | none: the closing walk credits the payday-plan salary on its account (and seeds a bill-less salary account at its live balance), the low-point walk never credits it | the salary event is walked on its account too (a credit cannot lower a low point, so the figure is unchanged for non-negative amounts) |
| PD5 | Uncertain and estimated flags | none | read from the plans exactly as before (same kernel) | no difference to table |
"""
from __future__ import annotations

from typing import Any, Mapping

from app.services.account_walk import AccountWalk, walk_account
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
    low_point_by_account: dict[str, float | None] | None = None,
) -> dict[str, dict]:
    """Per-account position for every account in `closing_by_account`.

    `low_point_by_account` (Kevin 2026-10-09, "yes clamp") is each account's
    mid-period minimum running balance (`source_min_run`, taken BEFORE the
    allocation reservation so allocation-funded plans are not deducted twice:
    they come off once, via `plans_reserved`). Spend from may never exceed
    `low_point_and_plans`, because spending that much today would leave the
    account short before a later credit lands."""
    low_point_by_account = low_point_by_account or {}
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
        low = low_point_by_account.get(sid)
        low_pence = None if low is None else int(round(float(low) * 100))
        low_plans = None if (low_pence is None or uncertain) else low_pence - reserved
        out[sid] = {
            "low_point": None if low_pence is None else round(low_pence / 100, 2),
            "low_point_and_plans": None if low_plans is None else round(low_plans / 100, 2),
            "after_payments": None if after_payments is None else round(after_payments / 100, 2),
            "plans_reserved": round(reserved / 100, 2),
            "after_payments_and_plans": None if after_plans is None else round(after_plans / 100, 2),
            "uncertain": bool(uncertain),
            "estimated": bool(estimated),
        }
    return out



def source_low_walk(
    sid: str,
    inputs: Any,
    opening: float,
    *,
    preview_salary: dict | None = None,
) -> AccountWalk:
    """W3: the source's own low-point walk (the old `_source_min_running`):
    any attributed credit-ok income counts even with no bill on the account,
    every funded inbound own-account transfer (G360) counts, and the same-day
    order is the inline `(day, delta)` key. `preview_salary` is PD4 (default
    none, as the old caller)."""
    return walk_account(
        sid, inputs, opening=opening,
        income_admit="any", inflow_admit="any", same_day_key="positive_delta",
        preview_salary=preview_salary,
    )


def compute_account_positions_from_walks(
    plans: list[dict],
    account_ids,
    closing_walks: Mapping[str, AccountWalk],
    low_walks: Mapping[str, AccountWalk],
    *,
    live_balances: Mapping[str, float] | None = None,
    movements: list[dict] | None = None,
    credit_account_ids: set[str] | None = None,
    accounts: str = "eligible",
    closing_fallback: str = "live",
    low_point_basis: str = "pre_reservation",
    reserved_by_source: Mapping[str, float] | None = None,
) -> dict[str, dict]:
    """G366: `compute_account_positions` fed from the walk output.

    `account_ids` are the accounts to report (order kept), `closing_walks` the
    closing walk per account (`walk_events(walks_out=...)`) and `low_walks` the
    source low-point walk per account (`source_low_walk`). The keywords are
    PD1 to PD4 in the module docstring; every default is the old behaviour."""
    if accounts not in ("eligible", "walked"):
        raise ValueError(f"accounts must be 'eligible' or 'walked', got {accounts!r}")
    if closing_fallback not in ("live", "none"):
        raise ValueError(f"closing_fallback must be 'live' or 'none', got {closing_fallback!r}")
    if low_point_basis not in ("pre_reservation", "post_reservation"):
        raise ValueError(f"low_point_basis must be 'pre_reservation' or 'post_reservation', got {low_point_basis!r}")
    live_balances = live_balances or {}
    reserved_by_source = reserved_by_source or {}
    closing: dict[str, float | None] = {}
    low_point: dict[str, float | None] = {}
    for sid in account_ids:
        walk = closing_walks.get(sid)
        if walk is not None:
            closing[sid] = float(walk.closing)
        elif accounts == "walked":
            continue
        elif closing_fallback == "live":
            closing[sid] = float(live_balances.get(sid, 0.0))
        else:
            closing[sid] = None
        low = low_walks.get(sid)
        lp = None if low is None else low.low_point
        if lp is not None and low_point_basis == "post_reservation":
            lp = lp - float(reserved_by_source.get(sid, 0.0))
        low_point[sid] = lp
    return compute_account_positions(
        plans, closing, movements=movements, credit_account_ids=credit_account_ids,
        low_point_by_account=low_point,
    )


def seed_spend_from(position: dict) -> float:
    """The per-account figure the G114 live-move reserve and then
    `cap_spend_from_to_pool` act on: min(after payments and plans, low point
    and plans), or 0 (not shown) when it is uncertain or unknown. Negative
    values are floored later by the pool cap."""
    if position.get("uncertain") or position.get("after_payments_and_plans") is None:
        return 0.0
    values = [float(position["after_payments_and_plans"])]
    if position.get("low_point_and_plans") is not None:
        values.append(float(position["low_point_and_plans"]))
    return min(values)
