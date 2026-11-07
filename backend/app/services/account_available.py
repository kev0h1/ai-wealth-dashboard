"""G436: Left to spend and each account's Available, every account in isolation.

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


def dip_before_money_in(walk: Any, today: Any) -> dict | None:
    """When the running balance goes below zero before a later credit arrives: {"money_in_date": iso}
    (the first credit after the first dip). A warning only, it never changes the figure."""
    from datetime import timedelta

    rows = walk.rows
    for k, row in enumerate(rows):
        if row.running < 0 and not row.is_income:
            for later in rows[k + 1:]:
                if later.is_income:
                    return {"money_in_date": (today + timedelta(days=later.day)).isoformat()}
            return None
    return None


def account_bases(window: Any, counted_ids: set[str]) -> dict[str, float]:
    """Per counted current account: the closing figure of its own walk (`available_walk`), before its
    goals and set-asides. `window` is a `WindowInputs` whose `live_balances` hold every counted
    account's balance."""
    wi = money_in_out_window(window)
    bases: dict[str, float] = {}
    for sid in sorted(counted_ids):
        if sid not in wi.live_balances:
            continue  # no balance row to open a walk from: contributes nothing, never a guess
        bases[sid] = round(float(available_walk(wi, sid, float(wi.live_balances[sid])).closing), 2)
    return bases
