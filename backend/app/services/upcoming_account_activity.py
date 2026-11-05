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

import logging
from typing import Any, Iterable, Mapping

from app.services.allocation_shortfall import _remaining_pence, has_plan_source

logger = logging.getLogger(__name__)


async def load_activity_inputs(uid: str) -> dict:
    """Cached today positions, the stored /account-plans rows and the accounts
    list (names, Left-to-spend exclusions). Reads only; any failure degrades to
    events-only rather than failing the tool (H145)."""
    out: dict = {"plans": [], "positions": {}, "excluded_account_ids": [], "names": {}}
    try:
        from app.routers.accounts import get_accounts
        from app.services.account_names import display_account_name
        from app.services.companion import _load_account_plans
        from app.services.penny_consolidation import _load_today

        eligibility = (await _load_today(uid)).get("account_eligibility")
        out["positions"] = eligibility if isinstance(eligibility, dict) else {}
        out["plans"] = await _load_account_plans(uid, goals=True)
        for acc in await get_accounts(user={"email": uid}):
            out["names"][str(acc.id)] = {"name": display_account_name(acc.name), "bank": acc.provider}
            if getattr(acc, "counted_in_left_to_spend", True) is False or getattr(acc, "include_in_safe_to_spend", True) is False:
                out["excluded_account_ids"].append(str(acc.id))
    except Exception:
        logger.warning("upcoming_account_activity: inputs unavailable for %s", uid, exc_info=True)
    return out


def plan_still_draws(plan: Mapping[str, Any]) -> bool:
    """Same semantics as account_position._plan_remaining_pence: an inactive
    plan or a filled one (0 pence left) draws nothing; an unreadable one
    (None) is listed, as the UI's `amountUnavailable` is."""
    if not plan.get("active"):
        return False
    remaining = _remaining_pence(plan)
    return remaining is None or remaining > 0


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
        if source is not None and str(source) == aid and has_plan_source(plan) and plan_still_draws(plan):
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
    inflows: Iterable[Mapping[str, Any]] = (),
    plans: Iterable[Mapping[str, Any]] = (),
    positions: Mapping[str, Mapping[str, Any]] | None = None,
    excluded_account_ids: Iterable[str] = (),
    names: Mapping[str, Mapping[str, Any]] | None = None,
) -> list[dict]:
    """The accounts the Upcoming By account list shows, from the same inputs
    the UI walk uses: bills without card charges, settling items or next-period
    items; income; own-account inflows; accounts excluded from Left to spend are
    left out. `names` maps account id to {"name", "bank"} from the user's
    accounts list so an account known only from a position or plan is named."""
    excluded = {str(a) for a in excluded_account_ids}
    counted = lambda row: row.get("account_id") is None or str(row.get("account_id")) not in excluded  # noqa: E731
    bills = [b for b in bills if not b.get("is_credit_card") and not b.get("observed_pending") and not b.get("next_period") and counted(b)]
    income = [i for i in income if counted(i)]
    inflows = [i for i in inflows if counted(i)]
    plans = list(plans)
    positions = {str(k): v for k, v in (positions or {}).items() if str(k) not in excluded}
    names = {str(k): v for k, v in (names or {}).items()}
    events = [*bills, *income, *inflows]
    found: dict[str, dict] = {}
    for row in events:
        aid = row.get("account_id")
        if aid is not None:
            found.setdefault(str(aid), {"account_name": row.get("account_name"), "account_bank": row.get("account_bank")})
    for aid in positions:
        found.setdefault(aid, {})
    for plan in plans:
        if plan.get("source_account_id") and str(plan["source_account_id"]) not in excluded:
            found.setdefault(str(plan["source_account_id"]), {})
    out = []
    for aid, entry in found.items():
        if not account_has_period_activity(aid, bills=bills, income=income + inflows, plans=plans, position=positions.get(aid)):
            continue
        known = names.get(aid) or {}
        out.append({
            "account_id": aid,
            "account_name": known.get("name") or entry.get("account_name") or "Account",
            "account_bank": known.get("bank") or entry.get("account_bank"),
            "bills": sum(1 for b in bills if str(b.get("account_id")) == aid),
            "income": sum(1 for i in income if str(i.get("account_id")) == aid),
            "transfers_in": sum(1 for i in inflows if str(i.get("account_id")) == aid),
        })
    return out
