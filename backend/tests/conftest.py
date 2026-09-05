import pytest

from app.services import response_cache


@pytest.fixture(autouse=True)
def _clear_response_cache():
    """`response_cache._caches` is process-global in-memory state (see
    app/services/response_cache.py's own module docstring) — by design, so
    a real request's write-then-read within the same 90 s window is a cache
    hit. Several unit tests call router handler functions directly with a
    shared/fixed test UID (e.g. tests/test_grow.py's `UID =
    "kevin@example.com"`), bypassing the per-request isolation an actual
    HTTP client would have. Without a reset between tests, a cache entry
    written by one test (e.g. grow_view's own "grow" cache, or
    get_cached_safe_to_spend's "safe_to_spend" read-through) leaks into a
    later test for the same UID and silently shadows that test's
    monkeypatched collaborators. Clearing before AND after each test keeps
    this test process's cache state from ever crossing a test boundary in
    either direction.
    """
    response_cache._caches.clear()
    yield
    response_cache._caches.clear()
