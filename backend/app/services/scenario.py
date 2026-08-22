"""Scenario simulator — "what if" life changes re-run through the existing
projection engines, never a new one.

This module owns none of the maths that already exists elsewhere. A declared
scenario (a new recurring cost, a cancellation, an income change) is turned
into a signed monthly delta to surplus, and that delta is threaded through
the SAME pure functions the rest of the app already trusts:

  - `app.services.cashflow.monthly_cashflow_cached`  — the spike-smoothed
    typical month (income/spending/debt), read once as the baseline.
  - `app.services.debt_plan._amortise`               — the pure per-card
    amortisation walk, re-run with an adjusted monthly movement.
  - `app.services.debt_plan.get_debt_plan_cached`     — the cached
    deterministic debt plan (cards, movement, rate_schedule).
  - `app.routers.commitments._classify_feasibility` (via the same
    `_apply_joint_feasibility` pass `list_commitments` itself uses) — plan
    feasibility re-derived against a perturbed surplus.
  - `app.services.categories.is_discretionary` / `get_category_kinds` — the
    declared-kind lookup, never a hardcoded category list.

Doctrine (same as debt_plan.py): every figure is computed from real inputs.
When an input is missing or thin, the affected block is `None` and the
reason is stated in plain English in `reasons[<block>]` — never a guess, and
never folded into the flat `assumptions` list (which is reserved for notes
that are genuinely global, not attributable to a single block). See
`simulate`'s own docstring and `_resolve_block_reason` for the exact split.

Import convention: every `app.routers.*` import happens lazily inside the
function that needs it. This mirrors the existing pattern in
app/services/companion.py, notifications.py and spend_impact.py, all of
which import from app.routers.commitments/savings/analytics lazily to avoid
a circular import at module load time (a service importing a router that
itself imports other services). Nothing here forces a genuine cycle today,
but the codebase-wide convention is to never risk one.
"""
import logging
from datetime import date, datetime, timedelta

from app.services.cashflow import monthly_cashflow_cached
from app.services.categories import get_category_kinds, is_discretionary
from app.services.debt_plan import _amortise, get_debt_plan_cached
from app.services.region import get_user_region

log = logging.getLogger(__name__)

# ── Contract constants ────────────────────────────────────────────────────────
HORIZON_MONTHS = 24

_MAX_ITEMS = 3
_MIN_AMOUNT = 1.0
_MAX_AMOUNT = 100_000.0
_MAX_LABEL_LEN = 40

_CADENCES = ("monthly", "weekly", "annual", "one_off")
_DIRECTIONS = ("out", "in")
_KINDS = ("new_outgoing", "removal", "income_change")

_DEFAULT_LABELS = {
    "new_outgoing":   "New cost",
    "removal":        "Cancellation",
    "income_change":  "Income change",
}

# weekly -> monthly-equivalent multiplier. Fixed by the frozen cadence spec
# (52 weeks/year over 12 months) — deliberately NOT the DAYS_PER_MONTH=30.44
# calendar-neutral convention debt_plan.py/transport.py use elsewhere, since
# this conversion is spelled out exactly in the contract, not derived.
_WEEKLY_TO_MONTHLY = 52.0 / 12.0

_FEASIBILITY_RANK = {"funded": 0, "surplus": 1, "savings": 2, "stretch": 3}

# A block builder that returns None must always pair it with a reason —
# this is the fallback text used ONLY if that contract is ever violated by
# a future change (see `_resolve_block_reason` below). It should never
# actually surface in production; its presence in a real response is itself
# a bug signal, logged loudly at the point of use.
_MISSING_REASON_FALLBACK = "Couldn't work out why this isn't available right now."


# ── Small calendar helpers (deliberately duplicated, not imported) ──────────
# debt_plan.py and cashflow.py already each keep their own private copy of a
# 3-line `_median`; trivial calendar/median utilities are duplicated rather
# than imported across modules in this codebase (see debt_plan.py:_median vs
# cashflow.py:_median) so that a future change to one projection's rounding
# doesn't silently ripple into an unrelated one. These do the same for month
# arithmetic and are pure, no different from that existing precedent.

def _month_label(d: date) -> str:
    """'YYYY-MM' label for a date."""
    return d.strftime("%Y-%m")


def _add_months(d: date, n: int) -> date:
    """First of the month that is n calendar months after d's month."""
    total = d.year * 12 + (d.month - 1) + n
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


def _human_month(label: str | None) -> str | None:
    """'YYYY-MM' -> 'Mon YYYY' (matches debt_narration._month_label_to_human)."""
    if not label:
        return None
    try:
        return datetime.strptime(label, "%Y-%m").strftime("%b %Y")
    except (ValueError, TypeError):
        return label


