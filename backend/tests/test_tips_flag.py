"""G455: tips sit behind TIPS_ENABLED (default false, like MCP_CONNECTOR_ENABLED
in test_mcp_connector_flag.py). Off: no tip route answers with data, no tip job
is registered or queued, no tip research or model call can start, no tip
notification is sent, Penny and the MCP connector have no tip tool, and
GET /preferences says `tips_enabled: false` so every client hides its tip
surfaces. On: all of that is restored. Existing tip data and the per-user
show_tips preference are never touched.

Every test forces the flag on `app.core.config` (read live by the gates)
rather than inheriting whatever the process environment holds, for the reason
test_mcp_connector_flag.py gives.
"""
import asyncio

import pytest
from fastapi import HTTPException
from starlette.testclient import TestClient

import app.core.config as config
import app.main as main_module
import app.routers.preferences as preferences
import app.routers.savings_insights as si
import app.routers.mcp as mcp
import app.services.notifications as notifications
import app.services.penny_agent as penny_agent
import app.services.penny_tools as penny_tools
import app.workers.ai_worker as ai_worker
import app.workers.sync_worker as sync_worker

UID = "tips@example.com"


def _run(coro):
    return asyncio.run(coro)


def _flag(monkeypatch, on: bool):
    monkeypatch.setattr(config, "TIPS_ENABLED", on)


