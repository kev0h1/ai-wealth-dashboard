#!/usr/bin/env bash
# Reproducible mobile (Capacitor) static export build.
#
# Why this script exists instead of a plain `next build` in package.json:
# Next.js 16's Turbopack route-segment-config parser only accepts a literal
# string for `export const dynamic = "..."` (see
# node_modules/next/dist/build/analysis/extract-const-value.js) — it cannot
# be a `process.env.X ? "a" : "b"` expression. Static export
# (`output: 'export'`) requires every Route Handler to declare
# `export const dynamic = "force-static"` as a literal, but the normal
# (non-export) web build must NOT declare it (these OAuth callback routes
# read per-request headers/searchParams, so force-static would be wrong for
# the real server and must stay implicit "dynamic", exactly as the routes
# behaved before this mobile work started).
#
# Also: Next.js hardcodes its internal build directory to `.next` relative
# to cwd whenever `output: 'export'` is set — a configured `distDir` gets
# repurposed as the *export* target instead of isolating the internal build
# (see node_modules/next/dist/build/index.js, ~line 452-458). That means a
# static-export `next build` run from frontend/ always writes/overwrites
# frontend/.next, which is exactly the directory the live wealth-frontend
# `next start` server reads from. To avoid clobbering the running site, this
# script mirrors the whole project into a scratch directory and runs the
# entire build there — including the OAuth-callback literal-injection patch,
# which is applied only to the scratch copies below, never to the real files
# in frontend/app/. That means the real route files never need to be touched
# or restored at all.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --------------------------------------------------------------------------
# Directory guard (2026-09-08 incident): a copy of this script run from
# /tmp `cd`'d to `/` (the copy's own dirname resolved outside frontend/),
# and the old unconditional `rm -rf "$SCRATCH"` / `rsync --delete ...
# "$SCRATCH/"` below started mirroring the *root filesystem* into
# /.mobile-build before it was killed. This script must only ever run from
# its own checked-in location inside frontend/, and SCRATCH must never be
# allowed to resolve outside that directory.
#
# require_project_dir is its own function (rather than inline checks) so
# build-mobile-guard.test.sh can source this file with
# BUILD_MOBILE_GUARD_ONLY=1 and exercise it directly, without ever running
# an rm/mkdir/trap/rsync.
require_project_dir() {
  local dir="$1"
  if [ ! -f "$dir/package.json" ] || [ ! -f "$dir/next.config.ts" ] || [ ! -d "$dir/app" ]; then
    echo "error: build-mobile.sh must be run from its own location inside frontend/; resolved $dir" >&2
    return 2
  fi
  return 0
}

# Builds the login/biometric-lock build-tag whisper string (see
# frontend/lib/buildTag.ts and DEPLOY.md's "Build tag" section):
# "build <date> <sha>", with "#<number>" appended when a CI build number is
# known, and "<env> " prepended when BUILD_TAG_ENV is set (the Codemagic
# workflows set it to "uat" or "prod" — see codemagic.yaml — so the two
# TestFlight builds are visibly told apart on device, e.g. "uat build
# 2026-09-08 abc1234 #42" vs "prod build 2026-09-08 abc1234 #7"). Its own
# function (rather than inline) so build-mobile-guard.test.sh can source
# this file with BUILD_MOBILE_GUARD_ONLY=1 and exercise it directly.
compute_build_tag() {
  local date="$1" sha="$2" number="${3:-}" env_prefix="${4:-}"
  local tag="build ${date} ${sha}"
  if [ -n "$number" ]; then
    tag="${tag} #${number}"
  fi
  if [ -n "$env_prefix" ]; then
    tag="${env_prefix} ${tag}"
  fi
  printf '%s' "$tag"
}

if [ "${BUILD_MOBILE_GUARD_ONLY:-}" = "1" ]; then
  # Test-only escape hatch: stop right after defining the guard function
  # and compute_build_tag above, before touching the filesystem at all.
  return 0 2>/dev/null || exit 0
fi

PROJECT_DIR="$(pwd -P)"
require_project_dir "$PROJECT_DIR" || exit 2