def _month_diff(later_label: str, earlier_label: str) -> int:
    """Whole months between two 'YYYY-MM' labels (later - earlier)."""
    ly, lm = (int(x) for x in later_label.split("-"))
    ey, em = (int(x) for x in earlier_label.split("-"))
    return (ly * 12 + lm) - (ey * 12 + em)


# ── normalise_items ───────────────────────────────────────────────────────────

def normalise_items(raw: list[dict]) -> tuple[list[dict], list[str]]:
    """Validate/clamp caller-supplied scenario items. Never raises.

    Returns (clean_items, rejection_reasons). Invalid items are dropped with
    a plain-English reason rather than blocking the whole request — one bad
    entry from a sloppy client shouldn't cost the user the other two.
    """
    try:
        return _normalise_items_inner(raw)
    except Exception:
        # Belt-and-braces: normalise_items must never raise, even against
        # pathological input (e.g. `raw` not iterable at all).
        return [], ["Couldn't read the scenario items you sent."]


def _normalise_items_inner(raw: list[dict]) -> tuple[list[dict], list[str]]:
    today = date.today()
    today_idx = today.year * 12 + today.month

    validated: list[dict] = []
    rejected: list[str] = []

    for raw_item in (raw or []):
        if not isinstance(raw_item, dict):
            rejected.append("One of the items wasn't a valid entry, skipped.")
            continue

        # amount
        try:
            amount = float(raw_item.get("amount"))
        except (TypeError, ValueError):
            rejected.append("An amount was missing or unreadable, that item was skipped.")
            continue
        if not (_MIN_AMOUNT <= amount <= _MAX_AMOUNT):
            rejected.append(
                f"An amount of £{amount:,.0f} is outside the £1 to £{_MAX_AMOUNT:,.0f} range, that item was skipped."
                if isinstance(amount, (int, float))
                else "An amount was out of range, that item was skipped."
            )
            continue

        direction = raw_item.get("direction")
        if direction not in _DIRECTIONS:
            rejected.append("An item's direction wasn't recognised, that item was skipped.")
            continue

        cadence = raw_item.get("cadence")
        if cadence not in _CADENCES:
            rejected.append("An item's cadence wasn't recognised, that item was skipped.")
            continue

        kind = raw_item.get("kind")
        if kind not in _KINDS:
            rejected.append("An item's kind wasn't recognised, that item was skipped.")
            continue

        # starts — within the next HORIZON_MONTHS, at most 1 calendar month
        # in the past (a start that's already begun still gets simulated
        # from the current month rather than rejected outright, since "I
        # started this last month" is a completely reasonable thing to ask
        # about, "I started this two years ago" is not what this tool is for).
        try:
            starts_d = date.fromisoformat(str(raw_item.get("starts"))[:10])
        except (TypeError, ValueError):
            rejected.append("An item's start date was missing or unreadable, that item was skipped.")
            continue

        month_diff = (starts_d.year * 12 + starts_d.month) - today_idx
        if month_diff < -1:
            rejected.append(f"'{str(raw_item.get('label') or 'An item')[:40]}' starts too far in the past, skipped.")
            continue
        if month_diff == -1:
            # Clamp forward to the current month rather than reject.
            starts_d = date(today.year, today.month, 1)
            month_diff = 0
        if month_diff > HORIZON_MONTHS - 1:
            rejected.append(f"'{str(raw_item.get('label') or 'An item')[:40]}' starts too far ahead, skipped.")
            continue

        # ends — optional, dropped to None unless strictly after starts.
        ends_d = None
        ends_raw = raw_item.get("ends")
        if ends_raw:
            try:
                cand = date.fromisoformat(str(ends_raw)[:10])
                if cand > starts_d:
                    ends_d = cand
            except (TypeError, ValueError):
                pass  # unreadable end date -> treated as open-ended, not rejected

        # label
        default_label = _DEFAULT_LABELS[kind]
        label = str(raw_item.get("label") or "").strip()[:_MAX_LABEL_LEN] or default_label

        # category — only meaningful for "removal"
        category = raw_item.get("category")
        category = str(category).strip()[:60] if (kind == "removal" and category) else None

        validated.append({
            "label":     label,
            "amount":    round(amount, 2),
            "direction": direction,
            "cadence":   cadence,
            "starts":    starts_d.isoformat(),
            "ends":      ends_d.isoformat() if ends_d else None,
            "kind":      kind,
            "category":  category,
        })

    if len(validated) > _MAX_ITEMS:
        dropped = validated[_MAX_ITEMS:]
        validated = validated[:_MAX_ITEMS]
        for d in dropped:
            rejected.append(f"Only {_MAX_ITEMS} scenario items at a time, '{d['label']}' was dropped.")

    return validated, rejected


