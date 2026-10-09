"""B44: a research-provider outage must be loud and survivable.

From 2026-09-16 to 2026-10-01 Tavily answered HTTP 432 on every research
call, nothing regenerated, every tip aged past `content_valid_until` and
blanked, and nothing surfaced it. Pinned here: failure classification into
static codes, the stored research status, keep-the-last-good-tip (`stale`)
instead of blanking, the admin status line, the 24 hour backoff, and
automatic recovery. No network and no Mongo: collections are in-memory
fakes and `httpx.AsyncClient` is replaced.
"""
import asyncio
import logging
from datetime import datetime, timedelta

import httpx
import pytest

import app.routers.admin_usage as admin_usage
import app.routers.savings_insights as si
from app.services import tips_research_health as health

UID = "kevin"


def _run(coro):
    return asyncio.run(coro)


class FakeRunsCol:
    def __init__(self):
        self.docs: dict = {}

    async def find_one(self, filt):
        d = self.docs.get(filt["_id"])
        return dict(d) if d else None

    async def update_one(self, filt, update, upsert=False):
        d = self.docs.setdefault(filt["_id"], {"_id": filt["_id"]})
        d.update(update.get("$set", {}))
        for k in update.get("$unset", {}):
            d.pop(k, None)


@pytest.fixture
def runs(monkeypatch):
    col = FakeRunsCol()
    monkeypatch.setattr(health, "worker_runs_col", col)
    monkeypatch.setattr(admin_usage, "worker_runs_col", col)
    return col


class _Resp:
    def __init__(self, status, data=None):
        self.status_code = status
        self._d = data or {}

    def json(self):
        return self._d


class _Client:
    def __init__(self, item):
        self.item = item

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **k):
        if isinstance(self.item, Exception):
            raise self.item
        return self.item


def _tavily(monkeypatch, item):
    calls = {"n": 0}

    def factory(*a, **k):
        calls["n"] += 1
        return _Client(item)

    monkeypatch.setattr(si.httpx, "AsyncClient", factory)
    monkeypatch.setattr(si, "TAVILY_API_KEY", "fake")
    monkeypatch.setattr(si, "OPENROUTER_API_KEY", "fake")
    return calls


def _generate_with_outcome():
    outcome: dict = {}
    tok = si._RESEARCH_OUTCOME.set(outcome)
    try:
        result = _run(si._generate_savings_insight_content("mobile", UID))
    finally:
        si._RESEARCH_OUTCOME.reset(tok)
    return result, outcome


# 1. classification ---------------------------------------------------------

@pytest.mark.parametrize("status,code", [
    (432, "quota"), (401, "auth"), (403, "auth"), (429, "rate"),
    (500, "server"), (503, "server"), (404, "client"),
])
def test_http_failures_are_classified_and_stored(monkeypatch, runs, status, code):
    _tavily(monkeypatch, _Resp(status, {"detail": "SECRET PROVIDER TEXT"}))
    result, outcome = _generate_with_outcome()
    assert result is None
    assert outcome["failure"] == code
    doc = runs.docs[health.DOC_ID]
    assert doc["research_status"] == "failing"
    assert doc["last_error_code"] == code
    assert doc["last_http_status"] == status
    assert doc["last_error_at"] is not None
    assert "SECRET PROVIDER TEXT" not in repr(doc)


def test_timeout_and_request_error_are_classified(monkeypatch, runs):
    _tavily(monkeypatch, httpx.ReadTimeout("slow"))
    _, outcome = _generate_with_outcome()
    assert outcome["failure"] == "timeout"
    assert runs.docs[health.DOC_ID]["last_error_code"] == "timeout"
    assert "skip_until" not in runs.docs[health.DOC_ID]  # no backoff for a blip

    _tavily(monkeypatch, RuntimeError("boom"))
    _, outcome = _generate_with_outcome()
    assert outcome["failure"] == "error"


# 2. stale, not blank --------------------------------------------------------

def _doc(**over):
    now = datetime.utcnow()
    d = {
        "category": "mobile", "insight_id": "mobile-abc", "user_id": UID,
        "title": "Switch your SIM", "body": "A cheaper SIM-only plan exists.",
        "savings_estimate": "~£10/mo", "refreshed_at": now - timedelta(days=9),
        "researched_at": now - timedelta(days=9),
        "content_valid_until": now - timedelta(days=2),
        "claim_valid_until": None, "triggered_by": [], "_id": "x",
    }
    d.update(over)
    return d


def test_expired_tip_with_no_outage_still_blanks():
    s = si._serialize_insight(_doc())
    assert s["state"] == "quiet" and s["title"] == "" and s["stale_note"] is None


def test_expired_tip_stays_visible_as_stale_during_outage():
    s = si._serialize_insight(_doc(research_stale_at=datetime.utcnow()))
    assert s["state"] == "stale"
    assert s["title"] == "Switch your SIM" and s["body"]
    assert s["stale_note"] == "Tips may be out of date"
    assert s["expiry_line"] is None and s["content_valid_until"] is None


def test_never_had_content_stays_blank_during_outage():
    s = si._serialize_insight(_doc(title="", body="", research_stale_at=datetime.utcnow()))
    assert s["state"] == "quiet" and s["title"] == "" and s["stale_note"] is None


def test_expired_deal_deadline_is_never_shown_as_current():
    past_claim = datetime.utcnow() - timedelta(days=3)
    s = si._serialize_insight(_doc(
        claim_valid_until=past_claim, content_valid_until=past_claim,
        research_stale_at=datetime.utcnow(),
    ))
    assert s["state"] == "quiet" and s["title"] == ""


# pass-level ---------------------------------------------------------------

