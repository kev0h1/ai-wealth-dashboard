#!/usr/bin/env python3
"""Run the backend pytest suite with the app clock faked to a given date (H105).

    backend/.venv/bin/python backend/scripts/run_suite_at_date.py 2026-12-15 [pytest args...]

Defaults to the whole `tests` directory. Always uses a throwaway
wealth_test_* database (never `wealth`), mirroring scripts/session.sh finish.
"""
import os
import random
import subprocess
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    day, args = sys.argv[1], sys.argv[2:] or ["tests"]
    env = dict(os.environ)
    env["FAKE_DATE"] = day
    env["MONGO_DB"] = f"wealth_test_{int(time.time())}_{random.getrandbits(32):08x}"
    env["PYTHONPATH"] = str(BACKEND) + os.pathsep + env.get("PYTHONPATH", "")
    cmd = [sys.executable, "-m", "pytest", "-q", "-p", "tests._plugins.fake_clock", *args]
    return subprocess.call(cmd, cwd=BACKEND, env=env)


if __name__ == "__main__":
    sys.exit(main())
