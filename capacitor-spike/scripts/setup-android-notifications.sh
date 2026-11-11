#!/usr/bin/env bash
# Installs SortedNotifications into the generated Capacitor Android project.
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
SRC="${SPIKE_DIR}/native-notifications/android/SortedNotificationsPlugin.java"

[[ -d "${ANDROID_DIR}" ]] || { echo "ERROR: ${ANDROID_DIR} missing. Run 'npx cap add android' first." >&2; exit 1; }
MAIN="$(find "${ANDROID_DIR}/app/src/main/java" -name MainActivity.java | head -n1)"
[[ -n "${MAIN}" ]] || { echo "ERROR: MainActivity.java not found" >&2; exit 1; }
PKG="$(sed -n 's/^package \(.*\);/\1/p' "${MAIN}" | head -n1)"
[[ -n "${PKG}" ]] || { echo "ERROR: package declaration missing from ${MAIN}" >&2; exit 1; }
DEST_DIR="$(dirname "${MAIN}")"
sed "s/^package .*;/package ${PKG};/" "${SRC}" > "${DEST_DIR}/SortedNotificationsPlugin.java"

if ! grep -q "registerPlugin(SortedNotificationsPlugin.class)" "${MAIN}"; then
  python3 - "${MAIN}" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
if "import android.os.Bundle;" not in s:
    s = re.sub(r"(package [^;]+;\n)", r"\1\nimport android.os.Bundle;\n", s, count=1)
if re.search(r"void onCreate\(", s):
    s = re.sub(r"(void onCreate\([^)]*\)\s*\{\n)", r"\1        registerPlugin(SortedNotificationsPlugin.class);\n", s, count=1)
else:
    body = ("\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n"
            "        registerPlugin(SortedNotificationsPlugin.class);\n"
            "        super.onCreate(savedInstanceState);\n    }\n")
    s = re.sub(r"(class MainActivity extends BridgeActivity\s*\{)\s*\}", r"\1" + body + "}", s, count=1)
open(p, "w").write(s)
PY
fi

grep -q "registerPlugin(SortedNotificationsPlugin.class)" "${MAIN}" || { echo "ERROR: notification plugin registration missing from ${MAIN}" >&2; exit 1; }
python3 - "${MAIN}" <<'PY'
import sys
s = open(sys.argv[1]).read()
registration = s.index("registerPlugin(SortedNotificationsPlugin.class)")
super_call = s.index("super.onCreate", registration)
assert registration < super_call, "notification plugin must register before super.onCreate"
PY
echo "SortedNotifications plugin installed and registered in ${MAIN}"
