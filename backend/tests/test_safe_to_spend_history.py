"""B18: daily Safe-to-Spend history snapshot
(app/services/safe_to_spend_history.py, app.workers.sync_worker's
`task_safe_to_spend_snapshot` cron).

G35's investigation into a £64->£276 jump with no transactions moving
(Kevin, 2026-09-10) could not reconstruct which of Safe-to-Spend's own
components actually changed that day, because nothing records the figure's
history — only its latest value is ever stored. This suite covers the fix:
`build_snapshot_doc` (pure) turns one `compute_safe_to_spend` response into
a storable doc, and `run_safe_to_spend_snapshot` fans out over every user
with a cashflow cache, upserting one doc per user per day.

No real Mongo: `cashflow_cache_col`/`safe_to_spend_history_col` and
`app.routers.analytics.compute_safe_to_spend` are monkeypatched directly on
their owning modules' namespaces, same convention as
tests/test_safe_to_spend_hardening.py and tests/test_mcp_audit_retention.py.
"""
import asyncio
from datetime import date, datetime, timezone

import app.routers.analytics as analytics
import app.services.safe_to_spend_history as sts_history

UID = "g35-fixture@example.com"


def _run(coro):
    return asyncio.run(coro)


# ── build_snapshot_doc (pure) ───────────────────────────────────────────────

def test_build_snapshot_doc_pins_every_named_component():
    day = date(2026, 9, 10)
    computed_at = datetime(2026, 9, 10, 5, 0, 0, tzinfo=timezone.utc)
    result = {
        "status": "ok",
        "next_payday": "2026-09-25",
        "days_until_payday": 15,
        "safe_to_spend": 276.0,
        "safe_to_spend_cash": 276.0,
        "state": "tight",
        "spendable_now": 1200.0,
        "bills_total": 172.0,
        "income_before_payday": 0.0,
        "lowest_projected_balance": 326.0,
        "buffer": 0.0,
        "commitments_reserved": 40,
        "allocations_reserved": 10.0,
        "card_growth_total": 200.0,
        "card_growth_reserved": 0.0,
        "window_bills": [
            {"name": "Council Tax", "amount": 150.0, "days_away": 10, "extra_key": "ignored"},
            {"name": "TV Licence", "amount": 22.0, "days_away": 3},
        ],
    }

    doc = sts_history.build_snapshot_doc(UID, day, computed_at, result)

    assert doc == {
        "_id": f"{UID}:2026-09-10",
        "user_id": UID,
        "date": "2026-09-10",
        "computed_at": computed_at,
        "next_payday": "2026-09-25",
        "days_until_payday": 15,
        "safe_to_spend": 276.0,
        "safe_to_spend_cash": 276.0,
        "state": "tight",
        "spendable_now": 1200.0,
        "bills_total": 172.0,
        "income_before_payday": 0.0,
        "lowest_projected_balance": 326.0,
        "buffer": 0.0,
        "commitments_reserved": 40,
        "allocations_reserved": 10.0,
        "card_growth_total": 200.0,
        "card_growth_reserved": 0.0,
        "bills": [
            {"name": "Council Tax", "amount": 150.0, "days_away": 10},
            {"name": "TV Licence", "amount": 22.0, "days_away": 3},
        ],
    }
    # bills' amounts must sum to bills_total exactly — the snapshot's own
    # internal consistency check, so a future diff can trust the identity
    # list reconciles with the total it's supposed to explain.
    assert sum(b["amount"] for b in doc["bills"]) == doc["bills_total"]


def test_build_snapshot_doc_handles_missing_window_bills():
    day = date(2026, 1, 1)
    computed_at = datetime(2026, 1, 1, 5, 0, 0, tzinfo=timezone.utc)
    doc = sts_history.build_snapshot_doc(UID, day, computed_at, {"status": "ok"})
    assert doc["bills"] == []
    assert doc["_id"] == f"{UID}:2026-01-01"


# ── run_safe_to_spend_snapshot (fan-out) ────────────────────────────────────

class _FakeDistinctCol:
    """Stand-in for `cashflow_cache_col`: only `.distinct("_id")` is used."""
    def __init__(self, uids):
        self._uids = list(uids)

    async def distinct(self, _field):
        return list(self._uids)


