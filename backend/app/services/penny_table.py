"""G251: typed table blocks for Penny's replies.

A read tool can hand the loop rows to show, so the client renders a table
from DATA instead of from markdown the model typed (misaligned columns,
invented numbers, a "None shown" cell). The block is built server-side from
the tool's own rows, validated here, kept OUT of the model's context (the
model only sees a short marker and the tool's totals) and attached to the
reply.

Block shape (every value is plain data, never markup):

    {"title": str <= 80,
     "columns": [{"key": str, "label": str <= 40,
                  "kind": "text"|"money"|"date"|"number"|"rate",
                  "align": "left"|"right"}],           # 1..12 columns
     "rows": [{<column key>: cell, ...}],              # 0..50 rows
     "note": str <= 200 (optional)}

Cells by kind: text -> str <= 200; money -> {"amount": number,
"currency": "GBP"} (signed, so a debit is negative); date -> "YYYY-MM-DD";
number -> int/float; rate -> positive float. None means "no value" and the
client shows a quiet dash. Strings that look like HTML are REJECTED by the
validator (builders strip angle brackets from data first), and a row may only
carry the declared column keys.

Stored with a conversation turn as the same block (user-visible values only,
no tool payloads): see penny_conversations.clean_turn.
"""
import json
import math
import re
from datetime import date, datetime

MAX_COLUMNS = 12
MAX_ROWS = 50
MAX_TITLE = 80
MAX_LABEL = 40
MAX_NOTE = 200
MAX_TEXT_CELL = 200
MAX_BLOCK_JSON = 24000
KINDS = ("text", "money", "date", "number", "rate")
ALIGNS = ("left", "right")
DEFAULT_ALIGN = {"text": "left", "date": "left", "money": "right", "number": "right", "rate": "right"}

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Anything that opens a tag, a comment, a doctype or a processing instruction.
_HTML_RE = re.compile(r"<\s*[/!?a-zA-Z]")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class TableInvalid(ValueError):
    pass


