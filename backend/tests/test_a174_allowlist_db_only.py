"""A174: the sign-up allow list is database-only.

Covers the one-off ALLOWED_EMAILS migration (idempotent, dry run writes
nothing), the owner protection path (PRIMARY_EMAIL alone), and a grep-style
guard that nothing under backend/app reads the retired env var.
"""
import asyncio
import importlib.util
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

import app.core.allowlist as allowlist_module
import app.core.config as config
import app.core.identity as identity_module
import app.routers.admin_allowlist as admin_allowlist

BACKEND = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("migrate_allowed_emails", BACKEND / "scripts" / "migrate_allowed_emails.py")
migrate_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migrate_mod)

OWNER = "owner.person@gmail.com"


def _run(coro):
    return asyncio.run(coro)


class _Col:
    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, query, **kw):
        for d in self.docs:
            if all(d.get(k) == v for k, v in query.items()):
                return d
        return None

    def find(self, query=None, **kw):
        outer = self

        class _Cur:
            def sort(self, *a, **k):
                return self

            async def to_list(self, n):
                q = query or {}
                return [d for d in outer.docs if all(d.get(k) == v for k, v in q.items())]

        return _Cur()

    async def update_one(self, query, update, upsert=False):
        d = await self.find_one(query)
        if d is None:
            if not upsert:
                return
            d = dict(query)
            d.update(update.get("$setOnInsert", {}))
            self.docs.append(d)
        d.update(update.get("$set", {}))


class _LinkedCol:
    async def find_one(self, *a, **k):
        return None

    async def update_one(self, *a, **k):
        return None


@pytest.fixture()
def col(monkeypatch):
    c = _Col()
    monkeypatch.setattr(allowlist_module, "allowed_signups_col", c)
    monkeypatch.setattr(admin_allowlist, "allowed_signups_col", c)
    monkeypatch.setattr(identity_module, "linked_identities_col", _LinkedCol())
    monkeypatch.setattr(config, "PRIMARY_EMAIL", OWNER)
    monkeypatch.setattr(admin_allowlist, "PRIMARY_EMAIL", OWNER)
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: False)
    return c


# ── migration ───────────────────────────────────────────────────────────────

def test_migration_dry_run_writes_nothing(col):
    emails = ["a@example.com", "b@example.com"]
    counts = _run(migrate_mod.migrate(col, emails, apply=False))
    assert counts == {"env_entries": 2, "already_present": 0, "inserted": 2}
    assert col.docs == []


def test_migration_apply_is_idempotent_and_skips_existing(col):
    col.docs.append({"key": "a@example.com", "email": "a@example.com", "status": "invited"})
    emails = ["A@Example.com", "b@example.com", "c.d@gmail.com"]
    first = _run(migrate_mod.migrate(col, emails, apply=True))
    assert first == {"env_entries": 3, "already_present": 1, "inserted": 2}
    assert len(col.docs) == 3
    migrated = [d for d in col.docs if d.get("source") == "env_migration"]
    assert len(migrated) == 2 and all(d["status"] == "invited" for d in migrated)
    second = _run(migrate_mod.migrate(col, emails, apply=True))
    assert second == {"env_entries": 3, "already_present": 3, "inserted": 0}
    assert len(col.docs) == 3


def test_migration_dedupes_gmail_dot_variants(col):
    counts = _run(migrate_mod.migrate(col, ["x.y@gmail.com", "xy@gmail.com"], apply=True))
    assert counts["inserted"] == 1 and len(col.docs) == 1


def test_migration_never_prints_addresses(col, capsys, monkeypatch):
    monkeypatch.setenv("ALLOWED_EMAILS", "secret.person@example.com")
    counts = _run(migrate_mod.migrate(col, migrate_mod.parse_env_list("secret.person@example.com"), apply=False))
    for k, v in counts.items():
        print(f"  {k}: {v}")
    assert "secret.person" not in capsys.readouterr().out


# ── owner protection, revoked, migrated ─────────────────────────────────────

def test_owner_signs_in_with_empty_list(col):
    assert col.docs == []
    assert _run(identity_module.resolve_signin_email("google-native", OWNER)) == OWNER


def test_owner_cannot_be_revoked(col):
    with pytest.raises(HTTPException) as exc:
        _run(admin_allowlist.revoke_allowlist(config._gmail_key(OWNER), {"email": OWNER, "name": "O"}))
    assert exc.value.status_code == 400


def test_migrated_user_allowed_then_revoked_refused(col):
    _run(migrate_mod.migrate(col, ["tester@example.com"], apply=True))
    assert _run(identity_module.resolve_signin_email("google-native", "tester@example.com")) == "tester@example.com"
    _run(admin_allowlist.revoke_allowlist("tester@example.com", {"email": OWNER, "name": "O"}))
    assert _run(identity_module.resolve_signin_email("google-native", "tester@example.com")) is None


def test_stranger_refused_when_closed_and_open_signup_unchanged(col, monkeypatch):
    assert _run(identity_module.resolve_signin_email("google-native", "stranger@example.com")) is None
    monkeypatch.setattr(identity_module, "is_signup_open", lambda: True)
    assert _run(identity_module.resolve_signin_email("google-native", "stranger@example.com")) == "stranger@example.com"


# ── nothing reads the retired env var ───────────────────────────────────────

def test_no_app_code_reads_allowed_emails():
    assert not hasattr(config, "ALLOWED_EMAILS")
    assert not hasattr(config, "resolve_allowed_email")
    pat = re.compile(r"ALLOWED_EMAILS")
    offenders = []
    for path in (BACKEND / "app").rglob("*.py"):
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if pat.search(line):
                rel = path.relative_to(BACKEND).as_posix()
                # The single permitted mention: the startup warning in config.py.
                if rel == "app/core/config.py" and ("no longer read" in line or "os.getenv(" in line):
                    continue
                offenders.append(f"{rel}:{n}")
    assert offenders == []
