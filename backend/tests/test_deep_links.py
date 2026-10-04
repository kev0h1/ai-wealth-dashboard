"""A68: one deep-link contract for every provider callback that hands control
back to the native app."""
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from app.core import deep_links
from app.core.signin_handoff import bank_handoff_html, signin_handoff_csp, signin_handoff_html

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "shared" / "deep-links.json"
KNOWN_PATHS = {deep_links.SIGNIN_RETURN_PATH, deep_links.BANK_RETURN_PATH}
_URL = re.compile(r"wealthdash://[^\"'\s<>]+")


def _assert_known(url: str) -> None:
    parsed = urlparse(url)
    assert parsed.scheme == deep_links.DEEP_LINK_SCHEME
    assert parsed.netloc in KNOWN_PATHS


def test_constants_equal_shared_contract():
    if not CONTRACT.exists():
        pytest.skip("shared/deep-links.json not present (backend-only checkout)")
    data = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert data["scheme"] == deep_links.DEEP_LINK_SCHEME
    assert data["paths"]["signin"] == deep_links.SIGNIN_RETURN_PATH
    assert data["paths"]["bank_connected"] == deep_links.BANK_RETURN_PATH


def test_old_binaries_paths_are_frozen():
    # Installed apps match /auth-(done|complete)/; never rename these.
    assert deep_links.SIGNIN_RETURN_PATH == "auth-done"
    assert deep_links.BANK_RETURN_PATH == "auth-complete"


def test_return_urls():
    assert deep_links.signin_return_url() == "wealthdash://auth-done"
    url = deep_links.bank_return_url("finexer", "cst_1")
    assert url == "wealthdash://auth-complete?provider=finexer&connection=cst_1&status=ok"
    odd = deep_links.bank_return_url("a&b", "x y/1", "error")
    q = parse_qs(urlparse(odd).query)
    assert q == {"provider": ["a&b"], "connection": ["x y/1"], "status": ["error"]}
    assert "a&b" not in odd


def test_provider_callbacks_have_no_hand_rolled_scheme():
    for name in ("finexer.py", "truelayer.py"):
        src = (ROOT / "backend" / "app" / "routers" / name).read_text(encoding="utf-8")
        assert "wealthdash://" not in src, name
        assert "bank_handoff_html" in src, name


@pytest.mark.parametrize("page", ids=["signin-ok", "signin-error", "bank-ok", "bank-error"], argvalues=[
    signin_handoff_html(True),
    signin_handoff_html(False),
    bank_handoff_html(True, provider="finexer", connection_id="cst_1"),
    bank_handoff_html(False, provider="truelayer", connection_id="c&d"),
])
def test_rendered_pages_use_known_scheme_and_path(page):
    urls = _URL.findall(page)
    assert urls
    for url in urls:
        _assert_known(url)
    signin_handoff_csp(page)  # exactly one style and one script block


@pytest.mark.skipif(not (ROOT / "capacitor-spike").exists(), reason="repo checkout only")
def test_native_shell_registers_the_scheme():
    manifest = (ROOT / "capacitor-spike" / "scripts" / "ensure-wealthdash-manifest.py").read_text(encoding="utf-8")
    assert 'android:scheme="wealthdash"' in manifest
    codemagic = (ROOT / "codemagic.yaml").read_text(encoding="utf-8")
    assert "CFBundleURLSchemes:0 string wealthdash" in codemagic