SCRATCH="$PROJECT_DIR/.mobile-build"
case "$SCRATCH" in
  "$PROJECT_DIR"/*) ;;
  *)
    echo "error: SCRATCH ($SCRATCH) resolved outside PROJECT_DIR ($PROJECT_DIR); refusing to run" >&2
    exit 2
    ;;
esac
if [ "$PROJECT_DIR" = "/" ]; then
  echo "error: PROJECT_DIR resolved to /; refusing to run" >&2
  exit 2
fi

# Precompute the login/biometric-lock build tag (see frontend/lib/buildTag.ts)
# HERE, before the rsync below. `next.config.ts` normally derives this itself
# at config-load time via `git rev-parse --short HEAD`, but that rsync
# deliberately excludes .git/ (see the big comment above), so `git
# rev-parse` would fail inside the scratch dir. Computing it here, from the
# real repo, and exporting NEXT_PUBLIC_BUILD_TAG makes next.config.ts's
# resolver pick it up verbatim (its case 1) inside the scratch build.
# Codemagic's checkout does have .git, so `git rev-parse` still works there
# too; CM_COMMIT is only a fallback if git itself isn't available.
if [ -z "${NEXT_PUBLIC_BUILD_TAG:-}" ]; then
  BUILD_DATE="$(date -u +%F)"
  CM_COMMIT="${CM_COMMIT:-}"
  BUILD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo "${CM_COMMIT:0:7}")"
  BUILD_SHA="${BUILD_SHA:-nogit}"
  export NEXT_PUBLIC_BUILD_TAG="$(compute_build_tag "$BUILD_DATE" "$BUILD_SHA" "${BUILD_NUMBER:-}" "${BUILD_TAG_ENV:-}")"
fi

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
# Only ever remove SCRATCH itself, and only if it is still under
# PROJECT_DIR — belt and braces alongside the case guard above, in case a
# future edit changes how SCRATCH is computed and forgets to re-check it.
trap '
  if [ -n "${SCRATCH:-}" ]; then
    case "$SCRATCH" in
      "$PROJECT_DIR"/*) rm -rf "$SCRATCH" ;;
    esac
  fi
' EXIT

rsync -a --delete \
  --exclude='.next/' \
  --exclude='.next-mobile/' \
  --exclude='.mobile-build/' \
  --exclude='out/' \
  --exclude='node_modules/' \
  --exclude='.git/' \
  --exclude='.env.local' \
  --exclude='.env*.local' \
  ./ "$SCRATCH/"

# Reuse the already-installed deps instead of reinstalling into the scratch dir.
ln -s "$(pwd)/node_modules" "$SCRATCH/node_modules"

FILES=(
  "app/auth/finexer/callback/route.ts"
  "app/auth/nordigen/callback/route.ts"
  "app/auth/truelayer/callback/route.ts"
  "app/auth/yapily/callback/route.ts"
)

for f in "${FILES[@]}"; do
  # Insert a literal `export const dynamic = "force-static";` right after the
  # BACKEND const line, in the scratch copy only. Runtime code in each GET
  # handler already short-circuits with a 204 before touching any
  # request-specific dynamic API when MOBILE_EXPORT=1, so this is safe to
  # statically prerender.
  perl -0pi -e 's/(const BACKEND = process\.env\.BACKEND_URL \|\| "http:\/\/localhost:8000";\n)/$1\nexport const dynamic = "force-static";\n/' "$SCRATCH/$f"
done

# TrueLayer picker flag (backlog A16): the Accounts "Add" menu's legacy
# "Add Bank via TrueLayer" entry only renders when NEXT_PUBLIC_TRUELAYER_PICKER
# is "on" (see frontend/lib/featureFlags.ts). Mobile builds should show it on
# UAT (day-to-day Android APKs and the ios-capacitor TestFlight workflow) and
# hide it on prod (the ios-capacitor-prod TestFlight workflow and
# build:mobile:prod), matching Vercel prod, which never sets this var. An
# explicit NEXT_PUBLIC_TRUELAYER_PICKER in the calling environment always
# wins; otherwise this defaults "on" unless MOBILE_TARGET=prod (set by the
# ios-capacitor-prod Codemagic workflow, inherited here since it's exported
# at the workflow's environment.vars level) or MOBILE_API_BASE already points
# at a production API base (set by `npm run build:mobile:prod`, see
# package.json — as of A18 that's the Vercel-proxied
# https://wealth.auriqltd.co.uk/api, but https://api.* is matched too so this
# keeps working once A18 lands and the prod base moves back to
# api.wealth.auriqltd.co.uk). The prod branch below sets the flag explicitly
# to "off" rather than leaving it unset: UAT's web build depends on a
# gitignored frontend/.env.local carrying NEXT_PUBLIC_TRUELAYER_PICKER=on
# (also A16), and although the rsync above now excludes .env.local from the
# scratch copy, an explicit "off" is a second guard so a prod build can never
# inherit that value however it arrives.
if [ -z "${NEXT_PUBLIC_TRUELAYER_PICKER:-}" ]; then
  IS_PROD_BUILD=0
  [ "${MOBILE_TARGET:-}" = "prod" ] && IS_PROD_BUILD=1
  case "${MOBILE_API_BASE:-}" in
    https://api.*) IS_PROD_BUILD=1 ;;
    https://wealth.auriqltd.co.uk/api) IS_PROD_BUILD=1 ;;
  esac
  if [ "$IS_PROD_BUILD" = "1" ]; then
    export NEXT_PUBLIC_TRUELAYER_PICKER=off
  else
    export NEXT_PUBLIC_TRUELAYER_PICKER=on
  fi
fi

# MCP connector flag + URL (backlog A17 doctrine; mobile reach fixed by
# F17). Settings' "Connected assistants" card
# (components/ConnectedAssistantsCard.tsx) only renders when
# NEXT_PUBLIC_MCP_CONNECTOR is "on" (frontend/lib/featureFlags.ts's
# MCP_CONNECTOR), and only shows a usable connect address when
# NEXT_PUBLIC_MCP_URL points at the connector (F8's MCP_URL). Before F17,
# neither var could ever reach a mobile bundle: the rsync above excludes
# .env.local (deliberately, H13, so a prod mobile build can't inherit the
# UAT VPS's gitignored frontend/.env.local), and codemagic.yaml set neither
# var, so the card stayed invisible in every mobile build even when the
# build targeted the UAT API, which has the connector enabled. Same
# UAT/prod split and same "explicit env var always wins" precedent as the
# NEXT_PUBLIC_TRUELAYER_PICKER block above: "on" (and UAT's MCP URL) by
# default, both explicitly OFF/unset when the build targets prod
# (MOBILE_TARGET=prod, set by the ios-capacitor-prod Codemagic workflow, or
# MOBILE_API_BASE pointing at a production API base, set by `npm run
# build:mobile:prod`) — production must never show the connector, per A17.
# The explicit-off-for-prod branch is a second guard, same reasoning as
# NEXT_PUBLIC_TRUELAYER_PICKER's: belt and braces alongside the .env.local
# exclusion above, in case a value arrives some other way.
IS_PROD_MOBILE_BUILD=0
[ "${MOBILE_TARGET:-}" = "prod" ] && IS_PROD_MOBILE_BUILD=1
case "${MOBILE_API_BASE:-}" in
  https://api.*) IS_PROD_MOBILE_BUILD=1 ;;
  https://wealth.auriqltd.co.uk/api) IS_PROD_MOBILE_BUILD=1 ;;
esac
if [ "$IS_PROD_MOBILE_BUILD" = "1" ]; then
  export NEXT_PUBLIC_MCP_CONNECTOR=off
  unset NEXT_PUBLIC_MCP_URL
else
  if [ -z "${NEXT_PUBLIC_MCP_CONNECTOR:-}" ]; then
    export NEXT_PUBLIC_MCP_CONNECTOR=on
  fi
  if [ -z "${NEXT_PUBLIC_MCP_URL:-}" ]; then
    export NEXT_PUBLIC_MCP_URL=https://uat.wealth.auriqltd.co.uk/api/mcp
  fi
fi

# MOBILE_API_BASE lets CI (or a local override) point the built app at a
# different backend. Falls back to UAT when unset — Kevin's standing rule is
# that Android APK builds always bake the UAT API base by default; only an
# explicit MOBILE_API_BASE override (see package.json's build:mobile:prod,
# used by the Codemagic/TestFlight iOS pipeline) bakes prod. As of A18
# (api.wealth.auriqltd.co.uk has no DNS record yet, prod is reachable only
# through the Vercel /api rewrite), that base is the Vercel-proxied
# https://wealth.auriqltd.co.uk/api, unlike the eventual/intended
# https://api.wealth.auriqltd.co.uk root — once A18 gives the API its own
# DNS record, package.json's build:mobile:prod should move back to that bare
# domain (no /api suffix: the mobile static export would then talk to the
# backend directly rather than through Vercel's rewrite). The web-facing
# domain (wealth.auriqltd.co.uk) is unaffected by this and keeps hosting the
# Finexer OAuth return URL — that redirect always goes back to a real
# browser context, never the app.
# NEXT_PUBLIC_WEB_PRODUCT is forced "on" here (backlog A10's web-only-shell
# flag) so a mobile export can never be built locked, regardless of what's
# set in the calling environment.
(cd "$SCRATCH" && MOBILE_EXPORT=1 NEXT_PUBLIC_WEB_PRODUCT=on NEXT_PUBLIC_API_URL="${MOBILE_API_BASE:-https://uat.wealth.auriqltd.co.uk/api}" next build)

# Copy the export output back to the real, expected location (frontend/out —
# see capacitor-spike/ANDROID_PUSH.md step 4: `cp -r out/* ../capacitor-spike/www/`,
# run from frontend/). $SCRATCH is removed by the trap above on exit.
rm -rf out
cp -r "$SCRATCH/out" out
