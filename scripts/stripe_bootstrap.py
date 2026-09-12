#!/usr/bin/env python3
"""B25: idempotent Stripe TEST-mode bootstrap for B5/B22 billing.

B5 built billing end to end (checkout, portal, webhooks) but it only
activates once every price in `app.core.config._STRIPE_REQUIRED_PRICE_KEYS`
exists in Stripe and is wired into the `STRIPE_PRICE_IDS` env var (see
`app.core.config.BILLING_ENABLED`). Nobody creates those products/prices by
hand in this codebase's workflow — this script creates them (or verifies
they already match) and prints a ready-to-paste `STRIPE_PRICE_IDS=...` line.

Source of truth is the code, never a second copy of the numbers here:
`app.core.subscription.TIER_BILLING_PRICES_GBP` /
`SUBSCRIPTION_BILLING_PERIODS` / `PENNY_TOPUP_PACKS` / `MCP_CALL_PACKS`, and
`app.core.config._STRIPE_REQUIRED_PRICE_KEYS` as the completeness check.

Statements is free and never gets a Stripe product or price.

Idempotency: every price gets a stable Stripe `lookup_key` equal to its
`STRIPE_PRICE_IDS` key (bare tier name for monthly, `{tier}_{period}` for
the three longer periods, `penny_small`/`penny_medium`/`penny_large` and
`mcp_1000` for the packs). Every product gets a stable
`metadata["app_product_key"]` marker. A second run finds these and creates
nothing new. Stripe prices are immutable — if an existing price's amount or
interval no longer matches the code (Kevin changed the price table), a
replacement price is created with `transfer_lookup_key=True` (which moves
the lookup_key across) and the stale price is archived
(`active=False`); the change is printed loudly either way.

SAFETY: the secret key is read ONLY from the `STRIPE_SECRET_KEY`
environment variable (never a CLI argument, which would land in shell
history) and this script refuses to run against anything but a test-mode
key (`sk_test_...`). There is no flag to override this — live-mode setup is
a deliberately separate future item. The key itself is never printed,
logged, or written anywhere by this script.

Usage:
    backend/.venv/bin/python scripts/stripe_bootstrap.py [--dry-run]

`--dry-run` prints the full plan (every product/price this script would
ensure exists) without making a single Stripe call — including no read —
so it's the only mode that can be exercised without a real Stripe account.
It still requires `STRIPE_SECRET_KEY` to be set and test-mode-shaped, since
that check is unconditional.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.core.config import _STRIPE_REQUIRED_PRICE_KEYS  # noqa: E402
from app.core.subscription import (  # noqa: E402
    MCP_CALL_PACKS, PENNY_TOPUP_PACKS, SUBSCRIPTION_BILLING_PERIODS,
    TIER_BILLING_PRICES_GBP,
)

# Lazily-bound-at-call-time module global (not a local alias) so tests can
# `monkeypatch.setattr(stripe_bootstrap, "stripe", fake_stripe)` and have
# every function below pick it up, matching app/services/billing.py's own
# monkeypatch contract for the `stripe` name.
import stripe  # noqa: E402

_PAID_TIERS = ("lite", "standard", "connect", "max")
_TIER_LABELS = {
    "lite": "Lite", "standard": "Standard", "connect": "Connect", "max": "Max",
}


def _gbp_to_pence(amount: float) -> int:
    """Pounds (float) -> pence (int), rounded (not truncated) so e.g.
    16.99 -> 1699, never int(16.99 * 100) == 1698 territory from float
    error."""
    return round(amount * 100)


def _recurring_for_period(period: str) -> dict:
    months = SUBSCRIPTION_BILLING_PERIODS[period]["months"]
    if period == "annual":
        return {"interval": "year", "interval_count": 1}
    return {"interval": "month", "interval_count": months}


def _interval_description(recurring: dict | None) -> str:
    if not recurring:
        return "one-off"
    if recurring["interval"] == "year":
        return "yearly"
    count = recurring["interval_count"]
    return "monthly" if count == 1 else f"every {count} months"


class PricePlan:
    def __init__(self, lookup_key: str, product_key: str, unit_amount: int,
                 recurring: dict | None, metadata: dict):
        self.lookup_key = lookup_key
        self.product_key = product_key
        self.unit_amount = unit_amount
        self.recurring = recurring
        self.metadata = metadata

    def matches(self, existing_unit_amount: int, existing_recurring: dict | None) -> bool:
        if self.unit_amount != existing_unit_amount:
            return False
        if bool(self.recurring) != bool(existing_recurring):
            return False
        if self.recurring and existing_recurring:
            if self.recurring["interval"] != existing_recurring.get("interval"):
                return False
            if self.recurring["interval_count"] != existing_recurring.get("interval_count"):
                return False
        return True


class ProductPlan:
    def __init__(self, product_key: str, name: str):
        self.product_key = product_key
        self.name = name


def build_plan() -> tuple[list[ProductPlan], list[PricePlan]]:
    """Pure — no Stripe calls. Reads only the app's own tables, so this
    script can never drift into a second, hand-maintained copy of the
    price list."""
    products: list[ProductPlan] = []
    prices: list[PricePlan] = []

    for tier in _PAID_TIERS:
        product_key = f"tier_{tier}"
        products.append(ProductPlan(product_key, f"Sorted — {_TIER_LABELS[tier]}"))
        for period in SUBSCRIPTION_BILLING_PERIODS:
            lookup_key = tier if period == "monthly" else f"{tier}_{period}"
            amount_gbp = TIER_BILLING_PRICES_GBP[tier][period]
            prices.append(PricePlan(
                lookup_key=lookup_key,
                product_key=product_key,
                unit_amount=_gbp_to_pence(amount_gbp),
                recurring=_recurring_for_period(period),
                metadata={"tier": tier, "period": period},
            ))

    products.append(ProductPlan("penny_topups", "Sorted — Penny message top-ups"))
    for pack in PENNY_TOPUP_PACKS:
        prices.append(PricePlan(
            lookup_key=f"penny_{pack['id']}",
            product_key="penny_topups",
            unit_amount=_gbp_to_pence(pack["price_gbp"]),
            recurring=None,
            metadata={"pack_id": pack["id"], "messages": str(pack["messages"])},
        ))

    products.append(ProductPlan("mcp_calls", "Sorted — MCP call pack"))
    for pack in MCP_CALL_PACKS:
        prices.append(PricePlan(
            lookup_key=pack["id"],
            product_key="mcp_calls",
            unit_amount=_gbp_to_pence(pack["price_gbp"]),
            recurring=None,
            metadata={"pack_id": pack["id"], "calls": str(pack["calls"])},
        ))

    plan_keys = {p.lookup_key for p in prices}
    required_keys = set(_STRIPE_REQUIRED_PRICE_KEYS)
    if plan_keys != required_keys:
        missing = required_keys - plan_keys
        extra = plan_keys - required_keys
        raise AssertionError(
            "stripe_bootstrap plan does not match _STRIPE_REQUIRED_PRICE_KEYS: "
            f"missing={sorted(missing)} extra={sorted(extra)}"
        )

    return products, prices


def _check_secret_key() -> str:
    """Unconditional gate — runs before dry-run or real-run branch. No CLI
    flag exists to override this on purpose."""
    key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not key.startswith("sk_test_"):
        print(
            "STRIPE_SECRET_KEY must be a test-mode key (sk_test_...); "
            "refusing to run against anything else. There is no override "
            "flag — live-mode setup is a separate future item.",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def _fmt_gbp(pence: int) -> str:
    return f"£{pence / 100:.2f}"


def run_dry_run(products: list[ProductPlan], prices: list[PricePlan]) -> None:
    """Prints the full plan without making a single Stripe call (not even
    a read) — the only mode runnable without a real Stripe account."""
    print("[DRY RUN] no Stripe calls were made; this is the full plan only.")
    for product in products:
        print(f"[DRY RUN] would ensure product: {product.name} (app_product_key={product.product_key})")
    for price in prices:
        interval = _interval_description(price.recurring)
        print(
            f"[DRY RUN] would ensure price: lookup_key={price.lookup_key} "
            f"amount={_fmt_gbp(price.unit_amount)} interval={interval} "
            f"product={price.product_key}"
        )
    ordered = ",".join(f"{key}=<would-create>" for key in _STRIPE_REQUIRED_PRICE_KEYS)
    print(f"STRIPE_PRICE_IDS={ordered}")


def _ensure_products(products: list[ProductPlan]) -> dict[str, str]:
    """Returns product_key -> Stripe product id, creating any product
    whose app_product_key marker isn't already present. Single
    non-paginated list call: the whole catalog here is 6 products, well
    under Stripe's page size of 100, so pagination is unnecessary."""
    existing = stripe.Product.list(active=True, limit=100)
    by_key: dict[str, str] = {}
    for prod in existing.data:
        marker = (prod.metadata or {}).get("app_product_key")
        if marker:
            by_key[marker] = prod.id

    resolved: dict[str, str] = {}
    for plan in products:
        if plan.product_key in by_key:
            resolved[plan.product_key] = by_key[plan.product_key]
            print(f"reusing product: {plan.name} ({plan.product_key}) -> {by_key[plan.product_key]}")
        else:
            created = stripe.Product.create(
                name=plan.name, metadata={"app_product_key": plan.product_key},
            )
            resolved[plan.product_key] = created.id
            print(f"creating product: {plan.name} ({plan.product_key}) -> {created.id}")
    return resolved


