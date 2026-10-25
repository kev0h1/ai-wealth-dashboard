"""G334: the move-plan card block for Penny's replies.

Same pattern as the G252 chart: the `plan_consolidation` executor builds the
block from its own deterministic legs under a private `_move_plan` key, the
agent loop pops and validates it here, the model sees only a short marker
(and the tool's `summary`), and the reply carries the block so the client can
draw the route with the Home move diagram. Data only: the card has no button
and never moves money.

Block shape:

    {"kind": "move_plan",
     "target": {"name": str, "bank": str|None, "provider": str|None},
     "legs": [{"name", "bank", "provider", "amount": number >= 0, "keeps": number >= 0}],  # 1..8
     "total": number >= 0, "pool": number|None, "requested": number|None,
     "shortfall": number >= 0, "summary": str,
     "skipped": [{"name": str, "reason": str}]}                                           # 0..12

Strings that look like HTML or carry control characters are rejected,
unknown fields are rejected, amounts must be finite.
"""
import json
import math

from app.services.penny_table import _CTRL_RE, _HTML_RE

MAX_LEGS = 8
MAX_SKIPPED = 12
MAX_NAME = 80
MAX_SUMMARY = 600
MAX_BLOCK_JSON = 8000
REASONS = ("nothing_spare", "set_aside_pot", "savings", "credit_card", "excluded", "excluded_by_user", "no_data", "is_target")


class MovePlanInvalid(ValueError):
    pass


def _text(v, limit: int, what: str, *, optional: bool = False) -> str | None:
    if v is None and optional:
        return None
    if not isinstance(v, str) or not v.strip() or len(v) > limit:
        raise MovePlanInvalid(f"{what} must be a non-empty string up to {limit} characters")
    if _HTML_RE.search(v) or _CTRL_RE.search(v):
        raise MovePlanInvalid(f"{what} must be plain text")
    return v.strip()


def _num(v, what: str, *, optional: bool = False) -> float | None:
    if v is None and optional:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 or v > 1e9:
        raise MovePlanInvalid(f"{what} must be a finite non-negative number")
    return round(float(v), 2)


def validate_move_plan(raw) -> dict:
    if not isinstance(raw, dict):
        raise MovePlanInvalid("move plan must be an object")
    if set(raw) - {"kind", "target", "legs", "total", "pool", "requested", "shortfall", "summary", "skipped", "unmatched_exclusions"}:
        raise MovePlanInvalid("unknown move plan field")
    if raw.get("kind") != "move_plan":
        raise MovePlanInvalid("bad kind")
    t = raw.get("target")
    if not isinstance(t, dict) or set(t) - {"name", "bank", "provider"}:
        raise MovePlanInvalid("bad target")
    target = {
        "name": _text(t.get("name"), MAX_NAME, "target name"),
        "bank": _text(t.get("bank"), MAX_NAME, "target bank", optional=True),
        "provider": _text(t.get("provider"), MAX_NAME, "target provider", optional=True),
    }
    legs_in = raw.get("legs")
    if not isinstance(legs_in, list) or not 1 <= len(legs_in) <= MAX_LEGS:
        raise MovePlanInvalid(f"1 to {MAX_LEGS} legs")
    legs = []
    for leg in legs_in:
        if not isinstance(leg, dict) or set(leg) - {"name", "bank", "provider", "amount", "keeps"}:
            raise MovePlanInvalid("bad leg")
        legs.append({
            "name": _text(leg.get("name"), MAX_NAME, "leg name"),
            "bank": _text(leg.get("bank"), MAX_NAME, "leg bank", optional=True),
            "provider": _text(leg.get("provider"), MAX_NAME, "leg provider", optional=True),
            "amount": _num(leg.get("amount"), "leg amount"),
            "keeps": _num(leg.get("keeps"), "leg keeps"),
        })
    skipped_in = raw.get("skipped")
    skipped = []
    if skipped_in is not None:
        if not isinstance(skipped_in, list) or len(skipped_in) > MAX_SKIPPED:
            raise MovePlanInvalid("bad skipped list")
        for s in skipped_in:
            if not isinstance(s, dict) or set(s) - {"name", "reason"} or s.get("reason") not in REASONS:
                raise MovePlanInvalid("bad skipped entry")
            skipped.append({"name": _text(s.get("name"), MAX_NAME, "skipped name"), "reason": s["reason"]})
    unmatched_in = raw.get("unmatched_exclusions")
    unmatched: list[str] = []
    if unmatched_in is not None:
        if not isinstance(unmatched_in, list) or len(unmatched_in) > 5:
            raise MovePlanInvalid("bad unmatched_exclusions list")
        unmatched = [_text(u, 60, "unmatched exclusion") for u in unmatched_in]
    out = {
        "kind": "move_plan", "target": target, "legs": legs,
        "total": _num(raw.get("total"), "total"),
        "pool": _num(raw.get("pool"), "pool", optional=True),
        "requested": _num(raw.get("requested"), "requested", optional=True),
        "shortfall": _num(raw.get("shortfall") if raw.get("shortfall") is not None else 0, "shortfall"),
        "summary": _text(raw.get("summary"), MAX_SUMMARY, "summary"),
        "skipped": skipped,
    }
    if unmatched:
        out["unmatched_exclusions"] = unmatched
    if len(json.dumps(out, ensure_ascii=False)) > MAX_BLOCK_JSON:
        raise MovePlanInvalid("move plan too large")
    return out


def validate_or_none(raw) -> dict | None:
    try:
        return validate_move_plan(raw)
    except MovePlanInvalid:
        return None


def marker_for_model(block: dict) -> dict:
    """What the model is told instead of the block."""
    n = len(block["legs"])
    return {
        "shown": True,
        "legs": n,
        "total": block["total"],
        "summary": block["summary"],
        "label": f"[move plan card attached: {n} leg{'s' if n != 1 else ''}, total £{block['total']:,.2f}]",
        "instruction": (
            "The user sees a diagram of this route directly below your reply. Quote the "
            "summary verbatim, say the route is below, add no figure the summary does not "
            "contain, and never offer to move the money."
        ),
    }
