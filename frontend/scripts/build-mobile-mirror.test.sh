#!/usr/bin/env bash
# A115: exercise the real mirror/link/export flow with rsync, but stub Next
# so this check never builds the app or touches installed dependencies.
# H107 already fixed the exclusion; a trailing slash would copy a worktree's
# node_modules symlink and let ln write through it into the shared target.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
FIXTURE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/build-mobile-mirror.XXXXXX")"
trap 'rm -rf "$FIXTURE_ROOT"' EXIT

mkdir -p "$FIXTURE_ROOT/bin"
cat > "$FIXTURE_ROOT/bin/next" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
[[ "$#" -eq 1 && "$1" = "build" ]]
# The mirror must link to the source, including when that source is itself
# a symlink. Copying that symlink would instead point straight at its target.
[[ -L node_modules && "$(readlink node_modules)" = "$EXPECTED_DEPENDENCY_LINK" ]]
[[ "$(cat node_modules/sentinel)" = "original dependencies" ]]
[[ ! -e node_modules/node_modules && ! -L node_modules/node_modules ]]
[[ -f ../shared/src/index.ts ]]
mkdir -p out
printf '%s' 'fixture export' > out/index.html
STUB
chmod +x "$FIXTURE_ROOT/bin/next"

for layout in directory symlink; do
  project="$FIXTURE_ROOT/$layout/frontend"
  mkdir -p "$project/scripts" "$project/app" "$FIXTURE_ROOT/$layout/shared/src"
  cp "$SCRIPT_DIR/build-mobile.sh" "$project/scripts/build-mobile.sh"
  printf '%s' '{}' > "$project/package.json"
  touch "$project/next.config.ts" "$FIXTURE_ROOT/$layout/shared/src/index.ts"
  for provider in finexer nordigen truelayer yapily; do
    mkdir -p "$project/app/auth/$provider/callback"
    printf '%s\n' 'const BACKEND = process.env.BACKEND_URL || "http://localhost:8000";' \
      > "$project/app/auth/$provider/callback/route.ts"
  done

  if [[ "$layout" = "symlink" ]]; then
    dependencies="$FIXTURE_ROOT/$layout/shared-dependencies"
    mkdir -p "$dependencies"
    ln -s "$dependencies" "$project/node_modules"
  else
    dependencies="$project/node_modules"
    mkdir -p "$dependencies"
  fi
  printf '%s' 'original dependencies' > "$dependencies/sentinel"

  if ! PATH="$FIXTURE_ROOT/bin:$PATH" \
    BUILD_MOBILE_GUARD_ONLY=0 NEXT_PUBLIC_BUILD_TAG=fixture NEXT_PUBLIC_RELEASE_SHA=fixture \
    EXPECTED_DEPENDENCY_LINK="$project/node_modules" \
    bash "$project/scripts/build-mobile.sh" > "$FIXTURE_ROOT/$layout.log" 2>&1; then
    cat "$FIXTURE_ROOT/$layout.log" >&2
    echo "FAIL: $layout dependency mirror/export failed" >&2
    exit 1
  fi

  [[ "$(cat "$project/out/index.html")" = "fixture export" ]]
  [[ ! -e "$project/.mobile-build" ]]
  [[ "$(cat "$dependencies/sentinel")" = "original dependencies" ]]
  [[ "$(ls -A "$dependencies")" = "sentinel" ]]
  if [[ "$layout" = "symlink" ]]; then
    [[ -L "$project/node_modules" && "$(readlink "$project/node_modules")" = "$dependencies" ]]
  else
    [[ -d "$project/node_modules" && ! -L "$project/node_modules" ]]
  fi
  echo "PASS: $layout dependencies reused, export copied, scratch cleaned, source untouched"
done
