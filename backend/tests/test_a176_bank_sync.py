"""A176: ask Finexer to refresh from the bank (Bank Account Sync), fetch
pending transactions, store the bank's own as-of time, and report its age.

Finexer is mocked at the client level. The contract is Kevin's reading of the
API reference (see app/services/finexer_sync.py); nothing here proves the real
field names, only that our handling of the documented shapes is right.
"""
import asyncio
import logging
from datetime import datetime, timedelta

import pytest

import app.routers.accounts as accounts_router
import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw

UID = "u-a176"
CONSENT = "fx-a176"
NOW = datetime(2026, 10, 31, 12, 0, 0)


class Resp:
    def __init__(self, status_code, json_data=None, headers=None):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.headers = headers or {}
        self.text = ""

    def json(self):
        return self._json


def _match(d, q):
    for k, v in (q or {}).items():
        if isinstance(v, dict) and "$in" in v:
            if d.get(k) not in v["$in"]:
                return False
        elif isinstance(v, dict) and "$exists" in v:
            if (k in d) != v["$exists"]:
                return False
        elif d.get(k) != v:
            return False
    return True


class Col:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if _match(d, q)), None)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)
                return
        if upsert:
            nd = dict(filt)
            nd.update(update.get("$set") or {})
            self.docs.append(nd)

    async def update_many(self, filt, update, upsert=False):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if _match(d, q)]

        class _It:
            def __aiter__(s):
                s.i = 0
                return s

            async def __anext__(s):
                if s.i >= len(rows):
                    raise StopAsyncIteration
                s.i += 1
                return rows[s.i - 1]

        return _It()


class ExcludedCol:
    def find(self, *a, **k):
        return Col([]).find()


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    async def _noop(**kw):
        return None
    monkeypatch.setattr(fxw, "bump_daily_counters", _noop)
    monkeypatch.setattr(fs, "_auto_sync_warned", False)


class Client:
    """Routes by path. `post_responses`/`sync_get_responses` are queues; the
    last item repeats."""

    def __init__(self, post_responses=None, sync_get_responses=None, booked=None, pending=None,
                 pending_status=200, booked_status=200):
        self.post_q = list(post_responses or [])
        self.sget_q = list(sync_get_responses or [])
        self.booked = booked if booked is not None else []
        self.pending = pending if pending is not None else []
        self.pending_status = pending_status
        self.booked_status = booked_status
        self.posts: list = []
        self.gets: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    @staticmethod
    def _pop(q):
        if not q:
            return Resp(404, {})
        return q.pop(0) if len(q) > 1 else q[0]

    async def post(self, url, data=None):
        self.posts.append((url, data))
        return self._pop(self.post_q)

    async def get(self, url, params=None):
        self.gets.append((url, params))
        if url.startswith("/consents/"):
            return Resp(200, {"status": "authorized"})
        if url == "/bank_accounts":
            return Resp(200, {"data": [{"id": "acc1", "class": "current", "provider": "monzo"}]})
        if url.endswith("/balance"):
            return Resp(200, {"data": [{"type": "actual", "current": 10.0}]})
        if url.endswith("/sync"):
            return self._pop(self.sget_q)
        if url.endswith("/transactions") or "/transactions?" in url:
            if (params or {}).get("status") == "pending" or "status=pending" in url:
                if self.pending_status != 200:
                    return Resp(self.pending_status, {})
                return Resp(200, {"data": self.pending})
            if self.booked_status != 200 and not (params or {}).get("event"):
                return Resp(self.booked_status, {})
            return Resp(200, {"data": self.booked})
        raise AssertionError(f"unexpected GET {url}")


IDLE = {"status": "idle", "synced_from": "2026-10-30T09:00:00Z", "synced_to": "2026-10-31T11:42:00Z"}
RUNNING = {"status": "running"}


# ── sync client ───────────────────────────────────────────────────────────

