"""G469 (Kevin 2026-11-14): transfer matching must not stall once the AI matcher's monthly
cap is reached. The paid model is ALWAYS faked (`ModelMock`); every name and amount is
invented."""
import json
from datetime import datetime, timedelta

import app.routers.analytics as analytics
import app.routers.ops_people as people
import app.services.categorisation as categorisation
import app.services.own_transfer_judge as judge
from test_e12_people_http import ALICE, _bearer, world  # noqa: F401  (world is a fixture)
from test_g442_ai_transfer_judgement import (
    UID, ModelMock, _arun, _async, _row, mongo_env,
)

ORIG_ENRICH = people._enrich  # before any fixture patches it
D0 = datetime(2026, 11, 3, 10, 0)


def _named_pair(tag, amount, when):
    """A pair the model judges: the user's name on both legs, the same London day."""
    return [
        _row(f"{tag}-d", "debit", amount, "barc", when, "JORDAN HARTLEY HSBC STO"),
        _row(f"{tag}-c", "credit", amount, "hsbc", when + timedelta(hours=1), "HARTLEY J E HSBC"),
    ]


def _amounts(mock):
    return [json.loads(line)["amount"] for p in mock.calls for line in p.split("Pairs:\n", 1)[1].splitlines()]


def test_capped_month_still_offers_an_unnamed_same_day_current_pair(monkeypatch):
    """The cap is spent: the judge sends nothing, yet the plain same-day pair is a question."""
    rows = [
        _row("p-d", "debit", 68.4, "barc", D0, "ZQX OUTGOING 8841"),
        _row("p-c", "credit", 68.4, "hsbc", D0 + timedelta(hours=2), "PLAIN INBOUND"),
    ]
    mock = ModelMock()
    monkeypatch.setattr(judge, "_call_model", mock)
    monkeypatch.setenv("OWN_TRANSFER_JUDGE_MONTHLY_PAIR_CAP", "5")

    async def run():
        async with mongo_env(monkeypatch, rows) as cols:
            await judge._count_sent(UID, 5)  # the month's cap is already spent
            result = await judge.judge_user(UID)
            assert result["status"] == "capped" and result["judged"] == 0
            assert mock.calls == []
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            items = await analytics._transfer_pair_suggestions(UID)
            assert [(i["credit"]["id"], i["debit"]["id"]) for i in items] == [("p-c", "p-d")]
            # an ask, never automatic: nothing was filed
            assert not await cols["transactions"].count_documents({"own_transfer_match": {"$exists": True}})
    _arun(run())


def test_unnamed_pair_on_different_days_or_a_savings_leg_is_not_offered(monkeypatch):
    rows = [
        _row("a-d", "debit", 68.4, "barc", D0, "ZQX OUTGOING 8841"),
        _row("a-c", "credit", 68.4, "hsbc", D0 + timedelta(days=2), "PLAIN INBOUND"),
    ]
    monkeypatch.setattr(judge, "_call_model", ModelMock())

    async def run():
        async with mongo_env(monkeypatch, rows) as cols:
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert await analytics._transfer_pair_suggestions(UID) == []
            await cols["accounts"].update_one({"_id": "hsbc"}, {"$set": {"type": "savings"}})
            await cols["transactions"].update_one({"_id": "a-c"}, {"$set": {"date": D0 + timedelta(hours=1)}})
            identity = await categorisation.user_identity(UID)
            monkeypatch.setattr(analytics, "user_identity", lambda uid: _async(identity))
            assert await analytics._transfer_pair_suggestions(UID) == []
    _arun(run())


def test_a_rerun_with_unchanged_pairs_sends_nothing_and_counts_nothing(monkeypatch):
    mock = ModelMock("not_transfer")
    monkeypatch.setattr(judge, "_call_model", mock)

    async def run():
        async with mongo_env(monkeypatch, _named_pair("x", 41.0, D0) + _named_pair("y", 42.0, D0)) as cols:
            first = await judge.judge_user(UID)
            assert first["judged"] == 2
            sent = await judge.pairs_sent_this_month(UID)
            assert sent == 2 and len(mock.calls) == 1
            await judge.judge_user(UID)
            assert len(mock.calls) == 1 and await judge.pairs_sent_this_month(UID) == sent
            # a prompt version bump alone keeps every verdict valid
            monkeypatch.setattr(judge, "PROMPT_VERSION", judge.PROMPT_VERSION + 1)
            await judge.judge_user(UID)
            assert len(mock.calls) == 1 and await judge.pairs_sent_this_month(UID) == sent
            # renaming an account is not a changed pair
            await cols["accounts"].update_one({"_id": "hsbc"}, {"$set": {"name": "Renamed pot"}})
            await judge.judge_user(UID)
            assert len(mock.calls) == 1 and await judge.pairs_sent_this_month(UID) == sent
            # a bank amendment IS a changed pair and is judged again
            await cols["transactions"].update_one({"_id": "x-c"}, {"$set": {"description": "HARTLEY J E HSBC AMENDED"}})
            await judge.judge_user(UID)
            assert len(mock.calls) == 2 and await judge.pairs_sent_this_month(UID) == sent + 1
    _arun(run())


