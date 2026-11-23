"""G493: the overspending engine.

Computed at sync and stored (H145: screens only read stored results), per user
per pay period. It answers, with the SAME figures Spend shows:

  * has Out passed In this period, and by how much (`crossed`, `gap`);
  * what funded the gap: savings drawn down, new card debt, or the current
    account run down (`funded_by`);
  * for the current period before payday, whether the pace would carry Out past
    In (`on_course`);
  * whether savings were dipped into over the last completed periods (`trend`);
  * whether the user said the period was a one-off (`acknowledged`).

Definitions (Kevin, 2026-11-23):

  Out  = Spend's `pills.spent`: `spend_verdict.bucket_transactions` over
         `spend_verdict._load_period_txns`. Own-account moves and card
         repayments are never Out (`spending.classify_flow`); card purchases are.
  In   = Spend's `pills.income` (net of INCOME_FLOW rows). Own moves never count.
  Gap  = max(0, Out - In).
  From savings = max(0, all debits on savings accounts - own-account moves back
         INTO savings accounts in the period).
  Funded by (gap > 0 only): savings = min(gap, from_savings);
         cards = min(gap - savings, max(0, card growth));
         current account = the rest. The three sum exactly to the gap.

Nothing here changes a figure Spend, Money Shape or Left to spend returns.
There is no user-facing copy in this module, and nothing here claims money was
saved. The acknowledgement is asked, never inferred: it is written only by
`POST /spend/overspend/one-off`, and it silences a period without changing a
number.

The core (`build_overspending`) is pure; `compute_and_cache_overspending` loads
the data and stores the result in `overspending_cache` (`_id` = uid).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone

from app.core import timeutil
from app.db.collections import (
    accounts_col,
    cashflow_cache_col,
    overspending_ack_col,
    overspending_cache_col,
    preferences_col,
    yapily_accounts_col,
)
from app.services import data_version
from app.services.account_kinds import is_credit_card_account, is_savings_account
from app.services.counted_accounts import is_excluded
from app.services.spending import INCOME_FLOW, REFUND, SPEND, classify_flow

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1
#: Same guard as pace multiples (`pace.compute_category_signals`).
MIN_DAYS_FOR_PROJECTION = 5
#: How many completed periods the savings-drawdown trend looks back over.
TREND_PERIODS = 4
ACK_ONE_OFF = "one_off"
_BACKGROUND_RETRY_PAUSES = (0.2, 0.5)


def _r(x: float) -> float:
    return round(float(x) + 0.0, 2)


# ── Pure core ────────────────────────────────────────────────────────────────

def split_funded_by(gap: float, from_savings: float, card_growth: float) -> dict:
    """Split `gap` between savings, cards and the current account. Rounded to
    pence; the three sum exactly to `gap` (the current account takes the
    remainder)."""
    gap = _r(max(0.0, gap))
    if gap <= 0:
        return {"savings": 0.0, "cards": 0.0, "current_account": 0.0}
    savings = _r(min(gap, max(0.0, from_savings)))
    cards = _r(min(_r(gap - savings), max(0.0, card_growth)))
    current = _r(gap - savings - cards)
    return {"savings": savings, "cards": cards, "current_account": current}


def _in_window(txns: list[dict], start: date, end: date) -> list[dict]:
    return [t for t in txns if start <= t["date"] <= end]


def period_figures(
    txns: list[dict],
    kind_map: dict,
    savings_ids: set[str],
    card_ids: set[str],
    start: date,
    end: date,
) -> dict:
    """Out / In / gap / from_savings / funded_by for one period.

    `txns` are `spend_verdict._load_period_txns` rows (any window; sliced here
    by date). Out and In are `bucket_transactions`' own output, so they equal
    Spend's `pills.spent` / `pills.income` for that period."""
    from app.services.needle import _card_delta
    from app.services.spend_verdict import bucket_transactions

    rows = _in_window(txns, start, end)
    cat_agg, _moved, income_total = bucket_transactions(rows, kind_map)
    out = _r(sum(row["spent"] for row in cat_agg.values()))
    inc = _r(income_total)
    gap = _r(max(0.0, out - inc))

    # Net money out of savings: every debit on a savings account, less what an
    # own-account move put back into one in the same period (interest and other
    # credits that are not own moves are not "moved back").
    sav_debits = sum(t["amount"] for t in rows if t["account_id"] in savings_ids and t["debit"])
    sav_back = sum(
        t["amount"] for t in rows
        if t["account_id"] in savings_ids and not t["debit"] and t.get("own_move")
    )
    from_savings = _r(max(0.0, sav_debits - sav_back))

    # Card balance growth over the period's own card-account transactions,
    # `needle._card_delta` (debits - credits). There is no balance history.
    card_growth = _r(_card_delta([
        {"transaction_type": "debit" if t["debit"] else "credit", "amount": t["amount"]}
        for t in rows if t["account_id"] in card_ids
    ]))

    funded_by = split_funded_by(gap, from_savings, card_growth)
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "out": out,
        "in": inc,
        "gap": gap,
        "from_savings": from_savings,
        "card_growth": card_growth,
        "funded_by": funded_by,
        "savings_covered": bool(gap > 0 and from_savings > 0),
    }


