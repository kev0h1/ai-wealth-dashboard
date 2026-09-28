"""G153: enforce the notifications.py / SpendVerdictView.tsx pace-wording
mirror so it cannot silently drift again the way it did across G151.

`notifications.py`'s `_pace_line` carries a docstring promising it mirrors
`frontend/components/SpendVerdictView.tsx`'s `paceLine` "so the push never
says something the Spend page itself wouldn't" - but a comment is not a
check, and G151 changed the frontend's wording (from "ahead of usual" to an
explicit more-than/less-than form) without anyone touching the backend
string, breaking that promise silently.

First cut of this test modelled `paceLine`'s formatting in Python (its own
copy of `fmt`'s "£" + thousands-separator logic) rather than running the
real function. Review caught that a false pass survives it: change the
real `fmt` to 2-decimal-place formatting and the model still agrees with
itself, because it never reads `fmt` at all. Modelling the frontend is
exactly the "keep in sync by hand" failure mode this item exists to close,
one level more subtle.

This version runs the REAL `paceLine`. `paceLine` is now exported from
SpendVerdictView.tsx (a non-visual change - it changes no rendered output,
only what the module makes importable) and
`frontend/scripts/pace-line-mirror.mjs` imports it through G148's
`_tsx-loader.mjs` (the same ESM loader `scripts/spend-from-render.test.mjs`
uses to run a real .tsx component's exported function from plain Node, no
Next build required) and prints its output as JSON. This test shells out to
that script and diffs its output against `_pace_line`'s, byte-for-byte, for
a shared set of fixtures. If either side's wording, rounding, or branch
order changes without the other, the two JSON arrays stop matching.
"""
import json
import subprocess
from pathlib import Path

import pytest

from app.services.notifications import _pace_line

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
LOADER = FRONTEND_DIR / "scripts" / "_tsx-loader.mjs"
RUNNER = FRONTEND_DIR / "scripts" / "pace-line-mirror.mjs"

# Currency symbol the frontend hardcodes in `fmt`; the backend's `_pace_line`
# takes `sym` as a parameter (multi-currency), but every caller today passes
# "£" (see notifications.py's `_maybe_category_pace` - a pre-existing
# hardcode one level above `_pace_line`, not this item's to fix), so
# fixtures use it too.
SYM = "£"

# (multiple, excess, days_elapsed) - covers all three paceLine branches,
# plus a .5 excess in the more-than-usual branch on each side of the
# boundary: Python's round() is banker's rounding (round(1234.5) == 1234)
# but JS's Math.round is half-away-from-zero (Math.round(1234.5) === 1235),
# so a fixture landing exactly on .5 is the one that would have caught the
# rounding mismatch fixed alongside this test.
FIXTURES = [
    (1.3, 210.0, 13),      # more-than-usual branch (the one G151 changed)
    (1.05, 42.0, 5),       # more-than-usual branch, small excess
    (1.3, 1234.5, 13),     # more-than-usual branch, exact .5 (Python/JS diverge)
    (1.05, 142.5, 5),      # more-than-usual branch, exact .5, different day
    (2.0, 340.0, 13),      # exactly-twice branch
    (3.4, 900.0, 22),      # N.Nx-multiple branch
]


def _frontend_pace_lines(cases: list[tuple[float, float, int]]) -> list[str]:
    """The REAL `paceLine`'s output for each (multiple, excess, days_elapsed)
    case, computed by running the actual frontend function through Node -
    not a Python re-implementation of its formatting."""
    payload = [
        {"multiple": m, "excess": e, "daysElapsed": d} for m, e, d in cases
    ]
    result = subprocess.run(
        [
            "node", "--no-warnings",
            "--experimental-loader", str(LOADER),
            str(RUNNER), json.dumps(payload),
        ],
        cwd=FRONTEND_DIR,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"pace-line-mirror.mjs failed (exit {result.returncode}):\n"
        f"--- stdout ---\n{result.stdout}\n--- stderr ---\n{result.stderr}"
    )
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        pytest.fail(f"pace-line-mirror.mjs did not print JSON:\n{result.stdout!r}")


def test_backend_pace_line_mirrors_the_real_frontend_paceline():
    backend_lines = [_pace_line(m, e, d, SYM) for m, e, d in FIXTURES]
    frontend_lines = _frontend_pace_lines(FIXTURES)

    assert len(frontend_lines) == len(FIXTURES), (
        f"expected {len(FIXTURES)} lines back from pace-line-mirror.mjs, "
        f"got {len(frontend_lines)}: {frontend_lines}"
    )
    for (multiple, excess, days_elapsed), backend_line, frontend_line in zip(
        FIXTURES, backend_lines, frontend_lines
    ):
        assert backend_line == frontend_line, (
            f"mirror broken for multiple={multiple}, excess={excess}, "
            f"days_elapsed={days_elapsed}: backend said {backend_line!r}, "
            f"the real paceLine said {frontend_line!r}"
        )


def test_backend_pace_line_more_than_usual_wording():
    # Pinned example alongside the generic mirror check above, so a reader
    # of test output sees the concrete string, not just "mirror ok".
    assert _pace_line(1.3, 210.0, 13, SYM) == "£210 more than usual by day 13."


def test_backend_pace_line_rounds_half_up_like_js_math_round():
    # Math.round(1234.5) === 1235 (half away from zero); Python's round()
    # would give 1234 (banker's rounding) without the math.floor(x+0.5) fix.
    assert _pace_line(1.3, 1234.5, 13, SYM) == "£1,235 more than usual by day 13."
    assert _pace_line(1.05, 142.5, 5, SYM) == "£143 more than usual by day 5."


def test_backend_pace_line_twice_and_multiple_wording_unchanged():
    # G151 only changed the more-than-usual branch; these two are untouched
    # and must stay untouched.
    assert _pace_line(2.0, 340.0, 13, SYM) == "about twice your usual pace for day 13."
    assert _pace_line(3.4, 900.0, 22, SYM) == "about 3.4× your usual pace for day 22."
