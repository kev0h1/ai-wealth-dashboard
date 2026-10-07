"""A143: branded Finexer consent templates.

Covers the runtime wiring in routers/finexer.py (dark template parameter,
validation, fallback) and scripts/finexer_template.py (payload, safety).
"""
import asyncio
import importlib.util
import logging
from pathlib import Path

import httpx
import pytest

import app.routers.finexer as fx
from tests.test_finexer_link import _FakeCol, _setup  # noqa: F401  (reuse the link fixtures)

_ID = "AbCdEf123456"
_USER = {"email": "kevin@example.com"}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    fx._template_check.update({"id": None, "ok": False, "at": 0.0, "warned": False})
    yield
    fx._template_check.update({"id": None, "ok": False, "at": 0.0, "warned": False})


def _wire(monkeypatch, *, dark, tid=_ID, status=200, url="https://consent.finexer.example/abc", app_id="app_1"):
    _setup(monkeypatch, consent_url=url)
    monkeypatch.setattr(fx, "preferences_col", _FakeCol([{"user_id": _USER["email"], "dark_mode": dark}]))
    monkeypatch.setattr(fx, "FINEXER_TEMPLATE_DARK", tid)
    monkeypatch.setattr(fx, "FINEXER_APP_ID", app_id)
    seen = []

    def handler(request):
        seen.append(str(request.url))
        return httpx.Response(status, json={"id": tid})

    monkeypatch.setattr(
        fx, "_finexer_client",
        lambda: httpx.AsyncClient(base_url="https://api.finexer.com", transport=httpx.MockTransport(handler)),
    )
    return seen


def _link():
    return asyncio.run(fx.finexer_link(provider="", user=_USER))["auth_url"]


def test_dark_preference_with_valid_id_appends_template(monkeypatch):
    seen = _wire(monkeypatch, dark=True)
    assert _link() == f"https://consent.finexer.example/abc?template={_ID}"
    assert seen == [f"https://api.finexer.com/apps/app_1/templates/{_ID}"]


def test_existing_query_string_is_kept(monkeypatch):
    _wire(monkeypatch, dark=True, url="https://consent.finexer.example/abc?x=1")
    assert _link() == f"https://consent.finexer.example/abc?x=1&template={_ID}"


def test_encoded_query_is_preserved_untouched(monkeypatch):
    _wire(monkeypatch, dark=True, url="https://consent.finexer.example/abc?r=a%2Fb%20c&x=")
    assert _link() == f"https://consent.finexer.example/abc?r=a%2Fb%20c&x=&template={_ID}"


def test_light_preference_never_appends(monkeypatch):
    seen = _wire(monkeypatch, dark=False)
    assert _link() == "https://consent.finexer.example/abc"
    assert seen == []


def test_invalid_id_omits_with_warning(monkeypatch, caplog):
    _wire(monkeypatch, dark=True, status=404)
    with caplog.at_level(logging.WARNING):
        assert _link() == "https://consent.finexer.example/abc"
    assert "dark template check failed" in caplog.text


def test_failed_check_is_not_retried_inside_ten_minutes(monkeypatch):
    seen = _wire(monkeypatch, dark=True, status=500)
    _link()
    _link()
    assert len(seen) == 1


def test_missing_or_malformed_id_omits_without_calling_finexer(monkeypatch, caplog):
    seen = _wire(monkeypatch, dark=True, tid="")
    assert _link() == "https://consent.finexer.example/abc"
    seen2 = _wire(monkeypatch, dark=True, tid="short")
    with caplog.at_level(logging.WARNING):
        assert _link() == "https://consent.finexer.example/abc"
    assert seen == [] and seen2 == []
    assert "not used" in caplog.text


def test_missing_app_id_omits_and_warns_once(monkeypatch, caplog):
    seen = _wire(monkeypatch, dark=True, app_id="")
    with caplog.at_level(logging.WARNING):
        assert _link() == "https://consent.finexer.example/abc"
        _link()
    assert seen == []
    assert caplog.text.count("not used") == 1


# ── scripts/finexer_template.py ─────────────────────────────────────────

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "finexer_template.py"
_spec = importlib.util.spec_from_file_location("finexer_template_script", _SCRIPT)
ft = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ft)


