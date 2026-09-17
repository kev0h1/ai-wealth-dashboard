"""A31: structural guard against raw exception text reaching a caller.

An exception message is written for a developer (it can carry a file path, a
query fragment, a driver-level detail, or a value that merely happened to be
in scope). It is never a designed user-facing string. This scan finds every
`except ... as <name>:` handler in `app/routers`, `app/services`, and
`app/core`, then flags any `return` or `raise` in that handler's body whose
value embeds `<name>` — whether via `str(name)`, an f-string `{name}`,
attribute access like `name.detail`, or a bare reference.

This is deliberately structural rather than a list of today's known sites:
it walks the AST looking for the SHAPE of the bug (an except-bound name
flowing into a returned/raised value), so a brand new occurrence added in a
future change trips it exactly the same way the original ~30 sites did.

Two things it does NOT flag, on purpose:
  * `except X as e: raise SomeError(...) from e` — chaining via `cause` only
    (not embedding `e`'s text in the message) is the correct, idiomatic way
    to preserve the traceback without leaking the message.
  * `logger.exception(...)` / `logger.warning("...%s", e)` calls — these are
    bare expression statements, not `return`/`raise`, so the exception text
    stays in the log, which is exactly where it belongs.

ALLOWLIST: a handful of sites forward an exception whose message was
authored BY THIS CODEBASE for exactly this purpose (a custom domain
exception, e.g. `BacklogError`, `BillingError`, `McpError`, `_CalcError`, or
`HTTPException` raised by one of our own `_validate_*`/`_normalise_*`
helpers). Forwarding `str(exc)` for one of those is not the leak this test
guards against — the message was designed to be caller-facing at the point
it was raised, and reads like the rest of Penny's / the app's copy. Each
entry below is deliberate; if you're adding a NEW allowlist entry, first
convince yourself the forwarded exception type is one this codebase
authors itself, not a system/library exception whose wording we don't
control.
"""
import ast
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCAN_DIRS = ["app/routers", "app/services", "app/core"]

# (path relative to backend/, 1-indexed line number of the return/raise)
ALLOWLIST: set[tuple[str, int]] = {
    # app.services.backlog.BacklogError — "Raised for any user/caller-facing
    # failure (unknown id, bad enum)" per its own docstring; owner-only
    # /ops/go-live admin surface.
    ("app/routers/ops.py", 241),
    ("app/routers/ops.py", 259),
    # ValueError raised by app.services.spend_impact.compute_intent_preview /
    # app.services.checkpoints.delete_intent with an authored message
    # ("'<category>' is not currently over usual, nothing to preview", etc.)
    ("app/routers/spend_verdict.py", 79),
    ("app/routers/spend_verdict.py", 95),
    # ValueError raised by app.services.checkpoints.create_checkpoint /
    # record_intent with an authored message ("ref must be a non-empty
    # category name", "answer must be 'one_off' or 'new_normal'", etc.)
    ("app/routers/checkpoints.py", 36),
    ("app/routers/checkpoints.py", 74),
    # app.services.broadcast.BroadcastError — admin-only broadcast compose/
    # send, authored messages only.
    ("app/routers/broadcast.py", 94),
    ("app/routers/broadcast.py", 108),
    # app.services.billing.BillingError — "Base class for billing-service
    # errors that should surface to the caller as a 400" per its own
    # docstring; every raise site is a static, authored string.
    ("app/routers/billing.py", 172),
    ("app/routers/billing.py", 195),
    # ValueError raised by app.core.subscription.grant_pack with an authored
    # message ("pack_id must be one of: ..."); admin-only endpoint.
    ("app/routers/subscription.py", 239),
    ("app/routers/subscription.py", 271),
    # app.services.safe_calc._CalcError — "Internal only" per its own
    # docstring, every raise site in that module is a static, authored,
    # already-calm string written for this exact Penny-facing surface.
    ("app/services/safe_calc.py", 136),
    # app.routers.mcp.McpError — the MCP JSON-RPC error contract IS
    # (code, message, data); every raise site is a static, authored string.
    ("app/routers/mcp.py", 522),
    # penny_tools.py: `except HTTPException as e: return _tool_error(str(e.detail))`
    # / `return {"error": str(e.detail)}` — forwarding HTTPException.detail
    # raised by our own _validate_*/_normalise_* helpers a few lines above
    # (app.routers.allocations, app.routers.commitments, app.routers.card_terms,
    # app.routers.allocations.fill_candidates, app.routers.transactions
    # source-scope resolution), never a caught system/library exception.
    # G80 (2026-09-16) shifted every line below by +13: the reframed
    # money-basics/page-explainer copy sweep added lines earlier in this
    # file (the "upcoming" explain entry and expanded insights/debt/grow
    # copy), none of these are new exception sites.
    ("app/services/penny_tools.py", 3870),
    ("app/services/penny_tools.py", 3935),  # ValueError from compute_intent_preview, see above
    ("app/services/penny_tools.py", 4438),
    ("app/services/penny_tools.py", 4458),
    ("app/services/penny_tools.py", 4494),
    ("app/services/penny_tools.py", 4517),
    ("app/services/penny_tools.py", 4659),
    ("app/services/penny_tools.py", 4664),
    ("app/services/penny_tools.py", 4669),
    ("app/services/penny_tools.py", 4756),
    ("app/services/penny_tools.py", 4761),
    ("app/services/penny_tools.py", 4766),
    ("app/services/penny_tools.py", 5707),
    ("app/services/penny_tools.py", 6362),
    ("app/services/penny_tools.py", 6376),
    # app.services.billing._handle_checkout_completed: `str(exc)` here is an
    # authored ValueError message from grant_pack (see above), returned as
    # the body of a Stripe *webhook* response — read by Stripe's own retry
    # logic / dashboard, never rendered to an end user. Ambiguous by the
    # letter of "reaches an HTTP response body", allowlisted rather than
    # silently skipped; tighten this if the webhook response is ever
    # surfaced anywhere a person reads it.
    ("app/services/billing.py", 480),
}


