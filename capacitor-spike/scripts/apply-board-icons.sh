#!/usr/bin/env bash
#
# apply-board-icons.sh — generate the Android launcher icon set for the
# "Board" flavour (H66), a distinct colourway of the settle mark used by
# Sorted's own apply-icons.sh, so the two apps are never confused
# mid-scroll in the launcher / app switcher.
#
# Unlike apply-icons.sh this writes ONLY into the board flavour's own
# resource overlay (android/app/src/board/res/), never into src/main/res,
# so Sorted's real icon set is completely untouched. It only overrides the
# three per-density raster mipmaps (ic_launcher.png, ic_launcher_round.png,
# ic_launcher_foreground.png); it deliberately does NOT write the adaptive
# icon XML or the background colour resource, because both are unchanged
# from Sorted (same #0F172A Midnight Canvas background) and Gradle's
# resource merger already lets a flavour source set override individual
# mipmap entries by name while inheriting everything else from src/main.
#
# Board is Android-only (no iOS build requested for H66), so there is no
# iOS section here, unlike apply-icons.sh.
#
# Idempotent: safe to re-run any time, including after `npx cap add
# android` wipes and regenerates capacitor-spike/android/ back to stock
# (src/board/ is a Capacitor-agnostic overlay dir that `cap add android`
# does not create or know about, so it needs the same re-apply step as
# Sorted's own icons after a fresh `cap add android`).
#
# Run from capacitor-spike/:
#   bash scripts/apply-board-icons.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ASSETS_DIR="$SPIKE_DIR/assets"
RES_DIR="$SPIKE_DIR/android/app/src/board/res"

SRC_ICON="$ASSETS_DIR/icon-board.png"
SRC_FOREGROUND="$ASSETS_DIR/icon-board-foreground.png"

for f in "$SRC_ICON" "$SRC_FOREGROUND"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing source asset: $f" >&2
    exit 1
  fi
done

if [[ ! -d "$SPIKE_DIR/android" ]]; then
  echo "Android project not present — skipping Board icons (run npx cap add android first)"
  exit 0
fi

if ! command -v convert >/dev/null 2>&1; then
  echo "ERROR: ImageMagick 'convert' not found on PATH" >&2
  exit 1
fi

echo "Source icon:       $SRC_ICON"
echo "Source foreground:  $SRC_FOREGROUND"
echo "Target res dir:     $RES_DIR (board flavour overlay only)"
echo

declare -A LAUNCHER_SIZES=(
  [mdpi]=48
  [hdpi]=72
  [xhdpi]=96
  [xxhdpi]=144
  [xxxhdpi]=192
)

declare -A FOREGROUND_SIZES=(
  [mdpi]=108
  [hdpi]=162
  [xhdpi]=216
  [xxhdpi]=324
  [xxxhdpi]=432
)

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "== Legacy launcher icons (ic_launcher.png, ic_launcher_round.png) =="
for density in "${!LAUNCHER_SIZES[@]}"; do
  size="${LAUNCHER_SIZES[$density]}"
  out_dir="$RES_DIR/mipmap-$density"
  mkdir -p "$out_dir"

  square_out="$out_dir/ic_launcher.png"
  convert "$SRC_ICON" -resize "${size}x${size}" -strip "$square_out"
  echo "wrote $square_out (${size}x${size})"

  mask="$TMP_DIR/mask-$density.png"
  convert -size "${size}x${size}" xc:none -fill white \
    -draw "circle $((size/2)),$((size/2)) $((size/2)),0" "$mask"

  round_out="$out_dir/ic_launcher_round.png"
  convert "$SRC_ICON" -resize "${size}x${size}" -strip "$TMP_DIR/icon-$density.png"
  convert "$TMP_DIR/icon-$density.png" "$mask" -alpha off -compose CopyOpacity -composite -strip "$round_out"
  echo "wrote $round_out (${size}x${size}, circular mask)"
done
echo

echo "== Adaptive icon foreground layer (ic_launcher_foreground.png) =="
for density in "${!FOREGROUND_SIZES[@]}"; do
  size="${FOREGROUND_SIZES[$density]}"
  out_dir="$RES_DIR/mipmap-$density"
  mkdir -p "$out_dir"
  fg_out="$out_dir/ic_launcher_foreground.png"
  convert "$SRC_FOREGROUND" -resize "${size}x${size}" -strip "$fg_out"
  echo "wrote $fg_out (${size}x${size})"
done
echo

echo "Done. Board flavour launcher icon set written under src/board/res/ (adaptive-icon XML, background colour and round-icon XML all inherit unchanged from src/main/res)."
