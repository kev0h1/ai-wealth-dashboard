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
# form. Safe to re-run, IN EITHER ORDER relative to setup-android-push.sh,
# any number of times — every patch is grep-guarded, and the one piece of
# state that depends on run order (the wealthdash:// manifest placement,
# see step 2) is delegated to a shared script precisely so it converges
# correctly regardless of order (see ensure-wealthdash-manifest.py).
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
# validated exactly as before — and app/build.gradle additionally registers
# a verifySortedGoogleServices task, wired only into Sorted's own preBuild,
# so Sorted alone keeps the old "won't build without it" fatality that
# missingGoogleServicesStrategy=WARN would otherwise have loosened project
# -wide (see step 4 below; review finding P2/FIX4, 2026-09-17 round 2 —
# an earlier version of this used a bare top-level `if` in app/build.gradle,
# which threw during project configuration on EVERY invocation, including
# assembleBoardDebug, `./gradlew tasks`, `clean` and IDE sync, not just
# when a Sorted variant was actually being built).
#
# Presence-check-before-patch ordering (review finding P2/FIX3, 2026-09-17):
# mirrors setup-android-push.sh's own documented invariant ("the
# google-services.json presence check runs BEFORE the plugin is ever
# applied... because applying the plugin without the JSON file present is
# a hard config-time error on every subsequent Gradle run"). This script
# checks/restores the json (step 3) before patching build.gradle's
# plugin-apply block (step 4).
#
# See ../ANDROID_PUSH.md and README.md for the wider Android build flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${SPIKE_DIR}/android"
PROJECT_GRADLE="${ANDROID_DIR}/build.gradle"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"
ROOT_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/google-services.json"
CANONICAL_GOOGLE_SERVICES_JSON="${SPIKE_DIR}/google-services.json"
BOARD_STRINGS_XML="${ANDROID_DIR}/app/src/board/res/values/strings.xml"

# shellcheck source=board-config.sh
source "${SCRIPT_DIR}/board-config.sh"

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
  echo "[1/6] app/build.gradle: productFlavors already present — skipping."
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
  echo "[1/6] app/build.gradle: added flavorDimensions = [\"app\"] + productFlavors { sorted, board }."
fi

# --- 2. wealthdash:// manifest placement ---
# Delegated to a shared, order-independent script also called from
# setup-android-push.sh (review finding P1/FIX1, 2026-09-17 round 2): see
# ensure-wealthdash-manifest.py's own header comment for the full
# reasoning. Run here, AFTER step 1, so that if this is the first time
# productFlavors has ever been added (this call), the check that script
# does for "does the board flavour exist right now" sees it immediately,
# in the same invocation — no separate re-run needed.
python3 "${SCRIPT_DIR}/ensure-wealthdash-manifest.py" "${ANDROID_DIR}"
echo "[2/6] wealthdash:// deep-link intent-filter placement done (see above)."

# H66 review round 4 (2026-09-17): SORTED_GOOGLE_SERVICES_JSON is
# resolved via the ONE shared helper also called by
# setup-android-push.sh, rather than a literal hardcoded independently
# in each script -- that exact divergence (this script's restore
# target disagreeing with setup-android-push.sh's own legacy
# plugin-apply fallback, which still checked the module root
# unconditionally) is a real defect a review found in
# setup-android-push.sh alone; see resolve-google-services-path.py's
# header comment for the full writeup. Computed here, AFTER step 1
# has run, so the resolver sees the "board" flavour it just added and
# correctly resolves to the flavour-scoped path.
SORTED_GOOGLE_SERVICES_RELATIVE="$(python3 "${SCRIPT_DIR}/resolve-google-services-path.py" "${ANDROID_DIR}")"
SORTED_GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/${SORTED_GOOGLE_SERVICES_RELATIVE}"

