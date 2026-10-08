"""Privacy-preserving logo proxy: fetches merchant logos server-side and
caches them, so the browser never leaks merchant browsing data to a third
party.

Resolution order:
  1. Logo.dev (high-res PNG) — used when LOGODEV_TOKEN is set.
  2. Google favicon service (128-px) — fallback when Logo.dev is unavailable,
     unset, or returns a too-small placeholder.
  3. 404 — both upstreams missed; the frontend shows its coloured-initial
     fallback.

Cache layout: backend/.logo_cache/{source}/{domain}.png
  source = "logodev" | "favicon"
This namespace prevents stale low-res Google files from being served after a
Logo.dev token is later added to .env."""
import asyncio
import logging
import re
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Request, Response

from app.core.config import LOGODEV_TOKEN
from app.db.collections import provider_logos_col
from app.services.finexer_sync import list_providers

logger = logging.getLogger(__name__)

router = APIRouter()

_DOMAIN_RE = re.compile(r"^[a-z0-9.\-]{1,100}$")
# parents[2] = backend/ — keeps the cache inside the backend/.logo_cache/
# path that .gitignore already covers recursively.
_CACHE_ROOT = Path(__file__).resolve().parents[2] / ".logo_cache"

_HEADERS = {"Cache-Control": "public, max-age=604800"}


def _cache_dir(source: str) -> Path:
    """Return (and create) the per-source cache subdirectory."""
    d = _CACHE_ROOT / source
    d.mkdir(parents=True, exist_ok=True)
    return d


def _serve(content: bytes) -> Response:
    return Response(content=content, media_type="image/png", headers=_HEADERS)


async def _fetch_logodev(domain: str) -> bytes | None:
    """Fetch from Logo.dev. Returns raw bytes on success, None on any miss."""
    cached = _cache_dir("logodev") / f"{domain}.png"
    if cached.exists():
        return cached.read_bytes()

    url = (
        f"https://img.logo.dev/{domain}"
        f"?token={LOGODEV_TOKEN}&size=128&format=png&retina=true"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url, follow_redirects=True)
    except Exception:
        return None

    # Logo.dev real logos are several KB; a tiny response is a placeholder.
    if r.status_code != 200 or len(r.content) <= 512:
        return None

    cached.write_bytes(r.content)
    return r.content


async def _fetch_favicon(domain: str) -> bytes | None:
    """Fetch from Google's favicon service. Returns raw bytes on success, None on miss."""
    cached = _cache_dir("favicon") / f"{domain}.png"
    if cached.exists():
        return cached.read_bytes()

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(
                f"https://www.google.com/s2/favicons?domain={domain}&sz=128",
                follow_redirects=True,
            )
    except Exception:
        return None

    # Google returns a generic globe icon rather than 404 for unknown domains;
    # tiny responses are that placeholder — treat them as a miss so the
    # frontend's initials fallback kicks in instead of a grey globe.
    if r.status_code != 200 or len(r.content) < 200:
        return None

    cached.write_bytes(r.content)
    return r.content


@router.get("/logo/{domain}")
async def logo_proxy(domain: str) -> Response:
    if not _DOMAIN_RE.match(domain):
        return Response(status_code=400, content=b"Invalid domain")

    # ── 1. Logo.dev (only when a token is configured) ────────────────────────
    if LOGODEV_TOKEN:
        content = await _fetch_logodev(domain)
        if content:
            return _serve(content)

    # ── 2. Google favicon fallback ───────────────────────────────────────────
    content = await _fetch_favicon(domain)
    if content:
        return _serve(content)

    # ── 3. Both upstreams missed ─────────────────────────────────────────────
    return Response(status_code=404)


# ── A148: same-origin bank (provider) logos ──────────────────────────────────
# The bank picker used to render Finexer's remote logo_url directly, which the
# site's img-src 'self' CSP blocks. We fetch each provider's logo ONCE from the
# URL in OUR OWN provider list (never a caller-supplied URL), keep the bytes in
# Mongo (Railway's filesystem is ephemeral) with a small in-process LRU on top,
# and serve them from /logo/provider/{id}. That prefix sits under the open,
# rate-limited /logo/ branch of auth_middleware (own RULES entry, A95 family).
_PROVIDER_ID_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")
_LOGO_HOSTS = frozenset({"finexer.blob.core.windows.net"})
_LOGO_TYPES = frozenset({"image/png", "image/svg+xml", "image/webp", "image/jpeg"})
_LOGO_MAX_BYTES = 256 * 1024
_LOGO_TIMEOUT = 5.0
_LRU_MAX = 128
_NEG_TTL = 300.0  # seconds a failed fetch is remembered, so a bad logo is not refetched per request

_lru: "OrderedDict[str, tuple[str, bytes, float]]" = OrderedDict()
_neg: dict[str, float] = {}

_PROVIDER_HEADERS = {
    "Cache-Control": "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    # An SVG opened directly on our origin must not be able to run script.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
}


def provider_logo_path(provider_id: str, logo: str | None) -> str:
    """The same-origin path for a provider's logo, or "" when it has none."""
    return f"/logo/provider/{provider_id}" if logo and provider_id else ""


def _allowed_logo_url(url: object) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and parts.hostname in _LOGO_HOSTS
        and port in (None, 443)
        and not parts.username
        and not parts.password
    )


