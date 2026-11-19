"""G479: Left to spend follows each account's day-by-day timing (supersedes the closing-figure rule below).

Kevin 2026-11-19 (option A): Left to spend is what can be spent without any payment failing. Each
counted current account contributes the LOWEST balance of its own walk between now and payday
(`lowest_point`: its running balance after any payment, or at the end, or the overdraft if it is
overdrawn today), then its goals and set-asides come off. Predicted money in counts only from its
expected date: money that lands before a payment leaves no dip (Kevin's case with the income first reads
about 606.57), money that lands after one cannot rescue it (the same account with the bill first is
34.89 - 77.91 = -43.02, short, then back to about 606.57 once the money has landed). A dip below zero is
a shortfall and is never floored away: the contribution shown is `max(0, figure)` and the shortfall
`max(0, -figure)`, and the total is the signed sum, so an account that dips with nothing to cover it
reduces the total by exactly its shortfall (G436, G446).

Covered dips (G410). A suggested move from another current account covers a dip: the source keeps the
earmark (its figure falls by the move) and the destination's dip is covered by the move (its figure rises
by it). The pair costs the total the dip exactly once, the same as if the dip were uncovered, so a dip is
never penalised twice (once as the destination's shortfall and again as the source's earmark) and the
cover plan never changes the headline (G410: "pool never changes", G436: moves net to zero).

Own-account transfers. A transfer is money out of its source and money in on its destination on its
date, nothing special. Between accounts that have no earlier payment it nets to zero (the destination's
closing balance carries the credit). It stops netting only when the destination has a payment BEFORE the
credit lands, because that payment sets the destination's low point and the later credit cannot lift
it. That is a doctrine question for Kevin (reported on G479), not something this rule papers over.

`account_ledger` is the ONE per-account computation: the headline (`analytics.compute_safe_to_spend`) and
every per-account figure (`companion.compute_today_items`) read it, so they cannot drift.

G436 (kept for context, the closing-figure wording below is replaced by the low point):

G436: Left to spend and each account's Available, every account in isolation.

Kevin 2026-11-07: "it should be every account in isolation, money in vs money out; the calculation
shouldn't really care that money is moving from one account to another; the categories are just
intention."

  Available (one counted current account)
      = its balance + predicted money in - predicted money out over the pay period, the closing
        figure of its own walk (`available_walk`; predicted means on Upcoming: reliable or
        confirmed income and expected transfers in, every predicted payment out, credits before
        debits on a day, G163)
      - the goals and set-asides paid from it (plans_reserved)
      - any earmarked move out of it (G410)
      + any suggested move into it from another CURRENT account (savings moves are shown, never counted).
  An own-account transfer is money out on its source and money in on its destination on its date,
  with no special handling and no G360 gate on this figure (`money_in_out_window`), so a transfer
  between counted accounts nets to zero. A dip below zero before money arrives is a warning on the
  account (`dip_before_money_in`, plus the cover engine's move) and never changes the figure.

  Left to spend = the sum of those figures over the counted current accounts (negatives included),
  less goals and set-asides paid from no counted current account (`plans_total` less what accounts
  carry), less the user's buffer. Income no counted account is credited with, and payments from a
  savings, manual or revoked account, are not in it. The shown per-account Available
  (`companion.finalise_account_available`) therefore adds up to it by construction.

Pure helpers over the same window inputs `compute_today_items` reads (G364 to G366). Nothing here
queries the database.
"""
from __future__ import annotations

from typing import Any


def counted_current_ids(accounts: list[dict]) -> set[str]:
    """Ids of the accounts the headline counts: the spendable pool, structurally
    (GBP, not a card, a loan or savings, not left out by the user), whatever the
    balance sign. `accounts` are the consent-filtered rows of
    `analytics._safe_to_spend_accounts`."""
    from app.routers.analytics import _account_pool_kind

    return {
        str(a["_id"]) for a in accounts
        if a.get("_id") is not None and _account_pool_kind(a) == "spendable"
    }


def predicted_money_in(item: dict, account_id: str, confirmed_keys: Any = frozenset()) -> bool:
    """Money in that counts in Available (Kevin 2026-11-07): predicted, meaning attributed to the
    account and either a confirmed stream, a pattern the engine already trusts (reliable or steady),
    or simply seen two or more times (G438 rule 1). One sighting is not predicted. This replaces the
    stricter `income_credit_ok` reliability gate for this figure only."""
    from app.routers.analytics import income_credit_basis

    if not account_id or str(item.get("account_id") or "") != str(account_id):
        return False
    if income_credit_basis(item, account_id, confirmed_keys) is not None:
        return True
    try:
        return int(item.get("occurrences") or 0) >= 2
    except (TypeError, ValueError):
        return False


def money_in_out_window(window: Any) -> Any:
    """The window the per-account Available is read from (Kevin 2026-11-07, "every account in
    isolation, money in vs money out"): the same inputs, with two differences from the gated walks.

      1. An own-account transfer's destination leg is credited on its date whether or not its source
         can afford it (no G360 gate). Whether the source can afford it is the source's shortfall,
         flagged and given a move by the cover engine. The transfer's debit leg is a payment out on
         the source that counts, so keeping the credit keeps a transfer between counted accounts at
         zero in the total.
      2. Expected INCOME counts only when its date is after today. An occurrence dated today that has
         not been observed (G362 closes one only once its credit has posted) may already be in the
         balance, so counting it would credit it twice, the dangerous direction; if it has not landed
         yet the figure is briefly lower until it posts. (Occurrences before today are never in the
         window: a lapsed expectation drops out.)

    Only what feeds Available and the headline uses this; the cover engine and every other walk keep
    the gated `funded_window_inflows` and the unfiltered income."""
    import dataclasses

    return dataclasses.replace(
        window,
        funded_window_inflows=list(window.window_inflows),
        window_income=[i for i in window.window_income if int(i.get("days_away", 0)) > 0],
    )


