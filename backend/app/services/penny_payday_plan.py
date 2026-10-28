"""B60: get_payday_plan, the read tool for the payday plan.

The payday plan is a distribution recommendation for the coming pay period:
how to split the landed salary across accounts so fewer money moves are needed
during the month. It has no lifecycle (G172): nothing to verify, nothing to
celebrate. The tool reuses the get_today_brief computation (live item, else the
preview Home's teaser uses, never persisted) and adds the pieces that tool
drops: the next pay date, the payday-day bills split and the payday-day risk.
"""
import logging
from datetime import date

from app.services import penny_period
from app.services.account_names import display_account_name

logger = logging.getLogger(__name__)

PAYDAY_PLAN_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_payday_plan",
        "description": (
            "The payday plan: how the next salary is expected to be split across the user's accounts "
            "(what stays in the pay account, what to move to each other account for bills, typical "
            "spending and a buffer), the date the next pay is expected, what leaves each account on "
            "payday itself and any payday-day shortfall. Use it for 'what is my payday plan', 'how "
            "should my pay be split' and 'what happens on payday'. Quote the figures and the summary "
            "verbatim, never recompute them. It is a recommendation for the coming period with no "
            "lifecycle: nothing to verify and nothing to celebrate. Pay is only ever expected, so "
            "keep the hedging in the summary."
        ),
        "parameters": {"type": "object", "properties": {}, "required": []},
    },
}


def _gbp(amount) -> str:
    return f"£{round(float(amount or 0.0)):,}"


def _parse_day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except Exception:
        return None


async def _labeller(uid: str):
    """account_id -> label, holder-named accounts never by name (G337)."""
    from app.services.penny_consolidation import _load_accounts, source_label

    try:
        from app.services.notifications import _user_name_tokens

        tokens = await _user_name_tokens(uid)
        accounts = {str(a.get("id")): a for a in await _load_accounts(uid)}
    except Exception:
        logger.warning("penny_payday_plan: account labels unavailable for %s", uid, exc_info=True)
        tokens, accounts = [], {}

    def label(account_id, name, provider=None) -> str:
        acc = accounts.get(str(account_id)) or {}
        shown = display_account_name(acc.get("name") or name)
        return source_label(shown, acc.get("provider") or provider, tokens)

    return label


def _summary(plan: dict, split: dict | None, risk: dict | None) -> str:
    parts = []
    next_pay = _parse_day(plan.get("next_pay"))
    if next_pay:
        parts.append(f"Your next pay is expected around {penny_period.fmt_day(next_pay)}.")
    period = plan.get("plan_period") or {}
    if period.get("label"):
        parts.append(f"The plan covers {period['label']}.")
    dests = [d for d in plan.get("dests") or [] if (d.get("move") or {}).get("raw")]
    total = (plan.get("total") or {}).get("raw") or 0
    if dests:
        moves = ", ".join(f"{_gbp(d['move']['raw'])} to {d['name']}" for d in dests)
        parts.append(
            f"The plan splits {_gbp(total)} across {len(dests)} account{'s' if len(dests) != 1 else ''}: {moves}."
        )
    else:
        parts.append("The plan expects every account to cover itself, so no moves are needed.")
    keeps = (plan.get("salary") or {}).get("keeps") or []
    if keeps:
        kept = ", ".join(f"{_gbp(k['amount']['raw'])} for {k['name']}" for k in keeps[:3])
        more = f" and {len(keeps) - 3} more" if len(keeps) > 3 else ""
        parts.append(f"The plan keeps {kept}{more} in {plan['salary']['name']}.")
    over = plan.get("over_salary")
    if over:
        if over.get("over_pay"):
            parts.append(
                f"These moves add up to {_gbp(over['total']['raw'])}, more than the "
                f"~{_gbp(over['pay']['raw'])} pay expected. {_gbp(over['short']['raw'])} "
                "would need to come from other accounts."
            )
        else:
            spare = over["spare"]["raw"]
            spare_txt = f"can only spare {_gbp(spare)}" if spare > 0 else "has nothing to spare"
            parts.append(
                f"These moves add up to {_gbp(over['total']['raw'])}, but {plan['salary']['name']} "
                f"{spare_txt} after what it keeps for its own bills. "
                f"{_gbp(over['short']['raw'])} would need to come from other accounts."
            )
    left_out = plan.get("left_out") or []
    if left_out:
        listed = ", ".join(f"{l['name']} {_gbp(l['amount']['raw'])}" for l in left_out[:3])
        more = f" and {len(left_out) - 3} more" if len(left_out) > 3 else ""
        parts.append(f"Left out this month: {listed}{more}.")
    if split:
        parts.append(
            f"Around {_gbp(split['total'])} of bills ({split['count']}) is due on payday itself, "
            f"against {_gbp(split['expected_in'])} expected in."
        )
    if risk:
        parts.append(risk["copy"])
    return " ".join(parts)