def test_post_idle_on_first_call_stores_the_banks_own_window(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, IDLE)])
    res = asyncio.run(fs.trigger_bank_sync(c, "acc1", {"requests": 0, "429s": 0}, now=NOW))
    assert res["outcome"] == "requested" and res["status"] == "idle"
    d = accts.docs[0]
    assert d["bank_sync_requested_at"] == NOW
    assert d["bank_sync_status"] == "idle"
    assert d["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)
    assert d["bank_synced_from"] == datetime(2026, 10, 30, 9, 0, 0)
    assert c.posts == [("/bank_accounts/acc1/sync", None)]


def test_running_then_idle_after_polls(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, RUNNING)], sync_get_responses=[Resp(200, RUNNING), Resp(200, IDLE)])
    slept: list = []

    async def _sleep(s):
        slept.append(s)

    res = asyncio.run(fs.request_and_wait_bank_sync(c, "acc1", {}, sleep=_sleep))
    assert slept == [2.0, 4.0]
    assert res["status"] == "idle"
    assert accts.docs[0]["bank_sync_status"] == "idle"
    assert accts.docs[0]["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)


def test_still_running_past_the_bound_returns_and_the_fetch_proceeds(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    c = Client(post_responses=[Resp(200, RUNNING)], sync_get_responses=[Resp(200, RUNNING)],
               booked=[{"id": "t1"}])
    monkeypatch.setattr(fs, "_client", lambda: c)

    async def _sleep(s):
        return None
    monkeypatch.setattr(fs.asyncio, "sleep", _sleep)
    fetched, new = asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert fetched == ["acc1"] and new == 1
    sync_gets = [u for u, _ in c.gets if u.endswith("/sync")]
    assert len(sync_gets) == len(fs.BANK_SYNC_POLL_DELAYS)
    assert any(u.endswith("/transactions") for u, _ in c.gets)
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["bank_sync_status"] == "running"
    assert "bank_sync_requested_at" in d


def test_429_is_recorded_not_retried_and_next_time_is_computed(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(429, {}, {"Retry-After": "1200"})])
    counter = {"requests": 0, "429s": 0}
    res = asyncio.run(fs.trigger_bank_sync(c, "acc1", counter, now=NOW))
    assert res["outcome"] == "rate_limited"
    assert res["next_request_at"] == NOW + timedelta(seconds=1200)
    assert len(c.posts) == 1, "a 429 on the POST is the hourly limit: no retry"
    assert counter["429s"] == 1
    d = accts.docs[0]
    assert d["bank_sync_last_429_at"] == NOW
    assert d["bank_sync_error"] == "rate_limited"
    # No header: the full hour.
    c2 = Client(post_responses=[Resp(429, {})])
    res2 = asyncio.run(fs.trigger_bank_sync(c2, "acc1", {}, now=NOW + timedelta(hours=2)))
    assert res2["next_request_at"] == NOW + timedelta(hours=3)
    # Inside that window the next call does not POST at all.
    c3 = Client(post_responses=[Resp(200, IDLE)])
    res3 = asyncio.run(fs.trigger_bank_sync(c3, "acc1", {}, now=NOW + timedelta(hours=2, minutes=5)))
    assert res3["outcome"] == "skipped_local" and c3.posts == []


def test_local_sixty_minute_rule_skips_the_post_and_reports_next_time(monkeypatch):
    accts = Col([{"_id": "acc1", "bank_sync_requested_at": NOW - timedelta(minutes=10)}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, IDLE)])
    res = asyncio.run(fs.trigger_bank_sync(c, "acc1", {}, now=NOW))
    assert res["outcome"] == "skipped_local"
    assert res["next_request_at"] == NOW + timedelta(minutes=50)
    assert c.posts == []
    # 61 minutes later it goes through.
    res = asyncio.run(fs.trigger_bank_sync(c, "acc1", {}, now=NOW + timedelta(minutes=51)))
    assert res["outcome"] == "requested" and len(c.posts) == 1


def test_non_429_failure_stores_a_code_not_a_raw_error(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(500, {"error": "boom internal"})])
    res = asyncio.run(fs.trigger_bank_sync(c, "acc1", {}, now=NOW))
    assert res["outcome"] == "error"
    assert accts.docs[0]["bank_sync_error"] == "http_500"


# ── automatic sync ────────────────────────────────────────────────────────

def test_auto_sync_setter_tolerates_4xx_and_logs_once(monkeypatch, caplog):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(404, {})])
    with caplog.at_level(logging.WARNING, logger="app.services.finexer_sync"):
        r1 = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))
        # A refusal is stamped, so a second try inside the hour is skipped.
        r2 = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW + timedelta(minutes=10)))
        r3 = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW + timedelta(hours=2)))
    assert r1["ok"] is False and r1["outcome"] == "refused"
    assert r2["outcome"] == "skipped_local" and len(c.posts) == 2
    assert r3["outcome"] == "refused"
    assert len([r for r in caplog.records if "auto_sync_interval" in r.getMessage()]) == 1
    assert c.posts[0] == ("/bank_accounts/acc1/sync", {"auto_sync_interval": "6"})
    assert accts.docs[0]["bank_auto_sync_refused_at"] == NOW + timedelta(hours=2)


