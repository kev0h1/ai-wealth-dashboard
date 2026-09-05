"""Auth endpoints: PIN login, Google OAuth, Sign in with Apple, session validation."""
import time
import urllib.parse
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

from app.core.config import (
    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    APPLE_BUNDLE_ID, APPLE_SERVICES_ID,
    APP_URL, ALLOWED_EMAILS, PRIMARY_EMAIL, SESSION_MAX_AGE, serializer,
)
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
# `state` id and polls for the result; the callback stashes it here keyed by
# state. Single uvicorn worker, so an in-memory dict is sufficient.
_PENDING_TTL = 300
_pending: dict[str, tuple[str, float]] = {}


def _store_pending(state: str, value: str) -> None:
    now = time.time()
    _pending[state] = (value, now + _PENDING_TTL)
    for k in [k for k, (_, exp) in _pending.items() if exp < now]:
        _pending.pop(k, None)


@router.post("/auth/session/validate")
async def validate_session(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    try:
        data = serializer.loads(auth[7:], max_age=SESSION_MAX_AGE)
        name  = data.get("name", "")  if isinstance(data, dict) else ""
        email = data.get("email", "") if isinstance(data, dict) else ""
        return {"valid": True, "name": name, "email": email}
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
    if email not in ALLOWED_EMAILS:
        raise HTTPException(403, "Access denied")

    session_token = serializer.dumps({"email": email, "name": info.get("name", "")})
    return {"session_token": session_token, "ok": True}


@router.post("/auth/apple/native")
async def apple_native(body: dict):
    """Verify an identityToken from the native Sign in with Apple SDK and
    issue a session.

    Unlike Google, Apple's native flow hands back a self-contained RS256 JWT
    (no tokeninfo-style verification endpoint), so we verify it ourselves
    against Apple's published JWKS: signature, `iss`, `aud`, and `exp`. The
    accepted audience is either the native app's bundle id (APPLE_BUNDLE_ID)
    or, if configured, a Services ID (APPLE_SERVICES_ID) for a future web
    flow — empty APPLE_SERVICES_ID means only the bundle id is accepted.

    Apple only includes the user's name in the *first* authorization ever
    performed with this app, so the client passes it through as `fullName`
    on that first call; every call after that has no name in the token or
    from the client, so we fall back to the email's local-part.

    Hide My Email caveat: when a user chooses to relay their email, Apple
    issues a stable, per-app, *verified* @privaterelay.appleid.com address.
    We treat that relay address as the identity exactly like any other
    verified email — it satisfies `email_verified` and passes the
    ALLOWED_EMAILS gate just like a real address would. This means a user
    who signs in with Google using their real email and later signs in with
    Apple using a relay address gets two distinct accounts/sessions; there
    is no email-based account linking here, and building that is explicitly
    out of scope for this change.
    """
    identity_token = body.get("identityToken")
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

    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Auth failed")
    if email not in ALLOWED_EMAILS:
        raise HTTPException(403, "Access denied")

    name = body.get("fullName") or email.split("@")[0]
    session_token = serializer.dumps({"email": email, "name": name})
    return {"session_token": session_token, "ok": True}


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
    entry = _pending.get(state)
    if not entry or entry[1] < time.time():
        _pending.pop(state, None)
        return {"status": "pending"}
    value, _ = _pending.pop(state)
    kind, _, payload = value.partition(":")
    return {"status": kind, **({"token": payload} if kind == "token" else {"error": payload})}


@router.get("/auth/google/mobile-callback")
async def google_mobile_callback(code: str = None, error: str = None, state: str = ""):
    def finish(value: str) -> HTMLResponse:
        if state:
            _store_pending(state, value)
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
        return finish("error:auth_failed")

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
        return finish("error:token_exchange_failed")

    access_token = token_resp.json().get("access_token")
    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if not userinfo_resp.is_success:
        return finish("error:userinfo_failed")

    userinfo = userinfo_resp.json()
    email    = userinfo.get("email", "").lower()
    if not email:
        return finish("error:auth_failed")
    if email not in ALLOWED_EMAILS:
        return finish("error:access_denied")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return finish(f"token:{session_token}")


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
    if email not in ALLOWED_EMAILS:
        return RedirectResponse(f"{APP_URL}/?error=access_denied")

    session_token = serializer.dumps({"email": email, "name": userinfo.get("name", "")})
    return RedirectResponse(f"{APP_URL}/?token={urllib.parse.quote(session_token, safe='')}")
