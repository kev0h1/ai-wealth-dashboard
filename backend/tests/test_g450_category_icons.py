"""G450 contract tests for persisted Phosphor category choices."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import categories
from app.services import category_icons
from app.services import categories as category_service
from app.services.categories import BUILTIN_CATEGORIES, parse_stored_categories
from app.services.category_groups import revision_for


def test_every_builtin_has_a_bundled_icon():
    assert set(BUILTIN_CATEGORIES) <= category_icons._manifest()["categories"].keys()
    assert all(category_icons.valid_icon_key(category_icons.builtin_icon_key(name)) for name in BUILTIN_CATEGORIES)


def test_parser_keeps_valid_metadata_and_discards_malformed_metadata():
    parsed = parse_stored_categories({"categories": [
        {"name": "Golf", "kind": "discretionary", "icon_key": "golf", "icon_source": "user"},
        {"name": "Padel", "kind": "discretionary", "icon_key": "not-bundled", "icon_source": "user"},
        "Legacy",
    ]})
    assert parsed[0]["icon_key"] == "golf" and parsed[0]["icon_source"] == "user"
    assert "icon_key" not in parsed[1]
    assert parsed[2] == {"name": "Legacy", "kind": "discretionary"}


def test_icon_metadata_does_not_change_a_kind_revision():
    before = [{"name": "Golf", "kind": "discretionary", "default_kind": "discretionary", "icon_key": "golf", "icon_source": "auto"}]
    after = [{**before[0], "icon_key": "racquet", "icon_source": "user"}]
    assert revision_for(before) == revision_for(after)


def test_keyword_choices_are_persistable_and_unknown_backfill_is_neutral():
    assert category_icons.backfill_icon("Golf", "discretionary") == "golf"
    assert category_icons.backfill_icon("Padel", "discretionary") == "racquet"
    assert category_icons.backfill_icon("A completely unknown choice", "discretionary") == "tag"


def test_add_persists_auto_or_explicit_icon_and_readd_preserves_manual_choice(monkeypatch):
    stored = []
    async def cas(_uid, mutate, **_options):
        stored[:] = mutate(stored)
        return stored
    async def invalidate(_uid):
        return None
    calls = []
    async def choose(name, kind, uid):
        calls.append((name, kind, uid))
        return "golf"
    monkeypatch.setattr(categories, "_cas_update", cas)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", invalidate)
    monkeypatch.setattr(categories, "_custom_for", lambda _uid: asyncio.sleep(0, result=stored))
    monkeypatch.setattr(categories, "choose_automatic_icon", choose)
    user = {"email": "one@example.test"}
    asyncio.run(categories.add_category({"name": "Golf"}, user))
    assert stored[0]["icon_key"] == "golf" and stored[0]["icon_source"] == "auto"
    asyncio.run(categories.add_category({"name": "Golf", "icon_key": "racquet"}, user))
    asyncio.run(categories.add_category({"name": "Golf", "kind": "commitment"}, user))
    assert stored[0]["icon_key"] == "racquet" and stored[0]["icon_source"] == "user"
    assert len(calls) == 1


def test_icon_update_validates_and_is_scoped_to_the_authenticated_user(monkeypatch):
    records = {
        "one@example.test": [{"name": "Golf", "kind": "discretionary", "icon_key": "golf", "icon_source": "auto"}],
        "two@example.test": [{"name": "Golf", "kind": "discretionary", "icon_key": "racquet", "icon_source": "user"}],
    }
    async def cas(uid, mutate, **_options):
        records[uid] = mutate(records[uid])
        return records[uid]
    monkeypatch.setattr(categories, "_cas_update", cas)
    result = asyncio.run(categories.update_category_icon({"name": "Golf", "icon_key": "soccer-ball"}, {"email": "one@example.test"}))
    assert result["icons"]["Golf"] == "soccer-ball"
    assert records["one@example.test"][0]["icon_source"] == "user"
    assert records["two@example.test"][0]["icon_key"] == "racquet"
    with pytest.raises(HTTPException) as error:
        asyncio.run(categories.update_category_icon({"name": "Golf", "icon_key": "bad"}, {"email": "one@example.test"}))
    assert error.value.status_code == 400


def test_model_failure_and_timeout_are_saved_as_a_neutral_choice(monkeypatch):
    monkeypatch.setattr(category_icons, "OPENROUTER_API_KEY", "configured")
    async def timeout(*_args, **_kwargs):
        raise asyncio.TimeoutError
    monkeypatch.setattr(category_icons, "openrouter_chat", timeout)
    assert asyncio.run(category_icons.choose_automatic_icon("Zorbital", "discretionary", "u")) == "tag"


@pytest.mark.parametrize("value", [[], {}, 0, None, True, "invalid"])
def test_malformed_icon_source_and_kind_do_not_break_reads(value):
    parsed = parse_stored_categories({"categories": [{"name": "Golf", "kind": value, "default_kind": value, "icon_key": "golf", "icon_source": value}]})
    assert parsed[0]["kind"] == "discretionary"
    assert parsed[0]["icon_source"] == "auto"


@pytest.mark.parametrize("content,wanted", [('{"icon_key":"golf"}', "golf"), ('{"icon_key":"not-bundled"}', "tag"), ('[]', "tag"), ('invalid json', "tag")])
def test_only_bundled_model_output_is_accepted(monkeypatch, content, wanted):
    monkeypatch.setattr(category_icons, "OPENROUTER_API_KEY", "configured")
    calls = []
    async def respond(payload, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status_code=200, json=lambda: {"choices": [{"message": {"content": content}}]})
    monkeypatch.setattr(category_icons, "openrouter_chat", respond)
    assert asyncio.run(category_icons.choose_automatic_icon("Zorbital", "discretionary", "one@example.test")) == wanted
    assert len(calls) == 1 and calls[0]["user_id"] == "one@example.test"


def test_keyword_and_unconfigured_choices_never_call_model(monkeypatch):
    async def forbidden(*_args, **_kwargs):
        pytest.fail("This selection must not call a model")
    monkeypatch.setattr(category_icons, "openrouter_chat", forbidden)
    monkeypatch.setattr(category_icons, "OPENROUTER_API_KEY", "configured")
    assert asyncio.run(category_icons.choose_automatic_icon("Padel", "discretionary", "u")) == "racquet"
    assert category_icons.deterministic_icon("Café", "discretionary") == "coffee"
    assert category_icons.deterministic_icon("Holiday fund", "movement") == "piggy-bank"
    monkeypatch.setattr(category_icons, "OPENROUTER_API_KEY", "")
    assert asyncio.run(category_icons.choose_automatic_icon("Zorbital", "discretionary", "u")) == "tag"


class _Cursor:
    def __init__(self, rows): self.rows = deepcopy(rows)
    def __aiter__(self): self.iterator = iter(self.rows); return self
    async def __anext__(self):
        try: return next(self.iterator)
        except StopIteration: raise StopAsyncIteration


class _CategoriesCollection:
    def __init__(self, records):
        self.records = deepcopy(records)
        self.writes = 0
        self.race = None
    def find(self, _query): return _Cursor(list(self.records.values()))
    async def find_one(self, query):
        return next((deepcopy(doc) for doc in self.records.values() if all(doc.get(key) == value for key, value in query.items())), None)
    async def update_one(self, query, update, **_kwargs):
        self.writes += 1
        if self.race:
            callback, self.race = self.race, None
            callback(self.records)
        for doc in self.records.values():
            if all(doc.get(key) == value for key, value in query.items()):
                changed = any(doc.get(key) != value for key, value in update.get("$set", {}).items())
                doc.update(deepcopy(update.get("$set", {})))
                return SimpleNamespace(matched_count=1, modified_count=int(changed), upserted_id=None)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)


def test_backfill_is_idempotent_preserves_data_and_retries_manual_race(monkeypatch):
    collection = _CategoriesCollection({
        "one": {"_id": "one", "user_id": "one@example.test", "categories": [
            {"name": "  Golf  ", "kind": "discretionary", "default_kind": "commitment", "note": "keep"},
            {"name": "Bills", "kind": "movement", "old": "leave builtins alone"},
            {"invalid": "retain malformed entry"},
        ]},
        "bad": {"_id": "bad", "user_id": "bad@example.test", "categories": None},
        "two": {"_id": "two", "user_id": "two@example.test", "categories": [{"name": "Padel", "kind": "discretionary"}]},
    })
    before = deepcopy(collection.records)
    monkeypatch.setattr(category_service, "user_categories_col", collection)
    asyncio.run(category_service.migrate_category_icons())
    first = collection.records["one"]["categories"]
    assert first[0] == {**before["one"]["categories"][0], "icon_key": "golf", "icon_source": "auto"}
    assert first[1:] == before["one"]["categories"][1:]
    assert collection.records["bad"] == before["bad"]
    assert collection.records["two"]["categories"][0]["icon_key"] == "racquet"
    writes = collection.writes
    asyncio.run(category_service.migrate_category_icons())
    assert collection.writes == writes

    collection.records["one"]["categories"][0].pop("icon_key")
    def race(records):
        records["one"]["categories"][0].update({"icon_key": "soccer-ball", "icon_source": "user"})
    collection.race = race
    asyncio.run(category_service.migrate_category_icons())
    assert collection.records["one"]["categories"][0]["icon_key"] == "soccer-ball"
    assert collection.records["one"]["categories"][0]["icon_source"] == "user"


def test_real_cas_writer_keeps_icons_through_kind_edit_reset_and_other_delete(monkeypatch):
    collection = _CategoriesCollection({"one": {"_id": "one", "user_id": "one@example.test", "categories": [
        {"name": "Golf", "kind": "discretionary", "default_kind": "discretionary", "icon_key": "golf", "icon_source": "auto"},
        {"name": "Padel", "kind": "discretionary", "icon_key": "racquet", "icon_source": "auto"},
    ]}})
    monkeypatch.setattr(categories, "user_categories_col", collection)
    invalidations = []
    async def invalidate(uid): invalidations.append(uid)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", invalidate)
    user = {"email": "one@example.test"}
    result = asyncio.run(categories.update_category_icon({"name": "golf", "icon_key": "soccer-ball"}, user))
    assert result["icons"]["Golf"] == "soccer-ball" and not invalidations
    before = deepcopy(collection.records["one"]["categories"])
    asyncio.run(categories.update_category_group({"name": "Golf", "kind": "commitment", "revision": revision_for(before)}, user))
    changed = collection.records["one"]["categories"]
    assert changed[0]["icon_key"] == "soccer-ball" and changed[0]["icon_source"] == "user"
    asyncio.run(categories.reset_category_groups({"revision": revision_for(changed)}, user))
    asyncio.run(categories.delete_category("Padel", user))
    remaining = collection.records["one"]["categories"]
    assert remaining == [{**before[0], "kind": "discretionary"}]


def test_icon_only_cas_preserves_raw_unrelated_records_and_metadata(monkeypatch):
    original = [
        {"name": "  Golf  ", "kind": "DISCRETIONARY", "note": {"keep": True}, "icon_key": "golf", "icon_source": "auto"},
        {"name": "Padel", "kind": "discretionary", "extra": [1, 2], "icon_key": "racquet", "icon_source": "user"},
        {"name": "Golf", "kind": "discretionary", "duplicate": True},
        {"name": "Income", "kind": "movement", "legacy": True}, None, "Other", {"unrecognised": True},
    ]
    collection = _CategoriesCollection({"one": {"_id": "one", "user_id": "one@example.test", "categories": deepcopy(original)}})
    monkeypatch.setattr(categories, "user_categories_col", collection)
    asyncio.run(categories.update_category_icon({"name": "Golf", "icon_key": "soccer-ball"}, {"email": "one@example.test"}))
    expected = deepcopy(original)
    expected[0].update(icon_key="soccer-ball", icon_source="user")
    assert collection.records["one"]["categories"] == expected


def test_restore_automatic_is_explicit_and_idempotent(monkeypatch):
    record = [{"name": "Golf", "kind": "discretionary", "icon_key": "racquet", "icon_source": "user"}]
    calls = []
    async def custom(_uid): return deepcopy(record)
    async def choose(*_args): calls.append(True); return "golf"
    async def cas(_uid, mutate, **_options): record[:] = mutate(record); return record
    monkeypatch.setattr(categories, "_custom_for", custom)
    monkeypatch.setattr(categories, "choose_automatic_icon", choose)
    monkeypatch.setattr(categories, "_cas_update", cas)
    user = {"email": "one@example.test"}
    with pytest.raises(HTTPException) as missing:
        asyncio.run(categories.update_category_icon({"name": "Golf"}, user))
    assert missing.value.status_code == 400 and record[0]["icon_source"] == "user"
    result = asyncio.run(categories.update_category_icon({"name": "Golf", "icon_key": None}, user))
    assert result["icons"]["Golf"] == "golf" and result["icon_sources"]["Golf"] == "auto"
    asyncio.run(categories.update_category_icon({"name": "Golf", "icon_key": None}, user))
    assert len(calls) == 1


@pytest.mark.parametrize("intervening", [
    {"icon_key": "soccer-ball", "icon_source": "user"},
    {"kind": "commitment"},
])
def test_delayed_automatic_reset_refuses_an_intervening_icon_or_kind_write(monkeypatch, intervening):
    record = [{"name": "Zorbital", "kind": "discretionary", "icon_key": "racquet", "icon_source": "user"}]
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        async def custom(_uid): return deepcopy(record)
        async def choose(*_args):
            entered.set()
            await release.wait()
            return "golf"
        async def cas(_uid, mutate, **_options):
            record[:] = mutate(record)
            return record
        monkeypatch.setattr(categories, "_custom_for", custom)
        monkeypatch.setattr(categories, "choose_automatic_icon", choose)
        monkeypatch.setattr(categories, "_cas_update", cas)
        pending = asyncio.create_task(categories.update_category_icon({"name": "Zorbital", "icon_key": None}, {"email": "one@example.test"}))
        await entered.wait()
        record[0].update(intervening)
        before = deepcopy(record)
        release.set()
        with pytest.raises(HTTPException) as conflict:
            await pending
        assert conflict.value.status_code == 409
        assert record == before
    asyncio.run(run())


def test_kind_migration_cas_does_not_overwrite_a_concurrent_manual_icon(monkeypatch):
    class Cursor:
        def __init__(self, rows): self.rows = rows
        def __aiter__(self): self.iterator = iter(self.rows); return self
        async def __anext__(self):
            try: return next(self.iterator)
            except StopIteration: raise StopAsyncIteration

    class Collection:
        def __init__(self):
            self.doc = {"_id": "one", "user_id": "one@example.test", "categories": ["Golf"]}
            self.calls = 0
        def find(self, _query): return Cursor([dict(self.doc)])
        async def find_one(self, _query): return dict(self.doc)
        async def update_one(self, query, _update):
            self.calls += 1
            assert query["categories"] == ["Golf"]
            self.doc["categories"] = [{"name": "Golf", "kind": "discretionary", "icon_key": "racquet", "icon_source": "user"}]
            return SimpleNamespace(modified_count=0)

    collection = Collection()
    monkeypatch.setattr(category_service, "user_categories_col", collection)
    asyncio.run(category_service.migrate_category_kinds())
    assert collection.doc["categories"][0]["icon_key"] == "racquet"
    assert collection.doc["categories"][0]["icon_source"] == "user"