class FakeInsightsCol:
    def __init__(self, docs):
        self.docs = {d["category"]: dict(d, _id=d["category"]) for d in docs}

    async def find_one(self, q):
        return self.docs.get(q.get("category"))

    async def update_one(self, filt, update):
        for d in self.docs.values():
            if d["_id"] == filt["_id"]:
                d.update(update["$set"])

    async def insert_one(self, doc):
        self.docs[doc["category"]] = doc


def _pass_setup(monkeypatch, cats, generate):
    docs = [_doc(category=c, insight_id=f"{c}-abc", prompt_version=si.PROMPT_VERSION) for c in cats]
    col = FakeInsightsCol(docs)
    monkeypatch.setattr(si, "savings_insights_col", col)

    async def detect(uid):
        return list(cats)

    async def trig(uid, cat):
        return []

    async def verified(uid, existing):
        return None

    monkeypatch.setattr(si, "_detect_insight_categories", detect)
    monkeypatch.setattr(si, "_find_triggered_transactions", trig)
    monkeypatch.setattr(si, "_check_verified_saving", verified)
    monkeypatch.setattr(si, "_generate_savings_insight_content", generate)
    async def no_evidence_gone(*a, **k):
        return False
    monkeypatch.setattr(si, "_evidence_is_gone", no_evidence_gone)
    return col


def test_pass_keeps_previous_tips_stale_stops_calls_and_warns_once(monkeypatch, runs, caplog):
    calls = {"n": 0}

    async def failing(cat, uid, ctx=None, trig=None):
        calls["n"] += 1
        si._RESEARCH_OUTCOME.get()["failure"] = "quota"
        return None

    col = _pass_setup(monkeypatch, ["mobile", "energy", "groceries"], failing)
    with caplog.at_level(logging.WARNING):
        _run(si._refresh_savings_insights_for_user(UID))

    assert calls["n"] == 1, "quota failure must halt the remaining research calls in the pass"
    for cat in ("mobile", "energy", "groceries"):
        assert col.docs[cat]["research_stale_at"], cat
        assert si._serialize_insight(col.docs[cat])["state"] == "stale"
    outage = [r for r in caplog.records if "research outage" in r.getMessage()]
    assert len(outage) == 1 and outage[0].levelno == logging.WARNING


def test_pass_success_clears_stale_marker(monkeypatch, runs):
    async def ok(cat, uid, ctx=None, trig=None):
        return {"title": "New", "body": "Fresh advice", "savings_estimate": None}

    col = _pass_setup(monkeypatch, ["mobile"], ok)
    col.docs["mobile"]["research_stale_at"] = datetime.utcnow()
    _run(si._refresh_savings_insights_for_user(UID))
    assert col.docs["mobile"]["research_stale_at"] is None
    assert si._serialize_insight(col.docs["mobile"])["state"] == "fresh"


# 3. admin line --------------------------------------------------------------

def test_admin_sync_stats_reports_research_failing_since_date(monkeypatch, runs):
    runs.docs[health.DOC_ID] = {
        "_id": health.DOC_ID, "research_status": "failing", "last_error_code": "quota",
        "failing_since": datetime(2026, 10, 1, 8, 0), "last_error_at": datetime(2026, 10, 3, 8, 0),
    }

    class Empty:
        def find(self, *a, **k):
            class C:
                def __aiter__(self):
                    async def g():
                        return
                        yield
                    return g()
            return C()

        async def count_documents(self, f):
            return 0

    monkeypatch.setattr(admin_usage, "finexer_consents_col", Empty())
    monkeypatch.setattr(admin_usage, "orphaned_revocations_col", Empty())
    out = _run(admin_usage.admin_sync_stats(user={"name": "Bot"}))
    assert out["tips_research"]["line"] == "Tips research failing since 1 Oct (quota)"
    assert out["tips_research"]["status"] == "failing"


def test_status_line_is_none_when_healthy():
    assert health.status_line(None) is None
    assert health.status_line({"research_status": "ok"}) is None


# 4. backoff and recovery ----------------------------------------------------

def test_quota_failure_sets_24h_backoff_and_skips_calls(monkeypatch, runs):
    calls = _tavily(monkeypatch, _Resp(432))
    _generate_with_outcome()
    assert calls["n"] == 1
    skip = runs.docs[health.DOC_ID]["skip_until"]
    assert timedelta(hours=23) < skip - datetime.utcnow() <= timedelta(hours=24)

    _, outcome = _generate_with_outcome()
    assert calls["n"] == 1, "no Tavily call while the backoff is active"
    assert outcome["failure"] == "backoff"


def test_one_attempt_after_backoff_and_automatic_recovery(monkeypatch, runs):
    calls = _tavily(monkeypatch, _Resp(432))
    _generate_with_outcome()
    runs.docs[health.DOC_ID]["skip_until"] = datetime.utcnow() - timedelta(minutes=1)

    # Backoff lapsed: exactly one attempt is made, and a failure re-arms it.
    _generate_with_outcome()
    assert calls["n"] == 2
    assert runs.docs[health.DOC_ID]["skip_until"] > datetime.utcnow()

    # Provider recovers on the next allowed attempt: status returns to ok.
    runs.docs[health.DOC_ID]["skip_until"] = datetime.utcnow() - timedelta(minutes=1)
    _tavily(monkeypatch, _Resp(200, {"answer": "Some answer", "results": []}))

    async def fake_openrouter(*a, **k):
        raise RuntimeError("stop after search")

    _generate_with_outcome()
    doc = runs.docs[health.DOC_ID]
    assert doc["research_status"] == "ok"
    assert "skip_until" not in doc and "failing_since" not in doc
    assert health.status_line(doc) is None