def test_auto_sync_setter_echo_records_hours_and_does_not_claim_a_sync(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, {"auto_sync_interval": 6})])
    r = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))
    assert r["ok"] is True and r["triggered"] is False
    assert accts.docs[0]["bank_auto_sync_hours"] == 6
    assert "bank_sync_requested_at" not in accts.docs[0]


def test_auto_sync_setter_bare_2xx_writes_nothing(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, {}), Resp(204, None)])
    r = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))
    assert r["ok"] is False and r["triggered"] is False and r["set"] == {}
    assert accts.docs[0] == {"_id": "acc1"}


def test_auto_sync_setter_sync_object_stamps_the_trigger(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, {**IDLE, "auto_sync_interval": 6})])
    r = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))
    assert r["ok"] and r["triggered"]
    d = accts.docs[0]
    assert d["bank_sync_requested_at"] == NOW and d["bank_auto_sync_hours"] == 6
    assert d["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)


def test_auto_sync_setter_429_is_recorded(monkeypatch):
    accts = Col([{"_id": "acc1"}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(429, {}, {"Retry-After": "600"})])
    r = asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))
    assert r["outcome"] == "rate_limited" and r["ok"] is False
    d = accts.docs[0]
    assert d["bank_sync_last_429_at"] == NOW
    assert d["bank_sync_next_at"] == NOW + timedelta(seconds=600)
    assert len(c.posts) == 1


def test_auto_sync_setter_bounds_and_hourly_rule(monkeypatch):
    accts = Col([{"_id": "acc1", "bank_sync_requested_at": NOW - timedelta(minutes=5)}])
    monkeypatch.setattr(fs, "accounts_col", accts)
    c = Client(post_responses=[Resp(200, {"auto_sync_interval": 6})])
    for bad in (0, -1, 721):
        assert asyncio.run(fs.ensure_auto_sync(c, "acc1", bad, {}, now=NOW))["ok"] is False
    assert asyncio.run(fs.ensure_auto_sync(c, "acc1", 6, {}, now=NOW))["outcome"] == "skipped_local"
    assert c.posts == []


def test_auto_sync_setting_is_registered_with_bounds():
    from app.services import runtime_settings as rs
    spec = rs.REGISTRY["FINEXER_AUTO_SYNC_HOURS"]
    assert spec.default == 6
    assert rs.validate("FINEXER_AUTO_SYNC_HOURS", 0) == 0
    assert rs.validate("FINEXER_AUTO_SYNC_HOURS", 720) == 720
    for bad in (-1, 721):
        with pytest.raises(rs.SettingError):
            rs.validate("FINEXER_AUTO_SYNC_HOURS", bad)


# ── full-sync harness ─────────────────────────────────────────────────────

def _wire_sync(monkeypatch, accts, pending_sink=None):
    consents = Col([{"_id": CONSENT, "user_id": UID, "status": "authorized", "last_synced": None}])
    monkeypatch.setattr(fs, "finexer_consents_col", consents)
    monkeypatch.setattr(fs, "accounts_col", accts)
    monkeypatch.setattr("app.db.collections.excluded_accounts_col", ExcludedCol())

    async def _identity(uid):
        return None

    async def _providers(counter=None):
        return []

    async def _upsert(txns, account_id, user_id, identity=None):
        return ([t for t in txns if t.get("status") != "pending"],
                [{"transaction_id": t["id"]} for t in txns if t.get("status") == "pending"])

    async def _replace(rows, account_id, user_id, provider=None):
        if pending_sink is not None:
            pending_sink.append([r["transaction_id"] for r in rows])

    async def _auto_hours(key, env=None):
        return 6

    monkeypatch.setattr(fs, "user_identity", _identity)
    monkeypatch.setattr(fs, "list_providers", _providers)
    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    monkeypatch.setattr(fs, "replace_pending_for_account", _replace)
    from app.services import runtime_settings
    monkeypatch.setattr(runtime_settings, "asetting", _auto_hours)
    return consents


