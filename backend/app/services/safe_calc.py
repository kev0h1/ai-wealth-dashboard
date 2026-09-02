"""Generic arithmetic tool for Penny, owner-approved 2026-08-30 (see
PENNY_TOOLS.md's `calculate` row). Owner's own words, verbatim: "we will
need some sort of arithmetic tool in penny because for the envelope I'm
trying to create I want it to figure out to get the first transaction for
the period add 4p to it everyday until the end of the pay period, but again
this needs to be a generic arithmetic tool, other people might have
different use cases." His concrete case is a daily savings-challenge
payment that rises by a fixed step every day across a pay period, an
arithmetic series — `series_sum` below is that, but the tool itself stays
generic: any small expression built from numbers, the four basic operators,
and a fixed, tiny whitelist of functions, so a different user's different
maths ("what's 15% of my last three bills") works the same way.

`evaluate` is the only public entry point. It parses the expression with
Python's own `ast` module (never `eval`/`exec`, never `compile` with a
custom namespace passed to a real evaluator) and walks the resulting tree
twice: once to REJECT anything not on the whitelist below (`_check`), then
once to actually compute the value (`_eval`) — the two passes are kept
separate on purpose, so a value is never computed for a node that was
already going to be rejected, and so every rejection reason lives in one
place (`_check`) rather than being scattered across arithmetic branches.

Failure doctrine, matching the rest of the Penny tool layer (see
`penny_tools._tool_error`): `evaluate` NEVER raises. Every rejection, parse
failure, or runtime error (division by zero, an over-large exponent, an
out-of-range result, ...) is caught internally and turned into
`{"ok": False, "result": None, "error": "<plain English sentence>"}`. A
malicious or malformed expression cannot crash the tool loop or hang the
request; the bounds below (all named constants, not magic numbers) exist
specifically to make that true architecturally rather than by best effort:

- `MAX_EXPR_LEN` (chars) and `MAX_AST_NODES` bound the size of the parse
  tree itself, so validation and evaluation are always cheap regardless of
  input.
- `MAX_EXPONENT_ABS` bounds any single `**` operation's exponent (checked
  against the exponent's actual VALUE at eval time, not just its syntax, so
  `2 ** (3 + 4)` is caught too) — this is what stops a `10 ** 10 ** 10`
  shape from ever attempting the outer power at all: `**` is right-
  associative, so the inner `10 ** 10` computes fine (a rounding-error-free
  10-digit int, checked against the bound and well within it), then the
  OUTER power's own exponent (10000000000) is checked against the bound
  BEFORE `left ** right` is ever evaluated, and rejected there. No exponent
  this module will actually compute can produce a result whose size isn't
  already bounded by `MAX_RESULT_ABS` a few lines below, so no single `**`
  here can ever take more than a fraction of a second.
- `MAX_SERIES_COUNT` bounds `series_sum`'s `count` (its formula is closed-
  form, see below, so this is a sanity bound rather than a performance one).
- `MAX_RESULT_ABS` rejects any final answer too large to be a plausible
  money/day/percentage figure, whether or not it was cheap to compute.
- Division (`/`, `//`, `%`) by zero is checked explicitly and turned into a
  clean error rather than ever reaching Python's own `ZeroDivisionError`.

Whitelist, enforced by construction (an AST node type or function name not
explicitly recognised below always falls through to a rejection, there is
no default-allow path anywhere in `_check`):
- Numeric literals (`int`/`float`), parenthesised grouping, unary minus.
- Binary operators: `+ - * / // % **`.
- Calls to EXACTLY: `round`, `abs`, `min`, `max`, `series_sum(first, step,
  count)`, `days_between("YYYY-MM-DD", "YYYY-MM-DD")`, `pct(x, p)`.
- String literals ONLY as `days_between`'s two positional arguments, and
  only as a literal `"YYYY-MM-DD"` constant there, never a computed string.

Forbidden by construction, each proven by a dedicated test in
test_safe_calc.py: names/variables (no execution environment is ever built
for one to resolve against), attribute access (`x.y`), subscripts (`x[0]`),
comprehensions and generator expressions, lambdas, any call whose function
name isn't in the fixed whitelist above (including a whitelisted name
reached via a non-Name callable, e.g. `(round)(1)` still resolves to a
plain `Name` node so it is fine, but `getattr(round, "__call__")(1)` is not,
since `getattr` itself is never in the whitelist), and any of those same
things nested inside an otherwise-allowed call's arguments (`_check`
recurses into every argument of an allowed call the same way it checks the
top-level expression, so `round(__import__('os').system('ls'))` is rejected
for the same reason a bare `__import__('os').system('ls')` would be).

`series_sum(first, step, count)`: the total of `count` payments starting at
`first` and rising (or falling, for a negative `step`) by `step` each time —
an arithmetic series, closed-form rather than iterated: `count*first +
step*count*(count-1)/2`. Owner's own worked example: a savings-challenge
payment starting at £8.96, rising 4p a day for 27 days, is
`series_sum(8.96, 0.04, 27)`.

`days_between(d1, d2)`: INCLUSIVE of `d1`, EXCLUSIVE of `d2` — the plain
`(d2 - d1).days` a calendar would give you for "how many whole days between
these two dates", so `days_between("2026-01-01", "2026-01-01")` is `0` (no
time has passed) and `days_between("2026-01-01", "2026-01-02")` is `1` (one
full day). This is the convention that matches counting forward from a
known date to a deadline (the owner's own pay-period-end use case) without
double-counting the start day; a caller who wants the END date counted too
should add 1 themselves via ordinary arithmetic, e.g.
`days_between("2026-01-01", "2026-01-02") + 1`.
"""
import ast
import re
from datetime import date