# --- 3. google-services.json presence check + restore/move ---
# MUST run before step 4 (plugin apply + strategy config), same invariant
# setup-android-push.sh documents for its own step order: applying the
# plugin (or loosening it to WARN) before confirming the file exists
# anywhere would leave a build.gradle that silently ships push-dead,
# signed release AABs with a green build.
#
# The module-root copy is cleared out FIRST and unconditionally, never as
# an elif behind "does the sorted copy already exist" (review finding
# P1/FIX2, 2026-09-17 round 2): setup-android-push.sh's own restore step
# writes the canonical copy straight to the sorted-flavour path without
# ever checking or clearing the module root, so on a project that already
# has a module-root copy (this project's real, pre-H66 shape, or simply a
# Firebase-console download dropped at the conventional location) running
# that script first leaves BOTH copies present. The google-services
# plugin always searches the module root as a fallback for EVERY variant;
# a stale copy sitting there, matching no client entry for
# co.uk.auriqltd.sorted.board, throws unconditionally regardless of
# missingGoogleServicesStrategy — breaking every Board build with "No
# matching client found for package name co.uk.auriqltd.sorted.board".
if [[ -f "${ROOT_GOOGLE_SERVICES_JSON}" ]]; then
  if [[ -f "${SORTED_GOOGLE_SERVICES_JSON}" ]]; then
    # Do NOT blindly rm the module-root copy (review finding P3/FIX1,
    # 2026-09-17 round 3): the module root is exactly where the Firebase
    # console drops a freshly downloaded google-services.json, so the
    # realistic case is Kevin downloading a NEW config there while a STALE
    # copy still sits at the sorted-flavour path -- deleting the root
    # unconditionally would silently keep the stale one and throw away the
    # new one, with no backup. Compare content first: only when the two
    # are byte-identical is the root copy definitely redundant cruft safe
    # to remove outright; otherwise move it aside rather than guess which
    # one is "right" (matches the strings.xml refusal a few steps below --
    # never silently destroy a file this script didn't itself just write).
    if cmp -s "${ROOT_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"; then
      rm -f "${ROOT_GOOGLE_SERVICES_JSON}"
      echo "[3/6] google-services.json: removed leftover module-root copy (byte-identical to the sorted-flavour copy already at ${SORTED_GOOGLE_SERVICES_JSON})."
    else
      backup="${ROOT_GOOGLE_SERVICES_JSON}.bak"
      mv "${ROOT_GOOGLE_SERVICES_JSON}" "${backup}"
      echo "[3/6] google-services.json: module-root copy DIFFERS from the sorted-flavour copy at ${SORTED_GOOGLE_SERVICES_JSON} -- moved the module-root copy to ${backup} rather than guessing which is current. It may be a newer Firebase-console download dropped at the conventional location, or a copy this script's sibling setup-android-push.sh itself left there; review it and replace ${SORTED_GOOGLE_SERVICES_JSON} yourself if it's the newer one, then remove ${backup}."
    fi
  else
    mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
    mv "${ROOT_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
    echo "[3/6] google-services.json: moved module root -> ${SORTED_GOOGLE_SERVICES_JSON}."
  fi
elif [[ -f "${SORTED_GOOGLE_SERVICES_JSON}" ]]; then
  echo "[3/6] google-services.json: already at ${SORTED_GOOGLE_SERVICES_JSON} — skipping."
elif [[ -f "${CANONICAL_GOOGLE_SERVICES_JSON}" ]]; then
  mkdir -p "$(dirname "${SORTED_GOOGLE_SERVICES_JSON}")"
  cp "${CANONICAL_GOOGLE_SERVICES_JSON}" "${SORTED_GOOGLE_SERVICES_JSON}"
  echo "[3/6] google-services.json: restored from canonical copy directly to ${SORTED_GOOGLE_SERVICES_JSON}."
else
  cat >&2 <<EOF2

ERROR: neither ${ROOT_GOOGLE_SERVICES_JSON}
nor ${SORTED_GOOGLE_SERVICES_JSON}
nor ${CANONICAL_GOOGLE_SERVICES_JSON} exists.

Not touching app/build.gradle's google-services plugin block until this
is fixed (same invariant setup-android-push.sh follows) — patching it
first would leave Sorted able to produce a signed release AAB with FCM
push silently dead. Run setup-android-push.sh first (it prints the full
Firebase setup steps if the canonical copy is also missing), then re-run
this script.
EOF2
  exit 1
fi

# --- 4. app/build.gradle: unconditional google-services apply + missingGoogleServicesStrategy ---
# Only reached once step 3 has confirmed the json exists at the flavour
# -scoped path. Also registers a verifySortedGoogleServices task, wired
# only into Sorted's own preBuild, so Sorted alone keeps the "won't build
# without it" fatality that missingGoogleServicesStrategy=WARN loosens
# project-wide (Board is unaffected: it never looks for this file, and it
# never runs Sorted's preBuild task either).
if grep -q "missingGoogleServicesStrategy" "${APP_GRADLE}"; then
  echo "[4/6] app/build.gradle: googleServices { missingGoogleServicesStrategy } already present — skipping."
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

  python3 - "${APP_GRADLE}" "${SORTED_GOOGLE_SERVICES_RELATIVE}" <<'PYEOF'
