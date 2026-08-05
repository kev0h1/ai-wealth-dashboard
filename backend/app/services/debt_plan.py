"""Deterministic debt-plan engine — Phase A.

Doctrine
--------
- Every figure in this module is computed directly from stored facts (balances,
  transactions, confirmed card terms).  No LLM is involved.  No rate is ever
  guessed: when a rate is unknown the engine says so and stops accumulating
  interest from that point.
- Assumptions are always stated, never hidden.  Every shortcut in the maths
  (flat-balance BT comparison, whole-balance-on-promo) is surfaced as a string
  in the ``assumptions`` list of the affected object.
- The module is strictly READ-ONLY against user collections (accounts,
  transactions, card_terms, preferences).

Tunable product-level constants (never user-specific):
  HORIZON_MONTHS        — how far we project (10 years)
  MATERIAL_BALANCE      — minimum debt (£) for a card to affect the verdict
  GOOD_INTEREST_CEILING — interest-to-clear below which the verdict is "good"
  BAD_HORIZON_MONTHS    — debt-free date further than this → "bad"
  DAYS_PER_MONTH        — calendar-neutral month length (same as transport.py)
  MOVEMENT_FLAT_EPS     — monthly movement ≤ this → counts as flat for verdict
"""
import calendar
import logging
import math
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.db.collections import accounts_col, card_terms_col, preferences_col, transactions_col
from app.services import response_cache
from app.services.card_rates import is_credit_card_account
from app.services.pay_period import get_pay_period_for_date, prev_pay_period
from app.routers.card_terms import _promos_from_legacy

log = logging.getLogger(__name__)

# ── Product-level constants ───────────────────────────────────────────────────
HORIZON_MONTHS = 120
MATERIAL_BALANCE = 50.0
GOOD_INTEREST_CEILING = 50.0
BAD_HORIZON_MONTHS = 60
DAYS_PER_MONTH = 30.44          # same precedent as transport.py
MOVEMENT_FLAT_EPS = 1.0         # monthly movement ≤ this → flat for verdict purposes
HISTORY_RISING_EPS = 1.0         # 3-month trend above this → rising

PROJECTION_TAIL_MONTHS = 6
WHATS_WORKING_HORIZON_MONTHS = 36
EXTRA_CLEAR_HORIZON_MONTHS = 60
EXTRA_ROUND_GBP = 5

_CACHE_NAME = "debt_plan"

# Regex to parse window length from BT offer notes
_WINDOW_MONTHS_RE = re.compile(r"(\d+)\s*month", re.IGNORECASE)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _median(vals: list[float]) -> float:
    """Median of a list (same logic as cashflow.py _median)."""
    if not vals:
        return 0.0
    s = sorted(vals)
    n = len(s)
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


def _r2(x: float) -> float:
    return round(x, 2)


def _month_label(d: date) -> str:
    """'YYYY-MM' label for a date."""
    return d.strftime("%Y-%m")


def _add_months(d: date, n: int) -> date:
    """Return the 1st of the month that is n calendar months after d's month."""
    total_months = d.year * 12 + (d.month - 1) + n
    year = total_months // 12
    month = total_months % 12 + 1
    return date(year, month, 1)


def _to_date(v) -> date:
    """Coerce a datetime or date to a date."""
    if isinstance(v, datetime):
        return v.date()
    return v


# ── Rate schedule lookup ──────────────────────────────────────────────────────

def _rate_from_schedule(month_start: date, rate_schedule: list[dict]) -> Optional[float]:
    """Return APR (%) applicable for a projection month starting on `month_start`.

    Segments are "from" inclusive, "until" inclusive (both YYYY-MM labels);
    a None "until" means open-ended.
    """
    month_str = _month_label(month_start)
    for seg in rate_schedule:
        seg_from = seg["from"]
        seg_until = seg["until"]  # may be None (open-ended)
        if seg_until is None:
            if month_str >= seg_from:
                return seg["apr_pct"]
        else:
            if seg_from <= month_str <= seg_until:
                return seg["apr_pct"]
    return None


# ── Per-card helpers ──────────────────────────────────────────────────────────

def _compute_movement(
    today: date,
    pay_cfg: dict,
    txns: list[dict],
    flags: dict,
) -> dict:
    """Compute demonstrated monthly movement from closed pay periods.

    Returns a movement dict with monthly (float|None), per_period, periods_used,
    and basis.  Mutates flags in place when thin_history.
    """
    current_start, _current_end = get_pay_period_for_date(today, pay_cfg)

    # Walk back up to 6 closed periods (periods that ended before current period's start)
    closed_periods: list[tuple[date, date]] = []
    period_start, period_end = prev_pay_period(current_start, pay_cfg)
    for _ in range(6):
        closed_periods.append((period_start, period_end))
        period_start, period_end = prev_pay_period(period_start, pay_cfg)

    # Earliest transaction date (coverage guard)
    earliest_txn: Optional[date] = None
    if txns:
        dates = [_to_date(t["date"]) for t in txns]
        earliest_txn = min(dates)

    # Compute per-period nets — only for periods we have coverage for
    per_period = []
    for ps, pe in closed_periods:
        if earliest_txn is None or ps < earliest_txn:
            continue  # can't reliably measure movement in a window with no history
        period_txns = [t for t in txns if ps <= _to_date(t["date"]) <= pe]
        credits = sum(t["amount"] for t in period_txns if t.get("transaction_type") == "credit")
        debits  = sum(t["amount"] for t in period_txns if t.get("transaction_type") == "debit")
        net = credits - debits   # positive = balance coming down (more paid than spent)
        period_length = (pe - ps).days + 1
        per_period.append({
            "start": ps.isoformat(),
            "end": pe.isoformat(),
            "net": _r2(net),
            "credits": _r2(credits),
            "debits": _r2(debits),
            "_length": period_length,
        })

    # Need at least 2 covered periods to compute a meaningful median
    if len(per_period) < 2:
        flags["thin_history"] = True
        flags["assumptions"].append(
            "fewer than 2 closed pay periods of history — movement unknown, projected flat"
        )
        covered_out = [{"start": p["start"], "end": p["end"], "net": p["net"], "credits": p["credits"], "debits": p["debits"]} for p in per_period]
        return {
            "monthly": None,
            "per_period": covered_out,
            "periods_used": len(per_period),
            "basis": "median_of_closed_periods",
        }

    nets = [p["net"] for p in per_period]
    median_net = _median(nets)
    median_period_length = _median([float(p["_length"]) for p in per_period])
    monthly = median_net * DAYS_PER_MONTH / median_period_length if median_period_length > 0 else 0.0

    covered_out = [{"start": p["start"], "end": p["end"], "net": p["net"], "credits": p["credits"], "debits": p["debits"]} for p in per_period]
    return {
        "monthly": _r2(monthly),
        "per_period": covered_out,
        "periods_used": len(per_period),
        "basis": "median_of_closed_periods",
    }


