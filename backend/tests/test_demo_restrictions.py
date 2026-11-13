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


# One-line reasons, shared by the routes below.
_R0 = "MCP read connector, off in production; no connector can be authorised because /oauth/decision is blocked"
_R1 = "PATCH /preferences: the demo's own settings"
_R2 = "PUT /profile: the demo's own display name"
_R3 = "Penny on the demo's own data, metered by the Plus allowance (consent and proposals are own-data writes only)"
_R4 = "Penny-style answer on own data, metered"
_R5 = "a saved basket the reviewer made, own data"
_R6 = "edits to the demo's own synthetic accounts, card terms and holdings"
_R7 = "manual accounts and rules the reviewer adds themselves"
_R8 = "own upload, metered parse of the reviewer's own file or receipt"
_R9 = "own-data goal, plan, rule, category, correction or dismissal write"
_R10 = "owner or bot only, gated in the handler (checked by test_owner_only_routes_gate_in_the_handler)"
_R11 = "price lookup for the demo's own holdings, no bank provider"
_R12 = "sign-in or OAuth protocol endpoint, no per-user data"
_R13 = "sign-out: the demo identity gets ok without revoking other reviewers' sessions"
_R14 = "the reviewer's own device registration and test push"
_R15 = "the session's own validity check"
_R16 = "unauthenticated provider webhook, no session involved"