def test_old_version_verdicts_are_rejudged_only_when_the_floor_is_raised(monkeypatch):
    mock = ModelMock("not_transfer")
    monkeypatch.setattr(judge, "_call_model", mock)

    async def run():
        async with mongo_env(monkeypatch, _named_pair("x", 41.0, D0)) as cols:
            await judge.judge_user(UID)
            await cols["own_transfer_judgements"].update_many({"kind": "pair"}, {"$set": {"prompt_version": 1}})
            await judge.judge_user(UID)
            assert len(mock.calls) == 2  # below the floor: judged once more
    _arun(run())


def test_newest_pairs_are_judged_first_under_the_run_limit(monkeypatch):
    mock = ModelMock("not_transfer")
    monkeypatch.setattr(judge, "_call_model", mock)
    rows = []
    for i, amount in enumerate((11.0, 12.0, 13.0, 14.0, 15.0)):  # 11 is the oldest, 15 the newest
        rows += _named_pair(f"n{i}", amount, D0 + timedelta(days=i))

    async def run():
        async with mongo_env(monkeypatch, rows):
            result = await judge.judge_user(UID, max_pairs=2)
            assert result["judged"] == 2 and result["skipped_run_limit"] == 3
            assert sorted(_amounts(mock)) == ["14.00", "15.00"]
    _arun(run())


def test_newest_by_leg_instant_uses_first_seen(monkeypatch):
    """Pair A is booked later but was first seen earlier, so its instant is older than pair B's."""
    mock = ModelMock("not_transfer")
    monkeypatch.setattr(judge, "_call_model", mock)
    rows = _named_pair("a", 21.0, D0 + timedelta(days=5))
    for r in rows:
        r["first_seen"] = D0
    rows += _named_pair("b", 22.0, D0 + timedelta(days=2))

    async def run():
        async with mongo_env(monkeypatch, rows):
            await judge.judge_user(UID, max_pairs=1)
            assert _amounts(mock) == ["22.00"]
    _arun(run())


def test_matcher_state_is_counts_and_dates_only(monkeypatch):
    monkeypatch.setattr(judge, "_call_model", ModelMock("not_transfer"))
    monkeypatch.setenv("OWN_TRANSFER_JUDGE_MONTHLY_PAIR_CAP", "1")

    async def run():
        async with mongo_env(monkeypatch, _named_pair("x", 41.0, D0) + _named_pair("y", 42.0, D0)):
            await judge.judge_user(UID)  # one sent (cap 1), one waiting
            state = await judge.matcher_state(UID)
            assert state["sent_this_month"] == 1 and state["monthly_cap"] == 1
            assert state["last_run"]["candidates"] == 2 and state["last_run"]["judged"] == 1
            assert state["last_run"]["skipped_cap"] == 1 and state["waiting"] == 1
            blob = json.dumps(state)
            assert "HARTLEY" not in blob and "x-c" not in blob and "41" not in blob
    _arun(run())


def test_ops_people_returns_the_matcher_counts_to_the_owner_only(world, monkeypatch):  # noqa: F811
    from app.core.config import PRIMARY_EMAIL
    import app.services.own_transfer_judge as j

    async def state(uid):
        return {"month": "2026-11", "sent_this_month": 7, "monthly_cap": 300, "waiting": 3,
                "last_run": {"at": "2026-11-14T09:00:00", "status": "capped", "candidates": 3, "judged": 0,
                             "skipped_cap": 3, "skipped_run_limit": 0, "skipped_attempts": 0, "errors": 0,
                             "stale": 0, "prompt_version": 2}}

    async def enrich(uid, now):
        return await ORIG_ENRICH(uid, now)

    monkeypatch.setattr(j, "matcher_state", state)
    monkeypatch.setattr(people, "_enrich", enrich)
    assert world.client.get("/ops/people", headers=_bearer(ALICE)).status_code in (401, 403)
    ok = world.client.get("/ops/people", headers=_bearer(PRIMARY_EMAIL))
    assert ok.status_code == 200
    owner = [p for p in ok.json()["people"] if p["owner"]][0]
    assert owner["transfer_matcher"]["sent_this_month"] == 7 and owner["transfer_matcher"]["waiting"] == 3
    assert set(owner["transfer_matcher"]) == {"month", "sent_this_month", "monthly_cap", "waiting", "last_run"}
