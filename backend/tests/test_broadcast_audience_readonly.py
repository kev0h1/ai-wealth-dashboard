"""B23: resolving a broadcast audience must never write to real user data.

The defect: `resolve_audience`'s "state" branch (`_matches_state`, penny_cap)
called `app.core.subscription.penny_allowance`, which runs
`_settle_packs`'s idempotent-but-WRITING past-month pack settlement
(`penny_topups_col.update_one`). Previewing an audience therefore mutated
every candidate user's top-up pack records as a side effect of merely
evaluating the filter.

Unlike tests/test_broadcast.py (which monkeypatches `penny_allowance` away
entirely, so it never covers this), this file exercises the REAL
`app.core.subscription.penny_allowance` / `settle_topups` / `_settle_packs`
chain through `resolve_audience`, with a fake `penny_topups_col` whose write
methods raise. If the fix regresses and `resolve_audience` (directly or
transitively) ever calls a write method on the packs collection again, these
tests fail loudly rather than merely failing to notice.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import app.core.llm as llm_module
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.services.broadcast as broadcast
import app.services.retention as retention_module

UID_UNSETTLED = "b23-unsettled@example.com"
UID_NO_PACKS = "b23-no-packs@example.com"


def run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


def _ym(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


# ── fakes ──────────────────────────────────────────────────────────────

class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _RaiseOnWrite:
    """Mixin: every write-shaped method records the attempt then raises,
    so a test using this fails loudly (not just quietly-passes) the
    instant resolve_audience's call chain tries to write anything."""

    def __init__(self):
        self.write_attempts: list[str] = []

    def _boom(self, name):
        self.write_attempts.append(name)
        raise AssertionError(
            f"resolve_audience must never call {name}() — previewing an "
            f"audience must be side-effect free (B23)"
        )

    async def insert_one(self, *a, **kw):
        self._boom("insert_one")

    async def insert_many(self, *a, **kw):
        self._boom("insert_many")

    async def update_one(self, *a, **kw):
        self._boom("update_one")

    async def update_many(self, *a, **kw):
        self._boom("update_many")

    async def find_one_and_update(self, *a, **kw):
        self._boom("find_one_and_update")

    async def bulk_write(self, *a, **kw):
        self._boom("bulk_write")

    async def delete_one(self, *a, **kw):
        self._boom("delete_one")

    async def delete_many(self, *a, **kw):
        self._boom("delete_many")


def _match(d, k, v):
    if isinstance(v, dict) and "$exists" in v:
        return (k in d) == v["$exists"]
    return d.get(k) == v


class RaiseOnWriteTopupsCol(_RaiseOnWrite):
    """Twin of test_penny_topup_packs.py's _FakeTopupsCol, but every write
    method raises instead of mutating — the exact collection
    `_settle_packs` writes to (penny_topups_col)."""

    def __init__(self, docs=None):
        super().__init__()
        self.docs: list[dict] = list(docs or [])

    def find(self, query=None):
        # Copy each doc out, matching real pymongo's cursor semantics (a
        # find() always deserializes a fresh dict from BSON) — this is
        # what makes "the stored doc is unchanged" a meaningful assertion
        # below, rather than an accident of Python object-identity aliasing
        # (mutating the dict _settle_packs got back from find() must NOT
        # be conflated with a write to storage).
        query = query or {}
        rows = [dict(d) for d in self.docs if all(_match(d, k, v) for k, v in query.items())]
        return _FakeCursor(rows)


class RaiseOnWriteGenericCol(_RaiseOnWrite):
    """Same idea for the plain user_profiles/preferences/subscriptions
    collections _all_user_ids reads — resolve_audience must never write to
    any of them either, even though today's code never tries to."""

    def __init__(self, docs=None):
        super().__init__()
        self.docs = list(docs or [])

    def find(self, query=None, projection=None):
        query = query or {}
        rows = [d for d in self.docs if all(_match(d, k, v) for k, v in query.items())]
        if projection:
            rows = [{k: d.get(k) for k, want in projection.items() if want} for d in rows]
        return _FakeCursor(rows)

    async def find_one(self, query=None, projection=None):
        query = query or {}
        for d in self.docs:
            if all(_match(d, k, v) for k, v in query.items()):
                return dict(d)
        return None


class _FakeLlmUsageCol(_RaiseOnWrite):
    """Read side matches test_penny_topup_packs.py's own fake; writes
    raise, same as the collections above — resolve_audience has no
    business recording LLM usage either."""

    def __init__(self, docs=None):
        super().__init__()
        self.docs: list[dict] = list(docs or [])

    async def create_index(self, *a, **kw):
        pass

    def aggregate(self, pipeline):
        match = pipeline[0]["$match"]
        rows = [d for d in self.docs if all(d.get(k) == v for k, v in match.items())]
        by_pipeline: dict[str, list[dict]] = {}
        for d in rows:
            by_pipeline.setdefault(d["pipeline"], []).append(d)
        out = []
        for pname, ds in by_pipeline.items():
            out.append({
                "_id": pname, "calls": len(ds),
                "cost_usd": sum(d.get("cost_usd") or 0.0 for d in ds),
                "prompt_tokens": sum(d.get("prompt_tokens") or 0 for d in ds),
                "cached_tokens": sum(d.get("cached_tokens") or 0 for d in ds),
                "completion_tokens": sum(d.get("completion_tokens") or 0 for d in ds),
            })
        return _FakeCursor(out)

    async def distinct(self, field, match):
        rows = [d for d in self.docs if all(
            (d.get(k) == v) if k != "message_id" else (d.get(k) is not None)
            for k, v in match.items()
        )]
        return sorted({d[field] for d in rows if d.get(field) is not None})


