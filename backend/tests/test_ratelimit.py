from types import SimpleNamespace

from app.core.ratelimit import check_rate_limit, _hits


def _req(path: str, ip: str = "1.2.3.4"):
    return SimpleNamespace(
        url=SimpleNamespace(path=path),
        headers={"X-Real-IP": ip},
        client=SimpleNamespace(host=ip),
    )


def test_auth_limit_kicks_in():
    _hits.clear()
    for _ in range(30):
        assert check_rate_limit(_req("/auth/google")) is None
    resp = check_rate_limit(_req("/auth/google"))
    assert resp is not None and resp.status_code == 429


def test_limits_are_per_ip():
    _hits.clear()
    for _ in range(30):
        check_rate_limit(_req("/auth/google", ip="10.0.0.1"))
    # Different IP unaffected
    assert check_rate_limit(_req("/auth/google", ip="10.0.0.2")) is None


def test_unmatched_paths_not_limited():
    _hits.clear()
    for _ in range(100):
        assert check_rate_limit(_req("/accounts")) is None