def _mock_client(existing, calls):
    def handler(request):
        body = request.content.decode()
        calls.append((request.method, request.url.path, body))
        if request.method == "GET":
            return httpx.Response(200, json={"data": existing})
        n = len([c for c in calls if c[0] == "POST"])
        return httpx.Response(200, json={"id": f"NEWID000000{n}"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_sync_creates_both_with_default_false_from_files(monkeypatch, tmp_path):
    monkeypatch.setattr(ft, "STATE_FILE", tmp_path / "state.json")
    calls = []
    rc = ft.main(["--app-id", "app_1", "sync"], client=_mock_client([], calls))
    assert rc == 0
    posts = [c for c in calls if c[0] == "POST"]
    assert [p[1] for p in posts] == ["/apps/app_1/templates"] * 2
    from urllib.parse import parse_qs
    for (_, _, body), kind in zip(posts, ("light", "dark")):
        form = parse_qs(body)
        expected = ft.build_payload(kind)
        assert form["default"] == ["false"]
        assert form["app_name"] == ["Sorted"]
        for k, v in expected.items():
            assert form[k] == [v]
    assert "prefers-color-scheme:dark" in ft.build_payload("light")["css"]
    assert "prefers-color-scheme" not in ft.build_payload("dark")["css"]
    assert all(len(ft.build_payload(k)["css"]) <= 2000 for k in ("light", "dark"))
    assert set(ft._load_state("app_1")) == {"light", "dark"}


def test_sync_updates_in_place_and_never_sends_default(monkeypatch, tmp_path):
    monkeypatch.setattr(ft, "STATE_FILE", tmp_path / "state.json")
    calls = []
    existing = [{"id": "LIGHT0000001", "name": "Sorted light", "default": True},
                {"id": "DARK00000001", "name": "Sorted dark", "default": False}]
    assert ft.main(["--app-id", "app_1", "sync", "--logo-file-id", "file_9"], client=_mock_client(existing, calls)) == 0
    posts = [c for c in calls if c[0] == "POST"]
    assert [p[1] for p in posts] == ["/apps/app_1/templates/LIGHT0000001", "/apps/app_1/templates/DARK00000001"]
    for _, _, body in posts:
        assert "default" not in body.split("&") and "default=" not in body
        assert "file=file_9" in body


def test_make_default_requires_yes(monkeypatch, capsys):
    calls = []
    assert ft.main(["--app-id", "app_1", "make-default", "ID"], client=_mock_client([], calls)) == 2
    assert calls == []
    assert ft.main(["--app-id", "app_1", "make-default", "ID", "--yes"], client=_mock_client([], calls)) == 0
    assert calls[0][2] == "default=true"


def test_missing_app_id_exits_with_message(monkeypatch, capsys):
    monkeypatch.delenv("FINEXER_APP_ID", raising=False)
    monkeypatch.setattr(ft, "_env", lambda name, env_file=None: "")
    assert ft.main(["list"]) == 2
    assert "app id" in capsys.readouterr().err


def test_delete_requires_yes(monkeypatch, tmp_path):
    monkeypatch.setattr(ft, "STATE_FILE", tmp_path / "state.json")
    calls = []
    assert ft.main(["--app-id", "app_1", "delete", "ID"], client=_mock_client([], calls)) == 2
    assert calls == []
    assert ft.main(["--app-id", "app_1", "delete", "ID", "--yes"], client=_mock_client([], calls)) == 0
    assert calls[0][0] == "DELETE"


def test_state_keyed_by_app_id_and_legacy_flat_file_migrated(monkeypatch, tmp_path):
    import json
    sf = tmp_path / "state.json"
    monkeypatch.setattr(ft, "STATE_FILE", sf)
    sf.write_text(json.dumps({"light": "OLDLIGHT0001", "dark": "OLDDARK00001"}))
    assert ft.main(["--app-id", "app_prod", "sync"], client=_mock_client(
        [{"id": "OLDLIGHT0001", "name": "Sorted light"}, {"id": "OLDDARK00001", "name": "Sorted dark"}], [])) == 0
    assert ft.main(["--app-id", "app_sandbox", "sync"], client=_mock_client([], [])) == 0
    state = json.loads(sf.read_text())
    assert set(state) == {"app_prod", "app_sandbox"}
    assert state["app_prod"] == {"light": "OLDLIGHT0001", "dark": "OLDDARK00001"}
    assert state["app_sandbox"]["light"] != state["app_prod"]["light"]
