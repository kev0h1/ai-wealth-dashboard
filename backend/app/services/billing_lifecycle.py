"""Trial and subscription lifecycle helpers (B45).

Kept apart from app.services.billing so the webhook handlers there stay
about Stripe and this module stays about what the app does when a plan
changes: user-facing reminder copy, the failed-payment notice, and what
happens to bank connections when a user lands back on the free Statements
plan.

Landing on Statements (cancelled, expired, unpaid, or a trial that never
converted) is derived, not stored: app.core.subscription.get_subscription
returns the Statements tier for any Stripe-backed subscription that has
ended, and every sync path asks app.core.subscription.open_banking_paused
before it talks to a bank provider. Existing synced data is never touched.
The only optional extra is revoking the Finexer consent, behind
REVOKE_CONSENT_ON_DOWNGRADE (default off; see app.core.config).
"""
import logging
from datetime import datetime, timezone

from app.core import timeutil
from app.core.subscription import TIER_BILLING_PRICES_GBP

logger = logging.getLogger(__name__)


def trial_reminder_copy(doc: dict) -> tuple[str, str] | None:
    """(title, body) for the pre-conversion reminder, or None when the
    document has no resolvable price or trial end. Hedged: it says what is
    expected to happen, not a promise about Stripe's charge."""
    tier = doc.get("tier")
    period = doc.get("billing_period")
    total = TIER_BILLING_PRICES_GBP.get(tier, {}).get(period)
    trial_ends_at = timeutil.as_utc(doc.get("trial_ends_at"))
    if total is None or trial_ends_at is None:
        return None
    charge_date = timeutil.to_user_date(trial_ends_at).strftime("%-d %B %Y")
    return (
        "Your free trial ends soon",
        f"Your free trial ends on {charge_date}. £{total:.2f} will be charged "
        f"then unless you cancel from Settings, Your plan.",
    )


PAYMENT_FAILED_TITLE = "Payment didn't go through"


def payment_failed_body() -> str:
    """Derived from BILLING_PAST_DUE_GRACE_DAYS so the stated window cannot
    drift from the real one."""
    from app.core.config import BILLING_PAST_DUE_GRACE_DAYS
    return (
        "We couldn't take your latest payment. Update your card in Settings, "
        f"Your plan, to keep your plan. You keep access for the next {BILLING_PAST_DUE_GRACE_DAYS} days "
        "while we try again."
    )


async def notify(uid: str, title: str, body: str, url: str = "/settings") -> bool:
    """Best-effort push to every device the user has registered. Never
    raises: a notification failure must not fail the webhook that caused
    it (Stripe would retry the whole event)."""
    try:
        from app.core.push import send_push_to_user
        await send_push_to_user(uid, title, body, url=url)
        return True
    except Exception:
        logger.exception("billing_lifecycle: push failed for %s", uid)
        return False


async def revoke_open_banking_consents(uid: str) -> dict:
    """Revoke the user's authorised Finexer consents at Finexer and mark
    them revoked locally. Only called when REVOKE_CONSENT_ON_DOWNGRADE is
    true. Accounts and transactions already synced are kept; the user must
    reconnect their bank (fresh consent) after resubscribing. Best-effort
    per consent: a failed remote call leaves that consent authorised and is
    reported, never raised."""
    from app.db.collections import finexer_consents_col

    consents = await finexer_consents_col.find({"user_id": uid, "status": "authorized"}).to_list(None)
    revoked, failed = 0, 0
    for consent in consents:
        cid = consent["_id"]
        try:
            from app.services.finexer_sync import _client as fx_client
            async with fx_client() as client:
                resp = await client.delete(f"/consents/{cid}")
            if resp.status_code not in (200, 204, 404):
                raise RuntimeError(f"HTTP {resp.status_code}")
        except Exception:
            logger.warning("billing_lifecycle: Finexer revoke failed for a consent of %s", uid, exc_info=True)
            failed += 1
            continue
        await finexer_consents_col.update_one(
            {"_id": cid},
            {"$set": {"status": "revoked", "revoked_at": datetime.now(timezone.utc)}},  # naive-ok: persisted audit instant
        )
        revoked += 1
    return {"revoked": revoked, "failed": failed}


async def on_landed_on_statements(uid: str) -> dict:
    """Called when a subscription has just ended. Stops nothing itself
    (sync is paused by tier), and revokes consent only if configured."""
    from app.core import config

    if not config.REVOKE_CONSENT_ON_DOWNGRADE:
        return {"revoke": "off"}
    return {"revoke": "on", **await revoke_open_banking_consents(uid)}
