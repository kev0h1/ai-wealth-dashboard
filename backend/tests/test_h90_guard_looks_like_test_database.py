"""H90/H96 (2026-09-28): `_looks_like_a_test_database` (backend/tests/
conftest.py) is the fail-hard guard that decides whether the backend
suite -- specifically its destructive session-end teardown -- is even
allowed to touch a given Mongo database name. H96: during re-review of
this branch, a reviewer MUTATED this function in conftest.py to accept
the literal "wealth", then ran `MONGO_DB=wealth pytest`; the mutated
guard let the real teardown through and it dropped the real UAT
database (restored from backup; ~5h40m of data lost). The guard's
COMMITTED logic was correct -- it was the mutation that did the damage
-- but the incident exposed that this function had ZERO dedicated test
coverage anywhere, so a one-line typo or a bad merge reaching this same
function would be invisible until it destroyed something. This file is
that missing coverage.

Every assertion below calls `_looks_like_a_test_database` DIRECTLY, as a
pure `str -> bool` function, imported unmodified from the genuine
`tests.conftest` module -- never by setting `MONGO_DB` and running the
suite (that is the exact mechanism that caused H96), and never against
a copy of the function edited in place in conftest.py itself. The one
exception is `test_a_deliberately_broken_copy_would_have_caught_this`,
which proves this test file can actually fail: it builds its OWN
throwaway broken copy of the predicate, inline, in this test's own
local scope, and confirms the SAME assertions this file's other tests
carry would fail against it -- conftest.py's real function is never
touched.
"""
import conftest


# The accept/refuse table. `wealth` -> False is the one row that must
# NEVER change: it is the literal name of the real UAT/production
# database, and this is the only thing standing between a misconfigured
# or mutated guard and a repeat of H96.
CASES = [
    ("wealth", False),
    ("wealth_test", True),
    ("wealth_test_1735400000_deadbeef", True),
    ("wealth_backup_test", True),
    ("wealth_test_backup", True),
    ("wealth_testing", False),          # anchor bug (H96 review finding 2): was True
    ("wealthtest", False),
    ("wealth_testament", False),        # anchor bug: was True
    ("wealth_testers_prod", False),     # anchor bug: was True
]


def test_wealth_itself_is_never_accepted():
    """Isolated from the table below so this one assertion -- the single
    most important line in this file -- can never be missed scrolling
    past a parametrized table."""
    assert conftest._looks_like_a_test_database("wealth") is False


def test_accept_refuse_table():
    failures = []
    for name, expected in CASES:
        actual = conftest._looks_like_a_test_database(name)
        if actual is not expected:
            failures.append(f"{name!r}: expected {expected}, got {actual}")
    assert not failures, "\n".join(failures)


def test_a_deliberately_broken_copy_would_have_caught_this():
    """Proves this test file is capable of catching the exact class of
    bug H96 was: a broken predicate that accepts everything, including
    "wealth". Builds the broken version INLINE, in this test's own local
    scope only -- conftest.py's real `_looks_like_a_test_database` is
    never edited, imported-and-reassigned, or monkeypatched here."""
    def _broken_accepts_everything(name: str) -> bool:
        return True

    would_have_failed = [
        name for name, expected in CASES
        if _broken_accepts_everything(name) is not expected
    ]
    # "wealth" alone is expected False, so the broken copy disagrees with
    # it (and with every other False row) -- proving a function this
    # broken would have failed this file's own table.
    assert would_have_failed, (
        "a predicate that accepts everything should have disagreed with "
        "at least one row of CASES -- if it didn't, CASES itself has a "
        "bug, since it contains rows expected False."
    )
    assert "wealth" in would_have_failed