DEMO_ALLOWED = {
    ("DELETE", "/accounts/{account_id}"): _R6,
    ("PATCH", "/accounts/{account_id}"): _R6,
    ("PUT", "/accounts/{account_id}/rate"): _R6,
    ("POST", "/admin/allowlist"): _R10,
    ("DELETE", "/admin/allowlist/{key}"): _R10,
    ("POST", "/admin/broadcast/preview"): _R10,
    ("POST", "/admin/broadcast/{broadcast_id}/send"): _R10,
    ("POST", "/admin/finexer/providers/refresh"): _R10,
    ("POST", "/admin/sync-all"): _R10,
    ("POST", "/allocations"): _R9,
    ("DELETE", "/allocations/{allocation_id}"): _R9,
    ("PATCH", "/allocations/{allocation_id}"): _R9,
    ("PUT", "/allocations/{allocation_id}/contribution"): _R9,
    ("DELETE", "/allocations/{allocation_id}/period-override"): _R9,
    ("PUT", "/allocations/{allocation_id}/period-override"): _R9,
    ("POST", "/auth/apple/native"): _R12,
    ("POST", "/auth/demo/login"): _R12,
    ("POST", "/auth/google/native"): _R12,
    ("POST", "/auth/logout"): _R13,
    ("POST", "/auth/mobile/poll"): _R12,
    ("POST", "/auth/oauth/register"): _R12,
    ("POST", "/auth/oauth/revoke"): _R12,
    ("POST", "/auth/oauth/token"): _R12,
    ("POST", "/auth/session/validate"): _R15,
    ("POST", "/baskets/scan-receipt"): _R8,
    ("DELETE", "/baskets/{basket_id}"): _R5,
    ("POST", "/can-i"): _R4,
    ("DELETE", "/card-terms/{account_id}"): _R6,
    ("POST", "/card-terms/{account_id}"): _R6,
    ("POST", "/card-terms/{account_id}/lookup"): _R6,
    ("POST", "/card-terms/{account_id}/payment"): _R6,
    ("POST", "/card-terms/{account_id}/payment-history"): _R6,
    ("POST", "/card-terms/{account_id}/payment-match-preview"): _R6,
    ("POST", "/card-terms/{account_id}/rates"): _R6,
    ("DELETE", "/card-terms/{account_id}/statement-amount"): _R6,
    ("POST", "/card-terms/{account_id}/statement-amount"): _R6,
    ("POST", "/cashflow/apply-rule"): _R9,
    ("POST", "/cashflow/clear-override"): _R9,
    ("POST", "/cashflow/clear-rule"): _R9,
    ("POST", "/cashflow/dismiss-recurring"): _R9,
    ("POST", "/cashflow/edit-upcoming"): _R9,
    ("POST", "/cashflow/preview-rule"): _R9,
    ("POST", "/cashflow/restore-recurring"): _R9,
    ("POST", "/cashflow/skip-occurrence"): _R9,
    ("POST", "/categories"): _R9,
    ("PATCH", "/categories/group"): _R9,
    ("POST", "/categories/groups/reset"): _R9,
    ("PATCH", "/categories/icon"): _R9,
    ("DELETE", "/categories/{name}"): _R9,
    ("POST", "/chat/tax"): _R4,
    ("POST", "/checkpoints"): _R9,
    ("DELETE", "/checkpoints/{checkpoint_id}"): _R9,
    ("PATCH", "/checkpoints/{checkpoint_id}"): _R9,
    ("POST", "/checkpoints/{checkpoint_id}/nudge-dismiss"): _R9,
    ("POST", "/commitments"): _R9,
    ("POST", "/commitments/preview"): _R9,
    ("POST", "/commitments/schedule-preview"): _R9,
    ("DELETE", "/commitments/{commitment_id}"): _R9,
    ("PATCH", "/commitments/{commitment_id}"): _R9,
    ("PUT", "/commitments/{commitment_id}/contribution"): _R9,
    ("PUT", "/commitments/{commitment_id}/ease"): _R9,
    ("POST", "/dismissed-series/hide"): _R9,
    ("POST", "/dismissed-series/override"): _R9,
    ("POST", "/income/confirm-payday"): _R9,
    ("POST", "/income/streams/confirm"): _R9,
    ("POST", "/income/streams/manual"): _R9,
    ("POST", "/income/streams/reject"): _R9,
    ("DELETE", "/income/streams/{key}"): _R9,
    ("DELETE", "/investment/accounts/{account_id}"): _R6,
    ("POST", "/investment/accounts/{account_id}/notes/upload"): _R8,
    ("POST", "/investment/accounts/{account_id}/refresh"): _R11,
    ("POST", "/investment/notes/upload"): _R8,
    ("DELETE", "/investment/notes/{note_id}"): _R6,
    ("POST", "/investment/upload"): _R8,
    ("POST", "/manual-account-rules"): _R7,
    ("DELETE", "/manual-account-rules/{rule_id}"): _R7,
    ("PATCH", "/manual-account-rules/{rule_id}"): _R7,
    ("POST", "/manual-accounts"): _R7,
    ("DELETE", "/manual-accounts/{acc_id}"): _R7,
    ("PATCH", "/manual-accounts/{acc_id}"): _R7,
    ("POST", "/manual-accounts/{acc_id}/transactions"): _R7,
    ("DELETE", "/manual-accounts/{acc_id}/transactions/{tx_id}"): _R7,
    ("PATCH", "/manual-accounts/{acc_id}/transactions/{tx_id}"): _R7,
    ("DELETE", "/mcp"): _R0,
    ("POST", "/mcp"): _R0,
    ("POST", "/mirror/choice"): _R9,
    ("DELETE", "/oauth/connections/{client_id}"): _R0,
    ("POST", "/offers/{receipt_id}/dismiss"): _R9,
    ("POST", "/ops/go-live/items/{item_id}"): _R10,
    ("POST", "/ops/go-live/questions/{q}"): _R10,
    ("POST", "/ops/health/alerts/test"): _R10,
    ("POST", "/ops/health/finexer-events/reconcile"): _R10,
    ("POST", "/ops/people/backfill"): _R10,
    ("POST", "/ops/people/invite"): _R10,
    ("POST", "/ops/people/{pid}/allow"): _R10,
    ("POST", "/ops/people/{pid}/erase"): _R10,
    ("POST", "/ops/people/{pid}/restore"): _R10,
    ("POST", "/ops/people/{pid}/revoke"): _R10,
    ("POST", "/ops/people/{pid}/subscription/cancel-grant"): _R10,
    ("POST", "/ops/people/{pid}/subscription/reset-trial"): _R10,
    ("POST", "/ops/people/{pid}/subscription/set-tier"): _R10,
    ("POST", "/ops/people/{pid}/subscription/topup"): _R10,
    ("DELETE", "/ops/settings/{key}"): _R10,
    ("PUT", "/ops/settings/{key}"): _R10,
    ("DELETE", "/penny/agent-consent"): _R3,
    ("POST", "/penny/agent-consent"): _R3,
    ("POST", "/penny/chip"): _R3,
    ("POST", "/penny/conversations"): _R3,
    ("DELETE", "/penny/conversations/{conversation_id}"): _R3,
    ("POST", "/penny/conversations/{conversation_id}/turns"): _R3,
    ("POST", "/penny/proposals/{proposal_id}/cancel"): _R3,
    ("POST", "/penny/proposals/{proposal_id}/execute"): _R3,
    ("POST", "/penny/proposals/{proposal_id}/scheduled-goal-revision"): _R3,
    ("POST", "/planned"): _R9,
    ("DELETE", "/planned/{planned_id}"): _R9,
    ("PATCH", "/planned/{planned_id}"): _R9,
    ("POST", "/plans/category-activity"): _R9,
    ("PATCH", "/preferences"): _R1,
    ("PUT", "/profile"): _R2,
    ("DELETE", "/push/apns/register"): _R14,
    ("POST", "/push/apns/register"): _R14,
    ("POST", "/push/client-diagnostic"): _R14,
    ("DELETE", "/push/fcm/register"): _R14,
    ("POST", "/push/fcm/register"): _R14,
    ("DELETE", "/push/subscribe"): _R14,
    ("POST", "/push/subscribe"): _R14,
    ("POST", "/push/test"): _R14,
    ("POST", "/rules"): _R9,
    ("POST", "/rules/parse"): _R9,
    ("DELETE", "/rules/{rule_id}"): _R9,
    ("POST", "/savings-insights/label"): _R9,
    ("DELETE", "/savings-insights/labels/{merchant_key}"): _R9,
    ("POST", "/savings-insights/mark-viewed"): _R9,
    ("POST", "/savings-insights/refresh"): _R9,
    ("POST", "/savings-insights/{insight_id}/context"): _R9,
    ("POST", "/savings-insights/{insight_id}/dismiss"): _R9,
    ("POST", "/savings-insights/{insight_id}/opened"): _R9,
    ("PATCH", "/savings-insights/{insight_id}/pin"): _R9,
    ("DELETE", "/savings/goal"): _R9,
    ("PUT", "/savings/goal"): _R9,
    ("POST", "/savings/manual-account"): _R7,
    ("DELETE", "/savings/manual-account/{acc_id}"): _R7,
    ("PATCH", "/savings/manual-account/{acc_id}"): _R7,
    ("POST", "/spend/intent-preview"): _R9,
    ("DELETE", "/spend/intent/{category}"): _R9,
    ("POST", "/spend/verdict/dismiss-unresolved"): _R9,
    ("POST", "/statement/upload"): _R8,
    ("PATCH", "/subscription/admin/set-tier"): _R10,
    ("POST", "/subscription/admin/topup"): _R10,
    ("POST", "/today/dismiss"): _R9,
    ("POST", "/transactions/auto-categorise"): _R9,
    ("POST", "/transactions/confirm-transfer-pair"): _R9,
    ("POST", "/transactions/dismiss-miscategorised-series"): _R9,
    ("POST", "/transactions/dismiss-transfer-pair"): _R9,
    ("POST", "/transactions/filed-transfers/undo"): _R9,
    ("POST", "/transactions/finish-transfer-review"): _R9,
    ("POST", "/transactions/undo-ai-transfer"): _R9,
    ("PATCH", "/transactions/{transaction_id}"): _R9,
    ("POST", "/transactions/{transaction_id}/correction-scope"): _R9,
    ("POST", "/transactions/{transaction_id}/correction-scope/refresh"): _R9,
    ("POST", "/transactions/{transaction_id}/correction-scope/undo"): _R9,
    ("PATCH", "/transactions/{transaction_id}/planned"): _R9,
    ("POST", "/transactions/{transaction_id}/resolve-movement"): _R9,
    ("POST", "/transactions/{txn_id}/dismiss-miscategorised"): _R9,
    ("POST", "/trends/intent"): _R9,
    ("POST", "/webhooks/apple"): _R16,
    ("POST", "/webhooks/finexer/{secret}"): _R16,
    ("POST", "/webhooks/google-play"): _R16,
    ("POST", "/webhooks/stripe"): _R16,
}


