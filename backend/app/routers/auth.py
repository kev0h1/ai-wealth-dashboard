"""Auth endpoints: PIN login, Google OAuth, Sign in with Apple, session validation."""
import logging
import time
import urllib.parse
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
import httpx
import jwt
from pydantic import BaseModel
from jwt.algorithms import RSAAlgorithm

from app.core.auth import current_user
from app.core.config import (
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    APPLE_BUNDLE_ID, APPLE_SERVICES_ID,
    APP_URL, PRIMARY_EMAIL, SESSION_MAX_AGE, serializer,
    mask_email,
)
from app.core.identity import resolve_signin_email
from app.core.pending_login import (
    _store_pending,
    has_challenge,
    is_legacy_mobile_state,
    is_valid_mobile_state,
    redeem_pending,
    store_challenge,
)
from app.core.signin_handoff import signin_handoff_csp, signin_handoff_html
from app.core.push import drop_user_push_registrations
from app.core.session_revocation import is_revoked, revoke_sessions
from app.db.collections import linked_identities_col
from app.services.retention import erase_orphaned_relay_account
from itsdangerous import SignatureExpired, BadSignature

router = APIRouter(tags=["auth"])

# Apple's JWKS rotates rarely; cache it in-process rather than refetching on
# every sign-in (same dict-with-timestamp idiom as the APNs JWT cache in
# app/core/push.py). `_get_apple_jwks` is monkeypatched directly in tests
# rather than mocking the HTTP layer.
APPLE_JWKS_URL   = "https://appleid.apple.com/auth/keys"
_APPLE_JWKS_TTL  = 24 * 3600
_apple_jwks_cache: dict = {"keys": None, "fetched_at": 0.0}


async def _get_apple_jwks() -> dict:
    now = time.time()
    if _apple_jwks_cache["keys"] is None or (now - _apple_jwks_cache["fetched_at"]) > _APPLE_JWKS_TTL:
        async with httpx.AsyncClient() as client:
            resp = await client.get(APPLE_JWKS_URL)
        resp.raise_for_status()
        _apple_jwks_cache["keys"] = resp.json()
        _apple_jwks_cache["fetched_at"] = now
    return _apple_jwks_cache["keys"]

# Chrome Custom Tabs won't launch an app-scheme redirect (wealthdash://) from a
# server redirect without a user gesture, so the mobile app can't reliably get
# the token back via a deep link. Instead the app opens login with a one-time
# `state` id and polls for the result; the callback stashes it via
# `_store_pending` keyed by state. Redis-backed (app.core.pending_login) so
# this works across Railway replicas, not a single uvicorn worker.


