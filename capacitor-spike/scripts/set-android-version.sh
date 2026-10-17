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

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
META="${SPIKE_DIR}/../frontend/public/sorted-apk.json"
GRADLE="${ANDROID_DIR}/app/build.gradle"

[[ -f "${GRADLE}" ]] || { echo "ERROR: ${GRADLE} missing. Run 'npx cap add android' first." >&2; exit 1; }
[[ -f "${META}" ]] || { echo "ERROR: ${META} missing" >&2; exit 1; }

CODE="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["versionCode"]))' "${META}")"
NAME="$(python3 -c 'import json,sys; v=json.load(open(sys.argv[1])).get("versionName"); print(v if isinstance(v,str) else "")' "${META}")"
[[ -n "${NAME}" ]] || { echo "ERROR: versionName missing or not a string in ${META}" >&2; exit 1; }
[[ "${NAME}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: versionName '${NAME}' has unsupported characters" >&2; exit 1; }

sed -i -E "s/^([[:space:]]*versionCode )[0-9]+/\1${CODE}/" "${GRADLE}"
grep -q "versionCode ${CODE}\$" "${GRADLE}" || { echo "ERROR: failed to set versionCode ${CODE}" >&2; exit 1; }
echo "versionCode set to ${CODE} in ${GRADLE}"

sed -i -E "s/^([[:space:]]*versionName )\"[^\"]*\"/\1\"${NAME}\"/" "${GRADLE}"
grep -q "versionName \"${NAME}\"\$" "${GRADLE}" || { echo "ERROR: failed to set versionName ${NAME}" >&2; exit 1; }
echo "versionName set to ${NAME} in ${GRADLE}"
