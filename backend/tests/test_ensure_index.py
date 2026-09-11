"""Unit tests for app.main._ensure_index / _normalise_index_key — the
startup index-creation wrapper added after B20's incident: an earlier
version of the broadcasts index block asked Mongo for two indexes on the
same key (`broadcasts.created_at`) under different names, which Mongo
always rejects as IndexOptionsConflict (code 85), and since `_create_indexes`
runs unguarded as its own `@app.on_event("startup")` handler, the raised
exception took the whole API down — confirmed against live (empty) UAT
collections in this session, not just here.

No real Mongo here: `_FakeCollection` mimics just enough of
AsyncIOMotorCollection's async interface (create_index, index_information,
drop_index, .name) to exercise the wrapper's control flow, including
scripting a raised OperationFailure on demand.
"""
import asyncio
import logging

from pymongo.errors import OperationFailure

import app.main as main


class _FakeCollection:
    """`existing_indexes` seeds index_information() (always includes
    `_id_`, matching real Mongo). `fail_next_create`, if set, is raised
    (once) by the next create_index() call instead of succeeding — the
    knob used to script an IndexOptionsConflict or any other failure."""

    def __init__(self, name, existing_indexes=None, fail_next_create=None):
        self.name = name
        self._indexes = {"_id_": {"key": [("_id", 1)]}}
        if existing_indexes:
            self._indexes.update(existing_indexes)
        self._fail_next_create = fail_next_create
        self.create_calls: list = []
        self.drop_calls: list = []

    async def create_index(self, keys, **kwargs):
        self.create_calls.append((keys, kwargs))
        if self._fail_next_create is not None:
            exc = self._fail_next_create
            self._fail_next_create = None
            raise exc
        name = kwargs.get("name") or "_".join(
            f"{k}_{d}" for k, d in main._normalise_index_key(keys)
        )
        spec = {"key": main._normalise_index_key(keys)}
        spec.update({k: v for k, v in kwargs.items() if k != "name"})
        self._indexes[name] = spec
        return name

    async def index_information(self):
        return dict(self._indexes)

    async def drop_index(self, name):
        self.drop_calls.append(name)
        self._indexes.pop(name, None)


def _conflict(existing_name="created_at_1", requested_name="broadcast_ttl"):
    return OperationFailure(
        f'An equivalent index already exists with a different name and options. '
        f'Requested index: {{ key: {{ created_at: 1 }}, name: "{requested_name}" }}, '
        f'existing index: {{ key: {{ created_at: 1 }}, name: "{existing_name}" }}',
        code=85,
    )


def run(coro):
    return asyncio.run(coro)


# ── _normalise_index_key ──────────────────────────────────────────────────

def test_normalise_index_key_bare_string():
    assert main._normalise_index_key("created_at") == [("created_at", 1)]


def test_normalise_index_key_list_of_pairs():
    assert main._normalise_index_key([("user_id", 1), ("date", -1)]) == [("user_id", 1), ("date", -1)]


def test_normalise_index_key_list_of_lists_matches_pairs():
    # index_information() reports keys as lists of [field, direction], not tuples.
    assert main._normalise_index_key([["user_id", 1]]) == main._normalise_index_key([("user_id", 1)])


# ── reconciliation on IndexOptionsConflict (code 85) ──────────────────────

def test_reconciles_index_options_conflict_reproducing_the_b20_incident(caplog):
    """Exactly the B20 shape: a plain, auto-named index already sits on
    `created_at`; the intended call wants a differently-named TTL index on
    the SAME key. Must drop the stale one and create the intended one,
    not raise."""
    col = _FakeCollection(
        "broadcasts",
        existing_indexes={"created_at_1": {"key": [("created_at", 1)]}},
        fail_next_create=_conflict(),
    )
    with caplog.at_level(logging.ERROR, logger="app.startup"):
        run(main._ensure_index(col, "created_at", expireAfterSeconds=31536000, name="broadcast_ttl"))

    assert col.drop_calls == ["created_at_1"]
    assert "created_at_1" not in run(col.index_information())
    info = run(col.index_information())
    assert info["broadcast_ttl"]["key"] == [("created_at", 1)]
    assert info["broadcast_ttl"]["expireAfterSeconds"] == 31536000
    # Loud, not silent: an ERROR record naming the collection and index.
    assert any(
        r.levelno == logging.ERROR and "broadcasts" in r.message and "broadcast_ttl" in r.message
        for r in caplog.records
    )


