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

# The parity gate checks these names, shares and range bounds against the
# frontend. "phrase" is Python-only (how a sentence names the reference).
GUIDES = {
    "50-30-20": {"name": "50/30/20 example", "short_name": "50/30/20", "shares": {"fixed": 50, "free": 30, "moved": 20}, "ranges": None, "phrase": "50/30/20 example"},
    "conscious": {"name": "Example ranges", "short_name": "Example ranges", "shares": None, "ranges": {"fixed": [50, 60], "moved": [10, 20], "free": [20, 35]}, "phrase": "example ranges"},
    "first": {"name": "Saving before spending", "short_name": "Saving before spending", "shares": None, "ranges": None, "phrase": "saving before spending idea"},
}
DEFAULT_REFERENCE = "50-30-20"
SECTION_ORDER = ("fixed", "moved", "free")
SECTION_LABEL = {"fixed": "Fixed", "moved": "Moved", "free": "Free"}

PAY_SPLIT_SCHEMA = {
    "type": "function",
    "function": {
        "name": "get_pay_split",
        "description": (
            "How the user's take-home pay was split in the latest pay period (Fixed, Moved, Free, "
            "left over), compared with the reference split they have chosen "
            "on the Spend shape page: 50/30/20 example, Example ranges, or Saving before spending "
            "(the pay yourself first idea, with no percentages). Also the 3, 6 and 12 month average shares and the "
            "what-works line. Use it for 'how is my pay split', 'am I on the 50/30/20' and 'how do I "
            "compare with the example ranges'. Pass reference only when the user names a "
            "different one than the one they picked. Quote the summary and the percentages verbatim. "
            "These are facts about one reference, never a target or advice. "
            "Saving before spending means putting savings aside when paid before planning other spending. "
            "These period totals cannot establish whether savings were set aside first or how much savings grew. "
            "Choosing a view does not create a budget or move money."
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


def _finite_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def compare_shape(shape: dict, guide_id: str) -> dict:
    """Port of compareShape: per-job actual, reference amount, delta and shares, or available False."""
    guide = GUIDES.get(guide_id) or GUIDES[DEFAULT_REFERENCE]
    income = shape.get("take_home")
    empty = {"available": False, "rows": []}
    if shape.get("status") != "ok" or not _finite_number(income) or income <= 0:
        return empty
    by_id = {j.get("id"): j for j in shape.get("jobs") or []}
    jobs = [by_id.get(i) for i in SECTION_ORDER]
    if any(j is None or not _finite_number(j.get("amount")) or j["amount"] < 0 for j in jobs):
        return empty
    amounts = [_pennies(j["amount"]) for j in jobs]
    excluded = shape.get("not_counted", 0)
    if not _finite_number(excluded):
        return empty
    total = sum(amounts) + _pennies(excluded)
    if shape.get("total_out") is not None and (
        not _finite_number(shape["total_out"]) or abs(_pennies(shape["total_out"]) - total) > 2
    ):
        return empty
    shares = guide["shares"]
    ranges = guide["ranges"]
    ref = None
    if shares:
        ref = {
            "fixed": int(math.floor(_pennies(income) * shares["fixed"] / 100 + 0.5)),
            "moved": int(math.floor(_pennies(income) * shares["moved"] / 100 + 0.5)),
        }
        ref["free"] = _pennies(income) - ref["fixed"] - ref["moved"]
    bounds = None
    if ranges:
        income_pennies = _pennies(income)
        bounds = {
            job_id: (
                int(math.floor(income_pennies * ranges[job_id][0] / 100 + 0.5)),
                int(math.floor(income_pennies * ranges[job_id][1] / 100 + 0.5)),
            )
            for job_id in SECTION_ORDER
        }
    elif ref:
        bounds = {job_id: (ref[job_id], ref[job_id]) for job_id in SECTION_ORDER}
    rows = []
    for idx, job_id in enumerate(SECTION_ORDER):
        actual = amounts[idx] / 100
        lower, upper = bounds[job_id] if bounds else (None, None)
        if lower is None:
            position = None
            delta = (amounts[idx] - ref[job_id]) / 100 if ref else None
        elif amounts[idx] < lower:
            position = "below"
            delta = (amounts[idx] - lower) / 100
        elif amounts[idx] > upper:
            position = "above"
            delta = (amounts[idx] - upper) / 100
        else:
            position = "within"
            delta = 0
        rows.append({
            "id": job_id,
            "actual": actual,
            "guide": ref[job_id] / 100 if ref else None,
            "guide_min": lower / 100 if lower is not None else None,
            "guide_max": upper / 100 if upper is not None else None,
            "delta": delta,
            "income_share": actual / income * 100,
            "guide_share": shares[job_id] if shares else None,
            "guide_share_min": ranges[job_id][0] if ranges else (shares[job_id] if shares else None),
            "guide_share_max": ranges[job_id][1] if ranges else (shares[job_id] if shares else None),
            "position": position,
        })
    return {"available": True, "income": income, "rows": rows}


def _pct(value) -> int:
    return int(math.floor(float(value) + 0.5))


def _summary(label: str | None, guide: dict, rows: list[dict]) -> str:
    by_id = {r["id"]: r for r in rows}
    lead = f"For {label}, " if label else ""
    phrase = guide["phrase"]
    fixed, free, moved = by_id["fixed"], by_id["free"], by_id["moved"]
    if guide["ranges"]:
        def range_fact(row: dict) -> str:
            range_label = f"{row['guide_share_min']}-{row['guide_share_max']}%"
            if row["position"] == "within":
                return f"within the {range_label} range"
            amount = _money(abs(row["delta"]))["formatted"]
            if row["position"] == "below":
                return f"{amount} below the bottom of the {range_label} range"
            return f"{amount} more than the top of the {range_label} range"

        text = (
            f"{SECTION_LABEL['fixed']} was {_money(fixed['actual'])['formatted']}, {range_fact(fixed)}. "
            f"{SECTION_LABEL['moved']} was {_money(moved['actual'])['formatted']}, {range_fact(moved)}. "
            f"{SECTION_LABEL['free']} was {_money(free['actual'])['formatted']}, {range_fact(free)}. "
            "These are independent reference bands, not a budget or target."
        )
        return f"{lead}{text}" if lead else text
    if guide["shares"] is None:
        text = (
            f"{_pct(fixed['income_share'])}% of your take-home went to fixed costs, "
            f"{_pct(free['income_share'])}% to free spending and {_pct(moved['income_share'])}% was moved. "
            f"The {phrase} has no fixed percentage, so there is nothing to compare with."
        )
        return f"{lead}{text}" if lead else text[:1].upper() + text[1:]
    text = (
        f"{_pct(fixed['income_share'])}% of your take-home went to fixed costs against the {fixed['guide_share']}% "
        f"in the {phrase}, {_pct(free['income_share'])}% to free spending against {free['guide_share']}%, "
        f"{_pct(moved['income_share'])}% moved against {moved['guide_share']}%."
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
        "not_counted": _money(shape.get("not_counted")),
        "not_counted_share": shape.get("not_counted_share", 0),
        "jobs": [
            {"id": j.get("id"), "label": j.get("label"), "amount": _money(j.get("amount")), "share": j.get("share")}
            for j in shape.get("jobs") or []
        ],
        "reference": {
            "id": ref_id, "name": guide["name"], "selected": ref_id == selected,
            "shares": guide["shares"], "ranges": guide["ranges"],
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
                "guide_min": _money(r["guide_min"]) if r["guide_min"] is not None else None,
                "guide_max": _money(r["guide_max"]) if r["guide_max"] is not None else None,
                "guide_pct_min": r["guide_share_min"],
                "guide_pct_max": r["guide_share_max"],
                "position": r["position"],
                "delta": _money(r["delta"]) if r["delta"] is not None else None,
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
            "not_counted": _money(entry.get("not_counted")),
            "not_counted_pct": entry.get("not_counted_share", 0),
        })
    if shape.get("not_counted"):
        result["exclusion_note"] = "Not counted is excluded from spending comparisons, but its cash outflow is kept separate from money left."
    result["averages"] = averages
    what_works = shape.get("what_works") or {}
    lines = [what_works["headline"]] if what_works.get("state") == "ok" and what_works.get("headline") else []
    if shape.get("verdict"):
        lines.append(shape["verdict"])
    result["what_works"] = lines[:2]
    return result