import re, sys
path, sorted_relative = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()

fatality_block = (
    "\n"
    "// Restore fatality for Sorted specifically: WARN above is what lets\n"
    # (comment continues unchanged below; the f-strings further down
    # interpolate sorted_relative -- resolve-google-services-path.py's own
    # output, passed in as argv[2] -- rather than hardcoding the path a
    # second time, review round 5 finding F2, 2026-09-17: the same
    # hardcoded-path shape that caused the bug this whole file exists to
    # fix, even though this one is unreachable in a wrong state today
    # since it is written only after step 1 adds productFlavors and wired
    # solely to Sorted's own preBuild.

    "// Board ship with no Firebase project by design, but Sorted's FCM\n"
    "// push must not be able to go silently dead behind a green build.\n"
    "// This is a registered task wired ONLY into Sorted's own preBuild —\n"
    "// not a bare top-level check — precisely so it runs when (and only\n"
    "// when) a Sorted variant is actually being built, not on every\n"
    "// invocation of this project (assembleBoardDebug, `./gradlew tasks`,\n"
    "// `clean`, IDE sync...). Board is unaffected on both counts: it\n"
    "// never looks for this file, and it never runs Sorted's preBuild.\n"
    f"tasks.register('verifySortedGoogleServices') {{\n"
    f"    doLast {{\n"
    f"        if (!file('{sorted_relative}').exists()) {{\n"
    f"            throw new GradleException(\n"
    f"                \"app/{sorted_relative} is missing. Sorted's FCM push \" +\n"
    f"                \"needs it; run scripts/setup-android-push.sh (from capacitor-spike/) \" +\n"
    f"                \"to restore it from the canonical copy.\"\n"
    f"            )\n"
    f"        }}\n"
    f"    }}\n"
    f"}}\n"
    "\n"
    "afterEvaluate {\n"
    "    tasks.matching { it.name ==~ /pre(Sorted)(Debug|Release)Build/ }.configureEach {\n"
    "        dependsOn 'verifySortedGoogleServices'\n"
    "    }\n"
    "}\n"
)

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
    + fatality_block
)

