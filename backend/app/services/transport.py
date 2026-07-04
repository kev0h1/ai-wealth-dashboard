"""Transport mode classification and analysis."""
from __future__ import annotations
import re
from datetime import datetime, timedelta, date

# Colour tokens for each mode (used by frontend chart)
MODE_COLOURS: dict[str, str] = {
    "Fuel":             "#f59e0b",
    "Parking":          "#64748b",
    "Taxi & Rideshare": "#3b82f6",
    "Rail":             "#7c3aed",
    "TfL / Oyster":     "#10b981",
    "Bus & Coach":      "#06b6d4",
    "EV Charging":      "#22c55e",
    "Car Rental":       "#f97316",
    "Car Care":         "#ec4899",
}

# Which modes count as "car running cost"
CAR_MODES       = {"Fuel", "Parking", "Car Care", "Car Rental", "EV Charging"}
# Private hire / rideshare (neither car nor public transport)
RIDESHARE_MODES = {"Taxi & Rideshare"}
# Genuine public transport
PT_MODES        = {"Rail", "TfL / Oyster", "Bus & Coach"}


def classify_mode(merchant: str, description: str) -> str | None:
    """Return the transport mode for a transaction, or None if not transport."""
    text = f"{merchant or ''} {description or ''}".lower().strip()

    # ── Exclusions: things that look like transport but aren't ──────────────
    # Uber Eats / food delivery — must exclude before general Uber rule
    if re.search(r"uber.{0,4}eat|ubereats|deliveroo|just.eat|hungry.?house", text):
        return None
    # Hotels / accommodation
    if re.search(r"premier inn|travelodge|holiday inn|hotel|booking\.com|airbnb|hostel", text):
        return None
    # Finance / banking noise (some descriptions end with "TF" for Transfer)
    if re.search(r"goldman sachs|barclays|natwest|lloyds|hsbc|amex|american express", text):
        return None
    # Tech / SaaS
    if re.search(r"openrouter|digitalocean|netflix|spotify|amazon prime|apple\.com", text):
        return None

    # ── TfL / Oyster ────────────────────────────────────────────────────────
    if re.search(r"\btfl\b|transport for london|oyster|tfl travel|tfl\*", text):
        return "TfL / Oyster"

    # ── Rail ─────────────────────────────────────────────────────────────────
    if re.search(
        r"uber.{0,6}train|trainline|lner|avanti|gwr|great western|southern rail|"
        r"thameslink|southeastern|transpennine|northern rail|c2c|scotrail|"
        r"cross.?country|grand central|hull trains|abellio|ticket office|"
        r"national rail|rail.travel", text
    ):
        return "Rail"

    # ── EV Charging ─────────────────────────────────────────────────────────
    if re.search(
        r"podpoint|pod.?point|chargepoint|osprey|gridserve|bp.?pulse|"
        r"geniepoint|ubitricity|source.london|raw.charg|polar.network", text
    ):
        return "EV Charging"

    # ── Fuel ─────────────────────────────────────────────────────────────────
    if re.search(
        r"filling.stat|costco.pet|costco.pfs|"
        r"\bbp\b.{0,8}(fuel|petrol|station|garage)|"
        r"\bshell\b.{0,8}(fuel|petrol|station|garage)|"
        r"esso|texaco|gulf.{0,4}(fuel|petrol)|total.{0,4}(fuel|petrol)|"
        r"morrisons.fuel|tesco.fuel|asda.fuel|sainsbury.fuel|"
        r"jet.petrol|murco|harvest.energy|"
        r"clock.filling|petrol.station|fuel.station", text
    ):
        return "Fuel"

    # ── Taxi & Rideshare ────────────────────────────────────────────────────
    # Uber (after excluding eats/trains/one-membership): all remaining Uber = ride
    if "uber" in text:
        return "Taxi & Rideshare"
    if re.search(r"bolt\.eu|bolt\s*\*|addison.lee|\bgett\b|free.now|kapten|\btaxi\b|cab.{0,5}\b", text):
        return "Taxi & Rideshare"

    # ── Parking ──────────────────────────────────────────────────────────────
    if re.search(
        r"yourparkingspace|justpark|\bncp\b|q-park|qpark|ringgo|apcoa|"
        r"\bparking\b|car.park|airport.park|park.{0,5}ride", text
    ):
        return "Parking"

    # ── Car Care / Maintenance ───────────────────────────────────────────────
    if re.search(
        r"halfords|kwik.?fit|autoglass|national.windscreen|"
        r"valeting|car.wash|car.service|\bmot\b|tyre|pit.stop|"
        r"quality.valet|fort.dunlop", text
    ):
        return "Car Care"

    # ── Bus & Coach ──────────────────────────────────────────────────────────
    if re.search(
        r"national.express|megabus|stagecoach|arriva|first.group|"
        r"go.ahead|\bflixbus\b", text
    ):
        return "Bus & Coach"

    # ── Car Rental ───────────────────────────────────────────────────────────
    if re.search(r"enterprise.rent|hertz|avis\s|budget.car|europcar|sixt\s|zipcar|enterprise.car", text):
        return "Car Rental"

    return None


