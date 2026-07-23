"""Finexer auth + consent callback endpoints."""
import asyncio
import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from typing import Optional

from app.core.auth import current_user
from app.core.config import FINEXER_API_KEY
from app.core.subscription import check_connection_limit
from app.db.collections import finexer_consents_col
from app.services.finexer_sync import (
    list_providers,
    get_or_create_customer,
    create_consent,
    finexer_sync_pipeline,
)

router = APIRouter(tags=["finexer"])


@router.get("/auth/finexer/providers")
async def finexer_providers(user: dict = Depends(current_user)):
    """Return all AIS-capable Finexer providers for the bank picker."""
    return await list_providers()


@router.get("/auth/finexer/link")
async def finexer_link(
    provider: str = "",
    user: dict = Depends(current_user),
):
    """Initiate a Finexer consent flow; return the redirect URL."""
    if not FINEXER_API_KEY:
        raise HTTPException(500, "Finexer not configured")
    await check_connection_limit(user["email"])

    customer_id = await get_or_create_customer(user)
    state       = secrets.token_hex(8)
    consent     = await create_consent(
        user_id=user["email"],
        customer_id=customer_id,
        provider=provider or None,
        state=state,
    )
    consent_id = consent["id"]

    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {
            "user_id":     user["email"],
            "customer_id": customer_id,
            "provider":    provider or None,
            "state":       state,
            "status":      "pending",
            "created_at":  datetime.utcnow(),
        }},
        upsert=True,
    )

    consent_url = consent["redirect"]["consent_url"]
    return {"auth_url": consent_url, "connection_id": consent_id}


@router.get("/auth/finexer/callback")
async def finexer_callback(
    consent: str = "",
    state: str = "",
    error: str = "",
    fx_consent: str = "",
):
    """
    Finexer redirects here after the user completes (or cancels) the consent flow.
    Query params: ?fx_consent=<bc_id>&state=<ours>  or  ?error=access_denied&fx_consent=<bc_id>
    """
    # Accept both `consent` and `fx_consent` param names
    consent_id = fx_consent or consent
    if not consent_id:
        raise HTTPException(400, "Missing consent id")

    doc = await finexer_consents_col.find_one({"_id": consent_id})
    if not doc:
        raise HTTPException(404, "Consent not found")

    # Optional state verification
    if state and doc.get("state") and state != doc["state"]:
        raise HTTPException(400, "State mismatch")

    if error:
        await finexer_consents_col.update_one(
            {"_id": consent_id},
            {"$set": {"status": "canceled", "canceled_at": datetime.utcnow(), "error": error}},
        )
        return HTMLResponse("""<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       text-align:center;padding:60px 24px;background:#0f172a;color:#e2e8f0;margin:0}
  .icon{font-size:56px;margin-bottom:16px}
  h1{color:#f87171;font-size:24px;margin:0 0 12px}
  p{color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px}
  .btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:14px;font-size:16px;font-weight:600;cursor:pointer;border:none}
</style></head>
<body>
  <div class="icon">&#10007;</div>
  <h1>Connection cancelled</h1>
  <p>No accounts were linked.</p>
  <button class="btn" onclick="window.location.href='/accounts'">Back to app</button>
</body></html>
""")

    await finexer_consents_col.update_one(
        {"_id": consent_id},
        {"$set": {"status": "authorized", "authed_at": datetime.utcnow()}},
    )

    user_id = doc["user_id"]
    asyncio.create_task(finexer_sync_pipeline(consent_id, user_id))

    return HTMLResponse("""<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
       text-align:center;padding:60px 24px;background:#0f172a;color:#e2e8f0;margin:0}
  .icon{font-size:56px;margin-bottom:16px}
  h1{color:#34d399;font-size:24px;margin:0 0 12px}
  p{color:#94a3b8;font-size:15px;line-height:1.6;margin:0 0 32px}
  .btn{display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;
       padding:14px 32px;border-radius:14px;font-size:16px;font-weight:600;
       cursor:pointer;border:none;-webkit-tap-highlight-color:transparent}
</style></head>
<body>
  <div class="icon">&#10003;</div>
  <h1>Bank connected!</h1>
  <p>Your account has been linked.<br>Transactions are syncing in the background.</p>
  <button class="btn" onclick="returnToApp()">Return to app</button>
  <script>
    function returnToApp(){window.location.href='wealthdash://auth-complete';}
    setTimeout(function(){
      var t=Date.now();
      window.location.href='wealthdash://auth-complete';
      setTimeout(function(){
        if(Date.now()-t<1800){window.location.href='/accounts';}
      },1500);
    },800);
  </script>
</body></html>
""")
