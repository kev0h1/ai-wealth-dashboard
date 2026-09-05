#!/usr/bin/env bash
#
# setup-android-push.sh
#
# Patches the generated Capacitor Android project (capacitor-spike/android/,
# which is gitignored and recreated by `npx cap add android`) so that FCM
# push notifications work. Run this ONCE, right after `npx cap add android`
# (and again any time you re-run `cap add android`, since that wipes the
# android/ directory). Safe to re-run — every patch is grep-guarded.
#
# IMPORTANT: the google-services.json presence check runs BEFORE the
# google-services Gradle plugin is ever applied (in either the modern
# `plugins {}` or legacy `apply plugin:` style). Applying that plugin
# without the JSON file present makes the Google Services Gradle plugin
# throw a hard config-time error on every subsequent Gradle run — and
# because plugin application is grep-guarded, that broken state would
# otherwise persist across re-runs. Checking first keeps the script
# atomic: if the JSON is missing, it exits non-zero having made only the
# harmless changes (classpath, manifest permission) and never applies the
# plugin.
#
# See ../ANDROID_PUSH.md for the full setup flow and manual prerequisites.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SPIKE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ANDROID_DIR="${SPIKE_DIR}/android"

PROJECT_GRADLE="${ANDROID_DIR}/build.gradle"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"
MANIFEST="${ANDROID_DIR}/app/src/main/AndroidManifest.xml"
GOOGLE_SERVICES_JSON="${ANDROID_DIR}/app/google-services.json"
CANONICAL_GOOGLE_SERVICES_JSON="${SPIKE_DIR}/google-services.json"
RES_DIR="${ANDROID_DIR}/app/src/main/res"
CANONICAL_NOTIFICATION_ICON_DIR="${SPIKE_DIR}/assets/notification-icon"
NOTIFICATION_ICON_DENSITIES=(mdpi hdpi xhdpi xxhdpi xxxhdpi)

GOOGLE_SERVICES_CLASSPATH_VERSION="4.4.4"

if [[ ! -d "${ANDROID_DIR}" ]]; then
  echo "ERROR: ${ANDROID_DIR} does not exist. Run 'npx cap add android' first." >&2
  exit 1
fi

# --- 1. Project-level build.gradle: add the google-services classpath ---
# Harmless with or without google-services.json — just makes the plugin
# available to be applied later; doesn't itself apply it.
if [[ ! -f "${PROJECT_GRADLE}" ]]; then
  echo "ERROR: ${PROJECT_GRADLE} not found." >&2
  exit 1
fi

if grep -q "com.google.gms:google-services:" "${PROJECT_GRADLE}"; then
  echo "[1/6] build.gradle: google-services classpath already present — skipping."
else
  # Insert the classpath line right after the AGP classpath line inside
  # the buildscript { dependencies { ... } } block.
  python3 - "${PROJECT_GRADLE}" "${GOOGLE_SERVICES_CLASSPATH_VERSION}" <<'PYEOF'
import sys
path, version = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()
marker = "classpath 'com.android.tools.build:gradle:"
idx = content.find(marker)
if idx == -1:
    print("ERROR: could not find AGP classpath line to anchor insertion", file=sys.stderr)
    sys.exit(1)
line_end = content.find("\n", idx)
insertion = f"\n        classpath 'com.google.gms:google-services:{version}'"
content = content[:line_end] + insertion + content[line_end:]
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "[1/6] build.gradle: added com.google.gms:google-services:${GOOGLE_SERVICES_CLASSPATH_VERSION} classpath."
fi

# --- 2. AndroidManifest.xml: POST_NOTIFICATIONS runtime permission (Android 13+) ---
# Also harmless without google-services.json.
if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: ${MANIFEST} not found." >&2
  exit 1
fi

if grep -q "android.permission.POST_NOTIFICATIONS" "${MANIFEST}"; then
  echo "[2/6] AndroidManifest.xml: POST_NOTIFICATIONS permission already present — skipping."
else
  # Insert alongside the existing INTERNET permission.
  python3 - "${MANIFEST}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
marker = '<uses-permission android:name="android.permission.INTERNET" />'
if marker not in content:
    print("ERROR: could not find INTERNET permission line to anchor insertion", file=sys.stderr)
    sys.exit(1)
replacement = marker + '\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />'
content = content.replace(marker, replacement, 1)
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "[2/6] AndroidManifest.xml: added POST_NOTIFICATIONS permission."
fi

