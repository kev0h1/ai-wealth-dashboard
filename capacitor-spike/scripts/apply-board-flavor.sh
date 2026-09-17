#!/usr/bin/env bash
#
# apply-board-flavor.sh — patch the generated Capacitor Android project
# (capacitor-spike/android/, gitignored, wiped by `npx cap add android`) so
# it builds two Gradle product flavours: "sorted" (Sorted, applicationId
# co.uk.auriqltd.sorted, unchanged) and "board" (Board, applicationId
# co.uk.auriqltd.sorted.board, H66).
#
# Run any time after `npx cap add android` and (if setting up push from
# scratch) after setup-android-push.sh, which is what first restores
# google-services.json and applies the google-services plugin in its
# legacy conditional form. This script re-shapes that into flavour-aware
# form. Safe to re-run — every patch is grep-guarded.
#
# Why the board flavour needs special handling for google-services:
# capacitor-spike/google-services.json only has client entries for
# co.uk.auriqltd.sorted and co.uk.auriqltd.wealth. The Google Services
# Gradle plugin (com.google.gms.google-services 4.4.4) always includes the
# module root (app/google-services.json) as a fallback search location for
# EVERY variant, but only gates a build failure through the configurable
# missingGoogleServicesStrategy when NO file is found anywhere for that
# variant — if a file IS found but its applicationId isn't inside it, the
# plugin throws unconditionally regardless of that strategy setting
# (verified 2026-09-17 by decompiling google-services-4.4.4.jar's
# GoogleServicesTask.action(): the "No matching client found for package
# name" branch is not gated by the strategy switch, only the "file missing
# entirely" branch is). So this script:
#   1. moves google-services.json out of the module root into the
#      "sorted" flavour's own source set (app/src/sorted/google-services.json)
#      so the board variant's search finds nothing at all, and
#   2. sets missingGoogleServicesStrategy = WARN so that "nothing found"
#      case is a graceful skip (board ships with no Firebase project, by
#      design — no push notifications in the Board app) instead of a
#      config-time Gradle failure.
# Sorted's own variant still finds its json (now flavour-scoped) and is
# validated exactly as before.
#
# See ../ANDROID_PUSH.md and README.md for the wider Android build flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${SPIKE_DIR}/android"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"
ROOT_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/google-services.json"
SORTED_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/src/sorted/google-services.json"
CANONICAL_GOOGLE_SERVICES_JSON="${SPIKE_DIR}/google-services.json"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: ${ANDROID_DIR} does not exist. Run 'npx cap add android' first." >&2
  exit 1
fi
if [[ ! -f "${APP_GRADLE}" ]]; then
  echo "ERROR: ${APP_GRADLE} not found." >&2
  exit 1
fi

# --- 1. app/build.gradle: import the plugin's enum type ---
if grep -q "import com.google.gms.googleservices.GoogleServicesPlugin" "${APP_GRADLE}"; then
  echo "[1/4] app/build.gradle: GoogleServicesPlugin import already present — skipping."
else
  # Prepend via Python, not bash `$(cat ...)` command substitution — the
  # latter strips the file's trailing newline, which then breaks step 3's
  # regex (it requires a trailing \n after the legacy block's final `}`).
  python3 - "${APP_GRADLE}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
content = "import com.google.gms.googleservices.GoogleServicesPlugin\n\n" + content
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "[1/4] app/build.gradle: added GoogleServicesPlugin import."
fi

# --- 2. app/build.gradle: flavorDimensions + productFlavors ---
if grep -q "productFlavors" "${APP_GRADLE}"; then
  echo "[2/4] app/build.gradle: productFlavors already present — skipping."
else
  python3 - "${APP_GRADLE}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
marker = "android {\n"
idx = content.find(marker)
if idx == -1:
    print("ERROR: could not find 'android {' opening line to anchor insertion", file=sys.stderr)
    sys.exit(1)
