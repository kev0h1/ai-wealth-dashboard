"""A189: a consent revoke that lands mid-sync must not be overwritten by the
sync's end-of-run "connected" reset, a repair sweep expires accounts on dead
consents, and the payday plan skips an expired destination.

Fake collections only, no database and no Finexer."""
import asyncio

import pytest

import app.services.finexer_sync as fs
import app.services.finexer_webhooks as fxw
from tests import test_a176_bank_sync as a176  # noqa: F401  (shared fakes)
from tests import test_payday_plan_own_transfers as pt

UID = "u-a189"
CONSENT = "fx-a189"
OTHER = "fx-a189-other"


def _match(d, q):
    for k, v in (q or {}).items():
        if isinstance(v, dict):
            if "$in" in v and d.get(k) not in v["$in"]:
                return False
            if "$ne" in v and d.get(k) == v["$ne"]:
                return False
            if "$exists" in v and (k in d) != v["$exists"]:
                return False
        elif d.get(k) != v:
            return False
    return True


class Res:
    def __init__(self, n):
        self.modified_count = n


class Col(a176.Col):
    async def update_many(self, filt, update, upsert=False):
        n = 0
        for d in self.docs:
            if _match(d, filt):
                d.update(update.get("$set") or {})
                n += 1
        return Res(n)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if _match(d, q)]
        return a176.Col(rows).find()


class RevokingAccounts(Col):
    """Flips the consent to revoked, and expires its accounts like the
    webhook does, the first time an account is upserted."""

    def __init__(self, docs, consents):
        super().__init__(docs)
        self.consents = consents
        self.fired = False

    async def update_one(self, filt, update, upsert=False):
        await super().update_one(filt, update, upsert)
        if upsert and not self.fired:
            self.fired = True
            await self.consents.update_one({"_id": CONSENT}, {"$set": {"status": "revoked"}})
            await self.update_many({"connection_id": CONSENT}, {"$set": {"status": "expired"}})


def _wire(monkeypatch, accts_factory):
    consents = Col([
        {"_id": CONSENT, "user_id": UID, "status": "authorized", "last_synced": None},
        {"_id": OTHER, "user_id": UID, "status": "authorized"},
    ])
    accts = accts_factory(consents)
    a176._wire_sync(monkeypatch, accts)
    monkeypatch.setattr(fs, "finexer_consents_col", consents)
    monkeypatch.setattr(fs, "accounts_col", accts)
    monkeypatch.setattr(fxw, "bump_daily_counters", lambda **kw: asyncio.sleep(0))
    c = a176.Client(booked=[])
    monkeypatch.setattr(fs, "_client", lambda: c)
    return consents, accts


def _acc(aid, conn, status):
    return {"_id": aid, "connection_id": conn, "status": status}


def test_a_revoke_between_upsert_and_reset_leaves_accounts_expired(monkeypatch):
    consents, accts = _wire(
        monkeypatch,
        lambda cs: RevokingAccounts([_acc("acc1", CONSENT, "connected")], cs),
    )
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert accts.fired
    assert consents.docs[0]["status"] == "revoked"
    row = next(d for d in accts.docs if d["_id"] == "acc1")
    assert row["status"] == "expired"


def test_healthy_consent_clears_banner_only_on_its_own_accounts(monkeypatch):
    consents, accts = _wire(
        monkeypatch,
        lambda cs: Col([
            _acc("acc1", CONSENT, "expired"),
            _acc("other-acc", OTHER, "expired"),
        ]),
    )
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    by_id = {d["_id"]: d for d in accts.docs}
    assert by_id["acc1"]["status"] == "connected"
    assert by_id["other-acc"]["status"] == "expired"


