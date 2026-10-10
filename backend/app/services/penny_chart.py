"""G252: typed chart specs for Penny's replies.

Data, not drawings. The model never writes a point: a read tool builds the
spec from its own rows (usually by turning a G251 table block into a chart
with `chart_from_rows`), this module validates it, and the loop attaches it to
the reply the same way as a table (the model sees a marker plus the summary,
never the points). The client draws it with the chart library the Spend page
already uses.

Spec shape (plain data, never markup):

    {"type": "bar"|"line"|"stacked_bar"|"donut",
     "title": str <= 80,
     "x": {"label": str <= 40, "kind": "date"|"category"|"text"},
     "y": {"label": str <= 40, "unit": "money"|"number"|"rate", "currency": "GBP"?},
     "series": [{"name": str <= 40, "points": [{"x": str, "y": cell}]}],
     "note": str <= 200 (optional),
     "summary": str}

Caps: 1..4 series; bar/line/stacked_bar at most 36 points per series; donut
exactly one series of at most 8 slices (`aggregate_slices` folds the rest
into "Other" and sets the note "Smaller categories grouped as Other").
x: date -> "YYYY-MM-DD"; category/text -> str <= 60. y cells: money ->
{"amount": number, "currency": "GBP"} (one currency per chart), number/rate
-> finite number. Donut and stacked values must be >= 0. Strings that look
like HTML or carry control characters are rejected, unknown fields are
rejected.

`summary` is built HERE from the validated data, one sentence, factual. A
`summary` supplied by anyone is ignored and replaced, so no model text can
reach it. Stored with a conversation turn as the same spec: see
penny_conversations.clean_turn.
"""
import json
import math
from datetime import date

from app.services import penny_table
from app.services.penny_table import _CURRENCY_RE, _CTRL_RE, _DATE_RE, _HTML_RE, clean_text

TYPES = ("bar", "line", "stacked_bar", "donut")
X_KINDS = ("date", "category", "text")
UNITS = ("money", "number", "rate")
MAX_SERIES = 4
MAX_POINTS = 36
MAX_SLICES = 8
MAX_TITLE = 80
MAX_LABEL = 40
MAX_NAME = 40
MAX_X = 60
MAX_NOTE = 200
MAX_BLOCK_JSON = 24000
OTHER = "Other"
OTHER_NOTE = "Smaller categories grouped as Other"

# Request words a user (and so the model) may pass for as_chart, mapped to the
# four supported types. Anything else has no chart form and falls back.
_TYPE_ALIASES = {
    "bar": "bar", "column": "bar", "columns": "bar", "bars": "bar",
    "line": "line", "area": "line", "trend": "line",
    "stacked_bar": "stacked_bar", "stacked": "stacked_bar", "stackedbar": "stacked_bar",
    "stacked bar": "stacked_bar", "stacked-bar": "stacked_bar",
    "donut": "donut", "pie": "donut", "doughnut": "donut",
}
_SYMBOLS = {"GBP": "£", "USD": "$", "EUR": "€"}


class ChartInvalid(ValueError):
    pass


def normalise_type(value) -> tuple[str | None, str | None]:
    """(type, note). A supported word (or a close alias such as pie or area)
    gives its type, with a one-line note for an alias that is a real
    substitution (area drawn as a line). An unsupported word gives
    (None, note) so the caller can fall back to a table."""
    if value is True:
        return "bar", None
    word = str(value or "").strip().lower()
    if word in _TYPE_ALIASES:
        t = _TYPE_ALIASES[word]
        if word == "area":
            return t, "Drawn as a line chart."
        return t, None
    return None, "That chart type is not available, so this is shown as a table."


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _check_text(v, limit, what):
    if not isinstance(v, str):
        raise ChartInvalid(f"{what} must be text")
    if len(v) > limit:
        raise ChartInvalid(f"{what} too long")
    if _HTML_RE.search(v) or _CTRL_RE.search(v):
        raise ChartInvalid(f"{what} contains markup")
    if not v.strip():
        raise ChartInvalid(f"{what} required")


# ── formatting for the server-built summary ────────────────────────────────
def _fmt_money(amount: float, currency: str) -> str:
    sym = _SYMBOLS.get(currency, f"{currency} ")
    a = round(abs(amount), 2)
    body = f"{a:,.0f}" if a == int(a) else f"{a:,.2f}"
    return f"{'−' if amount < 0 and a else ''}{sym}{body}"


