#!/usr/bin/env python3
"""
resolve-google-services-path.py -- the ONE place that decides where
Sorted's google-services.json currently belongs (H66, review round 4,
2026-09-17): app/google-services.json (module root) before the "board"
flavour exists, app/src/sorted/google-services.json once it does.

Why this needs to be a single, callable source of truth rather than a
literal path hardcoded in each of setup-android-push.sh (which restores
the file) and apply-board-flavor.sh (which also restores/migrates it) --
a real defect, found independently by review after two prior rounds
missed it: setup-android-push.sh's restore step (its "step 3") was moved
to the flavour-scoped path by an earlier H66 round, but `app/build.gradle`'s
legacy apply-plugin fallback (the `try { def servicesJSON =
file('google-services.json') ... }` block) still checked the module-root
literal unconditionally. Running setup-android-push.sh ALONE on a fresh
project -- its own original, board-agnostic purpose, wanted by anyone
who just wants Sorted with working push and no Board at all --
restored the file to src/sorted/, while that module-root check found
nothing, silently swallowed the exception (logged at INFO), and the
plugin was never applied at all. Green build, dead FCM push, no error
anywhere. (Review round 5, F4, 2026-09-17: that check is not necessarily
something setup-android-push.sh's own step 4 writes each run -- on this
project's real shape, a stock Capacitor template already ships that
exact block, so step 4's grep guard skips and writes nothing; the
load-bearing half of the original defect was step 3's restore TARGET
disagreeing with whichever copy of that check happened to exist,
regardless of which script put it there.) Two prior review rounds missed
this because both rounds tested with apply-board-flavor.sh always run
somewhere in the sequence, which replaces that whole legacy block with a
flavour-aware, unconditional-apply-plus-WARN pattern before the gap
could surface.

The invariant this script encodes: as long as the "board" flavour
(productFlavors in app/build.gradle) does not exist yet, Gradle has no
"sorted" source set for the google-services plugin to search either, so
the module root is the only location that ever makes sense -- exactly
this project's real, pre-H66 shape. Once the flavour exists, the
flavour-scoped path is correct and the module root must be kept clear
(see apply-board-flavor.sh's own google-services cleanup step). Every
script that needs to know where the file lives calls this one instead of
hardcoding either answer, so the two halves of any script literally
cannot drift out of agreement again.
"""
import sys
from pathlib import Path


def board_flavour_exists(android_dir: Path) -> bool:
    app_gradle = android_dir / "app" / "build.gradle"
    if not app_gradle.exists():
        return False
    return "productFlavors" in app_gradle.read_text()


def resolve(android_dir: Path) -> str:
    """Returns the path, RELATIVE TO android/app/, where
    google-services.json currently belongs."""
    if board_flavour_exists(android_dir):
        return "src/sorted/google-services.json"
    return "google-services.json"


def main():
    if len(sys.argv) != 2:
        print("usage: resolve-google-services-path.py <android-dir>", file=sys.stderr)
        sys.exit(2)
    print(resolve(Path(sys.argv[1])))


if __name__ == "__main__":
    main()
