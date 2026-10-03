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
    assert "Return to Sorted" in page and 'id="return"' in page
    assert "Signed in. You can close this window and return to Sorted." in page
    assert "if(true)" in page  # the 3s hint is armed on success
    assert 'name="color-scheme" content="light dark"' in page
    assert "gradient" not in page and "—" not in page


def test_error_page_is_the_same_template_without_the_hint():
    page = signin_handoff_html(False)
    assert 'data-state="error"' in page
    assert "Sign-in didn’t complete" in page
    assert "Close this window and try again in Sorted." in page
    assert "if(false)" in page
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
