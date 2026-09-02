"""BNPL (buy-now-pay-later) detection and plan reconstruction.

## The bug this fixes

`_detect_recurring` (analytics.py) buckets debits by `series_key`, which
strips date fragments (see `categorisation.series_key`) so a date-stamped
statement line collapses to one series across billing cycles — the right
call for an ordinary bill. A BNPL instalment descriptor defeats that: PayPal
Pay-in-3 embeds the ORIGINAL PURCHASE DATE in every instalment's descriptor
("9896 31MAY26 PAYPAL *PYPL PAYIN3 8003587911 GB"), which is itself a date
fragment, so `series_key` strips it and collapses EVERY PayPal plan (any
purchase, any month) into one bucket. `_amount_clusters`'s 30% tolerance then
braids instalments from *different* purchases into fake "series" whenever
their amounts happen to be close, and if one of those fake series clears the
recurring gates, a phantom charge projects at an amount no real plan ever
collects.

## The fix

Two parts, independent of each other:

1. `is_bnpl_txn` / `bnpl_provider` — a merchant matcher. `_detect_recurring`
   excludes every BNPL-matched debit from its generic bucket-build
   unconditionally (see analytics.py), so the braiding bug above cannot fire
   regardless of what Part 2 does. This is the guard; it stands on its own.

2. `group_bnpl_plans` / `project_bnpl_instalments` — reconstruct real plan
   instances from the excluded debits and project only the instalments a
   pay-in-3 plan would still owe, so Sorted can show "Klarna instalment 2 of
   3" instead of either silence or a braided phantom.

## Why exact-anchor grouping, not amount tolerance

The braiding bug happened because amount-tolerance clustering has no idea
which purchase an instalment belongs to. Grouping by the embedded purchase
date (an exact token match, e.g. "31MAY26") is precise where that signal
exists: two concurrent Pay-in-3 plans from different purchases get different
anchors and are never merged, no matter how close their amounts are. Where no
purchase-date signal exists (Klarna/Clearpay: retailer and purchase date are
both usually absent from the descriptor, see the provider research this
module encodes), plans are reconstructed by chaining same-amount debits
whose spacing fits the 30-day instalment model — still never by amount
tolerance ACROSS anchors, only within one open chain.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta

# ── Provider matching ───────────────────────────────────────────────────────
# Case-insensitive; checked against description + merchant_name together so a
# provider recognisable in either field is caught. PayPal's Pay-in-3 shape is
# the odd one out: the literal word "PAYPAL" plus a PAY-IN-3 marker somewhere
# nearby, rather than a single fixed brand token, because the descriptor also
# carries a reference number and the embedded purchase date between them
# ("PAYPAL *PYPL PAYIN3 8003587911 GB", "PAYPAL PAY IN 3 ...").
_KLARNA_RE       = re.compile(r"\bKLARNA\b", re.I)
_CLEARPAY_RE     = re.compile(r"\bCLEARPAY\b", re.I)
_ZILCH_RE        = re.compile(r"\bZILCH\b", re.I)
_AFTERPAY_RE     = re.compile(r"\bAFTERPAY\b", re.I)
_LAYBUY_RE       = re.compile(r"\bLAYBUY\b", re.I)
_MONZO_FLEX_RE   = re.compile(r"\bMONZO\s+FLEX\b", re.I)
_PAYPAL_PAYIN3_RE = re.compile(r"PAYPAL.{0,30}?PAY\s*IN\s*3\b", re.I)

# Order matters only in that PayPal's pattern is broad enough it should never
# accidentally shadow the single-brand ones — none of those tokens ("KLARNA"
# etc.) can appear inside a PayPal Pay-in-3 descriptor, so order is otherwise
# inert. Display names here are what `analytics.py` uses verbatim in bill
# names ("<provider> instalment 2 of 3") — never a raw descriptor.
_PROVIDER_MATCHERS: list[tuple[str, re.Pattern]] = [
    ("Klarna",     _KLARNA_RE),
    ("Clearpay",   _CLEARPAY_RE),
    ("Zilch",      _ZILCH_RE),
    ("PayPal",     _PAYPAL_PAYIN3_RE),
    ("Afterpay",   _AFTERPAY_RE),
    ("Laybuy",     _LAYBUY_RE),
    ("Monzo Flex", _MONZO_FLEX_RE),
]


def _txn_text(txn: dict) -> str:
    return f"{txn.get('description') or ''} {txn.get('merchant_name') or ''}"


def bnpl_provider(txn: dict) -> str | None:
    """The display provider name if `txn` looks like a BNPL instalment debit,
    else None. Checked over description + merchant_name, case-insensitive."""
    text = _txn_text(txn)
    for provider, pattern in _PROVIDER_MATCHERS:
        if pattern.search(text):
            return provider
    return None


def is_bnpl_txn(txn: dict) -> bool:
    """True when `txn` matches a known BNPL merchant shape. Used as the
    unconditional exclusion in `_detect_recurring`'s bucket-build — see
    module docstring, Part 1."""
    return bnpl_provider(txn) is not None


# ── Purchase-date anchor extraction (PayPal Pay-in-3) ───────────────────────
# Same ddMONyy shape as `categorisation.DATE_FRAGMENT_RE` — deliberately not
# reusing that regex, because here the match IS the useful signal (the
# purchase-date anchor), not noise to strip.
_MONTHS_UPPER = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                 "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
_MONTH_NUM = {m: i + 1 for i, m in enumerate(_MONTHS_UPPER)}
_PURCHASE_TOKEN_RE = re.compile(
    r"\b(\d{1,2})(" + "|".join(_MONTHS_UPPER) + r")(\d{2})\b", re.I
)


def _extract_purchase_token(text: str) -> str | None:
    """The raw ddMONyy substring (e.g. "31MAY26"), used as an EXACT-MATCH
    grouping key — never parsed-then-compared with tolerance, that
    tolerance is exactly what let the original bug braid different
    purchases together."""
    m = _PURCHASE_TOKEN_RE.search(text or "")
    return m.group(0).upper() if m else None


def _parse_purchase_token(token: str) -> date | None:
    m = _PURCHASE_TOKEN_RE.fullmatch(token)
    if not m:
        return None
    day = int(m.group(1))
    month = _MONTH_NUM[m.group(2).upper()]
    year = 2000 + int(m.group(3))
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _txn_date(t: dict) -> date:
    d = t.get("date")
    return d.date() if hasattr(d, "date") else d


def _txn_amount(t: dict) -> float:
    return round(abs(float(t.get("amount", 0))), 2)


# ── Plan reconstruction ──────────────────────────────────────────────────────
PLAN_SIZE = 3                  # pay-in-3 default model (see module docstring)
INSTALMENT_INTERVAL_DAYS = 30  # +30d / +60d from instalment 1
MIN_SPACING_DAYS = 20          # observed spacing outside [20, 45] -> unknown
MAX_SPACING_DAYS = 45          # shape, fail quiet rather than guess


def _dedupe_instalments(insts: list[dict]) -> list[dict]:
    """Drop exact (date, amount) duplicates — a provider/sync duplicate row,
    not a second real instalment."""
    seen: set[tuple] = set()
    out = []
    for i in insts:
        key = (i["date"], i["amount"])
        if key in seen:
            continue
        seen.add(key)
        out.append(i)
    return out


def _chain_unanchored(provider: str, account_id: str, txns: list[dict]) -> list[dict]:
    """Reconstruct plan instances for a provider with no purchase-date
    signal in its descriptor (Klarna, Clearpay, ...): same amount (to the
    penny) + same provider/account is the only grouping signal available,
    so debits are bucketed by exact amount, then chunked into consecutive
    runs of up to PLAN_SIZE in time order — a 4th same-amount debit starts a
    NEW plan rather than extending a completed one, since pay-in-3 never
    collects a 4th instalment.

    Spacing is deliberately NOT a grouping condition here (unlike an
    earlier version of this function): gating group MEMBERSHIP on spacing
    conflated "which plan does this debit belong to" with "does this plan's
    spacing look like the 30-day model", and a plan whose real spacing is
    off-model would silently fracture into several bogus 1-instalment
    plans instead of being recognised as one plan with two, whose
    off-model spacing should suppress projection (see
    `project_bnpl_instalments`). Spacing is checked once, at projection
    time, against the group `project_bnpl_instalments` actually receives.

    This is still never amount-tolerance-ACROSS-anchors matching (the
    original bug): every txn in one chunk shares its exact amount, and
    amount is compared to the penny, not a percentage tolerance."""
    by_amount: dict[float, list[dict]] = defaultdict(list)
    for t in txns:
        by_amount[_txn_amount(t)].append(t)

    plans: list[dict] = []
    for amt, group in by_amount.items():
        ordered = sorted(group, key=_txn_date)
        chunk: list[dict] = []
        for t in ordered:
            chunk.append({"date": _txn_date(t), "amount": amt})
            if len(chunk) == PLAN_SIZE:
                plans.append({
                    "provider": provider, "account_id": account_id, "amount": amt,
                    "anchor": chunk[0]["date"], "instalments": chunk,
                })
                chunk = []
        if chunk:
            plans.append({
                "provider": provider, "account_id": account_id, "amount": amt,
                "anchor": chunk[0]["date"], "instalments": chunk,
            })
    return plans


def group_bnpl_plans(bnpl_debits: list[dict]) -> list[dict]:
    """Group BNPL-matched debits into PLAN INSTANCES.

    Same provider + same account, then:
      - purchase-date anchor present (PayPal): EXACT token match, AND same
        amount to the penny — this is the specific fix for the braiding bug
        (real case: 16 PayPal Pay-in-3 rows across concurrent plans that
        today's date-stripping + 30%-tolerance clustering braids together).
        Anchor alone is not enough: real observed data on the very account
        that motivated this fix shows the SAME user making several
        DIFFERENT Pay-in-3 purchases on the same calendar day (three
        separate orders, three different amounts, one shared purchase-date
        token) — grouping by anchor alone would merge those three distinct
        1-instalment plans into one fake "3-observed, complete" plan and
        silently swallow four still-owed instalments. A pay-in-3 plan's own
        instalments are equal amounts by construction, so requiring an
        exact amount match alongside the anchor separates same-day
        different purchases while still recognising a single plan's own
        repeat instalments.
      - no anchor (Klarna/Clearpay/...): amounts equal to the penny + up to
        PLAN_SIZE per chronological run, chained (see `_chain_unanchored`).

    Returns one dict per plan instance:
        {"provider", "account_id", "anchor" (date), "instalments": [{"date", "amount"}, ...]}
    """
    by_provider_acct: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in bnpl_debits:
        provider = bnpl_provider(t)
        if not provider:
            continue
        by_provider_acct[(provider, str(t.get("account_id") or ""))].append(t)

    plans: list[dict] = []
    for (provider, acct), txns in by_provider_acct.items():
        anchored: dict[tuple[str, float], list[dict]] = defaultdict(list)
        unanchored: list[dict] = []
        for t in txns:
            token = _extract_purchase_token(_txn_text(t))
            if token:
                anchored[(token, _txn_amount(t))].append(t)
            else:
                unanchored.append(t)
        for (token, _amt), group in anchored.items():
            insts = _dedupe_instalments(sorted(
                ({"date": _txn_date(t), "amount": _txn_amount(t)} for t in group),
                key=lambda x: x["date"],
            ))
            if not insts:
                continue
            anchor = _parse_purchase_token(token) or insts[0]["date"]
            plans.append({
                "provider": provider, "account_id": acct,
                "anchor": anchor, "instalments": insts,
            })
        if unanchored:
            for p in _chain_unanchored(provider, acct, unanchored):
                p["instalments"] = _dedupe_instalments(p["instalments"])
                plans.append(p)
    return plans


def _projection(provider: str, account_id: str, anchor: date, instalment: int,
                 amount: float, when: date, hedged: bool) -> dict:
    return {
        "provider":   provider,
        "account_id": account_id,
        "plan_anchor": anchor,
        "instalment": instalment,
        "of":         PLAN_SIZE,
        "amount":     amount,
        "date":       when,
        "hedged":     hedged,
    }


def project_bnpl_instalments(plans: list[dict]) -> list[dict]:
    """For each plan instance, project the instalments it would still owe
    under the pay-in-3 model. Returns one dict per PROJECTED instalment
    (never one for an already-observed instalment).

    - 3+ observed: plan is COMPLETE. Project nothing. Terminate unconditionally.
    - 2 observed: project only instalment 3, at +30d from instalment 2,
      HEDGED — but only when the observed 1->2 spacing already fits the
      30-day model (MIN_SPACING_DAYS..MAX_SPACING_DAYS); wildly-off spacing
      means the shape is unknown, so nothing is projected for that plan
      (fail quiet rather than guess).
    - 1 observed: project instalment 2 at +30d (reasonably firm — a plan is
      contractual once it starts) and instalment 3 at +60d, HEDGED (a
      refund can cancel remaining instalments with no bank-feed signal, so
      the final instalment of any plan must never read as promised).
    """
    out: list[dict] = []
    for p in plans:
        insts = sorted(p["instalments"], key=lambda x: x["date"])
        n = len(insts)
        if n >= PLAN_SIZE:
            continue
        provider, account_id, anchor = p["provider"], p["account_id"], p["anchor"]
        amount = round(sum(i["amount"] for i in insts) / n, 2)
        if n == 2:
            gap = (insts[1]["date"] - insts[0]["date"]).days
            if not (MIN_SPACING_DAYS <= gap <= MAX_SPACING_DAYS):
                continue  # off-model spacing: unknown shape, no projection
            next_date = insts[-1]["date"] + timedelta(days=INSTALMENT_INTERVAL_DAYS)
            out.append(_projection(provider, account_id, anchor, 3, amount, next_date, hedged=True))
        elif n == 1:
            d2 = insts[0]["date"] + timedelta(days=INSTALMENT_INTERVAL_DAYS)
            d3 = d2 + timedelta(days=INSTALMENT_INTERVAL_DAYS)
            out.append(_projection(provider, account_id, anchor, 2, amount, d2, hedged=False))
            out.append(_projection(provider, account_id, anchor, 3, amount, d3, hedged=True))
    return out


def build_bnpl_projections(bnpl_debits: list[dict]) -> list[dict]:
    """Convenience wrapper: group then project in one call — the entry
    point `analytics.py` uses."""
    return project_bnpl_instalments(group_bnpl_plans(bnpl_debits))
