#!/usr/bin/env bash
#
# setup-android-debug-symbols.sh (C11)
#
# Adds `ndk { debugSymbolLevel 'SYMBOL_TABLE' }` to buildTypes.release in the
# generated, gitignored capacitor-spike/android/app/build.gradle, so
# bundleRelease emits native-debug-symbols.zip and Play Console stops warning
# that the bundle has native code but no debug symbols. Used by the Codemagic
# Android workflows only (kept out of setup-android-push.sh so the local
# sideload-APK flow is unchanged). Idempotent, grep-guarded, fails loud.
#
# Env: ANDROID_DIR overrides the android/ directory.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
APP_GRADLE="${ANDROID_DIR}/app/build.gradle"

[[ -f "${APP_GRADLE}" ]] || { echo "ERROR: ${APP_GRADLE} missing. Run 'npx cap add android' first." >&2; exit 1; }

if grep -q "debugSymbolLevel" "${APP_GRADLE}"; then
  echo "debug symbols: debugSymbolLevel already present, skipping."
else
  python3 - "${APP_GRADLE}" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()
m = re.search(r"^        release \{[ \t]*\n", content, re.M)
if not m:
    print("ERROR: could not find the buildTypes.release block to add debugSymbolLevel", file=sys.stderr)
    sys.exit(1)
insertion = "            ndk {\n                debugSymbolLevel 'SYMBOL_TABLE'\n            }\n"
content = content[:m.end()] + insertion + content[m.end():]
with open(path, "w") as f:
    f.write(content)
PYEOF
  echo "debug symbols: added ndk.debugSymbolLevel SYMBOL_TABLE to buildTypes.release."
fi
grep -q "debugSymbolLevel 'SYMBOL_TABLE'" "${APP_GRADLE}" || { echo "ERROR: debugSymbolLevel patch did not take in ${APP_GRADLE}" >&2; exit 1; }
