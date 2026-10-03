"""G199: the mobile sign-in hand-off page is rendered from the shared template
(shared/signin-handoff/template.html) and keeps the behaviour the native app
relies on: wealthdash://auth-done after a short delay, the manual button, the
3s hint on success, and an error variant of the same page."""
import asyncio
import hashlib
import re
from pathlib import Path

import pytest

from app.core import signin_handoff
from app.core.signin_handoff import signin_handoff_html
from app.core.signin_handoff_template import TEMPLATE, TEMPLATE_SHA256
from app.routers import auth

SHARED = Path(__file__).resolve().parents[2] / "shared" / "signin-handoff" / "template.html"


@pytest.mark.skipif(not SHARED.exists(), reason="shared/ not present (backend-only checkout)")
def test_generated_copy_matches_shared_source():
    src = SHARED.read_text(encoding="utf-8")
    assert src == TEMPLATE
    assert hashlib.sha256(src.encode()).hexdigest() == TEMPLATE_SHA256


@pytest.mark.parametrize("variant", ["a", "b", "c"])
def test_success_page_has_behaviour_and_markers(variant):
    page = signin_handoff_html(True, variant)
    assert 'data-state="ok"' in page and f'data-variant="{variant}"' in page
    assert "{{" not in page
    assert "wealthdash://auth-done" in page
    assert "setTimeout(returnToApp, 600)" in page
    assert "onclick" not in page and "addEventListener('click', returnToApp)" in page
    assert "Return to Sorted" in page and 'id="return"' in page
    assert "Signed in. You can close this window and return to Sorted." in page
    assert "if(true)" in page  # the 3s hint is armed on success
    assert 'name="color-scheme" content="light dark"' in page
    assert "gradient" not in page and "—" not in page


def test_error_page_is_the_same_template_without_the_hint():
    page = signin_handoff_html(False, auto_return=False)
    assert 'data-state="error"' in page
    assert "Sign-in didn’t complete" in page
    assert "Close this window and try again in Sorted." in page
    assert "if(false)" in page
    assert "if(false){setTimeout(returnToApp, 600);}" in page  # error page does not auto-return
    assert "wealthdash://auth-done" in page and "Return to Sorted" in page


def test_unknown_variant_falls_back_and_missing_slot_raises():
    assert f'data-variant="{signin_handoff.DEFAULT_VARIANT}"' in signin_handoff_html(True, "zzz")
    with pytest.raises(KeyError):
        signin_handoff.render_template("{{nope}}", {})


def test_values_are_escaped():
    out = signin_handoff.render_template("<p>{{x}}</p>", {"x": "<script>"})
    assert out == "<p>&lt;script&gt;</p>"


def test_mobile_callback_serves_the_template(monkeypatch):
    stored = {}

    async def fake_store(state, value):
        stored[state] = value

    monkeypatch.setattr(auth, "_store_pending", fake_store)
    resp = asyncio.run(auth.google_mobile_callback(code=None, error="access_denied", state="s1"))
    body = resp.body.decode()
    assert stored == {"s1": "error:auth_failed"}
    assert 'data-state="error"' in body and "wealthdash://auth-done" in body
    assert re.search(r"data-variant=\"[abc]\"", body)


def _hash(text):
    import base64
    return "'sha256-" + base64.b64encode(hashlib.sha256(text.encode()).digest()).decode() + "'"


@pytest.mark.parametrize("ok", [True, False])
def test_csp_hashes_match_emitted_content(ok):
    page = signin_handoff_html(ok, auto_return=ok)
    style = re.findall(r"<style>(.*?)</style>", page, re.S)
    script = re.findall(r"<script>(.*?)</script>", page, re.S)
    assert len(style) == 1 and len(script) == 1
    csp = signin_handoff.signin_handoff_csp(page)
    assert f"style-src {_hash(style[0])};" in csp
    assert f"script-src {_hash(script[0])};" in csp
    assert csp.startswith("default-src 'none'; ")
    assert "unsafe-inline" not in csp
    assert csp.endswith("frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
    assert not re.search(r"\sstyle=|\sonclick=", page)


def test_route_policy_kept_and_global_policy_untouched_elsewhere(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.core.security_headers import security_headers_middleware, _CSP

    async def fake_store(state, value):
        pass

    monkeypatch.setattr(auth, "_store_pending", fake_store)
    app = FastAPI()
    app.middleware("http")(security_headers_middleware)
    app.include_router(auth.router)

    @app.get("/other")
    async def other():
        return {"ok": True}

    c = TestClient(app)
    r = c.get("/auth/google/mobile-callback", params={"error": "access_denied", "state": "s"})
    csp = r.headers["content-security-policy"]
    style = re.findall(r"<style>(.*?)</style>", r.text, re.S)[0]
    script = re.findall(r"<script>(.*?)</script>", r.text, re.S)[0]
    assert csp == (
        f"default-src 'none'; style-src {_hash(style)}; script-src {_hash(script)}; "
        "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    )
    assert r.headers["x-frame-options"] == "DENY"
    assert c.get("/other").headers["content-security-policy"] == _CSP
