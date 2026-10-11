"""G242: aims for any category, the server pace reading, and Penny's nudge gating.

No mongomock here, so collections are tiny in-memory fakes (the same
convention as test_pentest_a50_cross_tenant_ownership.py). Nothing touches a
real database.
"""
import asyncio

import pytest
from bson import ObjectId

import app.services.checkpoints as svc

ME = "me@example.invalid"
OTHER = "other@example.invalid"


def _match(doc, query):
    for key, cond in query.items():
        if doc.get(key) != cond:
            return False
    return True


class _Result:
    def __init__(self, n):
        self.modified_count = n


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs)


class FakeCol:
    def __init__(self, docs):
        self.docs = list(docs)

    async def find_one(self, query, projection=None):
        for d in self.docs:
            if _match(d, query):
                return d
        return None

    def find(self, query, projection=None):
        return _Cursor([d for d in self.docs if _match(d, query)])

    async def update_one(self, filt, update):
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                return _Result(1)
        return _Result(0)


# ── Pace reading ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "spent,days_left,state",
    [
        (20, 14, "under"),    # half way, £20 of £100: well under an even £50
        (50, 14, "on"),       # half way, £50 of £100: on pace
        (60, 14, "likely"),   # £120 projected at an even rate, past the 5% margin
    ],
)
def test_pace_states_basic(spent, days_left, state):
    assert svc.aim_pace(100, spent, 28, days_left)["state"] == state


def test_pace_past_when_spent_reaches_aim():
    p = svc.aim_pace(100, 122, 28, 5)
    assert p["state"] == "past"
    assert p["phrase"] == "past your aim"


def test_pace_not_projected_too_early():
    # 3 days into 28 (11%): a big first-days spend is not called "likely".
    p = svc.aim_pace(100, 40, 28, 25)
    assert p["state"] == "on"


def test_pace_likely_and_projection():
    p = svc.aim_pace(100, 96, 28, 6)  # day 22 of 28
    assert p["state"] == "likely"
    assert p["phrase"] == "likely to pass your aim"
    assert p["pace_today"] == pytest.approx(78.57, abs=0.01)  # "about £79 by today"
    assert p["projected"] == pytest.approx(122.18, abs=0.01)
    assert p["period_days"] == 28


def test_pace_on_at_the_edge():
    p = svc.aim_pace(100, 82, 28, 6)  # £82 of £100 on day 22: on pace, as the design shows
    assert p["state"] == "on"
    assert p["phrase"] == "on pace"


def test_pace_never_raises_on_odd_inputs():
    p = svc.aim_pace(0, 0, 0, 99)
    assert p["state"] in {"on", "under", "likely", "past"}


def test_progress_block_carries_pace():
    doc = {"aim_amount": 100.0, "period_start": "2026-09-28", "period_end": "2026-10-25"}
    block = svc._progress(doc, 82.0, 6, True)
    assert block["pace"]["period_days"] == 28
    assert block["spent_so_far"] == 82.0 and block["days_left"] == 6


# ── Edit, dismiss: user-scoped at the query ─────────────────────────────────

def _aim(uid=ME, ref="Eating Out", amount=100.0):
    return {"_id": ObjectId(), "user_id": uid, "ref": ref, "aim_amount": amount,
            "basis": "usual", "status": "active"}


def test_update_changes_only_own_active_aim(monkeypatch):
    mine, theirs = _aim(ME), _aim(OTHER)
    monkeypatch.setattr(svc, "checkpoints_col", FakeCol([mine, theirs]))
    assert asyncio.run(svc.update_checkpoint(OTHER, str(mine["_id"]), 80)) is False
    assert mine["aim_amount"] == 100.0
    assert asyncio.run(svc.update_checkpoint(ME, str(mine["_id"]), "80")) is True
    assert mine["aim_amount"] == 80.0 and mine["basis"] == "custom"
    assert theirs["aim_amount"] == 100.0


@pytest.mark.parametrize("bad", [0, -5, "abc", None, 2_000_000])
def test_update_rejects_bad_amounts(monkeypatch, bad):
    mine = _aim()
    monkeypatch.setattr(svc, "checkpoints_col", FakeCol([mine]))
    with pytest.raises(ValueError):
        asyncio.run(svc.update_checkpoint(ME, str(mine["_id"]), bad))
    assert mine["aim_amount"] == 100.0


def test_update_clears_a_dismissed_nudge(monkeypatch):
    mine = _aim()
    mine["nudge_dismissed"] = True
    monkeypatch.setattr(svc, "checkpoints_col", FakeCol([mine]))
    asyncio.run(svc.update_checkpoint(ME, str(mine["_id"]), 90))
    assert mine["nudge_dismissed"] is False


def test_dismiss_is_user_scoped(monkeypatch):
    mine = _aim(ME)
    monkeypatch.setattr(svc, "checkpoints_col", FakeCol([mine]))
    assert asyncio.run(svc.dismiss_aim_nudge(OTHER, str(mine["_id"]))) is False
    assert not mine.get("nudge_dismissed")
    assert asyncio.run(svc.dismiss_aim_nudge(ME, str(mine["_id"]))) is True
    assert mine["nudge_dismissed"] is True


# ── Nudge gating ────────────────────────────────────────────────────────────

