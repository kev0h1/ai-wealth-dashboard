"""C43: the Apple App Review demo identity.

One fixed synthetic user (DEMO_LOGIN_EMAIL) can sign in with a username and
password, because App Review cannot use Google or Apple sign-in. Everything
about it is deliberately narrow:

* Disabled unless DEMO_LOGIN_ENABLED is on AND DEMO_PASSWORD_HASH is set.
* The password only ever exists as a salted scrypt hash (`hash_password`).
* The identity is restricted whether or not the flag is on (`is_demo_user`):
  it can never start or refresh a bank connection, delete the account or start
  a purchase, and no sync job touches it (`assert_not_demo`, `demo_blocked`).
* No other sign-in path (Google, Apple) may ever resolve to this identity
  (see app.core.identity).

Hash format: ``scrypt$<n>$<r>$<p>$<salt b64>$<hash b64>`` (n is the cost, a power of two).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets

from fastapi import HTTPException

from app.core import config

_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024
_KEY_LEN = 32

DEMO_RESTRICTED_CODE = "DEMO_RESTRICTED"
DEMO_RESTRICTED_MESSAGE = "This is a demo account, so that is switched off here."

# (method, path regex) pairs a demo session may never call. Enforced centrally
# in app.core.auth.current_user so a new route cannot forget it, on top of the
# service-level guards in the sync, consent and billing code.
_BLOCKED = [
    ("GET", r"^/auth/finexer/(link|providers|pending)$"),
    ("POST", r"^/auth/finexer/consents/[^/]+/reconfirm$"),
    ("GET", r"^/auth/truelayer/(link|providers)$"),
    ("POST", r"^/accounts/sync$"),
    ("POST", r"^/accounts/sync-history$"),
    ("POST", r"^/accounts/[^/]+/refresh$"),
    ("DELETE", r"^/account$"),
    ("(POST|DELETE)", r"^/auth/identities/apple$"),
    ("DELETE", r"^/connections/[^/]+$"),
    ("POST", r"^/oauth/decision$"),
    ("GET", r"^/penny/conversations/export$"),
    ("POST", r"^/billing/(checkout|portal)$"),
    ("POST", r"^/billing/apple/verify$"),
    ("GET", r"^/billing/apple/account-token$"),
    # A one-time migration that flips every card transaction's direction for
    # the caller, with no owner gate: it would corrupt the shared demo data.
    ("POST", r"^/admin/fix-card-transactions$"),
    ("POST", r"^/billing/play/purchase$"),
    ("POST", r"^/subscription/select-free$"),
]
_BLOCKED_RE = [(m, re.compile(p)) for m, p in _BLOCKED]


def is_demo_user(email: str | None) -> bool:
    """True for the demo identity, regardless of whether demo login is on."""
    if not email or not isinstance(email, str):
        return False
    return email.strip().lower() == config.DEMO_LOGIN_EMAIL


def demo_login_enabled() -> bool:
    return bool(config.DEMO_LOGIN_ENABLED and config.DEMO_PASSWORD_HASH)


def demo_restricted_error() -> HTTPException:
    return HTTPException(
        status_code=403,
        detail={"code": DEMO_RESTRICTED_CODE, "message": DEMO_RESTRICTED_MESSAGE},
    )


def assert_not_demo(email: str | None) -> None:
    """Raise a calm 403 when `email` is the demo identity."""
    if is_demo_user(email):
        raise demo_restricted_error()


def demo_blocked(email: str | None, method: str, path: str) -> bool:
    """True when a demo session calling method+path must be refused."""
    if not is_demo_user(email):
        return False
    method = (method or "").upper()
    return any(re.fullmatch(m, method) and rx.match(path.rstrip("/") or "/") for m, rx in _BLOCKED_RE)


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    salt = salt if salt is not None else secrets.token_bytes(16)
    key = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N,
        r=_SCRYPT_R, p=_SCRYPT_P, maxmem=_SCRYPT_MAXMEM, dklen=_KEY_LEN,
    )
    b64 = lambda b: base64.b64encode(b).decode("ascii")  # noqa: E731
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${b64(salt)}${b64(key)}"


def _parse(stored: str):
    try:
        scheme, n, r, p, salt_b64, key_b64 = stored.split("$")
        if scheme != "scrypt":
            return None
        return int(n), int(r), int(p), base64.b64decode(salt_b64, validate=True), base64.b64decode(key_b64, validate=True)
    except Exception:
        return None


# A valid hash of a random value nobody knows, so the "wrong user" and
# "not configured" paths still pay one scrypt verification.
_DUMMY_HASH = hash_password(secrets.token_urlsafe(24))


def verify_password(password: str, stored: str) -> bool:
    """Constant-time scrypt verification. Never raises; False on any problem."""
    parsed = _parse(stored or "")
    if parsed is None or not (2 ** 10 <= parsed[0] <= 2 ** 17 and parsed[0] & (parsed[0] - 1) == 0) or not (1 <= parsed[1] <= 16) or not (1 <= parsed[2] <= 4):
        parsed = _parse(_DUMMY_HASH)
        well_formed = False
    else:
        well_formed = True
    n, r, p, salt, key = parsed
    try:
        candidate = hashlib.scrypt(
            (password or "").encode("utf-8"), salt=salt, n=n, r=r, p=p,
            maxmem=_SCRYPT_MAXMEM, dklen=len(key),
        )
    except Exception:
        return False
    return hmac.compare_digest(candidate, key) and well_formed


def check_demo_credentials(username: str, password: str) -> bool:
    """Same work for every outcome: one scrypt verification, then constant-time
    comparisons of both the username and the password result."""
    stored = config.DEMO_PASSWORD_HASH or _DUMMY_HASH
    pw_ok = verify_password(password if isinstance(password, str) else "", stored)
    user_ok = hmac.compare_digest(
        (username if isinstance(username, str) else "").strip().lower().encode("utf-8"),
        config.DEMO_LOGIN_EMAIL.encode("utf-8"),
    )
    configured = bool(config.DEMO_PASSWORD_HASH)
    return bool(pw_ok & user_ok & configured)
