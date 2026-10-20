#!/usr/bin/env bash
#
# apply-icons.sh — regenerate the Android launcher icon set from the real
# brand assets in capacitor-spike/assets/, replacing the stock Capacitor/
# Android placeholder icons (teal grid background, green robot foreground).
#
# Idempotent: safe to re-run any time, including after `npx cap add android`
# wipes and regenerates capacitor-spike/android/ back to stock icons.
#
# Run from capacitor-spike/:
#   bash scripts/apply-icons.sh
#
# Portable to macOS (C28): Codemagic runs the Android workflows on mac_mini_m2,
# where /bin/bash is 3.2 (no associative arrays, no ${var^^}) and ImageMagick
# may be installed as `magick` only. Keep this file bash-3.2 clean.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SPIKE_DIR/.." && pwd)"

ASSETS_DIR="$SPIKE_DIR/assets"
RES_DIR="$SPIKE_DIR/android/app/src/main/res"

SRC_ICON="$ASSETS_DIR/icon.png"
SRC_FOREGROUND="$ASSETS_DIR/icon-foreground.png"
SRC_BACKGROUND="$ASSETS_DIR/icon-background.png"

echo
echo "== iOS app icons (copy-only — no ImageMagick required on CI builders) =="

IOS_DIR="$SPIKE_DIR/ios"
XCASSETS_DIR="$IOS_DIR/App/App/Assets.xcassets"
APPICON_DIR="$XCASSETS_DIR/AppIcon.appiconset"
IOS_CONTENTS_JSON="$APPICON_DIR/Contents.json"
SRC_IOS_ICON="$ASSETS_DIR/ios-AppIcon-1024.png"

if [[ ! -d "$XCASSETS_DIR" ]]; then
  echo "iOS project not present (no Assets.xcassets) — skipping iOS icons (re-run after npx cap add ios)"
  IOS_STATUS="skipped (no ios/ project)"
else
  if [[ ! -f "$SRC_IOS_ICON" ]]; then
    echo "ERROR: missing pre-rendered iOS icon: $SRC_IOS_ICON" >&2
    exit 1
  fi

  rm -rf "$APPICON_DIR"
  mkdir -p "$APPICON_DIR"
  cp "$SRC_IOS_ICON" "$APPICON_DIR/AppIcon-512@2x.png"
  echo "copied $SRC_IOS_ICON -> $APPICON_DIR/AppIcon-512@2x.png (copy-only, no convert)"

  cat > "$IOS_CONTENTS_JSON" <<'JSONEOF'
{
  "images" : [
    {
      "filename" : "AppIcon-512@2x.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
JSONEOF
  echo "wrote $IOS_CONTENTS_JSON (universal AppIcon-512@2x.png, copy-only)"

  echo
  echo "Done. iOS app icon set copied from pre-rendered brand asset (no ImageMagick/cairosvg dependency)."
  IOS_STATUS="applied"
fi

for f in "$SRC_ICON" "$SRC_FOREGROUND" "$SRC_BACKGROUND"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing source asset: $f" >&2
    exit 1
  fi
done

echo
if [[ -d "$RES_DIR" ]]; then
  if ! command -v convert >/dev/null 2>&1; then
    if command -v magick >/dev/null 2>&1; then
      # ImageMagick 7 without the legacy `convert` link: same arguments.
      convert() { magick "$@"; }
    else
      echo "ERROR: ImageMagick 'convert' (or 'magick') not found on PATH" >&2
      exit 1
    fi
  fi

  echo "Source icon:       $SRC_ICON"
  echo "Source foreground:  $SRC_FOREGROUND"
  echo "Source background:  $SRC_BACKGROUND"
  echo "Target res dir:     $RES_DIR"
  echo

  # density list, and density -> size lookups. Plain functions rather than
  # `declare -A` associative arrays, which need bash 4 (macOS ships 3.2).
  DENSITIES="mdpi hdpi xhdpi xxhdpi xxxhdpi"

  # density -> legacy launcher icon size (ic_launcher / ic_launcher_round)
  launcher_size() {
    case "$1" in
      mdpi) echo 48 ;;
      hdpi) echo 72 ;;
      xhdpi) echo 96 ;;
      xxhdpi) echo 144 ;;
      xxxhdpi) echo 192 ;;
      *) echo "ERROR: unknown density $1" >&2; return 1 ;;
    esac
  }

  # density -> adaptive-icon foreground layer size (108dp canvas @ each density)
  foreground_size() {
    case "$1" in
      mdpi) echo 108 ;;
      hdpi) echo 162 ;;
      xhdpi) echo 216 ;;
      xxhdpi) echo 324 ;;
      xxxhdpi) echo 432 ;;
      *) echo "ERROR: unknown density $1" >&2; return 1 ;;
    esac
  }

  # Upper-case a hex string without ${var^^} (bash 4 only).
  upper() { printf '%s' "$1" | tr 'a-f' 'A-F'; }

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT

  echo "== Legacy launcher icons (ic_launcher.png, ic_launcher_round.png) =="
  for density in $DENSITIES; do
    size="$(launcher_size "$density")"
    out_dir="$RES_DIR/mipmap-$density"
    mkdir -p "$out_dir"

    # Square icon
    square_out="$out_dir/ic_launcher.png"
    convert "$SRC_ICON" -resize "${size}x${size}" -strip "$square_out"
    echo "wrote $square_out (${size}x${size})"

    # Round icon: resize, then punch a circular alpha mask over it.
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
  for density in $DENSITIES; do
    size="$(foreground_size "$density")"
    out_dir="$RES_DIR/mipmap-$density"
    mkdir -p "$out_dir"
    fg_out="$out_dir/ic_launcher_foreground.png"
    convert "$SRC_FOREGROUND" -resize "${size}x${size}" -strip "$fg_out"
    echo "wrote $fg_out (${size}x${size})"
  done
  echo

  echo "== Adaptive icon background =="

  # Sample several points across the background source to determine whether
  # it's a single flat colour or a gradient/textured image. A truly flat PNG
  # will report exactly 1 unique colour; allow a tiny tolerance in case of
  # compression noise by also comparing a handful of sample pixels.
  UNIQUE_COLORS="$(convert "$SRC_BACKGROUND" -format %k info:)"

  IS_FLAT=0
  FLAT_HEX=""
  if [[ "$UNIQUE_COLORS" -le 1 ]]; then
    IS_FLAT=1
    FLAT_HEX="$(convert "$SRC_BACKGROUND" -format "%[hex:p{0,0}]" info: | cut -c1-6)"
  else
    # Double-check with corner/centre samples in case of a near-flat image
    # with a handful of anti-aliasing pixels.
    SAMPLES=$(for xy in "0,0" "1023,0" "0,1023" "1023,1023" "512,512"; do
      x="${xy%,*}"; y="${xy#*,}"
      convert "$SRC_BACKGROUND" -format "%[hex:p{$x,$y}]" info:
      echo
    done | sort -u | wc -l)
    if [[ "$SAMPLES" -eq 1 ]]; then
      IS_FLAT=1
      FLAT_HEX="$(convert "$SRC_BACKGROUND" -format "%[hex:p{0,0}]" info: | cut -c1-6)"
    fi
  fi

  VALUES_XML="$RES_DIR/values/ic_launcher_background.xml"
  ICON_XML="$RES_DIR/mipmap-anydpi-v26/ic_launcher.xml"
  ROUND_XML="$RES_DIR/mipmap-anydpi-v26/ic_launcher_round.xml"

  if [[ "$IS_FLAT" -eq 1 ]]; then
    echo "Background is FLAT: #$(upper "$FLAT_HEX") ($UNIQUE_COLORS unique colour(s))"

    mkdir -p "$RES_DIR/values"
    cat > "$VALUES_XML" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#$(upper "$FLAT_HEX")</color>
