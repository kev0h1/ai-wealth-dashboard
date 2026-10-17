"""Google Play Billing routes (C24).

  POST /webhooks/google-play   Pub/Sub push receiver for Real-time Developer
                               Notifications. Public path (the auth middleware
                               exempts "/webhooks/") and rate-limited like the
                               other receivers; authenticated here by the push
                               subscription's OIDC token, or by a shared secret
                               when OIDC is not configured.
  GET  /billing/play/config    product ids, account id and block reason for the
                               signed-in user (the Android purchase screen).
  POST /billing/play/purchase  "this purchase finished / restore it": hands the
                               purchase token to the server, which verifies it
                               with the Developer API. The client never grants
                               entitlement; this is the B31 backstop's one
                               allowed path from a native client to a paid tier.

Failure shape: 401 bad or missing push auth, 400 malformed, 503 when Play
billing is off or a dependency is down (Pub/Sub then redelivers). Never a 500
with detail, never a token or key in a response or a log line.
"""
import hmac
import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core import play_config
from app.core.auth import current_user
from app.services import google_play, play_billing
from app.services.play_billing import PlayNotEnabled, PlayRefused, PlayUnavailable

logger = logging.getLogger(__name__)

router = APIRouter(tags=["play-billing"])

_MAX_PUSH_BYTES = 64 * 1024
_UNAVAILABLE = {"code": "PLAY_UNAVAILABLE", "message": "Temporarily unavailable. Try again shortly."}


def receiver_auth_mode() -> str | None:
    """"oidc", "secret" or None. OIDC needs both an audience and the push
    service account's email, so a half-configured OIDC never silently
    degrades to "no check"; it is simply not a usable mode."""
    if play_config.PLAY_RTDN_OIDC_AUDIENCE and play_config.PLAY_RTDN_OIDC_EMAIL:
        return "oidc"
    if play_config.PLAY_RTDN_OIDC_AUDIENCE or play_config.PLAY_RTDN_OIDC_EMAIL:
        return None
    if play_config.PLAY_RTDN_SHARED_SECRET:
        return "secret"
    return None


async def _authenticate_push(request: Request) -> None:
    mode = receiver_auth_mode()
    if mode is None:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    if mode == "oidc":
        header = request.headers.get("authorization") or ""
        scheme, _, bearer = header.partition(" ")
        if scheme.lower() != "bearer" or not bearer.strip():
            raise HTTPException(status_code=401, detail="Unauthorized")
        try:
            await google_play.get_oidc_verifier().verify(
                bearer.strip(), audience=play_config.PLAY_RTDN_OIDC_AUDIENCE, email=play_config.PLAY_RTDN_OIDC_EMAIL,
            )
        except google_play.OidcRejected:
            raise HTTPException(status_code=401, detail="Unauthorized")
        except Exception as exc:
            # Could not reach Google's keys: not the caller's fault, retryable.
            logger.error("play billing: oidc check unavailable (%s)", type(exc).__name__)
            raise HTTPException(status_code=503, detail=_UNAVAILABLE)
        return
    supplied = request.query_params.get("token") or request.headers.get("x-play-rtdn-secret") or ""
    if not supplied or not hmac.compare_digest(supplied.encode(), play_config.PLAY_RTDN_SHARED_SECRET.encode()):
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/webhooks/google-play", status_code=200)
async def google_play_webhook(request: Request):
    if not play_config.PLAY_IAP_ENABLED:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    await _authenticate_push(request)
    raw = await request.body()
    if len(raw) > _MAX_PUSH_BYTES:
        raise HTTPException(status_code=400, detail="Malformed notification")
    try:
        import json
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed notification")
    try:
        outcome = await play_billing.handle_push(body)
    except PlayRefused as exc:
        # Malformed envelope or wrong package: permanent, 4xx.
        raise HTTPException(status_code=400, detail="Malformed notification")
    except (PlayUnavailable, PlayNotEnabled):
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    except Exception as exc:
        logger.error("play billing: receiver failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    return {"ok": True, "idempotent": bool(outcome.get("idempotent"))}


@router.get("/billing/play/config")
async def play_config_for_user(user: dict = Depends(current_user)):
    try:
        return await play_billing.client_config(user["email"])
    except PlayNotEnabled:
        return {"enabled": False}
    except Exception as exc:
        logger.error("play billing: config failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)


@router.post("/billing/play/purchase")
async def play_verify_purchase(body: dict, user: dict = Depends(current_user)):
    """{purchase_token, product_id} -> a summary of what the server verified.
    Idempotent: restoring or re-sending the same purchase changes nothing."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Malformed request")
    try:
        return await play_billing.verify_client_purchase(
            user["email"], body.get("purchase_token"), body.get("product_id"),
        )
    except PlayNotEnabled:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    except PlayRefused as exc:
        raise HTTPException(status_code=400, detail={"code": "PLAY_PURCHASE_REFUSED", "message": play_billing.refusal_message(exc.code)})
    except PlayUnavailable:
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
    except Exception as exc:
        logger.error("play billing: verify failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=503, detail=_UNAVAILABLE)
