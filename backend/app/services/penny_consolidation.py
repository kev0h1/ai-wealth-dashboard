"""G334: "how much can I move into this account from the others".

Penny answers consolidation questions ("I'd rather spend from Barclays, how
much can I move to it", "out of what's left to spend, how much should I move
from my other current accounts") from the SAME per-account figures Home's
"Spend from" card uses: the `account_eligibility` block of `build_today_payload`
(after-bills-and-plans headroom, capped at the pooled left to spend). This
module never recomputes headroom. The planner below is pure: it picks which
accounts could give something, in fewest-legs order, and builds the sentence
the model must quote verbatim.

Rules it enforces: set-aside pots never move, savings only when the user
asks for them, credit cards never, an account with nothing spare is named
but not used, and the total never exceeds the left-to-spend pool. The app
never moves money: the result is a recommendation sentence plus an optional
card (`_move_plan`) drawing the route.
"""
import logging

from app.services.account_kinds import is_credit_card_account, is_savings_account
from app.services.account_names import display_account_name

logger = logging.getLogger(__name__)

SPEND_FROM_FLOOR = 5.0  # mirrors SPEND_FROM_HEADROOM_FLOOR in lib/spendFromAccount.ts

PLAN_CONSOLIDATION_SCHEMA = {
    "type": "function",
    "function": {
        "name": "plan_consolidation",
        "description": (
            "How much can be moved INTO one account from the user's other current accounts "
            "without leaving any of them short, and from which. Use it for any question about "
            "moving, consolidating or gathering money into an account ('I'd rather spend from "
            "Barclays, how much can I move to it', 'out of what's left to spend how much "
            "should I move from my other accounts') and for a picture or diagram of those "
            "moves. It uses the same per-account figures as Home's Spend from card, never raw "
            "balances, and never counts set-aside pots. Figures are authoritative: quote the "
            "summary verbatim, never recompute, never offer to move the money; the app never "
            "moves money. When legs exist the user sees a diagram of the route below your reply."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "target_account_id_or_name": {
                    "type": "string",
                    "description": "The account the money would move INTO: an id from get_accounts or a (partial, case-insensitive) name.",
                },
                "amount": {
                    "type": "number",
                    "description": "Optional: the amount the user asked about, in pounds. Omit to ask for the most that can move.",
                },
                "include_savings": {
                    "type": "boolean",
                    "description": "Only true when the user explicitly asks to include savings accounts. Set-aside pots are never included.",
                    "default": False,
                },
            },
            "required": ["target_account_id_or_name"],
        },
    },
}


def _fmt(amount: float) -> str:
    amount = round(float(amount or 0.0), 2)
    return f"−£{abs(amount):,.2f}" if amount < 0 else f"£{amount:,.2f}"


def _money(amount: float) -> dict:
    val = round(float(amount or 0.0), 2)
    return {"raw": val, "formatted": _fmt(val)}


def _label(account: dict, name_tokens: list[str]) -> tuple[str, str | None]:
    """(display name, bank). A holder-named account reads "Your HSBC account"."""
    from app.services.companion import _bank_name_of, _is_holder_named

    name = display_account_name(account.get("name"))
    bank = _bank_name_of(account.get("provider"))
    if bank and _is_holder_named(name, name_tokens):
        return f"Your {bank} account", bank
    return name or "Your account", bank


def _mid(name: str) -> str:
    return "your " + name[5:] if name.startswith("Your ") else name


def _join(parts: list[str]) -> str:
    if len(parts) <= 1:
        return "".join(parts)
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def _headroom_of(entry: dict) -> float:
    raw = entry.get("spend_from_headroom", entry.get("headroom", 0.0))
    try:
        return max(0.0, float(raw or 0.0))
    except (TypeError, ValueError):
        return 0.0