# ── build_delta_series ────────────────────────────────────────────────────────

def build_delta_series(items: list[dict], today: date, horizon: int = HORIZON_MONTHS) -> list[float]:
    """Signed monthly delta to surplus. Index i = calendar month (today + i
    months), i in 0..horizon-1. Negative = less surplus available.

    Pure, no I/O — every item is assumed already normalised (starts/ends are
    ISO date strings, amount already validated positive).
    """
    series = [0.0] * horizon
    today_idx = today.year * 12 + today.month

    for item in items:
        try:
            start_d = date.fromisoformat(item["starts"])
        except (KeyError, ValueError, TypeError):
            continue

        start_i = (start_d.year * 12 + start_d.month) - today_idx
        end_i = horizon  # open-ended default
        ends_raw = item.get("ends")
        if ends_raw:
            try:
                end_d = date.fromisoformat(ends_raw)
                end_i = (end_d.year * 12 + end_d.month) - today_idx
            except (ValueError, TypeError):
                end_i = horizon

        amount = float(item.get("amount") or 0.0)
        sign = 1.0 if item.get("direction") == "in" else -1.0
        cadence = item.get("cadence")

        lo = max(0, start_i)
        hi = min(horizon, end_i)

        if cadence == "monthly":
            for i in range(lo, hi):
                series[i] += sign * amount
        elif cadence == "weekly":
            monthly_equiv = amount * _WEEKLY_TO_MONTHLY
            for i in range(lo, hi):
                series[i] += sign * monthly_equiv
        elif cadence == "annual":
            # Lands ONLY in the anniversary month, then every 12 months —
            # deliberately not smoothed across the year. Which month gets
            # tight is exactly the question being asked (a car insurance
            # renewal squeezes one specific month, it doesn't quietly shave
            # a twelfth off every month), so averaging it away here would
            # hide the thing the user is trying to see.
            i = start_i
            while i < hi:
                if i >= 0:
                    series[i] += sign * amount
                i += 12
        elif cadence == "one_off":
            if lo <= start_i < hi:
                series[start_i] += sign * amount

    return series


# ── steady_monthly_delta ──────────────────────────────────────────────────

def steady_monthly_delta(items: list[dict], today: date, horizon: int = HORIZON_MONTHS) -> float:
    """Ongoing monthly-equivalent drain/relief, for every block that models a
    STEADY movement change (cash's single-figure summary, debt, plans,
    absorb) rather than a specific calendar month.

    Derived from the ITEMS directly, never from build_delta_series's
    per-month series. A single summary statistic can't serve every cadence
    at once: the previous approach (median of the series) is right for a
    delayed-start recurring item (0 for six months, then -450 every month
    after - median -450, correctly ignoring the silent lead-in), but wrong
    for an annual item, which touches only 1-2 of the 24 months and washes
    out to a median of ~0. That reported "no effect on your debt-free date"
    for a real yearly cost that IS taking money out of what could go to
    debt, just not evenly every month - confidently wrong in the direction
    that makes a real commitment look free, which is worse than the
    original problem (modelling lumpy money as smooth).

    Per item, while it has any presence in the horizon:
      monthly  -> amount
      weekly   -> amount * 52/12
      annual   -> amount / 12   (the honest steady-state equivalent of a
                                 lumpy yearly charge - debt/plans/absorb all
                                 reason about an ongoing monthly movement
                                 change, so an annual bill has to be
                                 expressed as its monthly-equivalent share
                                 to be comparable at all)
      one_off  -> 0             (unchanged reasoning from before: a single
                                 payment doesn't move a long-run debt-free
                                 date or a plan's feasibility the way a
                                 recurring drain does - it's a one-time dent
                                 the cash block's per-month series already
                                 shows on its own, and treating it as an
                                 ongoing monthly movement change would be
                                 the same kind of wrong the annual fix above
                                 corrects for, just in the other direction)
    Signed by direction, summed across items.

    build_delta_series is untouched and still the right function for the
    cash block's per-month array: the annual-lands-on-its-anniversary rule
    there is correct and first_tight_month depends on it landing in the
    real month it bites, not smoothed away.
    """
    today_idx = today.year * 12 + today.month
    total = 0.0

    for item in items:
        try:
            start_d = date.fromisoformat(item["starts"])
        except (KeyError, ValueError, TypeError):
            continue

        start_i = (start_d.year * 12 + start_d.month) - today_idx
        end_i = horizon
        ends_raw = item.get("ends")
        if ends_raw:
            try:
                end_d = date.fromisoformat(ends_raw)
                end_i = (end_d.year * 12 + end_d.month) - today_idx
            except (ValueError, TypeError):
                end_i = horizon

        lo = max(0, start_i)
        hi = min(horizon, end_i)
        if hi <= lo:
            continue  # no presence in the horizon at all

        cadence = item.get("cadence")
        amount = float(item.get("amount") or 0.0)
        if cadence == "monthly":
            monthly = amount
        elif cadence == "weekly":
            monthly = amount * _WEEKLY_TO_MONTHLY
        elif cadence == "annual":
            monthly = amount / 12.0
        else:  # one_off
            monthly = 0.0

        sign = 1.0 if item.get("direction") == "in" else -1.0
        total += sign * monthly

    return round(total, 2)


