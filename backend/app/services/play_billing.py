"""Google Play Billing receiver and verifier (C24).

The Play-side twin of app.services.billing (Stripe) and apple_billing (C21).
It does Google-specific work only: authenticate and decode a Real-time
Developer Notification (RTDN) pushed through Pub/Sub, then verify the purchase
it points at with the Google Play Developer API, and hand the verified result
to the provider-neutral seam in app.services.store_subscriptions, which owns
every write to subscriptions_col and the pack collections. Nothing in this
module writes entitlement itself.

Doctrine (the same as the Stripe handlers, plus Play's own rules):

  * The server is the only authority. A notification is a hint, never a
    fact: for every subscription or one-time-product notification the
    purchase is fetched from the Developer API and the state that comes back
    is what is applied. The client never grants anything either: its
    "purchase finished" call (verify_client_purchase) only hands over a
    purchase token as a lookup key, and the API's answer decides.
  * Fetching current state on every event makes ordering a non-issue: a late
    or replayed notification re-reads the truth, so it can only re-apply it.
    `signed_at` for the seam is the instant before the fetch, so of two
    racing fetches the later one wins.
  * A purchase maps to an account only through the obfuscatedAccountId the app
    set at purchase time (a salted hash of the user id, never the email),
    resolved through play_account_ids_col. Missing or unknown: refused and
    NOT acknowledged, so Google refunds it after three days rather than the
    user paying for nothing. A client verifying its own purchase must match
    that account, or it is refused.
  * Acknowledge within three days, on the first verified receipt, once
    (idempotent: skipped when Google or play_purchases_col already says so).
    Consumables are consumed only after the pack was granted.
  * purchaseToken is the dedupe key (play_purchases_col, unique). Raw tokens
    live only there; the subscription document carries sha256(token), and no
    log line carries a token, a uid or a response body.
  * Fail closed: unknown product, wrong package, test purchase on a
    production host, unmapped account -> refused with a reason, nothing
    granted. Transient failures (Google or the database down) raise
    PlayUnavailable so the router answers 503 and Pub/Sub redelivers.
"""
import asyncio
import contextlib
import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from pymongo.errors import DuplicateKeyError

from app.core import config, play_config
from app.core.store_catalogue import StoreProduct, build_catalogue, product_ids_by_key
from app.core.subscription import SUBSCRIPTION_TRIAL_DAYS
from app.services import google_play, store_subscriptions
from app.services.google_play import PlayApiError

logger = logging.getLogger(__name__)

PROVIDER = "google"

# Play purchase tokens are opaque url-safe strings (letters, digits, '.', '_',
# '-'); anything else is rejected before it can reach a URL.
_TOKEN_RE = re.compile(r"^[A-Za-z0-9._\-]{16,4096}$")
_PRODUCT_RE = re.compile(r"^[a-z0-9][a-z0-9._]{0,99}$")

# subscriptionsv2 subscriptionState values.
_ENTITLED_STATES = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_CANCELED"}
_PENDING_STATES = {"SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED"}
_ENDED_STATES = {"SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_EXPIRED"}
_GRACE_STATE = "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"

# HTTP statuses from Google that mean "this token will never verify": the
# message is acknowledged, not retried forever.
_PERMANENT_API_STATUSES = {400, 404, 410}


_REFUSAL_MESSAGES = {
    "account_mismatch": "This purchase belongs to a different account.",
    "unmapped_account": "This purchase could not be matched to your account.",
    "token_not_found": "This purchase could not be found.",
    "grant_refused": "This purchase could not be applied.",
}
_DEFAULT_REFUSAL = "This purchase could not be verified."


def refusal_message(code: str) -> str:
    """The user-safe sentence for a refusal code (never exception text)."""
    return _REFUSAL_MESSAGES.get(code, _DEFAULT_REFUSAL)


class PlayRefused(Exception):
    """A purchase cannot be verified or mapped (permanent). `code` is a short
    machine reason; refusal_message(code) is the user-safe sentence for the
    client path."""

    def __init__(self, code: str, message: str | None = None):
        super().__init__(code)
        self.code = code
        self.message = message or refusal_message(code)


class PlayUnavailable(Exception):
    """A transient failure (Google API, database): retry later."""


class PlayNotEnabled(Exception):
    """Play billing is switched off or incompletely configured (503)."""


