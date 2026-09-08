"""B11 (docs/pricing/tiering-unit-economics-mcp-2026-09.md section 9): three
Penny top-up packs replacing the single £2.99/100-message row, each lasting
90 days from purchase and drawing down only after the tier's own monthly
allowance is used up.

Covers: app.core.subscription.penny_allowance / settle_topups (active pack
folded into `limit`, expired pack ignored, past-month overflow settled onto
the oldest covering pack exactly once and idempotently on re-run,
packs_bought_this_month), app.main._migrate_penny_topup_packs (legacy doc
backfill), and GET /subscription's payload shape.

Fakes `penny_topups_col`/`llm_usage_col` the same way test_penny_chips.py
does (no real Mongo) — `_FakeTopupsCol` here additionally supports
`update_one` since settle_topups persists pack draw-downs."""
import asyncio
from datetime import datetime, timedelta, timezone

import app.core.llm as llm_module
import app.core.subscription as subscription_module
import app.db.collections as db_collections_module
import app.routers.subscription as subscription_router_module

UID = "penny-topup-packs-test@example.com"


def _run(coro):
    return asyncio.run(coro)


def _now():
    return datetime.now(timezone.utc)


def _ym(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for d in self._docs:
            yield d


class _FakeLlmUsageCol:
    """Twin of test_penny_chips.py's own fixture — aggregate/distinct only,
    enough for app.core.llm.monthly_usage's shape."""

    def __init__(self, docs=None):
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


class _FakeTopupsCol:
    def __init__(self, docs=None):
        self.docs: list[dict] = list(docs or [])
        self._n = 0

    def find(self, query=None):
        query = query or {}

        def _match(d, k, v):
            if isinstance(v, dict) and "$exists" in v:
                return (k in d) == v["$exists"]
            return d.get(k) == v

        rows = [d for d in self.docs if all(_match(d, k, v) for k, v in query.items())]
        return _FakeCursor(rows)

    async def insert_one(self, doc):
        doc.setdefault("_id", f"pack-{self._n}")
        self._n += 1
        self.docs.append(doc)
        return doc

    async def update_one(self, query, update):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                d.update(update.get("$set", {}))
                return


class _FakeStandardSub:
    """Standard tier: 150 penny messages/month, matching TIER_LIMITS."""
    tier_name = "standard"
    tier = subscription_module.Tier.STANDARD
    status = "active"

    def limit(self, key):
        assert key == "penny_messages_per_month"
        return 150


def _pack(uid, *, pack_id="medium", messages=100, remaining=None, purchased_at=None,
          expires_at=None, year_month=None, source="purchase", settled_months=None):
    purchased_at = purchased_at or _now()
    return {
        "_id": f"{pack_id}-{purchased_at.isoformat()}",
        "user_id": uid,
        "pack_id": pack_id,
        "messages": messages,
        "remaining": messages if remaining is None else remaining,
        "price_gbp": 2.99,
        "purchased_at": purchased_at,
        "expires_at": purchased_at + timedelta(days=90) if expires_at is None else expires_at,
        "year_month": year_month or _ym(purchased_at),
        "source": source,
        "settled_months": settled_months or [],
    }


def _patch(monkeypatch, *, used_this_month=0, packs=None, sub=None):
    now = _now()
    ym = _ym(now)

    async def fake_get_subscription(email):
        return sub or _FakeStandardSub()
    monkeypatch.setattr(subscription_module, "get_subscription", fake_get_subscription)

    fake_llm = _FakeLlmUsageCol(_messages(UID, ym, used_this_month))
    monkeypatch.setattr(llm_module, "llm_usage_col", fake_llm)

    fake_topups = _FakeTopupsCol(packs or [])
    monkeypatch.setattr(db_collections_module, "penny_topups_col", fake_topups)
    return fake_topups, fake_llm


# ── 1. Active pack folds into this month's limit ────────────────────────

def test_active_pack_adds_its_remaining_to_the_limit(monkeypatch):
    now = _now()
    pack = _pack(UID, remaining=80, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=10, packs=[pack])

    allowance = _run(subscription_module.penny_allowance(UID))
    assert allowance["limit"] == 150 + 80
    assert allowance["topup_messages"] == 80
    assert allowance["used"] == 10
    assert allowance["remaining"] == 150 + 80 - 10


# ── 2. Expired pack is ignored ───────────────────────────────────────────

def test_expired_pack_does_not_count(monkeypatch):
    now = _now()
    old = _pack(
        UID, remaining=50,
        purchased_at=now - timedelta(days=200),
        expires_at=now - timedelta(days=110),
        year_month=_ym(now - timedelta(days=200)),
    )
    _patch(monkeypatch, used_this_month=5, packs=[old])

    allowance = _run(subscription_module.penny_allowance(UID))
    assert allowance["topup_messages"] == 0
    assert allowance["limit"] == 150
    assert allowance["topup_expires_soonest"] is None


# ── 3. Past-month overflow settles onto the oldest covering pack once ───

def test_past_month_overflow_settles_onto_oldest_pack_and_is_idempotent(monkeypatch):
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)

    pack = _pack(UID, remaining=100, purchased_at=last_month_start, year_month=last_ym)
    fake_topups, fake_llm = _patch(monkeypatch, used_this_month=0, packs=[pack])
    # Last month: 170 used against a 150 allowance -> 20 overflow, drawn from
    # the pack (still has all 100 remaining at this point).
    fake_llm.docs.extend(_messages(UID, last_ym, 170))

    allowance = _run(subscription_module.penny_allowance(UID))
    assert fake_topups.docs[0]["remaining"] == 80  # 100 - 20 overflow
    assert last_ym in fake_topups.docs[0]["settled_months"]
    assert allowance["topup_messages"] == 80  # this month's active balance

    # Re-running (e.g. a second penny_allowance call, or the nightly cron)
    # must not draw down the same month's overflow twice.
    _run(subscription_module.penny_allowance(UID))
    assert fake_topups.docs[0]["remaining"] == 80