def _compute_rate_schedule(
    today: date,
    terms_doc: Optional[dict],
    flags: dict,
) -> tuple[list[dict], Optional[float]]:
    """Build consolidated rate-schedule segments and return (rate_schedule, standard_apr).

    Mutates flags in place.
    """
    if terms_doc is None or terms_doc.get("status") != "confirmed":
        flags["terms_missing"] = True
        return [], None

    standard_apr: Optional[float] = terms_doc.get("apr_pct")  # may be None

    # Resolve promos (new list vs legacy flat triple)
    stored_promos = terms_doc.get("promos")
    if isinstance(stored_promos, list):
        promos = stored_promos
    else:
        promos = _promos_from_legacy(
            terms_doc.get("on_promo"),
            terms_doc.get("promo_kind"),
            terms_doc.get("promo_end"),
        )

    # Active promos = until >= today, sorted earliest-first
    active_promos: list[tuple[date, dict]] = []
    for p in promos:
        try:
            until_d = date.fromisoformat(str(p.get("until") or ""))
        except (ValueError, TypeError):
            continue
        if until_d >= today:
            active_promos.append((until_d, p))
    active_promos.sort(key=lambda x: x[0])

    if active_promos and not flags["promo_whole_balance_assumed"]:
        flags["promo_whole_balance_assumed"] = True
        kinds = set(p.get("kind", "purchases") for _, p in active_promos)
        kind_str = " / ".join(sorted(kinds))
        flags["assumptions"].append(
            f"the whole balance is treated as riding the {kind_str} promo rate"
        )

    def _rate_at(d: date) -> tuple[Optional[float], str, Optional[str]]:
        """(apr_pct, source, kind) applicable at month starting on d."""
        for p_until, p in active_promos:
            if p_until >= d:
                return float(p.get("apr_pct") or 0.0), "promo", p.get("kind")
        if standard_apr is not None:
            return float(standard_apr), "standard", None
        return None, "unknown", None

    # Build segment boundaries from today through end of horizon
    horizon_end_month = _add_months(today, HORIZON_MONTHS)
    # Boundary dates = today + day after each promo ends + horizon end
    boundary_dates: list[date] = [today]
    for p_until, _ in active_promos:
        next_day = p_until + timedelta(days=1)
        if today < next_day <= horizon_end_month:
            boundary_dates.append(next_day)
    boundary_dates.append(horizon_end_month)
    boundary_dates = sorted(set(boundary_dates))

    standard_rate_missing_noted = False
    segments: list[dict] = []

    for i in range(len(boundary_dates) - 1):
        seg_start = boundary_dates[i]
        seg_end_excl = boundary_dates[i + 1]
        rate, source, kind = _rate_at(seg_start)

        if source == "unknown" and not standard_rate_missing_noted:
            standard_rate_missing_noted = True
            flags["standard_rate_missing"] = True
            flags["assumptions"].append(
                f"no standard rate on file — interest after {seg_start.strftime('%b %Y')} isn't counted"
            )

        seg_from = _month_label(seg_start)
        # "until" = month label of the month that contains (seg_end_excl - 1 day)
        last_day = seg_end_excl - timedelta(days=1)
        seg_until = _month_label(last_day) if i < len(boundary_dates) - 2 else None

        seg = {
            "from": seg_from,
            "until": seg_until,
            "apr_pct": _r2(rate) if rate is not None else None,
            "source": source,
            "kind": kind,
        }

        # Consolidate consecutive segments with identical rate/source/kind
        if (
            segments
            and segments[-1]["source"] == seg["source"]
            and segments[-1]["apr_pct"] == seg["apr_pct"]
            and segments[-1]["kind"] == seg["kind"]
        ):
            segments[-1]["until"] = seg["until"]
        else:
            segments.append(seg)

    return segments, standard_apr