def test_sweep_flips_stale_connected_on_dead_consents_and_is_idempotent(monkeypatch):
    consents = Col([
        {"_id": "dead", "status": "revoked"},
        {"_id": "gone", "status": "expired"},
        {"_id": "live", "status": "authorized"},
    ])
    accts = Col([
        _acc("a1", "dead", "connected"),
        _acc("a2", "dead", "expired"),
        _acc("a3", "gone", "connected"),
        _acc("a4", "live", "connected"),
    ])
    monkeypatch.setattr(fs, "finexer_consents_col", consents)
    monkeypatch.setattr(fs, "accounts_col", accts)
    first = asyncio.run(fs.expire_accounts_on_dead_consents())
    assert first == {"consents_scanned": 2, "accounts_flipped": 2}
    by_id = {d["_id"]: d["status"] for d in accts.docs}
    assert by_id == {"a1": "expired", "a2": "expired", "a3": "expired", "a4": "connected"}
    second = asyncio.run(fs.expire_accounts_on_dead_consents())
    assert second == {"consents_scanned": 2, "accounts_flipped": 0}


def test_plan_skips_an_expired_destination_and_keeps_the_rest(monkeypatch):
    other = "acc-other"
    bills = [
        pt._bill("Rent", 25, 300.0, account_id=pt.DEST_ACCT, kind="commitment"),
        pt._bill("Gym", 25, 40.0, account_id=other, kind="commitment"),
    ]
    income = [pt._salary(20, 3000.0)]

    def accounts(expired):
        dest = pt._account(pt.DEST_ACCT, 0.0, "Dest")
        if expired:
            dest["status"] = "expired"
        return [pt._account(pt.SALARY_ACCT, 5000.0, "Salary"), dest,
                pt._account(other, 0.0, "Other")]

    live = pt._run(monkeypatch, accounts=accounts(False), bills=bills, income=income)
    assert pt._dest(live, pt.DEST_ACCT) is not None
    live_other = pt._dest(live, other)
    assert live_other is not None

    plan = pt._run(monkeypatch, accounts=accounts(True), bills=bills, income=income)
    assert pt._dest(plan, pt.DEST_ACCT) is None
    kept = pt._dest(plan, other)
    assert kept is not None
    for k in ("balance", "bills_total", "move", "target"):
        assert kept[k] == live_other[k]


class FlipOnConnectedAccounts(Col):
    """Revokes the consent in the gap between the connected write and the
    final re-check, by side effect of the connected update_many."""

    def __init__(self, docs, consents):
        super().__init__(docs)
        self.consents = consents

    async def update_many(self, filt, update, upsert=False):
        res = await super().update_many(filt, update, upsert)
        if (update.get("$set") or {}).get("status") == "connected":
            await self.consents.update_one({"_id": CONSENT}, {"$set": {"status": "revoked"}})
        return res


def test_revoke_after_the_connected_write_is_still_resolved_to_expired(monkeypatch):
    consents, accts = _wire(
        monkeypatch,
        lambda cs: FlipOnConnectedAccounts([_acc("acc1", CONSENT, "expired")], cs),
    )
    asyncio.run(fs.sync_finexer_consent(CONSENT, UID))
    assert consents.docs[0]["status"] == "revoked"
    assert next(d for d in accts.docs if d["_id"] == "acc1")["status"] == "expired"


def test_sweep_counts_a_pending_consent_with_no_accounts(monkeypatch):
    monkeypatch.setattr(fs, "finexer_consents_col", Col([{"_id": "p", "status": "pending"}]))
    monkeypatch.setattr(fs, "accounts_col", Col([]))
    assert asyncio.run(fs.expire_accounts_on_dead_consents()) == {
        "consents_scanned": 1, "accounts_flipped": 0}


def test_reconcile_enqueue_loop_survives_a_failing_sweep(monkeypatch):
    from tests import test_e11_poll_settings as e11

    async def _boom():
        raise RuntimeError("sweep down")

    monkeypatch.setattr(fs, "expire_accounts_on_dead_consents", _boom)
    arq, result = e11._run(monkeypatch, [e11._fx(synced_h=10)])
    assert result["reconciled"] == 1
    assert len(arq.calls) == 1


def test_startup_wrapper_swallows_a_failing_sweep(monkeypatch):
    import app.workers.sync_worker as sw

    async def _boom():
        raise RuntimeError("sweep down")

    monkeypatch.setattr(fs, "expire_accounts_on_dead_consents", _boom)
    asyncio.run(sw._dead_consent_sweep_on_startup())
