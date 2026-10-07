"""A148: same-origin bank logos. /logo/provider/{id} serves a logo fetched once
from OUR provider list's logo_url, under strict fetch guards, cached in Mongo.
No network and no real Mongo: httpx and the collection are faked."""
import asyncio
from types import SimpleNamespace

import pytest

import app.routers.logos as logos
import app.routers.finexer as finexer_router
from app.core import ratelimit
from app.core.ratelimit import check_rate_limit

PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 600
GOOD_URL = "https://finexer.blob.core.windows.net/logos/aib.png"


def _run(coro):
    return asyncio.run(coro)


class _FakeCol:
    def __init__(self):
        self.docs = {}
        self.reads = 0

    async def find_one(self, q):
        self.reads += 1
        return self.docs.get(q["_id"])

    async def replace_one(self, q, doc, upsert=False):
        self.docs[q["_id"]] = doc


class _FakeStreamResp:
    def __init__(self, status=200, ctype="image/png", body=PNG, headers=None):
        self.status_code = status
        self.headers = {"content-type": ctype, **(headers or {})}
        self._body = body

    async def aiter_bytes(self):
        for i in range(0, len(self._body), 4096):
            yield self._body[i:i + 4096]

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def _fake_client(resp, calls, kwargs_seen=None):
    class _Client:
        def __init__(self, **kw):
            if kwargs_seen is not None:
                kwargs_seen.update(kw)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        def stream(self, method, url):
            calls.append(url)
            return resp

    return _Client


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    col = _FakeCol()
    monkeypatch.setattr(logos, "provider_logos_col", col)
    logos._lru.clear()
    logos._neg.clear()

    async def _providers(*a, **k):
        return [{"id": "aib", "name": "AIB", "logo": GOOD_URL}, {"id": "nologo", "name": "X", "logo": ""}]

    monkeypatch.setattr(logos, "list_providers", _providers)

    async def _not_ok():
        return False

    monkeypatch.setattr(ratelimit, "redis_ok", _not_ok)
    ratelimit._hits.clear()
    yield col
    ratelimit._hits.clear()


def _req(inm=None):
    return SimpleNamespace(headers={"if-none-match": inm} if inm else {})


def _get(pid, req=None):
    return _run(logos.provider_logo(pid, req or _req()))


def test_unknown_provider_id_is_404_and_never_fetches(monkeypatch):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(), calls))
    assert _get("nope").status_code == 404
    assert _get("../etc/passwd").status_code == 404
    assert calls == []


def test_provider_without_logo_is_404(monkeypatch):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(), calls))
    assert _get("nologo").status_code == 404
    assert calls == []


@pytest.mark.parametrize("url", [
    "https://evil.example.com/logos/aib.png",
    "https://finexer.blob.core.windows.net.evil.com/a.png",
    "http://finexer.blob.core.windows.net/logos/aib.png",
    "https://finexer.blob.core.windows.net:8443/logos/aib.png",
    "https://user@finexer.blob.core.windows.net/logos/aib.png",
    "https://169.254.169.254/latest/meta-data",
    "",
    None,
])
def test_host_allow_list_rejects_other_urls(monkeypatch, url):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(), calls))
    assert _run(logos._download_logo(url)) is None
    assert calls == []


def test_non_image_content_type_rejected(monkeypatch):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(ctype="text/html"), calls))
    assert _run(logos._download_logo(GOOD_URL)) is None
    assert _get("aib").status_code == 404


def test_oversize_body_rejected(monkeypatch):
    big = b"x" * (logos._LOGO_MAX_BYTES + 1)
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(body=big), []))
    assert _run(logos._download_logo(GOOD_URL)) is None


def test_oversize_content_length_rejected(monkeypatch):
    resp = _FakeStreamResp(headers={"content-length": str(logos._LOGO_MAX_BYTES + 1)})
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(resp, []))
    assert _run(logos._download_logo(GOOD_URL)) is None


def test_redirect_is_not_followed(monkeypatch):
    seen, calls = {}, []
    resp = _FakeStreamResp(status=302, headers={"location": "http://169.254.169.254/"})
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(resp, calls, seen))
    assert _run(logos._download_logo(GOOD_URL)) is None
    assert seen["follow_redirects"] is False
    assert seen["timeout"] == 5.0
    assert calls == [GOOD_URL]


def test_fetch_stores_in_mongo_then_serves_from_cache_without_refetch(monkeypatch, _isolate):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(), calls))
    r = _get("aib")
    assert r.status_code == 200 and r.body == PNG
    assert r.media_type == "image/png"
    assert "max-age=86400" in r.headers["cache-control"] and "public" in r.headers["cache-control"]
    assert r.headers["etag"]
    assert _isolate.docs["aib"]["data"] == PNG
    assert len(calls) == 1

    # LRU hit, then (LRU cleared, as after a restart) Mongo hit: no refetch either way.
    assert _get("aib").status_code == 200
    logos._lru.clear()
    assert _get("aib").body == PNG
    assert len(calls) == 1

    # Conditional request is answered 304.
    assert _get("aib", _req(r.headers["etag"])).status_code == 304


def test_failed_fetch_is_404_and_not_retried_immediately(monkeypatch):
    calls = []
    monkeypatch.setattr(logos.httpx, "AsyncClient", _fake_client(_FakeStreamResp(status=500), calls))
    assert _get("aib").status_code == 404
    assert _get("aib").status_code == 404
    assert len(calls) == 1


def test_provider_logo_route_is_rate_limited():
    limit = next(l for p, l, _w in ratelimit.RULES if p == "/logo/provider/")
    assert limit >= 60  # a picker opens with every provider logo at once
    req = SimpleNamespace(
        url=SimpleNamespace(path="/logo/provider/aib"),
        headers={"X-Real-IP": "203.0.113.150"},
        client=SimpleNamespace(host="203.0.113.150"),
    )
    for _ in range(limit):
        assert _run(check_rate_limit(req)) is None
    assert _run(check_rate_limit(req)).status_code == 429


def test_provider_list_emits_same_origin_path(monkeypatch):
    async def _providers():
        return [
            {"id": "b", "name": "Beta", "logo": GOOD_URL, "bg_colors": []},
            {"id": "a", "name": "Alpha", "logo": "", "bg_colors": []},
        ]

    monkeypatch.setattr(finexer_router, "list_providers", _providers)
    monkeypatch.setattr(finexer_router, "_providers_cache", [])
    out = _run(finexer_router.finexer_providers(user={"email": "t@example.com"}))
    assert [p["id"] for p in out] == ["a", "b"]
    assert out[0]["logo"] == ""
    assert out[1]["logo"] == "/logo/provider/b"
    assert all("blob.core.windows.net" not in p["logo"] for p in out)