def _amortise(
    initial_debt: float,
    monthly_movement: Optional[float],
    today: date,
    rate_schedule: list[dict],
) -> dict:
    """Monthly amortisation walk for a single card.

    Spec: month i's start date = first of (current month + i), so month 1
    lands on the first of next month.

    Returns payoff_month, months_to_payoff, total_interest,
    first_interest_month, monthly_interest_at_first, balance_series and
    interest_series (per-month interest amounts, aligned with month 1..N;
    the series ends at payoff for clearing cards).
    """
    movement = monthly_movement if (monthly_movement is not None and monthly_movement > 0) else 0.0
    B = initial_debt
    total_interest = 0.0
    first_interest_month: Optional[str] = None
    monthly_interest_at_first: Optional[float] = None
    payoff_month: Optional[str] = None
    months_to_payoff: Optional[int] = None
    balance_series: list[float] = []
    interest_series: list[float] = []

    for i in range(1, HORIZON_MONTHS + 1):
        # Month i's start = first of (current month + i)
        month_start = _add_months(today, i)

        rate_pct = _rate_from_schedule(month_start, rate_schedule)
        if rate_pct is not None:
            interest = B * (rate_pct / 1200.0)
        else:
            interest = 0.0

        if interest > 0.005 and first_interest_month is None:
            first_interest_month = _month_label(month_start)
            monthly_interest_at_first = _r2(interest)

        total_interest += interest
        interest_series.append(interest)
        B = B - movement + interest

        if B <= 0:
            balance_series.append(0.0)
            payoff_month = _month_label(month_start)
            months_to_payoff = i
            break

        balance_series.append(max(B, 0.0))

    return {
        "payoff_month": payoff_month,
        "months_to_payoff": months_to_payoff,
        "total_interest": _r2(total_interest),
        "first_interest_month": first_interest_month,
        "monthly_interest_at_first": monthly_interest_at_first,
        "balance_series": balance_series,
        "interest_series": interest_series,
    }


# ── Verdict ───────────────────────────────────────────────────────────────────

def _verdict(material_cards: list[dict], debt_free_month: Optional[str], total_interest: float, history_rising: bool = False) -> str:
    """Compute 'bad', 'good', or 'drifting'. history_rising=True forces bad when material cards exist."""
    if history_rising and material_cards:
        return "bad"
    if not material_cards:
        return "good"

    # bad conditions (checked first)
    for c in material_cards:
        mov = c["movement"].get("monthly")
        if mov is None or mov <= MOVEMENT_FLAT_EPS:
            return "bad"
        if c.get("payoff_month") is None:
            return "bad"

    if debt_free_month is None:
        return "bad"

    # Check that no material card takes longer than BAD_HORIZON_MONTHS
    for c in material_cards:
        mtp = c.get("months_to_payoff")
        if mtp is not None and mtp > BAD_HORIZON_MONTHS:
            return "bad"

    # good: every material card clears before its first interest month, OR total interest < ceiling
    all_clear_before_interest = all(
        (
            c.get("first_interest_month") is None
            or (
                c.get("payoff_month") is not None
                and c["payoff_month"] <= c["first_interest_month"]
            )
        )
        for c in material_cards
    )
    if all_clear_before_interest or total_interest < GOOD_INTEREST_CEILING:
        return "good"

    return "drifting"


# ── Scenario B ────────────────────────────────────────────────────────────────

