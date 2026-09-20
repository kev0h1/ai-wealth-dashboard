"""A51 (WP4, API-13): malformed-upstream-response handling for Finexer sync.

No dedicated cross-provider "upstream safety" suite existed before this item
(confirmed by PENTEST-METHODOLOGY.md's own "Existing automated coverage"
column for API-13: "None found"). This is a behaviour-recording regression
test only, added per this item's own brief ("a behaviour-recording
regression test is allowed; a product fix is not"): it pins down what
app.services.finexer_sync currently does when Finexer returns a 200 with a
response shaped nothing like the documented `{"data": [...]}` schema, it
does not change that behaviour.

Local (mode L) only, per API-13's own mode declaration and this item's SSRF/
upstream-safety scope: fed through a stub client (`FxClient` below, the same
dispatch-by-path pattern tests/test_finexer_rate_limit.py already uses for
`sync_finexer_consent`), never a live request to Finexer's own
infrastructure.

Finding, recorded in this run's evidence (not fixed here, per this item's
test-and-report-only rule): `sync_finexer_consent` does not validate the
shape of `/bank_accounts`'s response body at all before iterating it
(`accounts = acc_data.get("data") or acc_data.get("results") or []`, then
`for acc in accounts: account_id = acc.get("id")` — app/services/
finexer_sync.py). A malformed 200 body whose `data` key is a string rather
than a list makes that loop iterate the string's individual characters and
then crash with AttributeError ('str' object has no attribute 'get') on the
very first one. This IS demonstrated below to raise, uncaught, out of
`sync_finexer_consent` itself — but its only real caller,
`finexer_sync_pipeline`, wraps the call in a broad `except Exception` and
returns `{"ok": False, "error": "sync_failed"}`, so in production this never
reaches a caller as an unhandled 500, corrupts no already-committed state
(the crash happens before any account/transaction write or `last_synced`
update for this sync attempt), and forwards no credential or upstream
detail. The safety here is a broad catch-all rather than upfront schema
validation — recorded as the observed behaviour for this run's evidence,
not raised as a separate finding, since no adverse security outcome is
demonstrated (section 7.1: "a source-code concern is recorded as a
hypothesis until the relevant control or impact is demonstrated" — here the
demonstrated impact is safe containment).
"""
import asyncio
import logging

import app.services.finexer_sync as finexer_sync


class FakeResp:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self._json = json_data if json_data is not None else {}
        self.text = text

    def json(self):
        return self._json


class FakeCol:
    """Minimal find_one/update_one stand-in, matching
    test_finexer_rate_limit.py's own."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    @staticmethod
    def _match(d, q):
        return all(d.get(k) == v for k, v in (q or {}).items())

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if self._match(d, query):
                return d
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update(update.get("$set") or {})
                return
        if upsert:
            new_doc = dict(filt)
            new_doc.update(update.get("$set") or {})
            self.docs.append(new_doc)


class FakeExcludedCol:
    def find(self, query=None, projection=None):
        return self

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class FxClient:
    """Dispatch-by-path stand-in for the `async with _client() as client:`
    block, extended from test_finexer_rate_limit.py's own FxClient with a
    `/bank_accounts` route so the malformed-body scenario can be reached."""

    def __init__(self, consent_responses, bank_accounts_response):
        self._consent_responses = list(consent_responses)
        self._bank_accounts_response = bank_accounts_response
        self.calls: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        self.calls.append((url, params))
        if url.startswith("/consents/"):
            return self._consent_responses.pop(0)
        if url == "/bank_accounts":
            return self._bank_accounts_response
        raise AssertionError(f"unexpected GET {url}")


def _wire_common(monkeypatch):
    consents = FakeCol([
        {"_id": "fx-a51", "user_id": "u-a51", "status": "authorized", "last_synced": None},
    ])
    monkeypatch.setattr(finexer_sync, "finexer_consents_col", consents)

    async def _no_user_identity(uid):
        return None
    monkeypatch.setattr(finexer_sync, "user_identity", _no_user_identity)

    monkeypatch.setattr("app.db.collections.excluded_accounts_col", FakeExcludedCol())

    async def _fake_list_providers(counter=None):
        return []
    monkeypatch.setattr(finexer_sync, "list_providers", _fake_list_providers)

    return consents


def test_malformed_bank_accounts_body_raises_uncaught_from_sync_finexer_consent(monkeypatch, caplog):
    """Demonstrates the exact failure mode: a 200 `/bank_accounts` response
    whose `data` field is a string (not a list) makes the per-account loop
    iterate characters and crash. This is the behaviour today — the
    assertion pins it down, it does not assert this is desirable."""
    consents = _wire_common(monkeypatch)

    fake_client = FxClient(
        consent_responses=[FakeResp(200, json_data={"status": "authorized"})],
        bank_accounts_response=FakeResp(200, json_data={"data": "not-a-list"}),
    )
    monkeypatch.setattr(finexer_sync, "_client", lambda: fake_client)

    with caplog.at_level(logging.INFO, logger="app.services.finexer_sync"):
        with __import__("pytest").raises(AttributeError):
            asyncio.run(finexer_sync.sync_finexer_consent("fx-a51", "u-a51"))

    # No account/transaction write and no last_synced stamp happened for
    # this attempt — the crash occurs before any of that in the function
    # body, so the consent doc is untouched beyond the status-sync fields
    # already written earlier in the same call.
    doc = consents.docs[0]
    assert "last_synced" not in doc or doc["last_synced"] is None


def test_pipeline_wrapper_contains_the_same_crash_safely(monkeypatch):
    """The one real caller (`finexer_sync_pipeline`) wraps the call above in
    a broad `except Exception`, so in production this malformed response
    never reaches an HTTP caller as an unhandled 500 and produces no partial
    write beyond what test_malformed_bank_accounts_body_raises_uncaught
    already showed is none."""
    _wire_common(monkeypatch)

    fake_client = FxClient(
        consent_responses=[FakeResp(200, json_data={"status": "authorized"})],
        bank_accounts_response=FakeResp(200, json_data={"data": "not-a-list"}),
    )
    monkeypatch.setattr(finexer_sync, "_client", lambda: fake_client)

    # finexer_sync_pipeline additionally calls apply_rules_bulk /
    # categorise_others_bg / apply_mirror_rules after a successful sync, but
    # the crash above means it returns before ever reaching them — no need
    # to stub those for this scenario.
    result = asyncio.run(finexer_sync.finexer_sync_pipeline("fx-a51", "u-a51"))

    assert result == {"ok": False, "error": "sync_failed"}