def first_crossed_on(txns: list[dict], kind_map: dict, start: date, end: date) -> str | None:
    """The first date (end of day) on which cumulative Out was above cumulative
    In, using the same flow classification as Out and In. None if it never was."""
    rows = sorted(_in_window(txns, start, end), key=lambda t: t["date"])
    cum_out = cum_in = 0.0
    i = 0
    while i < len(rows):
        day = rows[i]["date"]
        while i < len(rows) and rows[i]["date"] == day:
            t = rows[i]
            flow = classify_flow(kind_map, t["category"], t["debit"], bool(t.get("own_move")), bool(t.get("card_repayment")))
            if flow.kind == INCOME_FLOW:
                cum_in += t["amount"] if t["debit"] is False else -t["amount"]
            elif flow.kind in (SPEND, REFUND):
                cum_out += t["amount"] if t["debit"] else -t["amount"]
            i += 1
        if _r(cum_out) > _r(cum_in):
            return day.isoformat()
    return None


def _drivers(spent_by_cat: dict[str, float], signals: dict | None) -> list[dict]:
    """Top two categories by (spent - usual_by_now), positive excess only.
    "Other" is carved out, as in `spend_verdict.compute_pace_totals`."""
    out: list[dict] = []
    for cat, spent in (spent_by_cat or {}).items():
        if cat == "Other":
            continue
        ubn = ((signals or {}).get(cat) or {}).get("usual_by_now")
        if ubn is None:
            continue
        excess = float(spent) - float(ubn)
        if excess > 0:
            out.append({
                "category": cat,
                "spent": _r(spent),
                "usual_by_now": _r(ubn),
                "excess": _r(excess),
            })
    out.sort(key=lambda d: (-d["excess"], d["category"]))
    return out[:2]


def on_course_block(
    *,
    out_to_date: float,
    in_to_date: float,
    days_elapsed: int,
    length_days: int,
    predicted_income: float | None,
    drivers: list[dict],
) -> dict:
    """The current period's projection. `projected_*` are None until
    `days_elapsed >= MIN_DAYS_FOR_PROJECTION` (same guard as pace multiples)."""
    if days_elapsed < MIN_DAYS_FOR_PROJECTION or length_days <= 0:
        return {
            "available": False,
            "projected_out": None,
            "projected_in": None,
            "predicted_income": None if predicted_income is None else _r(predicted_income),
            "on_course_to_cross": None,
            "projected_gap": None,
            "drivers": [],
        }
    projected_out = _r(out_to_date * length_days / days_elapsed)
    projected_in = _r(in_to_date + max(0.0, predicted_income or 0.0))
    return {
        "available": True,
        "projected_out": projected_out,
        "projected_in": projected_in,
        "predicted_income": None if predicted_income is None else _r(predicted_income),
        "on_course_to_cross": projected_out > projected_in,
        "projected_gap": _r(max(0.0, projected_out - projected_in)),
        "drivers": drivers,
    }


