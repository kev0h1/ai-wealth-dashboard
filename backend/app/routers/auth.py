"""Auth endpoints: PIN login, Google OAuth, Sign in with Apple, session validation."""
import logging
import time
import urllib.parse
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

from app.core.auth import current_user
from app.core.config import (
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    APPLE_BUNDLE_ID, APPLE_SERVICES_ID,
    APP_URL, PRIMARY_EMAIL, SESSION_MAX_AGE, serializer,
    mask_email,
)
from app.core.identity import resolve_signin_email
from app.core.pending_login import _pop_pending, _store_pending
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
        data = serializer.loads(auth[7:], max_age=SESSION_MAX_AGE)
        name  = data.get("name", "")  if isinstance(data, dict) else ""
        email = data.get("email", "") if isinstance(data, dict) else ""
        # Web-only product lock (A10): the frontend needs to tell the owner's
        # account apart from any other authorised sign-in so it can keep the
        # full product reachable for the owner while everyone else gets the
        # "Sorted is an app" shell when NEXT_PUBLIC_WEB_PRODUCT=off.
        owner = email.strip().lower() == PRIMARY_EMAIL
        return {"valid": True, "name": name, "email": email, "owner": owner}
    except (SignatureExpired, BadSignature):
        raise HTTPException(401, "Session expired")


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
        raise HTTPException(403, "Access denied")

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
    from the client, so we fall back to the email's local-part.

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
        raise HTTPException(403, "Access denied")

    name = body.get("fullName") or email.split("@")[0]
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
async def google_auth_mobile(state: str = ""):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(500, "Google OAuth not configured")
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


@router.get("/auth/mobile/poll")
async def mobile_poll(state: str):
    value = await _pop_pending(state)
    if value is None:
        return {"status": "pending"}
    kind, _, payload = value.partition(":")
    return {"status": kind, **({"token": payload} if kind == "token" else {"error": payload})}


@router.get("/auth/google/mobile-callback")
async def google_mobile_callback(code: str = None, error: str = None, state: str = ""):
    async def finish(value: str) -> HTMLResponse:
        if state:
            await _store_pending(state, value)
        ok = value.startswith("token:")
        if ok:
            heading = "Signed in"
            message = "Taking you back to Sorted."
            icon = "&#10003;"
            heading_color = "#34d399"
        else:
            heading = "Sign-in didn&#39;t complete"
            message = "Close this window and try again in Sorted."
            icon = "&#10007;"
            heading_color = "#f87171"
        return HTMLResponse(f"""<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       text-align:center;padding:60px 24px;background:#0f172a;color:#e2e8f0;margin:0}}
  .icon{{font-size:56px;margin-bottom:16px}}
  h1{{color:{heading_color};font-size:24px;margin:0 0 12px}}
  p{{color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px}}
  .btn{{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:14px;font-size:16px;font-weight:600;
       cursor:pointer;border:none;-webkit-tap-highlight-color:transparent}}
</style></head>
<body>
  <div class="icon">{icon}</div>
  <h1>{heading}</h1>
  <p>{message}</p>
  <button class="btn" onclick="returnToApp()">Return to Sorted</button>
  <script>
    function returnToApp(){{window.location.href='wealthdash://auth-done';}}
    setTimeout(returnToApp, 600);
  </script>
</body></html>
""")

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
        return await finish("error:access_denied")

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
        return RedirectResponse(f"{APP_URL}/?error=access_denied")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return RedirectResponse(f"{APP_URL}/?token={urllib.parse.quote(session_token, safe='')}")
