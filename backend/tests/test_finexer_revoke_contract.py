"""A157 contract: Finexer consent revocation uses the DOCUMENTED endpoint,
POST /consents/{id}/revoke (Basic auth, API key as username), and counts as
success only when Finexer says the consent is canceled. The old DELETE
/consents/{id} is not a Finexer endpoint; its 404 was accepted as success,
so revocations silently never happened (A82 to A157). The fake client records
every method and path and fails the test on any DELETE. No network."""
import asyncio

import httpx
import pytest

import app.services.finexer_sync as finexer_sync_module
import app.services.retention as retention
from tests.test_retention import FakeCol

UID = "someone@example.com"
CID = "bc_IvmbYH1egGbK8I6R8INWwlIBKFBXI"


class _Resp:
    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


class ContractClient:
    """Records (method, path). `post_resp`/`get_resp` are a _Resp or an
    exception to raise."""

    def __init__(self, post_resp, get_resp=None):
        self.post_resp, self.get_resp = post_resp, get_resp
        self.requests: list[tuple[str, str]] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def _answer(self, r):
        if isinstance(r, BaseException):
            raise r
        return r

    async def post(self, path, **kw):
        self.requests.append(("POST", path))
        return self._answer(self.post_resp)

    async def get(self, path, **kw):
        self.requests.append(("GET", path))
        return self._answer(self.get_resp if self.get_resp is not None else _Resp(404))

    async def delete(self, path, **kw):
        self.requests.append(("DELETE", path))
        pytest.fail(f"DELETE {path} issued: not a Finexer endpoint (A157)")

    async def put(self, *a, **k):
        pytest.fail("unexpected PUT")

    async def patch(self, *a, **k):
        pytest.fail("unexpected PATCH")


def _run(monkeypatch, client):
    consents = FakeCol([{"_id": CID, "user_id": UID, "status": "authorized"}])
    markers = FakeCol()
    monkeypatch.setattr(retention, "finexer_consents_col", consents)
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    err = asyncio.run(retention.revoke_finexer_consent(UID, CID))
    assert not [r for r in client.requests if r[0] == "DELETE"]
    return err, consents, markers


def test_client_uses_basic_auth_with_key_as_username():
    c = finexer_sync_module._client()
    try:
        assert isinstance(c._auth, httpx.BasicAuth)
        hdr = c._auth._auth_header
        assert hdr.startswith("Basic ")
    finally:
        asyncio.run(c.aclose())


@pytest.mark.parametrize("body", [{"status": "canceled"}, {"status": "cancelled"}])
def test_2xx_canceled_is_success_and_marks_local_revoked(monkeypatch, body):
    client = ContractClient(_Resp(200, body))
    err, consents, markers = _run(monkeypatch, client)
    assert err is None
    assert client.requests == [("POST", f"/consents/{CID}/revoke")]
    assert consents.docs[CID]["status"] == "revoked" and consents.docs[CID]["revoked_at"]
    assert markers.docs == {}


def test_2xx_no_status_but_canceled_timestamp_is_success(monkeypatch):
    """The ONLY timestamp fallback case: the body carries no status at all."""
    client = ContractClient(_Resp(200, {"canceled_at": "2026-10-08T10:00:00Z"}))
    err, _, markers = _run(monkeypatch, client)
    assert err is None and markers.docs == {}


def test_2xx_authorized_with_canceled_timestamp_is_not_success(monkeypatch):
    client = ContractClient(_Resp(200, {"status": "authorized", "canceled_at": "2026-10-08T10:00:00Z"}))
    err, consents, markers = _run(monkeypatch, client)
    assert err == "not_canceled" and markers.docs[CID]["last_error"] == "not_canceled"
    assert consents.docs[CID]["status"] == "authorized"


def test_2xx_still_authorized_is_failure_with_not_canceled_marker(monkeypatch):
    client = ContractClient(_Resp(200, {"status": "authorized"}))
    err, consents, markers = _run(monkeypatch, client)
    assert err == "not_canceled"
    assert markers.docs[CID]["last_error"] == "not_canceled"
    assert consents.docs[CID]["status"] == "authorized"


