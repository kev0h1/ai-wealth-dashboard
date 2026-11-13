#!/usr/bin/env bash
# Installs and wires the local SortedNotifications iOS Capacitor plugin for compilation.
set -euo pipefail

SPIKE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IOS_DIR="${IOS_DIR:-${SPIKE_DIR}/ios}"
APP_DIR="${IOS_DIR}/App/App"
PROJECT="${IOS_DIR}/App/App.xcodeproj/project.pbxproj"
STORYBOARD="${APP_DIR}/Base.lproj/Main.storyboard"
CAP_CONFIG="${APP_DIR}/capacitor.config.json"
SRC="${SPIKE_DIR}/native-notifications/ios/SortedNotificationsPlugin.swift"
DEST="${APP_DIR}/SortedNotificationsPlugin.swift"

[[ -f "${PROJECT}" && -f "${STORYBOARD}" && -f "${CAP_CONFIG}" ]] || { echo "ERROR: Capacitor iOS project missing. Run 'npx cap add ios' first." >&2; exit 1; }
cp "${SRC}" "${DEST}"

python3 - "${PROJECT}" "${STORYBOARD}" "${CAP_CONFIG}" <<'PY'
import hashlib, json, re, sys
project, storyboard, cap_config = sys.argv[1:]
s = open(project).read()
story = open(storyboard).read()
name = "SortedNotificationsPlugin.swift"
file_id = hashlib.sha1((name + " file").encode()).hexdigest().upper()[:24]
build_id = hashlib.sha1((name + " build").encode()).hexdigest().upper()[:24]
if name not in s:
    file_entry = f"\t\t{file_id} /* {name} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = {name}; sourceTree = \"<group>\"; }};\n"
    s = re.sub(r"(/\* Begin PBXFileReference section \*/\n)", r"\1" + file_entry, s, count=1)
    group_match = re.search(r"(isa = PBXGroup;[^}]*?children = \([^}]*?\n\s*\);[^}]*?path = App;[^}]*?\};)", s, re.S)
    if not group_match:
        raise SystemExit("ERROR: App PBXGroup missing; cannot add plugin source")
    group = group_match.group(1)
    group = re.sub(r"(children = \(\n)", r"\1\t\t\t\t" + file_id + f" /* {name} */,\n", group, count=1)
    s = s[:group_match.start()] + group + s[group_match.end():]
    build_entry = f"\t\t{build_id} /* {name} in Sources */ = {{isa = PBXBuildFile; fileRef = {file_id} /* {name} */; }};\n"
    s = re.sub(r"(/\* Begin PBXBuildFile section \*/\n)", r"\1" + build_entry, s, count=1)
    sources = re.search(r"(isa = PBXSourcesBuildPhase;[^}]*?files = \([^}]*?\n\s*\);[^}]*?\};)", s, re.S)
    if not sources:
        raise SystemExit("ERROR: PBXSourcesBuildPhase missing; cannot compile plugin source")
    phase = re.sub(r"(files = \(\n)", r"\1\t\t\t\t" + build_id + f" /* {name} in Sources */,\n", sources.group(1), count=1)
    s = s[:sources.start()] + phase + s[sources.end():]
open(project, "w").write(s)

controller = re.search(r'<viewController\b[^>]*customClass="(?:CAPBridgeViewController|SortedBridgeViewController)"[^>]*/>', story)
if not controller:
    raise SystemExit("ERROR: Capacitor bridge storyboard scene missing; cannot register plugin")
tag = controller.group(0)
tag = re.sub(r'customClass="[^"]*"', 'customClass="SortedBridgeViewController"', tag, count=1)
if 'customModule=' in tag:
    tag = re.sub(r'customModule="[^"]*"', 'customModule="App"', tag, count=1)
else:
    tag = tag[:-2] + ' customModule="App"/>'
if 'customModuleProvider=' in tag:
    tag = re.sub(r'customModuleProvider="[^"]*"', 'customModuleProvider="target"', tag, count=1)
else:
    tag = tag[:-2] + ' customModuleProvider="target"/>'
story = story[:controller.start()] + tag + story[controller.end():]
open(storyboard, "w").write(story)

# G466: list the plugin class in packageClassList, the same list `cap sync`
# writes for the npm plugins (StoreKit, push, ...). The bridge instantiates
# every class in it at bridge start, so SortedNotifications is also in
# Capacitor.PluginHeaders (belt-and-braces with the runtime fallback). Run after `cap sync`, which rewrites it.
cfg = json.load(open(cap_config))
classes = cfg.setdefault("packageClassList", [])
if "SortedNotificationsPlugin" not in classes:
    classes.append("SortedNotificationsPlugin")
json.dump(cfg, open(cap_config, "w"), indent="\t")
open(cap_config, "a").write("\n")
PY

grep -q "SortedNotificationsPlugin.swift in Sources" "${PROJECT}" || { echo "ERROR: notification Swift source was not added to the Xcode Sources phase" >&2; exit 1; }
grep -q 'customClass="SortedBridgeViewController".*customModule="App".*customModuleProvider="target"' "${STORYBOARD}" || { echo "ERROR: notification bridge controller is not bound to the App target" >&2; exit 1; }
python3 -c 'import json,sys; sys.exit(0 if "SortedNotificationsPlugin" in json.load(open(sys.argv[1])).get("packageClassList", []) else 1)' "${CAP_CONFIG}" || { echo "ERROR: SortedNotificationsPlugin is not in packageClassList" >&2; exit 1; }
echo "SortedNotifications iOS plugin installed, added to Sources and registered."