def _messages(uid, ym, n):
    return [
        {
            "user_id": uid, "pipeline": "penny", "year_month": ym, "message_id": f"m{ym}-{i}",
            "cost_usd": 0.0, "prompt_tokens": 0, "completion_tokens": 0, "cached_tokens": 0,
        }
        for i in range(n)
    ]


def _pack(uid, *, pack_id="medium", messages=100, remaining, purchased_at, year_month,
          expires_at=None, settled_months=None):
    return {
        "_id": f"{pack_id}-{purchased_at.isoformat()}",
        "user_id": uid,
        "pack_id": pack_id,
        "messages": messages,
        "remaining": remaining,
        "price_gbp": 2.99,
        "purchased_at": purchased_at,
        "expires_at": purchased_at + timedelta(days=90) if expires_at is None else expires_at,
        "year_month": year_month,
        "source": "purchase",
        "settled_months": settled_months or [],
    }


class _FakeStandardSub:
    """Standard tier: 150 penny messages/month, matching TIER_LIMITS."""
    tier_name = "standard"
    status = "active"

    def limit(self, key):
        assert key == "penny_messages_per_month"
        return 150


def _wire_real_chain(monkeypatch, *, packs_col, llm_col, candidates):
    """Point resolve_audience at the REAL app.core.subscription.penny_allowance
    (not monkeypatched away, unlike test_broadcast.py) so this test actually
    exercises the code path that used to write."""
    async def fake_get_subscription(email):
        return _FakeStandardSub()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)
    monkeypatch.setattr(db_collections_module, "penny_topups_col", packs_col)
    monkeypatch.setattr(llm_module, "llm_usage_col", llm_col)

    monkeypatch.setattr(broadcast, "user_profiles_col", RaiseOnWriteGenericCol([{"_id": u} for u in candidates]))
    monkeypatch.setattr(broadcast, "preferences_col", RaiseOnWriteGenericCol([]))
    monkeypatch.setattr(broadcast, "subscriptions_col", RaiseOnWriteGenericCol([]))

    async def fake_notif_pref(user_id, key):
        assert key == "offers"
        return True  # nobody opted out in this fixture
    monkeypatch.setattr(broadcast, "notif_pref", fake_notif_pref)

    # B24: _real_user_ids() calls account_has_data per candidate — this
    # file is specifically about the "state" filter's real penny_allowance
    # chain, not B24's audience-narrowing, so every candidate here is
    # faked as a real account (has data) to keep this test's own scenario
    # (an unsettled top-up pack) reachable at all.
    async def fake_account_has_data(uid):
        return uid in candidates
    monkeypatch.setattr(retention_module, "account_has_data", fake_account_has_data)


# ── the structural guarantee ──────────────────────────────────────────

def test_resolve_audience_state_filter_performs_no_writes_even_with_unsettled_overflow(monkeypatch):
    """The exact scenario B20's agent disclosed: a candidate user has an
    unsettled past-month overflow, which the OLD code's penny_allowance
    call would have settled (i.e. written) as a side effect of resolving
    the audience. With the fix, resolving the same audience must complete
    successfully and must never call a write method on penny_topups_col —
    proven structurally: the fake raises AssertionError from every write
    method, so any write blows up the test rather than passing quietly."""
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)
    this_ym = _ym(now)

    # Unsettled: last month's 250 messages against a 150 allowance is 100
    # overflow, and this pack (remaining=30) has never had that month
    # settled onto it (settled_months=[]) — persist=True would draw it
    # down to 0 and write settled_months=[last_ym].
    pack = _pack(
        UID_UNSETTLED, remaining=30,
        purchased_at=last_month_start, year_month=last_ym,
    )
    packs_col = RaiseOnWriteTopupsCol([pack])
    llm_col = _FakeLlmUsageCol(_messages(UID_UNSETTLED, last_ym, 250) + _messages(UID_UNSETTLED, this_ym, 175))

    _wire_real_chain(monkeypatch, packs_col=packs_col, llm_col=llm_col, candidates=[UID_UNSETTLED])

    ids = run(broadcast.resolve_audience({"type": "state", "state": "penny_cap"}))

    # Correctness: still resolves this user as being at the cap (see the
    # settled-vs-unsettled test below for why this number specifically).
    assert ids == [UID_UNSETTLED]

    # No write was attempted on the collection _settle_packs used to write
    # to, and the stored doc is byte-for-byte unchanged from what was
    # seeded — the strongest "how do I know nothing wrote" evidence: the
    # object identity/content never moved.
    assert packs_col.write_attempts == []
    assert packs_col.docs[0]["remaining"] == 30
    assert packs_col.docs[0]["settled_months"] == []