def trend_block(periods: list[dict]) -> dict:
    """`periods` oldest first, most recent last. `consecutive` counts the
    trailing run of savings-covered periods."""
    consecutive = 0
    for p in reversed(periods):
        if not p["savings_covered"]:
            break
        consecutive += 1
    return {
        "periods_considered": len(periods),
        "dipped_count": sum(1 for p in periods if p["savings_covered"]),
        "consecutive": consecutive,
        "periods": periods,
    }


def build_overspending(
    *,
    txns: list[dict],
    kind_map: dict,
    savings_ids: set[str],
    card_ids: set[str],
    current: dict,
    history: list[tuple[date, date]],
    signals: dict | None = None,
    predicted_income: float | None = None,
    acknowledged_period_ends: set[str] | frozenset[str] = frozenset(),
) -> dict:
    """The stored document body. Pure: no I/O.

    `current` = {"start": date, "end": date, "days_elapsed": int,
    "length_days": int}. `history` = completed periods, oldest first (at most
    `TREND_PERIODS` are used); a period with no transactions at all is skipped
    as "no data", not counted as a period without a dip."""
    start, end = current["start"], current["end"]
    fig = period_figures(txns, kind_map, savings_ids, card_ids, start, end)

    from app.services.spend_verdict import bucket_transactions
    cat_agg, _m, _i = bucket_transactions(_in_window(txns, start, end), kind_map)
    spent_by_cat = {c: row["spent"] for c, row in cat_agg.items()}

    crossed = fig["out"] > fig["in"]
    result = {
        "period": {
            "start": fig["start"],
            "end": fig["end"],
            "length_days": int(current["length_days"]),
            "days_elapsed": int(current["days_elapsed"]),
        },
        "out": fig["out"],
        "in": fig["in"],
        "gap": fig["gap"],
        "crossed": crossed,
        "crossed_by": fig["gap"],
        "crossed_on": first_crossed_on(txns, kind_map, start, end) if crossed else None,
        "from_savings": fig["from_savings"],
        "funded_by": fig["funded_by"],
        "savings_covered": fig["savings_covered"],
        "on_course": on_course_block(
            out_to_date=fig["out"],
            in_to_date=fig["in"],
            days_elapsed=int(current["days_elapsed"]),
            length_days=int(current["length_days"]),
            predicted_income=predicted_income,
            drivers=_drivers(spent_by_cat, signals),
        ),
    }

    trend_periods: list[dict] = []
    for h_start, h_end in history[-TREND_PERIODS:]:
        if not _in_window(txns, h_start, h_end):
            continue
        f = period_figures(txns, kind_map, savings_ids, card_ids, h_start, h_end)
        trend_periods.append({
            "start": f["start"],
            "end": f["end"],
            "out": f["out"],
            "in": f["in"],
            "gap": f["gap"],
            "from_savings": f["from_savings"],
            "funded_by": f["funded_by"],
            "savings_covered": f["savings_covered"],
            "acknowledged": False,
        })
    result["trend"] = trend_block(trend_periods)
    result["acknowledged"] = False
    apply_acknowledgements(result, acknowledged_period_ends)
    return result


def apply_acknowledgements(doc: dict, acknowledged_period_ends: set[str] | frozenset[str]) -> dict:
    """Stamp `acknowledged` on the current period and each trend period, in
    place. Changes no number."""
    acked = set(acknowledged_period_ends or ())
    doc["acknowledged"] = (doc.get("period") or {}).get("end") in acked
    for p in (doc.get("trend") or {}).get("periods") or []:
        p["acknowledged"] = p.get("end") in acked
    return doc


# ── I/O ──────────────────────────────────────────────────────────────────────

async def acknowledged_period_ends(uid: str) -> set[str]:
    out: set[str] = set()
    async for d in overspending_ack_col.find({"user_id": uid, "answer": ACK_ONE_OFF}):
        if d.get("period_end"):
            out.add(str(d["period_end"]))
    return out


