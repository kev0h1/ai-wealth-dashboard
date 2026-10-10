#!/usr/bin/env bash
# Tests for scripts/vercel-ignore-build.sh (H115). Run: bash scripts/test_vercel_ignore_build.sh
set -u
S="$(cd "$(dirname "$0")/../frontend/scripts" && pwd)/vercel-ignore-build.sh"
fail=0
check() { # name expected_exit actual_exit
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (want $2 got $3)"; fail=1; fi
}
run() { env -u VERCEL_GIT_COMMIT_REF -u VERCEL_IGNORE_MODE "$@" bash "$S" >/dev/null 2>&1; echo $?; }

check "release ref builds"      1 "$(run VERCEL_GIT_COMMIT_REF=release)"
check "main skips"              0 "$(run VERCEL_GIT_COMMIT_REF=main)"
check "feature-x skips"         0 "$(run VERCEL_GIT_COMMIT_REF=feature-x)"
check "empty ref builds"        1 "$(run VERCEL_GIT_COMMIT_REF=)"
check "unknown mode builds"     1 "$(run VERCEL_GIT_COMMIT_REF=main VERCEL_IGNORE_MODE=bogus)"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
(
  cd "$T" && git init -q . && git config user.email t@t && git config user.name t
  mkdir frontend shared backend
  echo a > frontend/a; echo a > shared/a; echo a > backend/a; git add -A; git commit -qm one
  echo b >> backend/a; git commit -qam backend-only
) >/dev/null 2>&1
d() { (cd "$T" && run VERCEL_IGNORE_MODE=diff "$@"); }
check "diff: backend-only skips"      0 "$(d VERCEL_GIT_COMMIT_REF=main)"
check "diff: release builds anyway"   1 "$(d VERCEL_GIT_COMMIT_REF=release)"
(cd "$T" && echo c >> frontend/a && git commit -qam fe) >/dev/null 2>&1
check "diff: frontend change builds"  1 "$(d VERCEL_GIT_COMMIT_REF=main)"
(cd "$T" && echo c >> shared/a && git commit -qam sh) >/dev/null 2>&1
check "diff: shared change builds"    1 "$(d VERCEL_GIT_COMMIT_REF=feature-x)"
S2="$(mktemp -d)"; (cd "$S2" && git init -q . && git config user.email t@t && git config user.name t && echo a>f && git add f && git commit -qm only) >/dev/null 2>&1
check "diff: no HEAD^ builds"         1 "$(cd "$S2" && run VERCEL_IGNORE_MODE=diff VERCEL_GIT_COMMIT_REF=main)"
rm -rf "$S2"
exit $fail
