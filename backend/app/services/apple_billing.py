"""Apple in-app purchase (C21, docs/pricing/store-billing-c13.md sections 4 to 8).

Apple-specific half of store billing: the appAccountToken that ties an Apple
transaction to a user, App Store Server Notifications V2 handling, and
verification of a client-submitted signed transaction (purchase and restore).
Everything that writes subscriptions_col or the pack collections goes through
the provider-neutral seam in app.services.store_subscriptions, the store-side
twin of the Stripe handlers in app.services.billing.

Trust boundary: nothing here reads a payload before app.services.apple_jws has
verified its certificate chain (pinned Apple root) and signature. A client is
never believed about what it bought: even a purchase the client reports is
verified here as a signed transaction and must carry THIS user's
appAccountToken.

Notification-to-effect table (see `_dispatch`):

  SUBSCRIBED, OFFER_REDEEMED, DID_RENEW,   subscription upsert from the signed
  REFUND_REVERSED, RENEWAL_EXTENDED,       transaction: tier and period from
  DID_CHANGE_RENEWAL_PREF (UPGRADE)        the product id, expires_at from
                                           expiresDate, "trialing" while the
                                           introductory free-trial offer is
                                           running, else "active"
  DID_CHANGE_RENEWAL_STATUS                cancel_at_period_end from the
                                           renewal info's autoRenewStatus
  DID_FAIL_TO_RENEW                        "past_due"; access to the grace
                                           period's end when Apple grants one
                                           (subtype GRACE_PERIOD), otherwise
                                           none
  EXPIRED, GRACE_PERIOD_EXPIRED            "expired"
  REFUND, REVOKE                           subscription: "expired" at once,
                                           whatever expires_at says.
                                           Consumable: recorded, and spent
                                           messages reclaimed only when
                                           IAP_REFUND_CLAWBACK is on
  ONE_TIME_CHARGE                          grant the consumable Penny pack,
                                           once per transactionId
  TEST                                     acknowledged, nothing changes
  anything else                            acknowledged, nothing changes

Every notification is claimed in billing_events_col under
"apple:<notificationUUID>" (replay protection) before it is applied, and every
effect is idempotent, so Apple's retries are harmless. A notification that
cannot be attributed (no resolvable appAccountToken) or maps to no known
product changes nothing and says why (fail closed, never guess a tier).
"""
import logging
import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from app.core import config
from app.core.store_catalogue import StoreProduct, build_catalogue, product_ids_by_key
from app.services import apple_jws, store_subscriptions as seam
from app.services.apple_jws import AppleVerificationError

logger = logging.getLogger(__name__)

PROVIDER = "apple"
_INTRODUCTORY_OFFER = 1  # transaction `offerType`: 1 introductory, 2 promotional, 3 offer code


class AppleNotConfigured(Exception):
    """IAP is switched off or no root certificate is pinned. The receiver
    answers 503 and nothing is granted."""


class AppleAccountMismatch(Exception):
    """A signed transaction is genuine but is not this user's."""


# ── Configuration ────────────────────────────────────────────────────────────

def catalogue() -> dict[str, StoreProduct]:
    return build_catalogue(config.APPLE_PRODUCT_IDS)


def client_products() -> dict[str, str]:
    """key -> product id, what the client loads from the store."""
    return product_ids_by_key(config.APPLE_PRODUCT_IDS)


def _roots():
    roots = apple_jws.load_pinned_roots(config.APPLE_ROOT_CERTS_DIR)
    if not roots:
        raise AppleNotConfigured("no pinned Apple root certificate")
    return roots


# ── appAccountToken (section 4) ──────────────────────────────────────────────

async def get_or_create_account_token(uid: str) -> str:
    """The user's appAccountToken, a random UUID minted once on first use and
    reused for every purchase and renewal (Apple's own guidance). Never
    derived from the email or any other user attribute, so it identifies
    nothing outside this app."""
    from app.db.collections import apple_account_tokens_col

    existing = await apple_account_tokens_col.find_one({"user_id": uid})
    if existing:
        return existing["app_account_token"]
    token = str(uuid.uuid4())
    try:
        await apple_account_tokens_col.insert_one(
            {"user_id": uid, "app_account_token": token, "created_at": datetime.now(timezone.utc)},  # naive-ok: aware instant, persisted audit or compared with as_utc stamps
        )
        return token
    except DuplicateKeyError:
        # A concurrent first call won the unique index: use its token.
        existing = await apple_account_tokens_col.find_one({"user_id": uid})
        if existing:
            return existing["app_account_token"]
        raise


def _normalise_token(value) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


async def uid_for_account_token(value) -> str | None:
    from app.db.collections import apple_account_tokens_col

    token = _normalise_token(value)
    if not token:
        return None
    doc = await apple_account_tokens_col.find_one({"app_account_token": token})
    return doc.get("user_id") if doc else None


