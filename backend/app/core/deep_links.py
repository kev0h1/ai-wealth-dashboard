"""The single native deep-link contract (A68).

Mirrors shared/deep-links.json, which the frontend (lib/deepLinks.ts) and the
native shell registration also follow. The two path segments are frozen: installed
app binaries bundle older client code whose appUrlOpen regex matches
/auth-(done|complete)/, so only query parameters may be added on top.
"""
from urllib.parse import urlencode

DEEP_LINK_SCHEME = "wealthdash"
SIGNIN_RETURN_PATH = "auth-done"
BANK_RETURN_PATH = "auth-complete"


def signin_return_url() -> str:
    return f"{DEEP_LINK_SCHEME}://{SIGNIN_RETURN_PATH}"


def bank_return_url(provider: str, connection_id: str, status: str = "ok") -> str:
    query = urlencode({"provider": provider, "connection": connection_id, "status": status})
    return f"{DEEP_LINK_SCHEME}://{BANK_RETURN_PATH}?{query}"