insert_at = idx + len(marker)
insertion = (
    "    // H66: Board is a second, distinct app (Kevin, 2026-09-17) — its\n"
    "    // own applicationId, launcher icon and label, no Firebase/push. See\n"
    "    // the googleServices {} block below for why the applicationId split\n"
    "    // needs the google-services.json move to work.\n"
    "    flavorDimensions \"app\"\n"
    "    productFlavors {\n"
    "        sorted {\n"
    "            dimension \"app\"\n"
    "            applicationId \"co.uk.auriqltd.sorted\"\n"
    "        }\n"
    "        board {\n"
    "            dimension \"app\"\n"
    "            applicationId \"co.uk.auriqltd.sorted.board\"\n"
    "        }\n"
    "    }\n"
)
content = content[:insert_at] + insertion + content[insert_at:]
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "[2/4] app/build.gradle: added flavorDimensions \"app\" + productFlavors { sorted, board }."
fi

# --- 3. app/build.gradle: unconditional google-services apply + missingGoogleServicesStrategy ---
if grep -q "missingGoogleServicesStrategy" "${APP_GRADLE}"; then
  echo "[3/4] app/build.gradle: googleServices { missingGoogleServicesStrategy } already present — skipping."
else
  python3 - "${APP_GRADLE}" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

new_block = (
    "\n"
    "// H66: always apply — missingGoogleServicesStrategy below makes a\n"
    "// flavour with no google-services.json anywhere (board) a graceful\n"
    "// no-op instead of a config-time failure, while sorted's\n"
    "// flavour-scoped src/sorted/google-services.json still resolves and\n"
    "// is validated normally (see this script's header comment).\n"
    "apply plugin: 'com.google.gms.google-services'\n"
    "googleServices {\n"
    "    missingGoogleServicesStrategy = GoogleServicesPlugin.MissingGoogleServicesStrategy.WARN\n"
    "}\n"
)

# Legacy conditional block, as written by setup-android-push.sh step 4 (or
# a stock Capacitor template's own equivalent).
legacy_pattern = re.compile(
    r"\ntry \{\s*\n"
    r"\s*def servicesJSON = file\('google-services\.json'\)\s*\n"
    r"\s*if \(servicesJSON\.text\) \{\s*\n"
    r"\s*apply plugin: 'com\.google\.gms\.google-services'\s*\n"
    r"\s*\}\s*\n"
    r"\} catch\(Exception e\) \{\s*\n"
    r".*?\n"
    r"\}\n?",
    re.DOTALL,
)

if legacy_pattern.search(content):
    content = legacy_pattern.sub(new_block, content, count=1)
    action = "replaced legacy conditional apply block with"
elif "apply plugin: 'com.google.gms.google-services'" in content:
    # Some other, non-legacy conditional shape (e.g. a plugins{} id form) —
    # don't guess at removing it, just add the missing strategy config.
    content = content.rstrip("\n") + "\n" + (
        "\ngoogleServices {\n"
        "    missingGoogleServicesStrategy = GoogleServicesPlugin.MissingGoogleServicesStrategy.WARN\n"
        "}\n"
    )
    action = "plugin already applied elsewhere; appended"
else:
    content = content.rstrip("\n") + "\n" + new_block
    action = "appended"

with open(path, "w") as f:
    f.write(content)
print(action)
PYEOF
  echo "[3/4] app/build.gradle: applied google-services unconditionally + set missingGoogleServicesStrategy = WARN."
fi

# --- 4. Move google-services.json from module root into src/sorted/ ---
if [[ -f "${SORTED_GOOGLE_SERVICES_JSON}" ]]; then
  echo "[4/4] google-services.json: already at ${SORTED_GOOGLE_SERVICES_JSON} — skipping."
elif [[ -f "${ROOT_GOOGLE_SERVICES_JSON}" ]]; then
  mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
  mv "${ROOT_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
  echo "[4/4] google-services.json: moved module root -> ${SORTED_GOOGLE_SERVICES_JSON}."
elif [[ -f "${CANONICAL_GOOGLE_SERVICES_JSON}" ]]; then
  mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
  cp "${CANONICAL_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
  echo "[4/4] google-services.json: restored from canonical copy directly to ${SORTED_GOOGLE_SERVICES_JSON}."
else
  echo "[4/4] google-services.json: not found anywhere (module root, ${SORTED_GOOGLE_SERVICES_JSON}, or canonical). Run setup-android-push.sh first." >&2
  exit 1
fi

echo
echo "Board flavour Gradle setup complete. Next: apply-icons.sh, apply-board-icons.sh, build-board-web-assets.sh, npx cap sync android."
