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
  GOOD_INTEREST_CEILING — total interest below which the verdict is "good"
  BAD_HORIZON_MONTHS    — debt-free date further than this → "bad"
  DAYS_PER_MONTH        — calendar-neutral month length (same as transport.py)
  MOVEMENT_FLAT_EPS     — monthly movement ≤ this → counts as flat for verdict
"""
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
            "_length": period_length,
        })

    # Need at least 2 covered periods to compute a meaningful median
    if len(per_period) < 2:
        flags["thin_history"] = True
        flags["assumptions"].append(
            "fewer than 2 closed pay periods of history — movement unknown, projected flat"
        )
        covered_out = [{"start": p["start"], "end": p["end"], "net": p["net"]} for p in per_period]
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

    covered_out = [{"start": p["start"], "end": p["end"], "net": p["net"]} for p in per_period]
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
    first_interest_month, monthly_interest_at_first, and _rate_schedule.
    """
    movement = monthly_movement if (monthly_movement is not None and monthly_movement > 0) else 0.0
    B = initial_debt
    total_interest = 0.0
    first_interest_month: Optional[str] = None
    monthly_interest_at_first: Optional[float] = None
    payoff_month: Optional[str] = None
    months_to_payoff: Optional[int] = None

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
        B = B - movement + interest

        if B <= 0:
            payoff_month = _month_label(month_start)
            months_to_payoff = i
            break

    return {
        "payoff_month": payoff_month,
        "months_to_payoff": months_to_payoff,
        "total_interest": _r2(total_interest),
        "first_interest_month": first_interest_month,
        "monthly_interest_at_first": monthly_interest_at_first,
    }


# ── Verdict ───────────────────────────────────────────────────────────────────

def _verdict(material_cards: list[dict], debt_free_month: Optional[str], total_interest: float) -> str:
    """Compute 'bad', 'good', or 'drifting'."""
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
    """
    pooled = [c for c in cards if c["debt"] > 0 and (c["movement"].get("monthly") or 0) > 0]

    if not pooled:
        return {
            "months_sooner": 0,
            "interest_saved": 0.0,
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
            "months_sooner": 0,
            "interest_saved": 0.0,
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
                "months_sooner": 0,
                "interest_saved": 0.0,
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

    # Scenario A months for pooled cards (worst = last to clear)
    a_months = max(
        (c.get("months_to_payoff") or (HORIZON_MONTHS + 1)) for c in pooled
    )
    b_months = months_b if months_b is not None else (HORIZON_MONTHS + 1)
    months_sooner = max(0, a_months - b_months)

    total_interest_a = sum(c.get("total_interest", 0.0) or 0.0 for c in pooled)
    interest_saved = _r2(max(0.0, total_interest_a - total_interest_b))

    return {
        "debt_free_month": debt_free_month_b,
        "total_interest": _r2(total_interest_b),
        "months_sooner": months_sooner,
        "interest_saved": interest_saved,
        "assumption": (
            "same total monthly movement, minimums elsewhere, remainder to the priciest rate "
            "— a simplification of avalanche"
        ),
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

        # 3. Amortisation (only when there's debt)
        if debt > 0:
            proj = _amortise(debt, movement["monthly"], today, rate_schedule)
        else:
            proj = {
                "payoff_month": None,
                "months_to_payoff": None,
                "total_interest": 0.0,
                "first_interest_month": None,
                "monthly_interest_at_first": None,
            }

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
            "total_interest": proj["total_interest"],
            "first_interest_month": proj["first_interest_month"],
            "monthly_interest_at_first": proj["monthly_interest_at_first"],
            "flags": flags,
            # Internal fields (prefixed _) consumed by totals / scenario B / refinance
            "_standard_apr": standard_apr,
            "_bt_offers": bt_offers,
        }
        cards_out.append(card)

    # ── Totals + verdict ──────────────────────────────────────────────────────
    total_debt = _r2(sum(c["debt"] for c in cards_out))
    total_interest = _r2(sum(c["total_interest"] or 0.0 for c in cards_out))
    material_cards = [c for c in cards_out if c["debt"] >= MATERIAL_BALANCE]

    # Debt-free month = latest payoff month among material cards
    if not material_cards:
        debt_free_month = None
    else:
        payoffs = [c.get("payoff_month") for c in material_cards]
        debt_free_month = None if any(p is None for p in payoffs) else max(payoffs)

    verdict = _verdict(material_cards, debt_free_month, total_interest)

    totals = {
        "debt": total_debt,
        "debt_free_month": debt_free_month,
        "total_interest": total_interest,
        "verdict": verdict,
    }

    # ── Scenario B ────────────────────────────────────────────────────────────
    scenario_b = _compute_scenario_b(cards_out, today)

    # ── Refinance options ─────────────────────────────────────────────────────
    refinance_options = _compute_refinance_options(cards_out, today)

    # Strip internal fields before returning (keep output JSON-clean)
    for c in cards_out:
        c.pop("_standard_apr", None)
        c.pop("_bt_offers", None)

    return {
        "status": "ok",
        "computed_at": computed_at,
        "horizon_months": HORIZON_MONTHS,
        "cards": cards_out,
        "totals": totals,
        "scenario_b": scenario_b,
        "refinance_options": refinance_options,
    }


async def get_debt_plan_cached(uid: str) -> dict:
    """Return debt plan from 90s in-process cache, else compute and store."""
    cached = response_cache.get(_CACHE_NAME, uid)
    if cached is not None:
        return cached
    plan = await compute_debt_plan(uid)
    response_cache.put(_CACHE_NAME, uid, plan)
    return plan
