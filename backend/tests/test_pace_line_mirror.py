"""G153: enforce the notifications.py / SpendVerdictView.tsx pace-wording
mirror so it cannot silently drift again the way it did across G151.

`notifications.py`'s `_pace_line` carries a docstring promising it mirrors
`frontend/components/SpendVerdictView.tsx`'s `paceLine` "so the push never
says something the Spend page itself wouldn't" - but a comment is not a
check, and G151 changed the frontend's wording (from "ahead of usual" to an
explicit more-than/less-than form) without anyone touching the backend
string, breaking that promise silently.

Rather than hand-copying the frontend's expected strings into this file
(the "pin the backend string, comment says keep in sync" shape that already
failed once), this test reads `paceLine`'s ACTUAL source text out of
SpendVerdictView.tsx at test time, extracts its three return templates, and
renders each one against the same fixture inputs `_pace_line` receives. If a
future change edits either side's wording, rounding, or branch order without
updating the other, this test fails - it does not rely on anyone remembering
the docstring.

Caveat this mechanism accepts: it recognises only the placeholder tokens
listed in `_PLACEHOLDERS` below. If `paceLine` is rewritten to use a
differently named variable, the substitution step raises a clear assertion
error (an unrecognised "${...}" left in the rendered text) rather than
silently passing - that failure is a prompt to update this file's
substitution map, not a false alarm.
"""
import re
from pathlib import Path

from app.services.notifications import _pace_line

FRONTEND_PATH = (
    Path(__file__).resolve().parents[2] / "frontend" / "components" / "SpendVerdictView.tsx"
)

# Currency symbol the frontend hardcodes in `fmt`; the backend's `_pace_line`
# takes `sym` as a parameter (multi-currency), but every caller today passes
# "£" (see notifications.py's `_maybe_category_pace`), so fixtures use it too.
SYM = "£"


def _extract_frontend_pace_line_templates() -> list[str]:
    """Pull the three literal 'return `...`;' template strings out of
    `paceLine` in SpendVerdictView.tsx, in source order."""
    assert FRONTEND_PATH.exists(), f"frontend paceLine source not found at {FRONTEND_PATH}"
    src = FRONTEND_PATH.read_text()

    fn_match = re.search(
        r"function paceLine\([^)]*\)\s*:\s*string\s*\{(.*?)\n\}",
        src,
        re.S,
    )
    assert fn_match, (
        "paceLine() not found in SpendVerdictView.tsx - has it been renamed, "
        "moved, or restructured? Update this test's extraction regex to match."
    )
    body = fn_match.group(1)

    templates = re.findall(r"return `([^`]*)`;", body)
    assert len(templates) == 3, (
        f"expected paceLine to have exactly 3 return templates (twice / "
        f"multiple / more-than-usual), found {len(templates)}: {templates}. "
        f"If a branch was added or removed (e.g. an under-usual branch), "
        f"this test needs updating alongside the backend mirror."
    )
    return templates


def _render_frontend_template(template: str, *, day_label: str, rounded: float, excess: float) -> str:
    """Render one of paceLine's extracted templates against fixture values,
    matching each `${...}` interpolation paceLine actually performs."""
    rendered = template
    rendered = rendered.replace("${dayLabel}", day_label)
    rendered = rendered.replace("${rounded.toFixed(1)}", f"{rounded:.1f}")
    rendered = rendered.replace("${fmt(excess)}", f"{SYM}{round(excess):,}")
    assert "${" not in rendered, (
        f"unrecognised placeholder left after substitution: {rendered!r} - "
        f"paceLine's template uses a variable this test doesn't know how to "
        f"render. Update _render_frontend_template's substitution map."
    )
    return rendered


def _frontend_pace_line(multiple: float, excess: float, days_elapsed: int) -> str:
    """The frontend's actual wording for these inputs, computed by reading
    SpendVerdictView.tsx itself rather than a hand-copied expectation."""
    twice_tpl, multiple_tpl, more_than_tpl = _extract_frontend_pace_line_templates()
    day_label = f"day {days_elapsed}"
    rounded = round(multiple, 1)

    if 1.9 <= rounded <= 2.1:
        template = twice_tpl
    elif rounded > 2.1:
        template = multiple_tpl
    else:
        template = more_than_tpl
    return _render_frontend_template(template, day_label=day_label, rounded=rounded, excess=excess)


# (multiple, excess, days_elapsed) - one fixture per paceLine branch.
FIXTURES = [
    (1.3, 210.0, 13),    # more-than-usual branch (the one G151 changed)
    (1.05, 42.0, 5),     # more-than-usual branch, small excess
    (2.0, 340.0, 13),    # exactly-twice branch
    (3.4, 900.0, 22),    # N.Nx-multiple branch
]


def test_frontend_paceline_has_exactly_three_branches():
    # Sanity check on the extraction itself, independent of the backend.
    templates = _extract_frontend_pace_line_templates()
    assert templates == [
        "about twice your usual pace for ${dayLabel}.",
        "about ${rounded.toFixed(1)}× your usual pace for ${dayLabel}.",
        "${fmt(excess)} more than usual by ${dayLabel}.",
    ]


def test_backend_pace_line_mirrors_frontend_for_every_branch():
    for multiple, excess, days_elapsed in FIXTURES:
        backend_line = _pace_line(multiple, excess, days_elapsed, SYM)
        frontend_line = _frontend_pace_line(multiple, excess, days_elapsed)
        assert backend_line == frontend_line, (
            f"mirror broken for multiple={multiple}, excess={excess}, "
            f"days_elapsed={days_elapsed}: backend said {backend_line!r}, "
            f"frontend's paceLine would say {frontend_line!r}"
        )


def test_backend_pace_line_more_than_usual_wording():
    # Pinned example alongside the generic mirror check above, so a reader
    # of test output sees the concrete string, not just "mirror ok".
    assert _pace_line(1.3, 210.0, 13, SYM) == "£210 more than usual by day 13."


def test_backend_pace_line_twice_and_multiple_wording_unchanged():
    # G151 only changed the more-than-usual branch; these two are untouched
    # and must stay untouched.
    assert _pace_line(2.0, 340.0, 13, SYM) == "about twice your usual pace for day 13."
    assert _pace_line(3.4, 900.0, 22, SYM) == "about 3.4× your usual pace for day 22."