# The client's "purchase finished" call and Google's notification for the same
# purchase arrive within milliseconds of each other, so the same token is often
# processed twice at once. This serialises work per token inside one process
# (the API runs a single uvicorn worker today). Across replicas the guarantees
# are the idempotent ones: the subscription upsert, the acknowledge re-check
# and the seam's pack dedupe on the order id.
_token_locks: dict[str, list] = {}


@contextlib.asynccontextmanager
async def _token_lock(token: str):
    entry = _token_locks.get(token)
    if entry is None:
        entry = _token_locks[token] = [asyncio.Lock(), 0]
    entry[1] += 1
    try:
        async with entry[0]:
            yield
    finally:
        entry[1] -= 1
        if entry[1] == 0:
            _token_locks.pop(token, None)


def _now() -> datetime:
    return datetime.now(timezone.utc)  # naive-ok: aware instant for persisted audit stamps and comparisons


def play_enabled() -> bool:
    """Everything a purchase and its verification need is configured. The
    receiver's own authentication is checked separately (receiver_auth_mode)."""
    return bool(
        play_config.PLAY_IAP_ENABLED
        and play_config.PLAY_PACKAGE_NAME
        and play_config.PLAY_ACCOUNT_ID_SALT
        and google_play.service_account_configured()
    )


def catalogue() -> dict[str, StoreProduct]:
    return build_catalogue(play_config.PLAY_PRODUCT_IDS)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _valid_token(token) -> str:
    if not isinstance(token, str) or not _TOKEN_RE.match(token):
        raise PlayRefused("bad_token", "This purchase could not be verified.")
    return token


def _valid_product(product_id) -> str:
    if not isinstance(product_id, str) or not _PRODUCT_RE.match(product_id):
        raise PlayRefused("bad_product", "This purchase could not be verified.")
    return product_id


