#!/usr/bin/env python3
"""H105 guard: the backend tests must not rot on the calendar.

Runs a curated subset of backend/tests with the app clock faked to
today+60, today+180 and today+365 (sequentially, never in parallel, to
stay inside the host memory budget) and fails on any test failure. The
subset is every test file that reads or sets a clock (timeutil, date.today,
datetime.now/utcnow) -- the files that can drift. `--full` runs the whole
suite at each date instead (about 3 minutes per date; weekly, see
docs/ops/HOST.md). `--dates A,B` overrides the dates.

Uses backend/scripts/run_suite_at_date.py and the opt-in
backend/tests/_plugins/fake_clock.py plugin; both only fake the clock, no
product code is touched. Always runs against a throwaway wealth_test_* DB.
"""
import re
import subprocess
import sys
import time
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
RUNNER = BACKEND / "scripts" / "run_suite_at_date.py"
CLOCK_RE = re.compile(r"timeutil|date\.today\(|datetime\.(now|utcnow)\(")


def subset() -> list[str]:
    return sorted(
        str(p.relative_to(BACKEND))
        for p in (BACKEND / "tests").glob("test_*.py")
        if CLOCK_RE.search(p.read_text(errors="ignore"))
    )


def main() -> int:
    argv = sys.argv[1:]
    full = "--full" in argv
    dates = None
    if "--dates" in argv:
        dates = argv[argv.index("--dates") + 1].split(",")
    if dates is None:
        base = date.today()
        dates = [(base + timedelta(days=n)).isoformat() for n in (60, 180, 365)]
    targets = ["tests"] if full else subset()
    print(f"check_future_dates: {'full suite' if full else f'{len(targets)} clock-sensitive files'} at {', '.join(dates)}")
    bad = []
    for d in dates:
        t0 = time.time()
        rc = subprocess.call([sys.executable, str(RUNNER), d, *targets], cwd=BACKEND)
        print(f"  {d}: {'ok' if rc == 0 else 'FAILED'} in {time.time() - t0:.0f}s")
        if rc != 0:
            bad.append(d)
    if bad:
        print(f"check_future_dates: FAILED at {', '.join(bad)}. A test is bound to the real calendar: "
              "freeze it (tests/_clock.py pin_user_today) or derive its dates from timeutil.user_today().")
        return 1
    print("check_future_dates: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
