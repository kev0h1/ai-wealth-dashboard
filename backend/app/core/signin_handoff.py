"""Server-rendered mobile sign-in hand-off page (G199).

The markup lives in shared/signin-handoff/template.html and reaches this module
through the generated signin_handoff_template.py, so the backend and the
/design/signin-handoff preview render the same template. `variant` selects an
art direction (a, b, c) inside that one template.
"""
import base64
import hashlib
import html
import re

from app.core.signin_handoff_template import TEMPLATE

# Set by Kevin's pick on the /design round; until then the live page uses "a".
DEFAULT_VARIANT = "a"

SUCCESS_HINT = "Signed in. You can close this window and return to Sorted."

_SLOT = re.compile(r"\{\{(\w+)\}\}")


def render_template(template: str, slots: dict[str, str]) -> str:
    """Substitute {{slot}} placeholders. Values are HTML-escaped; an unknown
    or missing slot raises rather than shipping a literal placeholder."""
    def sub(m: re.Match) -> str:
        return html.escape(str(slots[m.group(1)]), quote=True)

    return _SLOT.sub(sub, template)


def signin_handoff_html(ok: bool, variant: str = DEFAULT_VARIANT, *, scheme: str = "auto",
                        auto_return: bool = True, message: str | None = None) -> str:
    if variant not in ("a", "b", "c"):
        variant = DEFAULT_VARIANT
    if ok:
        heading, default_message, ledger = "Signed in", "Taking you back to Sorted.", "Signed in"
    else:
        heading = "Sign-in didn’t complete"
        default_message = "Close this window and try again in Sorted."
        ledger = "Not signed in"
    return render_template(TEMPLATE, {
        "state": "ok" if ok else "error",
        "variant": variant,
        "scheme": scheme,
        "heading": heading,
        "message": message if message is not None else default_message,
        "success_hint": SUCCESS_HINT,
        "ledger_status": ledger,
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