class _FakeHistoryCol:
    """Stand-in for `safe_to_spend_history_col`: records every upsert."""
    def __init__(self):
        self.docs: dict[str, dict] = {}
        self.update_calls = []

    async def update_one(self, filt, update, upsert=False):
        self.update_calls.append((filt, update, upsert))
        assert upsert is True
        doc = update["$set"]
        self.docs[filt["_id"]] = doc


def test_run_safe_to_spend_snapshot_writes_one_doc_per_ok_user_and_skips_the_rest(monkeypatch):
    users = ["user-a@example.com", "user-b@example.com", "user-c@example.com"]
    cashflow_col = _FakeDistinctCol(users)
    history_col = _FakeHistoryCol()

    async def fake_compute(uid):
        if uid == "user-a@example.com":
            return {"status": "ok", "safe_to_spend": 100.0, "bills_total": 50.0,
                     "window_bills": [{"name": "Rent", "amount": 50.0, "days_away": 2}]}
        if uid == "user-b@example.com":
            # No cashflow history yet — nothing meaningful to snapshot.
            return {"status": "insufficient_data"}
        # user-c: a genuine compute failure must not take the whole sweep down.
        raise RuntimeError("boom")

    monkeypatch.setattr(sts_history, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(sts_history, "safe_to_spend_history_col", history_col)
    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_compute)

    summary = _run(sts_history.run_safe_to_spend_snapshot())

    assert summary == {"users": 3, "written": 1, "skipped": 1, "failed": 1}
    assert list(history_col.docs.keys()) == [f"user-a@example.com:{date.today().isoformat()}"]
    written_doc = history_col.docs[f"user-a@example.com:{date.today().isoformat()}"]
    assert written_doc["user_id"] == "user-a@example.com"
    assert written_doc["safe_to_spend"] == 100.0
    assert written_doc["bills"] == [{"name": "Rent", "amount": 50.0, "days_away": 2}]


def test_run_safe_to_spend_snapshot_never_leaks_one_users_figures_into_another(monkeypatch):
    """Cross-user isolation (the CRITICAL rule this whole investigation was
    run under, applied to the code itself): two users' snapshots must never
    share a document or borrow each other's figures."""
    users = ["alice@example.com", "bob@example.com"]
    cashflow_col = _FakeDistinctCol(users)
    history_col = _FakeHistoryCol()

    figures = {
        "alice@example.com": {"status": "ok", "safe_to_spend": 64.0, "bills_total": 384.0},
        "bob@example.com": {"status": "ok", "safe_to_spend": 900.0, "bills_total": 20.0},
    }

    async def fake_compute(uid):
        return figures[uid]

    monkeypatch.setattr(sts_history, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(sts_history, "safe_to_spend_history_col", history_col)
    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_compute)

    summary = _run(sts_history.run_safe_to_spend_snapshot())

    assert summary["written"] == 2
    today = date.today().isoformat()
    alice_doc = history_col.docs[f"alice@example.com:{today}"]
    bob_doc = history_col.docs[f"bob@example.com:{today}"]
    assert alice_doc["user_id"] == "alice@example.com"
    assert alice_doc["safe_to_spend"] == 64.0
    assert bob_doc["user_id"] == "bob@example.com"
    assert bob_doc["safe_to_spend"] == 900.0
    # Distinct docs, distinct ids — no shared row a leaking filter could return.
    assert alice_doc is not bob_doc
    assert len(history_col.docs) == 2


def test_run_safe_to_spend_snapshot_is_idempotent_per_user_per_day(monkeypatch):
    """A worker retry or a second run the same day must overwrite, not
    duplicate — the collection's unique (user_id, date) index depends on
    this same _id scheme holding."""
    cashflow_col = _FakeDistinctCol(["alice@example.com"])
    history_col = _FakeHistoryCol()

    call_count = {"n": 0}

    async def fake_compute(_uid):
        call_count["n"] += 1
        return {"status": "ok", "safe_to_spend": 10.0 * call_count["n"]}

    monkeypatch.setattr(sts_history, "cashflow_cache_col", cashflow_col)
    monkeypatch.setattr(sts_history, "safe_to_spend_history_col", history_col)
    monkeypatch.setattr(analytics, "compute_safe_to_spend", fake_compute)

    _run(sts_history.run_safe_to_spend_snapshot())
    _run(sts_history.run_safe_to_spend_snapshot())

    assert len(history_col.docs) == 1
    today = date.today().isoformat()
    assert history_col.docs[f"alice@example.com:{today}"]["safe_to_spend"] == 20.0