def _fmt_value(v: float, y: dict) -> str:
    if y["unit"] == "money":
        return _fmt_money(v, y["currency"])
    if y["unit"] == "rate":
        return f"{v:,.4f}".rstrip("0").rstrip(".")
    return f"{v:,.2f}".rstrip("0").rstrip(".")


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _fmt_x(x: str, kind: str, today: date | None = None) -> str:
    if kind != "date":
        return x
    d = date.fromisoformat(x)
    today = today or date.today()
    base = f"{d.day} {_MONTHS[d.month - 1]}"
    return base if d.year == today.year else f"{base} {d.year}"


def value_of(cell) -> float:
    return float(cell["amount"] if isinstance(cell, dict) else cell)


def build_summary(chart: dict, today: date | None = None) -> str:
    """One factual sentence describing the data, built from validated values
    only. No advice, no judgement words."""
    title, y, xk = chart["title"], chart["y"], chart["x"]["kind"]
    series = chart["series"]
    flat = [(s["name"], p["x"], value_of(p["y"])) for s in series for p in s["points"]]
    fx = lambda x: _fmt_x(x, xk, today)  # noqa: E731
    fv = lambda v: _fmt_value(v, y)  # noqa: E731
    if not flat:
        return f"{title}: no data to show."
    kind = chart["type"]
    if kind == "donut":
        pts = [(p["x"], value_of(p["y"])) for p in series[0]["points"]]
        total = sum(v for _, v in pts)
        name, top = max(pts, key=lambda t: t[1])
        pct = round(100 * top / total) if total else 0
        return f"{title}: {name} is the largest at {fv(top)}, {pct}% of the {fv(total)} shown."
    if kind == "stacked_bar":
        totals: dict[str, float] = {}
        for _, x, v in flat:
            totals[x] = totals.get(x, 0.0) + v
        x_hi = max(totals, key=lambda k: totals[k])
        names = ", ".join(s["name"] for s in series)
        return f"{title}: {names} across {len(totals)} periods, highest total in {fx(x_hi)} at {fv(totals[x_hi])}."
    multi = len(series) > 1
    if kind == "line" and not multi:
        pts = [(p["x"], value_of(p["y"])) for p in series[0]["points"]]
        if len(pts) == 1:
            return f"{title}: {fv(pts[0][1])} on {fx(pts[0][0])}."
        hi = max(pts, key=lambda t: t[1])
        return (f"{title}: from {fv(pts[0][1])} on {fx(pts[0][0])} to {fv(pts[-1][1])} on {fx(pts[-1][0])}, "
                f"highest {fv(hi[1])} on {fx(hi[0])}.")
    hi = max(flat, key=lambda t: t[2])
    lo = min(flat, key=lambda t: t[2])
    who = (lambda n: f" ({n})") if multi else (lambda n: "")
    if len(flat) == 1:
        return f"{title}: {fv(hi[2])} in {fx(hi[1])}."
    return (f"{title}: highest in {fx(hi[1])}{who(hi[0])} at {fv(hi[2])}, "
            f"lowest in {fx(lo[1])}{who(lo[0])} at {fv(lo[2])}.")


# ── validation ─────────────────────────────────────────────────────────────
def _check_y(unit: str, v, currency, what):
    if unit == "money":
        if not isinstance(v, dict) or set(v) != {"amount", "currency"}:
            raise ChartInvalid(f"{what} must be {{amount, currency}}")
        if not _is_number(v["amount"]) or abs(v["amount"]) > 1e12:
            raise ChartInvalid(f"{what} amount must be a finite number")
        if not isinstance(v["currency"], str) or not _CURRENCY_RE.match(v["currency"]):
            raise ChartInvalid(f"{what} currency must be a 3-letter code")
        if currency is not None and v["currency"] != currency:
            raise ChartInvalid("one currency per chart")
    else:
        if not _is_number(v) or abs(v) > 1e12:
            raise ChartInvalid(f"{what} must be a finite number")
        if unit == "rate" and v <= 0:
            raise ChartInvalid(f"{what} must be a positive number")


