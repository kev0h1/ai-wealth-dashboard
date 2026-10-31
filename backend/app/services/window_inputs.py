"""G364 (money engine step 2, docs/engine/MONEY-ENGINE.md section 6): the ONE
window-inputs builder.

Three callers used to hand-copy the same preamble that turns the cashflow
response, preferences and live balances into the lists every per-account walk
reads. They now all call `build_window_inputs`:

  - `routers/analytics.py` `at_risk_count`           (the Upcoming amber dot)
  - `services/companion.py` `compute_today_items`    (cover plan, payday plan)
  - `services/spend_impact.py` `_cashflow_window`    (Spend bills-risk line)

NO behaviour change. Where the three preambles differed, the difference is an
explicit argument below with each caller's old behaviour as the value it
passes. Nothing was unified silently; collapsing a row is a later, separate
decision (G363 step decisions).

What is shared (identical in all three, now written once):

  prefs -> pay config; today (`timeutil.user_today`); next payday
  (`get_confirmed_payday`, else `pay_period._next_payday`); `days_to_pay`;
  `window_bills` / `window_income` / `window_inflows` with
  `pay_period.in_current_window`; the assessable-bill filter
  (`is_assessable_bill`); the starting balance per account, seeded from the
  live balance else the bill's own `account_balance`; the confirmed income
  keys; and the G360 funded-inflow gate (`inflow_credit.funded_inflows`).

Differences (each is an argument; the value shown is what each caller passes,
which is also what its hand-copied preamble did before G364):

| Id | Difference | Argument | at_risk_count | compute_today_items | _cashflow_window |
|----|-----------|----------|---------------|---------------------|------------------|
| W1 | Which accounts supply live balances | `load_balances` | `bill_account_loader`: only the accounts the assessable bills sit on, looked up by id in the accounts and Yapily collections, NOT scoped to the user | `user_accounts_loader`: every account of the user in the accounts and Yapily collections, plus offline (manual) accounts | spend_impact's own `_live_balances_map`: accounts collection only, scoped to the user, no Yapily, no offline |
| W2 | Balance field fallback | inside the loader | `balance`, else `current_balance`, else `available_balance`, else 0 | same as at_risk | `balance` only, else 0 (no fallback chain) |
| W3 | G231 not-counted accounts | inside the loader | not filtered (the response builder already dropped their items when it could verify) | skipped from balances and recorded in `excluded_account_ids` | skipped from balances, not recorded |
| W4 | G231 fail-closed re-drop when the response says `exclusions_unverified` | `reapply_exclusions` | False | True: bills and incomes of excluded accounts are removed again from the window lists, and `assessable_bills` is rebuilt (inflows are NOT re-dropped) | False |
| W5 | `stamp_credit_basis` on the response income | `stamp_credit_basis` | False (the response builder already stamped) | True (idempotent re-stamp, G359) | False |
| W6 | Balance loading when nothing is assessable | `load_when_no_bills` | False (the caller returns first, no read) | True (the account listing feeds the rest of the cover plan) | False (the caller returns None first, no read) |
| W7 | Preferences source | caller | the caller reads preferences itself and passes them | same | same |
| W8 | Payday-day slice (`payday_day_*`) and the account rows | none | slice computed, unused; no rows | slice and rows used (payday_split, class specs) | slice computed, unused; no rows |
| W9 | Income list the payday-plan salary candidate reads | `window_income_before_exclusions` | not read | read: the window income as it stood BEFORE the W4 re-drop, so the candidate pool is unchanged | not read |

Same-day ordering (`companion.walk_sort_key`), the walks themselves, income
credit (`income_credit_ok`) and the credited-income disclosure stay with the
callers: they are step 3, not this step.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Awaitable, Callable

from app.core import timeutil

log = logging.getLogger(__name__)


@dataclass
class LoadedAccounts:
    """What a balance loader returns. Only `live_balances` is required."""

    live_balances: dict[str, float] = field(default_factory=dict)
    excluded_account_ids: set[str] = field(default_factory=set)
    all_uk_accounts: list[dict] = field(default_factory=list)
    offline_accounts: list[dict] = field(default_factory=list)


BalanceLoader = Callable[[list[dict]], Awaitable[LoadedAccounts]]


@dataclass
class WindowInputs:
    uid: str
    prefs: dict
    pay_cfg: dict
    today: date
    next_pay: date
    days_to_pay: int
    payday_source: str  # "confirmed" (get_confirmed_payday) or "period" (pay_period._next_payday)
    confirmed_income_keys: set
    window_bills: list[dict]
    window_income: list[dict]
    window_inflows: list[dict]
    window_income_before_exclusions: list[dict]  # window_income as it stood before the G231 re-drop (same list content when none ran)
    payday_day_bills: list[dict]
    payday_day_income: list[dict]
    payday_day_inflows: list[dict]
    assessable_bills: list[dict]
    live_balances: dict[str, float]
    excluded_account_ids: set[str]
    exclusions_unverified: bool
    all_uk_accounts: list[dict]
    offline_accounts: list[dict]
    running_seed: dict[str, float]  # starting balance per account the walk tracks (a bill sits on it)
    funded_window_inflows: list[dict]  # window_inflows gated by the G360 funded-inflow rule


# ── balance loaders (one per caller; see the differences table) ──────────────

def bill_account_loader(*collections: Any) -> BalanceLoader:
    """at_risk_count: live balance of exactly the accounts the assessable
    bills sit on, looked up by id in each given collection in order (a later
    collection overrides an earlier one), not scoped to the user."""

    async def _load(assessable_bills: list[dict]) -> LoadedAccounts:
        acct_ids = list({b["account_id"] for b in assessable_bills if b.get("account_id")})
        live: dict[str, float] = {}
        if acct_ids:
            from bson import ObjectId

            def _try_oid(v: str):
                try:
                    return ObjectId(v)
                except Exception:
                    return v

            oid_ids = [_try_oid(a) for a in acct_ids]
            for col in collections:
                async for acc in col.find(
                    {"_id": {"$in": oid_ids}},
                    {"balance": 1, "current_balance": 1, "available_balance": 1},
                ):
                    bal = acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0.0
                    live[str(acc["_id"])] = float(bal)
        return LoadedAccounts(live_balances=live)

    return _load


def user_accounts_loader(
    uid: str,
    accounts_col: Any,
    yapily_accounts_col: Any,
    manual_accounts_col: Any,
    projection: dict,
) -> BalanceLoader:
    """compute_today_items: every account of the user (accounts and Yapily
    collections, G231-excluded ones skipped and recorded) plus the offline
    (manual) accounts, which are legitimate cover-plan sources but stay out of
    `all_uk_accounts` on purpose (that list drives the pooled verdict). Manual
    credit cards and excluded manual accounts are never offered."""

    async def _load(_assessable_bills: list[dict]) -> LoadedAccounts:
        from app.services.account_kinds import manual_account_class

        all_uk_accounts: list[dict] = []
        excluded: set[str] = set()
        async for acc in accounts_col.find({"user_id": uid}, projection):
            if acc.get("include_in_safe_to_spend") is False:
                excluded.add(str(acc["_id"]))
                continue
            acc["_str_id"] = str(acc["_id"])
            all_uk_accounts.append(acc)
        async for acc in yapily_accounts_col.find({"user_id": uid}, {**projection, "institution_id": 1}):
            if acc.get("include_in_safe_to_spend") is False:
                excluded.add(str(acc["_id"]))
                continue
            acc["_str_id"] = str(acc["_id"])
            all_uk_accounts.append(acc)

        live: dict[str, float] = {
            acc["_str_id"]: float(
                acc.get("balance") or acc.get("current_balance") or acc.get("available_balance") or 0.0
            )
            for acc in all_uk_accounts
        }

        # G47 / G65: an offline account ranks with its real class (current or
        # savings), stamped via `manual_account_class`, the same function the
        # /accounts API uses, so the two cannot disagree.
        offline: list[dict] = []
        async for macc in manual_accounts_col.find(
            {"user_id": uid}, {"name": 1, "balance": 1, "account_type": 1, "include_in_safe_to_spend": 1}
        ):
            macc_type = macc.get("account_type") or "savings"
            if macc.get("include_in_safe_to_spend") is False:
                excluded.add(str(macc["_id"]))
            if macc_type == "credit_card" or macc.get("include_in_safe_to_spend") is False:
                continue
            offline.append({
                "_id": macc["_id"],
                "_str_id": str(macc["_id"]),
                "_offline": True,
                "name": macc.get("name") or "Offline account",
                "balance": float(macc.get("balance") or 0.0),
                "provider": "Offline",
                "subtype": manual_account_class(macc_type),
            })
        for oacc in offline:
            live[oacc["_str_id"]] = oacc["balance"]
        return LoadedAccounts(
            live_balances=live,
            excluded_account_ids=excluded,
            all_uk_accounts=all_uk_accounts,
            offline_accounts=offline,
        )

    return _load


# ── the builder ──────────────────────────────────────────────────────────────

async def build_window_inputs(
    uid: str,
    resp: dict,
    prefs: dict,
    *,
    load_balances: BalanceLoader,
    stamp_credit_basis: bool = False,
    reapply_exclusions: bool = False,
    load_when_no_bills: bool = False,
) -> WindowInputs:
    """Build the walk inputs from a `_build_cashflow_response` result, the
    user's preferences and (through `load_balances`) live balances. See the
    module docstring for what each argument switches and who passes what."""
    # Lazy imports: analytics and companion import this module's callers, and
    # pay_period / income are patched by attribute in tests.
    from app.routers.analytics import income_credit_ok, is_assessable_bill
    from app.routers.analytics import stamp_credit_basis as _stamp
    from app.services import pay_period as _pp
    from app.services.income import get_confirmed_payday as _get_confirmed_payday
    from app.services.inflow_credit import funded_inflows

    pay_cfg = prefs.get("pay_period_config", {"type": "calendar_month"})
    today_d = timeutil.user_today()
    confirmed_result = _get_confirmed_payday(prefs, today_d)
    if confirmed_result:
        next_pay = confirmed_result[0]
        payday_source = "confirmed"
    else:
        next_pay = _pp._next_payday(today_d, pay_cfg)
        payday_source = "period"
    days_to_pay = (next_pay - today_d).days

    confirmed_income_keys = {
        s.get("key") for s in (prefs.get("income_streams") or [])
        if isinstance(s, dict) and s.get("status") == "confirmed"
    }
    if stamp_credit_basis:
        # G359: idempotent re-stamp, so a response from a patched/older
        # builder still carries `steady_salary` / `credit_basis`.
        _stamp(resp["upcoming_income"], pay_cfg, confirmed_income_keys, today_d)

    # Current-window boundary is EXCLUSIVE of payday day itself (2026-08-28
    # decision, see pay_period.in_current_window): an item ON payday belongs
    # to the NEXT pay period's arithmetic and drops into `payday_day_*`,
    # visible but never counted. No last-day lookahead (G360).
    window_bills = [b for b in resp["upcoming_bills"] if _pp.in_current_window(b["days_away"], days_to_pay)]
    window_income = [i for i in resp["upcoming_income"] if _pp.in_current_window(i["days_away"], days_to_pay)]
    window_inflows = [n for n in resp["internal_inflows"] if _pp.in_current_window(n["days_away"], days_to_pay)]
    payday_day_bills = [b for b in resp["upcoming_bills"] if _pp.is_payday_day(b["days_away"], days_to_pay)]
    payday_day_income = [i for i in resp["upcoming_income"] if _pp.is_payday_day(i["days_away"], days_to_pay)]
    payday_day_inflows = [n for n in resp["internal_inflows"] if _pp.is_payday_day(n["days_away"], days_to_pay)]

    # No balance data, or a credit card, never enters a running-balance walk;
    # an overdrawn current account's own bills stay assessable (2026-09-01).
    assessable_bills = [b for b in window_bills if is_assessable_bill(b)]

    if assessable_bills or load_when_no_bills:
        loaded = await load_balances(assessable_bills)
    else:
        loaded = LoadedAccounts()
    live_balances = loaded.live_balances

    window_income_before_exclusions = list(window_income)
    exclusions_unverified = bool(resp.get("exclusions_unverified"))
    # G231 fail-closed: if the builder could not verify exclusions, re-apply
    # the exclusion from the account rows to the walk's own lists.
    if reapply_exclusions and exclusions_unverified and loaded.excluded_account_ids:
        _w = {"upcoming_bills": window_bills, "upcoming_income": window_income}
        from app.services.counted_accounts import drop_excluded_items as _g231_drop
        _g231_drop(_w, loaded.excluded_account_ids)
        window_bills, window_income = _w["upcoming_bills"], _w["upcoming_income"]
        assessable_bills = [b for b in window_bills if is_assessable_bill(b)]

    running_seed: dict[str, float] = {}
    for b in assessable_bills:
        acct = b["account_id"] or "__unknown__"
        if acct not in running_seed:
            running_seed[acct] = live_balances.get(str(acct), float(b.get("account_balance") or 0))

    # G360: an inflow is credited only when its SOURCE account is itself
    # covered that day (`funded_inflows`, one rule for every walk).
    funded_window_inflows = funded_inflows(
        window_inflows, assessable_bills, window_income, {**live_balances, **running_seed},
        lambda i, a: income_credit_ok(i, a, confirmed_income_keys),
    )

    return WindowInputs(
        uid=uid,
        prefs=prefs,
        pay_cfg=pay_cfg,
        today=today_d,
        next_pay=next_pay,
        days_to_pay=days_to_pay,
        payday_source=payday_source,
        confirmed_income_keys=confirmed_income_keys,
        window_bills=window_bills,
        window_income=window_income,
        window_inflows=window_inflows,
        window_income_before_exclusions=window_income_before_exclusions,
        payday_day_bills=payday_day_bills,
        payday_day_income=payday_day_income,
        payday_day_inflows=payday_day_inflows,
        assessable_bills=assessable_bills,
        live_balances=live_balances,
        excluded_account_ids=loaded.excluded_account_ids,
        exclusions_unverified=exclusions_unverified,
        all_uk_accounts=loaded.all_uk_accounts,
        offline_accounts=loaded.offline_accounts,
        running_seed=running_seed,
        funded_window_inflows=funded_window_inflows,
    )
