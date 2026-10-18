"""E8: the self-hosted "new error type" signal.

Sentry has no inbound hook on this deployment, so this is the in-process
complement: a logging handler records the CLASS NAME of every exception that
reaches an error-level log record (uvicorn logs unhandled request exceptions
and the worker logs failed jobs the same way). Nothing else is kept: no
message, no traceback, no arguments, no user data.

- `RECENT` is a bounded map of class name to last-seen time (the last hour's
  distinct classes, shown on /ops/health). `PENDING` is the bounded set not
  yet flushed.
- `flush()` upserts each pending class into `error_types_seen` and reports the
  classes that were never seen, or not seen for 7 days, as NEW.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import timedelta
from typing import Awaitable, Callable, Iterable, Optional

from pymongo import ReturnDocument

from app.services.health.base import naive_utc_now

log = logging.getLogger(__name__)

MAX_TYPES = 200                  # bound on both in-process structures
MAX_NAME_LEN = 80
WINDOW_S = 3600
NEW_AFTER_DAYS = 7
SEEN_TTL_DAYS = 30
_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

RECENT: dict[str, float] = {}
PENDING: set[str] = set()


def clear() -> None:
    RECENT.clear()
    PENDING.clear()


def record(name: object, now: Optional[float] = None) -> bool:
    """Remember an exception class name. Anything that is not a plain
    identifier is ignored, so a message can never end up here."""
    if not isinstance(name, str) or len(name) > MAX_NAME_LEN or not _NAME_RE.match(name):
        return False
    t = time.time() if now is None else now
    if name not in RECENT and len(RECENT) >= MAX_TYPES:
        del RECENT[min(RECENT, key=RECENT.__getitem__)]
    RECENT[name] = t
    if name not in PENDING and len(PENDING) < MAX_TYPES:
        PENDING.add(name)
    return True


def distinct_last_hour(now: Optional[float] = None) -> int:
    cutoff = (time.time() if now is None else now) - WINDOW_S
    return sum(1 for t in RECENT.values() if t >= cutoff)


def _other_handlers(logger: logging.Logger, mine: logging.Handler) -> bool:
    """True when a record from `logger` would reach some handler besides ours."""
    c: Optional[logging.Logger] = logger
    while c is not None:
        if any(h is not mine for h in c.handlers):
            return True
        if not c.propagate:
            break
        c = c.parent
    return False


class ErrorTypeHandler(logging.Handler):
    """Records the class name of error-level records that carry an exception.

    Adding any handler to the root logger switches Python's `lastResort`
    (the stderr fallback for WARNING and above, which this app relies on
    because it configures no root handler) off. So this handler has level
    NOTSET and, when no other handler would see a record, hands it to
    `logging.lastResort` itself: warnings, errors and tracebacks keep
    reaching stderr and journalctl exactly as before."""

    def emit(self, record_: logging.LogRecord) -> None:
        try:
            exc = record_.exc_info
            if record_.levelno >= logging.ERROR and exc and exc[0] is not None:
                record(exc[0].__name__)
        except Exception:
            pass
        try:
            last = logging.lastResort
            if (last is not None and record_.levelno >= last.level
                    and not _other_handlers(logging.getLogger(record_.name), self)):
                last.handle(record_)
        except Exception:
            pass


_HANDLER: Optional[ErrorTypeHandler] = None


def install() -> None:
    """Attach the handler once (root logger, plus uvicorn.error which does
    not propagate). Safe to call from the API and the worker."""
    global _HANDLER
    if _HANDLER is not None:
        return
    _HANDLER = ErrorTypeHandler()
    for name in ("", "uvicorn.error"):
        logging.getLogger(name).addHandler(_HANDLER)


async def ensure_indexes(col) -> None:
    try:
        await col.create_index("last_seen", expireAfterSeconds=SEEN_TTL_DAYS * 86400)
    except Exception as exc:
        log.warning("error type index not created: %s", type(exc).__name__)


async def flush(col, seed_silently_if_empty: bool = True) -> list[str]:
    """Persist the pending class names and return the NEW ones (never seen, or
    last seen over 7 days ago). An empty collection is a first run: its
    classes are recorded as a baseline and nothing is reported."""
    if not PENDING:
        return []
    batch = sorted(PENDING)
    PENDING.difference_update(batch)
    now = naive_utc_now()
    baseline = False
    if seed_silently_if_empty:
        baseline = (await col.find_one({}, {"_id": 1})) is None
    new: list[str] = []
    for name in batch:
        before = await col.find_one_and_update(
            {"_id": name}, {"$set": {"last_seen": now}, "$setOnInsert": {"first_seen": now}},
            upsert=True, return_document=ReturnDocument.BEFORE,
        )
        if before is None or (before.get("last_seen") or now) < now - timedelta(days=NEW_AFTER_DAYS):
            new.append(name)
    return [] if baseline else new
