"""Diagnostic logger promotion (A190).

Production runs ``uvicorn --log-level warning`` (backend/Dockerfile CMD).
That flag only sets uvicorn's own loggers; it never touches the root logger
or ``app.*`` loggers, and no ``logging.basicConfig`` exists in this app, so
every ``logger.info`` in a module logger is dropped (root defaults to
WARNING, and logging's ``lastResort`` handler is WARNING-only). The Finexer
diagnostics (card sign line, field counts, first-sync shape lines) are INFO,
so they never showed in Railway.

``configure_diagnostic_logging`` promotes exactly the loggers in
``FINEXER_DIAGNOSTIC_LOGGERS`` to INFO (override with the ``LOG_LEVEL`` env
var) and gives them a stdout handler only when nothing else would emit
their records. Uvicorn's access and request logs are not touched.
"""
import logging
import os
import sys

# One list, so it is obvious what is promoted. Add a logger name here to
# make its INFO lines visible in every environment.
FINEXER_DIAGNOSTIC_LOGGERS = (
    "app.services.finexer_sync",
    "app.services.finexer_webhooks",
    "app.services.finexer_consent",
    "app.services.finexer_event_reconcile",
    "app.routers.webhooks",
    "app.services.account_refresh",
)

_DEFAULT_LEVEL = logging.INFO


def _resolve_level(raw: str | None) -> int:
    name = (raw or "").strip().upper()
    level = logging.getLevelName(name) if name else _DEFAULT_LEVEL
    return level if isinstance(level, int) else _DEFAULT_LEVEL


def configure_diagnostic_logging() -> None:
    """Idempotent: safe to call from the API and the worker, and repeatedly."""
    level = _resolve_level(os.environ.get("LOG_LEVEL"))
    root_has_handler = bool(logging.getLogger().handlers)
    for name in FINEXER_DIAGNOSTIC_LOGGERS:
        lg = logging.getLogger(name)
        lg.setLevel(level)
        # If root already has a handler (a dictConfig or basicConfig), the
        # record propagates there; adding ours would print every line twice.
        if root_has_handler or lg.handlers:
            continue
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(levelname)s %(name)s: %(message)s")
        )
        lg.addHandler(handler)
