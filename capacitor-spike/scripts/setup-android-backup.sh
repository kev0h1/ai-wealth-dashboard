#!/usr/bin/env bash
#
# setup-android-backup.sh (A129)
#
# Disables Android backup and device transfer for the generated, gitignored
# capacitor-spike/android/ project (pentest AND-01/AND-02): sets
# android:allowBackup="false" and also points fullBackupContent (API <= 30)
# and dataExtractionRules (API 31+) at exclude-everything rule files from
# ../android-backup/, so a future template flip of allowBackup still excludes
# everything. Run after `npx cap add android`, alongside setup-android-push.sh.
# Idempotent. No tools:replace is used: no library manifest in the generated
# project declares allowBackup (checked against the merged manifest), so the
# app manifest is the only declaration.

set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ANDROID_DIR:-${SPIKE_DIR}/android}"
SRC="${SPIKE_DIR}/android-backup"

[[ -d "${ANDROID_DIR}" ]] || { echo "ERROR: ${ANDROID_DIR} missing. Run 'npx cap add android' first." >&2; exit 1; }

XML_DIR="${ANDROID_DIR}/app/src/main/res/xml"
mkdir -p "${XML_DIR}"
for f in data_extraction_rules.xml backup_rules.xml; do
  [[ -f "${SRC}/${f}" ]] || { echo "ERROR: ${SRC}/${f} missing" >&2; exit 1; }
  if [[ -f "${XML_DIR}/${f}" ]] && cmp -s "${SRC}/${f}" "${XML_DIR}/${f}"; then
    echo "skipped: res/xml/${f} already up to date"
  else
    cp "${SRC}/${f}" "${XML_DIR}/${f}"
    echo "changed: res/xml/${f} installed"
  fi
done

python3 - "${ANDROID_DIR}/app/src/main/AndroidManifest.xml" "${ANDROID_DIR}/app/src/sorted/AndroidManifest.xml" <<'PY'
import os, re, sys
import xml.etree.ElementTree as ET

ANDROID = "http://schemas.android.com/apk/res/android"
NEEDED = {
    "allowBackup": "false",
    "fullBackupContent": "@xml/backup_rules",
    "dataExtractionRules": "@xml/data_extraction_rules",
}

def app_tag(s):
    m = re.search(r"<application\b[^>]*>", s, re.S)
    return m

def process(path, required):
    if not os.path.isfile(path):
        if required:
            print(f"ERROR: {path} not found", file=sys.stderr); sys.exit(1)
        print(f"skipped: {path} does not exist"); return
    s = open(path).read()
    m = app_tag(s)
    if not m:
        print(f"ERROR: no <application> in {path}", file=sys.stderr); sys.exit(1)
    tag = m.group(0)
    is_overlay = not required
    if is_overlay and "allowBackup" not in tag:
        print(f"skipped: {path} overlay has no allowBackup, left alone"); return
    new = tag
    changes = []
    for name, val in NEEDED.items():
        if is_overlay and name != "allowBackup" and f"android:{name}" not in new:
            continue
        pat = re.compile(r'android:%s\s*=\s*"[^"]*"' % name)
        if pat.search(new):
            if pat.search(new).group(0).split('"')[1] != val:
                new = pat.sub(f'android:{name}="{val}"', new, count=1)
                changes.append(f"{name} set to {val}")
        else:
            new = re.sub(r"<application\b", f'<application\n        android:{name}="{val}"', new, count=1)
            changes.append(f"{name} added")
    if changes:
        s = s[:m.start()] + new + s[m.end():]
        open(path, "w").write(s)
        print(f"changed: {path}: " + ", ".join(changes))
    else:
        print(f"skipped: {path} already has all backup attributes")
    # verify
    root = ET.parse(path).getroot()
    app = root.find("application")
    for name, val in NEEDED.items():
        got = app.get(f"{{{ANDROID}}}{name}")
        if is_overlay and got is None and name != "allowBackup":
            continue
        if got != val:
            print(f"ERROR: {path}: android:{name} is {got!r}, expected {val!r}", file=sys.stderr); sys.exit(1)

process(sys.argv[1], True)
process(sys.argv[2], False)
print("verified: manifest well-formed, allowBackup=false, fullBackupContent and dataExtractionRules set")
PY
