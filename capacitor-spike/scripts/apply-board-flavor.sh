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
# validated exactly as before — and app/build.gradle additionally carries
# an explicit, unconditional check that throws if that file is missing, so
# Sorted alone keeps the old "won't build without it" fatality that
# missingGoogleServicesStrategy=WARN would otherwise have loosened project
# -wide (see step 3 below; review finding P2/FIX3, 2026-09-17).
#
# Presence-check-before-patch ordering (review finding P2/FIX3, 2026-09-17):
# mirrors setup-android-push.sh's own documented
# invariant ("the google-services.json presence check runs BEFORE the
# plugin is ever applied... because applying the plugin without the JSON
# file present is a hard config-time error on every subsequent Gradle
# run"). This script now checks/restores the json FIRST (step 2) and only
# then patches build.gradle's plugin-apply block (step 3) — reversed from
# an earlier version of this script, which could leave build.gradle
# holding the unconditional-apply-plus-WARN patch even when no json was
# found anywhere, silently shipping a "signed AAB, push dead" build.
#
# See ../ANDROID_PUSH.md and README.md for the wider Android build flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${SPIKE_DIR}/android"
PROJECT_GRADLE="${ANDROID_DIR}/build.gradle"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"
ROOT_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/google-services.json"
SORTED_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/src/sorted/google-services.json"
CANONICAL_GOOGLE_SERVICES_JSON="${SPIKE_DIR}/google-services.json"
BOARD_STRINGS_XML="${ANDROID_DIR}/app/src/board/res/values/strings.xml"

# Single source of truth for Board's applicationId — passed into both the
# productFlavors block (step 1) and src/board/res/values/strings.xml
# (step 4) so the two can never drift apart.
BOARD_APPLICATION_ID="co.uk.auriqltd.sorted.board"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: ${ANDROID_DIR} does not exist. Run 'npx cap add android' first." >&2
  exit 1
fi
if [[ ! -f "${APP_GRADLE}" ]]; then
  echo "ERROR: ${APP_GRADLE} not found." >&2
  exit 1
fi

# --- 1. app/build.gradle: flavorDimensions + productFlavors ---
if grep -q "productFlavors" "${APP_GRADLE}"; then
  echo "[1/5] app/build.gradle: productFlavors already present — skipping."
else
  python3 - "${APP_GRADLE}" "${BOARD_APPLICATION_ID}" <<'PYEOF'
import sys
path, board_app_id = sys.argv[1], sys.argv[2]
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
    "    // Non-deprecated list-assignment form — the space-call form\n"
    "    // (flavorDimensions \"app\") is removed in AGP 9.\n"
    "    flavorDimensions = [\"app\"]\n"
    "    productFlavors {\n"
    "        sorted {\n"
    "            dimension \"app\"\n"
    "            applicationId \"co.uk.auriqltd.sorted\"\n"
    "        }\n"
    f"        board {{\n"
    f"            dimension \"app\"\n"
    f"            applicationId \"{board_app_id}\"\n"
    f"        }}\n"
    "    }\n"
)
content = content[:insert_at] + insertion + content[insert_at:]
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "[1/5] app/build.gradle: added flavorDimensions = [\"app\"] + productFlavors { sorted, board }."
fi

# --- 2. google-services.json presence check + restore/move ---
# MUST run before step 3 (plugin apply + strategy config), same invariant
# setup-android-push.sh documents for its own step 3/4 ordering: applying
# the plugin (or loosening it to WARN) before confirming the file exists
# anywhere would leave a build.gradle that silently ships push-dead,
# signed release AABs with a green build.
if [[ -f "${SORTED_GOOGLE_SERVICES_JSON}" ]]; then
  echo "[2/5] google-services.json: already at ${SORTED_GOOGLE_SERVICES_JSON} — skipping."
elif [[ -f "${ROOT_GOOGLE_SERVICES_JSON}" ]]; then
  mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
  mv "${ROOT_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
  echo "[2/5] google-services.json: moved module root -> ${SORTED_GOOGLE_SERVICES_JSON}."
elif [[ -f "${CANONICAL_GOOGLE_SERVICES_JSON}" ]]; then
  mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
  cp "${CANONICAL_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
  echo "[2/5] google-services.json: restored from canonical copy directly to ${SORTED_GOOGLE_SERVICES_JSON}."
else
  cat >&2 <<EOF

