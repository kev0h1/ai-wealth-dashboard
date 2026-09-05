"""Tests for app.core.config.resolve_allowed_email().

Apple ID can present a Gmail address without dots (Gmail ignores dots in the
local part and treats googlemail.com as an alias of gmail.com), while the
allow list is configured with a specific spelling. resolve_allowed_email()
must resolve such variants to the allow-list spelling so the same person
always lands in the same account regardless of which provider they signed in
with, while NOT applying that dot-insensitivity to non-Gmail domains (where
dots are significant).

Rather than reloading app.core.config via env vars + importlib.reload (which
would also re-run its side-effecting secret/key generation on import), these
tests monkeypatch the module's own ALLOWED_EMAILS/_ALLOWED_BY_KEY structures
directly, using the module's own _gmail_key() helper to build the lookup
exactly the way config.py does at import time. This keeps the test isolated
from the real deployed allow list without duplicating its construction logic.
"""
import app.core.config as config


def _set_allow_list(monkeypatch, emails: list[str]) -> None:
    lowered = [e.strip().lower() for e in emails]
    by_key: dict[str, str] = {}
    for e in lowered:
        k = config._gmail_key(e)
        if k not in by_key:
            by_key[k] = e
    monkeypatch.setattr(config, "ALLOWED_EMAILS", set(lowered))
    monkeypatch.setattr(config, "_ALLOWED_BY_KEY", by_key)


def test_exact_match(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("kevin.maingi12@gmail.com") == "kevin.maingi12@gmail.com"


def test_gmail_dotless_variant_resolves_to_allow_list_spelling(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("kevinmaingi12@gmail.com") == "kevin.maingi12@gmail.com"


def test_googlemail_domain_variant_resolves(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("kevin.maingi12@googlemail.com") == "kevin.maingi12@gmail.com"
    assert config.resolve_allowed_email("kevinmaingi12@googlemail.com") == "kevin.maingi12@gmail.com"


def test_non_gmail_domain_does_not_match_dot_insensitively(monkeypatch):
    _set_allow_list(monkeypatch, ["a.b@auriqltd.co.uk"])
    assert config.resolve_allowed_email("ab@auriqltd.co.uk") is None
    assert config.resolve_allowed_email("a.b@auriqltd.co.uk") == "a.b@auriqltd.co.uk"


def test_unknown_address_returns_none(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("someone-else@example.com") is None


def test_empty_or_none_returns_none(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("") is None
    assert config.resolve_allowed_email(None) is None


def test_case_insensitivity(monkeypatch):
    _set_allow_list(monkeypatch, ["kevin.maingi12@gmail.com"])
    assert config.resolve_allowed_email("Kevin.Maingi12@Gmail.com") == "kevin.maingi12@gmail.com"
    assert config.resolve_allowed_email("KEVINMAINGI12@GMAIL.COM") == "kevin.maingi12@gmail.com"


def test_first_allow_list_entry_wins_on_gmail_key_collision(monkeypatch):
    # Two allow-list entries that collapse to the same Gmail key (four dot
    # arrangements of "kevin j maingi12" are possible; only two are listed).
    # A THIRD, unlisted variant has no exact match, so it must fall through
    # to the Gmail-key lookup and resolve to whichever listed entry came
    # first. Querying the exact entries themselves is a separate case:
    # exact match wins over key-based resolution, so each returns itself.
    _set_allow_list(monkeypatch, ["kevin.j.maingi12@gmail.com", "kevinj.maingi12@gmail.com"])
    assert config.resolve_allowed_email("kevin.jmaingi12@gmail.com") == "kevin.j.maingi12@gmail.com"
    assert config.resolve_allowed_email("kevinjmaingi12@gmail.com") == "kevin.j.maingi12@gmail.com"
    assert config.resolve_allowed_email("kevin.j.maingi12@gmail.com") == "kevin.j.maingi12@gmail.com"
    assert config.resolve_allowed_email("kevinj.maingi12@gmail.com") == "kevinj.maingi12@gmail.com"
