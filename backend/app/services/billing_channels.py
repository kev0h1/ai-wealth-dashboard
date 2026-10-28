"""C37: which payment channels are live right now.

`config.BILLING_ENABLED` only describes Stripe web checkout. A user on the
Android or iOS app buys through a store instead, so "billing is live" has to
be asked per channel. This module reuses the exact checks the store endpoints
apply (`apple_billing.client_products`, the `APPLE_IAP_ENABLED` runtime
setting, `play_billing.play_enabled`) rather than restating their rules.
"""
from __future__ import annotations

from app.core import config
from app.core.store_catalogue import STORE_PAID_TIERS
from app.core.subscription import TIER_BY_NAME


async def apple_live() -> bool:
    from app.services import apple_billing, runtime_settings

    if not await runtime_settings.asetting("APPLE_IAP_ENABLED", env=config.APPLE_IAP_ENABLED):
        return False
    products = apple_billing.client_products()
    return all(
        any(key == tier or key.startswith(f"{tier}_") for key in products)
        for tier in STORE_PAID_TIERS if tier in TIER_BY_NAME
    ) and bool(products)


async def google_live() -> bool:
    from app.services import play_billing, runtime_settings

    await runtime_settings.ensure_fresh()
    return bool(play_billing.play_enabled())


async def billing_channels(stripe_web: bool | None = None) -> dict:
    """{"stripe_web", "apple", "google", "any_live"}. `stripe_web` lets a
    caller that holds its own BILLING_ENABLED binding pass it through."""
    stripe = bool(config.BILLING_ENABLED if stripe_web is None else stripe_web)
    try:
        apple = await apple_live()
    except Exception:
        apple = False
    try:
        google = await google_live()
    except Exception:
        google = False
    return {"stripe_web": stripe, "apple": apple, "google": google, "any_live": stripe or apple or google}