def validate_chart(raw, today: date | None = None) -> dict:
    """A normalised copy of `raw` with a server-built summary, or ChartInvalid.
    Never mutates its input."""
    if not isinstance(raw, dict):
        raise ChartInvalid("chart must be an object")
    if set(raw) - {"type", "title", "x", "y", "series", "note", "summary"}:
        raise ChartInvalid("unknown chart field")
    ctype = raw.get("type")
    if ctype not in TYPES:
        raise ChartInvalid("bad chart type")
    title = raw.get("title")
    _check_text(title, MAX_TITLE, "title")
    xin, yin = raw.get("x"), raw.get("y")
    if not isinstance(xin, dict) or set(xin) - {"label", "kind"} or xin.get("kind") not in X_KINDS:
        raise ChartInvalid("bad x axis")
    _check_text(xin.get("label"), MAX_LABEL, "x label")
    if not isinstance(yin, dict) or set(yin) - {"label", "unit", "currency"} or yin.get("unit") not in UNITS:
        raise ChartInvalid("bad y axis")
    _check_text(yin.get("label"), MAX_LABEL, "y label")
    unit, currency = yin["unit"], yin.get("currency")
    if unit == "money":
        if not isinstance(currency, str) or not _CURRENCY_RE.match(currency):
            raise ChartInvalid("money axis needs a currency")
    elif currency is not None:
        raise ChartInvalid("currency only on a money axis")
    sin = raw.get("series")
    if not isinstance(sin, list) or not 1 <= len(sin) <= MAX_SERIES:
        raise ChartInvalid(f"1 to {MAX_SERIES} series")
    if ctype == "donut" and len(sin) != 1:
        raise ChartInvalid("a donut has one series")
    if ctype == "donut" and xin["kind"] == "date":
        raise ChartInvalid("a donut needs categories, not dates")
    series, names = [], set()
    for s in sin:
        if not isinstance(s, dict) or set(s) - {"name", "points"}:
            raise ChartInvalid("bad series")
        _check_text(s.get("name"), MAX_NAME, "series name")
        if s["name"] in names:
            raise ChartInvalid("duplicate series name")
        names.add(s["name"])
        pts = s.get("points")
        limit = MAX_SLICES if ctype == "donut" else MAX_POINTS
        if not isinstance(pts, list) or not 1 <= len(pts) <= limit:
            raise ChartInvalid(f"1 to {limit} points")
        seen, clean = set(), []
        for i, p in enumerate(pts):
            if not isinstance(p, dict) or set(p) != {"x", "y"}:
                raise ChartInvalid("bad point")
            x = p["x"]
            if xin["kind"] == "date":
                if not isinstance(x, str) or not _DATE_RE.match(x):
                    raise ChartInvalid("x must be YYYY-MM-DD")
                try:
                    date.fromisoformat(x)
                except ValueError:
                    raise ChartInvalid("x is not a real date")
            else:
                _check_text(x, MAX_X, f"point {i} x")
            if x in seen:
                raise ChartInvalid("duplicate x in a series")
            seen.add(x)
            _check_y(unit, p["y"], currency, f"point {i} y")
            if ctype in ("donut", "stacked_bar") and value_of(p["y"]) < 0:
                raise ChartInvalid("values must not be negative here")
            clean.append({"x": x, "y": dict(p["y"]) if isinstance(p["y"], dict) else p["y"]})
        series.append({"name": s["name"], "points": clean})
    if ctype == "donut" and sum(value_of(p["y"]) for p in series[0]["points"]) <= 0:
        raise ChartInvalid("a donut needs something to share")
    y = {"label": yin["label"], "unit": unit}
    if unit == "money":
        y["currency"] = currency
    out = {"type": ctype, "title": title.strip(), "x": {"label": xin["label"], "kind": xin["kind"]},
           "y": y, "series": series}
    note = raw.get("note")
    if note is not None:
        _check_text(note, MAX_NOTE, "note")
        out["note"] = note.strip()
    out["summary"] = build_summary(out, today)  # any supplied summary is discarded
    if len(json.dumps(out, ensure_ascii=False)) > MAX_BLOCK_JSON:
        raise ChartInvalid("chart too large")
    return out


def validate_or_none(raw) -> dict | None:
    try:
        return validate_chart(raw)
    except ChartInvalid:
        return None


# ── builders ───────────────────────────────────────────────────────────────
def aggregate_slices(points: list[tuple[str, float]]) -> tuple[list[tuple[str, float]], str | None]:
    """Donut slices: largest first, positive only, at most MAX_SLICES, the tail
    (and any slice already called Other) summed into one "Other". Returns the
    slices and the aggregation note, or None when nothing was grouped."""
    pos = sorted(((n, v) for n, v in points if v > 0), key=lambda t: -t[1])
    if len(pos) <= MAX_SLICES:
        return _other_last(pos), None
    keep, rest = pos[: MAX_SLICES - 1], pos[MAX_SLICES - 1:]
    other_total = sum(v for _, v in rest) + sum(v for n, v in keep if n == OTHER)
    kept = [t for t in keep if t[0] != OTHER]
    return kept + [(OTHER, round(other_total, 2))], OTHER_NOTE


def _other_last(pts: list[tuple[str, float]]) -> list[tuple[str, float]]:
    return [t for t in pts if t[0] != OTHER] + [t for t in pts if t[0] == OTHER]


def join_notes(*notes) -> str | None:
    text = " ".join(n.strip() for n in notes if n and n.strip())
    return text[:MAX_NOTE] or None


