"""C43: scripts/seed_demo_account.py and scripts/make_demo_password_hash.py.

The seeder runs in a SUBPROCESS against the disposable wealth_test_* database
this run already uses (the Motor client binds to one event loop, so it cannot
share the test process's loop). Nothing here touches a real database: every
test asserts the database name first.
"""
import os
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pymongo
import pytest

import app.core.config as config
from app.db.guard import TEST_DB_NAME_RE

BACKEND = Path(__file__).resolve().parents[1]
SCRIPT = BACKEND / "scripts" / "seed_demo_account.py"
HASH_SCRIPT = BACKEND / "scripts" / "make_demo_password_hash.py"
DEMO = "appreview@auriqltd.co.uk"
OTHER = "seeder-bystander@example.test"


def _db():
    assert TEST_DB_NAME_RE.match(config.MONGO_DB), "seeder tests only run against a wealth_test_* database"
    client = pymongo.MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=5000)
    return client, client[config.MONGO_DB]


def _seed(*args, db_name=None):
    env = {**os.environ, "MONGO_DB": config.MONGO_DB, "FORBID_LIVE_QUEUE": "1"}
    cmd = [sys.executable, str(SCRIPT), *args]
    if db_name is not None:
        cmd += ["--db-name", db_name]
    return subprocess.run(cmd, cwd=BACKEND, env=env, capture_output=True, text=True, timeout=240)


@pytest.fixture
def bystander():
    client, db = _db()
    docs = {
        "accounts": {"_id": "bystander-acc", "user_id": OTHER, "name": "Not demo", "balance": 1.0},
        "transactions": {"_id": "bystander-txn", "user_id": OTHER, "amount": 5.0, "date": datetime(2026, 1, 1)},
        "preferences": {"user_id": OTHER, "pay_period_config": {"type": "calendar_month"}},
        "commitments": {"_id": "bystander-goal", "user_id": OTHER, "name": "Mine"},
    }
    for name, doc in docs.items():
        db[name].replace_one({"_id": doc["_id"]} if "_id" in doc else {"user_id": OTHER}, doc, upsert=True)
    yield db
    for name, doc in docs.items():
        db[name].delete_many({"user_id": OTHER})
    db.connections.delete_many({"user_id": DEMO})
    client.close()


def test_refuses_without_confirm():
    r = _seed(db_name=config.MONGO_DB)
    assert r.returncode == 2
    assert "--confirm" in r.stderr


def test_refuses_on_database_name_mismatch_and_prints_no_uri():
    r = _seed("--confirm", db_name="wealth_test_somewhere_else")
    assert r.returncode == 2
    assert "does not match" in r.stderr
    assert "mongodb://" not in r.stdout + r.stderr


def test_refuses_without_a_database_name():
    assert _seed("--confirm").returncode == 2


def test_refuses_when_the_demo_user_owns_a_bank_connection(bystander):
    bystander.connections.insert_one({"_id": "c43-real-conn", "user_id": DEMO})
    try:
        r = _seed("--confirm", db_name=config.MONGO_DB)
    finally:
        bystander.connections.delete_many({"_id": "c43-real-conn"})
    assert r.returncode != 0
    assert "bank connection" in r.stderr


def test_seeds_idempotently_and_touches_only_demo_documents(bystander):
    first = _seed("--confirm", db_name=config.MONGO_DB)
    assert first.returncode == 0, first.stderr[-800:]
    assert f"Target database: {config.MONGO_DB}" in first.stdout
    assert "mongodb://" not in first.stdout + first.stderr

    def snapshot():
        return {
            "accounts": sorted(d["_id"] for d in bystander.accounts.find({"user_id": DEMO})),
            "txns": bystander.transactions.count_documents({"user_id": DEMO}),
            "goals": bystander.commitments.count_documents({"user_id": DEMO}),
            "plans": bystander.allocations.count_documents({"user_id": DEMO}),
        }

    one = snapshot()
    second = _seed("--confirm", db_name=config.MONGO_DB)
    assert second.returncode == 0, second.stderr[-800:]
    assert "removed=0" not in second.stdout, "the rebuild wipes the previous seed"
    assert snapshot() == one, "re-seeding rebuilds the same shape, no duplicates"

    # Another user's documents survive both runs untouched.
    assert bystander.accounts.find_one({"_id": "bystander-acc"})["name"] == "Not demo"
    assert bystander.transactions.count_documents({"user_id": OTHER}) == 1
    assert bystander.preferences.count_documents({"user_id": OTHER}) == 1
    assert bystander.commitments.count_documents({"user_id": OTHER}) == 1