@router.post("/auth/session/validate")
async def validate_session(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    try:
        data, issued_at = serializer.loads(auth[7:], max_age=SESSION_MAX_AGE, return_timestamp=True)
        name  = data.get("name", "")  if isinstance(data, dict) else ""
        email = data.get("email", "") if isinstance(data, dict) else ""
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")
    # A84: same revocation check as app.core.auth.current_user — this
    # handler decodes the token itself rather than depending on
    # current_user, so without this it was a bypass: AuthProvider.tsx calls
    # this on every app load to decide whether to render the authenticated
    # shell, and a deleted account's token kept coming back valid: true.
    # Fails CLOSED: a tombstone-lookup error must not silently report a
    # possibly-revoked token as valid.
    try:
        if await is_revoked(email, issued_at):
            raise HTTPException(401, "Session expired")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Session check unavailable")
    # Web-only product lock (A10): the frontend needs to tell the owner's
    # account apart from any other authorised sign-in so it can keep the
    # full product reachable for the owner while everyone else gets the
    # "Sorted is an app" shell when NEXT_PUBLIC_WEB_PRODUCT=off.
    owner = email.strip().lower() == PRIMARY_EMAIL
    return {"valid": True, "name": name, "email": email, "owner": owner}


@router.post("/auth/logout")
async def logout(user: dict = Depends(current_user)):
    """A118 (pentest AND-02): explicit in-app logout only ever cleared the
    token client-side (frontend/lib/auth.ts's clearToken), so a token
    recovered from disk after logout (the WebView's leveldb log is
    append-only, so removeItem's old value survives it) kept authenticating
    for its full SESSION_MAX_AGE (7 days) — there was no server-side
    logout at all.

    Reuses A84's revoke_sessions() verbatim (the same tombstone
    delete_account and the dormant sweep already write), rather than a
    new mechanism: session tokens are stateless itsdangerous signatures
    with no id of their own, so per-token blocklisting isn't possible —
    only a per-identity cutoff is. That means this signs out EVERY device
    holding a session for this email, not just the one that tapped
    logout: there is no per-device session list in this app, so "log out"
    means "every session for this identity, from now", the same meaning
    delete_account's revoke already carries.

    Scope of the revoke (revoke_sessions, A84): every app session for the
    email, AND every active OAuth/MCP access and refresh token, AND every
    pending OAuth authorization code for that identity. So logging out
    also disconnects Claude/MCP connectors; they must re-authorise.

    Bot principals (`email` is None, see current_user) are refused: a bot
    credential is never in bot_credentials.ROUTE_SCOPES for this route, so
    current_user already 401/403s it, and the explicit check below is a
    second line of defence so a revoke for email None can never be written.

    Idempotent: revoke_sessions' `$max` on `not_before` only ever moves a
    tombstone later, never earlier, so calling this twice is harmless. A
    second call presenting the SAME (now-revoked) token never reaches this
    body at all — the `current_user` dependency above rejects it with 401
    first, which is the correct outcome (not a 500), before revoke_sessions
    runs again.

    A120 (pentest AND-07 / IOS-07): also deletes EVERY web-push, APNs and
    FCM registration for the email (not just the calling device's), matching
    the sign-out-everywhere meaning above, so a signed-out device stops
    receiving pushes even if the client-side unregister never ran. Fail-safe:
    a cleanup error is logged (masked email only) and the revoke still runs.
    A device that signs in again re-registers itself.
    """
    if not user.get("email"):
        raise HTTPException(403, "Bot credentials cannot log out")
    try:
        await drop_user_push_registrations(user["email"])
    except Exception as exc:
        logging.warning(
            "Logout push cleanup failed for %s (%s); revoking anyway",
            mask_email(user["email"]), type(exc).__name__,
        )
    await revoke_sessions(user["email"])
    logging.info("Logged out %s (all sessions revoked)", mask_email(user["email"]))
    return {"ok": True}


@router.post("/auth/google/native")
async def google_native(body: dict):
    """Verify an idToken from the native mobile Google SDK and issue a session.

    The mobile app signs in with the native Google SDK using the web client id
    as the audience, so the idToken's `aud` is GOOGLE_CLIENT_ID on both
    platforms. We verify it via Google's tokeninfo endpoint (validates the
    signature and expiry server-side) and check the email allow-list.
    """
    id_token = body.get("id_token")
    if not id_token:
        raise HTTPException(400, "Missing id_token")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
        )
    if not resp.is_success:
        raise HTTPException(401, "Invalid token")

    info = resp.json()
    if info.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(401, "Token audience mismatch")
    if str(info.get("email_verified")).lower() != "true":
        raise HTTPException(401, "Email not verified")

    email = info.get("email", "").lower()
    if not email:
        raise HTTPException(401, "Auth failed")
    email = await resolve_signin_email("google-native", email)
    if email is None:
        # D5: the only reason resolve_signin_email() ever returns None is
        # the allow-list refusal (see its own docstring) — this structured
        # code lets the app show "Sorted is invite-only right now" instead
        # of a bare 403, rather than a generic failure message.
        raise HTTPException(403, detail={"code": "INVITE_ONLY"})

    session_token = serializer.dumps({"email": email, "name": info.get("name", "")})
    return {"session_token": session_token, "ok": True}


