#!/usr/bin/env bash
#
# setup-android-privacy.sh (A122)
#
# Installs the in-repo PrivacyScreen plugin (FLAG_SECURE toggle, see
# ../android-privacy/PrivacyScreenPlugin.java) into the generated, gitignored
# capacitor-spike/android/ project and registers it in MainActivity. Run after
# `npx cap add android`, alongside setup-android-push.sh. Idempotent.
# Registration must happen before super.onCreate(), which is how Capacitor
# discovers locally registered plugins.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
SRC="${SPIKE_DIR}/android-privacy/PrivacyScreenPlugin.java"

[[ -d "${ANDROID_DIR}" ]] || { echo "ERROR: ${ANDROID_DIR} missing. Run 'npx cap add android' first." >&2; exit 1; }

MAIN="$(find "${ANDROID_DIR}/app/src/main/java" -name MainActivity.java | head -n1)"
[[ -n "${MAIN}" ]] || { echo "ERROR: MainActivity.java not found" >&2; exit 1; }
DEST_DIR="$(dirname "${MAIN}")"
PKG="$(sed -n 's/^package \(.*\);/\1/p' "${MAIN}" | head -n1)"

sed "s/^package .*;/package ${PKG};/" "${SRC}" > "${DEST_DIR}/PrivacyScreenPlugin.java"

if ! grep -q "PrivacyScreenPlugin" "${MAIN}"; then
  python3 - "${MAIN}" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
if "import android.os.Bundle;" not in s:
    s = re.sub(r"(package [^;]+;\n)", r"\1\nimport android.os.Bundle;\n", s, count=1)
body = ("    @Override\n    public void onCreate(Bundle savedInstanceState) {\n"
        "        registerPlugin(PrivacyScreenPlugin.class);\n"
        "        super.onCreate(savedInstanceState);\n    }\n")
if re.search(r"void onCreate\(", s):
    s = re.sub(r"(void onCreate\([^)]*\)\s*\{\n)", r"\1        registerPlugin(PrivacyScreenPlugin.class);\n", s, count=1)
else:
    s = re.sub(r"(class MainActivity extends BridgeActivity\s*\{)\s*\}", r"\1\n" + body.replace("\\", "\\\\") + "}", s, count=1)
open(p, "w").write(s)
PY
fi

grep -q "registerPlugin(PrivacyScreenPlugin.class)" "${MAIN}" || { echo "ERROR: failed to register PrivacyScreenPlugin in ${MAIN}" >&2; exit 1; }
echo "PrivacyScreen plugin installed and registered in ${MAIN}"