def test_resolve_audience_no_packs_user_performs_no_writes(monkeypatch):
    """A candidate with no top-up packs at all (the common case) never
    even reaches a write attempt in the old code either (_settle_packs
    returns early when there are no packs) — covered here so the "no
    writes" guarantee holds independent of whether packs exist."""
    now = _now()
    this_ym = _ym(now)
    packs_col = RaiseOnWriteTopupsCol([])
    # 200 messages this month against a 150 tier limit, no packs -> at cap.
    llm_col = _FakeLlmUsageCol(_messages(UID_NO_PACKS, this_ym, 200))

    _wire_real_chain(monkeypatch, packs_col=packs_col, llm_col=llm_col, candidates=[UID_NO_PACKS])

    ids = run(broadcast.resolve_audience({"type": "state", "state": "penny_cap"}))
    assert ids == [UID_NO_PACKS]
    assert packs_col.write_attempts == []


# ── settled vs unsettled: the preview must use the truthful number ──────

def test_penny_cap_reflects_settled_not_raw_stored_remaining(monkeypatch):
    """Direct unit test of the divergence step 3 of the ticket asks about.

    With the SAME fixture as the structural test above: the raw, never-
    settled `remaining` stored on the pack is 30. If a read-only
    implementation naively used that stored value without running the
    settlement arithmetic (option B from the ticket, "resolve from stored
    fields"), it would compute topup_messages=30, limit=180,
    remaining=180-175=5 -> NOT at cap. That is wrong: once last month's
    100-message overflow is correctly attributed (even without writing
    it), the pack is fully drained (remaining settles to 0), this month's
    limit is only the bare tier limit (150), and 150-175 clamps to 0 ->
    genuinely at cap.

    penny_allowance(uid, persist=False) must return the SETTLED number (0
    remaining, at cap), matching what persist=True would also compute and
    then write — proving the preview is truthful, not stale."""
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)
    this_ym = _ym(now)

    raw_pack = _pack(UID_UNSETTLED, remaining=30, purchased_at=last_month_start, year_month=last_ym)

    async def fake_get_subscription(email):
        return _FakeStandardSub()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)

    # -- naive "just read the stored field" number, computed by hand from
    # the same raw doc, to document the divergence the ticket asks about.
    naive_topup_messages = raw_pack["remaining"]  # 30, never settled
    naive_limit = 150 + naive_topup_messages       # 180
    naive_remaining = naive_limit - 175             # 5
    assert naive_remaining > 0  # naive reading says "not at cap" — WRONG

    # -- persist=False: correct, as-if-settled, no write.
    packs_col_ro = RaiseOnWriteTopupsCol([dict(raw_pack)])
    llm_col_ro = _FakeLlmUsageCol(_messages(UID_UNSETTLED, last_ym, 250) + _messages(UID_UNSETTLED, this_ym, 175))
    monkeypatch.setattr(db_collections_module, "penny_topups_col", packs_col_ro)
    monkeypatch.setattr(llm_module, "llm_usage_col", llm_col_ro)

    allowance_ro = run(subscription_module.penny_allowance(UID_UNSETTLED, persist=False))
    assert allowance_ro["remaining"] == 0          # settled, at cap — matches truth, not the naive 5
    assert allowance_ro["topup_messages"] == 0     # pack correctly treated as drained
    assert packs_col_ro.write_attempts == []
    assert packs_col_ro.docs[0]["remaining"] == 30  # untouched in storage

    # -- persist=True (default; the user's own real check): same truthful
    # number, and this time it DOES perform the settlement write, proving
    # the ordinary path is unaffected by the B23 fix.
    class _WritableTopupsCol:
        def __init__(self, docs):
            self.docs = list(docs)

        def find(self, query=None):
            query = query or {}
            rows = [dict(d) for d in self.docs if all(_match(d, k, v) for k, v in query.items())]
            return _FakeCursor(rows)

        async def update_one(self, query, update):
            for d in self.docs:
                if all(d.get(k) == v for k, v in query.items()):
                    d.update(update.get("$set", {}))
                    return

    packs_col_rw = _WritableTopupsCol([dict(raw_pack)])
    llm_col_rw = _FakeLlmUsageCol(_messages(UID_UNSETTLED, last_ym, 250) + _messages(UID_UNSETTLED, this_ym, 175))
    monkeypatch.setattr(db_collections_module, "penny_topups_col", packs_col_rw)
    monkeypatch.setattr(llm_module, "llm_usage_col", llm_col_rw)

    allowance_rw = run(subscription_module.penny_allowance(UID_UNSETTLED, persist=True))
    assert allowance_rw["remaining"] == 0
    assert packs_col_rw.docs[0]["remaining"] == 0        # now actually settled/written
    assert packs_col_rw.docs[0]["settled_months"] == [last_ym]
