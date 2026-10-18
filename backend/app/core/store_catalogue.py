"""Store product catalogue (C21 Apple, C24 Google, docs/pricing/store-billing-c13.md section 3).

The one place that says which store products exist and how a product id maps
back to what it grants. Provider-neutral: Apple and Google share the same
deterministic ids unless a provider's override table says otherwise.

Scheme, derived from the single price source (never retyped):

  subscriptions  sorted.<tier>.<period>   tier in lite|standard|plus,
                                          period in monthly|six_months|annual
  one-time       sorted.penny.<n>         n = messages in the pack (20/100/200)

That is 9 subscription products plus 3 one-time products. Statements is free
and never sold. There is no Connect product (B51) and no MCP pack in the
stores. Kevin decided on 2026-10-17 (C24) that store prices match web exactly,
so the price of each product is TIER_BILLING_PRICES_GBP / PENNY_TOPUP_PACKS and
every subscription carries the 14-day free introductory offer
(SUBSCRIPTION_TRIAL_DAYS). Prices and the offer live in the store consoles;
this module only knows ids.

Override keys use the vocabulary shared with STRIPE_PRICE_IDS: a tier name for
monthly, `<tier>_six_months` / `<tier>_annual` for the longer periods, and
`penny_small` / `penny_medium` / `penny_large` for the packs.
"""
from dataclasses import dataclass

from app.core.subscription import (
    PENNY_TOPUP_PACKS, SUBSCRIPTION_PERIODS_ENABLED, TIER_BY_NAME, TIER_NAMES, _LEGACY_TIER_MAP,
)

# Four tiers in all (Statements is the free one; B53 replaced Max and Connect
# with Plus); these are the paid ones the stores sell. Kept explicit rather than derived from TIER_BY_NAME so a tier
# added or hidden elsewhere cannot silently create or drop a store product.
STORE_PAID_TIERS = ("lite", "standard", "plus")


@dataclass(frozen=True)
class StoreProduct:
    key: str                 # shared key vocabulary, e.g. "lite_annual", "penny_small"
    product_id: str          # the id created in the store console
    kind: str                # "subscription" | "pack"
    tier: str | None = None
    billing_period: str | None = None
    pack_kind: str | None = None   # "penny"
    pack_id: str | None = None     # "small" | "medium" | "large"
    legacy: bool = False           # an alias that resolves old ids, never offered


def subscription_key(tier: str, period: str) -> str:
    return tier if period == "monthly" else f"{tier}_{period}"


def default_product_id(tier: str, period: str) -> str:
    return f"sorted.{tier}.{period}"


def default_pack_product_id(pack: dict) -> str:
    return f"sorted.penny.{int(pack['messages'])}"


def build_catalogue(overrides: dict[str, str] | None = None) -> dict[str, StoreProduct]:
    """product_id -> StoreProduct for every purchasable store product, with
    `overrides` (key -> product id) applied over the deterministic ids."""
    overrides = overrides or {}
    out: dict[str, StoreProduct] = {}
    for tier in STORE_PAID_TIERS:
        if tier not in TIER_BY_NAME:
            continue
        for period in SUBSCRIPTION_PERIODS_ENABLED:
            key = subscription_key(tier, period)
            pid = overrides.get(key) or default_product_id(tier, period)
            out[pid] = StoreProduct(key=key, product_id=pid, kind="subscription", tier=tier, billing_period=period)
    # B53: Max was renamed Plus. A transaction that ever carried a legacy
    # `sorted.max.<period>` id resolves to the Plus product through the same
    # legacy map the stored-tier reader uses; these ids are never offered.
    legacy_plus = _LEGACY_TIER_MAP.get("max")
    if legacy_plus is not None and TIER_NAMES[legacy_plus] in STORE_PAID_TIERS:
        for product in list(out.values()):
            if product.kind == "subscription" and product.tier == TIER_NAMES[legacy_plus]:
                alias = default_product_id("max", product.billing_period)
                out.setdefault(alias, StoreProduct(
                    key=product.key, product_id=alias, kind="subscription",
                    tier=product.tier, billing_period=product.billing_period, legacy=True,
                ))
    for pack in PENNY_TOPUP_PACKS:
        key = f"penny_{pack['id']}"
        pid = overrides.get(key) or default_pack_product_id(pack)
        out[pid] = StoreProduct(key=key, product_id=pid, kind="pack", pack_kind="penny", pack_id=pack["id"])
    return out


def product_ids_by_key(overrides: dict[str, str] | None = None) -> dict[str, str]:
    """key -> product id, what the client is given to load from the store."""
    return {p.key: p.product_id for p in build_catalogue(overrides).values() if not p.legacy}
