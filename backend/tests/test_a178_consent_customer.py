"""A178: POST /consents with a customer deleted in the Finexer dashboard."""
import asyncio
import importlib.util
import logging
from pathlib import Path

import pytest
from fastapi import HTTPException

import app.routers.finexer as finexer_module
import app.services.finexer_sync as fs

KEY = "sk_live_abcdef1234567890SECRET"
EMAIL = "tester.person@example.com"
UNKNOWN_CUSTOMER = {"error": {"type": "invalid_request_error", "code": "resource_missing",
                              "message": f"No such customer for {EMAIL}", "param": "customer"}}
UNRELATED = {"error": {"type": "invalid_request_error", "code": "invalid_url",
                       "message": "return_url is not allowed", "param": "return_url"}}


class Resp:
    def __init__(self, status, body=None, text=None):
        self.status_code = status
        self._body = body if body is not None else {}
        self.text = text if text is not None else str(self._body)
        self.headers = {}

    def json(self):
        return self._body


class Col:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _m(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._m(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._m(d, q)]

        async def gen():
            for r in rows:
                yield r
        return gen()

    async def update_one(self, f, u, upsert=False):
        for d in self.docs:
            if self._m(d, f):
                d.update(u.get("$set") or {})
                return
        if upsert:
            self.docs.append({**f, **(u.get("$set") or {})})

    async def update_many(self, f, u):
        n = 0
        for d in self.docs:
            if self._m(d, f):
                d.update(u.get("$set") or {})
                n += 1
        return type("R", (), {"modified_count": n})()

    async def delete_one(self, f):
        self.docs = [d for d in self.docs if not self._m(d, f)]


class Client:
    """Pops queued responses per path; records POSTs."""
    def __init__(self, posts, gets=None):
        self.posts = {k: list(v) for k, v in posts.items()}
        self.gets = dict(gets or {})
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, data=None):
        self.sent.append((url, dict(data or {})))
        return self.posts[url].pop(0)

    async def get(self, url, params=None):
        return self.gets[url]


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setattr(fs, "FINEXER_API_KEY", KEY)
    customers = Col([{"_id": EMAIL, "customer_id": "cus_dead"}])
    monkeypatch.setattr(fs, "finexer_customers_col", customers)
    bumps = []

    async def bump(now=None, **inc):
        bumps.append(inc)
    monkeypatch.setattr("app.services.finexer_webhooks.bump_daily_counters", bump)
    return customers, bumps


def _install(monkeypatch, client):
    monkeypatch.setattr(fs, "_client", lambda: client)


def _run(coro):
    return asyncio.run(coro)


def test_unknown_customer_recreates_and_retries_once(monkeypatch, env):
    customers, bumps = env
    client = Client({"/consents": [Resp(400, UNKNOWN_CUSTOMER), Resp(200, {"id": "cst_1"})],
                     "/customers": [Resp(200, {"id": "cus_new"})]})
    _install(monkeypatch, client)
    out = _run(fs.create_consent(EMAIL, "cus_dead", "amex", "st", user={"email": EMAIL, "name": "T"}))
    assert out == {"id": "cst_1"}
    assert [u for u, _ in client.sent] == ["/consents", "/customers", "/consents"]
    assert client.sent[2][1]["customer"] == "cus_new"
    assert customers.docs[0]["customer_id"] == "cus_new"
    # A191: the consent reports the customer it was actually created under.
    assert out.customer_id_used == "cus_new"
    # three upstream POSTs, each counted
    assert sum(b.get("requests", 0) for b in bumps) == 3