async def _account_classes(uid: str) -> tuple[set[str], set[str]]:
    """(savings account ids, credit-card account ids), counted accounts only,
    across both providers."""
    raw = await accounts_col.find({"user_id": uid}).to_list(None)
    raw += await yapily_accounts_col.find({"user_id": uid}).to_list(None)
    savings: set[str] = set()
    cards: set[str] = set()
    for a in raw:
        if is_excluded(a):
            continue
        aid = str(a.get("account_id") or a.get("_id"))
        if is_credit_card_account(a):
            cards.add(aid)
        elif is_savings_account(a):
            savings.add(aid)
    return savings, cards


async def predicted_income_before_payday(uid: str, prefs: dict) -> float | None:
    """Predicted money in still expected before payday, on Left to spend's own
    window and the G481 rule: the window income `build_window_inputs` hands the
    walks (before payday, excluded accounts dropped), kept only when
    `account_walk.income_counts_in_walk` (today's unposted income does not
    count) and `account_available.predicted_money_in` hold for a counted current
    account. None when it cannot be read."""
    try:
        from app.routers.analytics import _build_cashflow_response, _safe_to_spend_accounts
        from app.services.account_available import counted_current_ids, predicted_money_in
        from app.services.account_walk import income_counts_in_walk
        from app.services.window_inputs import LoadedAccounts, build_window_inputs

        cached = await cashflow_cache_col.find_one({"_id": uid})
        if not cached:
            return None
        resp = await _build_cashflow_response(cached, uid=uid)
        accounts = await _safe_to_spend_accounts(uid)
        counted = counted_current_ids(accounts)
        excluded_ids = {str(a["_id"]) for a in accounts if is_excluded(a) and a.get("_id") is not None}

        async def _loader(_bills: list[dict]) -> LoadedAccounts:
            return LoadedAccounts(live_balances={}, excluded_account_ids=excluded_ids)

        wi = await build_window_inputs(
            uid, resp, prefs, load_balances=_loader,
            reapply_exclusions="always", load_when_no_bills=True,
        )
        total = 0.0
        for item in wi.window_income:
            acct = str(item.get("account_id") or "")
            if acct not in counted or not income_counts_in_walk(item):
                continue
            if predicted_money_in(item, acct, wi.confirmed_income_keys):
                total += float(item.get("amount") or 0)
        return _r(total)
    except Exception:
        logger.exception("overspending: predicted income unavailable for %s", uid)
        return None


async def compute_overspending(uid: str) -> dict:
    """Load everything and build the stored body for `uid`."""
    from app.services.categories import get_category_kinds
    from app.services.pace import compute_category_signals
    from app.services.pay_period import get_pay_period_for_date, prev_pay_period
    from app.services.spend_verdict import _load_period_txns

    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today = timeutil.user_today()
    start, end = get_pay_period_for_date(today, pay_cfg)

    history: list[tuple[date, date]] = []
    h_start = start
    for _ in range(TREND_PERIODS):
        h_start, h_end = prev_pay_period(h_start, pay_cfg)
        history.append((h_start, h_end))
    history.reverse()  # oldest first

    kind_map, (savings_ids, card_ids), acked = await asyncio.gather(
        get_category_kinds(uid),
        _account_classes(uid),
        acknowledged_period_ends(uid),
    )
    # One load over the whole look-back: own-move pairing is windowed with
    # padding either way, and every period is then sliced from the same rows.
    txns = await _load_period_txns(uid, history[0][0], end)

    signals: dict | None = None
    days_elapsed = max(1, (today - start).days)
    try:
        sig = await compute_category_signals(uid, offset=0, kind_map=kind_map)
        signals = sig["signals"]
        days_elapsed = int(sig["period"]["days_elapsed"])
    except Exception:
        logger.exception("overspending: category signals unavailable for %s", uid)

    predicted = await predicted_income_before_payday(uid, prefs)

    return build_overspending(
        txns=txns,
        kind_map=kind_map,
        savings_ids=savings_ids,
        card_ids=card_ids,
        current={
            "start": start,
            "end": end,
            "days_elapsed": days_elapsed,
            "length_days": (end - start).days + 1,
        },
        history=history,
        signals=signals,
        predicted_income=predicted,
        acknowledged_period_ends=acked,
    )


