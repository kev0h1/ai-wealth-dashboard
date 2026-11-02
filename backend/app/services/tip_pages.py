"""G405: page text for the shared tip research.

A search snippet is 250 characters and rarely holds both a provider's name and
its monthly price, so the G315 like-for-like gate dropped almost every market
listing. This module fetches the allowlisted pages the search returned and
hands their text to the same G315 rules, which are unchanged: the page text is
simply more of that host's own text.

Rules (every one fails to the snippet path and counts, none raises):
  - only a host that `tip_facts.allowed_source_name` accepts is ever fetched;
  - https only, at most MAX_PAGES pages per research, one request per page;
  - redirects are followed by hand and only within the same host;
  - text only (text/* or xhtml), at most MAX_BYTES read, MAX_CHARS kept;
  - tags, scripts and styles are stripped, whitespace is collapsed to single
    spaces (so a page can never forge a "Page host:" tag, which is split on a
    blank line);
  - a User-Agent is set and the timeout is TIMEOUT seconds.
The page text is never stored: only the findings built from it are.
"""
from __future__ import annotations

import html
import logging
import re
from typing import Optional
from urllib.parse import urljoin

import httpx

from app.services import tip_facts

log = logging.getLogger(__name__)

TIMEOUT = 10.0
MAX_PAGES = 3
MAX_BYTES = 400_000
MAX_CHARS = 4000
MAX_REDIRECTS = 3
USER_AGENT = "SortedTipResearch/1.0 (+https://wealth.auriqltd.co.uk)"

_BLOCK_RE = re.compile(r"<(script|style|noscript|svg|head|template)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_TAG_RE = re.compile(r"<[^>]*>")
_REDIRECTS = (301, 302, 303, 307, 308)


def html_to_text(raw: str, limit: int = MAX_CHARS) -> str:
    """Visible text of an HTML (or plain text) body: scripts, styles and tags
    removed, entities decoded, whitespace collapsed to single spaces."""
    t = _COMMENT_RE.sub(" ", raw or "")
    t = _BLOCK_RE.sub(" ", t)
    t = _TAG_RE.sub(" ", t)
    t = html.unescape(t).replace("\xa0", " ")
    return " ".join(t.split())[:limit]


class _Refused(Exception):
    """A fetch that was refused by a rule (off-host redirect, bad type, status)."""


async def fetch_url_text(client: httpx.AsyncClient, url: str) -> str:
    """The page text for `url`, or raise. Redirects stay on the original host."""
    host = tip_facts.host_of(url)
    cur = url
    for _ in range(MAX_REDIRECTS + 1):
        if not cur.startswith("https://") or tip_facts.host_of(cur) != host:
            raise _Refused("off_host")
        async with client.stream(
            "GET", cur, headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain"},
            follow_redirects=False,
        ) as r:
            if r.status_code in _REDIRECTS:
                loc = r.headers.get("location")
                if not loc:
                    raise _Refused("redirect")
                cur = urljoin(cur, loc)
                continue
            if r.status_code != 200:
                raise _Refused("status")
            ctype = (r.headers.get("content-type") or "").lower()
            if not (ctype.startswith("text/") or "xhtml" in ctype):
                raise _Refused("type")
            buf = b""
            async for chunk in r.aiter_bytes():
                buf += chunk
                if len(buf) >= MAX_BYTES:
                    buf = buf[:MAX_BYTES]
                    break
        return html_to_text(buf.decode("utf-8", errors="replace"))
    raise _Refused("redirects")


def new_stats() -> dict:
    return {
        "pages_fetched": 0, "pages_failed": 0,
        "listings_from_pages": 0, "listings_from_snippets": 0,
        "regulator_read": 0, "regulator_failed": 0,
    }


async def fetch_pages(
    urls: list[str], provider_name: Optional[str], stats: dict, client: Optional[httpx.AsyncClient] = None,
) -> dict[str, str]:
    """host -> page text for the allowlisted URLs among `urls` (first MAX_PAGES,
    one page per host). Counts every attempt in `stats`. Never raises."""
    todo: list[tuple[str, str]] = []
    for u in urls or []:
        host = tip_facts.host_of(u)
        if not str(u).startswith("https://") or not host or any(h == host for h, _ in todo):
            continue
        if tip_facts.allowed_source_name(host, provider_name) is None:
            continue
        todo.append((host, u))
        if len(todo) >= MAX_PAGES:
            break
    out: dict[str, str] = {}
    if not todo:
        return out
    own = client is None
    try:
        c = client or httpx.AsyncClient(timeout=TIMEOUT)
    except Exception:
        stats["pages_failed"] += len(todo)
        return out
    try:
        for host, u in todo:
            try:
                text = await fetch_url_text(c, u)
            except Exception as e:
                log.warning("tip pages: fetch failed host=%s (%s)", host, type(e).__name__)
                stats["pages_failed"] += 1
                continue
            if text:
                out[host] = text
                stats["pages_fetched"] += 1
            else:
                stats["pages_failed"] += 1
    finally:
        if own:
            try:
                await c.aclose()
            except Exception:
                pass
    return out