def test_pending_fetch_merges_with_booked_list_pending_and_dedupes(monkeypatch):
    sink: list = []
    _wire_sync(monkeypatch, Col([]), sink)
    c = Client(
        booked=[{"id": "b1"}, {"id": "p1", "status": "pending"}],
        pending=[{"id": "p1"}, {"id": "p2"}],
    )
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert len(sink) == 1
    assert sorted(sink[0]) == ["p1", "p2"] and len(sink[0]) == 2
    assert ("/bank_accounts/acc1/transactions", {"status": "pending"}) in c.gets


def test_pending_fetch_failure_keeps_the_stored_pending_set(monkeypatch):
    sink: list = []
    accts = Col([])
    _wire_sync(monkeypatch, accts, sink)
    c = Client(booked=[{"id": "b1"}], pending=[], pending_status=500)
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert sink == [], "a failed pending fetch must never replace (wipe) the stored set"
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert "transactions_synced_at" in d, "the booked walk still succeeded"


def test_pending_walk_forces_only_absent_or_pending_status_and_drops_booked(monkeypatch, caplog):
    seen: list = []
    sink: list = []
    _wire_sync(monkeypatch, Col([]), sink)

    async def _upsert(txns, account_id, user_id, identity=None):
        seen.append([t.get("status") for t in txns])
        return [], [{"transaction_id": t["id"]} for t in txns if t.get("status") == "pending"]
    monkeypatch.setattr(fs, "_upsert_finexer_transactions", _upsert)
    c = Client(booked=[], pending=[{"id": "p1"}, {"id": "p2", "status": "Pending"},
                                    {"id": "b1", "status": "booked"}, {"id": "b2", "status": "settled"}])
    monkeypatch.setattr(fs, "_client", lambda: c)
    with caplog.at_level(logging.WARNING, logger="app.services.finexer_sync"):
        asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert ["pending", "pending"] in seen
    assert sink == [["p1", "p2"]]
    assert len([r for r in caplog.records if "dropped 2 row" in r.getMessage()]) == 1


def test_pending_walk_over_200_rows_is_a_filter_failure(monkeypatch):
    sink: list = []
    _wire_sync(monkeypatch, Col([]), sink)
    rows = [{"id": f"p{i}"} for i in range(201)]
    c = Client(booked=[{"id": "b1"}], pending=rows)
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert sink == [], "an over-long pending list must not replace the stored set"


def test_pending_walk_exception_never_aborts_the_consent(monkeypatch):
    import httpx
    sink: list = []
    accts = Col([])
    _wire_sync(monkeypatch, accts, sink)
    c = Client(booked=[{"id": "b1"}])
    orig = c.get

    async def _get(url, params=None):
        if (params or {}).get("status") == "pending":
            raise httpx.ConnectError("boom")
        return await orig(url, params)
    c.get = _get
    monkeypatch.setattr(fs, "_client", lambda: c)
    fetched, _ = asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert fetched == ["acc1"] and sink == []


def test_next_page_keeps_the_pending_filter():
    assert fs._carry_params("/bank_accounts/a/transactions?offset=20", {"status": "pending"}) == \
        "/bank_accounts/a/transactions?offset=20&status=pending"
    assert fs._carry_params("/x?status=pending&offset=2", {"status": "pending"}) == "/x?status=pending&offset=2"
    # A substring look-alike must not count as the filter being present.
    assert fs._carry_params("/x?substatus=pending", {"status": "pending"}) == "/x?substatus=pending&status=pending"
    assert fs._carry_params("/x", {"status": "pending"}) == "/x?status=pending"
    assert fs._carry_params("/x?offset=2", None) == "/x?offset=2"


# ── who triggers ──────────────────────────────────────────────────────────