async def _download_logo(url: str) -> tuple[str, bytes] | None:
    """Fetch one allow-listed logo. None on any policy or network failure."""
    if not _allowed_logo_url(url):
        return None
    try:
        async with httpx.AsyncClient(timeout=_LOGO_TIMEOUT, follow_redirects=False, trust_env=False) as client:
            async with client.stream("GET", url) as r:
                if r.status_code != 200:
                    return None
                ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
                if ctype not in _LOGO_TYPES:
                    return None
                declared = r.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > _LOGO_MAX_BYTES:
                    return None
                buf = bytearray()
                async for chunk in r.aiter_bytes():
                    buf.extend(chunk)
                    if len(buf) > _LOGO_MAX_BYTES:
                        return None
    except Exception:
        logger.warning("provider logo fetch failed")
        return None
    if not buf:
        return None
    return ctype, bytes(buf)


_LRU_REVALIDATE = 3600.0   # seconds before an LRU hit re-checks source_url / age
_REFRESH_AFTER = timedelta(days=30)
_NEG_MAX = 2048
_LOCKS_MAX = 256
_locks: dict[str, asyncio.Lock] = {}


def _lru_put(provider_id: str, value: tuple[str, bytes]) -> None:
    _lru[provider_id] = (value[0], value[1], time.monotonic() + _LRU_REVALIDATE)
    _lru.move_to_end(provider_id)
    while len(_lru) > _LRU_MAX:
        _lru.popitem(last=False)


def _neg_put(provider_id: str) -> None:
    now = time.monotonic()
    if len(_neg) >= _NEG_MAX:
        for k in [k for k, v in _neg.items() if v <= now]:
            del _neg[k]
        if len(_neg) >= _NEG_MAX:
            _neg.clear()
    _neg[provider_id] = now + _NEG_TTL


def _lock_for(provider_id: str) -> asyncio.Lock:
    lock = _locks.get(provider_id)
    if lock is None:
        if len(_locks) >= _LOCKS_MAX:
            for k in [k for k, v in _locks.items() if not v.locked()]:
                del _locks[k]
        lock = _locks[provider_id] = asyncio.Lock()
    return lock


def _provider_response(request: Request, content_type: str, data: bytes) -> Response:
    etag = '"' + sha256(data).hexdigest()[:32] + '"'
    headers = {**_PROVIDER_HEADERS, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=content_type, headers=headers)


def _aware(dt):
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _load_provider_logo(provider_id: str) -> tuple[str, bytes] | None:
    if _neg.get(provider_id, 0.0) > time.monotonic():
        return None
    hit = _lru.get(provider_id)
    if hit is not None and hit[2] > time.monotonic():
        _lru.move_to_end(provider_id)
        return hit[0], hit[1]
    # Single-flight per id: concurrent cold requests share one fetch.
    async with _lock_for(provider_id):
        if _neg.get(provider_id, 0.0) > time.monotonic():
            return None
        hit = _lru.get(provider_id)
        if hit is not None and hit[2] > time.monotonic():
            return hit[0], hit[1]
        return await _load_locked(provider_id, hit)


async def _load_locked(provider_id: str, lru_hit) -> tuple[str, bytes] | None:
    try:
        doc = await provider_logos_col.find_one({"_id": provider_id})
    except Exception:
        logger.warning("provider logo cache read failed")
        doc = None
    stale = None
    if doc and doc.get("data") and doc.get("content_type") in _LOGO_TYPES:
        stale = (doc["content_type"], bytes(doc["data"]))
    elif lru_hit is not None:
        stale = (lru_hit[0], lru_hit[1])

    # Only ever a provider from OUR list; its logo URL is not caller-supplied.
    provider = next((p for p in await list_providers() if p.get("id") == provider_id), None)
    if provider is None:
        _neg_put(provider_id)  # unknown id: do not re-walk providers per request
        return None
    current_url = provider.get("logo") or ""

    if stale is not None:
        fetched_at = _aware((doc or {}).get("fetched_at"))
        fresh = (
            (doc or {}).get("source_url") == current_url
            and isinstance(fetched_at, datetime)
            and datetime.now(timezone.utc) - fetched_at < _REFRESH_AFTER  # naive-ok: cache age
        ) if doc else True
        if fresh:
            _lru_put(provider_id, stale)
            return stale

    fetched = await _download_logo(current_url)
    if fetched is None:
        if stale is not None:  # keep serving the stale copy if a refresh fails
            _lru_put(provider_id, stale)
            return stale
        _neg_put(provider_id)
        return None
    try:
        await provider_logos_col.replace_one(
            {"_id": provider_id},
            {
                "_id": provider_id,
                "content_type": fetched[0],
                "data": fetched[1],
                "fetched_at": datetime.now(timezone.utc),  # naive-ok: persisted cache timestamp, not user-facing
                "source_url": current_url,
            },
            upsert=True,
        )
    except Exception:
        logger.warning("provider logo cache write failed")
    _lru_put(provider_id, fetched)
    return fetched


@router.get("/logo/provider/{provider_id}")
async def provider_logo(provider_id: str, request: Request) -> Response:
    if not _PROVIDER_ID_RE.match(provider_id):
        return Response(status_code=404)
    loaded = await _load_provider_logo(provider_id)
    if loaded is None:
        return Response(status_code=404)
    return _provider_response(request, *loaded)
