"""G365 (money engine step 3, docs/engine/MONEY-ENGINE.md section 6): the ONE
per-account walk.

Four places used to compute a per-account running balance over the same
`WindowInputs` (G364), each with its own copy of the event rules:

  W2  `companion.compute_today_items` closing walk (After payments, shortfalls,
      move cards), its events fed to `companion._walk_events`;
  W3  `companion._source_min_running` (the per-source low point, closure);
  W4  `companion._walk_min` (does an excluded income help this destination?
      closure);
  W5  the inline loop in `analytics.at_risk_count` (the Upcoming amber dot).

They now all read this module:

  `account_events(sid, inputs, ...)`  the events one account's walk consumes,
      with the G360 funded-inflow rule, G163 same-day order (credits before
      debits) and the G359/C1 income-credit rule applied once;
  `walk_account(sid, inputs, *, opening, ...)`  that account's `AccountWalk`:
      closing, low point, first short bill, every bounced bill, the dated rows
      with the running balance, and the events it consumed;
  `window_events(inputs, ...)`  the cover plan's and the at-risk badge's
      all-accounts event list, assembled from `account_events` per tracked
      account in the old global order;
  `walk_events(events, balances)`  the same single-account loop over a ready
      event list (companion's `_walk_events` is this function; spend impact
      layers synthetic pace events on top of it).

NO behaviour change. Where the four walks differed, the difference is an
explicit keyword whose default is the OLD behaviour of the caller named. Nothing
was unified silently; collapsing a row is a later decision.

Differences (W1 to W11 are the inventory numbers in MONEY-ENGINE.md 1.4; the
numbers below are the differences between the four walks of this step):

| Id  | Difference | Keyword | closing (W2) | at-risk (W5) | low point (W3) | with-extra-income (W4) |
|-----|------------|---------|--------------|--------------|----------------|------------------------|
| WD1 | Which accounts are walked | tracked set (`window_events`) / caller | accounts with an assessable bill, plus an account a funded inflow lands in when it has a live balance, plus the preview salary account | accounts with an assessable bill only | every source-eligible account, caller loops | any destination, caller loops |
| WD2 | Opening balance | `opening` | `inputs.running_seed` (live balance, else the bill's own `account_balance`); an inflow-only account opens at its live balance; the preview salary account at `live_balances.get(acct, 0.0)` | `inputs.running_seed` | `live_balances.get(sid, account.balance or 0)` | `live_balances.get(dest, 0.0)` |
| WD3 | Income needs an account seeded by a bill of its own | `income_admit` | `"seeded"` | `"seeded"` | `"any"`: an attributed, credit-ok income counts even with no bill on the account | `"seeded"` (it reads the closing walk's credited incomes) |
| WD4 | Funded inflows | `inflow_admit` | `"seed_live"`: counted for a bill-seeded account, or an account with a live balance (which then opens at that balance) | `"seeded"`: counted only for a bill-seeded account, never seeds a new one | `"any"` | `"any"` |
| WD5 | Preview salary at `days_to_pay` | `preview_salary` | the payday-plan salary candidate, only when `payday_preview` | none | none | none (the excluded income is added instead, WD6) |
| WD6 | One extra income event at its own day | `extra_income` | none | none | none | one candidate excluded income per call |
| WD7 | Credited-incomes disclosure | `AccountWalk.credited_incomes` / `window_events` third result | read (the payday plan's `assumed_incomes`, the excluded-income notes) | not read | not read | reads the closing walk's list |
| WD8 | Same-day ordering shape | `same_day_key` | `"is_income"` (`walk_sort_key`) | `"is_income"` | `"positive_delta"`: an inline `(day, delta)` sort, equivalent except for a non-positive-amount income | `"positive_delta"` |
| WD9 | What the walk is asked for | result field | `closing`, `low_point`, `first_short`, `bounced` | `bounced` filtered by kind: a bounced `movement` bill is not counted unless it is a card repayment (`count_at_risk`); every later bill on a short account still counts (a deficit cascades) | `low_point` | `low_point` |

`first_short` (bill, day, shortfall) is the head of `bounced`; the at-risk
count is over every bounced non-movement bill (its old rule), not only the
first.

The low point is a running minimum from the opening balance over the debits
only. A credit can never lower it, so the old low-point loops, which also took
`min(...)` after a credit, give the same figure for non-negative amounts.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Literal

Event = tuple  # (days_away, account_id, amount, is_income, item)

INCOME_ADMIT = ("seeded", "any")
INFLOW_ADMIT = ("seeded", "seed_live", "any")
SAME_DAY_KEY = ("is_income", "positive_delta")

# Insertion phases, so an account's events keep the order the old global event
# list gave them (all bills, then incomes, then inflows, then the preview
# salary, then an extra income) after a stable same-day sort.
_P_BILL, _P_INCOME, _P_INFLOW, _P_PREVIEW, _P_EXTRA = range(5)


def walk_sort_key(event):
    """(days_away, credits before debits on a shared day). G163: money a
    confirmed stream is expected to land in this account on day D covers
    what leaves it on day D; the day after, if it has not landed, the
    stream is lapsed and drops out of the window on its own."""
    return (event[0], 0 if event[3] else 1)


def _same_day_sort(key: str) -> Callable[[tuple], tuple]:
    if key == "is_income":
        return lambda entry: (entry[0][0], 0 if entry[0][3] else 1, entry[1])
    if key == "positive_delta":
        # the old inline `(days_away, delta)` shape of `_source_min_running`
        # and `_walk_min`: delta > 0 (income) sorts first on a tie.
        def _k(entry):
            ev = entry[0]
            delta = ev[2] if ev[3] else -ev[2]
            return (ev[0], 0 if delta > 0 else 1, entry[1])
        return _k
    raise ValueError(f"same_day_key must be one of {SAME_DAY_KEY}, got {key!r}")


@dataclass
class WalkRow:
    """One dated line of an account's walk."""

    day: int
    delta: float  # signed: credits positive, debits negative
    is_income: bool
    running: float  # balance after this event
    item: dict | None
    short: bool  # a debit that left the balance below zero


