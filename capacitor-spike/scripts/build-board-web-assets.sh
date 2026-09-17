#!/usr/bin/env bash
#
# build-board-web-assets.sh — populate the Board flavour's own copy of the
# bundled web export (H66).
#
# The Board app must open directly on /ops/go-live instead of Home. Rather
# than bake in a live server.url (which would break the "works from bundled
# assets talking to the API" contract every other build in this project
# relies on, per Kevin's brief), this script copies the SAME static export
# Sorted already ships (capacitor-spike/www — built by
# frontend/scripts/build-mobile.sh, same UAT API base) into the Board
# flavour's own asset overlay (android/app/src/board/assets/public/), then
# replaces ONLY that copy's index.html with a tiny redirect shim to
# /ops/go-live.html (the exact static file Next's export emits for that
# route — see the comment in the redirect HTML below for why the .html
# suffix is deliberate). capacitor-spike/www itself, and Sorted's real
# src/main/assets/public/ (populated by `npx cap sync android`), are never
# touched.
#
# Bundling the whole export for Board (rather than trimming it down to
# just the ops pages) is deliberate for this first version — see H66.
#
# Also writes a Board-scoped android/app/src/board/assets/capacitor.config.json
# override (appId/appName only) so native Capacitor.getPlatform()/App
# plugin calls made from ops pages describe the Board app correctly, not
# Sorted. This is a flavour asset overlay, exactly like the res/ overlay
# apply-board-icons.sh writes: Gradle merges assets/ by relative path with
# flavour taking priority over main, so this file is used only for Board
# variants; Sorted's own src/main/assets/capacitor.config.json (regenerated
# by `npx cap sync android`) is untouched.
#
# Run from capacitor-spike/, AFTER capacitor-spike/www has been built
# (frontend/scripts/build-mobile.sh) and copied into place (see
# ANDROID_PUSH.md step 4). Idempotent: safe to re-run any time, including
# after `npx cap add android` wipes android/ (src/board/ is a
# Capacitor-agnostic overlay dir `cap add android` doesn't know about, so
# it needs the same re-apply step as the icons).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

WWW_DIR="$SPIKE_DIR/www"
BOARD_ASSETS_DIR="$SPIKE_DIR/android/app/src/board/assets"
BOARD_PUBLIC_DIR="$BOARD_ASSETS_DIR/public"

if [[ ! -d "$SPIKE_DIR/android" ]]; then
  echo "Android project not present — skipping Board web assets (run npx cap add android first)"
  exit 0
fi

if [[ ! -d "$WWW_DIR" ]] || [[ -z "$(ls -A "$WWW_DIR" 2>/dev/null)" ]]; then
  echo "ERROR: $WWW_DIR is missing or empty. Build the export first:" >&2
  echo "  cd frontend && npm run build:mobile && rm -rf ../capacitor-spike/www/* && cp -r out/* ../capacitor-spike/www/" >&2
  exit 1
fi

echo "Source export: $WWW_DIR"
echo "Board assets:  $BOARD_PUBLIC_DIR"
echo

rm -rf "$BOARD_PUBLIC_DIR"
mkdir -p "$BOARD_PUBLIC_DIR"
cp -r "$WWW_DIR/." "$BOARD_PUBLIC_DIR/"
echo "copied $(find "$BOARD_PUBLIC_DIR" -type f | wc -l) files from $WWW_DIR"

# Overwrite ONLY this copy's index.html with a redirect shim. The target is
# the exact file Next's static export emits for /ops/go-live
# (capacitor-spike/www/ops/go-live.html — confirmed present, no trailing
# slash / no nested index.html, since this project's next.config.ts does
# not set trailingSlash), not the extensionless "/ops/go-live" path: this
# app's local Capacitor WebViewLocalServer maps request paths to asset
# files by exact name, with no extension-guessing, so the extensionless
# path is not guaranteed to resolve while the literal emitted file always
# will.
cat > "$BOARD_PUBLIC_DIR/index.html" <<'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="0; url=/ops/go-live.html" />
<title>Board</title>
<script>window.location.replace('/ops/go-live.html');</script>
</head>
<body></body>
</html>
HTMLEOF
echo "wrote $BOARD_PUBLIC_DIR/index.html (redirect shim -> /ops/go-live.html)"

mkdir -p "$BOARD_ASSETS_DIR"
cat > "$BOARD_ASSETS_DIR/capacitor.config.json" <<'JSONEOF'
{
  "appId": "co.uk.auriqltd.sorted.board",
  "appName": "Board",
  "webDir": "www",
  "server": {
    "androidScheme": "https"
  }
}
JSONEOF
echo "wrote $BOARD_ASSETS_DIR/capacitor.config.json (Board appId/appName)"

echo
echo "Done. Board flavour web assets written under src/board/assets/ (src/main/assets/public/ untouched)."
