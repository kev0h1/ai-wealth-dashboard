"""D9: let an Apple Hide My Email invite be CLAIMED rather than matched.

Sign-up is closed in production, so app/core/identity.py's resolver refuses
any sign-in whose verified email is not allow-listed. A
`...@privaterelay.appleid.com` relay address can never be allow-listed in
advance because nobody knows it until the first sign-in, so an invited
tester who taps Apple's "Hide My Email" option is turned away even though
their real address is on the list.

app/routers/auth.py's apple_native() already knows, at the moment it
refuses such a sign-in, the one fact that matters: Apple's own signature
just verified this specific `sub` belongs to a real Apple account. This
module lets that fact survive past the refusal so a second step (path 2:
"enter your invited address, we'll email you a code") can attach the `sub`
to the invitation the code proves the caller controls, without ever
letting the caller simply NAME an arbitrary allow-listed address (path 2's
whole security property — see verify_code's docstring).

Two independent pieces of state, both server-held, neither trusting the
client to carry the truth:

  1. The claim token — carries `sub` (and the relay email claim, for the
     audit trail) from the refused sign-in to the send-code/verify-code
     calls. Signed with itsdangerous under its OWN salt (distinct from the
     plain session-token serializer in app.core.config), so it can never be
     replayed as a session token or vice versa even though both ultimately
     derive from SESSION_SECRET, and a tampered payload fails verification
     rather than silently deserialising. Stateless by design — no DB row,
     nothing to leak or clean up — mirroring how a session token itself is
     just a signed, timed blob, not an opaque id sent for the server to look
     up. This is NOT the mobile OAuth "pending" hand-off pattern in
     app.core.pending_login (server-stored ephemeral RESULT for a poll to
     collect once, keyed by a bare client-supplied `state`): there is no
     result to hand off here, only a fact (`sub`, already provider-verified)
     that must survive a few minutes of user interaction without becoming
     forgeable. Bounded by RELAY_CLAIM_TOKEN_TTL_SECONDS at load time via
     itsdangerous's own `max_age`, same mechanism SESSION_MAX_AGE uses.

  2. The code record (`allowed_relay_codes_col`) — a short-lived, single-use,
     attempt-limited verification code, the actual auth-code security
     surface: constant-time compared, hashed at rest, invalidated on use,
     capped attempts, one live code per (sub, target invitation) pair.

Does this codebase have a transactional email sender? No — grepped the
whole backend (smtplib, sendgrid, mailgun, postmark, resend, ses, and
requirements.txt) and found nothing that sends outbound email at all.
`send_relay_claim_code` below is therefore a deliberate, clearly-marked
seam: it generates and stores the code exactly as production would, but
its actual delivery is a documented no-op that only logs (never the code
itself) that a code was generated with nowhere to send it. Tests replace
this one function to capture the plaintext code, the same way
app.routers.auth._get_apple_jwks is monkeypatched instead of faking HTTP.
Path 2 is not usable end-to-end in production until a real sender exists
behind this seam.
"""
import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import SESSION_SECRET, _gmail_key, mask_email
from app.db.collections import allowed_relay_codes_col, allowed_signups_col

logger = logging.getLogger(__name__)

# Distinct salt from app.core.config.serializer (plain session tokens) —
# see module docstring. Same SESSION_SECRET (so it rotates/persists exactly
# like every other signed token in this codebase, no new secret to manage),
# different salt makes the two token kinds cryptographically unrelated: a
# claim token can never verify as a session token or vice versa.
_CLAIM_SALT = "apple-relay-claim"
_claim_serializer = URLSafeTimedSerializer(SESSION_SECRET, salt=_CLAIM_SALT)

# Long enough to read an email and type in a 6-digit code without racing a
# session-length timer, short enough that a leaked/logged claim token isn't
# useful for long. The per-code TTL below (CODE_TTL_SECONDS) is the tighter,
# actually-security-relevant bound; this is just how long the "you're mid
# claim" fact survives at all.
RELAY_CLAIM_TOKEN_TTL_SECONDS = 30 * 60

CODE_TTL_SECONDS = 10 * 60
CODE_MAX_ATTEMPTS = 5
_CODE_DIGITS = 6


def mint_claim_token(*, sub: str, relay_email: str) -> str:
    """Sign the verified `sub` (+ the relay email claim, kept only for the
    audit trail on the eventual link doc) into an opaque token the client
    carries through path 2. Never includes anything the client didn't
    already see verified: this is Apple's own `sub`, not a client claim."""
    return _claim_serializer.dumps({
        "kind": "apple_relay_claim",
        "sub": sub,
        "relay_email": relay_email,
    })


def load_claim_token(token: str) -> dict | None:
    """Verify and decode a claim token, or None if it's missing, malformed,
    wrongly-salted, tampered, or expired. Never raises — every caller in
    this flow treats "no valid claim" as a plain refusal."""
    if not token:
        return None
    try:
        data = _claim_serializer.loads(token, max_age=RELAY_CLAIM_TOKEN_TTL_SECONDS)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict) or data.get("kind") != "apple_relay_claim" or not data.get("sub"):
        return None
    return data


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _generate_code() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(_CODE_DIGITS))


def _doc_id(sub: str, target_email: str) -> str:
    return f"relay:{sub}:{_gmail_key(target_email)}"


