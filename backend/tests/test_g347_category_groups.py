"""Focused contract tests for the persisted category grouping read model."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import categories
from app.services.category_groups import response_for, revision_for


def _shape():
    return {
        "status": "ok",
        "period": {"start": "2026-09-01", "end": "2026-09-30", "label": "September"},
        "total_out": 88.0,
        "group_evidence": [{
            "name": "Side project", "fixed": 10, "moved": -2, "free": 80,
            "excluded": 3, "income": 50, "editable_amount": 91,
        }],
    }


def test_readmodel_uses_actual_mixed_contributions_not_selected_kind():
    payload = response_for(
        [{"name": "Side project", "kind": "movement", "default_kind": "commitment"}], _shape()
    )
    row = next(r for r in payload["rows"] if r["name"] == "Side project")
    assert row["amount"] == 91
    assert row["editable_amount"] == 91
    assert row["contributions"] == {"fixed": 10.0, "moved": -2.0, "free": 80.0, "excluded": 3.0, "income": 50.0}
    assert payload["changed_count"] == 1


def test_thin_readmodel_has_no_misleading_amounts():
    payload = response_for([{"name": "Golf", "kind": "discretionary"}], {"status": "thin", "period": None})
    row = next(r for r in payload["rows"] if r["name"] == "Golf")
    assert payload["spending_total"] is None
    assert row["amount"] is None
    assert all(value is None for value in row["contributions"].values())


def test_revision_includes_original_kind_metadata():
    assert revision_for([{"name": "Golf", "kind": "movement", "default_kind": "discretionary"}]) != revision_for(
        [{"name": "Golf", "kind": "movement", "default_kind": "commitment"}]
    )


def test_group_write_rejects_protected_invalid_and_stale(monkeypatch):
    async def invoke(body):
        return await categories.update_category_group(body, {"email": "one@example.test"})

    with pytest.raises(HTTPException) as protected:
        asyncio.run(invoke({"name": "Bills", "kind": "movement", "revision": "r"}))
    assert protected.value.status_code == 400
    with pytest.raises(HTTPException) as invalid:
        asyncio.run(invoke({"name": "Golf", "kind": "income", "revision": "r"}))
    assert invalid.value.status_code == 400
    with pytest.raises(HTTPException) as malformed:
        asyncio.run(invoke({"name": "Golf", "kind": "movement", "revision": 1}))
    assert malformed.value.status_code == 400

    seen = []
    async def cas(_uid, mutate):
        seen.append(_uid)
        return mutate([{"name": "Golf", "kind": "discretionary", "default_kind": "discretionary"}])
    monkeypatch.setattr(categories, "_cas_update", cas)
    with pytest.raises(HTTPException) as stale:
        asyncio.run(invoke({"name": "Golf", "kind": "movement", "revision": "stale"}))
    assert stale.value.status_code == 409
    assert seen == ["one@example.test"]


def test_group_change_and_reset_restore_original_and_await_invalidation(monkeypatch):
    stored = [{"name": "Studio", "kind": "commitment", "default_kind": "commitment"}]
    invalidated = []

    async def cas(uid, mutate):
        assert uid == "one@example.test"
        stored[:] = mutate(stored)
        return stored

    async def invalidate(uid):
        invalidated.append(uid)

    monkeypatch.setattr(categories, "_cas_update", cas)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", invalidate)
    revision = revision_for(stored)
    saved = asyncio.run(categories.update_category_group(
        {"name": "Studio", "kind": "movement", "revision": revision}, {"email": "one@example.test"}
    ))
    assert saved == {"saved": True}
    assert stored[0] == {"name": "Studio", "kind": "movement", "default_kind": "commitment"}
    reset = asyncio.run(categories.reset_category_groups(
        {"revision": revision_for(stored)}, {"email": "one@example.test"}
    ))
    assert reset == {"saved": True}
    assert stored[0]["kind"] == "commitment"
    assert invalidated == ["one@example.test", "one@example.test"]


def test_group_write_unknown_and_internal_income_are_protected(monkeypatch):
    async def cas(_uid, mutate):
        return mutate([{"name": "Legacy income", "kind": "income", "default_kind": "income"}])
    monkeypatch.setattr(categories, "_cas_update", cas)
    for body, status in (
        ({"name": [], "kind": "movement", "revision": "x"}, 400),
        ({"name": "Missing", "kind": "movement", "revision": revision_for([{"name": "Legacy income", "kind": "income", "default_kind": "income"}])}, 404),
        ({"name": "Legacy income", "kind": "movement", "revision": revision_for([{"name": "Legacy income", "kind": "income", "default_kind": "income"}])}, 400),
    ):
        with pytest.raises(HTTPException) as error:
            asyncio.run(categories.update_category_group(body, {"email": "other@example.test"}))
        assert error.value.status_code == status


def test_get_groups_retries_once_then_refuses_an_unstable_revision(monkeypatch):
    reads = iter([
        [{"name": "Studio", "kind": "commitment", "default_kind": "commitment"}],
        [{"name": "Studio", "kind": "movement", "default_kind": "commitment"}],
        [{"name": "Studio", "kind": "movement", "default_kind": "commitment"}],
        [{"name": "Studio", "kind": "movement", "default_kind": "commitment"}],
    ])

    async def custom(_uid):
        return next(reads)

    async def shape(_uid):
        return _shape()

    monkeypatch.setattr(categories, "_custom_for", custom)
    monkeypatch.setattr(categories, "get_money_shape_cached", shape)
    got = asyncio.run(categories.get_category_groups({"email": "one@example.test"}))
    assert got["revision"] == revision_for([{"name": "Studio", "kind": "movement", "default_kind": "commitment"}])

    async def always_racing(_uid):
        always_racing.count += 1
        return [{"name": "Studio", "kind": "commitment" if always_racing.count % 2 else "movement"}]
    always_racing.count = 0
    monkeypatch.setattr(categories, "_custom_for", always_racing)
    with pytest.raises(HTTPException) as error:
        asyncio.run(categories.get_category_groups({"email": "one@example.test"}))
    assert error.value.status_code == 409


def test_add_and_delete_preserve_original_metadata_via_cas(monkeypatch):
    stored = [{"name": "Studio", "kind": "movement", "default_kind": "commitment"}]

    async def cas(_uid, mutate):
        stored[:] = mutate(stored)
        return stored

    async def invalidate(_uid):
        return None

    monkeypatch.setattr(categories, "_cas_update", cas)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", invalidate)
    asyncio.run(categories.add_category({"name": "Studio", "kind": "discretionary"}, {"email": "one@example.test"}))
    assert stored[0] == {"name": "Studio", "kind": "discretionary", "default_kind": "commitment"}
    asyncio.run(categories.delete_category("Studio", {"email": "one@example.test"}))
    assert stored == []


def test_actual_cas_retry_keeps_a_concurrent_category_write(monkeypatch):
    class FakeCategories:
        def __init__(self):
            self.doc = {"user_id": "one@example.test", "categories": []}
            self.calls = 0

        async def find_one(self, _query):
            return {**self.doc, "categories": [dict(c) for c in self.doc["categories"]]}

        async def update_one(self, _query, update, upsert=False):
            self.calls += 1
            if self.calls == 1:
                # Simulate a different tab winning between read and write.
                self.doc["categories"] = [{"name": "Else", "kind": "commitment", "default_kind": "commitment"}]
                return SimpleNamespace(matched_count=0, upserted_id=None)
            assert _query["categories"] == self.doc["categories"]
            self.doc["categories"] = update["$set"]["categories"]
            return SimpleNamespace(matched_count=1, upserted_id=None)

    fake = FakeCategories()
    monkeypatch.setattr(categories, "user_categories_col", fake)
    result = asyncio.run(categories._cas_update(
        "one@example.test", lambda current: current + [{"name": "Golf", "kind": "movement", "default_kind": "discretionary"}]
    ))
    assert [entry["name"] for entry in result] == ["Else", "Golf"]
    assert fake.calls == 2


def test_group_endpoints_reject_list_bodies_as_bad_requests():
    for endpoint in (categories.update_category_group, categories.reset_category_groups):
        with pytest.raises(HTTPException) as error:
            asyncio.run(endpoint([], {"email": "one@example.test"}))
        assert error.value.status_code == 400


def test_group_mutation_scopes_each_write_to_authenticated_user(monkeypatch):
    records = {
        "one@example.test": [{"name": "Studio", "kind": "commitment", "default_kind": "commitment"}],
        "two@example.test": [{"name": "Studio", "kind": "discretionary", "default_kind": "discretionary"}],
    }

    async def cas(uid, mutate):
        records[uid] = mutate(records[uid])
        return records[uid]

    async def invalidate(_uid):
        return None

    monkeypatch.setattr(categories, "_cas_update", cas)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", invalidate)
    asyncio.run(categories.update_category_group({
        "name": "Studio", "kind": "movement", "revision": revision_for(records["one@example.test"])
    }, {"email": "one@example.test"}))
    assert records["one@example.test"][0]["kind"] == "movement"
    assert records["two@example.test"][0]["kind"] == "discretionary"


def test_http_routes_accept_json_body_and_require_user(monkeypatch):
    import httpx
    from fastapi import FastAPI
    from unittest.mock import AsyncMock
    from app.core.auth import current_user
    app = FastAPI()
    app.include_router(categories.router)
    original = [{"name": "Studio", "kind": "commitment"}]
    async def cas(uid, mutate):
        assert uid == "g347-http@example.test"
        return mutate([dict(row) for row in original])
    monkeypatch.setattr(categories, "_cas_update", cas)
    monkeypatch.setattr(categories, "_invalidate_kind_caches", AsyncMock())
    app.dependency_overrides[current_user] = lambda: {"email": "g347-http@example.test"}
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.patch("/categories/group", json={"name": "Studio", "kind": "excluded", "revision": revision_for(original)})
            assert response.status_code == 200, response.text
            assert response.json() == {"saved": True}
            assert (await client.post("/categories/groups/reset", json={"revision": revision_for(original)})).status_code == 200
            assert (await client.patch("/categories/group", json=[])).status_code == 400
    asyncio.run(run())


def test_unlisted_category_evidence_stays_visible_with_safe_free_default():
    response = response_for([], _shape())
    row = next(row for row in response["rows"] if row["name"] == "Side project")
    assert row["kind"] == "discretionary" and not row["editable"]
    assert row["amount"] == 91