def parse_rfc3339(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        text = value.strip().replace("Z", "+00:00")
        # Play sends nanosecond fractions; datetime handles at most six.
        text = re.sub(r"(\.\d{6})\d+", r"\1", text)
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# ── Account ids (obfuscatedAccountId) ────────────────────────────────────────

def account_id_for(uid: str) -> str:
    """The obfuscatedAccountId for `uid`: a salted sha256 (64 hex chars, the
    most Play accepts), never the email. Needs PLAY_ACCOUNT_ID_SALT."""
    salt = play_config.PLAY_ACCOUNT_ID_SALT
    if not salt:
        raise PlayNotEnabled("no account id salt configured")
    return hashlib.sha256(f"{salt}:{uid}".encode()).hexdigest()


async def get_or_create_account_id(uid: str) -> str:
    from app.db.collections import play_account_ids_col

    doc = await play_account_ids_col.find_one({"user_id": uid})
    if doc and doc.get("account_id"):
        return doc["account_id"]
    account_id = account_id_for(uid)
    try:
        await play_account_ids_col.insert_one({"user_id": uid, "account_id": account_id, "created_at": _now()})
    except DuplicateKeyError:
        doc = await play_account_ids_col.find_one({"user_id": uid})
        if doc and doc.get("account_id"):
            return doc["account_id"]
        raise
    return account_id


async def uid_for_account_id(account_id) -> str | None:
    from app.db.collections import play_account_ids_col

    if not isinstance(account_id, str) or not account_id:
        return None
    doc = await play_account_ids_col.find_one({"account_id": account_id})
    return doc.get("user_id") if doc else None


# ── Developer API access with failure classification ─────────────────────────

async def _api_call(coro):
    """Await a PlayApi call; a permanent Google status becomes PlayRefused, a
    transient one PlayUnavailable. Never lets a raw error (which could carry
    request detail) escape."""
    try:
        return await coro
    except PlayApiError as exc:
        if exc.status in _PERMANENT_API_STATUSES:
            raise PlayRefused("token_not_found", "This purchase could not be found.")
        logger.warning("play billing: developer api call failed (status %s)", exc.status)
        raise PlayUnavailable("play api unavailable")
    except google_play.PlayNotConfigured:
        raise PlayNotEnabled("no service account configured")


# ── Subscription mapping ─────────────────────────────────────────────────────

@dataclass(frozen=True)
class SubscriptionMapping:
    action: str                       # "upsert" | "past_due" | "expired" | "pending"
    status: str | None = None         # for upsert: "active" | "trialing"
    expires_at: datetime | None = None
    cancel_at_period_end: bool = False
    trial_ends_at: datetime | None = None
    trial_started_at: datetime | None = None
    grace_until: datetime | None = None
    trial_reason: str | None = None   # why trialing was (or was not) chosen, for the C34 log line


def _offer_details(line: dict) -> dict:
    """lineItems[].offerDetails: {basePlanId, offerId, offerTags}. Absent for
    a purchase on a base plan with no offer."""
    details = line.get("offerDetails")
    return details if isinstance(details, dict) else {}


def _trial_decision(sub: dict, line: dict, start: datetime | None, expiry: datetime, now: datetime) -> tuple[bool, str]:
    """Trialing is decided by the offer alone (C34): offerDetails.offerId equals
    PLAY_TRIAL_OFFER_ID, or offerTags carries it. The trial length is NOT
    checked: on the accelerated tester clock the phase lasts minutes. A start
    far outside the configured trial window is only logged."""
    trial_id = play_config.PLAY_TRIAL_OFFER_ID
    if not trial_id:
        return False, "no_trial_offer_configured"
    details = _offer_details(line)
    offer_id = details.get("offerId")
    tags = details.get("offerTags")
    tags = [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else []
    if offer_id == trial_id:
        reason = "offer_id_match"
    elif trial_id in tags:
        reason = "offer_tag_match"
    elif offer_id:
        return False, "offer_id_differs"
    else:
        return False, "no_offer_id"
    if start is not None and now >= start + timedelta(days=SUBSCRIPTION_TRIAL_DAYS + 1):
        logger.warning(
            "play billing: trial offer %r seen more than %d days after the start; still treated as trialing",
            trial_id, SUBSCRIPTION_TRIAL_DAYS + 1,
        )
    return True, reason


def _line_item(sub: dict, products: dict[str, StoreProduct]) -> dict:
    items = sub.get("lineItems")
    if not isinstance(items, list) or not items:
        raise PlayRefused("no_line_item")
    for item in items:
        if isinstance(item, dict) and item.get("productId") in products:
            return item
    raise PlayRefused("unknown_product", "This purchase could not be verified.")


def map_subscription(sub: dict, line: dict, now: datetime) -> SubscriptionMapping:
    """subscriptionsv2 state to the seam's vocabulary (docs/pricing/
    store-billing-c13.md section 9). Unknown states fail closed to "expired"."""
    state = sub.get("subscriptionState")
    expiry = parse_rfc3339(line.get("expiryTime"))
    if state in _PENDING_STATES:
        return SubscriptionMapping("pending")
    if state == _GRACE_STATE:
        # Payment declined, access continues to the end of the grace period.
        return SubscriptionMapping("past_due", expires_at=expiry, grace_until=expiry)
    if state in _ENDED_STATES:
        return SubscriptionMapping("expired", expires_at=expiry)
    if state in _ENTITLED_STATES:
        if state == "SUBSCRIPTION_STATE_CANCELED" and (expiry is None or expiry <= now):
            return SubscriptionMapping("expired", expires_at=expiry)
        if expiry is None:
            raise PlayRefused("no_expiry")
        start = parse_rfc3339(sub.get("startTime"))
        in_trial, trial_reason = _trial_decision(sub, line, start, expiry, now)
        auto_renew = (line.get("autoRenewingPlan") or {}).get("autoRenewEnabled")
        cancelled = state == "SUBSCRIPTION_STATE_CANCELED" or auto_renew is False
        return SubscriptionMapping(
            "upsert", status="trialing" if in_trial else "active", expires_at=expiry,
            cancel_at_period_end=cancelled,
            trial_ends_at=expiry if in_trial else None,
            trial_started_at=start if in_trial else None,
            trial_reason=trial_reason,
        )
    logger.warning("play billing: unrecognised subscription state %r, failing closed", state)
    return SubscriptionMapping("expired", expires_at=expiry)


def _check_test_purchase(is_test: bool) -> None:
    if is_test and not play_config.PLAY_ALLOW_TEST_PURCHASES:
        raise PlayRefused("test_purchase", "This purchase could not be verified.")


async def _resolve_account(account_id, expected_uid: str | None) -> str:
    uid = await uid_for_account_id(account_id)
    if uid is None:
        raise PlayRefused("unmapped_account", "This purchase could not be matched to your account.")
    if expected_uid is not None and uid != expected_uid:
        raise PlayRefused("account_mismatch", "This purchase belongs to a different account.")
    return uid


async def _purchase_doc(token: str) -> dict | None:
    from app.db.collections import play_purchases_col

    return await play_purchases_col.find_one({"purchase_token": token})


async def _save_purchase(token: str, uid: str, fields: dict) -> None:
    """Insert-or-update the dedupe document for `token`. The unique index on
    purchase_token makes the insert atomic, so two racing first deliveries
    cannot create two documents."""
    from app.db.collections import play_purchases_col

    now = _now()
    existing = await play_purchases_col.find_one({"purchase_token": token})
    if existing is None:
        try:
            await play_purchases_col.insert_one(
                {"purchase_token": token, "user_id": uid, "created_at": now, "updated_at": now, **fields}
            )
            return
        except DuplicateKeyError:
            pass
    await play_purchases_col.update_one(
        {"purchase_token": token}, {"$set": {"updated_at": now, **fields}},
    )


async def process_subscription(token, *, expected_uid: str | None = None, expected_product_id: str | None = None) -> dict:
    token = _valid_token(token)
    async with _token_lock(token):
        return await _process_subscription(token, expected_uid=expected_uid, expected_product_id=expected_product_id)


def _log_verified_purchase(sub: dict, line: dict, mapping: SubscriptionMapping) -> None:
    """One INFO line per verified subscription purchase (C34). Never the
    purchase token, the obfuscated account id or the order id."""
    details = _offer_details(line)
    logger.info(
        "play billing: verified subscription product=%s state=%s base_plan=%s offer_id=%s offer_tags=%s "
        "action=%s status=%s trialing=%s trial_reason=%s expiry=%s",
        line.get("productId"), sub.get("subscriptionState"), details.get("basePlanId"), details.get("offerId"),
        details.get("offerTags"), mapping.action, mapping.status, mapping.status == "trialing",
        mapping.trial_reason, line.get("expiryTime"),
    )


async def _process_subscription(token: str, *, expected_uid: str | None, expected_product_id: str | None) -> dict:
    """Verify one subscription purchase token against the Developer API and
    apply the state it reports. Used by the RTDN receiver (expected_uid None:
    the account comes from the purchase) and by the client's verify call
    (expected_uid is the signed-in user, who must own the purchase)."""
    products = catalogue()
    api = google_play.get_play_api()
    signed_at = _now()
    sub = await _api_call(api.get_subscription_v2(play_config.PLAY_PACKAGE_NAME, token))
    if not isinstance(sub, dict):
        raise PlayRefused("bad_reply")
    line = _line_item(sub, products)
    product = products[line["productId"]]
    if product.kind != "subscription":
        raise PlayRefused("unknown_product")
    if expected_product_id is not None and expected_product_id != line["productId"]:
        # The client named one product and Google says the token is another:
        # refused, never granted, and recorded (ids only, no user data).
        logger.warning("play billing: client product %r does not match purchased product %r", expected_product_id, line["productId"])
        raise PlayRefused("product_mismatch")
    _check_test_purchase(sub.get("testPurchase") is not None)
    ids = sub.get("externalAccountIdentifiers") or {}
    uid = await _resolve_account(ids.get("obfuscatedExternalAccountId"), expected_uid)

    stored = await _purchase_doc(token)
    if stored and stored.get("user_id") not in (None, uid):
        raise PlayRefused("account_mismatch", "This purchase belongs to a different account.")

    sid = token_digest(token)
    mapping = map_subscription(sub, line, signed_at)
    _log_verified_purchase(sub, line, mapping)
    if stored and stored.get("voided_at"):
        # A voided purchase never comes back, whatever a later read says.
        mapping = SubscriptionMapping("expired", expires_at=mapping.expires_at)

    linked = sub.get("linkedPurchaseToken")
    play_double = mapping.action in ("upsert", "past_due") and await _is_play_double(uid, sid, linked)

    result: dict = {"handled": False, "reason": "pending purchase, nothing to grant yet"}
    if mapping.action == "upsert":
        result = await store_subscriptions.upsert_store_subscription(
            uid, PROVIDER, tier=product.tier, billing_period=product.billing_period, status=mapping.status,
            expires_at=mapping.expires_at, provider_subscription_id=sid,
            trial_ends_at=mapping.trial_ends_at, trial_started_at=mapping.trial_started_at,
            cancel_at_period_end=mapping.cancel_at_period_end, signed_at=signed_at,
        )
    elif mapping.action == "past_due":
        result = await _apply_past_due(uid, product, sid, mapping, signed_at)
    elif mapping.action == "expired":
        extra = {"revoked": True} if (stored and stored.get("voided_at")) else None
        result = await store_subscriptions.set_store_subscription_status(
            uid, PROVIDER, sid, "expired", signed_at=signed_at, extra=extra,
        )

    if play_double:
        # Google has taken the money for a second live subscription: granted
        # (the user paid), flagged so a human can refund one, and the client
        # is told so it points at Google Play.
        from app.db.collections import subscriptions_col
        await subscriptions_col.update_one(
            {"user_id": uid, "provider": PROVIDER},
            {"$set": {"double_subscription": True, "play_double_subscription": True}},
        )
        result["double_subscription"] = True
        logger.warning("play billing: second live Play subscription granted and flagged")

    # Record the purchase and, only for an entitled one, acknowledge it.
    fields = {
        "kind": "subscription", "product_id": line["productId"], "state": sub.get("subscriptionState"),
        "order_id": sub.get("latestOrderId"),
    }
    if isinstance(linked, str) and _TOKEN_RE.match(linked):
        fields["linked_purchase_token"] = linked
        await _supersede(linked)
    await _save_purchase(token, uid, fields)

    if mapping.action in ("upsert", "past_due"):
        result["acknowledged"] = await _acknowledge_subscription(sub, line, token)
    result.setdefault("uid", uid)
    result["state"] = sub.get("subscriptionState")
    return result


def _doc_is_live(doc: dict | None) -> bool:
    from app.core.timeutil import as_utc

    if not doc or doc.get("status") not in store_subscriptions.LIVE_STATUSES:
        return False
    if doc.get("status") == "past_due":
        until = as_utc(doc.get("grace_until"))
        return until is None or until > _now()
    expires = as_utc(doc.get("expires_at"))
    return expires is None or expires > _now()


async def _is_play_double(uid: str, sid: str, linked) -> bool:
    """True when this purchase is a second live Play subscription: the user
    already has a live provider=google document for a DIFFERENT purchase token
    and this one does not name it as the purchase it replaces. A flag already
    raised for this same purchase stays raised across renewals."""
    from app.db.collections import subscriptions_col

    existing = await subscriptions_col.find_one({"user_id": uid, "provider": PROVIDER})
    if not existing:
        return False
    if existing.get("provider_subscription_id") == sid:
        return bool(existing.get("play_double_subscription"))
    if not _doc_is_live(existing):
        return False
    replaces = isinstance(linked, str) and token_digest(linked) == existing.get("provider_subscription_id")
    return not replaces


async def _apply_past_due(uid, product, sid, mapping, signed_at) -> dict:
    from app.db.collections import subscriptions_col

    existing = await subscriptions_col.find_one({"user_id": uid, "provider": PROVIDER})
    if not existing or existing.get("provider_subscription_id") != sid:
        # First sight of this purchase is already in grace: create it live,
        # then mark it past_due so the grace window is the seam's own.
        await store_subscriptions.upsert_store_subscription(
            uid, PROVIDER, tier=product.tier, billing_period=product.billing_period, status="active",
            expires_at=mapping.expires_at, provider_subscription_id=sid, signed_at=signed_at,
        )
    return await store_subscriptions.set_store_subscription_status(
        uid, PROVIDER, sid, "past_due", signed_at=signed_at, grace_until=mapping.grace_until,
    )


async def _supersede(old_token: str) -> None:
    """An upgrade, downgrade or resubscribe names the purchase it replaces
    (linkedPurchaseToken). Mark it so a late event for it is recognised."""
    from app.db.collections import play_purchases_col

    await play_purchases_col.update_one(
        {"purchase_token": old_token}, {"$set": {"superseded_at": _now()}},
    )


async def _acknowledge_subscription(sub: dict, line: dict, token: str) -> bool:
    """Acknowledge once. Returns True when the purchase is acknowledged (now
    or already). A failed call is re-checked against the API before it is
    treated as a failure, because Google rejects a second acknowledge."""
    from app.db.collections import play_purchases_col

    stored = await _purchase_doc(token)
    if (stored and stored.get("acknowledged_at")) or sub.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED":
        if stored and not stored.get("acknowledged_at"):
            await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"acknowledged_at": _now()}})
        return True
    api = google_play.get_play_api()
    package = play_config.PLAY_PACKAGE_NAME
    try:
        await api.acknowledge_subscription(package, line["productId"], token)
    except PlayApiError:
        again = await _api_call(api.get_subscription_v2(package, token))
        if again.get("acknowledgementState") != "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED":
            raise PlayUnavailable("acknowledge failed")
    await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"acknowledged_at": _now()}})
    return True