ERROR: neither ${ROOT_GOOGLE_SERVICES_JSON}
nor ${SORTED_GOOGLE_SERVICES_JSON}
nor ${CANONICAL_GOOGLE_SERVICES_JSON} exists.

Not touching app/build.gradle's google-services plugin block until this
is fixed (same invariant setup-android-push.sh follows) — patching it
first would leave Sorted able to produce a signed release AAB with FCM
push silently dead. Run setup-android-push.sh first (it prints the full
Firebase setup steps if the canonical copy is also missing), then re-run
this script.
EOF
  exit 1
fi

# --- 3. app/build.gradle: unconditional google-services apply + missingGoogleServicesStrategy ---
# Only reached once step 2 has confirmed the json exists at the flavour
# -scoped path. Also adds an explicit, unconditional guard that throws if
# that file goes missing later — restoring the "won't build without it"
# fatality for Sorted specifically that a project-wide
# missingGoogleServicesStrategy=WARN would otherwise loosen (Board is
# unaffected: it never wants the file, and its own missing-file case is
# still the graceful WARN branch).
if grep -q "missingGoogleServicesStrategy" "${APP_GRADLE}"; then
  echo "[3/5] app/build.gradle: googleServices { missingGoogleServicesStrategy } already present — skipping."
else
  # The GoogleServicesPlugin enum type this script references must already
  # be on the buildscript classpath (added by setup-android-push.sh step 1,
  # `classpath 'com.google.gms:google-services:...'` in the project-level
  # build.gradle) or the `import` below fails to resolve at Groovy compile
  # time with a much less obvious error.
  if [[ ! -f "${PROJECT_GRADLE}" ]] || ! grep -q "com.google.gms:google-services:" "${PROJECT_GRADLE}"; then
    echo "ERROR: com.google.gms:google-services classpath not found in ${PROJECT_GRADLE}." >&2
    echo "Run setup-android-push.sh first (its step 1 adds that classpath), then re-run this script." >&2
    exit 1
  fi

  if grep -q "import com.google.gms.googleservices.GoogleServicesPlugin" "${APP_GRADLE}"; then
    echo "      (GoogleServicesPlugin import already present)"
  else
    # Prepend via Python, not bash `$(cat ...)` command substitution — the
    # latter strips the file's trailing newline, which breaks the regex
    # below (it requires a trailing \n after the legacy block's final `}`).
    python3 - "${APP_GRADLE}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
content = "import com.google.gms.googleservices.GoogleServicesPlugin\n\n" + content
with open(path, "w") as f:
    f.write(content)
