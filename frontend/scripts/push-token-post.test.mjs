// A140: with the biometric lock on, the push token upload was refused by the
// api.ts gate (AppLockedError) and never retried, so the server had no device.
// Imports lib/capacitorPush.ts directly (it loads under node) with the api
// token calls stubbed, and proves: a lock refusal defers ONE retry to unlock
// with the same token, a non-lock error schedules no retry, and a sign-out
// cancel (unregisterCapacitorPush is native-only, so the source guards cover
// it) plus source guards for the listener and resyncCompleted.
//
// Run with: npm run -s check:push-token-post

import { readFileSync } from "node:fs";
import { setAppLocked } from "../lib/appLock";
import { api, AppLockedError } from "../lib/api";
import { postPushToken } from "../lib/capacitorPush";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

const calls = [];
let mode = "lock-then-ok";
api.registerFcmToken = (token, plat) => {
  calls.push([token, plat]);
  if (mode === "lock-then-ok" && calls.length === 1) return Promise.reject(new AppLockedError());
  if (mode === "other-error") return Promise.reject(new Error("boom"));
  return Promise.resolve({});
};

const origError = console.error;
console.error = () => {};

setAppLocked(true);
await postPushToken("tok-1", "android");
await tick();
check("lock refusal: one attempt so far", calls.length, 1);
setAppLocked(false);
await tick();
check("after unlock: retried once with the same token", calls, [["tok-1", "android"], ["tok-1", "android"]]);
setAppLocked(true);
setAppLocked(false);
await tick();
check("another lock/unlock cycle does not retry again", calls.length, 2);

calls.length = 0;
mode = "other-error";
setAppLocked(true);
await postPushToken("tok-2", "android");
setAppLocked(false);
await tick();
check("non-lock error: no retry scheduled", calls.length, 1);

console.error = origError;

const src = readFileSync(new URL("../lib/capacitorPush.ts", import.meta.url), "utf8");
check("registration listener calls postPushToken", /addListener\("registration"[\s\S]*?postPushToken\(token\.value/.test(src), true);
check("resyncCompleted = true only behind a granted check", /=== "granted"\) resyncCompleted = true/.test(src) && (src.match(/resyncCompleted = true/g) || []).length === 1, true);
check("unregister cancels pending post and resync", /unregisterCapacitorPush[\s\S]*?cancelPendingTokenPost\?\.\(\)[\s\S]*?cancelPendingResync\?\.\(\)/.test(src), true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
