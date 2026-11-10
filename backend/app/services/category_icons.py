"""Server-side category icon catalogue and one-time automatic selection.

The JSON manifest is shared with the frontend so stored keys always name
bundled Phosphor regular artwork.  This module never fetches icon geometry.
"""
from __future__ import annotations

import asyncio
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import OPENROUTER_API_KEY
from app.core.llm import openrouter_chat


_MANIFEST_PATH = Path(__file__).resolve().parents[3] / "shared" / "category-icons.json"
_MODEL_TIMEOUT_SECONDS = 4.0


@lru_cache(maxsize=1)
def _manifest() -> dict:
    """Load and minimally validate the versioned, repository-owned catalogue."""
    with _MANIFEST_PATH.open(encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("version") != 1 or manifest.get("weight") != "regular":
        raise RuntimeError("Unsupported category icon manifest")
    keys = {entry.get("key") for entry in manifest.get("icons", []) if isinstance(entry, dict)}
    fallback = manifest.get("fallback")
    if not isinstance(fallback, str) or fallback not in keys:
        raise RuntimeError("Category icon manifest has no valid fallback")
    return manifest


def fallback_icon_key() -> str:
    return _manifest()["fallback"]


def icon_keys() -> frozenset[str]:
    return frozenset(entry["key"] for entry in _manifest()["icons"] if isinstance(entry, dict) and isinstance(entry.get("key"), str))


def builtin_icon_key(name: str) -> str:
    return _manifest().get("categories", {}).get(name, fallback_icon_key())


def valid_icon_key(value: object) -> bool:
    return isinstance(value, str) and value in icon_keys()


def normalise_stored_icon(value: object) -> str | None:
    """Accept only current bundled keys, mapping prior Lucide local choices."""
    if valid_icon_key(value):
        return value
    if isinstance(value, str):
        legacy = _manifest().get("legacyKeys", {}).get(value)
        return legacy if valid_icon_key(legacy) else None
    return None


def normalise_icon_source(value: object) -> str | None:
    return value if isinstance(value, str) and value in {"auto", "user"} else None


def deterministic_icon(name: str, kind: str | None = None) -> str | None:
    """Return a keyword match, leaving an unmatched creation for the model."""
    text = "".join(char for char in unicodedata.normalize("NFKD", name or "") if not unicodedata.combining(char))
    text = " ".join(text.casefold().split())
    for item in _manifest().get("keywords", []):
        if not isinstance(item, dict) or item.get("kind") not in (None, kind):
            continue
        pattern, key = item.get("pattern"), item.get("key")
        if isinstance(pattern, str) and valid_icon_key(key) and re.search(pattern, text, re.IGNORECASE):
            return key
    return None


def backfill_icon(name: str, kind: str | None = None) -> str:
    """Bounded migration choice: it never invokes a model for historic data."""
    return deterministic_icon(name, kind) or fallback_icon_key()


async def choose_automatic_icon(name: str, kind: str | None, uid: str) -> str:
    """Choose once at creation: keywords first, then a tightly bounded model call."""
    chosen = deterministic_icon(name, kind)
    if chosen:
        return chosen
    if not OPENROUTER_API_KEY:
        return fallback_icon_key()
    allowed = sorted(icon_keys())
    prompt = (
        "Choose one category icon key. Return only JSON {\"icon_key\": \"...\"}. "
        f"Category name: {name!r}. Category kind: {kind or 'discretionary'}. "
        f"Allowed keys: {', '.join(allowed)}."
    )
    try:
        async with httpx.AsyncClient(timeout=_MODEL_TIMEOUT_SECONDS) as client:
            response = await asyncio.wait_for(openrouter_chat(
                {"model": "anthropic/claude-haiku-4-5", "max_tokens": 30, "temperature": 0,
                 "messages": [{"role": "user", "content": prompt}]},
                user_id=uid, pipeline="category_icon", client=client,
            ), timeout=_MODEL_TIMEOUT_SECONDS + 0.5)
        if response.status_code != 200:
            return fallback_icon_key()
        content = response.json()["choices"][0]["message"]["content"]
        candidate = json.loads(content).get("icon_key")
        return candidate if valid_icon_key(candidate) else fallback_icon_key()
    except (asyncio.TimeoutError, httpx.HTTPError, ValueError, KeyError, TypeError):
        return fallback_icon_key()
    except Exception:
        # A quota refusal or an upstream implementation error must never stop
        # someone creating a category. Persisting the fallback also avoids retrying.
        return fallback_icon_key()