# ── One-time products (Penny packs) ──────────────────────────────────────────

async def process_pack(token, product_id, *, expected_uid: str | None = None) -> dict:
    token = _valid_token(token)
    async with _token_lock(token):
        return await _process_pack(token, product_id, expected_uid=expected_uid)


async def _process_pack(token: str, product_id, *, expected_uid: str | None) -> dict:
    """Verify one consumable purchase, grant it once, then consume it."""
    from app.db.collections import play_purchases_col

    product_id = _valid_product(product_id)
    product = catalogue().get(product_id)
    if product is None or product.kind != "pack":
        raise PlayRefused("unknown_product", "This purchase could not be verified.")
    api = google_play.get_play_api()
    package = play_config.PLAY_PACKAGE_NAME
    purchase = await _api_call(api.get_product(package, product_id, token))
    if not isinstance(purchase, dict):
        raise PlayRefused("bad_reply")
    if purchase.get("productId") not in (None, product_id):
        raise PlayRefused("unknown_product")
    # purchaseType 0 is a licence-tester purchase.
    _check_test_purchase(purchase.get("purchaseType") == 0)
    uid = await _resolve_account(purchase.get("obfuscatedExternalAccountId"), expected_uid)

    stored = await _purchase_doc(token)
    if stored and stored.get("user_id") not in (None, uid):
        raise PlayRefused("account_mismatch", "This purchase belongs to a different account.")
    state = purchase.get("purchaseState")
    if state != 0:
        # 1 cancelled, 2 pending: nothing granted, nothing acknowledged.
        return {"handled": False, "reason": "purchase is not in the purchased state", "uid": uid}
    if stored and stored.get("voided_at"):
        return {"handled": False, "reason": "purchase was voided", "uid": uid}

    transaction_id = purchase.get("orderId") or token_digest(token)
    await _save_purchase(token, uid, {
        "kind": "pack", "product_id": product_id, "order_id": purchase.get("orderId"),
        "pack_kind": product.pack_kind, "pack_id": product.pack_id, "transaction_id": transaction_id,
        "state": "purchased",
    })
    stored = await _purchase_doc(token)

    result = {"handled": True, "action": "grant_pack", "uid": uid,
              "pack_kind": product.pack_kind, "pack_id": product.pack_id, "duplicate": True}
    if not (stored and stored.get("granted_at")):
        granted = await store_subscriptions.grant_store_pack(uid, PROVIDER, product.pack_kind, product.pack_id, transaction_id)
        if granted.get("handled") is False:
            raise PlayRefused("grant_refused", "This purchase could not be applied.")
        await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"granted_at": _now()}})
        result["duplicate"] = granted.get("duplicate", False)
        stored = await _purchase_doc(token)

    result["consumed"] = await _consume_pack(purchase, product_id, token, stored)
    return result


