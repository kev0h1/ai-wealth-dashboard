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