def clean_text(value, limit: int = MAX_TEXT_CELL) -> str:
    """Builder-side scrub for a data string: no angle brackets, no control
    characters, one line, capped. The validator still rejects HTML, this is
    what keeps a merchant called '<b>x' from costing the user their table."""
    text = _CTRL_RE.sub("", str(value or "")).replace("<", "").replace(">", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _check_text(v, limit, what):
    if not isinstance(v, str):
        raise TableInvalid(f"{what} must be text")
    if len(v) > limit:
        raise TableInvalid(f"{what} too long")
    if _HTML_RE.search(v) or _CTRL_RE.search(v):
        raise TableInvalid(f"{what} contains markup")


def _check_cell(kind: str, v, what: str):
    if v is None:
        return
    if kind == "text":
        _check_text(v, MAX_TEXT_CELL, what)
    elif kind == "money":
        if not isinstance(v, dict) or set(v) != {"amount", "currency"}:
            raise TableInvalid(f"{what} must be {{amount, currency}}")
        if not _is_number(v["amount"]) or abs(v["amount"]) > 1e12:
            raise TableInvalid(f"{what} amount must be a finite number")
        if not isinstance(v["currency"], str) or not _CURRENCY_RE.match(v["currency"]):
            raise TableInvalid(f"{what} currency must be a 3-letter code")
    elif kind == "date":
        if not isinstance(v, str) or not _DATE_RE.match(v):
            raise TableInvalid(f"{what} must be YYYY-MM-DD")
        try:
            date.fromisoformat(v)
        except ValueError:
            raise TableInvalid(f"{what} is not a real date")
    elif kind == "number":
        if not _is_number(v) or abs(v) > 1e12:
            raise TableInvalid(f"{what} must be a finite number")
    elif kind == "rate":
        if not _is_number(v) or v <= 0 or v > 1e9:
            raise TableInvalid(f"{what} must be a positive number")


def validate_table(raw) -> dict:
    """Return a normalised copy of `raw` or raise TableInvalid. Never mutates
    its input, never trusts a key it has not checked."""
    if not isinstance(raw, dict):
        raise TableInvalid("table must be an object")
    extra = set(raw) - {"title", "columns", "rows", "note"}
    if extra:
        raise TableInvalid("unknown table field")
    title = raw.get("title")
    _check_text(title, MAX_TITLE, "title")
    if not title.strip():
        raise TableInvalid("title required")
    cols_in = raw.get("columns")
    if not isinstance(cols_in, list) or not 1 <= len(cols_in) <= MAX_COLUMNS:
        raise TableInvalid(f"1 to {MAX_COLUMNS} columns")
    columns, keys = [], set()
    for c in cols_in:
        if not isinstance(c, dict) or set(c) - {"key", "label", "kind", "align"}:
            raise TableInvalid("bad column")
        key, kind = c.get("key"), c.get("kind")
        if not isinstance(key, str) or not _KEY_RE.match(key) or key in keys:
            raise TableInvalid("bad or duplicate column key")
        if kind not in KINDS:
            raise TableInvalid("bad column kind")
        label = c.get("label")
        _check_text(label, MAX_LABEL, "label")
        if not label.strip():
            raise TableInvalid("label required")
        align = c.get("align") or DEFAULT_ALIGN[kind]
        if align not in ALIGNS:
            raise TableInvalid("bad align")
        keys.add(key)
        columns.append({"key": key, "label": label, "kind": kind, "align": align})
    rows_in = raw.get("rows")
    if not isinstance(rows_in, list) or len(rows_in) > MAX_ROWS:
        raise TableInvalid(f"at most {MAX_ROWS} rows")
    kinds = {c["key"]: c["kind"] for c in columns}
    rows = []
    for i, r in enumerate(rows_in):
        if not isinstance(r, dict) or set(r) - keys:
            raise TableInvalid("row has an undeclared key")
        for k, v in r.items():
            _check_cell(kinds[k], v, f"row {i} {k}")
        rows.append({k: r.get(k) for k in kinds})
    out = {"title": title.strip(), "columns": columns, "rows": rows}
    note = raw.get("note")
    if note is not None:
        _check_text(note, MAX_NOTE, "note")
        if note.strip():
            out["note"] = note.strip()
    if len(json.dumps(out, ensure_ascii=False)) > MAX_BLOCK_JSON:
        raise TableInvalid("table too large")
    return out


def validate_or_none(raw) -> dict | None:
    try:
        return validate_table(raw)
    except TableInvalid:
        return None


def money_cell(amount, currency: str = "GBP") -> dict | None:
    if amount is None:
        return None
    try:
        a = round(float(amount), 2)
    except (TypeError, ValueError):
        return None
    cur = str(currency or "GBP").upper()
    if not math.isfinite(a) or not _CURRENCY_RE.match(cur):
        return None
    return {"amount": a, "currency": cur}


def date_cell(value) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str) and _DATE_RE.match(value[:10]):
        return value[:10]
    return None


def pick_columns(columns: list[dict], rows: list[dict]) -> tuple[list[dict], list[dict]]:
    """Drop every optional column (`"optional": True`) that no row has a value
    for, so a missing fee or FX rate is a missing column, never a column of
    dashes. Returns columns without the helper flag."""
    keep = [
        c for c in columns
        if not c.get("optional") or any(r.get(c["key"]) is not None for r in rows)
    ]
    keys = {c["key"] for c in keep}
    return (
        [{k: v for k, v in c.items() if k != "optional"} for c in keep],
        [{k: v for k, v in r.items() if k in keys} for r in rows],
    )


def marker_for_model(table: dict) -> dict:
    """What the model is told instead of the rows."""
    return {
        "shown": True,
        "rows": len(table["rows"]),
        "columns": [c["label"] for c in table["columns"]],
        "instruction": (
            "The user sees this table directly below your reply. Reference it in one "
            "sentence (it is below, not above) and quote the totals. Do not retype, list or format any row."
        ),
    }
