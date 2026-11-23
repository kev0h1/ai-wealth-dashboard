"""H159: each pytest-xdist worker gets its own disposable database.

Pure function checks on synthetic names only. Nothing here touches Mongo or
points any guard at a real database."""
import pytest

from app.db.guard import TEST_DB_NAME_RE, DropDatabaseRefused, assert_drop_allowed
from tests.conftest import (
    _GENERATED_TEST_DB_RE,
    _looks_like_a_test_database,
    _worker_db_name,
)

BASE = "wealth_test_1700000000_ab12cd34"


def test_distinct_workers_get_distinct_names():
    names = {_worker_db_name(BASE, f"gw{i}") for i in range(8)}
    assert len(names) == 8
    assert _worker_db_name(BASE, "gw0") == f"{BASE}_gw0"


@pytest.mark.parametrize("worker", ["gw0", "gw1", "gw17", "master"])
def test_each_name_passes_every_guard_pattern(worker):
    name = _worker_db_name(BASE, worker)
    assert _looks_like_a_test_database(name)
    assert TEST_DB_NAME_RE.match(name)
    assert_drop_allowed(name, env={})  # raises if the drop guard would refuse


@pytest.mark.parametrize("worker", ["gw0", "gw12"])
def test_generated_name_regex_covers_worker_names_for_the_sweep(worker):
    m = _GENERATED_TEST_DB_RE.match(_worker_db_name(BASE, worker))
    assert m and m.group(1) == "1700000000"


def test_worker_suffix_cannot_smuggle_unsafe_characters():
    name = _worker_db_name(BASE, "gw0; ../x")
    assert name == f"{BASE}_gw0x"
    with pytest.raises(ValueError):
        _worker_db_name(BASE, "  ")


def test_a_bare_non_test_base_is_still_refused_by_the_guards():
    # A synthetic name only: the helper must never turn a non-test base
    # into something the guards accept.
    name = _worker_db_name("notwealth", "gw0")
    assert not _looks_like_a_test_database(name)
    with pytest.raises(DropDatabaseRefused):
        assert_drop_allowed(name, env={})
