"""Tests for app.core.config.resolve_owner_email() (A174).

The env allow list is gone: the only env-level identity is the owner
(PRIMARY_EMAIL), who is always allowed in. Gmail ignores dots in the local
part and treats googlemail.com as an alias of gmail.com, so the owner's
alternative spellings (e.g. from Apple sign-in) resolve to PRIMARY_EMAIL,
while that dot-insensitivity is NOT applied to non-Gmail domains.

Tests monkeypatch PRIMARY_EMAIL on the module (resolve_owner_email reads it
at call time) rather than reloading app.core.config.
"""
import app.core.config as config


def _owner(monkeypatch, email: str) -> None:
    monkeypatch.setattr(config, "PRIMARY_EMAIL", email)


def test_exact_match(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("kevin.maingi12@gmail.com") == "kevin.maingi12@gmail.com"


def test_gmail_dotless_variant_resolves_to_owner_spelling(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("kevinmaingi12@gmail.com") == "kevin.maingi12@gmail.com"


def test_googlemail_domain_variant_resolves(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("kevin.maingi12@googlemail.com") == "kevin.maingi12@gmail.com"
    assert config.resolve_owner_email("kevinmaingi12@googlemail.com") == "kevin.maingi12@gmail.com"


def test_non_gmail_domain_does_not_match_dot_insensitively(monkeypatch):
    _owner(monkeypatch, "a.b@auriqltd.co.uk")
    assert config.resolve_owner_email("ab@auriqltd.co.uk") is None
    assert config.resolve_owner_email("a.b@auriqltd.co.uk") == "a.b@auriqltd.co.uk"


def test_other_address_returns_none(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("someone-else@example.com") is None


def test_empty_or_none_returns_none(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("") is None
    assert config.resolve_owner_email(None) is None


def test_case_insensitivity(monkeypatch):
    _owner(monkeypatch, "kevin.maingi12@gmail.com")
    assert config.resolve_owner_email("Kevin.Maingi12@Gmail.com") == "kevin.maingi12@gmail.com"
    assert config.resolve_owner_email("KEVINMAINGI12@GMAIL.COM") == "kevin.maingi12@gmail.com"


def test_mask_email_normal_address():
    assert config.mask_email("kevin.maingi12@gmail.com") == "ke***@gmail.com"


def test_mask_email_empty_string():
    assert config.mask_email("") == "***@?"