async def _consume_pack(purchase: dict, product_id: str, token: str, stored: dict | None) -> bool:
    """Consume after granting, once. Consuming also acknowledges. A failed
    call is re-read: already consumed counts as done."""
    from app.db.collections import play_purchases_col

    if (stored and stored.get("consumed_at")) or purchase.get("consumptionState") == 1:
        if stored and not stored.get("consumed_at"):
            await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"consumed_at": _now()}})
        return True
    api = google_play.get_play_api()
    package = play_config.PLAY_PACKAGE_NAME
    try:
        await api.consume_product(package, product_id, token)
    except PlayApiError:
        again = await _api_call(api.get_product(package, product_id, token))
        if again.get("consumptionState") != 1:
            # Granted but not consumed: left for the next client sync or
            # redelivery, which will find granted_at set and only consume.
            raise PlayUnavailable("consume failed")
    await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"consumed_at": _now()}})
    return True


# ── Voided purchases (refunds, chargebacks, revocation) ──────────────────────

async def process_voided(token, *, order_id: str | None = None) -> dict:
    token = _valid_token(token)
    async with _token_lock(token):
        return await _process_voided(token, order_id=order_id)


async def _process_voided(token: str, *, order_id: str | None) -> dict:
    """A purchase Google says was voided. Resolved only through a token this
    server has already verified and stored (play_purchases_col): a token it
    never saw is ignored, so a message cannot target an arbitrary account.
    A voided subscription loses entitlement at once. A voided consumable is
    recorded against the user and, only when IAP_REFUND_CLAWBACK is on, has
    its remaining balance zeroed (Kevin's open decision, default off)."""
    from app.db.collections import play_purchases_col

    stored = await _purchase_doc(token)
    if stored is None:
        return {"handled": False, "reason": "purchase token not on file"}
    uid = stored.get("user_id")
    now = _now()
    if stored.get("kind") == "pack":
        outcome = await store_subscriptions.record_store_pack_refund(
            PROVIDER, stored.get("pack_kind") or "penny", stored.get("transaction_id") or token_digest(token),
            clawback=bool(config.IAP_REFUND_CLAWBACK),
        )
        result = {"handled": True, "action": "pack_refund", "uid": uid, "pack_kind": stored.get("pack_kind"),
                  "pack_id": stored.get("pack_id"), "order_id": order_id or stored.get("order_id"), **outcome}
    else:
        result = await store_subscriptions.set_store_subscription_status(
            uid, PROVIDER, token_digest(token), "expired", signed_at=now, extra={"revoked": True},
        )
        result.setdefault("action", "subscription_revoked")
        result["voided"] = True
    await play_purchases_col.update_one({"purchase_token": token}, {"$set": {"voided_at": now, "updated_at": now}})
    return result


