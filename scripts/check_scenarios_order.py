#!/usr/bin/env python3
"""H143: run the scenario suite after the files that once polluted it.

tests/test_scenarios.py must pass whatever ran before it. The known
polluters (tests that patched db_collections while a lazy import bound the
fake as a module handle) are run first, in the exact order that failed in the
G374 review. No pytest-randomly or pytest-reverse is installed and none is
added; this ordered run is the standing check. Uses a disposable
wealth_test_* database, never the real one.
"""
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
ORDER = [
    "tests/test_g362_landed_income.py",
    "tests/test_payday_plan_fixes.py",
    "tests/test_scenarios.py",
    "tests/test_scenarios_order.py",
]


def main() -> int:
    db = os.environ.get("MONGO_DB") or f"wealth_test_{int(time.time())}_{secrets.token_hex(4)}"
    if not db.startswith("wealth_test_"):
        print(f"refusing MONGO_DB={db!r}: must start with wealth_test_", file=sys.stderr)
        return 2
    env = dict(os.environ, MONGO_DB=db)
    py = BACKEND / ".venv" / "bin" / "python"
    cmd = [str(py if py.exists() else sys.executable), "-m", "pytest", "-q", "-p", "no:cacheprovider", *ORDER]
    return subprocess.call(cmd, cwd=BACKEND, env=env)


if __name__ == "__main__":
    sys.exit(main())
