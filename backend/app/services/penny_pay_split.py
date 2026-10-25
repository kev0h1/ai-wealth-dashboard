"""B60: get_pay_split, the read tool for "how your pay was split".

The Spend screen's money-shape instrument shows where take-home went (fixed,
moved to savings, free spending, left over) and the shape page compares it with
a reference split the user picks (preference ``pay_split_reference``). Until
this tool Penny could see neither the comparison nor the reference.

GUIDES and compare_shape port ``frontend/lib/paySplitReference.ts`` (the
numbers and the penny-exact rounding). A Node gate, check:b60-pay-split-parity,
reads both files and fails if the guide numbers drift.
"""
import logging
import math

logger = logging.getLogger(__name__)

# One guide per line, same keys as the TypeScript GUIDES, so the parity gate can
# read them. "phrase" is Python-only (how a sentence names the reference).
GUIDES = {
    "50-30-20": {"name": "50/30/20 · adapted", "short_name": "50/30/20", "shares": {"fixed": 50, "free": 30, "moved": 20}, "phrase": "50/30/20 guide"},
    "conscious": {"name": "Conscious Spending Plan · 60/20/20 example", "short_name": "60/20/20 example", "shares": {"fixed": 60, "free": 20, "moved": 20}, "phrase": "Conscious Spending Plan example"},
    "first": {"name": "Pay yourself first · principle", "short_name": "Pay yourself first", "shares": None, "phrase": "Pay yourself first principle"},
}
DEFAULT_REFERENCE = "50-30-20"
SECTION_ORDER = ("fixed", "moved", "free")
SECTION_LABEL = {"fixed": "Fixed costs", "moved": "Moved to savings", "free": "Free spending"}

PAY_SPLIT_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_pay_split",
        "description": (
            "How the user's take-home pay was split in the latest pay period (fixed costs, moved to "
            "savings, free spending, left over), compared with the reference split they have chosen "
            "on the Spend shape page: 50/30/20, the Conscious Spending Plan 60/20/20 example, or Pay "
            "yourself first (no percentages). Also the 3, 6 and 12 month average shares and the "
            "what-works line. Use it for 'how is my pay split', 'am I on the 50/30/20' and 'how do I "
            "compare with the conscious spending plan'. Pass reference only when the user names a "
            "different one than the one they picked. Quote the summary and the percentages verbatim. "
            "These are facts about one reference, never a target or advice."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reference": {
                    "type": "string", "enum": list(GUIDES),
                    "description": "Optional reference to compare with, else the user's selected one.",
                },
            },
            "required": [],
        },
    },
}


def _pennies(amount: float) -> int:
    return int(math.floor(float(amount) * 100 + 0.5))


def _money(amount) -> dict:
    val = round(float(amount or 0.0), 2)
    return {"raw": val, "formatted": f"−£{abs(val):,.2f}" if val < 0 else f"£{val:,.2f}"}


def compare_shape(shape: dict, guide_id: str) -> dict:
    """Port of compareShape: per-job actual, reference amount, delta and shares, or available False."""
    guide = GUIDES.get(guide_id) or GUIDES[DEFAULT_REFERENCE]
    income = shape.get("take_home")
    empty = {"available": False, "rows": []}
    if shape.get("status") != "ok" or not isinstance(income, (int, float)) or income <= 0:
        return empty
    by_id = {j.get("id"): j for j in shape.get("jobs") or []}
    jobs = [by_id.get(i) for i in SECTION_ORDER]
    if any(j is None or not isinstance(j.get("amount"), (int, float)) or j["amount"] < 0 for j in jobs):
        return empty
    amounts = [_pennies(j["amount"]) for j in jobs]
    total = sum(amounts)
    if shape.get("total_out") is not None and abs(_pennies(shape["total_out"]) - total) > 2:
        return empty
    shares = guide["shares"]
    ref = None
    if shares:
        ref = {
            "fixed": int(math.floor(_pennies(income) * shares["fixed"] / 100 + 0.5)),
            "moved": int(math.floor(_pennies(income) * shares["moved"] / 100 + 0.5)),
        }
        ref["free"] = _pennies(income) - ref["fixed"] - ref["moved"]
    rows = []
    for idx, job_id in enumerate(SECTION_ORDER):
        actual = amounts[idx] / 100
        rows.append({
            "id": job_id,
            "actual": actual,
            "guide": ref[job_id] / 100 if ref else None,
            "delta": (amounts[idx] - ref[job_id]) / 100 if ref else None,
            "income_share": actual / income * 100,
            "guide_share": shares[job_id] if shares else None,
        })
    return {"available": True, "income": income, "rows": rows}


