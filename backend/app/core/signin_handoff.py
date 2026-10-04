"""Server-rendered mobile sign-in hand-off page (G199).

The markup lives in shared/signin-handoff/template.html and reaches this module
through the generated signin_handoff_template.py, so the backend and the
/design/signin-handoff preview render the same template. Kevin picked the
"Open cockpit" design (variant B) on 2026-10-03; it is the only design.
"""
import base64
import hashlib
import html
import json
import re

from app.core.deep_links import DEEP_LINK_SCHEME, bank_return_url, signin_return_url
from app.core.signin_handoff_template import TEMPLATE

SUCCESS_HINT = "Signed in. You can close this window and return to Sorted."

_SLOT = re.compile(r"\{\{(\w+)\}\}")


def _raw_json_slot(name: str, value: str) -> str:
    """Slots ending in _json carry a pre-serialised JSON string literal that is
    inserted without HTML escaping (it sits inside the hashed <script>, where
    &amp; would corrupt a URL). Validate it is a wealthdash:// URL string and
    neutralise any </ sequence so it can never close the script block."""
    try:
        decoded = json.loads(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"slot {name} is not valid JSON") from exc
    if not isinstance(decoded, str) or not decoded.startswith(f"{DEEP_LINK_SCHEME}://"):
        raise ValueError(f"slot {name} must be a JSON string starting with {DEEP_LINK_SCHEME}://")
    return value.replace("</", "<\\/")


def render_template(template: str, slots: dict[str, str]) -> str:
    """Substitute {{slot}} placeholders. Values are HTML-escaped, except slots
    named *_json (see _raw_json_slot). An unknown or missing slot raises rather
    than shipping a literal placeholder."""
    def sub(m: re.Match) -> str:
        name = m.group(1)
        if name.endswith("_json"):
            return _raw_json_slot(name, slots[name])
        return html.escape(str(slots[name]), quote=True)

    return _SLOT.sub(sub, template)


def signin_handoff_html(ok: bool, *, scheme: str = "auto",
                        auto_return: bool = True, message: str | None = None) -> str:
    if ok:
        heading, default_message = "Signed in", "Taking you back to Sorted."
    else:
        heading = "Sign-in didn’t complete"
        default_message = "Close this window and try again in Sorted."
    return render_template(TEMPLATE, {
        "title": "Sorted | Sign-in",
        "return_url_json": json.dumps(signin_return_url()),
        "state": "ok" if ok else "error",
        "scheme": scheme,
        "heading": heading,
        "message": message if message is not None else default_message,
        "success_hint": SUCCESS_HINT,
        "ok_flag": "true" if ok else "false",
        "auto_return": "true" if auto_return else "false",
    })


BANK_SUCCESS_HINT = "Bank connected. You can close this window and return to Sorted."


def bank_handoff_html(ok: bool, *, provider: str, connection_id: str,
                      auto_return: bool = True, scheme: str = "auto",
                      message: str | None = None) -> str:
    """The same hand-off page for a bank-connect callback (A68)."""
    if ok:
        heading = "Bank connected"
        default_message = "Taking you back to Sorted. Your transactions are on their way."
    else:
        heading = "Connection didn’t complete"
        default_message = "No accounts were linked. Close this window and try again in Sorted."
    url = bank_return_url(provider, connection_id, "ok" if ok else "error")
    return render_template(TEMPLATE, {
        "title": "Sorted | Bank connection",
        "return_url_json": json.dumps(url),
        "state": "ok" if ok else "error",
        "scheme": scheme,
        "heading": heading,
        "message": message if message is not None else default_message,
        "success_hint": BANK_SUCCESS_HINT,
        "ok_flag": "true" if ok else "false",
        "auto_return": "true" if auto_return else "false",
    })


_STYLE_BLOCK = re.compile(r"<style>(.*?)</style>", re.S)
_SCRIPT_BLOCK = re.compile(r"<script>(.*?)</script>", re.S)


def _sha256_source(text: str) -> str:
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode("utf-8")).digest()).decode() + "'"


def signin_handoff_csp(page: str) -> str:
    """Route-specific Content-Security-Policy for the rendered page: the global
    default-src 'none' would block its inline style and auto-return script, so
    allow exactly the one style block and the one script block by hash, computed
    from the strings actually emitted. No inline event handlers, no style
    attributes, nothing external."""
    styles, scripts = _STYLE_BLOCK.findall(page), _SCRIPT_BLOCK.findall(page)
    if len(styles) != 1 or len(scripts) != 1:
        raise ValueError("signin handoff template must contain exactly one <style> and one <script>")
    return (
        "default-src 'none'; "
        f"style-src {_sha256_source(styles[0])}; "
        f"script-src {_sha256_source(scripts[0])}; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
