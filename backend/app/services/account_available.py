"""G436: Left to spend and each account's Available, account by account.

Kevin 2026-11-07: Left to spend is the balance left after payments, goals and
set-asides, account by account. It is not a total shared out across preferred
accounts (G414's allocation, replaced here).

  Available (one current account)
      = the account's own lowest point before payday, from its own walk
        (min of After payments and Lowest after payments, the figures the
        account page already shows, G366)
      - the goals and set-asides paid from it (plans_reserved)
      - any earmarked move out of it (G410)
      + any suggested move into it from another CURRENT account.
      A suggested move from savings (G428) is shown on the destination but
      never added here: it counts once the move is made.

  Left to spend = the sum of those figures over the counted current accounts,
      negatives included, plus the explicit lines for what cannot sit on one
      counted account:
        uncredited_income      income no counted account's walk credits (not
                               attributed to a counted account, or not
                               reliable enough): the pooled walk counted it,
                               so it stays in, on its own line,
        unattributed_bills     payments the pooled walk deducted that no counted
                               account's walk carries (no paying account, or
                               one that is not a counted current account),
        plans_not_on_account   goals and set-asides whose paying account is
                               not a counted current account (Not set, a
                               savings or manual source, no resolvable source),
        buffer                 the user's own safety buffer.
      A move between two current accounts nets to zero, so the headline never
      depends on the cover plan: it is computed from the per-account bases
      below plus the plan totals, and the per-account Available shown on
      Home / Accounts / Upcoming (`companion.finalise_account_available`) adds
      up to it by construction.

Pure helpers over the SAME window inputs, closing walk and source low-point
walk that `companion.compute_today_items` reads (G364 to G366), never a second
kernel. Nothing here queries the database: it runs on the walk
`compute_safe_to_spend` has already built.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any


def own_basis(after_payments: float | None, low_point: float | None) -> float | None:
    """The account's own lowest point before payday, before its plans:
    min(After payments, Lowest after payments). None when it has no walk figure."""
    values = [float(v) for v in (after_payments, low_point) if v is not None]
    return round(min(values), 2) if values else None


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


def account_bases(window: Any, counted_ids: set[str]) -> dict[str, float]:
    """Per counted current account: its own lowest point before payday (the
    basis above, before plans), from its own walks over `window` (a
    `WindowInputs` whose `live_balances` hold every counted account's balance).
    The same two walks `compute_today_items` runs: the closing walk
    (`window_events`, `inflow_admit="seed_live"`) and the source low-point walk."""
    from app.services.account_position import source_low_walk
    from app.services.account_walk import account_walks, window_events

    events, running, _credited = window_events(window, inflow_admit="seed_live")
    closing = account_walks(events, running)
    bases: dict[str, float] = {}
    for sid in sorted(counted_ids):
        if sid not in window.live_balances:
            continue  # no balance row to open a walk from: contributes nothing, never a guess
        bal = float(window.live_balances[sid])
        walk = closing.get(sid)
        after = float(walk.closing) if walk is not None else bal
        basis = own_basis(after, source_low_walk(sid, window, bal).low_point)
        bases[sid] = basis if basis is not None else round(after, 2)
    return bases


def pooled_only_effects(window: Any, counted_ids: set[str], seed: float) -> tuple[float, float]:
    """What the pooled walk gave Left to spend for items no counted current
    account's walk can carry, as two explicit lines (never silently dropped when
    the headline moves to the per-account basis):

      uncredited_income   (>= 0)  income not credited to a counted account by
                                  `income_credit_ok` (unattributed, unreliable,
                                  or landing in a non-counted account);
      unattributed_bills  (<= 0)  payments with no counted paying account
                                  (no account, or a savings, manual or revoked one).

    Both are differences of the pooled low point, so they add exactly:
    pooled(all) - pooled(only what counted accounts carry)."""
    from app.routers.analytics import income_credit_ok
    from app.services.account_walk import POOLED_POLICY, pooled_walk

    keys = getattr(window, "confirmed_income_keys", frozenset())
    credited = [
        i for i in window.window_income
        if str(i.get("account_id") or "") in counted_ids
        and income_credit_ok(i, str(i.get("account_id") or ""), keys)
    ]
    carried_ids = {id(b) for b in window.assessable_bills if str(b.get("account_id") or "") in counted_ids}
    carried = [b for b in window.window_bills if id(b) in carried_ids]
    if len(credited) == len(window.window_income) and len(carried) == len(window.window_bills):
        return 0.0, 0.0

    def low(bills: list[dict], income: list[dict]) -> float:
        stand_in = SimpleNamespace(
            window_bills=bills, window_income=income,
            payday_day_bills=window.payday_day_bills, payday_day_income=window.payday_day_income,
            confirmed_income_keys=keys,
        )
        return pooled_walk(stand_in, seed, POOLED_POLICY).min_running

    full = low(list(window.window_bills), list(window.window_income))
    bills_only_counted = low(carried, credited)
    income_all_bills_counted = low(carried, list(window.window_income))
    # full - income_all_bills_counted: what the bills no counted account pays cost;
    # income_all_bills_counted - bills_only_counted: what the uncredited income added.
    uncredited_income = round(max(0.0, income_all_bills_counted - bills_only_counted), 2)
    unattributed_bills = round(min(0.0, full - income_all_bills_counted), 2)
    return uncredited_income, unattributed_bills
