"""Auth endpoints: PIN login, Google OAuth, session validation."""
import time
import urllib.parse
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse, HTMLResponse
import httpx

from app.core.config import (
    DASHBOARD_PIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
    APP_URL, ALLOWED_EMAILS, PRIMARY_EMAIL, SESSION_MAX_AGE, serializer,
)
from itsdangerous import SignatureExpired, BadSignature

router = APIRouter(tags=["auth"])

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


def _mobile_done_page() -> HTMLResponse:
    return HTMLResponse(
        "<!doctype html><html><body style=\"font-family:system-ui;text-align:center;"
        "padding:48px 24px;color:#1e293b\"><h2>You're signed in</h2>"
        "<p style=\"color:#64748b\">You can return to the app now.</p></body></html>"
    )


@router.post("/auth/pin")
async def pin_login(body: dict):
    if body.get("pin") != DASHBOARD_PIN:
        raise HTTPException(401, "Incorrect PIN")
    return {"session_token": serializer.dumps({"email": PRIMARY_EMAIL, "name": ""}), "ok": True}


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
        return _mobile_done_page()

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
