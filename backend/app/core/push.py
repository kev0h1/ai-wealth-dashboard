"""Push notification helpers — Web Push (PWA) + Expo push (native app) + APNs (native iOS)."""
import json
import time
import asyncio
import logging
import httpx
import jwt
from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from google.oauth2 import service_account
import google.auth.transport.requests
from app.core.config import (
    VAPID_SUBJECT, VAPID_PRIVATE_KEY_PEM,
    APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_USE_SANDBOX,
    APNS_AUTH_KEY_PEM, APNS_CONFIGURED,
    FCM_PROJECT_ID, FCM_SERVICE_ACCOUNT_JSON, FCM_CONFIGURED,
)
from app.db.collections import (
    push_subscriptions_col, expo_push_tokens_col, apns_tokens_col, fcm_tokens_col,
)

_vapid = Vapid.from_pem(VAPID_PRIVATE_KEY_PEM.encode())

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

APNS_HOST_PROD    = "https://api.push.apple.com"
APNS_HOST_SANDBOX = "https://api.development.push.apple.com"
_APNS_JWT_MAX_AGE = 50 * 60  # regenerate before Apple's 60-minute cap

_apns_jwt_cache: dict = {"token": None, "iat": 0}
_apns_warned_unconfigured = False


def _apns_provider_jwt() -> str:
    """Return a cached ES256 provider JWT for APNs, regenerating when stale."""
    now = time.time()
    if _apns_jwt_cache["token"] is None or (now - _apns_jwt_cache["iat"]) > _APNS_JWT_MAX_AGE:
        token = jwt.encode(
            {"iss": APNS_TEAM_ID, "iat": int(now)},
            APNS_AUTH_KEY_PEM,
            algorithm="ES256",
            headers={"kid": APNS_KEY_ID},
        )
        _apns_jwt_cache["token"] = token
        _apns_jwt_cache["iat"] = now
    return _apns_jwt_cache["token"]


async def send_apns_push(user_id: str, title: str, body: str, url: str = "/") -> None:
    """Deliver to the user's native iOS (APNs) device tokens. Prunes dead tokens."""
    global _apns_warned_unconfigured
    try:
        if not APNS_CONFIGURED:
            if not _apns_warned_unconfigured:
                logging.warning("APNs not configured (missing key/team id) — native iOS push disabled.")
                _apns_warned_unconfigured = True
            return

        tokens = await apns_tokens_col.find({"user_id": user_id}).to_list(None)
        if not tokens:
            return

        host = APNS_HOST_SANDBOX if APNS_USE_SANDBOX else APNS_HOST_PROD
        payload = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}, "url": url}
        provider_jwt = _apns_provider_jwt()
        headers = {
            "authorization": f"bearer {provider_jwt}",
            "apns-topic": APNS_BUNDLE_ID,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
        }

        dead = []
        async with httpx.AsyncClient(http2=True, timeout=15) as client:
            for t in tokens:
                device_token = t["_id"]
                try:
                    resp = await client.post(f"{host}/3/device/{device_token}", headers=headers, json=payload)
                    if resp.status_code == 410:
                        dead.append(device_token)
                    elif resp.status_code == 400:
                        reason = (resp.json() or {}).get("reason")
                        if reason in ("BadDeviceToken", "Unregistered"):
                            dead.append(device_token)
                        else:
                            logging.warning("APNs 400 for %s: %s", user_id, reason)
                    elif resp.status_code >= 400:
                        logging.warning("APNs send error for %s (%s): %s", user_id, resp.status_code, resp.text)
                except Exception as e:
                    logging.warning("APNs send exception for %s: %s", user_id, e)

        if dead:
            await apns_tokens_col.delete_many({"_id": {"$in": dead}})
    except Exception as e:
        logging.warning("APNs push error for %s: %s", user_id, e)


FCM_SEND_URL_TMPL = "https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
FCM_SCOPES = ["https://www.googleapis.com/auth/firebase.messaging"]

_fcm_creds = None
_fcm_warned_unconfigured = False


async def _fcm_access_token() -> str | None:
    """Return a cached OAuth2 access token for FCM, refreshing when near expiry."""
    global _fcm_creds
    if not FCM_CONFIGURED:
        return None
    if _fcm_creds is None:
        info = json.loads(FCM_SERVICE_ACCOUNT_JSON)
        _fcm_creds = service_account.Credentials.from_service_account_info(info, scopes=FCM_SCOPES)
    if not _fcm_creds.valid:
        # creds.refresh() does a blocking synchronous HTTPS call (requests/urllib3);
        # run it off the event loop so it doesn't stall the uvicorn worker.
        await asyncio.to_thread(_fcm_creds.refresh, google.auth.transport.requests.Request())
    return _fcm_creds.token


