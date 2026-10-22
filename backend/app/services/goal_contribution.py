"""A user's intended contribution for one pay period, never saved progress.

The live period-end key alone affects reservations. Later amounts are a
conditional estimate: they assume the still-reserved money is set aside.
"""
import hashlib
import json
import math

INVALID_AMOUNT = "Choose an amount from £0 to £1,000,000 with no more than two decimal places."


def validate_pence(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100_000_000:
        raise ValueError(INVALID_AMOUNT)
    return value


def live_entry(history, period_end: str) -> dict | None:
    entry = history.get(period_end) if isinstance(history, dict) else None
    if not isinstance(entry, dict) or entry.get("cleared"):
        return None
    try:
        validate_pence(entry.get("contribution_pence"))
    except ValueError:
        return None
    return entry


def projection(*, requested_pence: int, remaining: float, reserved: float,
               matched_pence: int, later_periods: int, usual: float,
               period_start: str, period_end: str, target_date: str,
               replaces_easing: bool = False) -> dict:
    """All money is reconciled in pennies, then exposed as pounds for the UI.

    Progress may already include a matched transfer. Cap the *unpaid* reserve
    at remaining, rather than subtracting that transfer from remaining twice.
    """
    remaining_pence = max(0, round(remaining * 100))
    matched_pence = max(0, matched_pence)
    contribution_pence = min(requested_pence, remaining_pence + matched_pence)
    reserved_pence = min(remaining_pence, max(0, round(reserved * 100)))
    after = max(0, remaining_pence - reserved_pence)
    later_pence = (math.ceil(after / (later_periods * 500)) * 500
                   if after and later_periods > 0 else 0 if not after else None)
    return {
        "period_start": period_start, "period_end": period_end,
        "target_date": target_date,
        "requested_contribution": requested_pence / 100,
        "contribution": contribution_pence / 100,
        "reserved": reserved_pence / 100,
        "matched_this_period": matched_pence / 100,
        "remaining": remaining_pence / 100, "remaining_after": after / 100,
        "later_periods": later_periods,
        "later_contribution": later_pence / 100 if later_pence is not None else None,
        "covers_remaining": after == 0,
        "capped": contribution_pence != requested_pence,
        "large_increase": later_pence is not None and later_pence > round(usual * 125),
        "blocked_reason": (
            "There are no later pay periods before this target date. Choose enough for the remaining target or change the target date separately."
            if after and later_periods == 0 else None
        ),
        "replaces_easing": replaces_easing,
    }


def preview_token(doc: dict, cfg: dict, preview: dict) -> str:
    """Stale-preview fingerprint, not an authorisation credential.

    Recomputed server-side from the owned goal and live ledger/fulfilment.
    Binding the full financial snapshot catches edits with identical totals.
    """
    payload = {"goal": doc, "pay_config": cfg, "preview": preview}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()).hexdigest()