async def compute_and_cache_overspending(uid: str, *, background: bool = True) -> dict | None:
    """Compute and store, compare-and-swap on the user's data version (same
    pattern as `money_shape.compute_and_cache_money_shape`): a compute whose
    version moved underneath it is never stored. The background path tries up to
    three times then skips quietly (returns None); the next sync rebuilds it."""
    attempts = 3 if background else 2
    for attempt in range(attempts):
        version = await data_version.current(uid, fresh=True)
        data = await compute_overspending(uid)
        data["data_version"] = version
        data["computed_at"] = datetime.now(timezone.utc)  # naive-ok: audit stamp, aware instant
        data["schema_version"] = SCHEMA_VERSION
        if await data_version.current(uid, fresh=True) == version:
            # Full replace: keys from an older schema can never linger.
            await overspending_cache_col.replace_one({"_id": uid}, {"_id": uid, **data}, upsert=True)
            if await data_version.current(uid, fresh=True) == version:
                return data
        if background and attempt < attempts - 1:
            await asyncio.sleep(_BACKGROUND_RETRY_PAUSES[attempt])
    if background:
        logger.info("overspending refresh skipped for %s: data changed during refresh", uid)
        return None
    raise RuntimeError("Overspending changed while refreshing; retry the request")


async def read_stored_overspending(uid: str) -> dict | None:
    """The stored doc as the payloads expose it, or None. Never computes. A doc
    written by another schema version is treated as absent."""
    try:
        doc = await overspending_cache_col.find_one({"_id": uid})
    except Exception:
        logger.exception("overspending: stored read failed for %s", uid)
        return None
    if not doc or doc.get("schema_version") != SCHEMA_VERSION:
        return None
    doc = dict(doc)
    for k in ("_id", "data_version"):
        doc.pop(k, None)
    return doc


# ── One-off acknowledgement (asked, never inferred) ──────────────────────────

async def current_period_end(uid: str) -> date:
    from app.services.pay_period import get_pay_period_for_date
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    return get_pay_period_for_date(timeutil.user_today(), pay_cfg)[1]


async def is_valid_period_end(uid: str, period_end: date) -> bool:
    """True when `period_end` is the end of the current pay period or of an
    earlier one, under the user's pay_period_config."""
    from app.services.pay_period import get_pay_period_for_date
    prefs = await preferences_col.find_one({"user_id": uid}) or {}
    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    if period_end > await current_period_end(uid):
        return False
    return get_pay_period_for_date(period_end, pay_cfg)[1] == period_end


async def _restamp_stored(uid: str) -> None:
    """Patch `acknowledged` on the stored doc (no recompute, no number moves)."""
    doc = await overspending_cache_col.find_one({"_id": uid})
    if not doc:
        return
    apply_acknowledgements(doc, await acknowledged_period_ends(uid))
    await overspending_cache_col.update_one(
        {"_id": uid},
        {"$set": {"acknowledged": doc["acknowledged"], "trend": doc.get("trend")}},
    )


async def record_one_off(uid: str, period_end: date | None = None) -> str:
    """Record the user's "it's a one-off" answer for a period (default: the
    current one). Idempotent. Returns the period end (ISO)."""
    if period_end is None:
        period_end = await current_period_end(uid)
    elif not await is_valid_period_end(uid, period_end):
        raise ValueError("period_end is not the end of the current or an earlier pay period")
    pe = period_end.isoformat()
    await overspending_ack_col.update_one(
        {"_id": f"{uid}:{pe}"},
        {"$set": {
            "user_id": uid,
            "period_end": pe,
            "answer": ACK_ONE_OFF,
            "created_at": datetime.now(timezone.utc),  # naive-ok: audit stamp, aware instant
        }},
        upsert=True,
    )
    await _restamp_stored(uid)
    return pe


async def delete_one_off(uid: str, period_end: date | None = None) -> str:
    """Undo. Idempotent: undoing an answer never recorded is a no-op."""
    pe = (period_end or await current_period_end(uid)).isoformat()
    await overspending_ack_col.delete_one({"_id": f"{uid}:{pe}"})
    await _restamp_stored(uid)
    return pe
