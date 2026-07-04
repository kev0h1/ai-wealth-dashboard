"""Push notification helpers — Web Push (PWA) + Expo push (native app)."""
import json
import asyncio
import logging
import httpx
from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from app.core.config import VAPID_SUBJECT, VAPID_PRIVATE_KEY_PEM
from app.db.collections import push_subscriptions_col, expo_push_tokens_col

_vapid = Vapid.from_pem(VAPID_PRIVATE_KEY_PEM.encode())

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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
    await send_push_to_user(user_id, title, body)
