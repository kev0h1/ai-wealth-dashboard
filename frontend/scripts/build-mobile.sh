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

SCRATCH="$(pwd)/.mobile-build"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
trap 'rm -rf "$SCRATCH"' EXIT

rsync -a --delete \
  --exclude='.next/' \
  --exclude='.next-mobile/' \
  --exclude='.mobile-build/' \
  --exclude='out/' \
  --exclude='node_modules/' \
  --exclude='.git/' \
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

# MOBILE_API_BASE lets CI (or a local override) point the built app at a
# different backend. Falls back to UAT when unset — Kevin's standing rule is
# that Android APK builds always bake the UAT API base by default; only an
# explicit MOBILE_API_BASE override (see package.json's build:mobile:prod,
# used by the Codemagic/TestFlight iOS pipeline) bakes prod.
# NEXT_PUBLIC_WEB_PRODUCT is forced "on" here (backlog A10's web-only-shell
# flag) so a mobile export can never be built locked, regardless of what's
# set in the calling environment.
(cd "$SCRATCH" && MOBILE_EXPORT=1 NEXT_PUBLIC_WEB_PRODUCT=on NEXT_PUBLIC_API_URL="${MOBILE_API_BASE:-https://uat.wealth.auriqltd.co.uk/api}" next build)

# Copy the export output back to the real, expected location (frontend/out —
# see capacitor-spike/ANDROID_PUSH.md step 4: `cp -r out/* ../capacitor-spike/www/`,
# run from frontend/). $SCRATCH is removed by the trap above on exit.
rm -rf out
cp -r "$SCRATCH/out" out