def _served(cp_id, ref, aim, spent, days_left, period_days=28):
    return {"id": cp_id, "ref": ref, "aim_amount": aim, "spent_so_far": spent,
            "days_left": days_left, "period_start": "2026-09-28", "period_end": "2026-10-25", "pace": svc.aim_pace(aim, spent, period_days, days_left)}


def _portrait(*traits):
    return {"_id": ME, "status": "ok", "traits": list(traits)}


EAT = {"id": "signature_pleasure", "title": "Your Signature: Eating Out", "ref_category": "Eating Out", "choice": "change"}


def _nudge(monkeypatch, portrait, aims, dismissed=()):
    cps = [{"_id": ObjectId(), "user_id": ME, "status": "active", "nudge_dismissed": True, "_x": i} for i in dismissed]
    # Map dismissed served ids onto fake docs so str(_id) matches.
    for doc, cid in zip(cps, dismissed):
        doc["_id"] = ObjectId(cid)
    monkeypatch.setattr(svc, "checkpoints_col", FakeCol(cps))
    monkeypatch.setattr(svc, "behaviour_portrait_col", FakeCol([portrait] if portrait else []))
    return asyncio.run(svc.get_aim_nudge(ME, aims=aims))


def test_nudge_fires_for_change_trait_when_likely(monkeypatch):
    cid = str(ObjectId())
    n = _nudge(monkeypatch, _portrait(EAT), [_served(cid, "Eating Out", 100, 96, 6)])
    assert n["category"] == "Eating Out"
    assert n["trait_title"] == "Your Signature: Eating Out"
    assert n["id"] == cid and n["projected"] > 100
    assert (n["period_start"], n["period_end"]) == ("2026-09-28", "2026-10-25")


def test_nudge_needs_consent_keep_unanswered_and_missing_portrait(monkeypatch):
    aims = [_served(str(ObjectId()), "Eating Out", 100, 96, 6)]
    assert _nudge(monkeypatch, _portrait({**EAT, "choice": "keep"}), aims) is None
    assert _nudge(monkeypatch, _portrait({**EAT, "choice": None}), aims) is None
    assert _nudge(monkeypatch, None, aims) is None
    assert _nudge(monkeypatch, {"_id": ME, "status": "insufficient_data"}, aims) is None


def test_nudge_only_for_the_trait_category(monkeypatch):
    aims = [_served(str(ObjectId()), "Groceries", 100, 96, 6)]
    assert _nudge(monkeypatch, _portrait(EAT), aims) is None


def test_nudge_needs_a_likely_pace_not_on_pace_or_past(monkeypatch):
    assert _nudge(monkeypatch, _portrait(EAT), [_served(str(ObjectId()), "Eating Out", 100, 82, 6)]) is None
    assert _nudge(monkeypatch, _portrait(EAT), [_served(str(ObjectId()), "Eating Out", 100, 122, 6)]) is None


def test_nudge_falls_back_to_signature_title(monkeypatch):
    old = {"id": "signature_pleasure", "title": "Your Signature: Eating Out", "choice": "change"}
    aims = [_served(str(ObjectId()), "Eating Out", 100, 96, 6)]
    assert _nudge(monkeypatch, _portrait(old), aims)["category"] == "Eating Out"


def test_nudge_one_at_a_time_picks_the_furthest_past(monkeypatch):
    groc = {"id": "g", "title": "Groceries trait", "ref_category": "Groceries", "choice": "change"}
    a = _served(str(ObjectId()), "Eating Out", 100, 96, 6)
    b = _served(str(ObjectId()), "Groceries", 200, 190, 6)
    n = _nudge(monkeypatch, _portrait(EAT, groc), [a, b])
    ratio = lambda x: x["pace"]["projected"] / x["aim_amount"]
    expected = max((a, b), key=ratio)
    assert n["id"] == expected["id"]


def test_dismissed_nudge_stays_quiet(monkeypatch):
    cid = str(ObjectId())
    assert _nudge(monkeypatch, _portrait(EAT), [_served(cid, "Eating Out", 100, 96, 6)], dismissed=[cid]) is None


# ── Erase and export: aims live on the existing checkpoints document ────────

def test_aims_and_the_nudge_flag_ride_the_erased_collection():
    """G242 added a field (nudge_dismissed) and no collection. The aim, its
    amount and the dismissed flag are all on the checkpoints document, which
    the erasure manifest already covers, and the Mirror choice lives on the
    behaviour portrait document, also covered."""
    from app.db import collections
    assert {"checkpoints_col", "behaviour_portrait_col"} <= set(collections.ERASURE_MANIFEST)


# ── HTTP level: another user's id is a 404, never a 403 ─────────────────────

def _client(monkeypatch, docs):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import app.routers.checkpoints as router_mod
    from app.core.auth import current_user

    monkeypatch.setattr(svc, "checkpoints_col", FakeCol(docs))
    monkeypatch.setattr(router_mod.response_cache, "invalidate", lambda uid: None)
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[current_user] = lambda: {"email": OTHER}
    return TestClient(app)


def test_http_patch_and_dismiss_on_another_users_aim_are_404(monkeypatch):
    mine = _aim(ME)
    c = _client(monkeypatch, [mine])
    r = c.patch(f"/checkpoints/{mine['_id']}", json={"aim_amount": 50})
    assert r.status_code == 404
    r = c.post(f"/checkpoints/{mine['_id']}/nudge-dismiss")
    assert r.status_code == 404
    assert mine["aim_amount"] == 100.0 and not mine.get("nudge_dismissed")
