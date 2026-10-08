// G203: plain-Node check for the lock screen's presentation layer
// (components/LockScreenView.tsx + lib/lockScreenCopy.ts). No DOM is
// installed, so the .tsx is checked as source and the copy as pure code.
//
//   - the view is presentational: no fetch, storage, Capacitor, api, timers
//   - the sign-out button renders only under the failed state
//   - copy names the right biometry, with honest failed / timed-out states
//   - no gradient class anywhere (the gradient belongs to Penny alone)
//   - no em dashes in user-facing copy
//
// Run with: npm run -s check:lock-screen-view

import { readFileSync } from "node:fs";
import { biometryKindFromType, methodPhrase, lockCopy } from "../lib/lockScreenCopy.ts";

let failures = 0;
function ok(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

const viewSrc = readFileSync(new URL("../components/LockScreenView.tsx", import.meta.url), "utf8");
const copySrc = readFileSync(new URL("../lib/lockScreenCopy.ts", import.meta.url), "utf8");
// Code only: drop comments so prose cannot trip or mask a pattern.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
const view = strip(viewSrc);
const copy = strip(copySrc);

// 1. Presentational only.
for (const [name, re] of [
  ["fetch", /\bfetch\s*\(/],
  ["localStorage/sessionStorage", /\b(localStorage|sessionStorage)\b/],
  ["Capacitor", /Capacitor|@capacitor/],
  ["api / biometrics / appLock imports", /from\s+["']@\/lib\/(api|biometrics|appLock|privacyScreen|privacyCover)["']/],
  ["timers", /\b(setTimeout|setInterval)\b/],
  ["hooks", /\buse(State|Effect|LayoutEffect|Ref|Callback)\b/],
]) {
  ok(`view and copy have no ${name}`, !re.test(view) && !re.test(copy));
}

// 2. Sign-out button only in the failed state.
const signOutAt = view.indexOf("onClick={onSignOut}");
ok("sign-out button is present", signOutAt > 0);
ok("sign-out is the only use of onSignOut", view.split("onSignOut").length - 1 === 2 /* destructure + onClick */);
const before = view.slice(0, signOutAt);
const guardAt = before.lastIndexOf('state === "failed" && (');
const afterGuard = view.slice(guardAt, signOutAt);
ok('sign-out sits directly inside a state === "failed" guard', guardAt > 0 && !afterGuard.includes("</button>"));
ok("sign-out copy is provider-neutral", view.includes("Sign out and sign in again") && !/Google/.test(view));
ok("buttons are never rendered while prompting", /state !== "prompting" && \(/.test(view));

// 3. Copy per biometry kind.
const phrase = (platform, kind) => methodPhrase(platform, biometryKindFromType(kind));
ok("type mapping: undefined -> unknown, 0 -> none", biometryKindFromType(undefined) === "unknown" && biometryKindFromType(0) === "none");
ok("iOS Face ID", phrase("ios", 2) === "Face\u00a0ID");
ok("iOS Touch ID", phrase("ios", 1) === "Touch\u00a0ID");
ok("Android fingerprint", phrase("android", 3) === "your fingerprint");
ok("Android face", phrase("android", 4) === "face unlock");
ok("iris falls back to your biometrics", phrase("android", 5) === "your biometrics");
ok("passcode only", phrase("ios", 0) === "your passcode");
ok("unresolved check names no method", phrase("ios", undefined) === null);
const c = (state, failure, platform = "ios", kind = 2) =>
  lockCopy({ platform, biometry: biometryKindFromType(kind), state, failure });
ok("idle names Face ID", c("idle").includes("Face\u00a0ID"));
ok("prompting names the method", c("prompting", undefined, "android", 3).includes("your fingerprint"));
ok("unconfirmed is worded as not confirmed", c("failed", "unconfirmed").startsWith("That wasn't confirmed"));
ok("timeout is worded differently", c("failed", "timeout").startsWith("Nothing came back"));
ok("failed without a reason reads as not confirmed", c("failed", undefined).startsWith("That wasn't confirmed"));
ok("unresolved copy has no 'undefined' or 'null'", !/undefined|null/.test(c("idle", undefined, "ios", undefined)));
for (const [p, k] of [["ios", 2], ["ios", 1], ["android", 3], ["android", 4], ["ios", 0], ["ios", undefined]]) {
  for (const s of ["idle", "prompting", "failed"]) {
    ok(`no em dash in copy (${p}/${k}/${s})`, !c(s, "timeout", p, k).includes("—"));
  }
}
ok("no em dash in view source strings", !viewSrc.includes("—") && !copySrc.includes("—"));

// 4. No gradient, Penny mark is the glyph.
ok("no gradient class in the view", !/gradient/.test(view));
ok("no gradient class in the copy module", !/gradient/.test(copy));
ok("uses the Penny mark", /import PennyMark from "@\/components\/PennyMark"/.test(view) && /<PennyMark\b/.test(view));
ok("no lucide icons", !/lucide-react/.test(view));
ok("dialog semantics kept", /role="dialog"/.test(view) && /aria-modal="true"/.test(view) && /z-\[999\]/.test(view));
ok("status is a polite live region", /role="status"/.test(view) && /aria-live="polite"/.test(view));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