def plan_consolidation_legs(
    *, target_id: str, eligibility: dict, accounts: list[dict], pool: float | None,
    amount: float | None, include_savings: bool, pot_ids: set[str], name_tokens: list[str],
) -> dict:
    """PURE. See the module docstring."""
    eligibility = eligibility or {}
    target = next((a for a in accounts if str(a.get("id")) == str(target_id)), None) or {}
    t_name, t_bank = _label(target, name_tokens)
    t_entry = eligibility.get(str(target_id)) or {}
    target_out = {
        "account_id": str(target_id), "name": t_name, "bank": t_bank,
        "provider": target.get("provider"),
        "own_headroom": _headroom_of(t_entry) if t_entry else None,
    }

    sources: list[dict] = []
    skipped: list[dict] = []
    for acc in accounts:
        aid = str(acc.get("id"))
        name, bank = _label(acc, name_tokens)

        def skip(reason: str) -> None:
            skipped.append({"account_id": aid, "name": name, "reason": reason})

        if aid == str(target_id):
            continue
        if is_credit_card_account(acc):
            skip("credit_card")
            continue
        if aid in pot_ids:
            skip("set_aside_pot")
            continue
        if is_savings_account(acc) and not include_savings:
            skip("savings")
            continue
        if acc.get("cover_source_eligible") is False or acc.get("include_in_safe_to_spend") is False:
            skip("excluded")
            continue
        entry = eligibility.get(aid)
        if not entry:
            skip("no_data")
            continue
        head = _headroom_of(entry)
        if head < SPEND_FROM_FLOOR:
            skip("nothing_spare")
            continue
        sources.append({"account_id": aid, "name": name, "bank": bank,
                        "provider": acc.get("provider"), "headroom": head})

    sources.sort(key=lambda s: -s["headroom"])
    available = round(sum(s["headroom"] for s in sources), 2)
    requested = round(float(amount), 2) if amount is not None and amount > 0 else None
    need = requested if requested is not None else available
    cap = need
    if pool is not None:
        cap = min(cap, max(0.0, float(pool)))
    cap = round(min(cap, available), 2)

    legs: list[dict] = []
    remaining = cap
    for s in sources:
        if remaining <= 0.004:
            break
        take = round(min(s["headroom"], remaining), 2)
        if take <= 0:
            continue
        legs.append({
            "account_id": s["account_id"], "name": s["name"], "bank": s["bank"],
            "provider": s["provider"], "amount": take,
            "keeps": round(s["headroom"] - take, 2),
        })
        remaining = round(remaining - take, 2)
    total = round(sum(l["amount"] for l in legs), 2)
    shortfall = round(requested - total, 2) if requested is not None and requested > total else 0.0

    out = {
        "target": target_out, "legs": legs, "skipped": skipped, "total": total,
        "pool": round(float(pool), 2) if pool is not None else None,
        "requested": requested, "shortfall": shortfall, "floor": SPEND_FROM_FLOOR,
    }
    out["summary"] = _summary(out)
    return out


def _summary(plan: dict) -> str:
    target = _mid(plan["target"]["name"])
    legs, total, requested = plan["legs"], plan["total"], plan["requested"]
    if not legs:
        first = f"Nothing can move into {target} right now without leaving another account short."
        if requested is not None:
            first = f"You asked about {_fmt(requested)}. " + first
        return first
    route = _join([f"{_fmt(l['amount'])} from {_mid(l['name'])}" for l in legs])
    if requested is not None and plan["shortfall"] > 0:
        head = f"You asked about {_fmt(requested)}; up to {_fmt(total)} can move into {target} without leaving another account short: {route}."
    elif requested is not None:
        head = f"You could move {_fmt(total)} into {target}: {route}."
    else:
        head = f"You could move up to {_fmt(total)} into {target}: {route}."
    notes = ["each account keeps enough for its own bills and set-asides"]
    spare = [_mid(s["name"]) for s in plan["skipped"] if s["reason"] == "nothing_spare"]
    if spare:
        notes.append(f"{_join(spare[:2])} {'has' if len(spare) == 1 else 'have'} nothing spare")
    pots = [s["name"] for s in plan["skipped"] if s["reason"] == "set_aside_pot"]
    if pots:
        notes.append(f"{_join(pots[:2])} {'is a set-aside pot' if len(pots) == 1 else 'are set-aside pots'} and stays put")
    sentence = notes[0][0].upper() + "; ".join(notes)[1:] + "."
    return f"{head} {sentence}"


