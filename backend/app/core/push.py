"""Push notification helpers — Web Push (PWA) + APNs (native iOS) + FCM (native Android)."""
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
    push_subscriptions_col, apns_tokens_col, fcm_tokens_col,
)

_vapid = Vapid.from_pem(VAPID_PRIVATE_KEY_PEM.encode())

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


async def send_apns_push(user_id: str, title: str, body: str, url: str = "/") -> dict:
    """Deliver to the user's native iOS (APNs) device tokens. Prunes dead tokens."""
    global _apns_warned_unconfigured
    result = {"configured": APNS_CONFIGURED, "attempted": 0, "delivered": 0, "failed": 0, "pruned": 0}
    try:
        if not APNS_CONFIGURED:
            if not _apns_warned_unconfigured:
                logging.warning("APNs not configured (missing key/team id) — native iOS push disabled.")
                _apns_warned_unconfigured = True
            return result

        tokens = await apns_tokens_col.find({"user_id": user_id}).to_list(None)
        if not tokens:
            return result

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
        result["attempted"] = len(tokens)
        async with httpx.AsyncClient(http2=True, timeout=15) as client:
            for t in tokens:
                device_token = t["_id"]
                token_trunc = f"{device_token[:12]}…{device_token[-6:]}"
                try:
                    resp = await client.post(f"{host}/3/device/{device_token}", headers=headers, json=payload)
                    if resp.status_code == 410:
                        # Apple always reports "Unregistered" as the reason for 410, logged
                        # here so a prune is diagnosable without a repro.
                        logging.warning(
                            "APNs pruning dead token for %s (%s, reason=Unregistered): token=%s body=%s",
                            user_id, resp.status_code, token_trunc, resp.text,
                        )
                        dead.append(device_token)
                        result["failed"] += 1
                    elif resp.status_code == 400:
                        reason = (resp.json() or {}).get("reason")
                        if reason in ("BadDeviceToken", "Unregistered"):
                            logging.warning(
                                "APNs pruning dead token for %s (%s, reason=%s): token=%s body=%s",
                                user_id, resp.status_code, reason, token_trunc, resp.text,
                            )
                            dead.append(device_token)
                        else:
                            logging.warning("APNs 400 for %s: %s", user_id, reason)
                        result["failed"] += 1
                    elif resp.status_code >= 400:
                        logging.warning("APNs send error for %s (%s): %s", user_id, resp.status_code, resp.text)
                        result["failed"] += 1
                    else:
                        result["delivered"] += 1
                except Exception as e:
                    logging.warning("APNs send exception for %s: %s", user_id, e)
                    result["failed"] += 1

        if dead:
            await apns_tokens_col.delete_many({"_id": {"$in": dead}})
        result["pruned"] = len(dead)
        return result
    except Exception as e:
        logging.warning("APNs push error for %s: %s", user_id, e)
        return {"configured": APNS_CONFIGURED, "attempted": 0, "delivered": 0, "failed": 0, "pruned": 0}


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


async def send_fcm_push(user_id: str, title: str, body: str, url: str = "/") -> dict:
    """Deliver to the user's native Android (FCM) device tokens. Prunes dead tokens."""
    global _fcm_warned_unconfigured
    result = {"configured": FCM_CONFIGURED, "attempted": 0, "delivered": 0, "failed": 0, "pruned": 0}
    try:
        if not FCM_CONFIGURED:
            if not _fcm_warned_unconfigured:
                logging.warning("FCM not configured (missing project id/service account) — native Android push disabled.")
                _fcm_warned_unconfigured = True
            return result

        tokens = await fcm_tokens_col.find({"user_id": user_id}).to_list(None)
        if not tokens:
            return result

        access_token = await _fcm_access_token()
        if not access_token:
            return result

        send_url = FCM_SEND_URL_TMPL.format(project_id=FCM_PROJECT_ID)
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }

        dead = []
        result["attempted"] = len(tokens)
        async with httpx.AsyncClient(timeout=15) as client:
            for t in tokens:
                device_token = t["_id"]
                token_trunc = f"{device_token[:12]}…{device_token[-6:]}"
                payload = {
                    "message": {
                        "token": device_token,
                        "notification": {"title": title, "body": body},
                        "data": {"url": url},
                        # channel_id overrides the manifest's default channel so this
                        # lands on the "money_updates" channel created client-side in
                        # frontend/lib/capacitorPush.ts (gives the user per-app control
                        # in Android settings). icon names the drawable resource FCM
                        # should use for the status-bar icon, no extension or path, just
                        # the resource name as registered in AndroidManifest.xml.
                        "android": {
                            "priority": "high",
                            "notification": {"channel_id": "money_updates", "icon": "ic_stat_notify"},
                        },
                    }
                }
                try:
                    resp = await client.post(send_url, headers=headers, json=payload)
                    if resp.status_code >= 400:
                        is_dead = resp.status_code == 404
                        dead_reason = "HTTP 404" if is_dead else None
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
                                    dead_reason = f"errorCode={d.get('errorCode')}"
                                    break
                        if is_dead:
                            # Pruning is destructive, so log the evidence before the token
                            # is dropped. Without this, a dead-token verdict is unrecoverable.
                            logging.warning(
                                "FCM pruning dead token for %s (%s, %s): token=%s body=%s",
                                user_id, resp.status_code, dead_reason, token_trunc, resp.text,
                            )
                            dead.append(device_token)
                            result["failed"] += 1
                        else:
                            logging.warning("FCM send error for %s (%s): %s", user_id, resp.status_code, resp.text)
                            result["failed"] += 1
                    else:
                        result["delivered"] += 1
                except Exception as e:
                    logging.warning("FCM send exception for %s: %s", user_id, e)
                    result["failed"] += 1

        if dead:
            await fcm_tokens_col.delete_many({"_id": {"$in": dead}, "user_id": user_id})
        result["pruned"] = len(dead)
        return result
    except Exception as e:
        logging.warning("FCM push error for %s: %s", user_id, e)
        return {"configured": FCM_CONFIGURED, "attempted": 0, "delivered": 0, "failed": 0, "pruned": 0}


async def send_push_to_user(user_id: str, title: str, body: str, url: str = "/") -> dict:
    apns_result = await send_apns_push(user_id, title, body, url)
    fcm_result = await send_fcm_push(user_id, title, body, url)
    webpush_result = {"attempted": 0, "delivered": 0, "failed": 0, "pruned": 0}
    subs = await push_subscriptions_col.find({"user_id": user_id}).to_list(None)
    if not subs:
        return {"apns": apns_result, "fcm": fcm_result, "webpush": webpush_result}
    webpush_result["attempted"] = len(subs)
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
            webpush_result["delivered"] += 1
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                expired.append(sub["_id"])
            else:
                logging.warning("WebPushException for %s: %s", user_id, e)
            webpush_result["failed"] += 1
        except Exception as e:
            logging.warning("Push send error for %s: %s", user_id, e)
            webpush_result["failed"] += 1
    if expired:
        await push_subscriptions_col.delete_many({"_id": {"$in": expired}})
    webpush_result["pruned"] = len(expired)
    return {"apns": apns_result, "fcm": fcm_result, "webpush": webpush_result}


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
    # "/spend?view=list" used to be a dedicated Transactions tab; the Spend
    # redesign retired it (view=list now just falls back to the "This
    # period" hub — see frontend/app/components/SpendPage.tsx). The actual
    # transactions list now lives at its own route, /transactions.
    await send_push_to_user(user_id, title, body, "/transactions")