@dataclass
class FirstShort:
    bill: dict
    day: int
    shortfall: float  # how far below zero the balance went at this bill


@dataclass
class AccountWalk:
    account_id: str
    opening: float | None  # None: the account was not seeded (starts at 0, no opening in the low point)
    closing: float
    low_point: float | None
    first_short: FirstShort | None
    bounced: list[dict]
    rows: list[WalkRow]
    events: list[Event]
    credited_incomes: list[dict] = field(default_factory=list)


def _run_account(sid: str, opening: float | None, entries: list[tuple[Event, Any]]) -> AccountWalk:
    """The single-account running-balance loop. `entries` are (event, tag)
    pairs already in walk order; the tag is carried through for callers that
    need a global order back."""
    running = 0.0 if opening is None else float(opening)
    low: float | None = None if opening is None else float(opening)
    rows: list[WalkRow] = []
    bounced: list[dict] = []
    first: FirstShort | None = None
    events: list[Event] = []
    for ev, _tag in entries:
        day, _acct, amount, is_income, item = ev
        events.append(ev)
        if is_income:
            running = running + amount
            rows.append(WalkRow(day, amount, True, running, item, False))
        else:
            running = running - amount
            low = running if low is None else min(low, running)
            short = running < 0
            rows.append(WalkRow(day, -amount, False, running, item, short))
            if short:
                if first is None:
                    first = FirstShort(item, day, -running)
                bounced.append(item)
    return AccountWalk(sid, opening, running, low, first, bounced, rows, events)