# ── cash block ─────────────────────────────────────────────────────────────

def _build_cash_block(baseline_surplus: float, recurring_delta: float, series: list[float], today: date) -> dict:
    per_month = [round(baseline_surplus + d, 2) for d in series]
    first_tight_month = None
    months_negative = 0
    for i, v in enumerate(per_month):
        if v < 0:
            months_negative += 1
            if first_tight_month is None:
                first_tight_month = _human_month(_month_label(_add_months(today, i)))
    return {
        "surplus_now":        round(baseline_surplus, 2),
        "surplus_after":      round(baseline_surplus + recurring_delta, 2),
        "per_month":          per_month,
        "first_tight_month":  first_tight_month,
        "months_negative":    months_negative,
    }


# ── debt block ─────────────────────────────────────────────────────────────

def _shift_month_label(label: str, delta_months: int) -> str:
    """'YYYY-MM' shifted by delta_months (may be negative)."""
    y, m = (int(x) for x in label.split("-"))
    total = y * 12 + (m - 1) + delta_months
    y2, m2 = divmod(total, 12)
    return f"{y2:04d}-{m2 + 1:02d}"


async def _build_debt_block(uid: str, recurring_delta: float, today: date) -> tuple[dict | None, str | None]:
    """Re-project pooled card movement under a perturbed monthly movement.

    Pooling test mirrors debt_plan.py's own `_compute_scenario_b` exactly
    (debt > 0 and demonstrated monthly movement > 0) — the same population a
    reduced/increased pool is meaningful for.

    `_amortise` is called with each card's `projection_rate_schedule` — the
    schedule the real engine actually amortised against, including its
    "no interest observed, projected without it" doctrine that empties the
    schedule out entirely on a card whose file terms claim a standard rate
    but whose transactions show no interest being charged. This field is
    now exposed alongside `rate_schedule` on the cached plan (see
    debt_plan.py's "Strip internal fields before returning" — one line
    added, additive, nothing else about that engine changed). It falls back
    to `rate_schedule` only when the key is entirely absent (an in-process
    cache entry computed before that change): `rate_schedule` still carries
    interest-bearing segments this engine deliberately isn't charging, so
    using it as anything but a last-resort fallback would fabricate
    interest on a 0% card and contradict the Card plan screen's own figures
    for the same card — exactly the lockstep-breaking drift this module
    exists to avoid.

    Both "now" and "after" trajectories are produced by fresh `_amortise`
    calls that differ ONLY in the movement figure (neither uses the card's
    predicted upcoming-bill schedule, `_predicted_by_month`, which stays
    stripped). That keeps `months_later`/`extra_interest` an apples-to-apples
    diff. The user-facing `debt_free_month_now`, however, is the plan's own
    canonical `totals.debt_free_month` — never a number freshly derived
    here — so this block can never show a different "today" debt-free date
    than the Card plan screen does. The fresh "now" trajectory is computed
    purely to measure the SHIFT (`months_later`), which is then applied to
    the canonical date to produce `debt_free_month_after`.
    """
    plan = await get_debt_plan_cached(uid)
    cards = plan.get("cards") or []
    pooled = [
        c for c in cards
        if c.get("debt", 0) > 0 and (c.get("movement") or {}).get("monthly", 0) and c["movement"]["monthly"] > 0
    ]
    if not pooled:
        return None, "No cards have both a balance and demonstrated monthly movement to project against."

    pooled_total = sum(c["movement"]["monthly"] for c in pooled)

    # A negative recurring_delta tightens things — reduce the pool, floored
    # at 0 per card, capped so we never claim more reduction than the pool
    # actually has (never model extra borrowing). A positive delta loosens
    # things — add to the pool. Both are allocated proportionally to each
    # card's own current movement, so a card already paying down fast isn't
    # squeezed (or credited) any harder than one barely moving at all.
    reduction = min(abs(recurring_delta), pooled_total) if recurring_delta < 0 else 0.0
    increase = recurring_delta if recurring_delta > 0 else 0.0
    movement_exhausted = reduction > 0 and reduction >= pooled_total - 0.005

    now_payoffs: list[str] = []
    after_payoffs: list[str] = []
    now_interest: list[float] = []
    after_interest: list[float] = []
    now_all_clear = True
    after_all_clear = True

    for c in pooled:
        own = c["movement"]["monthly"]
        share = (own / pooled_total) if pooled_total > 0 else 0.0
        if reduction > 0:
            adjusted = max(0.0, own - reduction * share)
        elif increase > 0:
            adjusted = own + increase * share
        else:
            adjusted = own

        # Prefer the schedule the real engine actually used; fall back to
        # the file-derived one ONLY when the key is truly absent (see
        # docstring above) — an empty list under `projection_rate_schedule`
        # is a real, correct "no interest" answer, not a missing value.
        if "projection_rate_schedule" in c:
            rate_schedule = c.get("projection_rate_schedule") or []
        else:
            rate_schedule = c.get("rate_schedule") or []

        now_r = _amortise(c["debt"], own, today, rate_schedule)
        after_r = _amortise(c["debt"], adjusted, today, rate_schedule)

        if now_r["payoff_month"] is None:
            now_all_clear = False
        else:
            now_payoffs.append(now_r["payoff_month"])
            now_interest.append(now_r["total_interest"])

        if after_r["payoff_month"] is None:
            after_all_clear = False
        else:
            after_payoffs.append(after_r["payoff_month"])
            after_interest.append(after_r["total_interest"])

    fresh_now = max(now_payoffs) if (now_all_clear and now_payoffs) else None
    fresh_after = max(after_payoffs) if (after_all_clear and after_payoffs) else None

    months_later = None
    if fresh_now and fresh_after:
        months_later = _month_diff(fresh_after, fresh_now)

    # The canonical, already-published debt-free date — this plan's own
    # totals, never re-derived. Its population (MATERIAL_BALANCE-filtered,
    # excludes cleared_monthly cards) can differ from `pooled` above (which
    # only requires debt > 0 and positive movement), so the two are allowed
    # to disagree on WHETHER a date exists at all; that's expected, not a
    # bug. What would signal an unresolved problem is the two DATES
    # disagreeing by more than a month when both exist — logged, not
    # silently swallowed, since that's a symptom this module can't fix on
    # its own (it would mean something beyond the schedule fix is still
    # diverging between the two engines).
    canonical_now = (plan.get("totals") or {}).get("debt_free_month")
    if canonical_now and fresh_now and abs(_month_diff(canonical_now, fresh_now)) > 1:
        log.warning(
            "scenario debt block: canonical debt_free_month (%s) diverges from the "
            "fresh same-schedule re-amortisation (%s) by more than a month for uid=%s",
            canonical_now, fresh_now, uid,
        )

    debt_free_month_now = canonical_now
    debt_free_month_after = (
        _shift_month_label(canonical_now, months_later)
        if (canonical_now and months_later is not None)
        else None
    )

    # Interest is only ever a meaningful figure over a window both sides
    # actually clear in — same doctrine as debt_plan.py's own
    # `card_interest_total` (a card that never clears mustn't carry a
    # horizon-capped interest integral, it's arithmetically defined but
    # humanly meaningless). This stays a fresh-vs-fresh diff (no canonical
    # interest total is comparable here, since the canonical figure is
    # summed over a different card population).
    extra_interest = None
    if now_all_clear and after_all_clear:
        extra_interest = round(sum(after_interest) - sum(now_interest), 2)

    block = {
        "debt_free_month_now":   _human_month(debt_free_month_now),
        "debt_free_month_after": _human_month(debt_free_month_after),
        "months_later":          months_later,
        "extra_interest":        extra_interest,
        "movement_exhausted":    movement_exhausted,
        "clears_after":          after_all_clear,
    }

    note = None
    if movement_exhausted:
        note = "This would use up all of your cards' demonstrated monthly movement, they'd stop coming down."
    elif now_all_clear and not after_all_clear:
        note = "At this reduced pace, at least one card would no longer clear within the projection window."

    return block, note


