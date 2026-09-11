"""Tests for B22's task_trial_reminder (app.workers.sync_worker): the
legal disclosure reminder sent a few days before a 14-day introductory
trial converts into a paid subscription.

No mongomock in this environment (see tests/test_reconcile_cadence.py's
own note) — subscriptions_col is replaced with a tiny in-memory FakeCol.
send_push_to_user is monkeypatched directly on the sync_worker module (it
is imported there as `from app.core.push import send_push_to_user`).
"""
import asyncio
from datetime import datetime, timedelta

import app.workers.sync_worker as sync_worker


def _run(coro):
    return asyncio.run(coro)


class FakeCol:
    """Stand-in for a Motor collection: find({"status": ...}).to_list(None)
    and update_one with $set, matching what task_trial_reminder actually
    calls."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self._next_id = 1
        for d in self.docs:
            d.setdefault("_id", f"doc{self._next_id}")
            self._next_id += 1

    def find(self, filt=None, proj=None):
        filt = filt or {}
        matched = [d for d in self.docs if all(d.get(k) == v for k, v in filt.items())]
        return _FakeCursor(matched)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if all(d.get(k) == v for k, v in filt.items()):
                for k, v in (update.get("$set") or {}).items():
                    d[k] = v
                return


class _FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, n):
        return list(self._docs) if n is None else list(self._docs)[:n]


def _patched_pushes(monkeypatch):
    calls = []

    async def _fake_send_push(user_id, title, body, url="/"):
        calls.append({"user_id": user_id, "title": title, "body": body, "url": url})
        return {"ok": True}

    monkeypatch.setattr(sync_worker, "send_push_to_user", _fake_send_push)
    return calls


def test_trial_reminder_sends_inside_three_day_window(monkeypatch):
    now = datetime.utcnow()
    fake_subs = FakeCol([{
        "user_id": "kevin@example.com", "tier": "max", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": now + timedelta(days=2),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", fake_subs)
    calls = _patched_pushes(monkeypatch)

    result = _run(sync_worker.task_trial_reminder({}))

    assert result["sent"] == 1
    assert len(calls) == 1
    push = calls[0]
    assert push["user_id"] == "kevin@example.com"
    assert push["url"] == "/settings"
    assert "£169.99" in push["body"]
    assert "unless you cancel from Settings, Your plan" in push["body"]
    assert fake_subs.docs[0]["trial_reminder_sent_at"] is not None


def test_trial_reminder_skips_outside_three_day_window(monkeypatch):
    now = datetime.utcnow()
    fake_subs = FakeCol([{
        "user_id": "far@example.com", "tier": "max", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": now + timedelta(days=10),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", fake_subs)
    calls = _patched_pushes(monkeypatch)

    result = _run(sync_worker.task_trial_reminder({}))

    assert result["sent"] == 0
    assert calls == []
    assert "trial_reminder_sent_at" not in fake_subs.docs[0]


def test_trial_reminder_skips_already_reminded(monkeypatch):
    now = datetime.utcnow()
    fake_subs = FakeCol([{
        "user_id": "already@example.com", "tier": "max", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": now + timedelta(days=1),
        "trial_reminder_sent_at": now - timedelta(hours=6),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", fake_subs)
    calls = _patched_pushes(monkeypatch)

    result = _run(sync_worker.task_trial_reminder({}))

    assert result["sent"] == 0
    assert calls == []


def test_trial_reminder_skips_non_trialing_status(monkeypatch):
    now = datetime.utcnow()
    fake_subs = FakeCol([{
        "user_id": "active@example.com", "tier": "max", "status": "active",
        "billing_period": "annual", "trial_ends_at": now + timedelta(days=1),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", fake_subs)
    calls = _patched_pushes(monkeypatch)

    result = _run(sync_worker.task_trial_reminder({}))

    assert result["sent"] == 0
    assert calls == []


def test_trial_reminder_runs_once_and_only_once_per_trial(monkeypatch):
    """Simulates the cron firing twice (e.g. two daily runs while the
    trial sits inside the 3-day window) — the second run must not send a
    second push."""
    now = datetime.utcnow()
    fake_subs = FakeCol([{
        "user_id": "twice@example.com", "tier": "standard", "status": "trialing",
        "billing_period": "annual", "trial_ends_at": now + timedelta(days=2),
    }])
    monkeypatch.setattr(sync_worker, "subscriptions_col", fake_subs)
    calls = _patched_pushes(monkeypatch)

    first = _run(sync_worker.task_trial_reminder({}))
    second = _run(sync_worker.task_trial_reminder({}))

    assert first["sent"] == 1
    assert second["sent"] == 0
    assert len(calls) == 1