def test_past_month_overflow_only_settles_up_to_pack_remaining(monkeypatch):
    now = _now()
    last_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    last_ym = _ym(last_month_start)

    pack = _pack(UID, remaining=10, purchased_at=last_month_start, year_month=last_ym)
    fake_topups, fake_llm = _patch(monkeypatch, used_this_month=0, packs=[pack])
    # 200 used last month against 150 allowance -> 50 overflow, but the pack
    # only has 10 left -> settles to 0, never negative.
    fake_llm.docs.extend(_messages(UID, last_ym, 200))

    _run(subscription_module.penny_allowance(UID))
    assert fake_topups.docs[0]["remaining"] == 0
    assert last_ym in fake_topups.docs[0]["settled_months"]


# ── 4. packs_bought_this_month ───────────────────────────────────────────

def test_packs_bought_this_month_counts_current_month_purchases(monkeypatch):
    now = _now()
    ym = _ym(now)
    p1 = _pack(UID, pack_id="small", remaining=15, purchased_at=now, year_month=ym)
    p2 = _pack(UID, pack_id="large", remaining=190, purchased_at=now, year_month=ym)
    old = _pack(
        UID, pack_id="medium", remaining=0,
        purchased_at=now - timedelta(days=95),
        expires_at=now - timedelta(days=5),
        year_month=_ym(now - timedelta(days=95)),
    )
    _patch(monkeypatch, used_this_month=0, packs=[p1, p2, old])

    allowance = _run(subscription_module.penny_allowance(UID))
    assert allowance["packs_bought_this_month"] == 2


def test_topup_expires_soonest_reports_earliest_active_expiry(monkeypatch):
    now = _now()
    soon = _pack(UID, remaining=5, purchased_at=now - timedelta(days=85), year_month=_ym(now - timedelta(days=85)))
    later = _pack(UID, remaining=5, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=0, packs=[soon, later])

    allowance = _run(subscription_module.penny_allowance(UID))
    assert allowance["topup_expires_soonest"] == soon["expires_at"].date().isoformat()


# ── 5. Legacy doc migration (app.main._migrate_penny_topup_packs) ───────

def test_migration_backfills_legacy_topup_doc(monkeypatch):
    from bson import ObjectId
    import app.main as main_module

    oid = ObjectId.from_datetime(datetime(2026, 6, 1, tzinfo=timezone.utc))
    legacy_doc = {
        "_id": oid,
        "user_id": UID,
        "year_month": "2026-06",
        "messages": 100,
        "source": "admin",
        "purchased_at": datetime(2026, 6, 1, tzinfo=timezone.utc),
    }
    fake_topups = _FakeTopupsCol([legacy_doc])
    monkeypatch.setattr(db_collections_module, "penny_topups_col", fake_topups)

    _run(main_module._migrate_penny_topup_packs())

    doc = fake_topups.docs[0]
    assert doc["remaining"] == 100
    assert doc["pack_id"] == "admin"
    assert doc["expires_at"] == doc["purchased_at"] + timedelta(days=90)
    assert doc["settled_months"] == []

    # Idempotent: a second pass finds nothing missing `expires_at` left.
    before = dict(doc)
    _run(main_module._migrate_penny_topup_packs())
    assert fake_topups.docs[0] == before


def test_migration_falls_back_to_objectid_generation_time_when_purchased_at_missing(monkeypatch):
    from bson import ObjectId
    import app.main as main_module

    oid = ObjectId.from_datetime(datetime(2026, 5, 1, tzinfo=timezone.utc))
    legacy_doc = {"_id": oid, "user_id": UID, "year_month": "2026-05", "messages": 20, "source": "purchase"}
    fake_topups = _FakeTopupsCol([legacy_doc])
    monkeypatch.setattr(db_collections_module, "penny_topups_col", fake_topups)

    _run(main_module._migrate_penny_topup_packs())

    doc = fake_topups.docs[0]
    assert doc["purchased_at"] == oid.generation_time
    assert doc["expires_at"] == oid.generation_time + timedelta(days=90)
    assert doc["pack_id"] == "legacy"


# ── 6. GET /subscription payload shape ──────────────────────────────────

def test_get_subscription_serves_packs_and_new_usage_fields(monkeypatch):
    now = _now()
    pack = _pack(UID, remaining=40, purchased_at=now, year_month=_ym(now))
    _patch(monkeypatch, used_this_month=5, packs=[pack])
    monkeypatch.setattr(subscription_router_module, "get_subscription", lambda email: _async(_FakeStandardSub()))

    result = _run(subscription_router_module.get_subscription_info({"email": UID}))

    assert result["topup"] == {"messages": 100, "price_gbp": 2.99}
    assert result["topups"] == [
        {"id": "small", "messages": 20, "price_gbp": 0.99, "badge": None},
        {"id": "medium", "messages": 100, "price_gbp": 2.99, "badge": "Most popular"},
        {"id": "large", "messages": 200, "price_gbp": 4.99, "badge": "Best value"},
    ]
    usage = result["usage"]
    assert usage["penny_limit"] == 150 + 40
    assert usage["penny_topup_messages"] == 40
    assert usage["penny_packs_bought_this_month"] == 1
    assert usage["penny_topup_expires_soonest"] == pack["expires_at"].date().isoformat()


async def _async(value):
    return value
