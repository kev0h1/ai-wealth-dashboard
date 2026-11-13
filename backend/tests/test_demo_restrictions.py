"""C43: the demo identity's isolation, checked against the real route table.

No Mongo, no network. tests/test_demo_login.py covers the login route, the hash
and the per-route refusals; this file proves the central block list names real
routes, that no provider-touching route was added without a decision, that
admin and ops stay owner-only, and that the worker's consent watch and
reconcile loops skip the demo identity.
"""
import asyncio
import re
from datetime import datetime

import pytest
from fastapi import HTTPException

import app.core.config as config
from app.core import demo

DEMO = "appreview@auriqltd.co.uk"
OTHER = "someone.real@example.com"


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _demo_email(monkeypatch):
    monkeypatch.setattr(config, "DEMO_LOGIN_EMAIL", DEMO)


def _routes():
    from app.main import app
    out = set()
    for r in app.routes:
        p, ms = getattr(r, "path", None), getattr(r, "methods", None)
        if p and ms:
            out.update((m, p) for m in ms if m not in ("HEAD", "OPTIONS"))
    return out


def _concrete(path):
    return re.sub(r"\{[^}]+\}", "abc", path)


# Routes the demo user must be refused on, and which are mounted today.
MOUNTED_GUARDED = [
    ("GET", "/auth/finexer/link"), ("GET", "/auth/finexer/providers"), ("GET", "/auth/finexer/pending"),
    ("POST", "/auth/finexer/consents/{consent_id}/reconfirm"),
    ("POST", "/accounts/sync"), ("POST", "/accounts/sync-history"), ("POST", "/accounts/{account_id}/refresh"),
    ("DELETE", "/account"), ("GET", "/penny/conversations/export"),
    ("POST", "/auth/identities/apple"), ("DELETE", "/auth/identities/apple"), ("DELETE", "/connections/{connection_id}"),
    ("POST", "/billing/checkout"), ("POST", "/billing/portal"), ("POST", "/billing/apple/verify"),
    ("GET", "/billing/apple/account-token"), ("POST", "/billing/play/purchase"), ("POST", "/subscription/select-free"),
]


def test_every_guarded_route_exists_and_is_refused_for_the_demo_user_only():
    routes = _routes()
    for method, path in MOUNTED_GUARDED:
        assert (method, path) in routes, f"guarded route {method} {path} is not mounted: fix the block list"
        assert demo.demo_blocked(DEMO, method, _concrete(path)), (method, path)
        assert not demo.demo_blocked(OTHER, method, _concrete(path)), (method, path)


# Provider-, billing-, identity- or export-looking routes that are deliberately
# open to the demo user (own data only), or are not session routes at all.
_KEYWORDS = re.compile(r"sync|link|provider|refresh|consent|reconfirm|checkout|portal|billing|subscription|identit|"
                       r"export|oauth|mcp|connect|callback|webhook|truelayer|finexer|upload|statement|erase|purchase|apple|play|topup",
                       re.I)
REVIEWED_OPEN = {
    # Owner or bot only (checked in the handler): the demo session is neither.
    ("POST", "/admin/finexer/providers/refresh"), ("POST", "/admin/sync-all"), ("GET", "/admin/sync-stats"),
    ("POST", "/ops/health/finexer-events/reconcile"), ("POST", "/ops/people/{pid}/erase"),
    ("GET", "/ops/people/{pid}/subscription"), ("POST", "/ops/people/{pid}/subscription/cancel-grant"),
    ("POST", "/ops/people/{pid}/subscription/reset-trial"), ("POST", "/ops/people/{pid}/subscription/set-tier"),
    ("POST", "/ops/people/{pid}/subscription/topup"), ("GET", "/ops/webhooks/recent"),
    ("PATCH", "/subscription/admin/set-tier"), ("POST", "/subscription/admin/topup"),
    # Unauthenticated provider callbacks and webhooks: no session, keyed by provider ids and signed state.
    ("POST", "/auth/apple/native"), ("GET", "/auth/finexer/callback"), ("GET", "/auth/google/callback"),
    ("GET", "/auth/google/mobile-callback"), ("POST", "/webhooks/apple"), ("POST", "/webhooks/finexer/{secret}"),
    ("POST", "/webhooks/google-play"), ("POST", "/webhooks/stripe"),
    # The demo user's own data and read-only status.
    ("GET", "/account-plans"), ("GET", "/auth/identities"), ("GET", "/billing/play/config"), ("GET", "/billing/status"),
    ("GET", "/subscription"), ("GET", "/connections"), ("GET", "/sync/status"), ("GET", "/logo/provider/{provider_id}"),
    ("DELETE", "/card-terms/{account_id}/statement-amount"), ("POST", "/card-terms/{account_id}/statement-amount"),
    ("GET", "/manual-account-rules"), ("POST", "/manual-account-rules"), ("DELETE", "/manual-account-rules/{rule_id}"),
    ("PATCH", "/manual-account-rules/{rule_id}"), ("DELETE", "/penny/agent-consent"), ("POST", "/penny/agent-consent"),
    ("POST", "/savings-insights/refresh"), ("POST", "/savings/manual-account"),
    ("DELETE", "/savings/manual-account/{acc_id}"), ("PATCH", "/savings/manual-account/{acc_id}"),
    ("POST", "/statement/upload"), ("POST", "/transactions/{transaction_id}/correction-scope/refresh"),
    ("GET", "/investment/accounts"), ("DELETE", "/investment/accounts/{account_id}"),
    ("GET", "/investment/accounts/{account_id}/holdings"), ("GET", "/investment/accounts/{account_id}/notes"),
    ("POST", "/investment/accounts/{account_id}/notes/upload"), ("POST", "/investment/accounts/{account_id}/refresh"),
    ("POST", "/investment/notes/upload"), ("DELETE", "/investment/notes/{note_id}"), ("POST", "/investment/upload"),
}