def account_events(
    sid: str,
    inputs: Any,
    *,
    income_admit: str = "seeded",
    inflow_admit: str = "seeded",
    preview_salary: dict | None = None,
    extra_income: dict | None = None,
    same_day_key: str = "is_income",
) -> tuple[list[tuple[Event, tuple]], list[dict]]:
    """Events one account's walk consumes, sorted, as (event, order) pairs,
    plus the incomes credited (WD7). `inputs` is a `WindowInputs`. See the
    module docstring for what each keyword switches."""
    if income_admit not in INCOME_ADMIT:
        raise ValueError(f"income_admit must be one of {INCOME_ADMIT}, got {income_admit!r}")
    if inflow_admit not in INFLOW_ADMIT:
        raise ValueError(f"inflow_admit must be one of {INFLOW_ADMIT}, got {inflow_admit!r}")
    from app.routers.analytics import income_credit_ok  # lazy: analytics imports the callers

    seeded = sid in inputs.running_seed
    entries: list[tuple[Event, tuple]] = []
    credited: list[dict] = []
    for pos, b in enumerate(inputs.assessable_bills):
        if (b["account_id"] or "__unknown__") == sid:
            entries.append(((b["days_away"], sid, float(b["amount"]), False, b), (_P_BILL, pos)))
    if seeded or income_admit == "any":
        for pos, i in enumerate(inputs.window_income):
            if income_credit_ok(i, sid, inputs.confirmed_income_keys):
                entries.append(((i["days_away"], sid, float(i["amount"]), True, i), (_P_INCOME, pos)))
                credited.append(i)
    if inflow_admit == "any":
        inflow_ok = True
    elif inflow_admit == "seed_live":
        inflow_ok = seeded or sid in inputs.live_balances
    else:
        inflow_ok = seeded
    if inflow_ok:
        for pos, n in enumerate(inputs.funded_window_inflows):
            if str(n.get("account_id") or "") == sid:
                entries.append(((n["days_away"], sid, float(n["amount"]), True, n), (_P_INFLOW, pos)))
    if preview_salary is not None and str(preview_salary.get("account_id") or "") == sid:
        entries.append(
            ((inputs.days_to_pay, sid, float(preview_salary["amount"]), True, preview_salary), (_P_PREVIEW, 0))
        )
    if extra_income is not None:
        entries.append(
            ((extra_income["days_away"], sid, float(extra_income["amount"]), True, extra_income), (_P_EXTRA, 0))
        )
    entries.sort(key=_same_day_sort(same_day_key))
    return entries, credited


def walk_account(
    sid: str,
    inputs: Any,
    *,
    opening: float,
    income_admit: str = "seeded",
    inflow_admit: str = "seeded",
    preview_salary: dict | None = None,
    extra_income: dict | None = None,
    same_day_key: str = "is_income",
) -> AccountWalk:
    """Walk one account from `opening` over its events. Defaults are the
    at-risk badge's rules; the other callers pass their own (module docstring)."""
    entries, credited = account_events(
        sid, inputs, income_admit=income_admit, inflow_admit=inflow_admit,
        preview_salary=preview_salary, extra_income=extra_income, same_day_key=same_day_key,
    )
    walk = _run_account(sid, opening, entries)
    walk.credited_incomes = credited
    return walk


def tracked_openings(
    inputs: Any,
    *,
    inflow_admit: str = "seeded",
    preview_salary: dict | None = None,
) -> dict[str, float]:
    """The accounts a window walk tracks, in the old `running` key order, with
    their opening balances (WD1, WD2). Bill-seeded accounts first; then, for
    `inflow_admit="seed_live"`, an account a funded inflow lands in that has a
    live balance; then the preview salary's account at `live_balances.get`."""
    opening: dict[str, float] = dict(inputs.running_seed)
    if inflow_admit == "seed_live":
        for n in inputs.funded_window_inflows:
            acct = str(n.get("account_id") or "")
            if acct and acct not in opening and acct in inputs.live_balances:
                opening[acct] = inputs.live_balances[acct]
    if preview_salary is not None:
        acct = str(preview_salary.get("account_id") or "")
        if acct and acct not in opening:
            opening[acct] = inputs.live_balances.get(acct, 0.0)
    return opening


