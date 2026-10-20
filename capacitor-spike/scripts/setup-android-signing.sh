#!/usr/bin/env bash
#
# setup-android-signing.sh (C11)
#
# Patches the generated, gitignored capacitor-spike/android/app/build.gradle
# with the release signing logic (C2): reads android/keystore.properties and
# wires signingConfigs.release into buildTypes.release. `npx cap add android`
# regenerates a stock build.gradle with none of this, and nothing else
# re-applied it before C11, so a fresh project (a new machine, a worktree, or
# Codemagic) built an UNSIGNED bundleRelease. Run right after
# `npx cap add android`; setup-android-push.sh calls it as its last step, so
# the normal regeneration flow covers it. Idempotent: every patch is
# grep-guarded, and against an already patched file it changes nothing.
#
# Soft-fail by design (same as the C2 shape): if keystore.properties is absent
# the build logs a warning and the release artifact is UNSIGNED. Debug builds
# are unaffected.
#
# Codemagic: when CM_KEYSTORE_PATH is set (the `android_signing` keystore
# reference exposes CM_KEYSTORE_PATH, CM_KEYSTORE_PASSWORD, CM_KEY_ALIAS and
# CM_KEY_PASSWORD) and android/keystore.properties does not exist, it is
# written from those variables, chmod 600. Values are never echoed. A blank
# CM_KEY_PASSWORD falls back to CM_KEYSTORE_PASSWORD (PKCS12 needs them equal);
# a missing store password, alias or keystore file still fails loud.
#
# Env: ANDROID_DIR overrides the android/ directory (used to test against a
# copy of a project).

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"
PROPS="${ANDROID_DIR}/keystore.properties"

[[ -f "${APP_GRADLE}" ]] || { echo "ERROR: ${APP_GRADLE} missing. Run 'npx cap add android' first." >&2; exit 1; }

# --- 1. keystore.properties from the Codemagic keystore variables ---
if [[ -n "${CM_KEYSTORE_PATH:-}" ]]; then
  if [[ -f "${PROPS}" ]]; then
    echo "signing: keystore.properties already present, leaving it alone."
  else
    for v in CM_KEYSTORE_PATH CM_KEYSTORE_PASSWORD CM_KEY_ALIAS; do
      if [[ -z "${!v:-}" ]]; then
        echo "ERROR: CM_KEYSTORE_PATH is set but ${v} is empty. Check the android_signing keystore reference in Codemagic." >&2
        exit 1
      fi
    done
    # The upload keystore is PKCS12, where the key password must equal the
    # store password, so a key password left blank at upload defaults to it.
    KEY_PASSWORD="${CM_KEY_PASSWORD:-}"
    if [[ -z "${KEY_PASSWORD}" ]]; then
      KEY_PASSWORD="${CM_KEYSTORE_PASSWORD}"
      echo "signing: CM_KEY_PASSWORD is empty, keyPassword defaulted to the store password (PKCS12 requires them to match; value not shown)."
    fi
    [[ -f "${CM_KEYSTORE_PATH}" ]] || { echo "ERROR: CM_KEYSTORE_PATH does not point at a file." >&2; exit 1; }
    # .properties values treat backslash as an escape character, so double it.
    esc() { printf '%s' "$1" | sed 's/\\/\\\\/g'; }
    ( umask 077
      {
        printf 'storeFile=%s\n' "$(esc "${CM_KEYSTORE_PATH}")"
        printf 'storePassword=%s\n' "$(esc "${CM_KEYSTORE_PASSWORD}")"
        printf 'keyAlias=%s\n' "$(esc "${CM_KEY_ALIAS}")"
        printf 'keyPassword=%s\n' "$(esc "${KEY_PASSWORD}")"
      } > "${PROPS}" )
    chmod 600 "${PROPS}"
    echo "signing: wrote keystore.properties from the Codemagic keystore variables (values not shown)."
  fi
fi

# --- 2. patch app/build.gradle ---
python3 - "${APP_GRADLE}" <<'PYEOF'
import re, sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()
orig = content

PREAMBLE = '''
// Release signing: reads capacitor-spike/android/keystore.properties, which is
// gitignored and generated per-machine (see DEPLOY.md "Android release signing").
def keystorePropertiesFile = rootProject.file('keystore.properties')
def keystoreProperties = new Properties()
def hasReleaseSigning = keystorePropertiesFile.exists()
if (hasReleaseSigning) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
} else {
    logger.warn("keystore.properties not found at ${keystorePropertiesFile}; release build will be UNSIGNED. See DEPLOY.md \\"Android release signing\\".")
}
'''

SIGNING_CONFIGS = '''    signingConfigs {
        if (hasReleaseSigning) {
            release {
                storeFile rootProject.file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
    }
'''

SIGNING_LINE = '''            if (hasReleaseSigning) {
                signingConfig signingConfigs.release
            }
'''

def fail(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)

# a) preamble, right after the `apply plugin: 'com.android.application'` line
if "def keystorePropertiesFile" not in content:
    m = re.search(r"^apply plugin: 'com\.android\.application'[ \t]*\n", content, re.M)
    if not m:
        fail("could not find the `apply plugin: 'com.android.application'` anchor for the signing preamble")
    content = content[:m.end()] + PREAMBLE + content[m.end():]
    print("signing: added keystore.properties preamble.")
else:
    print("signing: preamble already present, skipping.")

# b) signingConfigs block, immediately before `buildTypes {`
if "signingConfigs {" not in content:
    m = re.search(r"^    buildTypes \{[ \t]*\n", content, re.M)
    if not m:
        fail("could not find the `buildTypes {` anchor for the signingConfigs block")
    content = content[:m.start()] + SIGNING_CONFIGS + content[m.start():]
    print("signing: added signingConfigs.release block.")
else:
    print("signing: signingConfigs block already present, skipping.")

# c) buildTypes.release.signingConfig, after the release proguardFiles line
if "signingConfig signingConfigs.release" not in content:
    m = re.search(r"^(        release \{[^\n]*\n(?:(?!^        \}).*\n)*?)(            proguardFiles [^\n]*\n)", content, re.M)
    if not m:
        fail("could not find buildTypes.release proguardFiles anchor for the signingConfig line")
    content = content[:m.end()] + SIGNING_LINE + content[m.end():]
    print("signing: wired signingConfig into buildTypes.release.")
else:
    print("signing: release signingConfig already wired, skipping.")

if content != orig:
    with open(path, "w") as f:
        f.write(content)

# Fail loud if the patch did not take.
for needle in ("def keystorePropertiesFile", "signingConfigs {", "storeFile rootProject.file(keystoreProperties['storeFile'])", "signingConfig signingConfigs.release"):
    if needle not in content:
        fail("signing patch did not take, '%s' missing from %s" % (needle, path))
PYEOF

grep -q "signingConfig signingConfigs.release" "${APP_GRADLE}" || { echo "ERROR: release signingConfig missing from ${APP_GRADLE} after patching" >&2; exit 1; }
echo "signing: release signing is wired in ${APP_GRADLE}."