async def send_fcm_push(user_id: str, title: str, body: str, url: str = "/") -> None:
    """Deliver to the user's native Android (FCM) device tokens. Prunes dead tokens."""
    global _fcm_warned_unconfigured
    try:
        if not FCM_CONFIGURED:
            if not _fcm_warned_unconfigured:
                logging.warning("FCM not configured (missing project id/service account) — native Android push disabled.")
                _fcm_warned_unconfigured = True
            return

        tokens = await fcm_tokens_col.find({"user_id": user_id}).to_list(None)
        if not tokens:
            return

        access_token = await _fcm_access_token()
        if not access_token:
            return

        send_url = FCM_SEND_URL_TMPL.format(project_id=FCM_PROJECT_ID)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        dead = []
        async with httpx.AsyncClient(timeout=15) as client:
            for t in tokens:
                device_token = t["_id"]
                payload = {
                    "message": {
                        "token": device_token,
                        "notification": {"title": title, "body": body},
                        "data": {"url": url},
                        "android": {"priority": "high"},
                    }
                }
                try:
                    resp = await client.post(send_url, headers=headers, json=payload)
                    if resp.status_code >= 400:
                        is_dead = resp.status_code == 404
                        if not is_dead:
                            # The top-level error.status (e.g. "INVALID_ARGUMENT") is just the
                            # HTTP code translated to a string — it does NOT mean the token is
                            # bad. The real reason lives nested in error.details[].errorCode.
                            # Only prune on the specific device-token reasons; log everything
                            # else so a payload bug leaves a trail instead of a silent wipe.
                            try:
                                err_body = resp.json() or {}
                            except Exception:
                                err_body = {}
                            details = ((err_body.get("error") or {}).get("details")) or []
                            for d in details:
                                if isinstance(d, dict) and d.get("errorCode") in ("UNREGISTERED", "SENDER_ID_MISMATCH"):
                                    is_dead = True
                                    break
                        if is_dead:
                            dead.append(device_token)
                        else:
                            logging.warning("FCM send error for %s (%s): %s", user_id, resp.status_code, resp.text)
                except Exception as e:
                    logging.warning("FCM send exception for %s: %s", user_id, e)

        if dead:
            await fcm_tokens_col.delete_many({"_id": {"$in": dead}, "user_id": user_id})
    except Exception as e:
        logging.warning("FCM push error for %s: %s", user_id, e)


async def send_expo_push(user_id: str, title: str, body: str, url: str = "/") -> None:
    """Deliver to the user's native (Expo) push tokens. Prunes dead tokens."""
    tokens = await expo_push_tokens_col.find({"user_id": user_id}).to_list(None)
    if not tokens:
        return
    messages = [
        {"to": t["_id"], "title": title, "body": body, "data": {"url": url}}
        for t in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                EXPO_PUSH_URL, json=messages,
                headers={"Content-Type": "application/json", "Accept": "application/json"},
            )
        results = resp.json().get("data", [])
    except Exception as e:
        logging.warning("Expo push send error for %s: %s", user_id, e)
        return
    dead = []
    for msg, res in zip(messages, results):
        if isinstance(res, dict) and res.get("status") == "error":
            if (res.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead.append(msg["to"])
            else:
                logging.warning("Expo push error for %s: %s", user_id, res.get("message"))
    if dead:
        await expo_push_tokens_col.delete_many({"_id": {"$in": dead}})


async def send_push_to_user(user_id: str, title: str, body: str, url: str = "/") -> None:
    await send_expo_push(user_id, title, body, url)
    await send_apns_push(user_id, title, body, url)
    await send_fcm_push(user_id, title, body, url)
    subs = await push_subscriptions_col.find({"user_id": user_id}).to_list(None)
    if not subs:
        return
    expired = []
    for sub in subs:
        try:
            await asyncio.to_thread(
                webpush,
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["keys"]["p256dh"], "auth": sub["keys"]["auth"]},
                },
                data=json.dumps({"title": title, "body": body, "url": url}),
                vapid_private_key=_vapid,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=3600,
            )
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                expired.append(sub["_id"])
            else:
                logging.warning("WebPushException for %s: %s", user_id, e)
        except Exception as e:
            logging.warning("Push send error for %s: %s", user_id, e)
    if expired:
        await push_subscriptions_col.delete_many({"_id": {"$in": expired}})


async def notify_new_transactions(user_id: str, new_txns: list) -> None:
    if not new_txns:
        return
    sym = "KES " if (new_txns[0].get("currency") == "KES") else "£"
    if len(new_txns) == 1:
        t = new_txns[0]
        name  = (t.get("merchant_name") or t.get("description", "Transaction"))[:30]
        title = "New transaction"
        body  = f"{name} — {sym}{t['amount']:,.2f}"
    else:
        title = f"{len(new_txns)} new transactions"
        parts = [(t.get("merchant_name") or t.get("description", ""))[:20] for t in new_txns[:2]]
        body  = " · ".join(p for p in parts if p)
        if len(new_txns) > 2:
            body += f" +{len(new_txns) - 2} more"
    await send_push_to_user(user_id, title, body, "/spend?view=list")
