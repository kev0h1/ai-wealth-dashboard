"""CORS origin allowlist coverage (A12).

The app is imported directly (no TestClient/HTTP layer, no live Mongo
needed — importing app.main only builds the Starlette app + middleware
stack, it doesn't open a DB connection). We inspect app.user_middleware for
the CORSMiddleware entry's own constructor kwargs rather than sending real
requests, so this stays a pure unit test of main.py's `_cors_origins` list.
"""
from starlette.middleware.cors import CORSMiddleware

from app.core.config import APP_URL, API_PUBLIC_URL
from app.main import app


def _cors_kwargs():
    for mw in app.user_middleware:
        if mw.cls is CORSMiddleware:
            return mw.kwargs
    raise AssertionError("CORSMiddleware not found in app.user_middleware")


def test_cors_allows_app_and_api_domains():
    origins = _cors_kwargs()["allow_origins"]
    assert APP_URL in origins
    assert API_PUBLIC_URL in origins
    assert "https://localhost" in origins
    assert "capacitor://localhost" in origins


def test_cors_origins_have_no_duplicates():
    origins = _cors_kwargs()["allow_origins"]
    assert len(origins) == len(set(origins))
