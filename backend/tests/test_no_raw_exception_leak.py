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

ALLOWLIST KEYING (H82 / A40, 2026-09-28): entries used to be keyed by
`(file, 1-indexed line number)`. That broke every time an UNRELATED edit
added or removed a line anywhere above an allowlisted handler in the same
file — a docstring sweep, an import, a new function — which silently
re-pointed the entry at whatever now sat on that line number and failed
`scripts/session.sh finish`'s gate for a reason that had nothing to do with
the change actually being made (it happened twice on 2026-09-28 alone: H64's
review-driven edit to `routers/ops.py`, and separately to this same file's
own history while it still carried line-shift narration in its comments).
`scripts/check_naive_dates.py` solved the identical problem for its own
naive-datetime scan by keying on `(file, exact stripped source-line text)`
instead of a line number; this file adopts the same design, for the same
reason: the code that was audited and allowlisted is still recognised
wherever it ends up in the file, because its own text doesn't change when
something else nearby does. Migrated 1:1 from the old list: the 30 original
(file, line-number) entries collapse into 13 distinct (file, text) entries
below, once identical-text duplicates sharing one reason are grouped under
a single entry's `count` (see below) — 13 keys, 30 occurrences, not the
same number twice.

The trade-off that keying by text introduces, exactly as it does in
`check_naive_dates.py`: two DIFFERENT call sites can share identical source
text (`return _tool_error(str(e.detail))` is the case in this codebase,
repeated across a dozen distinct `_validate_*`/`_normalise_*` forwarders in
`penny_tools.py`), so a bare per-file "this text is allowed" entry would let
a newly added, un-triaged COPY of that exact line slip past unnoticed right
next to the original allowed one. Each entry therefore carries a `count`:
the number of occurrences of that exact text this file is allowed to
contain (defaulting to 1 when omitted). If the actual number of matching
lines exceeds the allowed count, the excess is reported as a failure, so
duplicating an allowlisted line is still caught even though the two
occurrences read identically.

That `count` mechanism only works when every occurrence sharing the text
genuinely shares the SAME reason — a dict entry has exactly one `reason`
per `(file, text)` key, so it cannot represent two occurrences of identical
text that are allowed for two DIFFERENT reasons. When that happens (it
doesn't anywhere in this codebase today, but a future call site could
collide with an existing allowlisted line's exact text for an unrelated
reason), the central entry must NOT simply have its `count` bumped: add a
`# leak-ok: <reason>` comment on the new, different-reason line instead.
The inline pragma suppresses that specific line from the scan entirely
(checked before any allowlist lookup), so it never contributes to the
central entry's occurrence count and carries its own reason right next to
the code it's about — the same escape hatch `check_naive_dates.py` offers
via `# naive-ok: <reason>` for a genuine one-off that doesn't warrant a
central entry.

