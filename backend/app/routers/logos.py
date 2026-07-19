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
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, Response

from app.core.config import LOGODEV_TOKEN

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
