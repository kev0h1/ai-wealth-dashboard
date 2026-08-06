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
# So: temporarily inject the literal into the 4 OAuth callback route files,
# run the static export build, then always restore the original files —
# leaving the working tree byte-identical to before the script ran and the
# normal `npm run build` path completely untouched.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FILES=(
  "app/auth/finexer/callback/route.ts"
  "app/auth/nordigen/callback/route.ts"
  "app/auth/truelayer/callback/route.ts"
  "app/auth/yapily/callback/route.ts"
)

cleanup() {
  for f in "${FILES[@]}"; do
    if [ -f "$f.mobile-orig" ]; then
      mv -f "$f.mobile-orig" "$f"
    fi
  done
}
trap cleanup EXIT

for f in "${FILES[@]}"; do
  cp "$f" "$f.mobile-orig"
  # Insert a literal `export const dynamic = "force-static";` right after the
  # BACKEND const line. Runtime code in each GET handler already short-circuits
  # with a 204 before touching any request-specific dynamic API when
  # MOBILE_EXPORT=1, so this is safe to statically prerender.
  perl -0pi -e 's/(const BACKEND = process\.env\.BACKEND_URL \|\| "http:\/\/localhost:8000";\n)/$1\nexport const dynamic = "force-static";\n/' "$f"
done

MOBILE_EXPORT=1 NEXT_PUBLIC_API_URL=https://wealth.auriqltd.co.uk/api next build