A31's own reviewer (A37) separately found that this scan only catches
zero-hop leaks (`except E as e: return f"...{e}"`), not one where the
exception is stored in a variable first (`msg = str(e); return msg`) — that
gap is a different, open item (A37), not something this rewrite widens or
narrows.
"""
import ast
import re
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent
SCAN_DIRS = ["app/routers", "app/services", "app/core"]

# A one-off escape hatch for a line that doesn't warrant (or, per the
# docstring above, can't share) a central ALLOWLIST entry: `# leak-ok:
# <reason>` on the source line suppresses that line from the scan -- but
# only when a real reason follows the colon. A bare `# leak-ok:` (or one
# with only whitespace after it) is a rubber stamp, not a review: it is
# reported as its OWN violation (see _scan_file's `bad_pragmas` return
# below), never silently treated as a suppression.
PRAGMA_RE = re.compile(r"#\s*leak-ok\s*:(.*)$")
MIN_PRAGMA_REASON_CHARS = 3  # non-space characters required after the colon


def _pragma_reason(line: str) -> str | None:
    """Return the text after '# leak-ok:' on this line (possibly empty or
    whitespace-only), or None if the line carries no leak-ok pragma at
    all."""
    m = PRAGMA_RE.search(line)
    return None if m is None else m.group(1).strip()

# ALLOWLIST[relative_path][exact stripped source-line text] = {
#     "reason": "...",       # why this forwarded text is safe (required)
#     "count": N,             # occurrences of this exact text allowed in
#                              # this file; defaults to 1 when omitted
# }
ALLOWLIST: dict[str, dict[str, dict]] = {
    "app/routers/ops.py": {
        "raise HTTPException(404, str(exc)) from exc": {
            "reason": (
                "app.services.backlog.BacklogError — \"Raised for any "
                "user/caller-facing failure (unknown id, bad enum)\" per its "
                "own docstring; owner-only /ops/go-live admin surface."
            ),
            "count": 2,
        },
    },
    "app/routers/spend_verdict.py": {
        "raise HTTPException(400, str(e))": {
            "reason": (
                "ValueError raised by app.services.spend_impact."
                "compute_intent_preview / app.services.checkpoints."
                "delete_intent with an authored message (\"'<category>' is "
                "not currently over usual, nothing to preview\", etc.)."
            ),
            "count": 2,
        },
    },
    "app/routers/checkpoints.py": {
        "raise HTTPException(400, str(e))": {
            "reason": (
                "ValueError raised by app.services.checkpoints."
                "create_checkpoint / record_intent with an authored message "
                "(\"ref must be a non-empty category name\", \"answer must "
                "be 'one_off' or 'new_normal'\", etc.)."
            ),
            "count": 2,
        },
    },
    "app/routers/broadcast.py": {
        "raise HTTPException(400, str(e))": {
            "reason": (
                "app.services.broadcast.BroadcastError — admin-only "
                "broadcast compose/send, authored messages only."
            ),
        },
        "raise HTTPException(404, str(e))": {
            "reason": (
                "app.services.broadcast.BroadcastError — admin-only "
                "broadcast compose/send, authored messages only."
            ),
        },
    },
    "app/routers/billing.py": {
        "raise HTTPException(400, str(exc))": {
            "reason": (
                "app.services.billing.BillingError — \"Base class for "
                "billing-service errors that should surface to the caller "
                "as a 400\" per its own docstring; every raise site is a "
                "static, authored string."
            ),
            "count": 2,
        },
    },
    "app/routers/subscription.py": {
        "raise HTTPException(400, str(exc))": {
            "reason": (
                "ValueError raised by app.core.subscription.grant_pack with "
                "an authored message (\"pack_id must be one of: ...\"); "
                "admin-only endpoint."
            ),
            "count": 2,
        },
    },
    "app/services/safe_calc.py": {
        "return _fail(str(e))": {
            "reason": (
                "app.services.safe_calc._CalcError — \"Internal only\" per "
                "its own docstring, every raise site in that module is a "
                "static, authored, already-calm string written for this "
                "exact Penny-facing surface."
            ),
        },
    },
    "app/routers/mcp.py": {
        "return {\"jsonrpc\": \"2.0\", \"id\": msg_id, \"error\": _error_obj(e.code, e.message, e.data)}": {
            "reason": (
                "app.routers.mcp.McpError — the MCP JSON-RPC error contract "
                "IS (code, message, data); every raise site is a static, "
                "authored string."
            ),
        },
    },
    "app/services/penny_tools.py": {
        "return _tool_error(str(e.detail))": {
            "reason": (
                "forwarding HTTPException.detail raised by our own "
                "_validate_*/_normalise_* helpers a few lines above "
                "(app.routers.allocations, app.routers.commitments, "
                "app.routers.card_terms, app.routers.allocations."
                "fill_candidates, app.routers.transactions source-scope "
                "resolution), never a caught system/library exception."
            ),
            "count": 13,
        },
        "return _tool_error(str(e))": {
            "reason": (
                "ValueError from app.services.spend_impact."
                "compute_intent_preview / app.services.checkpoints."
                "delete_intent — the same authored-message family as "
                "routers/spend_verdict.py above."
            ),
        },
        "return {\"error\": str(e.detail)}": {
            "reason": (
                "same family as the _tool_error(str(e.detail)) group above "
                "(HTTPException.detail from our own _validate_*/"
                "_normalise_* helpers), just a bare-dict call site instead "
                "of the _tool_error() helper."
            ),
        },
    },
    "app/services/billing.py": {
        "return {\"handled\": False, \"reason\": str(exc)}": {
            "reason": (
                "app.services.billing._handle_checkout_completed: str(exc) "
                "here is an authored ValueError message from grant_pack "
                "(see routers/subscription.py above), returned as the body "
                "of a Stripe *webhook* response — read by Stripe's own "
                "retry logic / dashboard, never rendered to an end user. "
                "Ambiguous by the letter of \"reaches an HTTP response "
                "body\", allowlisted rather than silently skipped; tighten "
                "this if the webhook response is ever surfaced anywhere a "
                "person reads it."
            ),
        },
    },
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


def _scan_file(path: Path) -> tuple[list[tuple[int, str]], list[tuple[int, str]]]:
    """Return (violations, bad_pragmas) for this file.

    `violations`: (lineno, stripped source text) for a `return`/`raise`
    inside an `except ... as name:` handler whose value embeds `name`, and
    that carries no `# leak-ok:` pragma at all (or one with a real reason
    -- see `bad_pragmas`).

    `bad_pragmas`: (lineno, stripped source text) for a violation whose
    `# leak-ok:` pragma has no reason, or only whitespace, after the colon.
    These are NEVER silently suppressed and never matched against
    ALLOWLIST -- an unreasoned pragma is exactly the kind of rubber stamp
    this guard exists to prevent, so it is always reported as its own
    failure (see test_no_handler_returns_raw_exception_text).
    """
    try:
        source = path.read_text()
        tree = ast.parse(source, filename=str(path))
    except SyntaxError:
        return [], []

    source_lines = source.splitlines()
    violations: list[tuple[int, str]] = []
    bad_pragmas: list[tuple[int, str]] = []

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
                line = source_lines[lineno - 1] if 0 < lineno <= len(source_lines) else ""
                reason = _pragma_reason(line)
                if reason is not None:
                    non_space_chars = len(re.sub(r"\s+", "", reason))
                    if non_space_chars >= MIN_PRAGMA_REASON_CHARS:
                        continue  # a real, non-trivial reason -- suppressed
                    bad_pragmas.append((lineno, line.strip()))
                    continue
                violations.append((lineno, line.strip()))

    return violations, bad_pragmas


def _check_file(
    rel: str, hits_by_text: dict[str, list[int]], allowed_here: dict[str, dict]
) -> tuple[list[str], list[str]]:
    """Compare one file's scan hits (grouped by exact stripped source text)
    against its ALLOWLIST entries. Returns (new_violations, stale_entries).

    A hit's text with no entry is a new violation. A hit's text WITH an
    entry must match its `count` EXACTLY, not just stay under it: more
    occurrences than `count` is an un-triaged new copy, and FEWER
    occurrences than `count` means a site was fixed, moved, or removed
    since the entry was written, leaving a silent budget that a later,
    unrelated, un-triaged addition could quietly reuse without ever being
    reviewed. Either direction fails, with a message saying the count must
    be updated (and its reason re-read, since fewer sites can change what
    the reason is even describing). An entry whose text has ZERO matching
    hits in this file at all is stale (never entered `hits_by_text`) and is
    reported separately below, exactly as the old line-keyed version
    reported a (file, line) pair that no longer matched.
    """
    new_violations: list[str] = []
    for text, linenos in hits_by_text.items():
        entry = allowed_here.get(text)
        if entry is None:
            for lineno in linenos:
                new_violations.append(f"{rel}:{lineno}: {text}")
            continue

        allowed_count = entry.get("count", 1)
        if len(linenos) == allowed_count:
            continue

        where = ", ".join(str(n) for n in linenos)
        if len(linenos) > allowed_count:
            new_violations.append(
                f"{rel}: {len(linenos)} occurrence(s) of {text!r} found "
                f"(lines: {where}) but only {allowed_count} allowlisted "
                f"under that exact text — a new, un-triaged copy of an "
                f"allowed line? Bump 'count' if every occurrence shares the "
                f"same reason, or add a '# leak-ok: <reason>' comment on "
                f"the line(s) that don't, to disambiguate. Either way, the "
                f"count must be updated to match, and its reason re-read to "
                f"confirm it still covers every occurrence."
            )
        else:
            new_violations.append(
                f"{rel}: only {len(linenos)} occurrence(s) of {text!r} found "
                f"(lines: {where}) but ALLOWLIST says count={allowed_count} "
                f"— a site was fixed, moved, or removed since this entry "
                f"was written. The count must be updated to the current "
                f"exact number, and its reason re-read to confirm it still "
                f"applies to what's left, so a future un-triaged addition "
                f"can't silently reuse the freed budget."
            )

    stale_entries = [
        f"{rel}: {text!r}" for text in allowed_here if text not in hits_by_text
    ]
    return new_violations, stale_entries


def test_no_handler_returns_raw_exception_text():
    """Every `except ... as name:` handler in app/routers, app/services, and
    app/core must not thread `name`'s text into a `return` or `raise`
    value, unless the exact source line is in ALLOWLIST above with a
    documented reason (or carries a `# leak-ok:` comment).

    A future violation (new file, new line, anywhere in these three trees)
    fails this test exactly the same way the original ~30 sites did —
    nothing here depends on today's known offenders, and nothing here
    depends on which line number they happen to sit on today either.
    """
    new_violations: list[str] = []
    stale_entries: list[str] = []
    bad_pragmas: list[str] = []

    for path in _iter_py_files():
        rel = str(path.relative_to(BACKEND_ROOT))
        hits, file_bad_pragmas = _scan_file(path)
        for lineno, text in file_bad_pragmas:
            bad_pragmas.append(f"{rel}:{lineno}: {text}")

        hits_by_text: dict[str, list[int]] = {}
        for lineno, text in hits:
            hits_by_text.setdefault(text, []).append(lineno)

        file_new, file_stale = _check_file(rel, hits_by_text, ALLOWLIST.get(rel, {}))
        new_violations.extend(file_new)
        stale_entries.extend(file_stale)

    assert not bad_pragmas, (
        "Found '# leak-ok:' pragma(s) with no reason, or only whitespace, "
        "after the colon. A bare pragma is a rubber stamp, not a review: "
        "add an actual reason (a few words on why THIS line is safe), or "
        "remove the pragma and add a documented ALLOWLIST entry instead:\n  "
        + "\n  ".join(bad_pragmas)
    )

    assert not new_violations, (
        "Found handler(s) returning/raising raw exception text (not in "
        "ALLOWLIST). Log the real exception and return a generic, designed "
        "message instead, or add a documented ALLOWLIST entry if this is a "
        "genuinely authored, caller-facing exception forwarded verbatim:\n  "
        + "\n  ".join(new_violations)
    )

    assert not stale_entries, (
        "ALLOWLIST entries no longer match any violation (the line moved, "
        "was fixed, or was deleted) — remove them: " + ", ".join(stale_entries)
    )


# --- Tests of the guard itself ------------------------------------------
#
# These don't scan the real backend tree; they run the same `_scan_file` /
# `_check_file` machinery above against small scratch files, so they can
# assert on line-shift and new-violation behaviour deterministically.


def test_allowlist_survives_unrelated_line_shift(tmp_path):
    """H82 / A40: a text-keyed entry must keep matching an allowlisted
    handler after an unrelated edit shifts its line number. Proves red
    under the OLD (file, line-number) scheme and green under the new
    (file, text) scheme for the identical shift."""
    original_source = (
        "from fastapi import HTTPException\n"
        "\n"
        "def handler():\n"
        "    try:\n"
        "        do_something()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
    )
    shifted_source = (
        "from fastapi import HTTPException\n"
        "\n"
        "# An unrelated comment added above the handler by a later, totally\n"
        "# unconnected change — this must not break the allowlist entry below.\n"
        "def handler():\n"
        "    try:\n"
        "        do_something()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
    )

    scratch = tmp_path / "fake_handler.py"
    allowlist_text = "raise HTTPException(400, str(exc)) from exc"
    allowed_here = {
        allowlist_text: {"reason": "test fixture: authored HTTPException forward"}
    }

    # Before the shift: the raise sits on line 7, and the OLD line-keyed
    # scheme (reconstructed inline here) matches it fine.
    scratch.write_text(original_source)
    original_hits, original_bad_pragmas = _scan_file(scratch)
    assert original_hits == [(7, allowlist_text)]
    assert not original_bad_pragmas
    old_line_keyed_allowlist = {(str(scratch), 7)}
    assert (str(scratch), 7) in old_line_keyed_allowlist

    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in original_hits:
        hits_by_text.setdefault(text, []).append(lineno)
    new_v, stale_v = _check_file("fake_handler.py", hits_by_text, allowed_here)
    assert not new_v and not stale_v

    # After the shift: the SAME raise is now on line 9, two lines later.
    scratch.write_text(shifted_source)
    shifted_hits, shifted_bad_pragmas = _scan_file(scratch)
    assert shifted_hits == [(9, allowlist_text)]
    assert not shifted_bad_pragmas

    # RED under the old (file, line-number) scheme — line 9 was never
    # allowlisted, so this unrelated edit would fail the finish gate.
    assert (str(scratch), 9) not in old_line_keyed_allowlist

    # GREEN under the new (file, text) scheme — the entry matches by exact
    # source text regardless of which line the handler now sits on.
    hits_by_text = {}
    for lineno, text in shifted_hits:
        hits_by_text.setdefault(text, []).append(lineno)
    new_v, stale_v = _check_file("fake_handler.py", hits_by_text, allowed_here)
    assert not new_v and not stale_v


def test_new_raw_exception_leak_still_caught(tmp_path):
    """A brand new handler that leaks raw exception text must still fail
    the guard, even in a file that also contains an allowlisted line —
    proves the text-keyed scheme doesn't accidentally widen what's
    allowed."""
    source = (
        "from fastapi import HTTPException\n"
        "\n"
        "def handler_ok():\n"
        "    try:\n"
        "        do_something()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
        "\n"
        "def handler_new_leak():\n"
        "    try:\n"
        "        do_other_thing()\n"
        "    except RuntimeError as boom:\n"
        "        return {\"error\": str(boom)}\n"
    )
    scratch = tmp_path / "fake_handler2.py"
    scratch.write_text(source)

    allowed_here = {
        "raise HTTPException(400, str(exc)) from exc": {"reason": "test fixture"},
    }

    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas
    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)

    new_v, stale_v = _check_file("fake_handler2.py", hits_by_text, allowed_here)
    assert not stale_v
    assert len(new_v) == 1
    assert 'return {"error": str(boom)}' in new_v[0]


def test_inline_leak_ok_pragma_suppresses_without_central_entry(tmp_path):
    """A one-off leak site can be allowed with a `# leak-ok: <reason>`
    comment on the line itself, with no central ALLOWLIST entry needed —
    the escape hatch check_naive_dates.py offers via `# naive-ok:`."""
    source = (
        "def handler():\n"
        "    try:\n"
        "        do_something()\n"
        "    except RuntimeError as exc:\n"
        "        return {\"error\": str(exc)}  # leak-ok: test fixture, one-off\n"
    )
    scratch = tmp_path / "fake_handler3.py"
    scratch.write_text(source)

    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas  # a real reason follows the colon -- not "bad"
    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)

    assert hits_by_text == {}  # the pragma suppressed the hit entirely

    new_v, stale_v = _check_file("fake_handler3.py", hits_by_text, {})
    assert not new_v and not stale_v


def test_stale_allowlist_entry_is_flagged(tmp_path):
    """An ALLOWLIST entry whose text no longer matches anything in the file
    (fixed, moved, or deleted) must be reported, so the list stays honest —
    same guarantee the old line-keyed version gave via its own
    stale-allowlist check."""
    source = (
        "def handler():\n"
        "    try:\n"
        "        do_something()\n"
        "    except ValueError as exc:\n"
        "        raise ValueError(\"a designed, static message\") from exc\n"
    )
    scratch = tmp_path / "fake_handler4.py"
    scratch.write_text(source)

    allowed_here = {
        "raise HTTPException(400, str(exc)) from exc": {"reason": "no longer present"},
    }

    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas
    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)

    assert hits_by_text == {}  # this handler doesn't leak at all any more

    new_v, stale_v = _check_file("fake_handler4.py", hits_by_text, allowed_here)
    assert not new_v
    assert len(stale_v) == 1


def test_duplicate_identical_text_uses_count_same_reason(tmp_path):
    """Two call sites sharing identical source text are covered by one
    entry via `count` when they share the same reason (penny_tools.py's
    `return _tool_error(str(e.detail))` in the real ALLOWLIST is exactly
    this shape). A THIRD, newly added copy of that same text must still be
    caught as a genuinely new, un-triaged occurrence."""
    source = (
        "def handler_a():\n"
        "    try:\n"
        "        one()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
        "\n"
        "def handler_b():\n"
        "    try:\n"
        "        two()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
    )
    scratch = tmp_path / "fake_dup.py"
    scratch.write_text(source)

    allowed_here = {
        "raise HTTPException(400, str(exc)) from exc": {
            "reason": "both sites forward an authored ValueError, same reason",
            "count": 2,
        },
    }

    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas
    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)
    new_v, stale_v = _check_file("fake_dup.py", hits_by_text, allowed_here)
    assert not new_v and not stale_v

    source_with_third = source + (
        "\n"
        "def handler_c():\n"
        "    try:\n"
        "        three()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
    )
    scratch.write_text(source_with_third)
    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas
    hits_by_text = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)
    new_v, stale_v = _check_file("fake_dup.py", hits_by_text, allowed_here)
    assert len(new_v) == 1
    assert "3 occurrence" in new_v[0]


def test_undercount_reduction_is_flagged(tmp_path):
    """H82 follow-up: an ALLOWLIST entry whose declared `count` is HIGHER
    than the number of matching occurrences actually left in the file must
    fail too, not just an overcount. Before this fix, `len(linenos) <=
    allowed_count` accepted any undercount silently -- so fixing one of two
    identically-texted sites left a "budget" of one that a later, entirely
    unrelated, un-triaged site could quietly reuse without ever being
    reviewed, because it would just look like it fit under the same old
    count. The count must be exact, and a mismatch in either direction
    must say so."""
    source = (
        "def handler_a():\n"
        "    try:\n"
        "        one()\n"
        "    except ValueError as exc:\n"
        "        raise HTTPException(400, str(exc)) from exc\n"
    )
    scratch = tmp_path / "fake_reduced.py"
    scratch.write_text(source)

    allowed_here = {
        "raise HTTPException(400, str(exc)) from exc": {
            "reason": "was two sites sharing this reason; one was fixed since",
            "count": 2,  # stale -- only 1 occurrence remains in the file
        },
    }

    hits, bad_pragmas = _scan_file(scratch)
    assert not bad_pragmas
    hits_by_text: dict[str, list[int]] = {}
    for lineno, text in hits:
        hits_by_text.setdefault(text, []).append(lineno)

    new_v, stale_v = _check_file("fake_reduced.py", hits_by_text, allowed_here)
    assert not stale_v  # the text DOES still match one hit -- not "stale"
    assert len(new_v) == 1
    assert "count must be updated" in new_v[0]
    assert "1 occurrence" in new_v[0]


def test_bare_leak_ok_pragma_is_flagged(tmp_path):
    """A '# leak-ok:' with no reason, or only whitespace, after the colon
    must NOT silently suppress a genuine leak -- it must itself fail the
    guard, with its own message telling the author to add a real reason
    (or use a documented ALLOWLIST entry instead)."""
    source = (
        "def handler_bare():\n"
        "    try:\n"
        "        one()\n"
        "    except RuntimeError as exc:\n"
        "        return {\"error\": str(exc)}  # leak-ok:\n"
        "\n"
        "def handler_whitespace_only():\n"
        "    try:\n"
        "        two()\n"
        "    except RuntimeError as exc:\n"
        "        return {\"error\": str(exc)}  # leak-ok:    \n"
        "\n"
        "def handler_too_short():\n"
        "    try:\n"
        "        three()\n"
        "    except RuntimeError as exc:\n"
        "        return {\"error\": str(exc)}  # leak-ok: ok\n"
    )
    scratch = tmp_path / "fake_bare_pragma.py"
    scratch.write_text(source)

    hits, bad_pragmas = _scan_file(scratch)
    assert hits == []  # never matched against ALLOWLIST
    assert [lineno for lineno, _ in bad_pragmas] == [5, 11, 17]
