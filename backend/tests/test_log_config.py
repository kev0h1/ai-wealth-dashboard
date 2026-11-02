"""A190: diagnostic loggers are promoted to INFO without duplicate handlers."""
import logging

import pytest

from app.core import log_config
from app.core.log_config import (
    FINEXER_DIAGNOSTIC_LOGGERS,
    configure_diagnostic_logging,
)


@pytest.fixture(autouse=True)
def _restore_loggers():
    names = list(FINEXER_DIAGNOSTIC_LOGGERS) + ["app.services.not_promoted"]
    saved = {
        n: (logging.getLogger(n).level, list(logging.getLogger(n).handlers))
        for n in names
    }
    for n in names:
        lg = logging.getLogger(n)
        lg.setLevel(logging.NOTSET)
        lg.handlers = []
    yield
    for n, (lvl, handlers) in saved.items():
        lg = logging.getLogger(n)
        lg.setLevel(lvl)
        lg.handlers = handlers


class _BareRoot:
    """Root logger with no handlers, as in production under uvicorn.

    pytest's logging plugin attaches capture handlers to root during the
    call phase (after fixtures), so the handlers are stripped lazily, each
    time the test reads ``.handlers`` via ``strip()``/``configure()``.
    """

    def __init__(self, root):
        self.root = root

    def strip(self):
        self.root.handlers = []

    def configure(self):
        self.strip()
        configure_diagnostic_logging()


@pytest.fixture
def bare_root(monkeypatch):
    root = logging.getLogger()
    saved_handlers = list(root.handlers)
    saved_level = root.level
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    root.setLevel(logging.WARNING)
    yield _BareRoot(root)
    root.handlers = saved_handlers
    root.setLevel(saved_level)


def test_listed_loggers_enabled_for_info(bare_root):
    bare_root.configure()
    assert FINEXER_DIAGNOSTIC_LOGGERS
    for name in FINEXER_DIAGNOSTIC_LOGGERS:
        assert logging.getLogger(name).isEnabledFor(logging.INFO), name
        assert not logging.getLogger(name).isEnabledFor(logging.DEBUG), name


def test_second_call_adds_no_duplicate_handlers(bare_root):
    bare_root.configure()
    counts = {n: len(logging.getLogger(n).handlers) for n in FINEXER_DIAGNOSTIC_LOGGERS}
    assert all(c == 1 for c in counts.values())
    bare_root.configure()
    for n in FINEXER_DIAGNOSTIC_LOGGERS:
        assert len(logging.getLogger(n).handlers) == counts[n]


def test_no_handler_added_when_root_already_has_one(bare_root, monkeypatch):
    bare_root.root.handlers = [logging.NullHandler()]
    configure_diagnostic_logging()
    for n in FINEXER_DIAGNOSTIC_LOGGERS:
        assert logging.getLogger(n).handlers == []


def test_unlisted_app_logger_keeps_root_level(bare_root):
    bare_root.configure()
    other = logging.getLogger("app.services.not_promoted")
    assert other.level == logging.NOTSET
    assert other.getEffectiveLevel() == logging.WARNING
    assert not other.isEnabledFor(logging.INFO)


def test_log_level_env_override_and_invalid_fallback(bare_root, monkeypatch):
    monkeypatch.setenv("LOG_LEVEL", "warning")
    bare_root.configure()
    lg = logging.getLogger(FINEXER_DIAGNOSTIC_LOGGERS[0])
    assert lg.level == logging.WARNING
    monkeypatch.setenv("LOG_LEVEL", "nonsense")
    bare_root.configure()
    assert lg.level == logging.INFO


def test_info_line_reaches_stdout(bare_root, capsys):
    bare_root.configure()
    logging.getLogger("app.services.finexer_sync").info("a190 visible")
    assert "a190 visible" in capsys.readouterr().out
    assert log_config._DEFAULT_LEVEL == logging.INFO
