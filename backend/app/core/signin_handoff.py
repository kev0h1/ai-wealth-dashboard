"""Server-rendered mobile sign-in hand-off page (G199).

The markup lives in shared/signin-handoff/template.html and reaches this module
through the generated signin_handoff_template.py, so the backend and the
/design/signin-handoff preview render the same template. `variant` selects an
art direction (a, b, c) inside that one template.
"""
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
