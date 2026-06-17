"""Web Push notification helpers."""
import json
import asyncio
import logging
from pywebpush import webpush, WebPushException
from py_vapid import Vapid
from app.core.config import VAPID_SUBJECT, VAPID_PRIVATE_KEY_PEM
from app.db.collections import push_subscriptions_col

_vapid = Vapid.from_pem(VAPID_PRIVATE_KEY_PEM.encode())


async def send_push_to_user(user_id: str, title: str, body: str, url: str = "/") -> None:
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
