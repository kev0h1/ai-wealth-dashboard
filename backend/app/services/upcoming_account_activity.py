"""G420: which accounts belong in an Upcoming "by account" list.

One rule, shared with the frontend predicate `accountHasPeriodActivity`
(`lib/upcomingAccounts.ts`): an account is listed only if, in the current pay
period window the list already uses, it has at least one expected payment or
income event, a plan or set-aside drawn from it, an earmarked or suggested move
in or out, or a shortfall. An account with none of those is left out entirely.

Pure: no I/O and no new arithmetic. Positions are the per-account dicts the
server already computes (`account_eligibility`).
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping

from app.services.allocation_shortfall import has_plan_source


def account_has_period_activity(
    account_id: str,
    *,
    bills: Iterable[Mapping[str, Any]] = (),
    income: Iterable[Mapping[str, Any]] = (),
    plans: Iterable[Mapping[str, Any]] = (),
    position: Mapping[str, Any] | None = None,
) -> bool:
    aid = str(account_id)
    if any(str(b.get("account_id")) == aid for b in bills if b.get("account_id") is not None):
        return True
    if any(str(i.get("account_id")) == aid for i in income if i.get("account_id") is not None):
        return True
    for plan in plans:
        source = plan.get("source_account_id") or plan.get("sourceId")
        if source is not None and str(source) == aid and plan.get("active", True) is not False and has_plan_source(plan):
            return True
    if position:
        if (position.get("plans_reserved") or 0) > 0:
            return True
        if position.get("earmarks_out") or (position.get("earmarked_total") or 0) > 0:
            return True
        if position.get("covered_by_move"):
            return True
        for key in ("after_payments", "low_point"):
            value = position.get(key)
            if isinstance(value, (int, float)) and value < 0:
                return True
        if (position.get("short_after_cover") or 0) > 0:
            return True
    return False


def by_account_with_activity(
    bills: list[Mapping[str, Any]],
    income: list[Mapping[str, Any]],
    *,
    plans: Iterable[Mapping[str, Any]] = (),
    positions: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[dict]:
    """Accounts named by the period's bills and income, plus any account the
    positions name, kept only when `account_has_period_activity` holds."""
    plans = list(plans)
    positions = positions or {}
    found: dict[str, dict] = {}
    for row in [*bills, *income]:
        aid = row.get("account_id")
        if aid is None:
            continue
        found.setdefault(str(aid), {"account_id": str(aid), "account_name": row.get("account_name"), "account_bank": row.get("account_bank")})
    for aid in positions:
        found.setdefault(str(aid), {"account_id": str(aid), "account_name": None, "account_bank": None})
    out = []
    for aid, entry in found.items():
        if account_has_period_activity(aid, bills=bills, income=income, plans=plans, position=positions.get(aid)):
            out.append({
                **entry,
                "bills": sum(1 for b in bills if str(b.get("account_id")) == aid),
                "income": sum(1 for i in income if str(i.get("account_id")) == aid),
            })
    return out