def window_events(
    inputs: Any,
    *,
    inflow_admit: str = "seeded",
    preview_salary: dict | None = None,
) -> tuple[list[Event], dict[str, float], dict[str, list[dict]]]:
    """All-accounts event list for the closing walk and the at-risk badge.

    Returns (events sorted in the old global order, opening balance per tracked
    account, credited incomes per account). The closing walk passes
    `inflow_admit="seed_live"` and the preview salary; the at-risk badge and
    spend impact use the defaults."""
    if inflow_admit == "any":
        raise ValueError("a window walk tracks accounts by seeding; use 'seeded' or 'seed_live'")
    opening = tracked_openings(inputs, inflow_admit=inflow_admit, preview_salary=preview_salary)
    allentries: list[tuple[Event, tuple]] = []
    credited: dict[str, list[dict]] = {}
    for sid in opening:
        entries, cr = account_events(
            sid, inputs, income_admit="seeded", inflow_admit=inflow_admit, preview_salary=preview_salary,
        )
        allentries.extend(entries)
        if cr:
            credited[sid] = cr
    # one stable global order: day, credits first, then insertion order
    # (all bills, incomes, inflows, preview), exactly the old list + sort.
    allentries.sort(key=_same_day_sort("is_income"))
    return [e for e, _o in allentries], opening, credited


def walk_events(
    events: list[Event],
    balances: dict[str, float],
) -> tuple[dict[str, float], dict[str, float], dict[str, dict], dict[str, list[dict]]]:
    """The per-account walk over a ready, sorted event list (the old
    `companion._walk_events`, byte-identical results, key orders included).

    `events` are (days_away, acct, amount, is_income, item) tuples already
    sorted with `walk_sort_key`. `balances` is the starting balance per
    account; an account absent from it starts at 0 and its first debit sets
    its low point.

    Returns (running, min_running, shortfall_bill, bounced_bills):
      running        final balance per account after every event.
      min_running    the lowest point each account's balance touched.
      shortfall_bill first bill (by walk order) that drove each account
                     negative.
      bounced_bills  EVERY bill that left an account negative (a deficit
                     cascades), by walk order.
    """
    by_acct: dict[str, list[tuple[Event, int]]] = {}
    for idx, ev in enumerate(events):
        by_acct.setdefault(ev[1], []).append((ev, idx))
    walks: dict[str, AccountWalk] = {}
    first_debit: dict[str, int] = {}
    bounce_idx: list[tuple[int, str, dict]] = []
    for acct, entries in by_acct.items():
        w = _run_account(acct, balances.get(acct), entries)
        walks[acct] = w
        short_rows = [(idx, ev) for (ev, idx), r in zip(entries, w.rows) if r.short]
        for idx, ev in short_rows:
            bounce_idx.append((idx, acct, ev[4]))
        for ev, idx in entries:
            if not ev[3]:
                first_debit[acct] = idx
                break
    running: dict[str, float] = dict(balances)
    for acct, w in walks.items():
        running[acct] = w.closing
    min_running: dict[str, float] = dict(balances)
    for acct in sorted(first_debit, key=first_debit.get):
        min_running[acct] = walks[acct].low_point  # type: ignore[assignment]
    shortfall_bill: dict[str, dict] = {}
    bounced_bills: dict[str, list[dict]] = {}
    for _idx, acct, item in sorted(bounce_idx, key=lambda t: t[0]):
        shortfall_bill.setdefault(acct, item)
        bounced_bills.setdefault(acct, []).append(item)
    return running, min_running, shortfall_bill, bounced_bills


def count_at_risk(bounced_bills: dict[str, list[dict]]) -> int:
    """The at-risk badge count (WD9): every bounced bill except a `movement`
    one (the user's own plan for their own money) unless it is a card
    repayment (G266). A deficit cascades, so every later bill on a short
    account counts until income recovers it."""
    from app.services.categories import MOVEMENT

    return sum(
        1
        for bills in bounced_bills.values()
        for b in bills
        if b.get("kind") != MOVEMENT or bool(b.get("is_card_repayment"))
    )