# --- 3. google-services.json presence check ---
# MUST run before step 4 (plugin application). Applying the google-services
# plugin without this file present is a hard Gradle config-time error that
# would otherwise persist across re-runs once the plugin block is written.
if [[ -f "${GOOGLE_SERVICES_JSON}" ]]; then
  echo "[3/6] google-services.json: found at ${GOOGLE_SERVICES_JSON}."
elif [[ -f "${CANONICAL_GOOGLE_SERVICES_JSON}" ]]; then
  # android/ is gitignored and wiped by `cap add android`, so the working
  # copy won't survive a regeneration. The canonical copy at
  # capacitor-spike/google-services.json is committed and survives that,
  # so restore the working copy from it instead of hard-stopping.
  cp "${CANONICAL_GOOGLE_SERVICES_JSON}" "${GOOGLE_SERVICES_JSON}"
  echo "[3/6] google-services.json: restored from canonical copy at ${CANONICAL_GOOGLE_SERVICES_JSON}."
else
  cat >&2 <<EOF

ERROR: neither ${GOOGLE_SERVICES_JSON}
nor ${CANONICAL_GOOGLE_SERVICES_JSON} exists.

FCM push notifications cannot work without it, and the google-services
Gradle plugin will NOT be applied until it's present (applying it without
this file breaks every subsequent Gradle build). To fix:
  1. Go to the Firebase console (https://console.firebase.google.com/) and
     open (or create) the Firebase project used for this app.
  2. Add an Android app with package name: co.uk.auriqltd.sorted
  3. Download the generated google-services.json.
  4. Place it at: ${CANONICAL_GOOGLE_SERVICES_JSON}
  5. Re-run this script.

See ${SPIKE_DIR}/ANDROID_PUSH.md for the full setup guide.
EOF
  exit 1
fi

# --- 4. app/build.gradle: apply the google-services plugin ---
# Only reached once step 3 has confirmed google-services.json exists.
if [[ ! -f "${APP_GRADLE}" ]]; then
  echo "ERROR: ${APP_GRADLE} not found." >&2
  exit 1
fi

if grep -q "com.google.gms.google-services" "${APP_GRADLE}"; then
  echo "[4/6] app/build.gradle: google-services plugin already applied — skipping."
else
  if grep -qE '^\s*plugins\s*\{' "${APP_GRADLE}"; then
    # File uses a plugins {} block — add the plugin id there. Safe to apply
    # unconditionally here since step 3 already guaranteed the JSON exists.
    python3 - "${APP_GRADLE}" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
content = re.sub(
    r"(plugins\s*\{)",
    r"\1\n    id 'com.google.gms.google-services'",
    content,
    count=1,
)
with open(path, "w") as f:
    f.write(content)
PYEOF
    echo "[4/6] app/build.gradle: added 'com.google.gms.google-services' to plugins {} block."
  else
    # Legacy `apply plugin:` style — append at the end of the file. Kept
    # guarded on google-services.json existing (belt-and-braces on top of
    # the step-3 check above) so the file stays self-contained/robust even
    # if someone deletes the JSON after this script has already run once.
    cat >> "${APP_GRADLE}" <<'EOF'

try {
    def servicesJSON = file('google-services.json')
    if (servicesJSON.text) {
        apply plugin: 'com.google.gms.google-services'
    }
} catch(Exception e) {
    logger.info("google-services.json not found, google-services plugin not applied. Push Notifications won't work")
}
EOF
    echo "[4/6] app/build.gradle: appended guarded 'apply plugin: com.google.gms.google-services' block."
  fi
fi

# Note: @capacitor/push-notifications already pulls in firebase-messaging
# transitively, so we deliberately do NOT add a duplicate
# `implementation 'com.google.firebase:firebase-messaging'` dependency here.
if grep -q "firebase-messaging" "${APP_GRADLE}"; then
  echo "      (firebase-messaging dependency already present in app/build.gradle)"
fi

# --- 5. Notification icon: copy the monochrome ic_stat_notify.png set ---
# Android draws status-bar notification icons from the alpha channel only,
# discarding all colour, so the full-colour launcher icon renders as a flat
# white blob. capacitor-spike/assets/notification-icon/drawable-*/ holds a
# committed, purpose-made monochrome silhouette (white RGB + shaped alpha)
# at each density. android/ is gitignored and wiped by `cap add android`,
# so those copies never survive a regeneration and must be restored here,
# the same way step 3 restores google-services.json from its canonical copy.
if [[ ! -d "${CANONICAL_NOTIFICATION_ICON_DIR}" ]]; then
  echo "ERROR: ${CANONICAL_NOTIFICATION_ICON_DIR} not found." >&2
  exit 1
fi

icon_all_present=true
for density in "${NOTIFICATION_ICON_DENSITIES[@]}"; do
  if [[ ! -f "${RES_DIR}/drawable-${density}/ic_stat_notify.png" ]]; then
    icon_all_present=false
    break
  fi
done

if [[ "${icon_all_present}" == true ]]; then
  echo "[5/6] notification icon: ic_stat_notify.png already present at all five densities, skipping."
else
  for density in "${NOTIFICATION_ICON_DENSITIES[@]}"; do
    mkdir -p "${RES_DIR}/drawable-${density}"
    cp "${CANONICAL_NOTIFICATION_ICON_DIR}/drawable-${density}/ic_stat_notify.png" \
       "${RES_DIR}/drawable-${density}/ic_stat_notify.png"
  done
  echo "[5/6] notification icon: copied ic_stat_notify.png to all five drawable-*/ densities."
fi

# --- 6. AndroidManifest.xml: default notification icon + channel meta-data ---
# Firebase reads these two <meta-data> entries to pick the status-bar icon
# and the default notification channel for messages that don't specify one
# (e.g. background-received FCM data messages). Without the icon meta-data,
# Firebase falls back to the app's launcher icon, i.e. the exact white-blob
# problem this whole setup step exists to fix. The channel id "money_updates"
# must match the channel created on the JS side and the id the backend
# targets when sending, so it is not something to "tidy" or rename here.
if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: ${MANIFEST} not found." >&2
  exit 1
fi

manifest_changed=false

if grep -q "com.google.firebase.messaging.default_notification_icon" "${MANIFEST}"; then
  echo "      (default_notification_icon meta-data already present)"
else
  python3 - "${MANIFEST}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
marker = '<application\n'
idx = content.find(marker)
if idx == -1:
    print("ERROR: could not find <application> opening tag to anchor insertion", file=sys.stderr)
    sys.exit(1)
# Insert right after the opening <application ...> tag's closing '>'.
tag_end = content.find(">", idx)
insertion = (
    "\n\n        <meta-data android:name=\"com.google.firebase.messaging.default_notification_icon\" "
    "android:resource=\"@drawable/ic_stat_notify\" />"
)
content = content[:tag_end + 1] + insertion + content[tag_end + 1:]
with open(path, "w") as f:
    f.write(content)
PYEOF
  manifest_changed=true
fi

if grep -q "com.google.firebase.messaging.default_notification_channel_id" "${MANIFEST}"; then
  echo "      (default_notification_channel_id meta-data already present)"
else
  python3 - "${MANIFEST}" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
marker = 'com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_notify" />'
idx = content.find(marker)
if idx != -1:
    insert_after = idx + len(marker)
    insertion = (
        "\n        <meta-data android:name=\"com.google.firebase.messaging.default_notification_channel_id\" "
        "android:value=\"money_updates\" />"
    )
    content = content[:insert_after] + insertion + content[insert_after:]
else:
    # Icon meta-data already existed from a prior run but this one is
    # somehow missing, anchor on the <application> tag instead so this
    # step self-heals independently of the icon meta-data step above.
    app_marker = '<application\n'
    app_idx = content.find(app_marker)
    if app_idx == -1:
        print("ERROR: could not find <application> opening tag to anchor insertion", file=sys.stderr)
        sys.exit(1)
    tag_end = content.find(">", app_idx)
    insertion = (
        "\n\n        <meta-data android:name=\"com.google.firebase.messaging.default_notification_channel_id\" "
        "android:value=\"money_updates\" />"
    )
    content = content[:tag_end + 1] + insertion + content[tag_end + 1:]
with open(path, "w") as f:
    f.write(content)
PYEOF
  manifest_changed=true
fi

if [[ "${manifest_changed}" == true ]]; then
  echo "[6/6] AndroidManifest.xml: added default_notification_icon and/or default_notification_channel_id meta-data."
else
  echo "[6/6] AndroidManifest.xml: notification meta-data already present, skipping."
fi

echo
echo "Android push setup complete."
