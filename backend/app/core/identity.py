"""Single identity-resolution path shared by every sign-in handler.

Phase 1 (shipped) let an authenticated user explicitly link an Apple
identity (keyed on the token's stable `sub`) to their existing account via
POST /auth/identities/apple, so a Hide My Email relay address resolves to
the account that linked it instead of looking like a stranger. Phase 2
generalises that idea into one resolver used by ALL four sign-in handlers
(Google native, Apple native, Google mobile callback, Google web callback):

    a. Apple explicit link.  If this is an Apple sign-in and the token's
       `sub` is already linked (`linked_identities_col` doc `apple:{sub}`),
       the linked account wins outright — this reproduces apple_native()'s
       original "resolve through the link before the fresh-claim check"
       behaviour, so linking already proved that account owns this Apple
       identity and the email-alias map is not consulted at all for this
       path.
    b. Email alias.  Otherwise, look up whichever spelling of this email
       first signed in (`linked_identities_col` doc `email:{gmail_key}`,
       Gmail dot-insensitive). If none exists yet, the candidate is simply
       the verified email itself, lowercased.
    c. Allow list.  `resolve_allowed_email()` gets the final say on
       spelling: if the candidate (or a Gmail-key match of it) is on
       ALLOWED_EMAILS, that spelling wins over anything the alias map
       produced.
    d. Gate.  Proceed if the candidate is allow-listed OR OPEN_SIGNUP is on;
       otherwise refuse (masked warning, caller turns this into its usual
       403 / redirect / poll-error shape).
    e. Persist.  On success, record the email alias (first-seen spelling
       only, never overwritten) and, for Apple sign-ins, an automatic
       `apple:{sub}` link (marked `auto: True` so a later EXPLICIT link via
       POST /auth/identities/apple is allowed to re-point it).

Every call site passes only the email its own provider verified for THIS
sign-in (Google's tokeninfo/userinfo response, or the Apple identity
token's own `email` claim) — never anything client-supplied and
unverified. So the email-alias lookup in step (b) can never let a relay
address (or spoofed email) alias itself onto an account it doesn't belong
to: the alias key is always derived from a value the provider itself just
vouched for.
"""
import logging
from datetime import datetime, timezone

from app.core.config import _gmail_key, is_signup_open, mask_email, resolve_allowed_email
from app.db.collections import linked_identities_col

# Apple call sites pass distinct provider labels ("apple-native"); the link
# lookup and the auto-link write both need to recognise "this is an Apple
# sign-in", so check by prefix rather than an exact "apple" match.
_APPLE_PREFIX = "apple"


async def resolve_signin_email(
    provider: str,
    verified_email: str,
    *,
    subject: str | None = None,
    relay: bool = False,
) -> str | None:
    """Resolve a provider's verified email to the account email to sign in
    as, or None if the sign-in should be refused.

    `provider` is a short label used only for logging (e.g. "google-native",
    "apple-native", "google-mobile", "google-web") — see the module
    docstring for the resolution order.
    """
    is_apple = provider.startswith(_APPLE_PREFIX) and bool(subject)
    candidate: str | None = None
    via_explicit_link = False

    if is_apple:
        link = await linked_identities_col.find_one({"_id": f"apple:{subject}"})
        if link:
            candidate = link["user_id"]
            via_explicit_link = True

    if candidate is None:
        # Alias lookup only ever runs against the email THIS provider just
        # verified for THIS sign-in (see module docstring) — there is no
        # code path where an attacker-supplied "verified_email" differs
        # from what the provider actually verified, so this can't be used
        # to alias a relay address onto someone else's account.
        key = _gmail_key(verified_email)
        alias = await linked_identities_col.find_one({"_id": f"email:{key}"})
        candidate = alias["user_id"] if alias else verified_email.lower()

    allowed = resolve_allowed_email(candidate)
    if allowed:
        candidate = allowed

    if not (allowed or is_signup_open()):
        warn_provider = "apple-native-linked" if via_explicit_link else provider
        logging.warning(
            "Sign-in refused by allow list: provider=%s email=%s relay=%s",
            warn_provider, mask_email(candidate), relay,
        )
        return None

    # Record the first-seen spelling of this email as the alias for future
    # sign-ins — never overwrite an existing one, so the account a person
    # first signed in with stays authoritative even if a later sign-in uses
    # a dot-variant spelling.
    key = _gmail_key(verified_email)
    if not await linked_identities_col.find_one({"_id": f"email:{key}"}):
        await linked_identities_col.update_one(
            {"_id": f"email:{key}"},
            {"$set": {
                "_id": f"email:{key}",
                "provider": "email",
                "subject": key,
                "user_id": candidate,
                "linked_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )

    # Auto-link this Apple subject to the resolved account, whether that
    # account is brand new or existing, so a later explicit link (POST
    # /auth/identities/apple) has something it's allowed to re-point.
    if is_apple and not await linked_identities_col.find_one({"_id": f"apple:{subject}"}):
        await linked_identities_col.update_one(
            {"_id": f"apple:{subject}"},
            {"$set": {
                "_id": f"apple:{subject}",
                "provider": "apple",
                "subject": subject,
                "user_id": candidate,
                "email_at_link": verified_email.lower(),
                "relay": relay,
                "auto": True,
                "linked_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )

    return candidate