def test_second_400_raises_typed_error_and_route_is_never_500(monkeypatch, env):
    client = Client({"/consents": [Resp(400, UNKNOWN_CUSTOMER), Resp(400, UNKNOWN_CUSTOMER)],
                     "/customers": [Resp(200, {"id": "cus_new"})]})
    _install(monkeypatch, client)
    with pytest.raises(fs.FinexerConsentError) as ei:
        _run(fs.create_consent(EMAIL, "cus_dead", "amex", "st", user={"email": EMAIL}))
    assert ei.value.status == 400 and ei.value.provider == "amex"
    assert len([1 for u, _ in client.sent if u == "/consents"]) == 2  # exactly one retry

    async def noop(e):
        return None
    monkeypatch.setattr(finexer_module, "FINEXER_API_KEY", "k")
    monkeypatch.setattr(finexer_module, "check_connection_limit", noop)
    monkeypatch.setattr(finexer_module, "check_open_banking_allowed", noop)

    async def goc(user):
        return "cus_x"

    async def boom(**kw):
        raise ei.value
    monkeypatch.setattr(finexer_module, "get_or_create_customer", goc)
    monkeypatch.setattr(finexer_module, "create_consent", boom)
    with pytest.raises(HTTPException) as he:
        _run(finexer_module.finexer_link(provider="amex", native=False, user={"email": EMAIL}))
    assert he.value.status_code == 502
    assert he.value.detail == {"code": "BANK_LINK_UNAVAILABLE",
                               "message": "We could not start the bank connection. Try again in a moment."}


def test_route_422_when_provider_rejected(monkeypatch, env):
    client = Client({"/consents": [Resp(400, {"error": {"code": "invalid_provider", "param": "provider",
                                                       "message": "provider is not enabled"}})]})
    _install(monkeypatch, client)
    with pytest.raises(fs.FinexerConsentError) as ei:
        _run(fs.create_consent(EMAIL, "cus_ok", "badbank", "st"))
    assert ei.value.code == "BANK_PROVIDER_REJECTED"


def test_unrelated_400_does_not_recreate_customer(monkeypatch, env):
    customers, _ = env
    client = Client({"/consents": [Resp(400, UNRELATED)]})
    _install(monkeypatch, client)
    with pytest.raises(fs.FinexerConsentError) as ei:
        _run(fs.create_consent(EMAIL, "cus_dead", "amex", "st"))
    assert ei.value.code == "BANK_LINK_UNAVAILABLE"
    assert [u for u, _ in client.sent] == ["/consents"]
    assert customers.docs[0]["customer_id"] == "cus_dead"


def test_warning_line_has_provider_status_scrubbed_reason(monkeypatch, env, caplog):
    body = {"error": {"code": "x", "message": f"bad for {EMAIL} using {KEY} and tok_abcdefghij1234", "param": "return_url"}}
    client = Client({"/consents": [Resp(400, body)]})
    _install(monkeypatch, client)
    with caplog.at_level(logging.WARNING, logger=fs.logger.name):
        with pytest.raises(fs.FinexerConsentError):
            _run(fs.create_consent(EMAIL, "cus_ok", "amex", "st"))
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "provider=amex" in text and "status=400" in text
    assert KEY not in text and EMAIL not in text and "tok_abcdefghij1234" not in text
    assert "te***@example.com" in text