# ── plans block ──────────────────────────────────────────────────────────────

async def _build_plans_block(uid: str, baseline_surplus: float, recurring_delta: float) -> tuple[dict | None, str | None]:
    """Re-classify each active commitment's feasibility under a perturbed
    surplus, reusing `_apply_joint_feasibility` (the exact pure pass
    `list_commitments` already runs) rather than re-deriving the
    others_slice/others_remaining bookkeeping here. The pot ledger itself is
    never touched — per_period_slice and remaining come straight from
    `list_commitments`'s own serialisation and are surplus-independent.
    """
    from app.routers.commitments import _apply_joint_feasibility, _feasibility_ctx, list_commitments

    resp = await list_commitments(user={"email": uid})
    items = resp.get("items") or []
    active = [it for it in items if (it.get("status") or "active") == "active"]
    if not active:
        return None, "No active plans to check against this scenario."

    if any(it.get("feasibility") is None for it in active):
        # `list_commitments` itself couldn't build a feasibility context
        # (cashflow/savings read failed) — nothing honest to compare here.
        return None, "Plan feasibility isn't available right now."

    fctx_now = await _feasibility_ctx(uid)
    if fctx_now is None:
        return None, "Plan feasibility isn't available right now."
    _surplus_now, available_savings = fctx_now
    adjusted_fctx = (round(baseline_surplus + recurring_delta, 2), available_savings)

    after_items = [dict(it) for it in items]
    fake_docs = [{"status": it.get("status", "active")} for it in items]
    # debt_shortfall=0.0: it only changes the WORDING of a feasibility_note,
    # never which bucket (funded/surplus/savings/stretch) a goal lands in —
    # see `_classify_feasibility` — and only the bucket is compared here.
    _apply_joint_feasibility(after_items, fake_docs, adjusted_fctx, debt_shortfall=0.0)

    out_items = []
    any_worse = False
    for idx, it in enumerate(items):
        if (it.get("status") or "active") != "active":
            continue
        now_f = it.get("feasibility")
        after_f = after_items[idx].get("feasibility")
        slipped = _FEASIBILITY_RANK.get(after_f, 0) > _FEASIBILITY_RANK.get(now_f, 0)
        any_worse = any_worse or slipped
        out_items.append({
            "name":              it.get("name"),
            "feasibility_now":   now_f,
            "feasibility_after": after_f,
            "target_date":       it.get("target_date"),
            "slipped":           slipped,
        })

    return {"items": out_items, "any_worse": any_worse}, None


