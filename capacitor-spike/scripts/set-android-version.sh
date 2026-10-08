#!/usr/bin/env bash
#
# set-android-version.sh (C20)
#
# Sets versionCode in the generated, gitignored capacitor-spike/android/app/build.gradle
# from frontend/public/sorted-apk.json (the single source of truth for the
# published APK's versionCode), so a regenerated android/ project cannot
# silently fall back to versionCode 1 and produce an APK Android treats as
# not-newer than the one already installed. Idempotent. Run before
# assembleSortedRelease; see capacitor-spike/README.md "Published APK (C20)".

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
META="${SPIKE_DIR}/../frontend/public/sorted-apk.json"
GRADLE="${ANDROID_DIR}/app/build.gradle"

[[ -f "${GRADLE}" ]] || { echo "ERROR: ${GRADLE} missing. Run 'npx cap add android' first." >&2; exit 1; }
[[ -f "${META}" ]] || { echo "ERROR: ${META} missing" >&2; exit 1; }

CODE="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["versionCode"]))' "${META}")"
sed -i -E "s/^([[:space:]]*versionCode )[0-9]+/\1${CODE}/" "${GRADLE}"
grep -q "versionCode ${CODE}\$" "${GRADLE}" || { echo "ERROR: failed to set versionCode ${CODE}" >&2; exit 1; }
echo "versionCode set to ${CODE} in ${GRADLE}"
