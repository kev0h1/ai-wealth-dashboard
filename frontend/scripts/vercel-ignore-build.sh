#!/usr/bin/env bash
# Vercel "Ignored Build Step" for the Sorted frontend project (H115).
#
# Vercel contract: exit 0 = SKIP the build, exit 1 = BUILD.
#
# Why: Vercel was building a preview for every push to every branch (about
# 100 deployments a day, ~80% board-only "backlog:" commits), which cost
# $58.24 of Build CPU in one month. UAT runs on the VPS and only the
# `release` branch is production, so no preview is used.
#
# Modes (env VERCEL_IGNORE_MODE, default "release"):
#   release (ACTIVE DEFAULT)  build only when VERCEL_GIT_COMMIT_REF is
#                             `release`; every other branch is skipped.
#   diff    (secondary)       build `release` always; for any other branch
#                             build only if the last commit touches
#                             frontend/ or shared/. Use this if previews of
#                             feature branches are ever wanted again.
#
# `release` ALWAYS builds in both modes: scripts/release.py deploy/rollback
# push `release` and then poll for a Ready production deployment at that sha,
# so skipping a release build (e.g. a backend-only release) would time out
# the release. Fail-safe: anything unknown (empty ref, no HEAD^ in a shallow
# clone, unknown mode) builds rather than skips.
#
# Wired from frontend/vercel.json ("ignoreCommand"); the Vercel project root
# directory is `frontend`, so the command there is `bash scripts/vercel-ignore-build.sh`
set -u

ref="${VERCEL_GIT_COMMIT_REF:-}"
mode="${VERCEL_IGNORE_MODE:-release}"

if [ -z "$ref" ] || [ "$ref" = "release" ]; then
  echo "vercel-ignore-build: ref='${ref}' -> BUILD"
  exit 1
fi

case "$mode" in
  release)
    echo "vercel-ignore-build: ref='${ref}' is not release -> SKIP"
    exit 0
    ;;
  diff)
    top="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "no git -> BUILD"; exit 1; }
    cd "$top" || exit 1
    if ! git rev-parse --verify -q HEAD^ >/dev/null; then
      echo "vercel-ignore-build: HEAD^ unavailable (shallow clone) -> BUILD"
      exit 1
    fi
    if git diff --quiet HEAD^ HEAD -- frontend shared; then
      echo "vercel-ignore-build: no frontend/ or shared/ change -> SKIP"
      exit 0
    fi
    echo "vercel-ignore-build: frontend/ or shared/ changed -> BUILD"
    exit 1
    ;;
  *)
    echo "vercel-ignore-build: unknown mode '${mode}' -> BUILD"
    exit 1
    ;;
esac
