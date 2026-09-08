#!/usr/bin/env bash
# Unit test for build-mobile.sh's directory guard (see the 2026-09-08
# incident comment near the top of build-mobile.sh: a copy of that script
# run from /tmp once `cd`'d to `/` and started mirroring the root
# filesystem into /.mobile-build).
#
# This sources build-mobile.sh with BUILD_MOBILE_GUARD_ONLY=1, which makes
# it return right after defining require_project_dir(), before touching
# the filesystem at all (no rm/mkdir/trap/rsync ever runs here) — so this
# test never needs to copy the script elsewhere to reproduce the bad-cwd
# scenario; it just calls the guard function directly with a bad and a
# good directory.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"

BUILD_MOBILE_GUARD_ONLY=1
export BUILD_MOBILE_GUARD_ONLY
source "$SCRIPT_DIR/build-mobile.sh"
unset BUILD_MOBILE_GUARD_ONLY
# build-mobile.sh does `set -euo pipefail`; since it was sourced, that
# setting leaked into this shell. Turn errexit back off so this test can
# check exit codes itself instead of dying on the first non-zero one.
set +e

fail=0

require_project_dir /tmp >/dev/null 2>&1
status=$?
if [ "$status" -ne 2 ]; then
  echo "FAIL: require_project_dir /tmp exited $status, expected 2"
  fail=1
else
  echo "PASS: require_project_dir /tmp exits 2 (no package.json/next.config.ts/app there)"
fi

require_project_dir "$FRONTEND_DIR" >/dev/null 2>&1
status=$?
if [ "$status" -ne 0 ]; then
  echo "FAIL: require_project_dir $FRONTEND_DIR exited $status, expected 0"
  fail=1
else
  echo "PASS: require_project_dir $FRONTEND_DIR exits 0"
fi

require_project_dir / >/dev/null 2>&1
status=$?
if [ "$status" -ne 2 ]; then
  echo "FAIL: require_project_dir / exited $status, expected 2"
  fail=1
else
  echo "PASS: require_project_dir / exits 2"
fi

# ── compute_build_tag (C10: BUILD_TAG_ENV prefix for the login/lock-screen
# whisper, set by codemagic.yaml so a UAT and a prod TestFlight build are
# visibly told apart on device) ────────────────────────────────────────────

check_tag() {
  local desc="$1" expected="$2"; shift 2
  local actual
  actual="$(compute_build_tag "$@")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: compute_build_tag $desc -> '$actual', expected '$expected'"
    fail=1
  else
    echo "PASS: compute_build_tag $desc -> '$actual'"
  fi
}

check_tag "date+sha only" "build 2026-09-08 abc1234" "2026-09-08" "abc1234"
check_tag "date+sha+number" "build 2026-09-08 abc1234 #42" "2026-09-08" "abc1234" "42"
check_tag "date+sha+env prefix" "uat build 2026-09-08 abc1234" "2026-09-08" "abc1234" "" "uat"
check_tag "date+sha+number+env prefix (uat)" "uat build 2026-09-08 abc1234 #42" "2026-09-08" "abc1234" "42" "uat"
check_tag "date+sha+number+env prefix (prod)" "prod build 2026-09-08 abc1234 #7" "2026-09-08" "abc1234" "7" "prod"
check_tag "empty number is same as unset" "build 2026-09-08 abc1234" "2026-09-08" "abc1234" ""

if [ "$fail" -ne 0 ]; then
  echo "build-mobile-guard.test.sh: FAILED"
  exit 1
fi

echo "build-mobile-guard.test.sh: all checks passed"