# Legacy conditional block, as written by setup-android-push.sh step 4 (or
# a stock Capacitor template's own equivalent). The file('...') path is
# matched generically (any quoted string), not hardcoded to the
# module-root literal (review round 4, 2026-09-17): setup-android-push.sh
# now resolves that path itself via resolve-google-services-path.py, so
# depending on exactly when it last ran relative to this script it may
# have written EITHER 'google-services.json' or
# 'src/sorted/google-services.json' into this block -- this regex must
# recognise both, or a run order this rigid wouldn't leave both the old
# conditional AND the new unconditional-apply block present at once.
legacy_pattern = re.compile(
    r"\ntry \{\s*\n"
    r"\s*def servicesJSON = file\('[^']*google-services\.json'\)\s*\n"
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
    # fatality task.
    content = content.rstrip("\n") + "\n" + (
        "\ngoogleServices {\n"
        "    missingGoogleServicesStrategy = GoogleServicesPlugin.MissingGoogleServicesStrategy.WARN\n"
        "}\n"
        + fatality_block
    )
    action = "plugin already applied elsewhere; appended"
else:
    content = content.rstrip("\n") + "\n" + new_block
    action = "appended"

with open(path, "w") as f:
    f.write(content)
print(action)
PYEOF
  echo "[4/6] app/build.gradle: applied google-services unconditionally, set missingGoogleServicesStrategy = WARN, added verifySortedGoogleServices task wired into Sorted's preBuild."
fi

# --- 5. src/board/res/values/strings.xml: app_name, title, ids ---
# Without this, Board inherits src/main/res/values/strings.xml's
# app_name ("Sorted") verbatim — since android/ is gitignored and this
# whole flavour only exists via these scripts, a missing step here means
# a freshly regenerated project produces a Board app LABELLED SORTED: two
# identically named icons on the home screen, the exact confusion Kevin
# asked H66 to avoid (review finding P1/FIX1, 2026-09-17).
#
# Refuses rather than silently overwrites if the file already exists with
# some other app_name (review finding P3, 2026-09-17 round 2): a silent
# overwrite would destroy a hand edit with no backup.
if [[ -f "${BOARD_STRINGS_XML}" ]]; then
  if grep -q "^\s*<string name=\"app_name\">Board</string>" "${BOARD_STRINGS_XML}"; then
    echo "[5/6] src/board/res/values/strings.xml: app_name=Board already present — skipping."
  else
    echo "ERROR: ${BOARD_STRINGS_XML} already exists but does not contain the expected" >&2
    echo "<string name=\"app_name\">Board</string> line. Refusing to overwrite a file that" >&2
    echo "may carry a hand edit — fix its app_name to \"Board\" (or remove the file) and" >&2
    echo "re-run this script." >&2
    exit 1
  fi
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
  echo "[5/6] src/board/res/values/strings.xml: wrote app_name/title_activity_main=Board, package_name/custom_url_scheme=${BOARD_APPLICATION_ID}."
fi

# --- 6. app/build.gradle: verifyBoardWebAssets task, wired into Board's preBuild ---
# build-board-web-assets.sh copies capacitor-spike/www into
# src/board/assets/public/ as a one-off manual step; `npx cap sync
# android` only ever refreshes Sorted's src/main/assets/public/, so the
# ordinary "edit frontend, rebuild www, cap sync, gradlew" loop leaves
# Board's copy silently stale with no signal (review finding P2/FIX4,
# 2026-09-17). This task compares a content hash of capacitor-spike/www
# against the stamp build-board-web-assets.sh writes at
# src/board/.www-stamp, and fails loudly on a mismatch instead of shipping
# a stale Board build. Also asserts the overlay's index.html itself still
# exists (review finding P3, 2026-09-17 round 2): a matching stamp only
# proves www/ has not changed since the copy was made, not that the copy
# itself is still there — deleting src/board/assets/public/ while leaving
# the stamp untouched would otherwise still pass.
if grep -q "verifyBoardWebAssets" "${APP_GRADLE}"; then
  echo "[6/6] app/build.gradle: verifyBoardWebAssets task already present — skipping."
else
  cat >> "${APP_GRADLE}" <<'GRADLEEOF'

// H66 (review finding P2/FIX4, 2026-09-17): see build-board-web-assets.sh's
// header comment for why this exists. Wired into every Board variant's
// preBuild so it cannot be skipped by forgetting a manual step.
tasks.register('verifyBoardWebAssets') {
    doLast {
        def wwwDir = file('../../www')
        def stampFile = file('src/board/.www-stamp')
        def indexFile = file('src/board/assets/public/index.html')
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
        if (!indexFile.exists()) {
            throw new GradleException(
                "src/board/assets/public/index.html is missing -- the Board web asset " +
                "overlay looks like it was deleted after the stamp file was written. " +
                "Re-run scripts/build-board-web-assets.sh (from capacitor-spike/) before " +
                "building a Board variant."
            )
        }
        // LC_ALL=C, and cd into wwwDir before using RELATIVE paths (review
        // finding P2/FIX3, 2026-09-17 round 2): sort's collation order is
        // locale-dependent (measured two different hashes for the same
        // 635-file export under LC_ALL=C vs en_US.UTF-8 on the shared
        // tree), and sha256sum prints the path it was given into the
        // hashed stream, so an absolute path makes the hash depend on
        // where the repo happens to be checked out. This MUST match
        // build-board-web-assets.sh's own hash command exactly, or a
        // byte-identical export still reports as stale.
        // wwwDir is passed as $1 to `bash -c`, not interpolated into the
        // quoted command string (nit fix, 2026-09-17 round 3): a repo path
        // containing a single quote would otherwise break the embedded
        // 'cd '${wwwDir}'' quoting. Passing it as a positional argument
        // lets bash handle arbitrary characters in the path correctly.
        def proc = ["bash", "-c",
            'cd "$1" && export LC_ALL=C && find . -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum',
            "bash", wwwDir.toString()
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
  echo "[6/6] app/build.gradle: added verifyBoardWebAssets task, wired into preBoard{Debug,Release}Build."
fi

echo
echo "Board flavour Gradle + label setup complete. Next: apply-icons.sh, apply-board-icons.sh, build-board-web-assets.sh, npx cap sync android."
