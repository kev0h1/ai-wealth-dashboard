"""A128: the retirement script's count mode and its --yes refusal."""
import asyncio
import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "retire_expo_push_tokens",
    Path(__file__).resolve().parents[1] / "scripts" / "retire_expo_push_tokens.py",
)
script = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(script)


def test_apply_without_yes_is_refused(capsys):
    assert script.main(["--apply"]) == 2
    assert "--yes" in capsys.readouterr().err


def test_count_mode_changes_nothing(monkeypatch, capsys):
    class Col:
        def __init__(self, n):
            self.n, self.deleted = n, False
        async def count_documents(self, f):
            return self.n
        async def delete_many(self, f):
            self.deleted = True
    class DB:
        name = "wealth_test_x"
        def __init__(self):
            self.c = {"expo_push_tokens": Col(2), "savings_plans": Col(0)}
        async def list_collection_names(self):
            return list(self.c)
        def __getitem__(self, k):
            return self.c[k]
    import app.db.collections as cols
    fake = DB()
    monkeypatch.setattr(cols, "db", fake)
    assert asyncio.run(script.run(False)) == 0
    out = capsys.readouterr().out
    assert "expo_push_tokens: 2 document(s)" in out
    assert "savings_plans: 0 document(s)" in out
    assert not fake.c["expo_push_tokens"].deleted


def test_apply_refuses_up_front_when_drop_guard_would_block(monkeypatch, capsys):
    class Col:
        def __init__(self, n):
            self.n, self.deleted = n, False
        async def count_documents(self, f):
            return self.n
        async def delete_many(self, f):
            self.deleted = True
    class DB:
        name = "wealth"
        def __init__(self):
            self.c = {"expo_push_tokens": Col(2), "savings_plans": Col(0)}
        async def list_collection_names(self):
            return list(self.c)
        def __getitem__(self, k):
            return self.c[k]
    import app.db.collections as cols
    fake = DB()
    monkeypatch.setattr(cols, "db", fake)
    monkeypatch.delenv("ALLOW_DROP_PROD_DB", raising=False)
    assert asyncio.run(script.run(True)) == 3
    assert not fake.c["expo_push_tokens"].deleted