# ── grow block ─────────────────────────────────────────────────────────────

def _spending_only_items(items: list[dict]) -> list[dict]:
    """Items restricted to ones that change actual spending (a new cost or
    a cancelled one) — an income_change item moves the surplus but doesn't
    change what the emergency fund is measured against."""
    return [it for it in items if it.get("kind") in ("new_outgoing", "removal")]


async def _build_grow_block(uid: str, items: list[dict], monthly_spending: float, today: date, horizon: int) -> tuple[dict | None, str | None]:
    """Minimal, honest grow re-evaluation: months of emergency-fund cover
    now vs after.

    grow.py's rung ladder (essentials/pension/starter-buffer/expensive-debt/
    full-fund/pension-topup/isa) is copy-heavy and FCA-doctrined (facts-only
    phrasing per rung, "options" text, a locked/active/done state machine) —
    not a pure function of monthly surplus that can be re-run without
    duplicating that copy logic. Rather than reimplement it, this returns
    the one honest, directly comparable number grow.py already surfaces on
    its own headline ("Your buffer covers ~N months"): current savings
    against monthly spend, before and after the scenario's spending-side
    effect.
    """
    if monthly_spending <= 0:
        return None, "Not enough spending history yet to estimate emergency-fund cover."

    from app.db.collections import savings_goals_col
    from app.routers.savings import _current_savings

    goal = await savings_goals_col.find_one({"_id": uid})
    current_savings = await _current_savings(uid, goal)

    spend_items = _spending_only_items(items)
    spend_delta = steady_monthly_delta(spend_items, today, horizon) if spend_items else 0.0
    # direction "out" (a new cost) makes spend_delta negative; subtracting a
    # negative raises spending, exactly the effect a new cost should have.
    # direction "in" (a cancellation) makes it positive, lowering spending.
    adjusted_spending = max(0.0, monthly_spending - spend_delta)

    months_now = round(current_savings / monthly_spending, 1)
    months_after = round(current_savings / adjusted_spending, 1) if adjusted_spending > 0 else None

    return {
        "months_cover_now":   months_now,
        "months_cover_after": months_after,
        "current_savings":    round(current_savings, 2),
    }, None


# ── absorb block ───────────────────────────────────────────────────────────