def _pct(value) -> int:
    return int(math.floor(float(value) + 0.5))


def _summary(label: str | None, guide: dict, rows: list[dict]) -> str:
    by_id = {r["id"]: r for r in rows}
    lead = f"For {label}, " if label else ""
    phrase = guide["phrase"]
    fixed, free, moved = by_id["fixed"], by_id["free"], by_id["moved"]
    if guide["shares"] is None:
        text = (
            f"{_pct(fixed['income_share'])}% of your take-home went to fixed costs, "
            f"{_pct(free['income_share'])}% to free spending and {_pct(moved['income_share'])}% was moved to savings. "
            f"The {phrase} has no fixed percentage, so there is nothing to compare with."
        )
        return f"{lead}{text}" if lead else text[:1].upper() + text[1:]
    text = (
        f"{_pct(fixed['income_share'])}% of your take-home went to fixed costs against the {fixed['guide_share']}% "
        f"in the {phrase}, {_pct(free['income_share'])}% to free spending against {free['guide_share']}%, "
        f"{_pct(moved['income_share'])}% moved to savings against {moved['guide_share']}%."
    )
    return f"{lead}{text}" if lead else text[:1].upper() + text[1:]


async def _selected_reference(uid: str) -> str:
    from app.db.collections import preferences_col
    from app.routers.preferences import _pay_split_reference

    doc = await preferences_col.find_one({"user_id": uid}) or {}
    return _pay_split_reference(doc)


async def exec_get_pay_split(uid: str, reference: str | None = None) -> dict:
    from app.services.money_shape import get_money_shape_cached

    try:
        shape = await get_money_shape_cached(uid)
        selected = await _selected_reference(uid)
    except Exception:
        logger.exception("penny_pay_split: get_pay_split failed for %s", uid)
        return {"error": "pay split lookup failed"}
    if shape.get("status") != "ok" or not shape.get("jobs"):
        return {"insufficient_data": True, "reason": "not enough pay periods yet to show a split"}

    ref_id = reference if reference in GUIDES else selected
    guide = GUIDES[ref_id]
    period = shape.get("period") or {}
    comp = compare_shape(shape, ref_id)
    result: dict = {
        "period": period.get("label"),
        "take_home": _money(shape.get("take_home")),
        "overspent": _money(shape.get("overspent")),
        "jobs": [
            {"id": j.get("id"), "label": j.get("label"), "amount": _money(j.get("amount")), "share": j.get("share")}
            for j in shape.get("jobs") or []
        ],
        "reference": {
            "id": ref_id, "name": guide["name"], "selected": ref_id == selected,
            "shares": guide["shares"],
        },
    }
    if comp["available"]:
        result["comparison"] = [
            {
                "job": SECTION_LABEL[r["id"]],
                "actual_pct": _pct(r["income_share"]),
                "guide_pct": r["guide_share"],
                "delta_pct": None if r["guide_share"] is None else _pct(r["income_share"]) - r["guide_share"],
                "actual": _money(r["actual"]),
                "guide": _money(r["guide"]) if r["guide"] is not None else None,
            }
            for r in comp["rows"]
        ]
        result["summary"] = _summary(period.get("label"), guide, comp["rows"])
    else:
        result["note"] = "The split could not be compared with a reference for this period."
    averages = []
    for entry in shape.get("averages") or []:
        if entry.get("months") not in (3, 6, 12):
            continue
        shares = {j.get("id"): j.get("share") for j in entry.get("jobs") or []}
        averages.append({
            "months": entry["months"], "label": entry.get("label"),
            "fixed_pct": shares.get("fixed"), "moved_pct": shares.get("moved"),
            "free_pct": shares.get("free"), "left_pct": shares.get("left"),
        })
    result["averages"] = averages
    what_works = shape.get("what_works") or {}
    lines = [what_works["headline"]] if what_works.get("state") == "ok" and what_works.get("headline") else []
    if shape.get("verdict"):
        lines.append(shape["verdict"])
    result["what_works"] = lines[:2]
    return result