def _existing_price_recurring(price) -> dict | None:
    recurring = getattr(price, "recurring", None)
    if not recurring:
        return None
    return {"interval": recurring["interval"], "interval_count": recurring["interval_count"]}


def _ensure_prices(prices: list[PricePlan], product_ids: dict[str, str]) -> dict[str, str]:
    """Returns lookup_key -> Stripe price id. Single non-paginated list
    call for the same reason as _ensure_products."""
    existing = stripe.Price.list(active=True, limit=100)
    by_lookup_key = {}
    for price in existing.data:
        key = getattr(price, "lookup_key", None)
        if key:
            by_lookup_key[key] = price

    resolved: dict[str, str] = {}
    for plan in prices:
        product_id = product_ids[plan.product_key]
        interval = _interval_description(plan.recurring)
        current = by_lookup_key.get(plan.lookup_key)

        if current is None:
            created = stripe.Price.create(
                product=product_id, lookup_key=plan.lookup_key, unit_amount=plan.unit_amount,
                currency="gbp", metadata=plan.metadata,
                **({"recurring": plan.recurring} if plan.recurring else {}),
            )
            resolved[plan.lookup_key] = created.id
            print(f"creating price {plan.lookup_key}: {_fmt_gbp(plan.unit_amount)} ({interval}) -> {created.id}")
            continue

        existing_recurring = _existing_price_recurring(current)
        if plan.matches(current.unit_amount, existing_recurring):
            resolved[plan.lookup_key] = current.id
            print(f"price {plan.lookup_key}: unchanged ({_fmt_gbp(plan.unit_amount)}, {interval}) -> {current.id}")
            continue

        old_amount = _fmt_gbp(current.unit_amount)
        old_interval = _interval_description(existing_recurring)
        new_created = stripe.Price.create(
            product=product_id, lookup_key=plan.lookup_key, transfer_lookup_key=True,
            unit_amount=plan.unit_amount, currency="gbp", metadata=plan.metadata,
            **({"recurring": plan.recurring} if plan.recurring else {}),
        )
        stripe.Price.modify(current.id, active=False)
        resolved[plan.lookup_key] = new_created.id
        print(
            f"CHANGED: {plan.lookup_key} was {old_amount} ({old_interval}), code now says "
            f"{_fmt_gbp(plan.unit_amount)} ({interval}) — created new price {new_created.id}, "
            f"archived stale price {current.id}"
        )

    return resolved


def run_real(key: str, products: list[ProductPlan], prices: list[PricePlan]) -> dict[str, str]:
    stripe.api_key = key
    product_ids = _ensure_products(products)
    price_ids = _ensure_prices(prices, product_ids)

    missing = [k for k in _STRIPE_REQUIRED_PRICE_KEYS if k not in price_ids]
    if missing:
        print(
            f"ERROR: STRIPE_PRICE_IDS is missing required keys after bootstrap: {missing}",
            file=sys.stderr,
        )
        sys.exit(1)

    ordered = ",".join(f"{key}={price_ids[key]}" for key in _STRIPE_REQUIRED_PRICE_KEYS)
    print(f"STRIPE_PRICE_IDS={ordered}")
    return price_ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="print the plan, make no Stripe calls")
    args = parser.parse_args(argv)

    key = _check_secret_key()
    products, prices = build_plan()

    if args.dry_run:
        run_dry_run(products, prices)
        return 0

    run_real(key, products, prices)
    return 0


if __name__ == "__main__":
    sys.exit(main())