</resources>
EOF
    echo "wrote $VALUES_XML (#$(upper "$FLAT_HEX"))"

    # Clean up any previously-generated background PNGs from a prior
    # non-flat run, and point the adaptive XMLs back at the colour resource.
    for density in $DENSITIES; do
      bg_png="$RES_DIR/mipmap-$density/ic_launcher_background.png"
      [[ -f "$bg_png" ]] && rm -f "$bg_png" && echo "removed stale $bg_png"
    done

    for xml in "$ICON_XML" "$ROUND_XML"; do
      cat > "$xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
EOF
      echo "wrote $xml (background=@color/ic_launcher_background)"
    done
  else
    echo "Background is NOT flat ($UNIQUE_COLORS unique colours) — treating as a gradient/image."
    echo "Generating per-density ic_launcher_background.png instead of a flat colour."

    for density in $DENSITIES; do
      size="$(foreground_size "$density")"
      out_dir="$RES_DIR/mipmap-$density"
      mkdir -p "$out_dir"
      bg_out="$out_dir/ic_launcher_background.png"
      convert "$SRC_BACKGROUND" -resize "${size}x${size}" -strip "$bg_out"
      echo "wrote $bg_out (${size}x${size})"
    done

    for xml in "$ICON_XML" "$ROUND_XML"; do
      cat > "$xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
EOF
      echo "wrote $xml (background=@mipmap/ic_launcher_background)"
    done

    # Keep the colour resource around as a harmless fallback (unused by the
    # adaptive XMLs in this branch, but referenced nowhere else either) —
    # set it to the top-left brand colour so it's never a stray stock white.
    TOPLEFT_HEX="$(convert "$SRC_BACKGROUND" -format "%[hex:p{0,0}]" info: | cut -c1-6)"
    mkdir -p "$RES_DIR/values"
    cat > "$VALUES_XML" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#$(upper "$TOPLEFT_HEX")</color>
</resources>
EOF
    echo "wrote $VALUES_XML (#$(upper "$TOPLEFT_HEX"), fallback only, unused by adaptive XML in gradient mode)"
  fi

  echo
  echo "Done. Launcher icon set regenerated from brand assets."
  ANDROID_STATUS="applied"
else
  echo "Android project not present — skipping Android icons (run npx cap add android first)"
  ANDROID_STATUS="skipped (no android/ project)"
fi

echo
echo "Summary: iOS=$IOS_STATUS, Android=$ANDROID_STATUS"
