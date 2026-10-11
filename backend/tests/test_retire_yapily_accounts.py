"""H87: the retirement script's count mode, --yes refusal and up-front guard."""
import asyncio
import importlib.util
from pathlib import Path

import app.db.collections as cols

_SPEC = importlib.util.spec_from_file_location(
    "retire_yapily_accounts",
    Path(__file__).resolve().parents[1] / "scripts" / "retire_yapily_accounts.py",
)
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)


class _Col:
    def __init__(self, n):
        self.n, self.deleted = n, False

    async def count_documents(self, f):
        return self.n

    async def delete_many(self, f):
        self.deleted = True

        class R:
            deleted_count = self.n
        return R()


class _DB:
    def __init__(self, name):
        self.name = name
        self.c = {n: _Col(2) for n in script.COLLECTIONS}

    async def list_collection_names(self):
        return list(self.c)

    def __getitem__(self, k):
        return self.c[k]


def test_apply_without_yes_is_refused(capsys):
    assert script.main(["--apply"]) == 2
    assert "--yes" in capsys.readouterr().err


def test_count_mode_changes_nothing(monkeypatch, capsys):
    fake = _DB("wealth_test_x")
    monkeypatch.setattr(cols, "db", fake)
    assert asyncio.run(script.run(False)) == 0
    out = capsys.readouterr().out
    assert "yapily_accounts: 2 document(s)" in out
    assert not any(c.deleted for c in fake.c.values())


def test_apply_refuses_up_front_on_a_non_test_database(monkeypatch, capsys):
    fake = _DB("wealth")
    monkeypatch.setattr(cols, "db", fake)
    monkeypatch.delenv("ALLOW_DROP_PROD_DB", raising=False)
    assert asyncio.run(script.run(True)) == 3
    assert "refusing before any change" in capsys.readouterr().err
    assert not any(c.deleted for c in fake.c.values())


def test_yapily_collections_are_erase_only_and_unbound():
    for name in script.COLLECTIONS:
        assert name in cols.ERASE_ONLY_COLLECTIONS
        assert not hasattr(cols, name + "_col")


class _SeedCol(_Col):
    def __init__(self, n):
        super().__init__(n)

    async def delete_many(self, f):
        r = await super().delete_many(f)
        self.n = 0
        return r


class _SeedDB(_DB):
    def __init__(self, name):
        super().__init__(name)
        self.c = {n: _SeedCol(3) for n in script.COLLECTIONS}


def test_only_restricts_count_to_one_collection(monkeypatch, capsys):
    monkeypatch.setattr(cols, "db", _SeedDB("wealth_test_x"))
    assert script.main(["--only", "yapily_accounts"]) == 0
    out = capsys.readouterr().out
    assert "yapily_accounts: 3 document(s)" in out
    assert "yapily_consents" not in out and "yapily_transactions" not in out


def test_apply_yes_deletes_and_drops_through_the_guarded_path(monkeypatch, capsys):
    fake = _SeedDB("wealth_test_x")
    dropped = []

    async def fake_guarded_drop(client, db_name, collection, confirm_name=None):
        dropped.append((db_name, collection, confirm_name))

    monkeypatch.setattr(cols, "db", fake)
    import app.db.guard as guard
    monkeypatch.setattr(guard, "guarded_drop_collection", fake_guarded_drop)

    assert script.main(["--apply", "--yes"]) == 0
    out = capsys.readouterr().out
    for name in script.COLLECTIONS:
        assert f"{name}: deleted 3" in out
        assert f"{name}: dropped" in out
        assert fake.c[name].deleted
    assert dropped == [("wealth_test_x", n, "wealth_test_x") for n in script.COLLECTIONS]


def test_apply_yes_with_only_touches_just_that_collection(monkeypatch, capsys):
    fake = _SeedDB("wealth_test_x")
    dropped = []

    async def fake_guarded_drop(client, db_name, collection, confirm_name=None):
        dropped.append(collection)

    monkeypatch.setattr(cols, "db", fake)
    import app.db.guard as guard
    monkeypatch.setattr(guard, "guarded_drop_collection", fake_guarded_drop)

    assert script.main(["--apply", "--yes", "--only", "yapily_accounts"]) == 0
    assert dropped == ["yapily_accounts"]
    assert fake.c["yapily_accounts"].deleted
    assert not fake.c["yapily_consents"].deleted and not fake.c["yapily_transactions"].deleted