async def _build_absorb_block(uid: str, recurring_delta: float, baseline_surplus: float, cat_medians: dict) -> tuple[dict | None, str | None]:
    """Where a tightened surplus would come from: how much of it the
    existing spare surplus already covers, and which discretionary
    categories (by declared kind, never a hardcoded list) carry the biggest
    typical monthly spend to draw down first."""
    if recurring_delta >= 0:
        return None, "This scenario doesn't reduce your spare cash, so there's nothing to absorb."

    shortfall = round(abs(recurring_delta), 2)
    covered_by_surplus = round(min(shortfall, max(0.0, baseline_surplus)), 2)

    kinds = await get_category_kinds(uid)
    discretionary = sorted(
        ((cat, amt) for cat, amt in (cat_medians or {}).items() if amt > 0 and is_discretionary(kinds, cat)),
        key=lambda kv: kv[1],
        reverse=True,
    )[:3]
    candidates = [{"category": cat, "monthly": round(amt, 2)} for cat, amt in discretionary]

    return {
        "shortfall":           shortfall,
        "covered_by_surplus":  covered_by_surplus,
        "candidates":          candidates,
    }, None


# ── reasons plumbing ───────────────────────────────────────────────────────
# The frontend used to recover "why is this block None" by string-prefix
# matching the flat `assumptions` list (see app/routers/scenario.py's own
# `_is_lumpy_scenario` for the sibling instance of this anti-pattern) — a
# copy edit to any of the reason strings below would silently desync that
# matching with no test failing. `reasons` is the structured replacement:
# every block gets its own `reasons[key]`, populated ONLY when that block is
# None (the reason it's missing); a populated block always gets
# `reasons[key] is None`. This function is the single place that routes a
# (block, note) pair from a builder into that structure.

def _resolve_block_reason(
    key: str,
    block: dict | None,
    note: str | None,
    reasons: dict[str, str | None],
    assumptions: list[str],
) -> None:
    """Route one block builder's (block, note) result into `reasons`.

    - block is None: `note` is WHY, and belongs in `reasons[key]` — never in
      the flat `assumptions` list, which is reserved for genuinely global
      assumptions not attributable to a single block. Every builder that can
      return None must always pair it with a plain-English note; if a future
      change ever breaks that (block is None but note is falsy), that is a
      bug in the builder, not something to guess past silently — logged
      loudly and defensively backfilled with `_MISSING_REASON_FALLBACK`
      rather than shipping an unexplained None (never raised: one block's
      problem must never take down the rest of `simulate()`'s response).
    - block is populated: `reasons[key]` is None. If `note` is still present
      it's a CAVEAT about the populated block (e.g. the debt block's
      "movement_exhausted" note, which fires alongside a fully-built debt
      block, not instead of one) — there is no reasons-shaped home for
      "this block exists but here's a caveat", so it stays in the flat
      `assumptions` list, same as before.
    """
    if block is None:
        if not note:
            log.error(
                "scenario simulate(): block %r resolved to None with no reason attached, "
                "this should never happen", key,
            )
            note = _MISSING_REASON_FALLBACK
        reasons[key] = note
    else:
        reasons[key] = None
        if note:
            assumptions.append(note)


# ── simulate ─────────────────────────────────────────────────────────────────

