// D13: a fresh sign-in lands on Home unless a genuine destination is pending.
//   npm run -s check:post-sign-in-route
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postSignInDestination } from "../lib/postSignInRoute.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");
const none = { pendingBankReturn: false, pendingNotificationPath: false, oauthDetour: false };

assert.equal(postSignInDestination(none), "/");
assert.equal(postSignInDestination({ ...none, pendingBankReturn: true }), null);
assert.equal(postSignInDestination({ ...none, pendingNotificationPath: true }), null);
assert.equal(postSignInDestination({ ...none, oauthDetour: true }), null);

const auth = read("components/AuthProvider.tsx");
// logout and the local clear both navigate home (clearLocalSession is logout's tail).
const clear = auth.slice(auth.indexOf("function clearLocalSession()"));
assert.match(clear.slice(0, clear.indexOf("\n  }\n")), /router\.replace\("\/"\)/, "clearLocalSession navigates to /");
assert.ok(auth.includes("await api.logout();") && /clearLocalSession\(\);\n  }/.test(auth), "logout ends in clearLocalSession");
// fresh sign-in uses the helper; the cold-start init validate does not force a route.
assert.match(auth, /postSignInDestination\(/);
assert.match(auth, /onSignedIn=\{\(sig, fresh\) => establishSession\(sig, fresh === true\)\}/, "LoginScreen sign-in is a fresh sign-in");
assert.match(auth, /const outcome = await establishSession\(initCtrl\.signal\);/, "cold start is not fresh");
assert.ok(!/^[^/\n]*location\.reload\(/m.test(auth), "no reload in AuthProvider");
// Navigation happens before the user is set, so the bank-return replay is not clobbered.
assert.ok(auth.indexOf("router.replace(landOn)") < auth.indexOf("setUser({ email: data.email"), "navigate before setUser");
// The helper receives the REAL inputs, not constants.
assert.match(auth, /bank = hasPendingReturn\(window\.sessionStorage\)/);
assert.match(auth, /pendingBankReturn: bank,/);
assert.match(auth, /pendingNotificationPath: hasPendingNotificationPaths\(\),/);
assert.match(auth, /oauthDetour = !!sessionStorage\.getItem\("wd_oauth_consent_req"\)/);
assert.match(auth, /^\s+oauthDetour,$/m);
// Retrying the cold-start check is not a fresh sign-in; only a user-started attempt is.
const login = read("components/LoginScreen.tsx");
assert.match(login, /onSignedIn\(ctrl\.signal, userAttemptRef\.current\)/);
assert.match(login, /userAttemptRef\.current = true;/);
assert.ok((login.match(/userAttemptRef\.current = false;/g) || []).length >= 2, "cancel and dismiss reset it");
console.log("ok  post-sign-in-route");