def test_2xx_without_json_body_is_failure(monkeypatch):
    err, _, markers = _run(monkeypatch, ContractClient(_Resp(204, None)))
    assert err == "not_canceled" and markers.docs[CID]["last_error"] == "not_canceled"


def test_404_then_get_404_is_success(monkeypatch):
    client = ContractClient(_Resp(404), _Resp(404))
    err, consents, markers = _run(monkeypatch, client)
    assert err is None and markers.docs == {}
    assert client.requests == [("POST", f"/consents/{CID}/revoke"), ("GET", f"/consents/{CID}")]
    assert consents.docs[CID]["status"] == "revoked"


def test_404_then_get_canceled_is_success(monkeypatch):
    client = ContractClient(_Resp(404), _Resp(200, {"status": "canceled"}))
    err, _, markers = _run(monkeypatch, client)
    assert err is None and markers.docs == {}


def test_404_then_get_authorized_records_marker(monkeypatch):
    client = ContractClient(_Resp(404), _Resp(200, {"status": "authorized"}))
    err, consents, markers = _run(monkeypatch, client)
    assert err == "404_unconfirmed" and markers.docs[CID]["last_error"] == "404_unconfirmed"
    assert consents.docs[CID]["status"] == "authorized"


def test_404_then_get_500_records_marker(monkeypatch):
    err, _, markers = _run(monkeypatch, ContractClient(_Resp(404), _Resp(500)))
    assert err == "404_unconfirmed" and CID in markers.docs


def test_500_records_marker_and_keeps_local_doc(monkeypatch):
    client = ContractClient(_Resp(500))
    err, consents, markers = _run(monkeypatch, client)
    assert err == "500" and markers.docs[CID]["last_error"] == "500"
    assert client.requests == [("POST", f"/consents/{CID}/revoke")]
    assert consents.docs[CID]["status"] == "authorized"


@pytest.mark.parametrize("code", [401, 403, 429, 503])
def test_other_non_2xx_record_marker(monkeypatch, code):
    err, _, markers = _run(monkeypatch, ContractClient(_Resp(code)))
    assert err == str(code) and markers.docs[CID]["last_error"] == str(code)


def test_timeout_records_marker(monkeypatch):
    err, _, markers = _run(monkeypatch, ContractClient(httpx.ReadTimeout("slow")))
    assert err == "ReadTimeout" and markers.docs[CID]["last_error"] == "ReadTimeout"


def test_follow_up_get_timeout_records_marker(monkeypatch):
    err, _, markers = _run(monkeypatch, ContractClient(_Resp(404), httpx.ReadTimeout("slow")))
    assert err == "ReadTimeout" and CID in markers.docs


def test_bad_id_makes_no_request(monkeypatch):
    client = ContractClient(_Resp(200, {"status": "canceled"}))
    monkeypatch.setattr(retention, "orphaned_revocations_col", FakeCol())
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    assert asyncio.run(retention.revoke_finexer_consent(UID, "../x")) == "bad_id"
    assert client.requests == []


def test_sweep_uses_same_endpoint_and_keeps_marker_when_not_canceled(monkeypatch):
    from tests.test_retention import NOW
    markers = FakeCol([{"_id": CID, "consent_id": CID, "failed_at": NOW, "attempts": 1}])
    monkeypatch.setattr(retention, "orphaned_revocations_col", markers)
    monkeypatch.setattr(retention, "finexer_consents_col", FakeCol())
    client = ContractClient(_Resp(200, {"status": "authorized"}))
    monkeypatch.setattr(finexer_sync_module, "_client", lambda: client)
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert client.requests == [("POST", f"/consents/{CID}/revoke")]
    assert CID in markers.docs and markers.docs[CID]["last_error"] == "not_canceled"
    assert res["orphaned_still_pending"] == 1

    client.post_resp = _Resp(200, {"status": "canceled"})
    res = asyncio.run(retention.retry_orphaned_revocations(now=NOW))
    assert markers.docs == {} and res["orphaned_cleared"] == 1
    assert all(m == "POST" for m, _ in client.requests)
