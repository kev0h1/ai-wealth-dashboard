"""H94 (review round on H90, 2026-09-28): concurrent backend suite runs
against this VPS's one local mongod must never see or destroy each
other's data. The independent review reproduced this directly: H90
shipped a single shared literal database name, "wealth_test", for every
run, so on a host that ran seven `session.sh finish` gates (plus an
`integrate` pass) in one morning, one session's session-end teardown
(`drop_database("wealth_test")`) could and did drop another session's
still-in-flight fixtures mid-test -- a new flaky-failure mode versus
`main`, where nothing ever dropped anything at all.

This test reproduces that collision mechanically with two real `pytest`
subprocesses (not a mock of concurrency): worker A
(tests/_h94_worker_write_then_wait.py) writes a marker doc and then waits
~2s before re-reading it; worker B
(tests/_h94_worker_quick_finish.py) is a single trivial assertion that
finishes near-instantly, landing its own session-end teardown squarely
inside worker A's wait window. Both processes are launched with MONGO_DB
scrubbed from their environment, exactly like two independent `session.sh
finish` invocations (or two ad-hoc `pytest` runs) that never coordinate a
database name with each other -- each is left to its own conftest.py
default.

Before H94 (both workers defaulting to the same literal "wealth_test"),
worker B's teardown drops worker A's database out from under it and
worker A's own assertion fails: this test is RED on that code. Since H94
(each worker's conftest.py generates its own "wealth_test_<epoch>_<hex>"
name), the two never collide: GREEN.
"""
import os
import subprocess
import time
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _TESTS_DIR.parent
_VENV_PYTHON = _BACKEND_DIR / ".venv" / "bin" / "python"
_WORKER_A = _TESTS_DIR / "_h94_worker_write_then_wait.py"
_WORKER_B = _TESTS_DIR / "_h94_worker_quick_finish.py"

# Worker A sleeps this long after writing its marker (see that file) --
# worker B is started well inside that window and, being a single trivial
# assertion, reliably finishes (and fires its own teardown) long before
# it elapses; this constant exists here too only so the "well inside"
# claim in the comments below is checkable against a real number.
_WORKER_A_WAIT_SECONDS = 2.0
_START_B_AFTER_SECONDS = 0.5


def _env_without_mongo_db() -> dict:
    """Two independent runs never coordinate a database name with each
    other in real life (two separate `session.sh finish` invocations, or
    an ad-hoc `pytest` run overlapping either) -- scrub MONGO_DB from what
    each subprocess inherits so each one's own conftest.py default runs
    fresh, rather than accidentally inheriting THIS orchestrating test's
    own already-chosen per-run database name, which would make both
    workers share one name for a reason that has nothing to do with the
    bug this test is about."""
    env = dict(os.environ)
    env.pop("MONGO_DB", None)
    return env


def test_two_concurrent_runs_do_not_collide():
    env = _env_without_mongo_db()

    proc_a = subprocess.Popen(
        [str(_VENV_PYTHON), "-m", "pytest", "-q", str(_WORKER_A)],
        cwd=_BACKEND_DIR, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    # Give worker A time to start, write its marker, and enter its own
    # wait before worker B even starts, so worker B's quick finish (and
    # its own teardown) lands inside worker A's wait window rather than
    # racing its startup.
    time.sleep(_START_B_AFTER_SECONDS)

    proc_b = subprocess.run(
        [str(_VENV_PYTHON), "-m", "pytest", "-q", str(_WORKER_B)],
        cwd=_BACKEND_DIR, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        timeout=30,
    )
    out_a, _ = proc_a.communicate(timeout=30)

    assert proc_b.returncode == 0, f"worker B itself failed unexpectedly:\n{proc_b.stdout}"
    assert proc_a.returncode == 0, (
        f"worker A failed -- see H94: its marker doc was almost "
        f"certainly wiped mid-test by a concurrent run's teardown "
        f"dropping a shared database name:\n{out_a}"
    )