# ── reconcile script ─────────────────────────────────────────────────────────
def _load_script():
    p = Path(__file__).resolve().parents[1] / "scripts" / "finexer_reconcile_customers.py"
    spec = importlib.util.spec_from_file_location("finexer_reconcile_customers", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _recon_setup(monkeypatch):
    bumps = []

    async def bump(now=None, **inc):
        bumps.append(inc)
    monkeypatch.setattr("app.services.finexer_webhooks.bump_daily_counters", bump)
    customers = Col([{"_id": "u1", "customer_id": "cus_ok"}, {"_id": "u2", "customer_id": "cus_dead"},
                     {"_id": "u3", "customer_id": "cus_flaky"}])
    consents = Col([{"_id": "bc_ok", "customer_id": "cus_ok", "status": "authorized"},
                    {"_id": "bc_dead", "customer_id": "cus_dead", "status": "authorized"},
                    {"_id": "bc_flaky", "customer_id": "cus_flaky", "status": "authorized"}])
    accounts = Col([{"_id": "a1", "connection_id": "bc_ok", "status": "active"},
                    {"_id": "a2", "connection_id": "bc_dead", "status": "active"}])
    client = Client({}, gets={"/customers/cus_ok": Resp(200, {"id": "cus_ok"}),
                              "/customers/cus_dead": Resp(404, {"error": {"code": "resource_missing"}}),
                              "/customers/cus_flaky": Resp(503, {})})
    return customers, consents, accounts, client, bumps


def test_reconcile_dry_run_writes_nothing(monkeypatch):
    m = _load_script()
    customers, consents, accounts, client, bumps = _recon_setup(monkeypatch)
    counts = _run(m.reconcile(client, customers, consents, accounts, apply=False))
    assert (counts["checked"], counts["missing"], counts["errors"], counts["cleared"]) == (3, 1, 1, 0)
    assert len(customers.docs) == 3
    assert accounts.docs[1]["status"] == "active" and "last_sync_error" not in consents.docs[1]
    assert sum(b.get("requests", 0) for b in bumps) == 3  # one request per customer, counted


def test_reconcile_apply_clears_only_missing_and_flags_consents(monkeypatch):
    m = _load_script()
    customers, consents, accounts, client, _ = _recon_setup(monkeypatch)
    counts = _run(m.reconcile(client, customers, consents, accounts, apply=True))
    assert counts["cleared"] == 1 and counts["consents_flagged"] == 1 and counts["accounts_expired"] == 1
    assert sorted(d["_id"] for d in customers.docs) == ["u1", "u3"]
    assert accounts.docs[1]["status"] == "expired" and accounts.docs[0]["status"] == "active"
    assert consents.docs[1]["last_sync_error"] == "consent_revoked"
    assert "last_sync_error" not in consents.docs[0] and "last_sync_error" not in consents.docs[2]


def test_reconcile_refuses_without_mongo_db(monkeypatch, capsys):
    m = _load_script()
    monkeypatch.delenv("MONGO_DB", raising=False)
    assert m.main([]) == 2
    assert "MONGO_DB" in capsys.readouterr().err


# ── review fixes ─────────────────────────────────────────────────────────────
def test_failed_customer_create_on_retry_keeps_cached_record(monkeypatch, env):
    customers, _ = env
    client = Client({"/consents": [Resp(400, UNKNOWN_CUSTOMER)],
                     "/customers": [Resp(500, {})]})
    _install(monkeypatch, client)
    with pytest.raises(fs.FinexerConsentError):
        _run(fs.create_consent(EMAIL, "cus_dead", "amex", "st", user={"email": EMAIL}))
    assert customers.docs == [{"_id": EMAIL, "customer_id": "cus_dead"}]


def test_scrub_redacts_basic_auth_form_and_28_char_runs(monkeypatch, env):
    import base64
    basic = base64.b64encode(f"{KEY}:".encode()).decode()
    run28 = "A" * 28
    out = fs._scrub_reason(f"Authorization: Basic {basic} also {run28} end")
    assert basic not in out and basic.rstrip("=") not in out and run28 not in out


class _AcctClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        if url.startswith("/consents/"):
            return Resp(200, {"status": "authorized"})
        return Resp(503, {})


class _EmptyExcl:
    def find(self, q=None, projection=None):
        return self

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


def test_bank_accounts_failure_stamps_error_without_expiring(monkeypatch, env):
    consents = Col([{"_id": "fx-1", "user_id": "u1", "status": "authorized", "last_synced": None}])
    monkeypatch.setattr(fs, "finexer_consents_col", consents)
    monkeypatch.setattr(fs, "_client", lambda: _AcctClient())
    monkeypatch.setattr("app.db.collections.excluded_accounts_col", _EmptyExcl())
    expired = []

    async def mark(cid):
        expired.append(cid)

    async def ident(uid):
        return None
    monkeypatch.setattr(fs, "_mark_finexer_accounts_expired", mark)
    monkeypatch.setattr(fs, "user_identity", ident)
    assert _run(fs.sync_finexer_consent("fx-1", "u1")) == ([], 0)
    assert consents.docs[0]["last_sync_error"] == "bank_accounts_http_503"
    assert "last_sync_error_at" in consents.docs[0]
    assert expired == []


def test_consent_without_retry_reports_the_passed_customer(monkeypatch, env):
    """A191: no unknown-customer retry, so the consent is stamped with the id passed in."""
    client = Client({"/consents": [Resp(200, {"id": "cst_1"})]})
    _install(monkeypatch, client)
    out = _run(fs.create_consent(EMAIL, "cus_ok", "amex", "st"))
    assert out.customer_id_used == "cus_ok"