async def _verify_apple_identity_token(identity_token: str) -> dict:
    """Verify an identityToken from the native Sign in with Apple SDK and
    return its claims.

    Unlike Google, Apple's native flow hands back a self-contained RS256 JWT
    (no tokeninfo-style verification endpoint), so we verify it ourselves
    against Apple's published JWKS: signature, `iss`, `aud`, and `exp`. The
    accepted audience is either the native app's bundle id (APPLE_BUNDLE_ID)
    or, if configured, a Services ID (APPLE_SERVICES_ID) for a future web
    flow — empty APPLE_SERVICES_ID means only the bundle id is accepted.

    Shared by apple_native() (sign-in) and the /auth/identities/apple link
    endpoint (linking), so both paths reject a bad token identically.
    """
    if not identity_token:
        raise HTTPException(400, "Missing identityToken")

    try:
        header = jwt.get_unverified_header(identity_token)
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")

    jwks = await _get_apple_jwks()
    key_data = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
    if not key_data:
        raise HTTPException(401, "Invalid token")

    try:
        public_key = RSAAlgorithm.from_jwk(key_data)
    except Exception:
        raise HTTPException(401, "Invalid token")

    audiences = [a for a in (APPLE_BUNDLE_ID, APPLE_SERVICES_ID) if a]

    try:
        claims = jwt.decode(
            identity_token,
            key=public_key,
            algorithms=["RS256"],
            audience=audiences or None,
            issuer="https://appleid.apple.com",
            options={"require": ["exp", "iss"]},
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid token")

    if str(claims.get("email_verified")).lower() != "true":
        raise HTTPException(401, "Email not verified")

    return claims


@router.post("/auth/apple/native")
async def apple_native(body: dict):
    """Verify an identityToken from the native Sign in with Apple SDK and
    issue a session.

    Apple only includes the user's name in the *first* authorization ever
    performed with this app, so the client passes it through as `fullName`
    on that first call; every call after that has no name in the token or
    from the client. D7: this used to fall back to the email's local-part
    (e.g. "jjdk4" for a Hide My Email relay address), which then showed up
    verbatim as a greeting on Home ("Good evening, jjdk4..."). The session
    `name` is left empty in that case instead, the same as the Google
    sign-in routes below already do when their provider hands over no
    display name — callers (see frontend/lib/displayName.ts) prefer the
    user's own profile.full_name over this session name anyway, and an
    empty string is something they can safely fall back past, unlike an
    email fragment that reads as a real name.

    Hide My Email caveat: when a user chooses to relay their email, Apple
    issues a stable, per-app, *verified* @privaterelay.appleid.com address.
    That relay address is per-app but otherwise ordinary as far as this
    route is concerned: it satisfies `email_verified` like any other
    address. Without linking, a user who signs in with Google using their
    real email and later signs in with Apple using a relay address would
    get two distinct accounts (or, on a restricted allow list, a flat 403).
    To avoid that, resolve_signin_email() looks the token's `sub` claim
    (Apple's stable, non-rotating per-user identifier) up in
    `linked_identities_col` FIRST; a match resolves straight to the linked
    account's email, bypassing the fresh-claim allow-list check entirely
    (linking already proved that account owns this identity). Only when
    there is no link does it fall back to the claim-email + allow-list (or
    OPEN_SIGNUP) flow, auto-recording a link for next time. See
    /auth/identities/apple for how an explicit link is created.
    """
    identity_token = body.get("identityToken")
    claims = await _verify_apple_identity_token(identity_token)

    sub = claims.get("sub")
    email_claim = (claims.get("email") or "").lower()
    if not email_claim:
        raise HTTPException(401, "Auth failed")
    relay = str(claims.get("is_private_email")).lower() == "true"
    email = await resolve_signin_email("apple-native", email_claim, subject=sub, relay=relay)
    if email is None:
        # D5: see google_native()'s equivalent comment above.
        raise HTTPException(403, detail={"code": "INVITE_ONLY"})

    name = body.get("fullName") or ""
    session_token = serializer.dumps({"email": email, "name": name})
    return {"session_token": session_token, "ok": True}


@router.get("/auth/identities")
async def list_linked_identities(user: dict = Depends(current_user)):
    """List provider identities linked to the caller's account (Phase 1:
    Apple only). Never returns the raw relay/real email, only a masked form,
    since this is reachable by anyone with a valid session for the account."""
    linked = []
    cursor = linked_identities_col.find({"provider": "apple", "user_id": user["email"]})
    async for doc in cursor:
        linked_at = doc.get("linked_at")
        linked.append({
            "provider": "apple",
            "relay": bool(doc.get("relay")),
            "auto": bool(doc.get("auto", False)),
            "email_masked": mask_email(doc.get("email_at_link", "")),
            "linked_at": linked_at.isoformat() if isinstance(linked_at, datetime) else None,
        })
    return {"primary_email": user["email"], "linked": linked}


@router.post("/auth/identities/apple")
async def link_apple_identity(body: dict, user: dict = Depends(current_user)):
    """Link the caller's authenticated account to the Apple identity behind
    `identityToken`. Keyed on the token's `sub` claim (Apple's stable
    per-user identifier), not the email claim, since a relay address's
    local-part can itself change if the user disables/re-enables Hide My
    Email — `sub` is the one thing that never does.

    Re-linking the same sub to the same account is a no-op refresh (updates
    email_at_link/relay/linked_at in case those drifted). Linking a sub
    already linked to a DIFFERENT account is refused (409) — UNLESS that
    existing link was automatic (`auto: True`, created by resolve_signin_email()
    the first time this Apple identity signed in with OPEN_SIGNUP on), in
    which case an explicit link from a different account is allowed to
    re-point it: an automatic link is a best-guess placeholder, not a claim,
    so a later explicit link should win. Every link created or updated by
    this endpoint is stored with `auto: False`, since reaching this endpoint
    at all means the account owner explicitly asked for the link.

    D3: when this claims an automatic link away from a DIFFERENT account
    (the `auto: True` re-point case above), that other account is very
    often nothing but the empty relay-email placeholder resolve_signin_email()
    created the first time this Apple identity ever signed in — a real
    account never had a reason to exist there. Once the re-point above
    lands, that placeholder has nothing pointing at it any more, so this
    also tries to erase it via erase_orphaned_relay_account(), which
    refuses on its own if the account isn't actually an empty relay
    placeholder (not a relay address, or it has real data). That cleanup
    running in a try/except that only logs: it must never turn a
    successful link into a failed request.
    """
    identity_token = body.get("identityToken")
    claims = await _verify_apple_identity_token(identity_token)

    sub = claims.get("sub")
    if not sub:
        raise HTTPException(401, "Invalid token")

    doc_id = f"apple:{sub}"
    existing = await linked_identities_col.find_one({"_id": doc_id})
    if existing and existing.get("user_id") != user["email"] and not existing.get("auto"):
        raise HTTPException(409, "This Apple ID is linked to another account")

    reclaimed_from = (
        existing.get("user_id")
        if existing and existing.get("auto") and existing.get("user_id") != user["email"]
        else None
    )

    email_at_link = (claims.get("email") or "").lower()
    # Apple encodes this claim as the string "true"/"false" (like
    # email_verified above), not a JSON boolean — bool(...) on a non-empty
    # string is always True, so this must compare the lowercased string.
    relay = str(claims.get("is_private_email")).lower() == "true"
    await linked_identities_col.update_one(
        {"_id": doc_id},
        {"$set": {
            "_id": doc_id,
            "provider": "apple",
            "subject": sub,
            "user_id": user["email"],
            "email_at_link": email_at_link,
            "relay": relay,
            "auto": False,
            "linked_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    logging.info("Linked apple identity to %s relay=%s", mask_email(user["email"]), relay)

    orphan_removed = False
    if reclaimed_from:
        try:
            orphan_removed = await erase_orphaned_relay_account(reclaimed_from, claimed_by=user["email"]) is not None
        except Exception:
            logging.warning(
                "link_apple_identity: orphan cleanup failed for %s", mask_email(reclaimed_from), exc_info=True,
            )

    return {
        "ok": True, "provider": "apple", "relay": relay,
        "email_masked": mask_email(email_at_link), "orphan_removed": orphan_removed,
    }


@router.delete("/auth/identities/apple")
async def unlink_apple_identity(user: dict = Depends(current_user)):
    """Remove every Apple identity link for the caller's account (there
    should only ever be one, but this is not assumed)."""
    result = await linked_identities_col.delete_many({"provider": "apple", "user_id": user["email"]})
    return {"ok": True, "removed": result.deleted_count}


@router.get("/auth/google")
async def google_auth():
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
    redirect_uri = f"{APP_URL}/api/auth/google/callback"
    params = urllib.parse.urlencode({
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        "prompt":        "select_account",
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


@router.get("/auth/google/mobile")
async def google_auth_mobile(state: str = "", challenge: str = ""):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
    # A133: `challenge` is sha256(poll_secret), hex. The secret itself never
    # leaves the app and is never in a URL. Without a valid challenge a
    # new-format state is simply never redeemable (legacy states need none).
    if challenge:
        await store_challenge(state, challenge)
    redirect_uri = f"{APP_URL}/api/auth/google/mobile-callback"
    params = urllib.parse.urlencode({
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  redirect_uri,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        "prompt":        "select_account",
        "state":         state,
    })
    return RedirectResponse(f"https://accounts.google.com/o/oauth2/v2/auth?{params}")


def _poll_reply(value: str | None) -> dict:
    if value is None:
        return {"status": "pending"}
    kind, _, payload = value.partition(":")
    return {"status": kind, **({"token": payload} if kind == "token" else {"error": payload})}


class MobilePollBody(BaseModel):
    state: str = ""
    poll_secret: str | None = None


@router.post("/auth/mobile/poll")
async def mobile_poll_secret(body: MobilePollBody):
    # A133: new builds. The poll_secret rides in the body, never a URL. A
    # malformed state, an unknown state and a wrong or missing secret all get
    # exactly {"status": "pending"}.
    return _poll_reply(await redeem_pending(body.state, body.poll_secret))


@router.get("/auth/mobile/poll")
async def mobile_poll(state: str):
    # Legacy (pre-A133 installed builds): single-read, legacy states only.
    # A new-format state has no secret here, so it always gets "pending".
    return _poll_reply(await redeem_pending(state, None))


@router.get("/auth/google/mobile-callback")
async def google_mobile_callback(code: str = None, error: str = None, state: str = ""):
    async def finish(value: str) -> HTMLResponse:
        if is_valid_mobile_state(state):
            if is_legacy_mobile_state(state):
                # TODO(A133): drop with the legacy state format. Never logs the state.
                logging.getLogger(__name__).info("mobile login: legacy state format used (pre-A133 app build), single-read")
                await _store_pending(state, value)
            elif await has_challenge(state):
                # New format: only stored when the app registered a challenge
                # at login start, otherwise nobody could ever redeem it.
                await _store_pending(state, value)
        ok = value.startswith("token:")
        page = signin_handoff_html(ok, auto_return=ok)
        return HTMLResponse(page, headers={"Content-Security-Policy": signin_handoff_csp(page)})

    if error or not code:
        return await finish("error:auth_failed")

    redirect_uri = f"{APP_URL}/api/auth/google/mobile-callback"
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code":          code,
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri":  redirect_uri,
                "grant_type":    "authorization_code",
            },
        )
    if not token_resp.is_success:
        return await finish("error:token_exchange_failed")

    access_token = token_resp.json().get("access_token")
    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if not userinfo_resp.is_success:
        return await finish("error:userinfo_failed")

    userinfo = userinfo_resp.json()
    email    = userinfo.get("email", "").lower()
    if not email:
        return await finish("error:auth_failed")
    email = await resolve_signin_email("google-mobile", email)
    if email is None:
        # D5: distinct from the other finish("error:...") calls above so
        # the native app can show the invite-only screen instead of a
        # generic "sign-in failed" alert (see lib/nativeAuth.ts).
        return await finish("error:invite_only")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return await finish(f"token:{session_token}")


@router.get("/auth/google/callback")
async def google_callback(code: str = None, error: str = None):
    if error or not code:
        return RedirectResponse(f"{APP_URL}/?error=auth_failed")

    redirect_uri = f"{APP_URL}/api/auth/google/callback"
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code":          code,
                "client_id":     GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri":  redirect_uri,
                "grant_type":    "authorization_code",
            },
        )
    if not token_resp.is_success:
        return RedirectResponse(f"{APP_URL}/?error=token_exchange_failed")

    access_token = token_resp.json().get("access_token")
    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if not userinfo_resp.is_success:
        return RedirectResponse(f"{APP_URL}/?error=userinfo_failed")

    userinfo = userinfo_resp.json()
    email    = userinfo.get("email", "").lower()
    if not email:
        return RedirectResponse(f"{APP_URL}/?error=auth_failed")
    email = await resolve_signin_email("google-web", email)
    if email is None:
        # D5: distinct from the other ?error=... redirects above so
        # LoginScreen can show "Sorted is invite-only right now" instead of
        # a generic failure message (see components/LoginScreen.tsx).
        return RedirectResponse(f"{APP_URL}/?error=invite_only")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return RedirectResponse(f"{APP_URL}/?token={urllib.parse.quote(session_token, safe='')}")
