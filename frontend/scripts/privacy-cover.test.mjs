// Plain-Node test for A122 (app-switcher privacy cover): the pure decision in
// lib/privacyCover.ts. The DOM node itself and the native FLAG_SECURE / iOS
// overlay need the device retest (no DOM implementation in this runner).
import { coverAfterEvent, needsNativePrivacyBridge } from "../lib/privacyCover.ts";

let failed = 0;
function check(label, actual, expected) {
  if (actual !== expected) {
    failed += 1;
    console.error(`FAIL: ${label}: expected ${expected}, got ${actual}`);
  } else console.log(`PASS: ${label}`);
}

for (const ev of ["pause", "inactive"]) {
  check(`${ev} with lock on raises the cover`, coverAfterEvent(false, ev, true, true), true);
  check(`${ev} with lock off never covers`, coverAfterEvent(false, ev, true, false), false);
  check(`${ev} on web never covers`, coverAfterEvent(false, ev, false, true), false);
}
for (const ev of ["resume", "active"]) {
  check(`${ev} drops the cover`, coverAfterEvent(true, ev, true, true), false);
}
check("lock switched off while covered drops the cover", coverAfterEvent(true, "pause", true, false), false);
check("repeated pause stays covered", coverAfterEvent(true, "pause", true, true), true);

check("android needs the bridge", needsNativePrivacyBridge(true, "android"), true);
check("ios does not need the bridge", needsNativePrivacyBridge(true, "ios"), false);
check("web does not need the bridge", needsNativePrivacyBridge(false, "web"), false);

if (failed) process.exit(1);
console.log("privacy-cover: all checks passed");