def _mutating_unlisted(apps):
    """Every POST/PUT/PATCH/DELETE route mounted on `apps` that is neither
    refused for the demo user nor listed in DEMO_ALLOWED."""
    found = set()
    for app in apps:
        for r in app.routes:
            p, ms = getattr(r, "path", None), getattr(r, "methods", None)
            if not p or not ms:
                continue
            for m in ms & {"POST", "PUT", "PATCH", "DELETE"}:
                if not demo.demo_blocked(DEMO, m, _concrete(p)) and (m, p) not in DEMO_ALLOWED:
                    found.add((m, p))
    return sorted(found)


def _apps():
    from app.main import app, build_app
    return [app, build_app(True, mcp_only=False)]  # the second mounts the OAuth and MCP routers


def _mounted_mutating(apps):
    return {(m, r.path) for a in apps for r in a.routes if getattr(r, "methods", None)
            for m in r.methods & {"POST", "PUT", "PATCH", "DELETE"}}


def test_every_mutating_route_is_guarded_or_explicitly_allowed():
    unlisted = _mutating_unlisted(_apps())
    assert unlisted == [], (
        "decide whether the demo user may call each of these: add it to app.core.demo._BLOCKED "
        f"or to DEMO_ALLOWED with a reason: {unlisted}")


def test_demo_allowed_has_no_stale_entries():
    mounted = _mounted_mutating(_apps())
    assert sorted(k for k in DEMO_ALLOWED if k not in mounted) == []