def test_default_sync_never_posts_and_user_sync_does(monkeypatch):
    accts = Col([])
    consents = _wire_sync(monkeypatch, accts)
    consents.docs[0]["last_synced"] = NOW  # not the first sync
    c = Client(post_responses=[Resp(200, IDLE)], booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == [], "the reconcile cron and webhook syncs must not request a bank sync"
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert [u for u, d in c.posts if d is None] == ["/bank_accounts/acc1/sync"]


def test_first_sync_setter_echoes_interval_manual_trigger_still_runs(monkeypatch):
    accts = Col([])
    consents = _wire_sync(monkeypatch, accts)
    c = Client(post_responses=[Resp(200, {"auto_sync_interval": 6}), Resp(200, IDLE)])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert [d for u, d in c.posts] == [{"auto_sync_interval": "6"}, None], "setter first, then one manual POST"
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["bank_auto_sync_hours"] == 6 and d["bank_sync_requested_at"]
    # Later syncs never call the setter.
    consents.docs[0]["last_synced"] = NOW
    c.posts.clear()
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == []


def test_first_sync_setter_returns_sync_object_so_no_second_post(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    c = Client(post_responses=[Resp(200, {**IDLE, "auto_sync_interval": 6}), Resp(200, IDLE)])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert len(c.posts) == 1, "the setter already triggered a sync: no manual POST"
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["bank_sync_requested_at"] and d["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)


def test_first_sync_setter_429_is_recorded_and_the_sync_carries_on(monkeypatch):
    accts = Col([])
    _wire_sync(monkeypatch, accts)
    c = Client(post_responses=[Resp(429, {}), Resp(200, IDLE)], booked=[{"id": "b1"}])
    monkeypatch.setattr(fs, "_client", lambda: c)
    fetched, new = asyncio.run(fs.sync_finexer_consent(CONSENT, UID, request_bank_sync=True))
    assert fetched == ["acc1"] and new == 1
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["bank_sync_last_429_at"] and d["bank_sync_next_at"]


def test_worker_path_sync_updates_bank_synced_to_without_any_post(monkeypatch):
    accts = Col([])
    consents = _wire_sync(monkeypatch, accts)
    consents.docs[0]["last_synced"] = NOW  # reconcile or webhook sync, not first
    c = Client(sync_get_responses=[Resp(200, IDLE)], booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert c.posts == []
    d = next(x for x in accts.docs if x["_id"] == "acc1")
    assert d["bank_synced_to"] == datetime(2026, 10, 31, 11, 42, 0)
    assert d["bank_sync_status"] == "idle"
    assert "bank_sync_requested_at" not in d


def test_worker_task_never_requests_a_bank_sync(monkeypatch):
    import app.workers.sync_worker as sw
    seen: dict = {}

    async def _paused(uid, fail_closed=False):
        return False

    async def _pipeline(consent_id, user_id, **kw):
        seen.update(kw)
        return {"ok": True}

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(sw, "open_banking_paused", _paused)
    monkeypatch.setattr(sw, "finexer_sync_pipeline", _pipeline)
    monkeypatch.setattr(sw, "_enqueue_weekly_insight_refresh", _noop)
    monkeypatch.setattr(sw, "_warm_after_sync", _noop)
    asyncio.run(sw.task_sync_finexer({}, CONSENT, UID))
    assert seen["request_bank_sync"] is False


def test_pipeline_forwards_the_choice(monkeypatch):
    got: dict = {}

    async def _sync(consent_id, user_id, **kw):
        got.update(kw)
        return [], 0

    class _Ctx:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *a):
            return False

    async def _noop(*a, **k):
        return None
    import app.services.categorisation as cat
    import app.services.manual_account_rules as mar
    monkeypatch.setattr(fs, "sync_finexer_consent", _sync)
    monkeypatch.setattr(fs, "sync_in_progress", lambda col, cid: _Ctx())
    monkeypatch.setattr(cat, "apply_rules_bulk", _noop)
    monkeypatch.setattr(cat, "categorise_others_bg", _noop)
    monkeypatch.setattr(mar, "apply_rules", _noop)
    asyncio.run(fs.finexer_sync_pipeline(CONSENT, UID, trigger="user", recompute=False, request_bank_sync=True))
    assert got["request_bank_sync"] is True
    asyncio.run(fs.finexer_sync_pipeline(CONSENT, UID, recompute=False))
    assert got["request_bank_sync"] is False


def test_user_refresh_route_and_oauth_callback_request_a_bank_sync():
    import inspect
    import app.routers.finexer as fx_router
    assert "request_bank_sync=True" in inspect.getsource(accounts_router.sync_all)
    assert "request_bank_sync=True" in inspect.getsource(fx_router)


# ── event filter (off by default) ─────────────────────────────────────────

def test_event_filter_is_off_by_default_and_full_walk_is_the_fallback(monkeypatch):
    _wire_sync(monkeypatch, Col([]))
    c = Client(booked=[{"id": "b1"}])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, event_id="evt1", event_account_id="acc1"))
    assert all("event" not in (p or {}) for _, p in c.gets)

    monkeypatch.setattr(fs, "USE_TXN_EVENT_FILTER", True)
    c = Client(booked=[{"id": "b1"}])
    monkeypatch.setattr(fs, "_client", lambda: c)
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID, event_id="evt1", event_account_id="acc1"))
    assert any((p or {}).get(fs.TXN_EVENT_FILTER_PARAM) == "evt1" for _, p in c.gets)

    # A failing filtered walk falls back to the full one.
    c = Client(booked=[{"id": "b1"}])
    orig = c.get

    async def _get(url, params=None):
        if (params or {}).get(fs.TXN_EVENT_FILTER_PARAM):
            c.gets.append((url, params))
            return Resp(400, {})
        return await orig(url, params)
    c.get = _get
    monkeypatch.setattr(fs, "_client", lambda: c)
    _, new = asyncio.run(fs.sync_finexer_consent(CONSENT, UID, event_id="evt1", event_account_id="acc1"))
    assert new == 1


