"""G360: the ONE funded-inflow rule shared by every per-account walk.

An `internal_inflows` entry is the mirrored DESTINATION leg of the user's own
movement bill (a standing order from account A into account B). The outgoing
leg already sits in `upcoming_bills` on A. Crediting B for money A cannot
actually send made B read covered while A's own walk read short, and the walks
that did not credit inflows at all read B short. The rule, applied identically
by companion's closing walk, `_source_min_running`, `_walk_min`,
`analytics.at_risk_count` and `spend_impact._cashflow_window`:

    an expected inbound own-account transfer counts only when its SOURCE
    account is itself covered on that day.

"Covered" means the source is a tracked account with a known balance and its
running balance, after every one of its own bills and credited incomes up to
and including the transfer's day (credits before debits on a shared day, the
G163 order), is >= 0.

One level only: the source's OWN inbound inflows are deliberately not counted
when judging it. That keeps the rule non-recursive and conservative (a chain
A to B to C is judged on A's cash alone for the B leg, and on B's own cash
alone for the C leg). Inflows whose source is unknown or untracked are never
credited.
"""
from __future__ import annotations

from typing import Callable


def funded_inflows(
    inflows: list[dict],
    bills: list[dict],
    incomes: list[dict],
    balances: dict[str, float],
    credit_ok: Callable[[dict, str], bool],
) -> list[dict]:
    """Return the subset of `inflows` (order preserved) whose source account
    is covered on the inflow's day. `bills` are the assessable window bills,
    `incomes` the window incomes, `balances` the starting balance per account
    id, `credit_ok(income, account_id)` the shared `income_credit_ok` rule."""
    cache: dict[str, list[tuple[int, float]]] = {}

    def _source_events(sid: str) -> list[tuple[int, float]]:
        if sid not in cache:
            ev: list[tuple[int, float]] = [
                (b["days_away"], -float(b["amount"]))
                for b in bills
                if str(b.get("account_id") or "") == sid
            ]
            ev += [
                (i["days_away"], float(i["amount"]))
                for i in incomes
                if credit_ok(i, sid)
            ]
            ev.sort(key=lambda e: (e[0], 0 if e[1] > 0 else 1))
            cache[sid] = ev
        return cache[sid]

    funded: list[dict] = []
    for n in inflows:
        sid = str(n.get("source_account_id") or "")
        if not sid or sid not in balances:
            continue
        try:
            run = float(balances[sid])
        except (TypeError, ValueError):
            continue
        day = n["days_away"]
        for d, delta in _source_events(sid):
            if d > day:
                break
            run += delta
        if run >= 0:
            funded.append(n)
    return funded