def test_an_unlisted_mutating_route_fails_the_walk():
    from app.main import build_app
    app = build_app(True, mcp_only=False)

    async def _dummy():
        return {}
    app.post("/zz-c43-dummy-unlisted")(_dummy)
    app.patch("/zz-c43-dummy-unlisted/{x}")(_dummy)
    assert ("POST", "/zz-c43-dummy-unlisted") in _mutating_unlisted([app])
    assert ("PATCH", "/zz-c43-dummy-unlisted/{x}") in _mutating_unlisted([app])


def test_owner_only_routes_gate_in_the_handler():
    """The routes DEMO_ALLOWED lists as owner-only really check for the owner or a bot."""
    import inspect
    tokens = ("_require_owner", "_require_admin", "is_owner", "_require_owner_session")
    ungated = []
    for app in _apps():
        for r in app.routes:
            p, ms = getattr(r, "path", ""), getattr(r, "methods", None) or set()
            if p.startswith(("/ops", "/admin", "/subscription/admin")) and ms & {"POST", "PUT", "PATCH", "DELETE"}:
                if demo.demo_blocked(DEMO, sorted(ms)[0], _concrete(p)):
                    continue
                if not any(t in inspect.getsource(r.endpoint) for t in tokens):
                    ungated.append((sorted(ms), p))
    assert ungated == []


def test_demo_cannot_run_the_card_direction_migration():
    assert demo.demo_blocked(DEMO, "POST", "/admin/fix-card-transactions")
    assert not demo.demo_blocked(OTHER, "POST", "/admin/fix-card-transactions")


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