def test_reconciliation_never_touches_an_unrelated_index():
    """The drop must be scoped to the exact key pattern being recreated,
    never a broad sweep of the collection's other indexes."""
    col = _FakeCollection(
        "broadcast_receipts",
        existing_indexes={
            "created_at_1": {"key": [("created_at", 1)]},
            "user_id_1_read_at_1": {"key": [("user_id", 1), ("read_at", 1)]},
        },
        fail_next_create=_conflict(),
    )
    run(main._ensure_index(col, "created_at", expireAfterSeconds=1, name="broadcast_ttl"))
    assert col.drop_calls == ["created_at_1"]
    assert "user_id_1_read_at_1" in run(col.index_information())  # untouched


def test_second_call_after_reconciliation_is_a_noop_not_an_error():
    """Idempotency: once the intended index exists, running the same
    _ensure_index call again must not conflict, drop, or raise."""
    col = _FakeCollection(
        "broadcasts",
        existing_indexes={"created_at_1": {"key": [("created_at", 1)]}},
        fail_next_create=_conflict(),
    )
    run(main._ensure_index(col, "created_at", expireAfterSeconds=31536000, name="broadcast_ttl"))
    assert col.drop_calls == ["created_at_1"]

    run(main._ensure_index(col, "created_at", expireAfterSeconds=31536000, name="broadcast_ttl"))
    assert col.drop_calls == ["created_at_1"]  # no second drop — nothing to reconcile


# ── general failures must never abort startup ─────────────────────────────

def test_general_operation_failure_is_logged_and_swallowed(caplog):
    col = _FakeCollection("whatever", fail_next_create=OperationFailure("no permission", code=13))
    with caplog.at_level(logging.ERROR, logger="app.startup"):
        run(main._ensure_index(col, "some_field"))  # must not raise
    assert any(r.levelno == logging.ERROR and "whatever" in r.message for r in caplog.records)


def test_unexpected_exception_is_logged_and_swallowed(caplog):
    class _BoomCollection(_FakeCollection):
        async def create_index(self, keys, **kwargs):
            raise RuntimeError("connection reset")

    col = _BoomCollection("whatever")
    with caplog.at_level(logging.ERROR, logger="app.startup"):
        run(main._ensure_index(col, "some_field"))  # must not raise
    assert any(r.levelno == logging.ERROR and "whatever" in r.message for r in caplog.records)


def test_reconciliation_failure_itself_is_logged_and_swallowed(caplog):
    """If even the reconciled create_index fails, that must also be caught
    and logged — never a second unguarded exception."""

    class _StillBrokenCollection(_FakeCollection):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self._calls = 0

        async def create_index(self, keys, **kwargs):
            self._calls += 1
            if self._calls == 1:
                raise _conflict()
            raise OperationFailure("still broken", code=85)

    col = _StillBrokenCollection(
        "broadcasts", existing_indexes={"created_at_1": {"key": [("created_at", 1)]}}
    )
    with caplog.at_level(logging.ERROR, logger="app.startup"):
        run(main._ensure_index(col, "created_at", expireAfterSeconds=1, name="broadcast_ttl"))  # must not raise
    assert any(r.levelno == logging.ERROR for r in caplog.records)


def test_successful_creation_needs_no_reconciliation():
    col = _FakeCollection("fresh_collection")
    run(main._ensure_index(col, "user_id", unique=True))
    assert col.drop_calls == []
    assert run(col.index_information())["user_id_1"]["key"] == [("user_id", 1)]
