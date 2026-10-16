"""E6: Sentry error capture with strict scrubbing (docs/ops/OBSERVABILITY.md).

Nothing leaves this process for Sentry without passing `scrub_event` /
`scrub_breadcrumb`. The rules, in short:

* `send_default_pii` is off and request bodies, cookies and all headers
  except a short allowlist are dropped.
* The user is replaced with `{"id": sha256(uid)[:16]}`; no email, name or IP.
* Any dict key that names personal or financial data (email, name, amount,
  balance, merchant, token, authorization, ...) has its value replaced.
* Every remaining string is pattern-scrubbed: emails, bearer tokens, JWTs,
  long secrets, card numbers, IBANs, sort codes, 8-digit account numbers and
  currency amounts.
* Stack frame local variables are never attached (`include_local_variables`
  is off and `vars` is stripped again here as a belt and braces).
* Expected 4xx HTTP errors are not reported.

Residual risk, stated plainly: exception messages are scrubbed by pattern
only. A merchant name interpolated into an exception message is not
detectable by regex, so code must not interpolate transaction text into
exception messages (the reviewer's privacy pass greps for this).

`init_sentry()` is a no-op unless SENTRY_DSN is set, so tests, CI and local
runs never construct a client and never make a network call.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

FILTERED = "[Filtered]"
MAX_DEPTH = 12
MAX_STRING = 400
# Hard ceiling: traces are sampled at 0.1 at most, whatever the env says.
MAX_TRACES_SAMPLE_RATE = 0.1

# ── String patterns ───────────────────────────────────────────────────────────
# Order matters: the more specific shapes run before the generic digit runs.
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"), "Bearer [Filtered]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}"), FILTERED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), FILTERED),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"), "[email]"),
    (re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b"), "[iban]"),
    (re.compile(r"(?<![\w.])\d{2}[- ]\d{2}[- ]\d{2}(?![\w.])"), "[sort code]"),
    (re.compile(r"(?<![\w.])(?:\d[ -]?){13,19}(?![\w.])"), "[card number]"),
    (re.compile(r"(?<![\w.])\d{8}(?![\w.])"), "[account number]"),
    (
        re.compile(r"(?i)(?:[-−+]\s?)?(?:[£$€]|\bGBP\s?|\bUSD\s?|\bEUR\s?)\s?\d[\d,]*(?:\.\d+)?"),
        "[amount]",
    ),
    (re.compile(r"(?i)\b\d[\d,]*(?:\.\d+)?\s?(?:GBP|pounds)\b"), "[amount]"),
    (re.compile(r"(?<![\w.])\d[\d,]*\.\d{2}(?![\d.\w])"), "[amount]"),
    # Long opaque strings (API keys, session secrets). 43+ so a 40-char git SHA
    # and 32-char trace ids are untouched.
    (re.compile(r"(?<![\w-])[A-Za-z0-9_+/=-]{43,}(?![\w-])"), FILTERED),
]

_URL_QUERY = re.compile(r"[?#].*$")

# ── Key rules ─────────────────────────────────────────────────────────────────
_SENSITIVE_EXACT = {
    "name", "first_name", "last_name", "full_name", "display_name", "username",
    "email", "merchant", "payee", "payer", "description", "reference", "memo",
    "address", "phone", "ip", "ip_address",
}
_SENSITIVE_FRAGMENTS = (
    "password", "passwd", "secret", "token", "authorization", "cookie", "api_key",
    "apikey", "api-key", "amount", "balance", "iban", "sort_code", "sortcode",
    "account_number", "card", "session", "csrf", "dsn", "credential", "signature",
    "merchant", "email", "bearer",
)
# Structural keys that must pass through untouched (identifiers the SDK needs).
_SAFE_KEYS = {
    "release", "event_id", "trace_id", "span_id", "parent_span_id", "environment",
    "platform", "timestamp", "start_timestamp", "level", "type", "sdk", "op",
    "status", "filename", "module", "function", "lineno", "colno", "in_app",
    "transaction", "version", "name_of_sdk", "origin", "sampled", "fingerprint",
    "mechanism", "handled", "package",
}
# Pass-through is only for keys that are not also personal-data keys: "name"
# is NOT in _SAFE_KEYS, and "transaction" (the route template) is.
_ALLOWED_HEADERS = {"content-type", "content-length", "accept", "accept-language", "host"}

_DROP_BREADCRUMB_CATEGORIES = {"query", "redis", "mongo", "db", "sql"}

# "pin" as a substring would hit e.g. "mapping", so these match exactly.
_PIN_KEYS = {"pin", "passcode", "otp"}


def _is_sensitive_key(key: str) -> bool:
    k = key.strip().lower()
    if k in _SAFE_KEYS:
        return False
    if k in _SENSITIVE_EXACT or k in _PIN_KEYS:
        return True
    return any(f in k for f in _SENSITIVE_FRAGMENTS)


def scrub_string(value: str) -> str:
    out = value
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    if len(out) > MAX_STRING:
        out = out[:MAX_STRING] + "..."
    return out


def strip_query(url: str) -> str:
    return _URL_QUERY.sub("", url)


def scrub_value(value: Any, key: str = "", depth: int = 0) -> Any:
    """Recursively scrub any JSON-like value. Keys decide first, then the
    string patterns run over whatever is left."""
    if key and _is_sensitive_key(key):
        return FILTERED
    if depth > MAX_DEPTH:
        return FILTERED
    if isinstance(value, str):
        if key in _SAFE_KEYS:
            return value
        if key == "url" or key.endswith("_url"):
            value = strip_query(value)
        return scrub_string(value)
    if isinstance(value, dict):
        return {k: scrub_value(v, str(k), depth + 1) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_value(v, key, depth + 1) for v in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return FILTERED


def hash_user_id(uid: Any) -> str:
    salt = os.getenv("SENTRY_USER_HASH_SALT", "")
    return hashlib.sha256(f"{salt}{uid}".encode()).hexdigest()[:16]


def _scrub_user(user: Any) -> dict | None:
    if not isinstance(user, dict):
        return None
    uid = user.get("id") or user.get("user_id") or user.get("_id")
    if uid in (None, ""):
        return None
    return {"id": hash_user_id(uid)}


def _scrub_request(request: Any) -> dict:
    if not isinstance(request, dict):
        return {}
    out: dict[str, Any] = {}
    if request.get("method"):
        out["method"] = str(request["method"])[:10]
    if request.get("url"):
        out["url"] = scrub_string(strip_query(str(request["url"])))
    headers = request.get("headers")
    if isinstance(headers, dict):
        out["headers"] = {
            k: scrub_string(str(v)) for k, v in headers.items() if str(k).lower() in _ALLOWED_HEADERS
        }
    # data, cookies, query_string, env are dropped outright.
    return out


def _scrub_exception(exc_block: Any) -> Any:
    if not isinstance(exc_block, dict):
        return exc_block
    values = []
    for entry in exc_block.get("values") or []:
        if not isinstance(entry, dict):
            continue
        entry = dict(entry)
        if isinstance(entry.get("value"), str):
            entry["value"] = scrub_string(entry["value"])
        st = entry.get("stacktrace")
        if isinstance(st, dict):
            frames = []
            for fr in st.get("frames") or []:
                if isinstance(fr, dict):
                    fr = {k: v for k, v in fr.items() if k not in ("vars", "pre_context", "context_line", "post_context")}
                    if isinstance(fr.get("abs_path"), str):
                        fr["abs_path"] = scrub_string(fr["abs_path"])
                frames.append(fr)
            entry["stacktrace"] = {**st, "frames": frames}
        values.append(entry)
    return {**exc_block, "values": values}


def scrub_breadcrumb(crumb: dict | None, hint: dict | None = None) -> dict | None:
    """before_breadcrumb hook. Returns None to drop the breadcrumb."""
    if not isinstance(crumb, dict):
        return None
    if str(crumb.get("category") or "").lower() in _DROP_BREADCRUMB_CATEGORIES:
        return None
    out: dict[str, Any] = {}
    for k in ("type", "category", "level", "timestamp"):
        if k in crumb:
            out[k] = crumb[k]
    if isinstance(crumb.get("message"), str):
        out["message"] = scrub_string(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        cleaned: dict[str, Any] = {}
        for k, v in data.items():
            kl = str(k).lower()
            if kl in ("body", "request_body", "response_body", "http.request.body", "query", "http.query", "http.fragment"):
                continue
            cleaned[k] = scrub_value(strip_query(v) if kl == "url" and isinstance(v, str) else v, str(k), 1)
        out["data"] = cleaned
    return out


def _is_expected_http_error(hint: dict | None) -> bool:
    exc_info = (hint or {}).get("exc_info")
    if not exc_info:
        return False
    exc = exc_info[1]
    status = getattr(exc, "status_code", None)
    if isinstance(status, int) and 400 <= status < 500:
        return True
    try:
        import asyncio
        if isinstance(exc, asyncio.CancelledError):
            return True
    except Exception:  # pragma: no cover
        pass
    return type(exc).__name__ in {"ClientDisconnect"}


def scrub_event(event: dict | None, hint: dict | None = None) -> dict | None:
    """before_send hook. Returns None to drop the event."""
    if not isinstance(event, dict):
        return None
    if _is_expected_http_error(hint):
        return None

    out: dict[str, Any] = {}
    for key, value in event.items():
        if key in ("request", "user", "exception", "breadcrumbs", "server_name", "modules", "spans"):
            continue
        out[key] = scrub_value(value, key, 1)

    if "request" in event:
        out["request"] = _scrub_request(event["request"])
    user = _scrub_user(event.get("user"))
    if user:
        out["user"] = user
    if "exception" in event:
        out["exception"] = _scrub_exception(event["exception"])
    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict):
        out["breadcrumbs"] = {
            **{k: v for k, v in crumbs.items() if k != "values"},
            "values": [c for c in (scrub_breadcrumb(b) for b in crumbs.get("values") or []) if c],
        }
    elif isinstance(crumbs, list):
        out["breadcrumbs"] = [c for c in (scrub_breadcrumb(b) for b in crumbs) if c]
    spans = event.get("spans")
    if isinstance(spans, list):
        # Database and HTTP span descriptions carry statements and URLs; keep
        # timing, drop the text.
        out["spans"] = [
            {k: v for k, v in s.items() if k not in ("description", "data", "tags")}
            for s in spans if isinstance(s, dict)
        ]
    return out


# ── Environment and release ───────────────────────────────────────────────────

def resolve_environment() -> str:
    explicit = (os.getenv("APP_ENV") or os.getenv("SENTRY_ENV") or "").strip().lower()
    if explicit in ("uat", "production"):
        return explicit
    if explicit in ("prod",):
        return "production"
    if explicit in ("vps", "staging", "development", "dev", "local", "test"):
        return "uat"
    try:
        from app.core.config import APP_URL, _is_non_production
        return "uat" if _is_non_production(APP_URL) else "production"
    except Exception:  # pragma: no cover
        return "production"


def resolve_release() -> str | None:
    for name in ("RELEASE_SHA", "RAILWAY_GIT_COMMIT_SHA"):
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    try:
        repo = Path(__file__).resolve().parents[3]
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True, timeout=2, check=False,
        )
        sha = out.stdout.strip()
        return sha or None
    except Exception:
        return None


def resolve_traces_sample_rate() -> float:
    raw = os.getenv("SENTRY_TRACES_SAMPLE_RATE")
    try:
        rate = float(raw) if raw not in (None, "") else MAX_TRACES_SAMPLE_RATE
    except ValueError:
        rate = MAX_TRACES_SAMPLE_RATE
    return max(0.0, min(rate, MAX_TRACES_SAMPLE_RATE))


def init_sentry() -> bool:
    """Initialise Sentry if, and only if, SENTRY_DSN is set. Returns whether
    it did. Never raises: error reporting must not stop the app starting."""
    dsn = (os.getenv("SENTRY_DSN") or "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=resolve_environment(),
            release=resolve_release(),
            send_default_pii=False,
            traces_sample_rate=resolve_traces_sample_rate(),
            profiles_sample_rate=0.0,
            include_local_variables=False,
            include_source_context=False,
            max_request_body_size="never",
            max_breadcrumbs=50,
            shutdown_timeout=2,
            before_send=scrub_event,
            before_send_transaction=scrub_event,
            before_breadcrumb=scrub_breadcrumb,
        )
        return True
    except Exception:
        logger.warning("sentry init failed; continuing without error reporting", exc_info=True)
        return False