def _compute_scenario_b(cards: list[dict], today: date) -> dict:
    """Scenario B: same total movement, avalanche (highest rate first).

    Cards with movement None or <= 0 are excluded from the pool; they keep
    their demonstrated movement in both scenarios (may be 0).  All allocations
    must be >= 0 — we never model extra borrowing.

    Comparison semantics (one stated window, internally consistent):
    - The comparison window = this scenario's own payoff horizon (months to
      clear the pooled cards, avalanche-style).
    - ``as_is_interest_over_window`` = as-is cumulative interest over exactly
      that window, summed over the SAME pooled cards — so
      ``interest_saved = as_is_interest_over_window - total_interest`` is the
      literal subtraction and holds everything outside the pool equal.
    - ``months_sooner`` exists only when BOTH trajectories clear within the
      projection cap; otherwise it is None and ``as_is_clears`` carries the
      truthful shape (the as-is path never clears).
    """
    pooled = [c for c in cards if c["debt"] > 0 and (c["movement"].get("monthly") or 0) > 0]

    if not pooled:
        return {
            "months_sooner": None,
            "interest_saved": None,
            "note": "no cards with both debt and positive movement — pool is empty",
        }

    pool = sum(c["movement"]["monthly"] for c in pooled)

    # At least one pooled card must have a known rate > 0
    has_known_rate = any(
        any(seg["apr_pct"] is not None and seg["apr_pct"] > 0 for seg in (c.get("rate_schedule") or []))
        for c in pooled
    )
    if not has_known_rate:
        return {
            "months_sooner": None,
            "interest_saved": None,
            "note": "no pooled card carries a known interest rate — avalanche cannot be computed",
        }

    balances: dict[str, float] = {c["account_id"]: c["debt"] for c in pooled}
    total_interest_b = 0.0
    debt_free_month_b: Optional[str] = None
    months_b: Optional[int] = None

    for i in range(1, HORIZON_MONTHS + 1):
        month_start = _add_months(today, i)

        # Per-card interest this month
        interests: dict[str, float] = {}
        rates: dict[str, Optional[float]] = {}
        for c in pooled:
            aid = c["account_id"]
            B = balances.get(aid, 0.0)
            if B <= 0:
                interests[aid] = 0.0
                rates[aid] = None
                continue
            rate_pct = _rate_from_schedule(month_start, c.get("rate_schedule") or [])
            rates[aid] = rate_pct
            interests[aid] = B * (rate_pct / 1200.0) if rate_pct is not None else 0.0

        # Target: pooled card with highest known rate > 0 that still has a balance
        target_id: Optional[str] = None
        target_rate: float = 0.0
        for c in pooled:
            aid = c["account_id"]
            if balances.get(aid, 0.0) <= 0:
                continue
            r = rates.get(aid)
            if r is not None and r > target_rate:
                target_rate = r
                target_id = aid

        # Holdings: other pooled cards pay exactly their interest (stay flat)
        holdings_sum = sum(
            interests[c["account_id"]]
            for c in pooled
            if c["account_id"] != target_id and balances.get(c["account_id"], 0.0) > 0
        )

        if pool < holdings_sum:
            return {
                "months_sooner": None,
                "interest_saved": None,
                "note": "monthly pool insufficient to cover minimum holdings on non-target cards",
            }

        target_payment = max(0.0, pool - holdings_sum)

        # Apply interest and payments
        for c in pooled:
            aid = c["account_id"]
            B = balances.get(aid, 0.0)
            if B <= 0:
                continue
            interest = interests[aid]
            total_interest_b += interest
            if aid == target_id:
                balances[aid] = max(0.0, B + interest - target_payment)
            else:
                # holding — pay exactly interest; balance stays flat
                balances[aid] = max(0.0, B + interest - interest)  # = B

        if all(balances.get(c["account_id"], 0.0) <= 0 for c in pooled):
            debt_free_month_b = _month_label(month_start)
            months_b = i
            break

    # As-is truth for the pooled cards
    pooled_nonclearing_count = sum(1 for c in pooled if c.get("payoff_month") is None)
    as_is_clears = pooled_nonclearing_count == 0
    as_is_debt_free_month: Optional[str] = None
    if as_is_clears:
        as_is_debt_free_month = max(c["payoff_month"] for c in pooled)

    # Comparison over ONE stated window: this scenario's own payoff horizon.
    # As-is cumulative interest over that window, same pooled cards.
    window_months: Optional[int] = months_b
    as_is_interest_over_window: Optional[float] = None
    interest_saved: Optional[float] = None
    if window_months is not None:
        aiw = 0.0
        for c in pooled:
            series = c.get("_interest_series") or []
            aiw += sum(series[:window_months])
        as_is_interest_over_window = _r2(aiw)
        interest_saved = _r2(as_is_interest_over_window - _r2(total_interest_b))

    # months_sooner only means something when BOTH trajectories clear in cap
    months_sooner: Optional[int] = None
    if as_is_clears and months_b is not None:
        a_months = max(c["months_to_payoff"] for c in pooled)
        months_sooner = max(0, a_months - months_b)

    covers_all_debt = len(pooled) == sum(1 for c in cards if c["debt"] > 0)
    assumption = (
        "same total monthly movement, minimums elsewhere, remainder to the priciest rate "
        "— a simplification of avalanche"
    )
    if not covers_all_debt:
        assumption += (
            "; cards whose balance isn't currently coming down sit outside this comparison "
            "and follow the same path in both"
        )

    return {
        "debt_free_month": debt_free_month_b,
        "total_interest": _r2(total_interest_b),
        "window_months": window_months,
        "as_is_interest_over_window": as_is_interest_over_window,
        "interest_saved": interest_saved,
        "months_sooner": months_sooner,
        "as_is_clears": as_is_clears,
        "as_is_debt_free_month": as_is_debt_free_month,
        "pooled_count": len(pooled),
        "pooled_nonclearing_count": pooled_nonclearing_count,
        "covers_all_debt": covers_all_debt,
        "assumption": assumption,
    }


# ── Refinance options ─────────────────────────────────────────────────────────

def _compute_refinance_options(cards: list[dict], today: date) -> list[dict]:
    """BT refinance options from the user's own captured bt_offers only.

    For each source card with material debt and a known rate > 0, × each BT
    offer on a DIFFERENT card where ends is null or >= today.  Emitted only
    when interest_saved > fee.
    """
    options = []

    for src in cards:
        if src["debt"] < MATERIAL_BALANCE:
            continue

        # Source must bear interest at a known rate > 0 somewhere in the horizon
        src_rate_schedule = src.get("rate_schedule") or []
        has_positive_rate = any(
            seg["apr_pct"] is not None and seg["apr_pct"] > 0 for seg in src_rate_schedule
        )
        if not has_positive_rate:
            continue

        src_standard_apr = src.get("_standard_apr")
        if src_standard_apr is None:
            continue

        for dst in cards:
            if dst["account_id"] == src["account_id"]:
                continue

            bt_offers = dst.get("_bt_offers") or []
            for offer in bt_offers:
                # Check offer expiry
                ends_str = offer.get("ends")
                if ends_str is not None:
                    try:
                        ends_d = date.fromisoformat(str(ends_str))
                        if ends_d < today:
                            continue
                    except (ValueError, TypeError):
                        continue

                # Must have a known fee
                fee_pct = offer.get("fee_pct")
                if fee_pct is None:
                    continue

                # Parse window length from note; skip if unparsable
                note = offer.get("note") or ""
                m = _WINDOW_MONTHS_RE.search(note)
                if not m:
                    continue
                window_months = int(m.group(1))

                # Transferable amount (capped by available if present)
                assumptions_opt: list[str] = []
                dst_available = dst.get("available")
                if dst_available is not None:
                    transferable = min(src["debt"], dst_available)
                    assumptions_opt.append("capped by the card's available headroom today")
                else:
                    transferable = src["debt"]
                    assumptions_opt.append("if the limit allows")

                if transferable <= 0:
                    continue

                fee = transferable * fee_pct / 100.0
                source_rate_pct = float(src_standard_apr)
                monthly_interest = transferable * (source_rate_pct / 1200.0)
                interest_saved = monthly_interest * window_months
                assumptions_opt.append("assumes the balance holds across the window")

                net_saving = interest_saved - fee
                if net_saving <= 0:
                    continue

                break_even_weeks = (
                    math.ceil((fee / monthly_interest) * 4.345)
                    if monthly_interest > 0 else None
                )

                options.append({
                    "source_account_id": src["account_id"],
                    "source_name": src["name"],
                    "destination_account_id": dst["account_id"],
                    "destination_name": dst["name"],
                    "transferable": _r2(transferable),
                    "fee": _r2(fee),
                    "interest_saved": _r2(interest_saved),
                    "net_saving": _r2(net_saving),
                    "window_months": window_months,
                    "break_even_weeks": break_even_weeks,
                    "assumptions": assumptions_opt,
                })

    return options