MAX_EXPR_LEN = 400
MAX_AST_NODES = 150
MAX_EXPONENT_ABS = 12
MAX_SERIES_COUNT = 5000
MAX_RESULT_ABS = 1e12

_ALLOWED_FUNCS = frozenset({"round", "abs", "min", "max", "series_sum", "days_between", "pct"})
_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class _CalcError(Exception):
    """Internal only: any rejection (structural, via `_check`) or failure
    (arithmetic, via `_eval`) raises this. `evaluate` is the sole place that
    catches it and turns it into the public `{"ok": False, ...}` shape —
    nothing in this module ever lets a `_CalcError`, or any other
    exception, escape `evaluate` itself."""


def evaluate(expression: str) -> dict:
    """Safely evaluate a small arithmetic expression against the whitelist
    documented in this module's docstring. Always returns
    `{"ok": bool, "result": float | int | None, "error": str | None}` and
    never raises, regardless of input."""
    if not isinstance(expression, str) or not expression.strip():
        return _fail("give me an expression to calculate")
    if len(expression) > MAX_EXPR_LEN:
        return _fail(f"that expression is too long, keep it under {MAX_EXPR_LEN} characters")

    try:
        tree = ast.parse(expression, mode="eval")
    except (SyntaxError, ValueError):
        return _fail("that could not be parsed as an expression")

    node_count = [0]
    try:
        _check(tree.body, node_count)
        result = _eval(tree.body)
    except _CalcError as e:
        return _fail(str(e))
    except ZeroDivisionError:
        return _fail("that involves dividing by zero")
    except (OverflowError, ValueError):
        return _fail("that expression could not be computed")
    except Exception:
        return _fail("that expression could not be computed")

    if isinstance(result, bool) or not isinstance(result, (int, float)):
        return _fail("that expression did not produce a number")
    if isinstance(result, float) and (result != result or result in (float("inf"), float("-inf"))):
        return _fail("that expression could not be computed")
    if abs(result) >= MAX_RESULT_ABS:
        return _fail("that result is too large to be a real answer here")

    if isinstance(result, float):
        # Clears float representation noise (e.g. 8.959999999999999) without
        # touching any deliberate rounding the expression itself asked for
        # via round(...).
        result = round(result, 10)
        if result == int(result):
            result = float(result)  # keep it a float, e.g. 4.0 not 4
    return {"ok": True, "result": result, "error": None}


def _fail(msg: str) -> dict:
    return {"ok": False, "result": None, "error": msg}


def _bump(node_count: list) -> None:
    node_count[0] += 1
    if node_count[0] > MAX_AST_NODES:
        raise _CalcError(f"that expression is too complex, keep it under {MAX_AST_NODES} parts")