def test_seeded_account_is_complete_and_computed(bystander):
    assert _seed("--confirm", db_name=config.MONGO_DB).returncode == 0
    db = bystander
    accounts = {a["_id"]: a for a in db.accounts.find({"user_id": DEMO})}
    assert {a["subtype"] for a in accounts.values()} == {"TRANSACTION", "SAVINGS", "CREDIT_CARD"}
    assert all(a["provider"] == "Demo" and "connection_id" not in a for a in accounts.values()), "no sync marker path"
    assert db.finexer_consents.count_documents({"user_id": DEMO}) == 0
    assert db.connections.count_documents({"user_id": DEMO}) == 0

    dates = [t["date"] for t in db.transactions.find({"user_id": DEMO}, {"date": 1})]
    assert (max(dates) - min(dates)).days >= 80, "about three months of history"
    assert max(dates).date() <= date.today() + timedelta(days=1), "nothing dated in the future"
    desc = " ".join(t["description"] for t in db.transactions.find({"user_id": DEMO}, {"description": 1}))
    for needle in ("SALARY", "RENT", "COUNCIL TAX", "ENERGY", "MOBILE", "STREAMBOX", "CARD PAYMENT", "EASY ACCESS SAVER"):
        assert needle in desc, needle

    assert db.commitments.count_documents({"user_id": DEMO, "status": "active"}) == 1
    assert db.allocations.count_documents({"user_id": DEMO, "active": True}) == 1
    assert db.user_profiles.find_one({"_id": DEMO})["full_name"] == "App Reviewer"
    sub = db.subscriptions.find_one({"user_id": DEMO})
    assert sub["tier"] == "plus" and sub["status"] == "active"

    sts = db.response_cache.find_one({"user_id": DEMO, "name": "safe_to_spend"})["payload"]
    assert isinstance(sts["safe_to_spend"], (int, float)) and sts["calculation_status"] == "complete"
    today = db.response_cache.find_one({"user_id": DEMO, "name": "today"})["payload"]
    assert any(i.get("type") == "move" for i in today["items"]), "a suggested move is part of the demo"

    # No real-looking identity leaked into the seed.
    blob = " ".join(str(a) for a in accounts.values()) + desc
    assert "@" not in blob.replace(DEMO, "")


def test_build_transactions_is_deterministic_and_relative_to_today():
    from scripts import seed_demo_account as s
    today = date(2026, 11, 13)
    rows, facts = s.build_transactions(today)
    again, _ = s.build_transactions(today)
    assert rows == again
    assert min(r["date"] for r in rows) >= today - timedelta(days=s.HISTORY_DAYS)
    assert max(r["date"] for r in rows) <= today
    salaries = [r for r in rows if r["category"] == "Income" and r["amount"] == s.SALARY]
    assert len(salaries) == 3 and all(r["date"].day == s.PAY_DAY for r in salaries)
    # A different "today" moves every date with it.
    later, _ = s.build_transactions(date(2027, 2, 20))
    assert min(r["date"] for r in later) > today


def test_hash_script_round_trips_without_echoing_the_password(monkeypatch, capsys):
    import getpass
    from app.core import demo
    from scripts import make_demo_password_hash as m
    pw = "correct horse battery staple 43"
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": pw)
    assert m.main() == 0
    out = capsys.readouterr()
    stored = out.out.strip()
    assert stored.startswith("scrypt$") and pw not in out.out + out.err
    assert demo.verify_password(pw, stored) and not demo.verify_password(pw + "!", stored)


def test_hash_script_refuses_a_short_or_mismatched_password(monkeypatch, capsys):
    import getpass
    from scripts import make_demo_password_hash as m
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": "short")
    assert m.main() == 2
    answers = iter(["a long enough password", "a different long password"])
    monkeypatch.setattr(getpass, "getpass", lambda prompt="": next(answers))
    assert m.main() == 2
    assert capsys.readouterr().out == ""
