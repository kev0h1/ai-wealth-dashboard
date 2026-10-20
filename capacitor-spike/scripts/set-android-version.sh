#!/usr/bin/env bash
#
# set-android-version.sh (C20)
#
# Sets versionCode and versionName in the generated, gitignored capacitor-spike/android/app/build.gradle
# from frontend/public/sorted-apk.json (the single source of truth for the
# published APK's versionCode and versionName, shared by the sideload APK and the
# Play AAB), so a regenerated android/ project cannot
# silently fall back to versionCode 1 and produce an APK Android treats as
# not-newer than the one already installed. Idempotent. Run before
# assembleSortedRelease; see capacitor-spike/README.md "Published APK (C20)".
#
# Both values are REQUIRED in the JSON and everything is validated before any
# write to build.gradle.
#
# C11 overrides (both optional, both validated like the JSON values):
#   VERSION_CODE  wins over the JSON's versionCode. Codemagic sets it to
#                 Google Play's latest versionCode + 1, because Play rejects
#                 any reused versionCode and the JSON only tracks the sideload
#                 APK. A manual build must pick a versionCode above Play's
#                 latest (DEPLOY.md "Android: Codemagic Play builds").
#   VERSION_NAME  wins over the JSON's versionName.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
META="${SPIKE_DIR}/../frontend/public/sorted-apk.json"
GRADLE="${ANDROID_DIR}/app/build.gradle"

[[ -f "${GRADLE}" ]] || { echo "ERROR: ${GRADLE} missing. Run 'npx cap add android' first." >&2; exit 1; }
[[ -f "${META}" ]] || { echo "ERROR: ${META} missing" >&2; exit 1; }

if [[ -n "${VERSION_CODE:-}" ]]; then
  [[ "${VERSION_CODE}" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: VERSION_CODE must be a positive integer, got '${VERSION_CODE}'" >&2; exit 1; }
  CODE="${VERSION_CODE}"
else
  CODE="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["versionCode"]))' "${META}")"
fi

if [[ -n "${VERSION_NAME:-}" ]]; then
  NAME="${VERSION_NAME}"
else
  NAME="$(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get("versionName"); print(v if isinstance(v,str) else "")' "${META}")"
  [[ -n "${NAME}" ]] || { echo "ERROR: versionName missing or not a string in ${META}" >&2; exit 1; }
fi
[[ "${NAME}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: versionName '${NAME}' has unsupported characters" >&2; exit 1; }

# perl -pi, not `sed -i -E`: GNU sed takes -i with no suffix, BSD sed (macOS,
# where Codemagic runs the Android workflows, C28) would read -E as the backup
# suffix. perl behaves identically on both. Values go through the environment
# so nothing in them is ever interpreted as regex or replacement syntax.
CODE="${CODE}" perl -pi -e 's/^(\s*versionCode )\d+/$1$ENV{CODE}/' "${GRADLE}"
grep -q "versionCode ${CODE}\$" "${GRADLE}" || { echo "ERROR: failed to set versionCode ${CODE}" >&2; exit 1; }
echo "versionCode set to ${CODE} in ${GRADLE}"

NAME="${NAME}" perl -pi -e 's/^(\s*versionName )"[^"]*"/$1"$ENV{NAME}"/' "${GRADLE}"
grep -q "versionName \"${NAME}\"\$" "${GRADLE}" || { echo "ERROR: failed to set versionName ${NAME}" >&2; exit 1; }
echo "versionName set to ${NAME} in ${GRADLE}"