def chart_from_rows(
    table: dict,
    chart_type: str,
    x_key: str,
    y_keys: list[str],
    *,
    title: str | None = None,
    series_names: list[str] | None = None,
    x_kind: str | None = None,
    y_label: str | None = None,
    note: str | None = None,
) -> dict | None:
    """Turn a validated G251 table block into a validated chart spec, so any
    tool that can return rows can return a chart. `x_key` is a date or text
    column, each of `y_keys` a money, number or rate column (one series each,
    all the same unit and currency). Over-long series keep the most recent
    MAX_POINTS points and say so; donut slices beyond the cap are folded into
    "Other". Returns None when the rows cannot make that chart, so the caller
    falls back to the table."""
    if chart_type not in TYPES or not isinstance(table, dict):
        return None
    cols = {c["key"]: c for c in table.get("columns", [])}
    xc = cols.get(x_key)
    ycs = [cols.get(k) for k in y_keys]
    if not xc or not ycs or any(c is None for c in ycs) or xc["kind"] not in ("date", "text"):
        return None
    units = {c["kind"] for c in ycs}
    if len(units) != 1 or not units <= {"money", "number", "rate"}:
        return None
    unit = units.pop()
    kind = x_kind or ("date" if xc["kind"] == "date" else "category")
    if kind == "date" and xc["kind"] != "date":
        return None
    names = series_names or [c["label"] for c in ycs]
    if len(names) != len(ycs):
        return None
    currency = None
    series, notes = [], []
    for name, c in zip(names, ycs):
        pts = []
        for r in table["rows"]:
            x, v = r.get(x_key), r.get(c["key"])
            if x is None or v is None:
                continue
            if unit == "money":
                currency = currency or v["currency"]
                if v["currency"] != currency:
                    return None
            pts.append((x, v))
        if kind == "date":
            pts.sort(key=lambda t: t[0])
        series.append((name, pts))
    if not any(p for _, p in series):
        return None
    if chart_type == "donut":
        if len(series) != 1 or kind == "date":
            return None
        slices, agg_note = aggregate_slices([(x, value_of(v)) for x, v in series[0][1]])
        if len(slices) < 2:
            return None
        notes.append(agg_note)
        series_out = [{"name": series[0][0], "points": [
            {"x": n, "y": ({"amount": round(v, 2), "currency": currency} if unit == "money" else v)}
            for n, v in slices]}]
    else:
        series_out = []
        for name, pts in series:
            if len(pts) > MAX_POINTS:
                notes.append(f"Showing the most recent {MAX_POINTS} of {len(pts)} points.")
                pts = pts[-MAX_POINTS:]
            series_out.append({"name": name, "points": [{"x": x, "y": v} for x, v in pts]})
    raw = {
        "type": chart_type,
        "title": clean_text(title or table.get("title") or "Chart", MAX_TITLE),
        "x": {"label": clean_text(xc["label"], MAX_LABEL), "kind": kind},
        "y": {"label": clean_text(y_label or ycs[0]["label"], MAX_LABEL), "unit": unit,
              **({"currency": currency} if unit == "money" else {})},
        "series": series_out,
    }
    joined = join_notes(note, *notes)
    if joined:
        raw["note"] = joined
    return validate_or_none(raw)


def coerce_type(requested: str, table: dict, x_key: str, y_keys: list[str]) -> tuple[str, str | None]:
    """The nearest type the data can honestly be drawn as, with a one-line note
    when it differs from the request. A donut needs one value per category (a
    time series becomes a bar), stacked needs two or more series (one becomes a
    bar), a line needs two or more points (one becomes a bar)."""
    cols = {c["key"]: c for c in table.get("columns", [])}
    xc = cols.get(x_key) or {}
    n_points = len([r for r in table.get("rows", []) if r.get(x_key) is not None])
    if requested == "donut" and (xc.get("kind") == "date" or len(y_keys) != 1):
        return "bar", "A pie chart needs one share per category, so this is a bar chart."
    if requested == "stacked_bar" and len(y_keys) < 2:
        return "bar", "There is only one series to stack, so this is a bar chart."
    if requested == "line" and n_points < 2:
        return "bar", "A line needs at least two points, so this is a bar chart."
    return requested, None


def marker_for_model(chart: dict) -> dict:
    """What the model is told instead of the points."""
    return {
        "shown": True,
        "type": chart["type"],
        "series": [s["name"] for s in chart["series"]],
        "points": sum(len(s["points"]) for s in chart["series"]),
        "summary": chart["summary"],
        "instruction": (
            "The user sees this chart directly below your reply. Reference it in one "
            "sentence (it is below, not above), quote only figures from the summary or "
            "the tool totals, and state facts only. Do not retype, list or describe any point."
        ),
    }
