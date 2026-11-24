"""F24: the allowlist of assessed MCP assistants.

Dynamic client registration used to accept any https client with any
self-reported name. Now a client is only recognised when EVERY redirect URI it
registered exactly matches the published redirect URIs of one entry in
`app/data/mcp_client_allowlist.json` (override the path with
`MCP_CLIENT_ALLOWLIST_FILE`). The name and host the consent screen shows come
from that entry and the matched URI, never from the self-reported
`client_name`.

The file is data, reviewed through git. An entry must carry a review record
(see DEPLOY.md, "MCP client allowlist"). A missing, unreadable or malformed
file, or an entry without a complete review record, is ignored: the allowlist
fails closed, so nothing is trusted by accident.
"""
import json
import logging
import os
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

from app.db.collections import oauth_clients_col

logger = logging.getLogger(__name__)

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "data" / "mcp_client_allowlist.json"
_REVIEW_FIELDS = ("reviewed_on", "reviewed_by", "terms_url")


@dataclass(frozen=True)
class VerifiedClient:
    allowlist_id: str
    name: str


def _valid_entry(entry) -> bool:
    if not isinstance(entry, dict):
        return False
    if not all(isinstance(entry.get(k), str) and entry[k].strip() for k in ("id", "name")):
        return False
    uris = entry.get("redirect_uris")
    if not isinstance(uris, list) or not uris:
        return False
    for u in uris:
        parsed = urllib.parse.urlparse(u) if isinstance(u, str) else None
        if not parsed or parsed.scheme != "https" or not parsed.hostname:
            return False
    review = entry.get("review")
    return isinstance(review, dict) and all(
        isinstance(review.get(k), str) and review[k].strip() for k in _REVIEW_FIELDS
    )


def load_allowlist() -> list[dict]:
    path = Path(os.environ.get("MCP_CLIENT_ALLOWLIST_FILE") or DEFAULT_PATH)
    try:
        data = json.loads(path.read_text())
        clients = data["clients"]
        if not isinstance(clients, list):
            raise ValueError("clients must be a list")
    except Exception:
        logger.exception("mcp allowlist: unreadable, treating as empty")
        return []
    good = []
    for entry in clients:
        if _valid_entry(entry):
            good.append(entry)
        else:
            logger.error("mcp allowlist: ignoring invalid or unreviewed entry %r",
                         entry.get("id") if isinstance(entry, dict) else None)
    return good


def verify_redirect_uris(redirect_uris) -> VerifiedClient | None:
    """The allowlist entry whose published URIs include every one given."""
    if not isinstance(redirect_uris, list) or not redirect_uris:
        return None
    for entry in load_allowlist():
        if all(u in entry["redirect_uris"] for u in redirect_uris):
            return VerifiedClient(entry["id"], entry["name"])
    return None


async def verified_client_for_id(client_id: str) -> VerifiedClient | None:
    """Re-verify a stored client against the CURRENT allowlist, so removing an
    entry also stops clients registered earlier."""
    if not client_id:
        return None
    client = await oauth_clients_col.find_one({"_id": client_id})
    if not client:
        return None
    return verify_redirect_uris(client.get("redirect_uris"))