async def reconcile_voided(*, since: datetime, max_pages: int = 10) -> dict:
    """Sweep the Voided Purchases API from `since` and revoke each voided
    purchase this server knows about. A safety net for a missed RTDN: safe to
    run repeatedly (process_voided is idempotent). Not scheduled by default;
    docs/pricing/store-billing-c13.md says how Kevin can run it."""
    api = google_play.get_play_api()
    package = play_config.PLAY_PACKAGE_NAME
    start_ms = int(since.timestamp() * 1000)
    page = None
    seen = revoked = 0
    for _ in range(max_pages):
        reply = await _api_call(api.list_voided(package, start_time_ms=start_ms, page_token=page))
        for item in reply.get("voidedPurchases") or []:
            token = item.get("purchaseToken")
            if not isinstance(token, str) or not _TOKEN_RE.match(token):
                continue
            seen += 1
            stored = await _purchase_doc(token)
            if stored is None or stored.get("voided_at"):
                continue
            await process_voided(token, order_id=item.get("orderId"))
            revoked += 1
        page = (reply.get("tokenPagination") or {}).get("nextPageToken")
        if not page:
            break
    return {"seen": seen, "revoked": revoked}


# ── RTDN envelope ────────────────────────────────────────────────────────────

def decode_pubsub_push(body: dict) -> tuple[str, dict]:
    """(messageId, DeveloperNotification) from a Pub/Sub push body, or
    PlayRefused. Anything that is not exactly that shape is refused."""
    import base64
    import json

    message = body.get("message") if isinstance(body, dict) else None
    if not isinstance(message, dict):
        raise PlayRefused("malformed")
    message_id = message.get("messageId") or message.get("message_id")
    data = message.get("data")
    if not isinstance(message_id, str) or not message_id or not isinstance(data, str):
        raise PlayRefused("malformed")
    try:
        decoded = json.loads(base64.b64decode(data, validate=True).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise PlayRefused("malformed")
    if not isinstance(decoded, dict):
        raise PlayRefused("malformed")
    if decoded.get("packageName") != play_config.PLAY_PACKAGE_NAME:
        raise PlayRefused("wrong_package")
    return message_id, decoded


async def handle_notification(notification: dict) -> dict:
    """Dispatch one decoded DeveloperNotification. The notification type
    never decides the outcome: the purchase is re-read from the API."""
    sub_n = notification.get("subscriptionNotification")
    one_n = notification.get("oneTimeProductNotification")
    void_n = notification.get("voidedPurchaseNotification")
    if isinstance(sub_n, dict):
        return await process_subscription(sub_n.get("purchaseToken"))
    if isinstance(one_n, dict):
        if one_n.get("notificationType") == 1:  # ONE_TIME_PRODUCT_PURCHASED
            return await process_pack(one_n.get("purchaseToken"), one_n.get("sku"))
        return {"handled": False, "reason": "one-time product notification needs no action"}
    if isinstance(void_n, dict):
        return await process_voided(void_n.get("purchaseToken"), order_id=void_n.get("orderId"))
    if isinstance(notification.get("testNotification"), dict):
        return {"handled": True, "action": "test_notification"}
    return {"handled": False, "reason": "unrecognised notification"}


async def handle_push(body: dict) -> dict:
    """Process one authenticated Pub/Sub push: decode, claim the message in
    the ledger (replays answer from it), dispatch, store the result. A
    permanent refusal is recorded and acknowledged (200); a transient
    failure propagates so the router answers 503 and Pub/Sub redelivers."""
    message_id, notification = decode_pubsub_push(body)
    kind = next((k for k in ("subscriptionNotification", "oneTimeProductNotification",
                             "voidedPurchaseNotification", "testNotification") if k in notification), "unknown")
    state, existing = await store_subscriptions.claim_event(PROVIDER, message_id, kind)
    if state == "replay":
        return {"ok": True, "idempotent": True, "result": (existing or {}).get("result")}
    try:
        result = await handle_notification(notification)
    except PlayRefused as exc:
        result = {"handled": False, "reason": exc.code}
        logger.warning("play billing: %s notification refused (%s)", kind, exc.code)
    await store_subscriptions.finish_event(PROVIDER, message_id, result)
    return {"ok": True, "result": result}


# ── Client-facing ────────────────────────────────────────────────────────────

def client_product_ids() -> dict[str, str]:
    # Legacy aliases (sorted.max.*) share keys with the real Plus products and
    # are never offered, so they are excluded here, with PLAY_PRODUCT_IDS
    # overrides still applied (C33).
    return product_ids_by_key(play_config.PLAY_PRODUCT_IDS)


async def client_config(uid: str) -> dict:
    """What the Android client needs to buy: the product ids (from config,
    never hard-coded in the app), the account id to set as the purchase's
    obfuscatedAccountId, and a reason when buying is not allowed right now
    (an active web subscription already covers the user)."""
    if not play_enabled():
        return {"enabled": False}
    blocked = None
    try:
        await store_subscriptions.validate_store_purchase(uid)
    except store_subscriptions.StorePurchaseRefused as exc:
        blocked = str(exc)
    return {
        "enabled": True,
        "package_name": play_config.PLAY_PACKAGE_NAME,
        "products": client_product_ids(),
        "account_id": await get_or_create_account_id(uid),
        "purchase_blocked": blocked,
        # A live Play subscription is changed or cancelled in Google Play, not
        # by buying a second one on top (the plugin cannot send Play's
        # replacement mode, so a second purchase would charge twice). Packs
        # are unaffected.
        "subscription_managed_in_play": await _has_live_play_subscription(uid),
    }


async def _has_live_play_subscription(uid: str) -> bool:
    from app.db.collections import subscriptions_col

    return _doc_is_live(await subscriptions_col.find_one({"user_id": uid, "provider": PROVIDER}))


async def verify_client_purchase(uid: str, token, product_id) -> dict:
    """The client says a purchase finished (or is restoring one). Only the
    token and product id are used, as lookup keys: the Developer API answer
    decides everything, and the purchase must belong to `uid`."""
    if not play_enabled():
        raise PlayNotEnabled("play billing is not enabled")
    product = catalogue().get(product_id) if isinstance(product_id, str) else None
    if product is None:
        raise PlayRefused("unknown_product", "This purchase could not be verified.")
    if product.kind == "subscription":
        result = await process_subscription(token, expected_uid=uid, expected_product_id=product_id)
    else:
        result = await process_pack(token, product_id, expected_uid=uid)
    return {k: v for k, v in result.items() if k in ("handled", "action", "tier", "status", "pack_id", "acknowledged", "consumed", "reason", "double_subscription")}