# ── Payload helpers ──────────────────────────────────────────────────────────

def _ms(value) -> datetime | None:
    """Apple timestamps are integer milliseconds since the epoch."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not 0 <= value < 32_503_680_000_000:  # year 3000
        return None
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc)


def _check_transaction(tx: dict, expected_env: str | None) -> None:
    if tx.get("bundleId") != config.APPLE_BUNDLE_ID:
        raise AppleVerificationError("transaction bundle id mismatch")
    env = tx.get("environment")
    if env not in config.APPLE_ALLOWED_ENVIRONMENTS or (expected_env and env != expected_env):
        raise AppleVerificationError("transaction environment not accepted")


def _decode_nested(token, roots, now) -> dict | None:
    if token is None:
        return None
    return apple_jws.verify_and_decode(token, roots, now)


def _is_free_trial(tx: dict) -> bool:
    if tx.get("offerType") != _INTRODUCTORY_OFFER:
        return False
    discount = tx.get("offerDiscountType")
    if discount is not None:
        return discount == "FREE_TRIAL"
    return not tx.get("price")  # older payloads: the introductory offer here is a free trial


async def _resolve_uid(tx: dict) -> str | None:
    uid = await uid_for_account_token(tx.get("appAccountToken"))
    if uid:
        return uid
    # A renewal for a subscription we already know carries the same
    # originalTransactionId even if the token were ever absent.
    from app.db.collections import subscriptions_col

    original = tx.get("originalTransactionId")
    if original:
        doc = await subscriptions_col.find_one({"provider": PROVIDER, "provider_subscription_id": str(original)})
        if doc:
            return doc.get("user_id")
    return None


def _unattributed() -> dict:
    logger.warning("apple billing: transaction resolved no user (unknown appAccountToken)")
    return {"handled": False, "reason": "no user resolvable for this transaction"}


# ── Applying a verified transaction ──────────────────────────────────────────

async def _apply_subscription_transaction(
    uid: str, product: StoreProduct, tx: dict, renewal: dict | None, signed_at: datetime | None,
    *, client_submitted: bool = False, now: datetime | None = None,
) -> dict:
    from app.db.collections import subscriptions_col

    now = now or datetime.now(timezone.utc)  # naive-ok: aware instant, persisted audit or compared with as_utc stamps
    original = tx.get("originalTransactionId")
    expires_at = _ms(tx.get("expiresDate"))
    if not original or expires_at is None:
        return {"handled": False, "reason": "transaction has no original id or expiry"}
    original = str(original)

    if client_submitted:
        # A restore can hand over an older period of a subscription that has
        # since renewed. Never let it move state backwards.
        existing = await subscriptions_col.find_one(seam.store_doc_filter(uid, PROVIDER))
        stored_expiry = existing.get("expires_at") if existing else None
        if existing and existing.get("provider_subscription_id") == original and stored_expiry is not None:
            from app.core.timeutil import as_utc

            if as_utc(stored_expiry) > expires_at:
                return {"handled": True, "action": "subscription_upsert", "uid": uid, "provider": PROVIDER,
                        "unchanged": True, "reason": "transaction is for an older period"}

    revoked = _ms(tx.get("revocationDate")) is not None
    trialing = _is_free_trial(tx) and not revoked and expires_at > now
    if revoked or expires_at <= now:
        status = "expired"
    elif trialing:
        status = "trialing"
    else:
        status = "active"

    cancel = None
    if renewal is not None and isinstance(renewal.get("autoRenewStatus"), int) and not isinstance(renewal.get("autoRenewStatus"), bool):
        cancel = renewal["autoRenewStatus"] == 0

    return await seam.upsert_store_subscription(
        uid, PROVIDER,
        tier=product.tier, billing_period=product.billing_period, status=status, expires_at=expires_at,
        provider_subscription_id=original,
        trial_ends_at=expires_at if trialing else None,
        trial_started_at=(_ms(tx.get("purchaseDate")) or now) if _is_free_trial(tx) else None,
        cancel_at_period_end=cancel, signed_at=signed_at,
        extra={
            "apple_product_id": tx.get("productId"),
            "apple_environment": tx.get("environment"),
            "apple_latest_transaction_id": str(tx.get("transactionId")) if tx.get("transactionId") else None,
        },
    )


# ── Notification dispatch ────────────────────────────────────────────────────

_UPSERT_TYPES = {"SUBSCRIBED", "OFFER_REDEEMED", "DID_RENEW", "REFUND_REVERSED", "RENEWAL_EXTENDED"}


async def _handle_refund_or_revoke(ntype: str, uid: str, product: StoreProduct, tx: dict, signed_at) -> dict:
    original = str(tx.get("originalTransactionId") or "")
    transaction_id = str(tx.get("transactionId") or "")
    if product.kind == "subscription":
        result = await seam.set_store_subscription_status(
            uid, PROVIDER, original, "expired", signed_at=signed_at,
            extra={"revoked_at" if ntype == "REVOKE" else "refunded_at": datetime.now(timezone.utc)},  # naive-ok: aware instant, persisted audit or compared with as_utc stamps
        )
        result.update({"notification": ntype, "kind": "subscription", "tier": product.tier,
                       "originalTransactionId": original, "transactionId": transaction_id})
        return result
    # Consumable (section 8): always recorded, reclaimed only behind the flag.
    outcome = await seam.record_store_pack_refund(
        PROVIDER, product.pack_kind, transaction_id, clawback=bool(config.IAP_REFUND_CLAWBACK),
    )
    return {
        "handled": True, "action": "pack_refund", "notification": ntype, "uid": uid,
        "kind": "pack", "pack_kind": product.pack_kind, "pack_id": product.pack_id,
        "originalTransactionId": original, "transactionId": transaction_id, **outcome,
    }


async def _dispatch(payload: dict, tx: dict | None, renewal: dict | None) -> dict:
    ntype = payload.get("notificationType")
    subtype = payload.get("subtype")
    signed_at = _ms(payload.get("signedDate"))

    if ntype == "TEST":
        return {"handled": False, "reason": "test notification"}
    if tx is None:
        return {"handled": False, "reason": f"{ntype} carries no transaction"}
    known = (
        ntype in _UPSERT_TYPES or ntype in ("DID_CHANGE_RENEWAL_PREF", "DID_CHANGE_RENEWAL_STATUS",
        "DID_FAIL_TO_RENEW", "EXPIRED", "GRACE_PERIOD_EXPIRED", "REFUND", "REVOKE", "ONE_TIME_CHARGE")
    )
    if not known:
        return {"handled": False, "reason": f"unrecognised notification type {ntype!r}"}
    if ntype == "DID_CHANGE_RENEWAL_PREF" and subtype != "UPGRADE":
        # A downgrade or crossgrade takes effect at the next renewal, which
        # arrives as its own DID_RENEW. Entitlement is unchanged until then.
        return {"handled": False, "reason": "renewal preference change takes effect at renewal"}

    product = catalogue().get(tx.get("productId"))
    if product is None:
        logger.warning("apple billing: %s for a product id not in the catalogue", ntype)
        return {"handled": False, "reason": "product is not in the catalogue"}
    uid = await _resolve_uid(tx)
    if not uid:
        return _unattributed()

    if ntype in ("REFUND", "REVOKE"):
        return await _handle_refund_or_revoke(ntype, uid, product, tx, signed_at)
    if ntype == "ONE_TIME_CHARGE":
        if product.kind != "pack":
            return {"handled": False, "reason": "one-time charge for a subscription product"}
        return await seam.grant_store_pack(uid, PROVIDER, product.pack_kind, product.pack_id, str(tx.get("transactionId") or ""))
    if product.kind != "subscription":
        return {"handled": False, "reason": f"{ntype} for a consumable product"}

    original = str(tx.get("originalTransactionId") or "")
    if ntype in _UPSERT_TYPES or ntype == "DID_CHANGE_RENEWAL_PREF":
        return await _apply_subscription_transaction(uid, product, tx, renewal, signed_at)
    if ntype == "DID_CHANGE_RENEWAL_STATUS":
        if subtype in ("AUTO_RENEW_DISABLED", "AUTO_RENEW_ENABLED"):
            cancel = subtype == "AUTO_RENEW_DISABLED"
        elif renewal is not None and isinstance(renewal.get("autoRenewStatus"), int):
            cancel = renewal["autoRenewStatus"] == 0
        else:
            return {"handled": False, "reason": "no renewal status in the notification"}
        return await seam.set_store_cancel_at_period_end(uid, PROVIDER, original, cancel, signed_at=signed_at)
    if ntype == "DID_FAIL_TO_RENEW":
        grace = _ms((renewal or {}).get("gracePeriodExpiresDate")) if subtype == "GRACE_PERIOD" else None
        return await seam.set_store_subscription_status(
            uid, PROVIDER, original, "past_due", signed_at=signed_at, grace_until=grace,
        )
    # EXPIRED, GRACE_PERIOD_EXPIRED
    return await seam.set_store_subscription_status(uid, PROVIDER, original, "expired", signed_at=signed_at)


async def handle_notification(signed_payload: str, *, now: datetime | None = None) -> dict:
    """Verify and apply one App Store Server Notification V2.

    Raises AppleNotConfigured (switched off / no root pinned) or
    AppleVerificationError (anything untrustworthy: bad chain or signature,
    wrong bundle id, wrong environment, malformed body). Otherwise returns
    {"ok": True, "idempotent": bool, "result": dict}. Every payload is
    verified BEFORE the ledger claim, so a forged one can never consume a
    notificationUUID."""
    if not config.APPLE_IAP_ENABLED:
        raise AppleNotConfigured("in-app purchase is not enabled")
    roots = _roots()
    now = now or datetime.now(timezone.utc)  # naive-ok: aware instant, persisted audit or compared with as_utc stamps
    payload = apple_jws.verify_and_decode(signed_payload, roots, now)

    ntype = payload.get("notificationType")
    subtype = payload.get("subtype")
    notification_uuid = payload.get("notificationUUID")
    if not isinstance(ntype, str) or not isinstance(notification_uuid, str) or not 8 <= len(notification_uuid) <= 64:
        raise AppleVerificationError("notification lacks a type or UUID")

    tx = renewal = None
    data = payload.get("data")
    if ntype != "TEST":
        if not isinstance(data, dict):
            raise AppleVerificationError("notification has no data")
        if data.get("bundleId") != config.APPLE_BUNDLE_ID:
            raise AppleVerificationError("bundle id mismatch")
        env = data.get("environment")
        if env not in config.APPLE_ALLOWED_ENVIRONMENTS:
            raise AppleVerificationError("environment not accepted by this deployment")
        tx = _decode_nested(data.get("signedTransactionInfo"), roots, now)
        renewal = _decode_nested(data.get("signedRenewalInfo"), roots, now)
        if tx is not None:
            _check_transaction(tx, env)
        if renewal is not None and renewal.get("environment") not in (None, env):
            raise AppleVerificationError("renewal info environment mismatch")

    state, existing = await seam.claim_event(
        PROVIDER, notification_uuid, ntype,
        extra={"subtype": subtype, "transaction_id": str(tx.get("transactionId")) if tx and tx.get("transactionId") else None,
               "original_transaction_id": str(tx.get("originalTransactionId")) if tx and tx.get("originalTransactionId") else None},
    )
    if state == "replay":
        logger.info("apple billing: notification %s already processed", notification_uuid)
        return {"ok": True, "idempotent": True, "result": existing.get("result")}

    result = await _dispatch(payload, tx, renewal)
    await seam.finish_event(PROVIDER, notification_uuid, result)
    logger.info("apple billing: %s/%s handled=%s", ntype, subtype, result.get("handled"))
    return {"ok": True, "idempotent": False, "result": result}


# ── Client-submitted signed transaction: purchase and restore (sections 6, 7) ─

async def verify_signed_transaction(uid: str, signed_transaction: str, *, now: datetime | None = None) -> dict:
    """Verify a transaction the app reports (StoreKit's jwsRepresentation),
    from a purchase or a restore, and apply it exactly as the matching
    notification would. Idempotent: restoring twice changes nothing.

    The transaction must carry THIS user's appAccountToken (or belong to an
    Apple subscription this user already holds), otherwise AppleAccountMismatch:
    a restore on a device signed in as someone else cannot attach another
    account's purchase to this one. A completed purchase is granted even if a
    Stripe subscription is live (the money has been taken), and flagged."""
    if not config.APPLE_IAP_ENABLED:
        raise AppleNotConfigured("in-app purchase is not enabled")
    roots = _roots()
    now = now or datetime.now(timezone.utc)  # naive-ok: aware instant, persisted audit or compared with as_utc stamps
    tx = apple_jws.verify_and_decode(signed_transaction, roots, now)
    _check_transaction(tx, None)

    product = catalogue().get(tx.get("productId"))
    if product is None:
        return {"handled": False, "reason": "product is not in the catalogue"}

    token_uid = await uid_for_account_token(tx.get("appAccountToken"))
    if token_uid != uid:
        owned = False
        if token_uid is None and tx.get("originalTransactionId"):
            from app.db.collections import subscriptions_col

            doc = await subscriptions_col.find_one(seam.store_doc_filter(uid, PROVIDER))
            owned = bool(doc and doc.get("provider_subscription_id") == str(tx["originalTransactionId"]))
        if not owned:
            raise AppleAccountMismatch("transaction belongs to a different account")

    signed_at = _ms(tx.get("signedDate"))
    if product.kind == "pack":
        if _ms(tx.get("revocationDate")) is not None:
            return {"handled": False, "reason": "transaction was refunded"}
        return await seam.grant_store_pack(uid, PROVIDER, product.pack_kind, product.pack_id, str(tx.get("transactionId") or ""))
    return await _apply_subscription_transaction(uid, product, tx, None, signed_at, client_submitted=True, now=now)