async def _load_accounts(uid: str) -> list[dict]:
    from app.routers.accounts import get_accounts as _route_get_accounts

    accs = await _route_get_accounts(user={"email": uid})
    return [a.model_dump() if hasattr(a, "model_dump") else dict(a) for a in accs]


async def _load_pot_ids(uid: str) -> set[str]:
    from app.db.collections import allocations_col

    docs = await allocations_col.find({"user_id": uid, "active": True}).to_list(None)
    return {str(d.get("fill_account_id")) for d in docs if d.get("fill_account_id")}


async def _load_today(uid: str) -> dict:
    from app.routers.companion import build_today_payload
    from app.services import response_cache

    cached = None
    try:
        cached = await response_cache.aget("today", uid)
    except Exception:
        logger.warning("plan_consolidation: today cache read failed for %s", uid, exc_info=True)
    if isinstance(cached, dict) and isinstance(cached.get("account_eligibility"), dict):
        return cached
    return await build_today_payload(uid)


async def exec_plan_consolidation(
    uid: str, target_account_id_or_name: str | None, amount=None, include_savings=False,
    _card_ok: bool = True,
) -> dict:
    from app.services.penny_tools import _resolve_account_for_propose, _tool_error

    resolved = await _resolve_account_for_propose(uid, target_account_id_or_name)
    if resolved.get("ambiguous"):
        return resolved
    if resolved.get("error"):
        return _tool_error(resolved["error"])
    target = resolved.get("account")
    if target is None:
        return _tool_error("target_account_id_or_name required")
    try:
        amt = float(amount) if amount is not None else None
        if amt is not None and amt != amt:
            amt = None
    except (TypeError, ValueError):
        amt = None

    try:
        payload = await _load_today(uid)
        eligibility = payload.get("account_eligibility") if isinstance(payload, dict) else None
        if not isinstance(eligibility, dict):
            return _tool_error("Left to spend is not available right now, so the move plan cannot be worked out")
        from app.routers.companion import _pooled_safe_to_spend
        from app.services.notifications import _user_name_tokens

        pool = await _pooled_safe_to_spend(uid)
        accounts = await _load_accounts(uid)
        pots = await _load_pot_ids(uid)
        tokens = await _user_name_tokens(uid)
    except Exception:
        logger.exception("plan_consolidation: loading inputs failed for %s", uid)
        return _tool_error("the move plan lookup failed")

    plan = plan_consolidation_legs(
        target_id=target.id, eligibility=eligibility, accounts=accounts, pool=pool,
        amount=amt, include_savings=bool(include_savings), pot_ids=pots, name_tokens=tokens,
    )
    result = {
        "summary": plan["summary"],
        "target": {"account_id": plan["target"]["account_id"], "name": plan["target"]["name"]},
        "legs": [
            {"account_id": l["account_id"], "name": l["name"],
             "amount": _money(l["amount"]), "keeps": _money(l["keeps"])}
            for l in plan["legs"]
        ],
        "total": _money(plan["total"]),
        "pool": _money(plan["pool"]) if plan["pool"] is not None else None,
        "requested": _money(plan["requested"]) if plan["requested"] is not None else None,
        "shortfall": _money(plan["shortfall"]),
        "skipped": [{"name": s["name"], "reason": s["reason"]} for s in plan["skipped"]],
        "instruction": (
            "Quote the summary verbatim. Do not recompute, do not offer to move the money, "
            "and do not list raw balances."
        ),
    }
    if plan["legs"] and _card_ok:
        result["_move_plan"] = {
            "kind": "move_plan",
            "target": {"name": plan["target"]["name"], "bank": plan["target"]["bank"],
                       "provider": plan["target"]["provider"]},
            "legs": [
                {"name": l["name"], "bank": l["bank"], "provider": l["provider"],
                 "amount": l["amount"], "keeps": l["keeps"]}
                for l in plan["legs"]
            ],
            "total": plan["total"], "pool": plan["pool"], "requested": plan["requested"],
            "shortfall": plan["shortfall"], "summary": plan["summary"],
            "skipped": [{"name": s["name"], "reason": s["reason"]} for s in plan["skipped"]],
        }
    return result
