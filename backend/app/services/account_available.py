"""G481: Left to spend, one simple rule per account (Kevin 2026-11-20; replaces G479's low point and
G436's closing figure).

  Available (one counted current account)
      = cash now - max(0, bills before payday - money in before payday)

Money in only OFFSETS bills and never adds to the figure. No timing and no day-by-day order is involved,
only the two totals before payday:

  cash 5,   bills 200, money in 300  ->   5
  cash 5,   bills 400, money in 300  -> -95   (Short)
  cash 500, bills 200, money in 0    -> 300
  cash 5.05, bills 77.91, money in 649.59 -> 5.05   (Kevin's real shape, not Short)
  cash 5.05, bills 77.91, no money in     -> -72.86 (Short)

"Bills" are the account's predicted payments before payday, including an own transfer out of it; "money in"
is its predicted money in before payday: income seen twice or more or confirmed (`predicted_money_in`,
income dated today only once it has posted, `money_in_out_window`) and an own transfer into it. A transfer
therefore counts as a bill on its sending account and as money in on its receiving account, both legs, whether
or not its source can fund it. The figure is signed: a shortfall is never floored away, so an account that
cannot cover its bills reduces the total by exactly its shortfall.

Goals and set-asides come off the account they are sourced from AFTER this figure
(`spend_from_headroom` = base - plans_reserved - earmarked moves out + suggested moves in, in
`companion.compute_today_items` and `finalise_account_available`); the headline sums the bases and takes the
plans off once (`analytics.compute_safe_to_spend`: bases - plans_total - buffer). Covered dips (G410): a
suggested move from another current account is earmarked at its source and counted in at its destination, so
the pair nets to zero in the total.

`account_bases` is the ONE per-account computation: the headline and every per-account figure read it, so
they cannot drift. `after_payments_and_money_in` on an account's position is this base.

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
    isolation, money in vs money out"): the same inputs, with one difference from the other walks (G479, Kevin 2026-11-19: an own transfer counts on BOTH legs everywhere, whether or not its source can fund it, so there is no transfer difference).

      Expected INCOME counts only when its date is after today. An occurrence dated today that has
         not been observed (G362 closes one only once its credit has posted) may already be in the
         balance, so counting it would credit it twice, the dangerous direction; if it has not landed
         yet the figure is briefly lower until it posts. (Occurrences before today are never in the
         window: a lapsed expectation drops out.)

    Only what feeds Available and the headline uses this; every other walk keeps the unfiltered income."""
    import dataclasses

    return dataclasses.replace(
        window,
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


def available_base(walk: Any) -> float:
    """G481: cash now less whatever the bills before payday exceed the money in before payday by. Totals
    only; the order of the dated rows is irrelevant. An unseeded walk has no cash now, so 0."""
    opening = 0.0 if walk.opening is None else float(walk.opening)
    bills = sum(-float(r.delta) for r in walk.rows if not r.is_income)
    money_in = sum(float(r.delta) for r in walk.rows if r.is_income)
    return round(opening - max(0.0, bills - money_in), 2)


def account_bases(window: Any, counted_ids: set[str]) -> dict[str, float]:
    """Per counted current account: its Available base (`available_base`), before its goals and
    set-asides. `window` is a `WindowInputs` whose `live_balances` hold every counted account's balance."""
    wi = money_in_out_window(window)
    bases: dict[str, float] = {}
    for sid in sorted(counted_ids):
        if sid not in wi.live_balances:
            continue  # no balance row to open a walk from: contributes nothing, never a guess
        bases[sid] = available_base(available_walk(wi, sid, float(wi.live_balances[sid])))
    return bases