def test_webhook_passes_the_event_only_when_not_debounced(monkeypatch):
    import app.routers.webhooks as wh
    calls: list = []

    async def _enq(task, **kw):
        calls.append((task, kw))

    async def _noop(**kw):
        return None
    monkeypatch.setattr(wh, "_enqueue", _enq)
    monkeypatch.setattr(wh.fxw, "bump_daily_counters", _noop)
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_DEBOUNCE_SECONDS", 0)
    asyncio.run(wh._enqueue_sync_debounced("c1", "u1", {"event_id": "e1", "event_account_id": "a1"}))
    assert calls[-1][1]["event_id"] == "e1"
    monkeypatch.setattr(wh._cfg, "FINEXER_WEBHOOK_DEBOUNCE_SECONDS", 30)

    async def _claim(cid, window):
        return True
    monkeypatch.setattr(wh, "_claim_debounce", _claim)
    asyncio.run(wh._enqueue_sync_debounced("c1", "u1", {"event_id": "e1", "event_account_id": "a1"}))
    assert "event_id" not in calls[-1][1]


# ── API row ───────────────────────────────────────────────────────────────

def test_bank_synced_to_is_serialised_as_iso_z():
    out = accounts_router._transaction_diagnostics({"bank_synced_to": datetime(2026, 10, 31, 11, 42, 0)})
    assert out["bank_synced_to"] == "2026-10-31T11:42:00Z"
    assert accounts_router._transaction_diagnostics({})["bank_synced_to"] is None
    assert accounts_router._transaction_diagnostics({"bank_synced_to": 5})["bank_synced_to"] is None


# ── ops health ────────────────────────────────────────────────────────────

def _health(monkeypatch, consents, accounts):
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", Col(consents))
    monkeypatch.setattr(colls, "accounts_col", Col(accounts))
    return asyncio.run(fxw.sync_health(now=NOW))


def test_health_alerts_when_newest_bank_data_is_older_than_twelve_hours(monkeypatch):
    out = _health(
        monkeypatch,
        [{"_id": "c1", "status": "authorized"}, {"_id": "c2", "status": "authorized"}, {"_id": "c3", "status": "revoked"}],
        [
            {"_id": "a1", "connection_id": "c1", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=1)},
            {"_id": "a2", "connection_id": "c2", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=13)},
            {"_id": "a3", "connection_id": "c2", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=20),
             "bank_sync_last_429_at": NOW - timedelta(hours=2)},
            {"_id": "a4", "connection_id": "c1", "source": "finexer", "bank_sync_error": "http_500",
             "bank_sync_error_at": NOW - timedelta(hours=30)},
            {"_id": "a5", "connection_id": "c1", "source": "finexer", "bank_sync_error": "http_500",
             "bank_sync_error_at": NOW - timedelta(hours=3)},
        ],
    )
    assert out["alert"] is True
    assert out["consents_stale"] == 1
    assert out["authorized_consents"] == 2
    assert out["sync_429s_24h"] == 1
    assert out["sync_errors_24h"] == 1
    assert out["consents"][0]["age_hours"] == 13.0 or out["consents"][-1]["age_hours"] == 13.0
    assert "acc" not in repr(out) and "c1" not in repr(out)