def _iter_py_files():
    for d in SCAN_DIRS:
        base = BACKEND_ROOT / d
        if not base.exists():
            continue
        yield from sorted(base.rglob("*.py"))


def _name_in_subtree(node: ast.AST, bound_name: str) -> bool:
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name) and sub.id == bound_name:
            return True
    return False


def _scan_file(path: Path) -> list[tuple[int, str]]:
    """Return a list of (lineno, snippet) violations in this file."""
    try:
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return []

    source_lines = source.splitlines()
    violations: list[tuple[int, str]] = []

    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler) or not node.name:
            continue
        bound_name = node.name
        for sub in ast.walk(node):
            if sub is node:
                continue
            target = None
            if isinstance(sub, ast.Raise) and sub.exc is not None:
                target = sub.exc
            elif isinstance(sub, ast.Return) and sub.value is not None:
                target = sub.value
            if target is None:
                continue
            if _name_in_subtree(target, bound_name):
                lineno = sub.lineno
                snippet = source_lines[lineno - 1].strip() if 0 < lineno <= len(source_lines) else ""
                violations.append((lineno, snippet))

    return violations


def test_no_handler_returns_raw_exception_text():
    """Every `except ... as name:` handler in app/routers, app/services, and
    app/core must not thread `name`'s text into a `return` or `raise`
    value, unless the specific (file, line) is in ALLOWLIST above with a
    documented reason.

    A future violation (new file, new line, anywhere in these three trees)
    fails this test exactly the same way the original ~30 sites did —
    nothing here depends on today's known offenders.
    """
    new_violations: list[str] = []
    stale_allowlist = set(ALLOWLIST)

    for path in _iter_py_files():
        rel = str(path.relative_to(BACKEND_ROOT))
        for lineno, snippet in _scan_file(path):
            key = (rel, lineno)
            if key in ALLOWLIST:
                stale_allowlist.discard(key)
                continue
            new_violations.append(f"{rel}:{lineno}: {snippet}")

    assert not new_violations, (
        "Found handler(s) returning/raising raw exception text (not in "
        "ALLOWLIST). Log the real exception and return a generic, designed "
        "message instead, or add a documented ALLOWLIST entry if this is a "
        "genuinely authored, caller-facing exception forwarded verbatim:\n  "
        + "\n  ".join(new_violations)
    )

    # A stale allowlist entry (line moved/removed, no violation found there
    # any more) would silently stop guarding anything — surface it so the
    # list stays honest as the surrounding code changes.
    assert not stale_allowlist, (
        "ALLOWLIST entries no longer match any violation (code moved or was "
        "fixed) — remove them: " + ", ".join(f"{f}:{l}" for f, l in sorted(stale_allowlist))
    )