def _walk_with_extra(cards: list[dict], today: date, extra: float) -> tuple[bool, Optional[str]]:
    """Simulate multi-card payoff with an extra monthly lump added avalanche-style.

    Returns (cleared_within_horizon, debt_free_month_label | None).
    Unknown rates → no interest (same honesty as _amortise).
    """
    balances: dict[str, float] = {c["account_id"]: c["debt"] for c in cards if c["debt"] > 0}
    if not balances:
        return True, None

    for i in range(1, EXTRA_CLEAR_HORIZON_MONTHS + 1):
        month_start = _add_months(today, i)

        # Step 1: apply interest and own payment per card
        card_map = {c["account_id"]: c for c in cards if c["account_id"] in balances}
        month_rates: dict[str, Optional[float]] = {}
        for aid, B in list(balances.items()):
            if B <= 0:
                continue
            c = card_map[aid]
            rate = _rate_from_schedule(month_start, c.get("rate_schedule") or [])
            month_rates[aid] = rate
            interest = B * rate / 1200.0 if rate is not None else 0.0
            own = c["movement"].get("monthly") or 0.0
            if own < 0:
                own = 0.0
            balances[aid] = max(0.0, B + interest - own)

        # Step 2: avalanche the extra pool with spillover
        pool = extra
        while pool > 0.005:
            open_aids = [aid for aid, B in balances.items() if B > 0]
            if not open_aids:
                break
            # Target: highest known rate > 0; fallback: largest balance
            target = None
            best_rate = 0.0
            for aid in open_aids:
                r = month_rates.get(aid)
                if r is not None and r > best_rate:
                    best_rate = r
                    target = aid
            if target is None:
                # fallback: largest balance
                target = max(open_aids, key=lambda aid: balances[aid])
            pay = min(balances[target], pool)
            balances[target] -= pay
            pool -= pay

        if all(B <= 0.005 for B in balances.values()):
            return True, _month_label(month_start)

    return False, None


def _compute_extra_to_clear(cards: list[dict], today: date) -> Optional[dict]:
    """Find the minimum extra monthly pounds (rounded to EXTRA_ROUND_GBP) that clears
    all material debt within EXTRA_CLEAR_HORIZON_MONTHS.

    Returns None when: no material debt, or even a very large extra can't clear within
    the horizon (degenerate — likely due to a balance with negative/zero movement that
    eclipses the extra pool).
    """
    with_debt = [c for c in cards if c["debt"] > 0]
    if not with_debt:
        return None
    material_with_debt = [c for c in with_debt if c["debt"] >= MATERIAL_BALANCE]
    if not material_with_debt:
        return None  # all balances immaterial

    # Check if current trajectory already clears within horizon
    ok, dfm = _walk_with_extra(cards, today, 0.0)
    if ok:
        return {"amount": 0, "debt_free_month": dfm, "horizon_months": EXTRA_CLEAR_HORIZON_MONTHS}

    # Exponential search for a feasible upper bound
    total_debt_with = sum(c["debt"] for c in with_debt)
    bound = 2.0 * total_debt_with  # even paying the full balance twice over in month 1 would clear it
    hi = 5.0
    while hi < bound:
        ok, _ = _walk_with_extra(cards, today, hi)
        if ok:
            break
        hi *= 2.0

    if hi > bound:
        # Degenerate: even paying ~2x total debt as extra monthly can't clear within cap.
        # This can happen when a card has negative movement that overwhelms any extra pool.
        return None

    # Integer bisection: find minimal whole-£ X in [int(hi/2), ceil(hi)]
    lo_int = int(hi / 2)
    hi_int = math.ceil(hi)

    # Ensure lo_int is actually infeasible
    ok_lo, _ = _walk_with_extra(cards, today, float(lo_int))
    if ok_lo:
        # lo_int is also feasible — bisect lower
        hi_int = lo_int
        lo_int = 0

    while lo_int < hi_int:
        mid = (lo_int + hi_int) // 2
        ok_mid, _ = _walk_with_extra(cards, today, float(mid))
        if ok_mid:
            hi_int = mid
        else:
            lo_int = mid + 1

    # lo_int == hi_int == minimal feasible whole-£ amount
    x = lo_int
    amount = math.ceil(x / EXTRA_ROUND_GBP) * EXTRA_ROUND_GBP

    # Final walk with the rounded amount to get the actual debt-free month
    _, final_dfm = _walk_with_extra(cards, today, float(amount))
    return {"amount": amount, "debt_free_month": final_dfm, "horizon_months": EXTRA_CLEAR_HORIZON_MONTHS}


# ── History ───────────────────────────────────────────────────────────────────