def test_health_no_alert_at_eleven_hours_and_counts_missing(monkeypatch):
    out = _health(
        monkeypatch,
        [{"_id": "c1", "status": "authorized"}, {"_id": "c2", "status": "authorized"}],
        [{"_id": "a1", "connection_id": "c1", "source": "finexer", "bank_synced_to": NOW - timedelta(hours=11)}],
    )
    assert out["alert"] is False
    assert out["consents_without_bank_data"] == 1


# ── backfill script ───────────────────────────────────────────────────────

def test_backfill_refuses_without_an_explicit_mongo_db(monkeypatch):
    import scripts.finexer_backfill_auto_sync as bf
    with pytest.raises(SystemExit):
        bf.check_env({})
    with pytest.raises(SystemExit):
        bf.check_env({"MONGO_DB": "  "})
    with pytest.raises(SystemExit):
        bf.main([], env={})
    bf.check_env({"MONGO_DB": "x"})


def test_backfill_is_a_dry_run_by_default(monkeypatch, capsys):
    import scripts.finexer_backfill_auto_sync as bf
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", Col([{"_id": "c1", "status": "authorized"}]))
    monkeypatch.setattr(colls, "accounts_col", Col([
        {"_id": "a1", "source": "finexer", "connection_id": "c1"},
        {"_id": "a2", "source": "finexer", "connection_id": "c1", "bank_auto_sync_hours": 6},
    ]))

    def _boom(*a, **k):
        raise AssertionError("a dry run must not build a client or send anything")
    monkeypatch.setattr(fs, "_client", _boom)
    monkeypatch.setattr(fs, "ensure_auto_sync", _boom)
    summary = asyncio.run(bf.run(hours=6))
    assert summary["apply"] is False and summary["eligible"] == 1 and summary["attempted"] == 0
    assert bf.main(["--hours", "6"], env={"MONGO_DB": "x"}) == 0
    out = capsys.readouterr().out
    assert "eligible=1" in out and "a1" not in out and "c1" not in out


def test_health_payload_is_cached_for_sixty_seconds(monkeypatch):
    import app.db.collections as colls
    monkeypatch.setattr(colls, "finexer_consents_col", Col([{"_id": "c1", "status": "authorized"}]))
    monkeypatch.setattr(colls, "accounts_col", Col([]))
    monkeypatch.setattr(fxw, "_sync_health_cache", {"at": None, "payload": None})
    first = asyncio.run(fxw.sync_health())
    monkeypatch.setattr(colls, "finexer_consents_col", Col([]))
    assert asyncio.run(fxw.sync_health()) is first
    fxw._sync_health_cache["at"] -= 61
    assert asyncio.run(fxw.sync_health())["authorized_consents"] == 0


def test_backfill_does_not_reselect_recent_attempts_and_stamps_sync_objects(monkeypatch):
    import scripts.finexer_backfill_auto_sync as bf
    import app.db.collections as colls
    now = datetime.utcnow()
    monkeypatch.setattr(colls, "finexer_consents_col", Col([{"_id": "c1", "status": "authorized"}]))
    accts = Col([
        {"_id": "ok", "source": "finexer", "connection_id": "c1"},
        {"_id": "refused", "source": "finexer", "connection_id": "c1", "bank_auto_sync_refused_at": now - timedelta(minutes=5)},
        {"_id": "limited", "source": "finexer", "connection_id": "c1", "bank_sync_next_at": now + timedelta(minutes=20)},
        {"_id": "asked", "source": "finexer", "connection_id": "c1", "bank_sync_requested_at": now - timedelta(minutes=5)},
    ])
    monkeypatch.setattr(colls, "accounts_col", accts)
    monkeypatch.setattr(fs, "accounts_col", accts)
    assert asyncio.run(bf.run(hours=6))["eligible"] == 1
    c = Client(post_responses=[Resp(200, IDLE)])
    monkeypatch.setattr(fs, "_client", lambda: c)

    async def _nosleep(s):
        return None
    monkeypatch.setattr(bf.asyncio, "sleep", _nosleep)
    out = asyncio.run(bf.run(apply=True, hours=6))
    assert out["attempted"] == 1 and out["accepted"] == 1
    assert next(d for d in accts.docs if d["_id"] == "ok")["bank_sync_requested_at"]
