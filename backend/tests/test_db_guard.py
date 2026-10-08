"""H96: the application-layer database-drop guard and its finish-gate check.

Every test calls the guard function directly with FAKE names. Nothing here
connects to Mongo or touches a real database (see docs/ops/INCIDENTS.md).
"""
from __future__ import annotations

import asyncio
import importlib.util
import shutil
import sys
from pathlib import Path

import pytest

from app.db import guard

REPO = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("name", [
    "wealth_test_1700000000_deadbeef", "wealth_test_b45_proof_1", "wealth_test_x",
])
def test_test_databases_may_be_dropped(name):
    guard.assert_drop_allowed(name, env={})


@pytest.mark.parametrize("name", [
    "wealth", "wealth_test", "wealth_test_", "wealth_testing", "wealth_prod",
    "foo_test_bar", "admin", "wealth_test_x\n", " wealth_test_x", "wealth_test_x y",
    "wealth_test_x-y", "", None, 5,
])
def test_everything_else_is_refused(name):
    with pytest.raises(guard.DropDatabaseRefused) as exc:
        guard.assert_drop_allowed(name, env={})
    assert str(exc.value) == guard._REFUSAL  # static: never echoes the name


def test_override_needs_env_and_the_name_twice():
    on = {"ALLOW_DROP_PROD_DB": "1"}
    for env, confirm in [({}, "wealth"), (on, None), (on, "wealthX"), ({"ALLOW_DROP_PROD_DB": "true"}, "wealth"),
                         ({"ALLOW_DROP_PROD_DB": "0"}, "wealth")]:
        with pytest.raises(guard.DropDatabaseRefused):
            guard.assert_drop_allowed("wealth", confirm, env=env)
    guard.assert_drop_allowed("wealth", "wealth", env=on)
    with pytest.raises(guard.DropDatabaseRefused):
        guard.assert_drop_allowed("", "", env=on)


def test_guarded_drops_refuse_before_touching_the_client():
    class Boom:
        def __getattr__(self, item):  # any client use is a failure
            raise AssertionError("client must not be touched")

        def __getitem__(self, item):
            raise AssertionError("client must not be touched")

    with pytest.raises(guard.DropDatabaseRefused):
        asyncio.run(guard.guarded_drop_database(Boom(), "wealth"))
    with pytest.raises(guard.DropDatabaseRefused):
        asyncio.run(guard.guarded_drop_collection(Boom(), "wealth", "transactions"))


def test_guarded_client_class_refuses_before_any_io():
    calls = []

    class FakeClient:
        """Same drop_database shape as Motor's; records instead of dropping.
        No Motor client is ever constructed in the guard tests."""

        def __init__(self, *args, **kwargs):
            pass

        async def drop_database(self, name_or_database, session=None, comment=None):
            calls.append(name_or_database)

    client = guard.make_guarded_client_class(FakeClient)()

    async def go():
        with pytest.raises(guard.DropDatabaseRefused):
            await client.drop_database("wealth")
        with pytest.raises(guard.DropDatabaseRefused):
            await client.drop_database("wealth", confirm_name="wealth")  # env flag unset
        await client.drop_database("wealth_test_1_ab")

    asyncio.run(go())
    assert calls == ["wealth_test_1_ab"]


def test_app_client_is_the_guarded_one():
    from app.db import collections

    assert type(collections._mongo).__name__ == "GuardedMotorClient"


# --- scripts/check_db_guard.py ------------------------------------------------


def _load_check():
    spec = importlib.util.spec_from_file_location("check_db_guard_under_test", REPO / "scripts" / "check_db_guard.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def _mirror(tmp_path: Path) -> Path:
    for rel in ("backend/tests/conftest.py", "backend/app/db/guard.py", "backend/app/db/collections.py"):
        dst = tmp_path / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, dst)
    return tmp_path


def _check_against(mod, root: Path):
    mod.ROOT, mod.CONFTEST = root, root / "backend/tests/conftest.py"
    mod.GUARD, mod.APP = root / "backend/app/db/guard.py", root / "backend/app"
    return mod.check()


def test_check_passes_on_the_real_tree():
    assert _load_check().check() == []


def test_check_fails_when_the_conftest_guard_is_mutated(tmp_path):
    root = _mirror(tmp_path)
    cf = root / "backend/tests/conftest.py"
    cf.write_text(cf.read_text().replace('    if any(ch.isspace() for ch in name):\n        return False\n',
                                         '    if name == "wealth":\n        return True\n', 1))
    problems = _check_against(_load_check(), root)
    assert any("_looks_like_a_test_database" in p and "modified" in p for p in problems)


def test_check_fails_when_the_app_guard_is_mutated_or_bypassed(tmp_path):
    root = _mirror(tmp_path)
    g = root / "backend/app/db/guard.py"
    g.write_text(g.read_text().replace("    raise DropDatabaseRefused()\n", "    return\n", 1))
    assert any("assert_drop_allowed" in p for p in _check_against(_load_check(), root))

    root2 = _mirror(tmp_path / "b")
    cf = root2 / "backend/tests/conftest.py"
    cf.write_text(cf.read_text().replace("await guarded_drop_database(client, name)", "await client.drop_database(name)"))
    problems = _check_against(_load_check(), root2)
    assert any("guarded_drop_database" in p or "raw drop_database" in p for p in problems)
