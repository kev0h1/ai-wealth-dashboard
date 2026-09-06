"""Tests for the `owner` field on POST /auth/session/validate (backlog A10).

The frontend's web-product lock (NEXT_PUBLIC_WEB_PRODUCT=off) needs to tell
the owner's own account apart from any other authorised sign-in so it can
keep the full product reachable for the owner while everyone else gets the
"Sorted is an app" shell. `validate_session()` derives this by lower-casing
and stripping the session's email and comparing it to PRIMARY_EMAIL
(app.core.config, the first entry of ALLOWED_EMAILS).

No TestClient/HTTP layer here, following the convention already established
in test_apple_auth.py / test_linked_identities.py: the route coroutine is
awaited directly via asyncio.run() with a minimal fake Request that only
needs a `.headers` mapping (the route only ever calls `.headers.get(...)`).
"""
import asyncio

import pytest
from fastapi import HTTPException

import app.routers.auth as auth_module
from app.core.config import PRIMARY_EMAIL, serializer


def _run(coro):
    return asyncio.run(coro)


class _FakeRequest:
    def __init__(self, headers):
        self.headers = headers


def _bearer_request(email: str, name: str = "Test User") -> _FakeRequest:
    token = serializer.dumps({"name": name, "email": email})
    return _FakeRequest({"Authorization": f"Bearer {token}"})


def test_owner_true_for_primary_email():
    result = _run(auth_module.validate_session(_bearer_request(PRIMARY_EMAIL)))
    assert result["valid"] is True
    assert result["owner"] is True


def test_owner_true_is_case_and_whitespace_insensitive():
    mixed_case = f"  {PRIMARY_EMAIL.upper()}  "
    result = _run(auth_module.validate_session(_bearer_request(mixed_case)))
    assert result["owner"] is True


def test_owner_false_for_other_authorised_email():
    result = _run(auth_module.validate_session(_bearer_request("someone-else@example.com")))
    assert result["valid"] is True
    assert result["owner"] is False


def test_no_bearer_header_rejected():
    with pytest.raises(HTTPException) as exc:
        _run(auth_module.validate_session(_FakeRequest({})))
    assert exc.value.status_code == 401
