"""A110: a small authenticated diagnostics surface for verifying the
trusted-proxy hop counts after a production release. Nobody can measure
production's real X-Forwarded-For hop count before deploying (see
docs/ops/ENV.md's TRUSTED_PROXY_HOPS row), so Kevin opens GET
/diagnostics/proxy once from the web app and once from the mobile app to
confirm each path resolves the way the release checklist expects.
"""
from fastapi import APIRouter, Depends, Request

from app.core.auth import current_user
from app.core.ratelimit import client_ip_diagnostics

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])


@router.get("/proxy")
async def proxy_diagnostics(request: Request, user: dict = Depends(current_user)):
    """Never returns a raw header value or the proxy secret, only derived
    facts: see app.core.ratelimit.client_ip_diagnostics."""
    return client_ip_diagnostics(request)
