"""G494 presentation and delivery state around G493's stored figures.

Reads never recalculate a forecast. A stale snapshot remains explicitly
unavailable for presentation; a display claim never implies a one-off answer.
Both display and push claims use the existing, erased-with-user state store.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import math
from datetime import datetime, timedelta, timezone

from app.core import timeutil
from app.db.collections import notification_state_col, preferences_col
from app.services import data_version, overspending
from app.services.pay_period import get_pay_period_for_date
from app.services.sync_freshness import first_sync_state

log = logging.getLogger(__name__)


def home_claim_key(period_end: str) -> str:
    return f"home-overspend:{period_end}"


async def current_period_acknowledged(uid: str) -> bool:
    """The asked answer remains authoritative even if the financial cache is absent."""
    end = await overspending.current_period_end(uid)
    ack = await overspending.overspending_ack_col.find_one({"_id": f"{uid}:{end.isoformat()}"})
    return bool(ack and ack.get("answer") == overspending.ACK_ONE_OFF)


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _finite_payload(value) -> bool:
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_finite_payload(item) for item in value.values())
    if isinstance(value, (list, tuple)):
        return all(_finite_payload(item) for item in value)
    return True


def _figures_reconcile(doc: dict) -> bool:
    """Validate the stored contract, without deriving a replacement reading."""
    values = [doc.get(k) for k in ("out", "in", "gap")]
    funded = doc.get("funded_by") or {}
    parts = [funded.get(k) for k in ("savings", "cards", "current_account")]
    if not all(_number(v) for v in values + parts):
        return False
    if any(v < 0 for v in parts) or doc["gap"] < 0:
        return False
    return (
        math.isclose(doc["gap"], max(0, doc["out"] - doc["in"]), rel_tol=0, abs_tol=0.005)
        and math.isclose(sum(parts), doc["gap"], rel_tol=0, abs_tol=0.005)
        and doc.get("crossed") is (doc["out"] > doc["in"])
    )


async def read_overspending_moment(uid: str) -> dict | None:
    """Stored G493 data plus fail-closed readiness and persistent delivery state.

    Same-day is a calendar-day check in London, not UTC. Version and pay-period
    checks prevent old classifications or yesterday's projection appearing as
    current evidence. Metadata is overlaid on a copy, never written into the
    financial cache or inferred from a visit.
    """
    try:
        raw = await overspending.overspending_cache_col.find_one({"_id": uid})
        if not raw or raw.get("schema_version") != overspending.SCHEMA_VERSION or not _finite_payload(raw):
            return None
        doc = copy.deepcopy(raw)
        pe = (doc.get("period") or {}).get("end")
        prefs, version, ack, delivery, sync = await asyncio.gather(
            preferences_col.find_one({"user_id": uid}),
            data_version.current_strict(uid),
            overspending.overspending_ack_col.find_one({"_id": f"{uid}:{pe}"}),
            notification_state_col.find_one({"_id": uid}),
            first_sync_state(uid),
        )
        today = timeutil.user_today()
        start, end = get_pay_period_for_date(
            today, (prefs or {}).get("pay_period_config", {"type": "calendar_month"}),
        )
        computed = doc.get("computed_at")
        if isinstance(computed, str):
            try:
                computed = datetime.fromisoformat(computed.replace("Z", "+00:00"))
            except ValueError:
                computed = None
        instant = timeutil.as_utc(computed) if isinstance(computed, datetime) else None
        period = doc.get("period") or {}
        current_period = period.get("start") == start.isoformat() and pe == end.isoformat()
        doc["display_ready"] = bool(
            current_period
            and period.get("days_elapsed") == max(1, (today - start).days)
            and period.get("length_days") == (end - start).days + 1
            and instant is not None
            and timeutil.to_user_date(instant) == today
            and instant <= timeutil.user_now().astimezone(timezone.utc) + timedelta(minutes=5)
            and type(version) is int
            and type(raw.get("data_version")) is int
            and raw["data_version"] == version
            and not sync.get("first_sync")
            and _figures_reconcile(doc)
        )
        # Acknowledgement is user input, independent of snapshot freshness.
        doc["acknowledged"] = bool(ack and ack.get("answer") == overspending.ACK_ONE_OFF)
        from app.services.notifications import _claim_field
        field = _claim_field(home_claim_key(str(pe))).split(".", 1)[1]
        doc["heads_up_seen"] = field in ((delivery or {}).get("claims") or {})
        doc["current_period"] = current_period
        for key in ("_id", "data_version"):
            doc.pop(key, None)
        return doc
    except Exception:
        log.exception("overspending moment unavailable for %s", uid)
        return None


def early_heads_up_eligible(doc: dict | None) -> bool:
    if not doc or doc.get("display_ready") is not True or doc.get("acknowledged") or doc.get("crossed"):
        return False
    course = doc.get("on_course") or {}
    figures = [course.get(k) for k in ("projected_out", "projected_in", "projected_gap", "predicted_income")]
    return bool(
        course.get("available") is True
        and course.get("on_course_to_cross") is True
        and all(_number(v) for v in figures)
        and course["predicted_income"] >= 0
        and course["projected_gap"] > 0
        and course["projected_out"] > course["projected_in"]
        and math.isclose(course["projected_gap"], course["projected_out"] - course["projected_in"], rel_tol=0, abs_tol=0.005)
    )


async def claim_home_heads_up(uid: str, period_end: str) -> bool:
    doc = await read_overspending_moment(uid)
    if not early_heads_up_eligible(doc) or doc["period"]["end"] != period_end:
        return False
    from app.services.notifications import claim_push
    return await claim_push(uid, home_claim_key(period_end))


def closed_period_observation(doc: dict | None, period_end: str) -> str | None:
    """One neutral line from the stored completed-period history only."""
    if not doc or doc.get("display_ready") is not True:
        return None
    for period in (doc.get("trend") or {}).get("periods") or []:
        if period.get("end") != period_end:
            continue
        check = {**period, "crossed": _number(period.get("gap")) and period["gap"] > 0}
        if not _figures_reconcile(check) or period["gap"] <= 0:
            return None
        def money(value: float) -> str:
            return f"£{value:,.2f}".removesuffix(".00")
        parts = [f"Out passed in by {money(period['gap'])}."]
        funded = period["funded_by"]
        if funded["cards"] > 0:
            parts.append(f"About {money(funded['cards'])} went onto cards.")
        elif funded["savings"] > 0:
            parts.append(f"About {money(funded['savings'])} came from savings.")
        return " ".join(parts)
    return None
