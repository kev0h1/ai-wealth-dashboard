"""G215: every error on a route a browser reaches by top-level navigation renders the
shared hand-off template (brand line, route CSP), never JSON, raw HTML or upstream text."""
import asyncio

import pytest
from fastapi.responses import HTMLResponse

import app.routers.auth as auth_module
import app.routers.finexer as finexer_module
import app.routers.oauth as oauth_module
import app.routers.truelayer as tl


class _Col:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, q=None, projection=None):
        return self.doc

    async def update_one(self, *a, **k):
        return None


class _Resp:
    status_code = 400
    text = "UPSTREAM-SECRET-<script>alert(1)</script>"


class _Client:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **k):
        return _Resp()


def _finexer(monkeypatch, doc, **kw):
    monkeypatch.setattr(finexer_module, "finexer_consents_col", _Col(doc))
    return asyncio.run(finexer_module.finexer_callback(**kw))


def _tl(monkeypatch, configured=True, **kw):
    monkeypatch.setattr(tl, "TRUELAYER_CLIENT_ID", "id" if configured else "")
    monkeypatch.setattr(tl, "TRUELAYER_CLIENT_SECRET", "secret" if configured else "")
    monkeypatch.setattr(tl, "connections_col", _Col({"user_id": "u"}))
    monkeypatch.setattr(tl.httpx, "AsyncClient", lambda *a, **k: _Client())
    return asyncio.run(tl.truelayer_callback(**kw))


def _oauth(monkeypatch, client, redirect_uri):
    monkeypatch.setattr(oauth_module, "oauth_clients_col", _Col(client))
    return asyncio.run(oauth_module.authorize(
        response_type="code", client_id="c1" if client is not None or redirect_uri else "",
        redirect_uri=redirect_uri, scope="accounts:read", state="s",
        code_challenge="x", code_challenge_method="S256"))


GOOD = {"_id": "cst1", "user_id": "u", "state": "real"}

BRANCHES = {
    "finexer-missing-consent-id": (lambda mp: _finexer(mp, None, fx_consent="", state="real"), 400),
    "finexer-consent-not-found": (lambda mp: _finexer(mp, None, fx_consent="nope", state="real"), 404),
    "finexer-state-missing": (lambda mp: _finexer(mp, dict(GOOD), fx_consent="cst1", state=""), 400),
    "finexer-state-mismatch": (lambda mp: _finexer(mp, dict(GOOD), fx_consent="cst1", state="wrong"), 400),
    "truelayer-not-configured": (lambda mp: _tl(mp, configured=False, code="c", state="s"), 503),
    "truelayer-provider-error": (lambda mp: _tl(mp, code="", state="s", error="access_denied"), 400),
    "truelayer-no-code": (lambda mp: _tl(mp, state="s"), 400),
    "truelayer-token-exchange-failed": (lambda mp: _tl(mp, code="c", state="s"), 502),
    "oauth-unknown-client": (lambda mp: _oauth(mp, None, "https://x.example/cb"), 400),
    "oauth-redirect-mismatch": (lambda mp: _oauth(mp, {"_id": "c1", "redirect_uris": ["https://ok.example/cb"]}, "https://evil.example/cb"), 400),
    "google-mobile-not-configured": (lambda mp: (mp.setattr(auth_module, "GOOGLE_CLIENT_ID", ""), asyncio.run(auth_module.google_auth_mobile(state="s")))[1], 503),
}


@pytest.mark.parametrize("name", sorted(BRANCHES))
def test_error_branch_renders_handoff_page_not_json(monkeypatch, name):
    run, status = BRANCHES[name]
    res = run(monkeypatch)
    assert isinstance(res, HTMLResponse)
    assert res.status_code == status
    assert res.media_type == "text/html"
    body = res.body.decode()
    assert "Sorted" in body and "by Auriq" in body  # template brand line
    assert 'data-state="error"' in body
    assert "UPSTREAM-SECRET" not in body and "<pre>" not in body
    assert not body.lstrip().startswith("{")
    assert res.headers["Content-Security-Policy"].startswith("default-src 'none'")


def test_google_web_not_configured_redirects_to_login_error(monkeypatch):
    monkeypatch.setattr(auth_module, "GOOGLE_CLIENT_ID", "")
    res = asyncio.run(auth_module.google_auth())
    assert res.status_code == 307
    assert res.headers["location"].endswith("/?error=auth_failed")


def test_no_bare_html_or_plaintext_responses_in_callback_routers():
    """Every HTMLResponse( in these routers is built with the route CSP, and no
    PlainTextResponse or hand-written <h2> page remains."""
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1] / "app" / "routers"
    for name in ("finexer.py", "truelayer.py", "auth.py", "oauth.py"):
        src = (root / name).read_text()
        assert "PlainTextResponse" not in src, name
        assert "<h2>" not in src and "<pre>" not in src, name
        for m in re.finditer(r"HTMLResponse\(", src):
            window = src[m.start(): m.start() + 200]
            if "def " in src[max(0, m.start() - 12): m.start()]:
                continue
            assert "Content-Security-Policy" in window, f"{name}: HTMLResponse without CSP"