def _compute_history(
    today: date,
    all_cc_txns: list[dict],
    txns_by_account: dict[str, list[dict]],
    cc_accounts: list[dict],
) -> dict:
    """Reconstruct the last 12 completed calendar month-ends.

    balance_at(m) = current_balance − sum(credit amounts with date > m)
                  + sum(debit amounts with date > m)
    debt_at(m) = max(0.0, −balance_at(m))

    A card contributes to month m ONLY if its earliest transaction date ≤ m.
    """
    # Build last 12 completed month-ends (oldest first)
    month_ends: list[date] = []
    yr, mo = today.year, today.month
    # step back to previous month
    for _ in range(12):
        mo -= 1
        if mo == 0:
            mo = 12
            yr -= 1
        last_day = calendar.monthrange(yr, mo)[1]
        month_ends.insert(0, date(yr, mo, last_day))
    # month_ends is now oldest→newest, 12 entries

    assumptions: list[str] = []
    points_by_month: dict[str, float] = {}  # "YYYY-MM" → total debt
    covered_cards_by_month: dict[str, int] = {}  # "YYYY-MM" → count of covered cards

    per_card_earliest: dict[str, date | None] = {}
    for acc in cc_accounts:
        aid = str(acc["_id"])
        txns = txns_by_account.get(aid, [])
        if txns:
            per_card_earliest[aid] = min(_to_date(t["date"]) for t in txns)
        else:
            per_card_earliest[aid] = None

    for acc in cc_accounts:
        aid = str(acc["_id"])
        earliest = per_card_earliest.get(aid)
        if earliest is None:
            continue  # no transactions → contributes to no month

        raw_balance = float(acc.get("balance") or 0.0)
        txns = txns_by_account.get(aid, [])

        for m_end in month_ends:
            if earliest > m_end:
                continue  # card history doesn't reach this month

            # Reconstruct balance at m_end
            after_credits = sum(
                t["amount"] for t in txns
                if t.get("transaction_type") == "credit" and _to_date(t["date"]) > m_end
            )
            after_debits = sum(
                t["amount"] for t in txns
                if t.get("transaction_type") == "debit" and _to_date(t["date"]) > m_end
            )
            balance_at_m = raw_balance - after_credits + after_debits
            debt_at_m = max(0.0, -balance_at_m)

            label = _month_label(m_end)
            points_by_month[label] = _r2(points_by_month.get(label, 0.0) + debt_at_m)
            covered_cards_by_month[label] = covered_cards_by_month.get(label, 0) + 1

    # Build points list oldest→newest, truncated to first month with ≥1 covered card
    all_labels = [_month_label(m) for m in month_ends]
    first_covered_idx = None
    for i, lbl in enumerate(all_labels):
        if covered_cards_by_month.get(lbl, 0) >= 1:
            first_covered_idx = i
            break

    if first_covered_idx is None:
        # No card has any transactions
        return {
            "points": [],
            "trend_3m": 0.0,
            "rising": False,
            "assumptions": ["no card transaction history found — debt history cannot be shown"],
        }

    points = [
        {"month": lbl, "total": points_by_month.get(lbl, 0.0)}
        for lbl in all_labels[first_covered_idx:]
    ]

    # Assumptions: coverage gaps
    first_emitted_label = all_labels[first_covered_idx]
    oldest_possible = all_labels[0]
    if first_emitted_label != oldest_possible:
        # Parse first_emitted_label as "YYYY-MM"
        first_month_date = date.fromisoformat(f"{first_emitted_label}-01")
        first_mon_str = first_month_date.strftime("%b %Y")
        assumptions.append(
            f"card history starts {first_mon_str} — earlier months aren't shown"
        )

    # Check if any within-range months have partial coverage
    # i.e. some card has earliest > first_emitted but ≤ last month
    partial_cards = 0
    for acc in cc_accounts:
        aid = str(acc["_id"])
        earliest = per_card_earliest.get(aid)
        if earliest is None:
            continue
        # find the first month-end >= earliest
        card_first_covered = None
        for m_end in month_ends:
            if earliest <= m_end:
                card_first_covered = _month_label(m_end)
                break
        if card_first_covered and card_first_covered > first_emitted_label:
            partial_cards += 1

    if partial_cards > 0:
        assumptions.append(
            f"{partial_cards} card(s) have shorter history and only count from their first observed month — earlier totals are partial"
        )

    # trend_3m: latest completed month-end L, anchor A = 3 months before L
    # For each covered card: anchor a = max(A, card's first covered month-end); delta = debt_at(L) − debt_at(a)
    L_end = month_ends[-1]  # latest completed month-end
    A_end_raw = month_ends[-4] if len(month_ends) >= 4 else month_ends[0]

    clamped_card_names: list[str] = []
    trend_deltas: list[float] = []

    for acc in cc_accounts:
        aid = str(acc["_id"])
        earliest = per_card_earliest.get(aid)
        if earliest is None:
            continue

        # Find card's first covered month-end
        card_first_m_end = None
        for m_end in month_ends:
            if earliest <= m_end:
                card_first_m_end = m_end
                break

        if card_first_m_end is None or card_first_m_end > L_end:
            continue  # no coverage at L — skip

        # Anchor
        a_end = max(A_end_raw, card_first_m_end)
        clamped = (a_end != A_end_raw)

        raw_balance = float(acc.get("balance") or 0.0)
        txns = txns_by_account.get(aid, [])

        def _debt_at_m(m_end_inner: date) -> float:
            after_credits_inner = sum(
                t["amount"] for t in txns
                if t.get("transaction_type") == "credit" and _to_date(t["date"]) > m_end_inner
            )
            after_debits_inner = sum(
                t["amount"] for t in txns
                if t.get("transaction_type") == "debit" and _to_date(t["date"]) > m_end_inner
            )
            bal = raw_balance - after_credits_inner + after_debits_inner
            return max(0.0, -bal)

        debt_at_L = _debt_at_m(L_end)
        debt_at_a = _debt_at_m(a_end)
        delta = debt_at_L - debt_at_a
        trend_deltas.append(delta)

        if clamped:
            card_name = (
                acc.get("nickname") or acc.get("display_name") or acc.get("name") or "Credit card"
            ).strip()
            month_str = a_end.strftime("%b %Y")
            clamped_card_names.append(f"{card_name} from {month_str}")

    trend_3m = _r2(sum(trend_deltas))
    rising = trend_3m > HISTORY_RISING_EPS

    for clamped_str in clamped_card_names:
        assumptions.append(
            f"3-month trend counts {clamped_str}, when its history begins"
        )

    return {
        "points": points,
        "trend_3m": trend_3m,
        "rising": rising,
        "assumptions": assumptions,
    }


