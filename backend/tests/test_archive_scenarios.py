"""G246: backend/scripts/archive_scenarios.py guards. Never touches a real
database: the refusal path returns before any import of the Mongo handles, and
the delete filters are checked against recording fakes."""
import asyncio
import sys
from types import SimpleNamespace

import pytest

from scripts import archive_scenarios as mod


def test_apply_without_user_and_yes_is_refused(monkeypatch, capsys):
    for argv in (["x", "--apply"], ["x", "--apply", "--yes"], ["x", "--apply", "--user", "a@b.c"]):
        monkeypatch.setattr(sys, "argv", argv)
        assert asyncio.run(mod.main()) == 2
    assert "refusing" in capsys.readouterr().out


class _Col:
    def __init__(self):
        self.filters = []

    async def delete_many(self, flt):
        self.filters.append(flt)
        return SimpleNamespace(deleted_count=1)


class _Db(dict):
    async def list_collection_names(self):
        return list(self.keys())


def test_every_delete_filter_is_user_scoped_and_usage_rows_need_the_flag():
    named, cache, usage = _Col(), _Col(), _Col()
    db = _Db({"user_scenarios": named, "accounts": _Col()})
    cols = SimpleNamespace(response_cache_col=cache, llm_usage_col=usage)
    asyncio.run(mod.apply_for_user(db, cols, "u@example.com", include_usage=False))
    assert db["accounts"].filters == [] and usage.filters == []
    assert named.filters == [{"$or": [{"user_id": "u@example.com"}, {"_id": "u@example.com"}]}]
    assert cache.filters[0]["user_id"] == "u@example.com"
    asyncio.run(mod.apply_for_user(db, cols, "u@example.com", include_usage=True))
    assert usage.filters == [{"user_id": "u@example.com", "pipeline": "scenario"}]