PYEOF
    echo "      (added GoogleServicesPlugin import)"
  fi

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
    "\n"
    "// Restore fatality for Sorted specifically: WARN above is what lets\n"
    "// Board ship with no Firebase project by design, but Sorted's FCM\n"
    "// push must not be able to go silently dead behind a green build.\n"
    "// Board is unaffected — it never looks for this file.\n"
    "if (!file('src/sorted/google-services.json').exists()) {\n"
    "    throw new GradleException(\n"
    "        \"app/src/sorted/google-services.json is missing. Sorted's FCM push \" +\n"
    "        \"needs it; run scripts/setup-android-push.sh (from capacitor-spike/) \" +\n"
    "        \"to restore it from the canonical copy.\"\n"
    "    )\n"
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
    # don't guess at removing it, just add the missing strategy config +
    # fatality guard.
    content = content.rstrip("\n") + "\n" + (
        "\ngoogleServices {\n"
        "    missingGoogleServicesStrategy = GoogleServicesPlugin.MissingGoogleServicesStrategy.WARN\n"
        "}\n"
        "\n"
        "if (!file('src/sorted/google-services.json').exists()) {\n"
        "    throw new GradleException(\n"
        "        \"app/src/sorted/google-services.json is missing. Sorted's FCM push \" +\n"
        "        \"needs it; run scripts/setup-android-push.sh (from capacitor-spike/) \" +\n"
        "        \"to restore it from the canonical copy.\"\n"
        "    )\n"
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
  echo "[3/5] app/build.gradle: applied google-services unconditionally, set missingGoogleServicesStrategy = WARN, added Sorted-only fatality guard."
fi

# --- 4. src/board/res/values/strings.xml: app_name, title, ids ---
# Without this, Board inherits src/main/res/values/strings.xml's
# app_name ("Sorted") verbatim — since android/ is gitignored and this
# whole flavour only exists via these scripts, a missing step here means
# a freshly regenerated project produces a Board app LABELLED SORTED: two
# identically named icons on the home screen, the exact confusion Kevin
# asked H66 to avoid (review finding P1/FIX1, 2026-09-17).
if grep -q "^\s*<string name=\"app_name\">Board</string>" "${BOARD_STRINGS_XML}" 2>/dev/null; then
  echo "[4/5] src/board/res/values/strings.xml: app_name=Board already present — skipping."
else
  mkdir -p "$(dirname "${BOARD_STRINGS_XML}")"
  cat > "${BOARD_STRINGS_XML}" <<XMLEOF
<?xml version='1.0' encoding='utf-8'?>
<resources>
    <string name="app_name">Board</string>
    <string name="title_activity_main">Board</string>
    <string name="package_name">${BOARD_APPLICATION_ID}</string>
    <string name="custom_url_scheme">${BOARD_APPLICATION_ID}</string>
</resources>
XMLEOF
  echo "[4/5] src/board/res/values/strings.xml: wrote app_name/title_activity_main=Board, package_name/custom_url_scheme=${BOARD_APPLICATION_ID}."
fi

# --- 5. app/build.gradle: verifyBoardWebAssets task, wired into Board's preBuild ---
# build-board-web-assets.sh copies capacitor-spike/www into
# src/board/assets/public/ as a one-off manual step; `npx cap sync
# android` only ever refreshes Sorted's src/main/assets/public/, so the
# ordinary "edit frontend, rebuild www, cap sync, gradlew" loop leaves
# Board's copy silently stale with no signal (review finding P2/FIX4,
# 2026-09-17). This task compares a content hash of capacitor-spike/www
# against the stamp build-board-web-assets.sh writes at
# src/board/.www-stamp, and fails loudly on a mismatch instead of shipping
# a stale Board build.
if grep -q "verifyBoardWebAssets" "${APP_GRADLE}"; then
  echo "[5/5] app/build.gradle: verifyBoardWebAssets task already present — skipping."
else
  cat >> "${APP_GRADLE}" <<'GRADLEEOF'

// H66 (review finding P2/FIX4, 2026-09-17): see build-board-web-assets.sh's
// header comment for why this exists. Wired into every Board variant's
// preBuild so it cannot be skipped by forgetting a manual step.
tasks.register('verifyBoardWebAssets') {
    doLast {
        def wwwDir = file('../../www')
        def stampFile = file('src/board/.www-stamp')
        if (!stampFile.exists()) {
            throw new GradleException(
                "src/board/.www-stamp is missing. Run scripts/build-board-web-assets.sh " +
                "(from capacitor-spike/) before building a Board variant."
            )
        }
        if (!wwwDir.exists()) {
            throw new GradleException(
                "capacitor-spike/www is missing. Build the export first (see README.md), " +
                "then run scripts/build-board-web-assets.sh (from capacitor-spike/)."
            )
        }
        def proc = ["bash", "-c",
            "find '${wwwDir}' -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum"
        ].execute()
        def out = proc.text
        proc.waitFor()
        if (proc.exitValue() != 0) {
            throw new GradleException("verifyBoardWebAssets: hash command failed (exit ${proc.exitValue()})")
        }
        def currentHash = out.trim().split(/\s+/)[0]
        def stampedHash = stampFile.text.trim()
        if (currentHash != stampedHash) {
            throw new GradleException(
                "Board's bundled web export (src/board/assets/public/) is stale: " +
                "capacitor-spike/www has changed since scripts/build-board-web-assets.sh " +
                "last ran (stamped ${stampedHash}, currently ${currentHash}). Re-run " +
                "scripts/build-board-web-assets.sh (from capacitor-spike/) before building " +
                "a Board variant."
            )
        }
    }
}

afterEvaluate {
    tasks.matching { it.name ==~ /pre(Board)(Debug|Release)Build/ }.configureEach {
        dependsOn 'verifyBoardWebAssets'
    }
}
GRADLEEOF
  echo "[5/5] app/build.gradle: added verifyBoardWebAssets task, wired into preBoard{Debug,Release}Build."
fi

echo
echo "Board flavour Gradle + label setup complete. Next: apply-icons.sh, apply-board-icons.sh, build-board-web-assets.sh, npx cap sync android."