def available_walk(window: Any, sid: str, opening: float):
    """One account's own walk for Available: its balance, plus every predicted credit attributed to
    it (`predicted_money_in`, expected inbound transfers), less every predicted debit on it, credits
    before debits on a shared day (G163). Nothing is dropped for being a transfer, a saving or a
    bill: labels are intention only. `window` comes from `money_in_out_window`."""
    from app.services.account_walk import walk_account

    return walk_account(sid, window, opening=opening, income_admit="any", inflow_admit="any",
                        same_day_key="is_income", income_credit=predicted_money_in)


def lowest_point(walk: Any) -> float:
    """G479: the lowest balance one account's walk leaves it with, which is the figure it contributes.

    That is the lowest running balance after any of its dated PAYMENTS, or its closing balance if that is
    lower (so money in that lands after the last payment still counts, from its date), or, when the
    account is already overdrawn today, the overdraft itself. The starting balance is not a low point
    unless it is below zero: money that lands before a payment covers it (no dip), and an account that
    only receives money is worth its closing balance. A payment that comes BEFORE the money that would
    cover it sets the low point, so that money cannot rescue it."""
    pts = [float(walk.closing)] + [float(r.running) for r in walk.rows if not r.is_income]
    if walk.opening is not None and float(walk.opening) < 0:
        pts.append(float(walk.opening))
    return round(min(pts), 2)


def dip_before_money_in(walk: Any, today: Any) -> dict | None:
    """When the running balance goes below zero before a later credit arrives: {"money_in_date": iso}
    (the first credit after the first dip). Kept for the older field; `dip_detail` is the full reading."""
    from datetime import timedelta

    rows = walk.rows
    for k, row in enumerate(rows):
        if row.running < 0 and not row.is_income:
            for later in rows[k + 1:]:
                if later.is_income:
                    return {"money_in_date": (today + timedelta(days=later.day)).isoformat()}
            return None
    return None


def dip_detail(walk: Any, today: Any) -> dict | None:
    """G479: the dip an account's walk makes, or None when its lowest point is not below zero.

    {"short_by": pounds at the lowest point, "short_on": iso date of that point ("short_today": true when it is
    today), and, when a credit follows
    it, "money_in_date" / "money_in_amount" (the first dated credit after the low point, every credit on
    that day added up)}. `short_by` is the deepest the balance goes, so it is what a move must cover."""
    from datetime import timedelta

    low = lowest_point(walk)
    if low >= 0:
        return None
    low_day = 0
    low_idx = -1
    for k, row in enumerate(walk.rows):
        if not row.is_income and round(row.running, 2) == low:
            low_day, low_idx = int(row.day), k
            break
    out: dict = {"short_by": round(-low, 2), "short_on": (today + timedelta(days=low_day)).isoformat()}
    if low_day == 0:
        out["short_today"] = True  # so a client can say "today" without knowing the date
    later_day = None
    amount = 0.0
    for row in walk.rows[low_idx + 1:]:
        if not row.is_income:
            continue
        if later_day is None:
            later_day = int(row.day)
        if int(row.day) == later_day:
            amount += float(row.delta)
    if later_day is not None:
        out["money_in_date"] = (today + timedelta(days=later_day)).isoformat()
        out["money_in_amount"] = round(amount, 2)
    return out


def _pounds(x: float) -> str:
    return f"£{int(round(abs(float(x)))):,}"


def _day_label(iso: str) -> str:
    from datetime import date

    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def dip_line(dip: dict, today: Any, *, account_name: str | None = None) -> str:
    """The one sentence for a dip, shared by Penny and the API (the web app builds the same words from
    the same fields so a hidden-balances view can mask the amounts): "£43 short on 23 Nov, before
    about £650 is expected on 26 Nov". Predictions are hedged, no em dashes."""
    on = "today" if dip.get("short_today") or dip.get("short_on") == today.isoformat() else f"on {_day_label(dip['short_on'])}"
    line = f"{_pounds(dip['short_by'])} short {on}"
    if dip.get("money_in_date"):
        line += f", before about {_pounds(dip['money_in_amount'])} is expected on {_day_label(dip['money_in_date'])}"
    return f"{account_name}: {line}" if account_name else line


def account_ledger(window: Any, counted_ids: set[str], today: Any) -> dict[str, dict]:
    """G479: the ONE per-account computation behind Left to spend. For each counted current account with
    a balance row: {"low_point": its lowest running balance (the figure it contributes, before goals and
    set-asides), "closing": the end-of-period balance (information only), "dip": `dip_detail` or None}.
    `window` is a `WindowInputs` whose `live_balances` hold every counted account's balance. Both the
    headline and the per-account Available are read from here."""
    wi = money_in_out_window(window)
    out: dict[str, dict] = {}
    for sid in sorted(counted_ids):
        if sid not in wi.live_balances:
            continue  # no balance row to open a walk from: contributes nothing, never a guess
        walk = available_walk(wi, sid, float(wi.live_balances[sid]))
        out[sid] = {
            "low_point": lowest_point(walk),
            "closing": round(float(walk.closing), 2),
            "dip": dip_detail(walk, today),
        }
    return out


def account_bases(window: Any, counted_ids: set[str], today: Any = None) -> dict[str, float]:
    """Per counted current account: its lowest running balance (G479), before its goals and set-asides."""
    from app.core import timeutil

    ledger = account_ledger(window, counted_ids, today or timeutil.user_today())
    return {sid: row["low_point"] for sid, row in ledger.items()}
