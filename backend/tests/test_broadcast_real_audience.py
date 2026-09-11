"""B24: broadcast audiences must exclude test fixtures and other identities
nobody could call "a real user", so an offer can never be sent to one.

Ground truth this fix is built from (live, read-only query against UAT,
2026-09-11 — see the B24 item notes): the old candidate pool
(`_all_user_ids()`, a union of user_profiles_col/preferences_col/
subscriptions_col) counted four identities that should never receive a
broadcast: fixture-engine-2@test.local (one stray preferences doc and
nothing else — never authenticated), not-the-owner@example.com (one stray
user_profiles "last seen" stamp and nothing else — a session token decoded
once, no account, no transaction, ever), and a.odonde@gmail.com /
ndolomeshack@gmail.com (an admin-inserted "connect" subscriptions doc and
nothing else — no user_profiles stamp at all, so the identity has never
made a single authenticated request despite nominally "owning" a paid
tier). None of the four ever connected a bank, uploaded a statement, or
added a manual account.

This file tests the fix (`app.services.broadcast._real_user_ids` /
`resolve_audience`) against fakes shaped like that ground truth, wired
through the REAL `app.services.retention.account_has_data` (not mocked
away) so the test actually exercises the account-data check the fix
relies on, not a stand-in for it. Every fake collection here is a plain
in-memory object; nothing in this file ever touches real Mongo.
"""
import asyncio

import app.db.collections as db_collections_module
import app.services.broadcast as broadcast
from app.services.retention import _ACCOUNT_DATA_COLLECTIONS


def run(coro):
    return asyncio.run(coro)


# ── fakes ──────────────────────────────────────────────────────────────

