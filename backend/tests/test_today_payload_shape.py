"""G148: the warm-up and the route must build `GET /today` the SAME way.

The bug, verified live on UAT on 2026-09-23 against Kevin's own user before
this fix: the persisted `today` response-cache entry written that morning at
06:00:38 (version 937, day 2026-09-23, so valid by every one of
response_cache's own freshness checks) had a payload whose top-level keys
were exactly `['items', 'status']`. No `account_eligibility`.

`app.routers.companion.get_today` returns a cache hit verbatim, BEFORE it
computes anything, so every Home load served by that entry received a
payload with no per-account eligibility at all. On the client that is
indistinguishable from a request that never happened
(`bestSpendAccount(undefined, ...)` -> `unavailable`), and `unavailable` was
the one state the Safe-to-Spend card rendered as nothing. Kevin therefore
saw "Safe to Spend, Tight" with no spend-from rail and no fallback line,
while a live compute of the very same engine returned 13 eligible accounts.

The drift was in `app.services.warmup._compute_today`, which built its own
payload literal (`{"status": "ok", "items": items}`) instead of calling the
route's builder. G110 added `account_eligibility` to the route in September
and nobody added it to the warm-up copy, so every worker sync wrote a
shape-broken entry that the route then served for up to the rest of that
data version's life.

The class fix is that there is now exactly ONE definition of this payload,
`app.routers.companion.build_today_payload`, and both callers use it, the
same reason `build_safe_to_spend_response` was extracted out of
`app.routers.analytics` for `_compute_safe_to_spend` to share (see
warmup.py's own docstring). These tests pin that: not "the warm-up happens
to include the field today", but "the two call sites produce the identical
payload shape, by construction".
"""
import asyncio

import app.routers.companion as companion_router
import app.services.companion as companion_service
import app.services.warmup as warmup

UID = "kevin@example.com"

ITEMS = [{"id": "move-1", "type": "move", "headline": "Move £20"}]
ELIGIBILITY = {
    "acc-1": {"short": False, "headroom": 74.85, "spend_from_headroom": 74.85},
    "acc-2": {"short": False, "headroom": 69.74, "spend_from_headroom": 49.74},
    "acc-3": {"short": True, "headroom": -2.5, "spend_from_headroom": -2.5},
}


def _stub_engine(monkeypatch):
    """Replace `compute_today_items` everywhere either call site can reach it.

    Patched at BOTH the service module (`warmup._compute_today`'s own
    `from app.services.companion import compute_today_items`, the pre-fix
    path) and the router module (where `build_today_payload` resolves the
    name at call time, the post-fix path), so this file's red run against
    the broken code and its green run against the fix both exercise a real
    stub rather than one of them silently hitting the database.
    """
    async def compute(uid, payday_preview=False, persist=True, account_eligibility_out=None):
        assert uid == UID
        if account_eligibility_out is not None:
            account_eligibility_out.update(ELIGIBILITY)
        return [dict(item) for item in ITEMS]

    monkeypatch.setattr(companion_service, "compute_today_items", compute)
    monkeypatch.setattr(companion_router, "compute_today_items", compute)


def test_warm_up_today_payload_carries_account_eligibility(monkeypatch):
    """The exact live defect, as one assertion.

    A warm-up payload without this key is what got persisted and served; a
    client reading it cannot tell "no accounts have spare" from "the field
    never arrived".
    """
    _stub_engine(monkeypatch)

    payload = asyncio.run(warmup._compute_today(UID))

    assert "account_eligibility" in payload, (
        "the warm-up's today payload dropped account_eligibility, so every "
        "Home load served from the warmed cache loses the spend-from rail"
    )
    assert payload["account_eligibility"] == ELIGIBILITY


def test_warm_up_and_route_build_the_identical_today_payload(monkeypatch):
    """Not just 'both have the field' — both produce the SAME payload.

    This is the assertion that survives the next field being added: a second
    payload literal anywhere is a drift the one shared builder cannot have.
    """
    _stub_engine(monkeypatch)

    warmed = asyncio.run(warmup._compute_today(UID))
    built = asyncio.run(companion_router.build_today_payload(UID))

    assert warmed == built
    assert sorted(warmed.keys()) == ["account_eligibility", "items", "status"]


def test_route_payload_builder_is_the_single_definition(monkeypatch):
    """`build_today_payload` is what the route itself returns on a cache miss.

    Pinned so the route cannot quietly grow its own second literal again
    while the warm-up keeps calling the shared builder (the same drift in
    the other direction).
    """
    _stub_engine(monkeypatch)

    import app.services.response_cache as response_cache

    async def aget(name, uid, ttl=None):
        return None

    puts = []

    async def aput(name, uid, payload, *, version):
        puts.append((name, uid, payload))

    async def snapshot(uid):
        return 1

    monkeypatch.setattr(response_cache, "aget", aget)
    monkeypatch.setattr(response_cache, "aput", aput)
    monkeypatch.setattr(response_cache, "snapshot", snapshot)

    served = asyncio.run(companion_router.get_today(0, {"email": UID}))
    built = asyncio.run(companion_router.build_today_payload(UID))

    assert served == built
    assert puts and puts[0][2] == built, (
        "the payload written to the response cache must be the same one the "
        "route returns, or the next reader gets a different shape"
    )


def test_preview_today_payload_also_carries_eligibility(monkeypatch):
    """`payday_preview=1` is a QA look at the same card, not a second shape."""
    _stub_engine(monkeypatch)

    payload = asyncio.run(companion_router.build_today_payload(UID, payday_preview=True))

    assert sorted(payload.keys()) == ["account_eligibility", "items", "status"]