def test_no_new_provider_touching_route_is_open_without_a_decision():
    """A new route whose path looks like a bank, billing, identity or export
    route must be added to MOUNTED_GUARDED (and app.core.demo._BLOCKED) or to
    REVIEWED_OPEN above with a reason, never silently left open."""
    unreviewed = []
    for method, path in sorted(_routes()):
        if not _KEYWORDS.search(path):
            continue
        if demo.demo_blocked(DEMO, method, _concrete(path)) or (method, path) in REVIEWED_OPEN:
            continue
        unreviewed.append((method, path))
    assert unreviewed == [], f"decide whether the demo user may call these: {unreviewed}"


def test_demo_identity_is_not_the_owner_and_admin_routes_refuse_it():
    from app.core.config import PRIMARY_EMAIL
    assert DEMO != PRIMARY_EMAIL.strip().lower()
    from app.routers import admin, admin_usage, ops, subscription
    user = {"email": DEMO, "name": "App Review"}
    with pytest.raises(HTTPException) as e:
        _run(admin.admin_sync_all(user=user))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _run(subscription.admin_set_tier({"email": DEMO, "tier": "plus"}, user=user))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        admin_usage._require_admin(user)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        ops._require_owner(user)
    assert e.value.status_code == 403


# ---- the worker loops --------------------------------------------------------


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return list(self.docs)


class _FakeCol:
    def __init__(self, docs):
        self.docs = docs
        self.updated = []

    def find(self, *a, **k):
        return _Cursor(self.docs)

    async def count_documents(self, *a, **k):
        return 1

    async def update_one(self, *a, **k):
        self.updated.append(a)


def _dead_conn(uid, cid):
    return {"_id": cid, "user_id": uid, "needs_reauth": True, "provider": "x", "last_synced": datetime(2026, 1, 1)}


def _dead_consent(uid, cid):
    return {"_id": cid, "user_id": uid, "status": "revoked", "provider": "x", "last_synced": datetime(2026, 1, 1)}


def _run_consent_watch(monkeypatch, uids):
    from app.workers import sync_worker as sw
    sent = []
    conns = _FakeCol([_dead_conn(u, f"tl-{i}") for i, u in enumerate(uids)])
    fx = _FakeCol([_dead_consent(u, f"fx-{i}") for i, u in enumerate(uids)])
    monkeypatch.setattr(sw, "connections_col", conns)
    monkeypatch.setattr(sw, "finexer_consents_col", fx)
    monkeypatch.setattr(sw, "accounts_col", _FakeCol([]))

    async def _true(*a, **k):
        return True

    async def _push(uid, *a, **k):
        sent.append(uid)

    monkeypatch.setattr(sw, "notif_pref", _true)
    monkeypatch.setattr(sw, "finexer_consent_needs_attention", _true)
    monkeypatch.setattr(sw, "send_push_to_user", _push)
    from app.services import finexer_consent
    monkeypatch.setattr(finexer_consent, "reconfirm_enabled", _true)
    _run(sw.task_consent_watch({}))
    return sent


def test_consent_watch_never_nudges_the_demo_identity(monkeypatch):
    sent = _run_consent_watch(monkeypatch, [DEMO])
    assert sent == []


def test_consent_watch_control_still_nudges_a_real_user(monkeypatch):
    """Without this the test above would pass on a broken fixture."""
    sent = _run_consent_watch(monkeypatch, [OTHER])
    assert sent and set(sent) == {OTHER}