def analyse_transport(txns: list[dict], period_days: int = 90) -> dict:
    """
    Given a list of all transactions, classify transport ones and return analysis.
    """
    today = datetime.now().date()
    cutoff = today - timedelta(days=period_days)

    mode_buckets: dict[str, list[float]] = {m: [] for m in MODE_COLOURS}
    mode_txns:    dict[str, list[dict]]  = {m: [] for m in MODE_COLOURS}
    transport_dates: set[date] = set()  # dates that had transport spend

    for t in txns:
        tx_date = t.get("date")
        if isinstance(tx_date, datetime):
            tx_date = tx_date.date()
        if tx_date < cutoff:
            continue
        if t.get("transaction_type") != "debit":
            continue

        merchant = t.get("merchant_name") or ""
        description = t.get("description") or ""
        mode = classify_mode(merchant, description)
        if not mode:
            continue

        amount = abs(float(t.get("amount", 0)))
        if amount == 0:
            continue

        mode_buckets[mode].append(amount)
        mode_txns[mode].append({**t, "_mode": mode})
        transport_dates.add(tx_date)

    total_spend = sum(sum(v) for v in mode_buckets.values())
    weeks = max(period_days / 7, 1)
    months = max(period_days / 30.44, 1)

    modes_out = []
    for mode, amounts in mode_buckets.items():
        if not amounts:
            continue
        total = round(sum(amounts), 2)
        modes_out.append({
            "name":    mode,
            "total":   total,
            "count":   len(amounts),
            "pct":     round(total / total_spend * 100, 1) if total_spend else 0,
            "colour":  MODE_COLOURS[mode],
            "monthly": round(total / months, 2),
        })
    modes_out.sort(key=lambda x: -x["total"])

    # Three-way split: car running costs | rideshare | public transport
    car_total       = sum(sum(mode_buckets[m]) for m in CAR_MODES)
    rideshare_total = sum(sum(mode_buckets[m]) for m in RIDESHARE_MODES)
    pt_total        = sum(sum(mode_buckets[m]) for m in PT_MODES)

    # Commute estimation: weekdays with ANY transport spend
    weekdays_in_period = sum(
        1 for d in (today - timedelta(days=i) for i in range(period_days))
        if d.weekday() < 5
    )
    office_days = sum(
        1 for d in transport_dates
        if d.weekday() < 5 and cutoff <= d <= today
    )
    wfh_days = max(weekdays_in_period - office_days, 0)

    # Weekly commute cost = PT + rideshare / weeks (rough proxy)
    weekly_commute_cost = round((pt_total + rideshare_total) / weeks, 2) if (pt_total + rideshare_total) else 0

    # All transport transactions sorted by amount desc, top 5
    all_txns = [t for bucket in mode_txns.values() for t in bucket]
    all_txns.sort(key=lambda t: -abs(float(t.get("amount", 0))))
    top5 = [
        {
            "name":   t.get("merchant_name") or (t.get("description") or "")[:30],
            "amount": round(abs(float(t.get("amount", 0))), 2),
            "date":   t["date"].strftime("%Y-%m-%d") if isinstance(t["date"], (datetime, date)) else str(t["date"]),
            "mode":   t["_mode"],
        }
        for t in all_txns[:8]
    ]

    return {
        "period_days":       period_days,
        "total_spend":       round(total_spend, 2),
        "weekly_avg":        round(total_spend / weeks, 2),
        "monthly_avg":       round(total_spend / months, 2),
        "modes":             modes_out,
        "car_total":            round(car_total, 2),
        "car_monthly":          round(car_total / months, 2),
        "rideshare_total":      round(rideshare_total, 2),
        "rideshare_monthly":    round(rideshare_total / months, 2),
        "pt_total":             round(pt_total, 2),
        "pt_monthly":           round(pt_total / months, 2),
        "office_days":       office_days,
        "wfh_days":          wfh_days,
        "weekdays_in_period": weekdays_in_period,
        "weekly_commute_cost": weekly_commute_cost,
        "annual_commute_projection": round(weekly_commute_cost * 52, 2),
        "top_transactions":  top5,
    }