def _check(node, node_count: list) -> None:
    """Structural whitelist pass. Raises `_CalcError` the moment it meets
    anything not explicitly recognised — there is no fallthrough allow."""
    _bump(node_count)

    if isinstance(node, ast.Constant):
        if isinstance(node.value, bool):
            raise _CalcError("true/false values are not allowed here")
        if isinstance(node.value, (int, float)):
            return
        # A bare string literal is only ever valid as one of days_between's
        # two arguments, checked and consumed directly in the Call branch
        # below (it never recurses back into `_check` for those two nodes),
        # so any string reaching this branch is a string used somewhere
        # else, which is always a rejection.
        raise _CalcError("text is only allowed as days_between's two 'YYYY-MM-DD' arguments")

    if isinstance(node, ast.BinOp):
        if not isinstance(node.op, _ALLOWED_BINOPS):
            raise _CalcError("that operator is not allowed")
        _check(node.left, node_count)
        _check(node.right, node_count)
        return

    if isinstance(node, ast.UnaryOp):
        if not isinstance(node.op, ast.USub):
            raise _CalcError("only a unary minus is allowed, not that")
        _check(node.operand, node_count)
        return

    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise _CalcError("only direct calls to a fixed set of functions are allowed")
        fname = node.func.id
        if fname not in _ALLOWED_FUNCS:
            raise _CalcError(f"'{fname}' is not one of the allowed functions")
        if node.keywords:
            raise _CalcError("keyword arguments are not allowed")
        if fname == "days_between":
            if len(node.args) != 2:
                raise _CalcError("days_between needs exactly two 'YYYY-MM-DD' date arguments")
            for arg in node.args:
                _bump(node_count)
                if not (isinstance(arg, ast.Constant) and isinstance(arg.value, str)):
                    raise _CalcError("days_between's arguments must be literal 'YYYY-MM-DD' dates")
                if not _DATE_RE.match(arg.value):
                    raise _CalcError("days_between's arguments must look like 'YYYY-MM-DD'")
            return
        for arg in node.args:
            _check(arg, node_count)
        return

    raise _CalcError("that expression contains something that is not allowed")


def _eval(node):
    """Only ever called on a tree that has already passed `_check` in full,
    so every node type here is one `_check` already approved — this is pure
    computation, not a second layer of validation."""
    if isinstance(node, ast.Constant):
        return node.value

    if isinstance(node, ast.BinOp):
        left = _eval(node.left)
        right = _eval(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
            if right == 0:
                raise _CalcError("that involves dividing by zero")
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.FloorDiv):
                return left // right
            return left % right
        if isinstance(node.op, ast.Pow):
            if abs(right) > MAX_EXPONENT_ABS:
                raise _CalcError(f"that exponent is too large, keep it under {MAX_EXPONENT_ABS}")
            return left ** right
        raise _CalcError("that operator is not allowed")

    if isinstance(node, ast.UnaryOp):
        return -_eval(node.operand)

    if isinstance(node, ast.Call):
        fname = node.func.id
        if fname == "days_between":
            d1 = _parse_date(node.args[0].value)
            d2 = _parse_date(node.args[1].value)
            return (d2 - d1).days
        args = [_eval(a) for a in node.args]
        if fname == "round":
            if len(args) == 1:
                return round(args[0])
            if len(args) == 2:
                return round(args[0], int(args[1]))
            raise _CalcError("round takes one or two arguments")
        if fname == "abs":
            if len(args) != 1:
                raise _CalcError("abs takes exactly one argument")
            return abs(args[0])
        if fname == "min":
            if len(args) < 2:
                raise _CalcError("min needs at least two arguments")
            return min(args)
        if fname == "max":
            if len(args) < 2:
                raise _CalcError("max needs at least two arguments")
            return max(args)
        if fname == "series_sum":
            if len(args) != 3:
                raise _CalcError("series_sum needs exactly three arguments: first, step, count")
            first, step, count_raw = args
            if isinstance(count_raw, bool) or not isinstance(count_raw, (int, float)):
                raise _CalcError("series_sum's count must be a whole number")
            if isinstance(count_raw, float) and not count_raw.is_integer():
                raise _CalcError("series_sum's count must be a whole number")
            count = int(count_raw)
            if count < 0:
                raise _CalcError("series_sum's count cannot be negative")
            if count > MAX_SERIES_COUNT:
                raise _CalcError(f"series_sum's count is too large, keep it under {MAX_SERIES_COUNT}")
            return count * first + step * count * (count - 1) / 2
        if fname == "pct":
            if len(args) != 2:
                raise _CalcError("pct needs exactly two arguments: x, p")
            x, p = args
            return x * p / 100
        raise _CalcError(f"'{fname}' is not one of the allowed functions")

    raise _CalcError("that expression contains something that is not allowed")


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise _CalcError(f"'{value}' is not a valid 'YYYY-MM-DD' date")