# ── Main async entry point ────────────────────────────────────────────────────

async def compute_debt_plan(uid: str) -> dict:
    """Compute a full deterministic debt plan for `uid`.

    The result is a plain dict, fully JSON-serialisable (no raw datetime/date
    objects).  Every assumption is stated in the relevant assumptions list.
    Strictly READ-ONLY against user collections.
    """
    today = date.today()
    computed_at = datetime.now(timezone.utc).isoformat()

    # ── Load user preferences (pay-period config) ─────────────────────────────
    prefs_doc = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs_doc.get("pay_period_config", {"type": "calendar_month"})

    # ── Load credit-card accounts ─────────────────────────────────────────────
    raw_accounts = await accounts_col.find({"user_id": uid}).to_list(None)
    cc_accounts = [a for a in raw_accounts if is_credit_card_account(a)]

    # ── Load confirmed card_terms docs, keyed by account_id ──────────────────
    terms_map: dict[str, dict] = {}
    async for doc in card_terms_col.find({"user_id": uid}):
        terms_map[doc.get("account_id", "")] = doc

    # ── Fetch all transactions for this user's credit-card accounts once ──────
    cc_account_ids = [str(a["_id"]) for a in cc_accounts]
    all_cc_txns: list[dict] = []
    if cc_account_ids:
        all_cc_txns = await transactions_col.find(
            {"account_id": {"$in": cc_account_ids}},
            {"account_id": 1, "amount": 1, "transaction_type": 1, "date": 1},
        ).to_list(None)

    # Index transactions by account_id
    txns_by_account: dict[str, list[dict]] = {}
    for t in all_cc_txns:
        txns_by_account.setdefault(t["account_id"], []).append(t)

    # ── Per-card computation ──────────────────────────────────────────────────
    cards_out: list[dict] = []
    balance_series_by_card: dict[str, list[float]] = {}
    for acc in cc_accounts:
        aid = str(acc["_id"])
        card_name = (
            acc.get("nickname") or acc.get("display_name") or acc.get("name") or "Credit card"
        ).strip()

        raw_balance = float(acc.get("balance") or 0.0)
        debt = -raw_balance if raw_balance < 0 else 0.0
        available = acc.get("available")
        if available is not None:
            available = float(available)

        terms_doc = terms_map.get(aid)
        txns = txns_by_account.get(aid, [])

        # Flags accumulator for this card
        flags: dict = {
            "terms_missing": False,
            "standard_rate_missing": False,
            "thin_history": False,
            "promo_whole_balance_assumed": False,
            "assumptions": [],
        }

        # 1. Movement
        movement = _compute_movement(today, pay_cfg, txns, flags)
        if movement["monthly"] is not None and movement["monthly"] < 0:
            flags["assumptions"].append(
                "spending on this card currently outpaces payments — projected flat, not growing"
            )

        # 2. Rate schedule
        rate_schedule, standard_apr = _compute_rate_schedule(today, terms_doc, flags)

        # 2b. Monthly interest RIGHT NOW: today's balance × today's APR / 1200.
        # Decomposable per card; promo 0% counts as 0; unknown rate counts as 0
        # (the missing-rate assumption is already surfaced).
        current_month_start = date(today.year, today.month, 1)
        current_rate = _rate_from_schedule(current_month_start, rate_schedule) if rate_schedule else None
        monthly_interest_now = (
            _r2(debt * current_rate / 1200.0) if (debt > 0 and current_rate) else 0.0
        )

        # 3. Amortisation (only when there's debt)
        if debt > 0:
            proj = _amortise(debt, movement["monthly"], today, rate_schedule)
            balance_series_by_card[aid] = proj.get("balance_series", [])
        else:
            proj = {
                "payoff_month": None,
                "months_to_payoff": None,
                "total_interest": 0.0,
                "first_interest_month": None,
                "monthly_interest_at_first": None,
                "interest_series": [],
            }

        # A card that never clears within the projection cap must not carry the
        # capped interest integral — arithmetically defined, humanly meaningless.
        # Its total_interest is null; monthly_interest_now carries the true cost.
        clears = proj["payoff_month"] is not None
        card_interest_total: Optional[float] = (
            proj["total_interest"] if (debt <= 0 or clears) else None
        )

        # bt_offers from terms doc (stored on card_terms, not account)
        bt_offers: list[dict] = []
        if terms_doc and terms_doc.get("status") == "confirmed":
            bt_offers = terms_doc.get("bt_offers") or []

        card: dict = {
            "account_id": aid,
            "name": card_name,
            "provider": acc.get("provider") or acc.get("provider_id") or "",
            "balance": _r2(raw_balance),
            "currency": acc.get("currency") or "GBP",
            "debt": _r2(debt),
            "available": _r2(available) if available is not None else None,
            "movement": movement,
            "rate_schedule": rate_schedule,
            "payoff_month": proj["payoff_month"],
            "months_to_payoff": proj["months_to_payoff"],
            "total_interest": card_interest_total,
            "monthly_interest_now": monthly_interest_now,
            "first_interest_month": proj["first_interest_month"],
            "monthly_interest_at_first": proj["monthly_interest_at_first"],
            "flags": flags,
            # Internal fields (prefixed _) consumed by totals / scenario B / refinance
            "_standard_apr": standard_apr,
            "_bt_offers": bt_offers,
            "_interest_series": proj.get("interest_series", []),
        }
        cards_out.append(card)

    # ── History ───────────────────────────────────────────────────────────────
    history = _compute_history(today, all_cc_txns, txns_by_account, cc_accounts)

    # ── Totals + verdict ──────────────────────────────────────────────────────
    total_debt = _r2(sum(c["debt"] for c in cards_out))

    # The monthly bleed, TODAY: Σ balance × APR/1200 across interest-bearing cards.
    monthly_interest_now_total = _r2(sum(c["monthly_interest_now"] for c in cards_out))

    # Interest to clear: summed ONLY over cards that actually clear at current
    # pace.  Cards that never clear within the cap contribute nothing here —
    # their truth is the monthly bleed, not a horizon-capped integral.
    clearing_cards = [c for c in cards_out if c["debt"] > 0 and c["payoff_month"] is not None]
    interest_to_clear = _r2(sum(c["total_interest"] or 0.0 for c in clearing_cards))

    # Non-clearing cards at current pace
    nonclearing_cards = [c for c in cards_out if c["debt"] > 0 and c["payoff_month"] is None]
    nonclearing = {
        "count": len(nonclearing_cards),
        "total_balance": _r2(sum(c["debt"] for c in nonclearing_cards)),
        "monthly_interest_share": _r2(sum(c["monthly_interest_now"] for c in nonclearing_cards)),
    }

    material_cards = [c for c in cards_out if c["debt"] >= MATERIAL_BALANCE]

    # Debt-free month = latest payoff month among material cards
    if not material_cards:
        debt_free_month = None
    else:
        payoffs = [c.get("payoff_month") for c in material_cards]
        debt_free_month = None if any(p is None for p in payoffs) else max(payoffs)

    verdict = _verdict(material_cards, debt_free_month, interest_to_clear, history_rising=history["rising"])

    totals = {
        "debt": total_debt,
        "debt_free_month": debt_free_month,
        "monthly_interest_now": monthly_interest_now_total,
        "interest_to_clear": interest_to_clear,
        "nonclearing": nonclearing,
        "verdict": verdict,
    }

    # ── Scenario B ────────────────────────────────────────────────────────────
    scenario_b = _compute_scenario_b(cards_out, today)

    # ── Refinance options ─────────────────────────────────────────────────────
    refinance_options = _compute_refinance_options(cards_out, today)

    # ── Projection ────────────────────────────────────────────────────────────
    debt_cards = [c for c in cards_out if c["debt"] > 0]
    if not debt_cards:
        projection = []
    else:
        # Determine N
        mtp_vals = [c.get("months_to_payoff") for c in debt_cards]
        if all(m is not None for m in mtp_vals):
            N = min(HORIZON_MONTHS, max(mtp_vals) + PROJECTION_TAIL_MONTHS)
        else:
            N = HORIZON_MONTHS
        # Anchor point: current month at current total
        projection = [{"month": _month_label(today), "total": total_debt}]
        for i in range(1, N + 1):
            total_i = 0.0
            for c in debt_cards:
                series = balance_series_by_card.get(c["account_id"], [])
                total_i += series[i - 1] if i - 1 < len(series) else 0.0
            projection.append({"month": _month_label(_add_months(today, i)), "total": _r2(total_i)})

    # ── What's working ────────────────────────────────────────────────────────
    whats_working = []
    for c in cards_out:
        if c["debt"] < MATERIAL_BALANCE:
            continue
        mov = c["movement"].get("monthly")
        if mov is None or mov <= MOVEMENT_FLAT_EPS:
            continue
        mtp = c.get("months_to_payoff")
        if mtp is None or mtp > WHATS_WORKING_HORIZON_MONTHS:
            continue
        whats_working.append({
            "account_id": c["account_id"],
            "name": c["name"],
            "payoff_month": c["payoff_month"],
            "monthly": mov,
        })
    whats_working.sort(key=lambda x: x["payoff_month"])

    # ── Extra to clear ────────────────────────────────────────────────────────
    extra_to_clear = _compute_extra_to_clear(cards_out, today)

    # Strip internal fields before returning (keep output JSON-clean)
    for c in cards_out:
        c.pop("_standard_apr", None)
        c.pop("_bt_offers", None)
        c.pop("_interest_series", None)

    return {
        "status": "ok",
        "computed_at": computed_at,
        "horizon_months": HORIZON_MONTHS,
        "cards": cards_out,
        "totals": totals,
        "scenario_b": scenario_b,
        "refinance_options": refinance_options,
        "projection": projection,
        "whats_working": whats_working,
        "extra_to_clear": extra_to_clear,
        "history": history,
    }


async def get_debt_plan_cached(uid: str) -> dict:
    """Return debt plan from 90s in-process cache, else compute and store."""
    cached = response_cache.get(_CACHE_NAME, uid)
    if cached is not None:
        return cached
    plan = await compute_debt_plan(uid)
    response_cache.put(_CACHE_NAME, uid, plan)
    return plan