async def send_relay_claim_code(*, sub: str, target_email: str) -> None:
    """Generate a fresh code for (sub, target_email), store it (overwriting
    any live code for the same pair, invalidating it), and attempt delivery.

    `target_email` must already be the allow-listed spelling resolved by the
    caller (app.core.allowlist.resolve_allowed_signup) — this function does
    not itself check the allow list, so it must never be reachable with an
    address the caller hasn't already confirmed is genuinely invited (see
    routers/auth.py's send_relay_claim_code_endpoint).
    """
    code = _generate_code()
    now = datetime.now(timezone.utc)
    doc_id = _doc_id(sub, target_email)
    await allowed_relay_codes_col.update_one(
        {"_id": doc_id},
        {"$set": {
            "_id": doc_id,
            "sub": sub,
            "target_email": target_email,
            "target_key": _gmail_key(target_email),
            "code_hash": _hash_code(code),
            "attempts": 0,
            "max_attempts": CODE_MAX_ATTEMPTS,
            "created_at": now,
            "expires_at": now + timedelta(seconds=CODE_TTL_SECONDS),
            "used_at": None,
        }},
        upsert=True,
    )
    await _deliver_code(target_email, code)


async def _deliver_code(target_email: str, code: str) -> None:
    """The send seam. No transactional email sender exists in this codebase
    today (see module docstring) — this deliberately never delivers the
    code anywhere, and deliberately never logs the plaintext code. Tests
    monkeypatch this function directly to capture `code` instead of
    exercising a real send path."""
    logger.warning(
        "send_relay_claim_code: no email sender configured (D9) — code "
        "generated for %s but NOT delivered; path 2 is not usable until a "
        "real sender is wired in behind this seam",
        mask_email(target_email),
    )


class ClaimOutcome:
    OK = "ok"
    NOT_FOUND = "not_found"
    EXPIRED = "expired"
    USED = "used"
    LOCKED = "locked"
    WRONG_CODE = "wrong_code"


async def verify_relay_code(*, sub: str, target_email: str, code: str) -> str:
    """Check `code` against the live record for (sub, target_email).

    This is the enforcement point for the whole feature's security
    property: a relay `sub` may only ever attach to the invitation whose
    address was verified by a code sent to THAT address, never to an
    arbitrary allow-listed address the caller merely names. The lookup key
    is `_doc_id(sub, target_email)` — a code sent to address A can only ever
    verify against address A; there is no path where verifying a code sent
    to A links `sub` to some other address B, because the record verified
    against IS the record that determines the linked address (callers read
    `target_email` back off the record on ClaimOutcome.OK, they do not reuse
    whatever the request body said).

    Returns one of the ClaimOutcome constants. Never raises for an
    ordinary "wrong/expired/used/locked" outcome — those are refusals, not
    errors, and every branch below responds with the same shape via
    ClaimOutcome so a caller building an HTTP response can't accidentally
    leak WHICH refusal reason applies to an existing-vs-nonexistent record
    (see routers/auth.py's verify endpoint, which folds several of these
    into one generic message).
    """
    doc_id = _doc_id(sub, target_email)
    doc = await allowed_relay_codes_col.find_one({"_id": doc_id})
    if not doc:
        return ClaimOutcome.NOT_FOUND
    if doc.get("used_at"):
        return ClaimOutcome.USED
    expires_at = doc.get("expires_at")
    now = datetime.now(timezone.utc)
    if expires_at is None or _as_aware(expires_at) < now:
        return ClaimOutcome.EXPIRED
    if int(doc.get("attempts", 0)) >= int(doc.get("max_attempts", CODE_MAX_ATTEMPTS)):
        return ClaimOutcome.LOCKED

    supplied_hash = _hash_code(code or "")
    stored_hash = doc.get("code_hash") or ""
    if not hmac.compare_digest(supplied_hash, stored_hash):
        await allowed_relay_codes_col.update_one(
            {"_id": doc_id}, {"$inc": {"attempts": 1}},
        )
        return ClaimOutcome.WRONG_CODE

    await allowed_relay_codes_col.update_one(
        {"_id": doc_id},
        {"$set": {"used_at": now, "code_hash": None}},
    )
    return ClaimOutcome.OK


async def mark_allowlist_claimed(*, target_email: str, sub: str) -> bool:
    """D9: extend the D5 in-app allow-list record (allowed_signups_col) so
    an invitation shows which Apple `sub` claimed it and when — an audit
    trail, not a functional dependency: the actual sign-in resolution keys
    off `linked_identities_col`'s `apple:{sub}` doc (_link_apple_sub above),
    not off this field.

    Best-effort and silent for an address with no in-app allow-list doc at
    all (e.g. one seeded only via the ALLOWED_EMAILS env var) — there is
    nothing to annotate in that case, and that's expected, not an error.
    Returns True if a doc was actually updated."""
    key = _gmail_key(target_email)
    result = await allowed_signups_col.update_one(
        {"key": key},
        {"$set": {"apple_sub": sub, "apple_relay_claimed_at": datetime.now(timezone.utc)}},
    )
    matched = getattr(result, "matched_count", 0) or 0
    return bool(matched)


def _as_aware(value: datetime) -> datetime:
    """Fake Mongo collections in tests may hand back a naive datetime
    (Motor/pymongo return tz-aware UTC for real documents); treat naive as
    UTC so comparisons against datetime.now(timezone.utc) never raise."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