class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FindCol:
    """user_profiles_col / preferences_col / subscriptions_col shape:
    find()/find_one(), matched on plain equality."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in query.items())]
        if projection:
            rows = [{k: d.get(k) for k, want in projection.items() if want} for d in rows]
        return _Cursor(rows)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return dict(d)
        return None


class _CountableCol:
    """The shape account_has_data actually calls: count_documents(query,
    limit=1) on each of app.services.retention._ACCOUNT_DATA_COLLECTIONS."""

    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def count_documents(self, query, limit=None):
        n = sum(1 for d in self.docs if all(d.get(k) == v for k, v in query.items()))
        return min(n, limit) if limit else n


# ── identities, matching the UAT ground truth shape ─────────────────────

REAL_FULL = "real-user@gmail.com"          # full record + a real connected account
REAL_ON_FIXTURE_LOOKING_DOMAIN = "genuine@test.local"  # same domain as a known fixture, but has real data
STRAY_PREFS_ONLY = "stray-pref@example.org"  # fixture-engine-2@test.local's shape
# Deliberately the SAME domain as REAL_ON_FIXTURE_LOOKING_DOMAIN, so the
# included/excluded split below can never be explained by a domain rule —
# not-the-owner@example.com's shape (one stray profile stamp, no other
# data), just moved onto "test.local" instead of "example.com" to pin the
# domain down as the shared variable.
STRAY_PROFILE_ONLY = "stray-ping@test.local"
STRAY_SUB_ONLY = "admin-granted@example.org"  # a.odonde@gmail.com / ndolomeshack@gmail.com's shape
GHOST_NO_DOCS = "never-existed@gmail.com"     # appears nowhere at all
OPTED_OUT_REAL = "opted-out@gmail.com"        # full record + real account data, but opted out of offers


def _wire(monkeypatch, *, account_data_owner: str):
    """Wire every collection `_all_user_ids`/`_real_user_ids` touch.
    `account_data_owner` is the one identity that owns a row in a real
    per-account collection (accounts_col here, arbitrarily — any one of
    `_ACCOUNT_DATA_COLLECTIONS` would do, see the parametrised test
    below)."""
    user_profiles = _FindCol([
        {"_id": REAL_FULL}, {"_id": REAL_ON_FIXTURE_LOOKING_DOMAIN},
        {"_id": STRAY_PROFILE_ONLY}, {"_id": OPTED_OUT_REAL},
    ])
    preferences = _FindCol([
        {"_id": "p1", "user_id": REAL_FULL},
        {"_id": "p2", "user_id": REAL_ON_FIXTURE_LOOKING_DOMAIN},
        {"_id": "p3", "user_id": STRAY_PREFS_ONLY},
        {"_id": "p4", "user_id": OPTED_OUT_REAL},
    ])
    subscriptions = _FindCol([
        {"_id": "s1", "user_id": REAL_FULL, "tier": "connect"},
        {"_id": "s2", "user_id": REAL_ON_FIXTURE_LOOKING_DOMAIN, "tier": "connect"},
        {"_id": "s3", "user_id": STRAY_SUB_ONLY, "tier": "connect", "managed_by": "manual"},
        {"_id": "s4", "user_id": OPTED_OUT_REAL, "tier": "connect"},
    ])
    monkeypatch.setattr(broadcast, "user_profiles_col", user_profiles)
    monkeypatch.setattr(broadcast, "preferences_col", preferences)
    monkeypatch.setattr(broadcast, "subscriptions_col", subscriptions)
    # app.core.subscription.get_subscription re-imports subscriptions_col
    # fresh from app.db.collections on every call (its own lazy-import
    # convention, for the same testability reason) rather than using
    # broadcast.py's bound name above — both must point at the same fake
    # or the "tier" branch's real get_subscription() call falls through to
    # the real (unmocked) motor collection.
    monkeypatch.setattr(db_collections_module, "subscriptions_col", subscriptions)

    # account_has_data reads app.db.collections fresh by name each call —
    # every name in _ACCOUNT_DATA_COLLECTIONS must resolve to SOMETHING
    # with count_documents, even if empty, or the real (unmocked) motor
    # collection underneath would be hit.
    for name in _ACCOUNT_DATA_COLLECTIONS:
        docs = [{"user_id": account_data_owner}] if account_data_owner else []
        monkeypatch.setattr(db_collections_module, name, _CountableCol(docs))

    async def fake_notif_pref(user_id, key):
        assert key == "offers"
        return user_id != OPTED_OUT_REAL
    monkeypatch.setattr(broadcast, "notif_pref", fake_notif_pref)


# ── the four required fixtures ───────────────────────────────────────────

def test_full_user_record_is_included(monkeypatch):
    _wire(monkeypatch, account_data_owner=REAL_FULL)
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert REAL_FULL in ids


def test_stray_preferences_document_only_is_excluded(monkeypatch):
    """fixture-engine-2@test.local's exact shape: one preferences doc, no
    user_profiles stamp, no subscription, no account data anywhere."""
    _wire(monkeypatch, account_data_owner=REAL_FULL)  # STRAY_PREFS_ONLY owns no account data
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert STRAY_PREFS_ONLY not in ids


def test_identity_with_no_documents_at_all_is_excluded(monkeypatch):
    """GHOST_NO_DOCS never appears in user_profiles/preferences/
    subscriptions at all, so it can't even become a candidate — and, as
    the stronger statement, account_has_data itself says False for it."""
    _wire(monkeypatch, account_data_owner=REAL_FULL)
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert GHOST_NO_DOCS not in ids

    from app.services.retention import account_has_data
    assert run(account_has_data(GHOST_NO_DOCS)) is False


def test_opted_out_real_user_still_excluded(monkeypatch):
    """B20's opt-out gate must keep holding after B24: a real user (full
    record + real account data) who turned "offers" off is still never a
    recipient, regardless of the new account-data filter."""
    _wire(monkeypatch, account_data_owner=OPTED_OUT_REAL)
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert OPTED_OUT_REAL not in ids


# ── the stray-subscription-only shape (a.odonde / ndolomeshack) ─────────

def test_stray_subscription_document_only_is_excluded(monkeypatch):
    """a.odonde@gmail.com / ndolomeshack@gmail.com's exact shape: an
    admin-granted subscriptions doc and nothing else — no user_profiles
    stamp, meaning the identity never made a single authenticated
    request. Also proves the DEFAULT_TIER fallback can't smuggle this
    identity into a tier-targeted audience either, since resolve_audience
    now requires a stored subscription doc AND real account data."""
    _wire(monkeypatch, account_data_owner=REAL_FULL)
    everyone = run(broadcast.resolve_audience({"type": "everyone"}))
    assert STRAY_SUB_ONLY not in everyone
    connect = run(broadcast.resolve_audience({"type": "tier", "tier": "connect"}))
    assert STRAY_SUB_ONLY not in connect


# ── the safety property is a DATA check, not an address/domain check ────

def test_exclusion_is_not_keyed_to_any_address_or_domain(monkeypatch):
    """The whole point of B24: whether an identity is excluded must track
    ONLY whether it owns real account data, never the shape of its email.
    REAL_ON_FIXTURE_LOOKING_DOMAIN and STRAY_PROFILE_ONLY share the exact
    same domain ("test.local") and differ ONLY in which one owns real
    account data — if the code were keyed to a domain (e.g. "exclude
    *.test.local"), both would resolve the same way. They don't: the one
    WITH data is included, the one WITHOUT it is excluded, despite the
    identical domain, which is only possible if the rule is a data check."""
    assert REAL_ON_FIXTURE_LOOKING_DOMAIN.rsplit("@", 1)[1] == STRAY_PROFILE_ONLY.rsplit("@", 1)[1]

    _wire(monkeypatch, account_data_owner=REAL_ON_FIXTURE_LOOKING_DOMAIN)
    ids = run(broadcast.resolve_audience({"type": "everyone"}))

    assert REAL_ON_FIXTURE_LOOKING_DOMAIN in ids       # has data -> included, "test.local" or not
    assert STRAY_PROFILE_ONLY not in ids               # same domain, no data -> still excluded

    # Flip which of the pair owns the data: the outcome flips WITH it,
    # never independently of it — proof the domain played no role either
    # direction.
    _wire(monkeypatch, account_data_owner=STRAY_PROFILE_ONLY)
    ids = run(broadcast.resolve_audience({"type": "everyone"}))
    assert STRAY_PROFILE_ONLY in ids
    assert REAL_ON_FIXTURE_LOOKING_DOMAIN not in ids


def test_account_data_in_any_provider_collection_is_sufficient(monkeypatch):
    """The real-account-data check must not be narrowed to one provider —
    a user who only ever gave a Finexer consent (no accounts_col row yet)
    is just as real as one with a TrueLayer account row. Parametrised over
    every name in _ACCOUNT_DATA_COLLECTIONS so this can't silently rot if
    that list changes shape."""
    for name in _ACCOUNT_DATA_COLLECTIONS:
        _wire(monkeypatch, account_data_owner=None)
        monkeypatch.setattr(db_collections_module, name, _CountableCol([{"user_id": REAL_FULL}]))
        ids = run(broadcast.resolve_audience({"type": "everyone"}))
        assert REAL_FULL in ids, f"account data in {name!r} alone should be sufficient"