class _Col:
    """Tiny in-memory collection. Records every write so 'data untouched' is checkable."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.writes = []

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if all(d.get(k) == v for k, v in (query or {}).items() if not isinstance(v, dict)):
                return d
        return None

    def find(self, query=None, *a, **k):
        docs = self.docs

        class _Cur:
            async def to_list(self, _n):
                return list(docs)

        return _Cur()

    async def count_documents(self, *_a, **_k):
        return 7

    async def update_one(self, *a, **k):
        self.writes.append(("update_one", a))

    async def update_many(self, *a, **k):
        self.writes.append(("update_many", a))


# ── parsing ──────────────────────────────────────────────────────────────

def test_flag_parses_like_the_other_flags(monkeypatch):
    monkeypatch.delenv("TIPS_ENABLED", raising=False)
    assert config._parse_flag(None) is False
    for v in ("1", "true", "on", "TRUE"):
        assert config._parse_flag(v) is True


# ── capability flag on GET /preferences ──────────────────────────────────

def _prefs(monkeypatch, doc=None):
    monkeypatch.setattr(preferences, "preferences_col", _Col([doc] if doc else []))


def test_preferences_expose_tips_enabled_false_when_off(monkeypatch):
    _flag(monkeypatch, False)
    _prefs(monkeypatch, {"user_id": UID, "show_tips": True})
    out = _run(preferences.get_preferences({"email": UID}))
    assert out["tips_enabled"] is False
    assert out["show_tips"] is True  # stored, merely ignored


def test_preferences_expose_tips_enabled_true_when_on(monkeypatch):
    _flag(monkeypatch, True)
    _prefs(monkeypatch)
    assert _run(preferences.get_preferences({"email": UID}))["tips_enabled"] is True


# ── savings-insights routes ──────────────────────────────────────────────

def _insight_docs():
    return [{"_id": "a", "user_id": UID, "insight_id": "i1", "category": "energy"}]


def test_reads_old_app_builds_make_answer_empty_200_when_off(monkeypatch):
    _flag(monkeypatch, False)
    insights = _Col(_insight_docs())
    monkeypatch.setattr(si, "savings_insights_col", insights)
    monkeypatch.setattr(si, "preferences_col", _Col([{"user_id": UID, "show_tips": True}]))
    user = {"email": UID}
    assert _run(si.get_savings_insights(user)) == []
    assert _run(si.get_spotlight_insight(user)) is None
    assert _run(si.new_insight_count(user)) == {"count": 0}
    assert insights.writes == [] and len(insights.docs) == 1  # data untouched


def test_new_count_reads_when_on(monkeypatch):
    _flag(monkeypatch, True)
    monkeypatch.setattr(si, "savings_insights_col", _Col(_insight_docs()))
    monkeypatch.setattr(si, "preferences_col", _Col([{"user_id": UID, "show_tips": True}]))
    assert _run(si.new_insight_count({"email": UID})) == {"count": 7}


def test_per_user_show_tips_still_applies_when_flag_on(monkeypatch):
    _flag(monkeypatch, True)
    monkeypatch.setattr(si, "preferences_col", _Col([{"user_id": UID, "show_tips": False}]))
    assert _run(si._tips_enabled(UID)) is False


TIP_ONLY_PATHS = [
    ("post", "/savings-insights/refresh"),
    ("post", "/savings-insights/mark-viewed"),
    ("get", "/savings-insights/workflows"),
    ("post", "/savings-insights/abc/opened"),
    ("post", "/savings-insights/abc/dismiss"),
    ("post", "/savings-insights/abc/context"),
    ("patch", "/savings-insights/abc/pin"),
]


@pytest.mark.parametrize("method,path", TIP_ONLY_PATHS)
def test_tip_only_routes_404_when_off(monkeypatch, method, path):
    _flag(monkeypatch, False)
    client = TestClient(main_module.build_app(False))
    token = config.serializer.dumps({"email": UID, "name": "Tips"})
    headers = {"Authorization": f"Bearer {token}"}
    # The route-level dependency runs before the handler's own current_user
    # lookup, so a signed-in caller gets 404 with no database involved.
    resp = client.request(method.upper(), path, headers=headers, json={} if method != "get" else None)
    assert resp.status_code == 404


def test_require_tips_flag_dependency_404_off_and_passes_on(monkeypatch):
    _flag(monkeypatch, False)
    with pytest.raises(HTTPException) as exc:
        _run(si.require_tips_flag())
    assert exc.value.status_code == 404
    _flag(monkeypatch, True)
    assert _run(si.require_tips_flag()) is None


def test_every_tip_only_route_carries_the_dependency():
    wanted = {p.replace("abc", "{insight_id}") for _, p in TIP_ONLY_PATHS}
    seen = set()
    for r in si.router.routes:
        if r.path in wanted:
            seen.add(r.path)
            deps = [d.call for d in r.dependant.dependencies]
            assert si.require_tips_flag in deps, r.path
    assert seen == wanted


# ── research and model calls ─────────────────────────────────────────────

def test_refresh_pass_does_nothing_when_off(monkeypatch):
    _flag(monkeypatch, False)

    async def boom(*_a, **_k):
        raise AssertionError("tip detection or research started with TIPS_ENABLED off")

    monkeypatch.setattr(si, "_detect_insight_categories", boom)
    monkeypatch.setattr(si, "_fetch_market_findings", boom)
    assert _run(si._refresh_savings_insights_for_user(UID)) is None
    assert _run(si._refresh_single_insight(UID, "energy")) is None


def test_tavily_and_market_findings_refuse_when_off(monkeypatch):
    _flag(monkeypatch, False)

    async def boom(*_a, **_k):
        raise AssertionError("network or model call with TIPS_ENABLED off")

    monkeypatch.setattr(si, "record_tavily_call", boom)
    monkeypatch.setattr(si, "openrouter_chat", boom)
    assert _run(si._tavily_search("q", "energy", {}, pipeline="tip_research_tavily")) is None
    key = si.tip_research.make_key("energy", None, None)
    out = _run(si._fetch_market_findings(key))
    assert out.failure == "error" and not out.findings


# ── worker ───────────────────────────────────────────────────────────────

class _Arq:
    def __init__(self):
        self.jobs = []

    async def enqueue_job(self, name, **kw):
        self.jobs.append((name, kw))


def test_no_tip_enqueue_when_off_and_one_when_on(monkeypatch):
    arq = _Arq()
    _flag(monkeypatch, False)
    _run(sync_worker._enqueue_weekly_insight_refresh({"redis": arq}, UID))
    assert arq.jobs == []
    _flag(monkeypatch, True)
    _run(sync_worker._enqueue_weekly_insight_refresh({"redis": arq}, UID))
    assert [j[0] for j in arq.jobs] == ["task_refresh_savings_insights"]


def test_tip_job_registered_only_when_on():
    assert sync_worker.tip_job_functions(False) == []
    assert sync_worker.tip_job_functions(True) == [sync_worker.task_refresh_savings_insights]


def test_worker_settings_follow_the_import_time_flag():
    expected = config.TIPS_ENABLED
    assert (sync_worker.task_refresh_savings_insights in sync_worker.WorkerSettings.functions) is expected
    assert (ai_worker.task_refresh_savings_insights in ai_worker.WorkerSettings.functions) is expected


def test_no_tip_cron_job_exists():
    names = [getattr(j, "name", "") for j in sync_worker.WorkerSettings.cron_jobs]
    assert not any("insight" in n or "tip" in n for n in names)


def test_ai_worker_task_is_a_noop_when_off(monkeypatch):
    _flag(monkeypatch, False)

    async def boom(*_a, **_k):
        raise AssertionError("refresh ran with TIPS_ENABLED off")

    monkeypatch.setattr(ai_worker, "_refresh_savings_insights_for_user", boom)
    assert _run(ai_worker.task_refresh_savings_insights({}, UID))["ok"] is False


# ── notification ─────────────────────────────────────────────────────────

def test_no_new_money_insight_notification_when_off(monkeypatch):
    sent = []

    async def fake_send(*a, **k):
        sent.append(a)

    async def pref(*_a, **_k):
        return True

    async def insights(_uid):
        raise AssertionError("compute_insights ran with TIPS_ENABLED off")

    monkeypatch.setattr(notifications, "send_push_to_user", fake_send)
    monkeypatch.setattr(notifications, "notif_pref", pref)
    import app.routers.analytics as analytics
    monkeypatch.setattr(analytics, "compute_insights", insights)
    _flag(monkeypatch, False)
    _run(notifications._maybe_new_insights(UID))
    assert sent == []


# ── Penny and MCP ────────────────────────────────────────────────────────

def _names(schemas):
    return {t["function"]["name"] for t in schemas}


def test_penny_has_no_tip_tools_when_off(monkeypatch):
    _flag(monkeypatch, False)
    offered = _names(penny_tools.visible_tool_schemas(penny_tools.TOOL_SCHEMAS)) | _names(
        penny_tools.visible_tool_schemas(penny_tools.PROPOSE_TOOL_SCHEMAS))
    assert not (offered & penny_tools.TIP_TOOL_NAMES)
    assert "get_accounts" in offered and "propose_label_merchant" in offered
    catalogue = penny_agent._propose_tool_catalogue()
    assert not any(n in catalogue for n in penny_tools.TIP_TOOL_NAMES)


def test_penny_has_every_tip_tool_when_on(monkeypatch):
    _flag(monkeypatch, True)
    offered = _names(penny_tools.visible_tool_schemas(penny_tools.TOOL_SCHEMAS)) | _names(
        penny_tools.visible_tool_schemas(penny_tools.PROPOSE_TOOL_SCHEMAS))
    assert penny_tools.TIP_TOOL_NAMES <= offered
    catalogue = penny_agent._propose_tool_catalogue()
    assert all(n in catalogue for n in penny_tools.TIP_TOOL_NAMES if n.startswith("propose_"))


def test_execute_tool_refuses_a_tip_tool_by_name_when_off(monkeypatch):
    _flag(monkeypatch, False)
    for name in penny_tools.TIP_TOOL_NAMES:
        out = _run(penny_tools.execute_tool(UID, name, {}))
        assert "error" in out


def _principal():
    return {"uid": UID, "client": "session", "scopes": set(mcp.V1_SCOPES)}


def test_mcp_has_no_get_insights_when_off(monkeypatch):
    _flag(monkeypatch, False)
    names = {t["name"] for t in mcp._mcp_tool_list()}
    assert "get_insights" not in names and "get_accounts" in names
    with pytest.raises(mcp.McpError):
        _run(mcp._handle_tools_call(_principal(), {"name": "get_insights", "arguments": {}}))


def test_mcp_lists_get_insights_when_on(monkeypatch):
    _flag(monkeypatch, True)
    assert "get_insights" in {t["name"] for t in mcp._mcp_tool_list()}


# ── Can I executors ──────────────────────────────────────────────────────

def test_can_i_tip_executors_refuse_when_off(monkeypatch):
    import app.routers.can_i as can_i
    _flag(monkeypatch, False)
    cases = [
        (can_i._execute_mark_insight_opened, {"insight_id": "i1"}),
        (can_i._execute_save_insight_context, {"insight_id": "i1", "context": {}}),
        (can_i._execute_dismiss_insight, {"insight_id": "i1"}),
        (can_i._execute_pin_insight, {"insight_id": "i1", "pinned": True}),
    ]
    for fn, params in cases:
        with pytest.raises(HTTPException) as exc:
            _run(fn(UID, params))
        assert exc.value.detail == "Tips are switched off."
