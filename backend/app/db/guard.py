"""Application-layer guard against dropping a non-test database (H96).

On 2026-09-28 the real UAT database ``wealth`` was dropped when a reviewer
mutated the test suite's DB-name guard in ``backend/tests/conftest.py`` and
ran the suite against it: the mutated guard also gated the session-end
teardown, so the one check was the only check. This is the SECOND,
independent guard, living in application code where editing a test file
cannot weaken it. See docs/ops/INCIDENTS.md.

Rules, enforced by ``assert_drop_allowed`` (every drop in the repo goes
through ``guarded_drop_database`` / ``guarded_drop_collection``, and the app's
own Mongo client refuses ``drop_database`` for a non-test name):

* A database whose name matches ``^wealth_test_[A-Za-z0-9_]+$`` may be dropped.
* Any other name is refused with a static error, unless BOTH the environment
  variable ``ALLOW_DROP_PROD_DB=1`` is set AND the name is passed twice
  (``confirm_name`` equal to ``name``).

``scripts/check_db_guard.py`` hashes this file's guard functions and the
conftest guard so a mutation fails ``session.sh finish``. If you change this
file on purpose, re-pin the hash there in the same commit and say why in the
commit message. Probe this guard by calling ``assert_drop_allowed`` directly
with fake names, never by running anything against a real database.
"""
from __future__ import annotations

import os
import re
from typing import Any, Mapping, Optional

# \Z, not $: "$" also matches before a trailing newline.
TEST_DB_NAME_RE = re.compile(r"^wealth_test_[A-Za-z0-9_]+\Z")
ALLOW_ENV = "ALLOW_DROP_PROD_DB"

_REFUSAL = (
    "refusing to drop a database whose name is not a disposable test database "
    "(wealth_test_*). Dropping anything else needs ALLOW_DROP_PROD_DB=1 and the "
    "name passed twice. See docs/ops/INCIDENTS.md (H96)."
)


class DropDatabaseRefused(RuntimeError):
    """Static message on purpose: it never echoes the name or the environment."""

    def __init__(self) -> None:
        super().__init__(_REFUSAL)


def assert_drop_allowed(
    name: Any,
    confirm_name: Optional[str] = None,
    env: Optional[Mapping[str, str]] = None,
) -> None:
    """Raise DropDatabaseRefused unless dropping ``name`` is allowed."""
    if isinstance(name, str) and TEST_DB_NAME_RE.match(name):
        return
    environ = os.environ if env is None else env
    if (
        isinstance(name, str)
        and name
        and environ.get(ALLOW_ENV) == "1"
        and confirm_name == name
    ):
        return
    raise DropDatabaseRefused()


async def guarded_drop_database(client: Any, name: str, confirm_name: Optional[str] = None) -> None:
    """Drop ``name`` through ``client`` after the guard passes."""
    assert_drop_allowed(name, confirm_name)
    from motor.motor_asyncio import AsyncIOMotorClient

    # Unbound call: bypass GuardedMotorClient.drop_database (already checked).
    await AsyncIOMotorClient.drop_database(client, name)


async def guarded_drop_collection(
    client: Any, db_name: str, collection: str, confirm_name: Optional[str] = None
) -> None:
    """Drop one collection; the guard applies to its database's name."""
    assert_drop_allowed(db_name, confirm_name)
    await client[db_name].drop_collection(collection)


def make_guarded_client_class(base: Any = None):
    """Client subclass whose ``drop_database`` runs the guard first. ``base``
    defaults to Motor's client; tests pass a fake so no client is built."""
    if base is None:
        from motor.motor_asyncio import AsyncIOMotorClient as base

    class GuardedMotorClient(base):
        async def drop_database(self, name_or_database, *args, confirm_name=None, **kwargs):  # type: ignore[override]
            name = getattr(name_or_database, "name", name_or_database)
            assert_drop_allowed(name, confirm_name)
            return await super().drop_database(name_or_database, *args, **kwargs)

    return GuardedMotorClient