async def exec_get_payday_plan(uid: str) -> dict:
    from app.services import penny_tools as pt
    from app.services.companion import compute_today_items

    try:
        items = await compute_today_items(uid, payday_preview=False, persist=False)
        item = next((i for i in items if i.get("type") == "payday_plan"), None)
        if item is None:
            preview = await compute_today_items(uid, payday_preview=True, persist=False)
            item = next((i for i in preview if i.get("type") == "payday_plan"), None)
    except Exception:
        logger.exception("penny_payday_plan: get_payday_plan failed for %s", uid)
        return {"error": "payday plan lookup failed"}
    if item is None:
        return {
            "insufficient_data": True,
            "reason": "no payday plan yet, it needs a known salary and some cashflow history",
        }

    label = await _labeller(uid)
    plan = pt._shape_payday_plan(item)
    salary = item.get("salary") or {}
    plan["salary"]["name"] = label(salary.get("account_id"), salary.get("name"), salary.get("provider"))
    for shaped, raw in zip(plan["dests"], item.get("dests") or []):
        shaped["name"] = label(raw.get("account_id"), raw.get("name"))
    # Left-out names for an account follow the same G337 label as the legs.
    _acct_by_name = {d.get("name"): d.get("account_id") for d in item.get("dests") or []}
    for entry in plan["left_out"]:
        if entry["kind"] in ("usual", "destination"):
            acct_id = _acct_by_name.get(entry["name"])
            entry["name"] = label(acct_id, entry["name"]) if acct_id else display_account_name(entry["name"])
    plan["estimated"] = bool(item.get("estimated", False))
    plan["next_pay"] = item.get("next_pay")
    next_pay = _parse_day(item.get("next_pay"))
    if next_pay:
        plan["next_pay_label"] = penny_period.fmt_day(next_pay, with_year=True)

    split = item.get("payday_split")
    shaped_split = None
    if split:
        shaped_split = {
            "total": split.get("total"),
            "count": split.get("count"),
            "expected_in": split.get("expected_in"),
            "accounts": [
                {"name": label(a.get("account_id"), a.get("name")), "out": a.get("out")}
                for a in split.get("accounts") or []
            ],
        }
        plan["payday_split"] = shaped_split
    risk = item.get("payday_split_risk")
    shaped_risk = None
    if risk:
        name = label(risk.get("account_id"), risk.get("name"))
        out = next((a["out"] for a in (shaped_split or {}).get("accounts", []) if a["name"] == name), None)
        amount = out if out is not None else risk.get("shortfall")  # never the engine's raw copy, it may name a holder
        copy = f"{_gbp(amount)} leaves {name} on payday and nothing expected in covers it."
        shaped_risk = {"name": name, "shortfall": risk.get("shortfall"), "copy": copy}
        plan["payday_split_risk"] = shaped_risk
    plan["summary"] = _summary(plan, shaped_split, shaped_risk)
    return plan