async def simulate(uid: str, items: list[dict]) -> dict:
    """Full deterministic simulation for `uid` against declared scenario
    `items` (raw, unvalidated caller input). Every block degrades to `None`
    plus a plain-English reason in `reasons[<block>]` rather than guessing.
    `assumptions` carries only genuinely global notes (not attributable to a
    single block) plus, when a populated block still has a caveat worth
    surfacing (e.g. debt's movement_exhausted note), that caveat text."""
    today = date.today()
    clean_items, rejected = normalise_items(items)
    assumptions: list[str] = ["Assumes your payday and rhythm stay as they are."]

    region = await get_user_region(uid)
    cutoff = datetime.now() - timedelta(days=90)
    cf = await monthly_cashflow_cached(uid, region, cutoff)
    monthly_income = cf.get("income", 0.0)
    monthly_spending = cf.get("spending", 0.0)
    monthly_debt = cf.get("debt", 0.0)
    n_months = cf.get("n_months", 0)
    # Same formula as app.routers.savings._cashflow's surplus (income minus
    # spending minus committed debt repayments) — the one figure every
    # feasibility/plan surface in the app already treats as "genuinely free".
    baseline_surplus = round(monthly_income - monthly_spending - monthly_debt, 2)

    baseline = {
        "monthly_surplus":  baseline_surplus,
        "monthly_income":   monthly_income,
        "monthly_spending": monthly_spending,
        "n_months":         n_months,
    }

    if not clean_items:
        # Every block is None for the exact same reason here — there's
        # nothing to simulate — so that reason is attributed to each block
        # in `reasons` individually, not left in the flat `assumptions` list
        # (which would duplicate it five times over once the frontend reads
        # `reasons` instead).
        no_items_reason = "No valid scenario items to simulate yet."
        reasons = {k: no_items_reason for k in ("cash", "debt", "plans", "grow", "absorb")}
        return {
            "horizon_months": HORIZON_MONTHS,
            "items":          [],
            "rejected":       rejected,
            "baseline":       baseline,
            "recurring_delta": 0.0,
            "cash":   None,
            "debt":   None,
            "plans":  None,
            "grow":   None,
            "absorb": None,
            "assumptions": assumptions,
            "reasons": reasons,
            "lumpy":   False,
        }

    series = build_delta_series(clean_items, today, HORIZON_MONTHS)
    # steady_monthly_delta (not the series' own median - see its docstring)
    # feeds every block that reasons about an ONGOING monthly change: cash's
    # single-figure summary, debt, plans, absorb. The series itself stays
    # the source for cash's per-month array and first_tight_month, where
    # an annual item landing hard in one real month is the correct picture.
    recurring_delta = steady_monthly_delta(clean_items, today, HORIZON_MONTHS)

    # Flag when the steady figure is mostly (or entirely) built from lumpy
    # cadences (annual, one_off) rather than an evenly-spread monthly/weekly
    # change. A one_off always contributes 0 to recurring_delta by design
    # (see steady_monthly_delta), so its presence alone is a 100% lumpy
    # signal regardless of any magnitude comparison; an annual item is
    # compared against the monthly/weekly total on its own honest
    # monthly-equivalent terms. `lumpy` is the structured flag callers (e.g.
    # app.routers.scenario's `_is_lumpy_scenario`) must read directly rather
    # than re-deriving or string-matching the assumption note below.
    lumpy = False
    lumpy_items = [it for it in clean_items if it.get("cadence") in ("annual", "one_off")]
    if lumpy_items:
        has_one_off = any(it.get("cadence") == "one_off" for it in clean_items)
        smooth_items = [it for it in clean_items if it.get("cadence") in ("monthly", "weekly")]
        smooth_delta = abs(steady_monthly_delta(smooth_items, today, HORIZON_MONTHS)) if smooth_items else 0.0
        lumpy_delta = abs(steady_monthly_delta(lumpy_items, today, HORIZON_MONTHS))
        if has_one_off or lumpy_delta >= smooth_delta:
            lumpy = True
            # Genuinely global (applies across every block, not one of
            # them), so this stays in `assumptions` rather than `reasons`.
            assumptions.append(
                "Some of this lands in specific months rather than being spread evenly, "
                "see the month-by-month figures for where it actually bites."
            )

    thin_history = n_months < 2
    reasons: dict[str, str | None] = {}

    cash = None
    if thin_history:
        reasons["cash"] = "Fewer than 2 months of transaction history, cash flow can't be projected yet."
    else:
        try:
            cash = _build_cash_block(baseline_surplus, recurring_delta, series, today)
            reasons["cash"] = None
        except Exception:
            cash = None
            reasons["cash"] = "Couldn't project your cash flow for this scenario right now."

    debt = None
    try:
        debt, debt_note = await _build_debt_block(uid, recurring_delta, today)
        _resolve_block_reason("debt", debt, debt_note, reasons, assumptions)
    except Exception:
        debt = None
        reasons["debt"] = "Couldn't re-project your debt cards for this scenario right now."

    plans = None
    try:
        plans, plans_note = await _build_plans_block(uid, baseline_surplus, recurring_delta)
        _resolve_block_reason("plans", plans, plans_note, reasons, assumptions)
    except Exception:
        plans = None
        reasons["plans"] = "Couldn't re-check your plans for this scenario right now."

    grow = None
    try:
        grow, grow_note = await _build_grow_block(uid, clean_items, monthly_spending, today, HORIZON_MONTHS)
        _resolve_block_reason("grow", grow, grow_note, reasons, assumptions)
    except Exception:
        grow = None
        reasons["grow"] = "Couldn't estimate emergency-fund cover for this scenario right now."

    absorb = None
    if thin_history:
        # Same underlying reason as the cash block's thin-history case
        # above — shares its exact text rather than inventing a second one.
        reasons["absorb"] = "Fewer than 2 months of transaction history, cash flow can't be projected yet."
    else:
        try:
            absorb, absorb_note = await _build_absorb_block(uid, recurring_delta, baseline_surplus, cf.get("cat") or {})
            _resolve_block_reason("absorb", absorb, absorb_note, reasons, assumptions)
        except Exception:
            absorb = None
            reasons["absorb"] = "Couldn't work out where this would come from right now."

    return {
        "horizon_months": HORIZON_MONTHS,
        "items":          clean_items,
        "rejected":       rejected,
        "baseline":       baseline,
        "recurring_delta": recurring_delta,
        "cash":   cash,
        "debt":   debt,
        "plans":  plans,
        "grow":   grow,
        "absorb": absorb,
        "assumptions": assumptions,
        "reasons": reasons,
        "lumpy":   lumpy,
    }
