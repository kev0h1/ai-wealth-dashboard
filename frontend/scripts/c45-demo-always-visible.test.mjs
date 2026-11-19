// C45: native production builds always show the Demo sign-in link whatever
// /auth/demo/enabled does; web and UAT keep the runtime check; a 404 from
// /auth/demo/login says so calmly; a 401 keeps the generic message; and the
// production Play workflow saves uploads without auto-sending them for review.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// lib/api.ts captures `fetch` at import time, so install a delegating stub first.
let handler = async () => { throw new Error("no handler"); };
globalThis.fetch = (...a) => handler(...a);
const {
  demoLinkAlwaysVisible, resolveDemoEnabled, demoLogin,
  DEMO_FAILED_MESSAGE, DEMO_UNAVAILABLE_MESSAGE,
} = await import("../lib/demoLogin.ts");

// Native production: shown with the fetch failing, hanging, or answering false,
// and the fetch is never even consulted.
for (const [label, fetchEnabled] of [
  ["rejects", () => Promise.reject(new Error("offline"))],
  ["hangs", () => new Promise(() => {})],
  ["false", () => Promise.resolve(false)],
]) {
  assert.equal(await resolveDemoEnabled(true, "production", fetchEnabled), true, `native prod shows link when fetch ${label}`);
}
assert.equal(demoLinkAlwaysVisible(true, "production"), true);

// Web and native UAT keep the runtime check.
assert.equal(demoLinkAlwaysVisible(false, "production"), false, "web production is not forced");
assert.equal(demoLinkAlwaysVisible(true, "uat"), false, "native UAT is not forced");
assert.equal(demoLinkAlwaysVisible(true, undefined), false, "unset env is not forced");
assert.equal(await resolveDemoEnabled(false, "production", () => Promise.resolve(false)), false, "web follows a false answer");
assert.equal(await resolveDemoEnabled(false, "production", () => Promise.resolve(true)), true, "web follows a true answer");
assert.equal(await resolveDemoEnabled(true, "uat", () => Promise.resolve(false)), false, "native UAT follows a false answer");

// Login outcomes.
const reply = (status, body = {}) => async () => new Response(JSON.stringify(body), { status });
handler = reply(404);
assert.equal(await demoLogin("a@b.co", "x"), "unavailable", "404 is unavailable");
handler = reply(401);
assert.equal(await demoLogin("a@b.co", "x"), "failed", "401 is failed");
handler = async () => { throw new Error("offline"); };
assert.equal(await demoLogin("a@b.co", "x"), "unreachable", "network error stays unreachable");
assert.equal(DEMO_FAILED_MESSAGE, "Those details didn't work.");
assert.equal(DEMO_UNAVAILABLE_MESSAGE, "Demo sign-in is not available right now.");
assert.doesNotMatch(DEMO_UNAVAILABLE_MESSAGE, /[—–!]/, "copy rules");

// The component maps "unavailable" to its own message.
const comp = readFileSync(new URL("../components/DemoSignIn.tsx", import.meta.url), "utf8");
assert.match(comp, /result === "unavailable"\) return setMessage\(DEMO_UNAVAILABLE_MESSAGE\)/);

// codemagic.yaml: the production Play workflow (and the internal one) carry the flag.
const yaml = readFileSync(new URL("../../codemagic.yaml", import.meta.url), "utf8");
const block = (name) => {
  const start = yaml.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `${name} workflow exists`);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
for (const wf of ["android-capacitor-prod", "android-capacitor"]) {
  const play = block(wf).split("google_play:\n        credentials")[1] ?? "";
  assert.match(play, /^\s+track: \w+$/m, `${wf} publishes to a track`);
  assert.match(play, /^ {8}changes_not_sent_for_review: true$/m, `${wf} sets changes_not_sent_for_review`);
}
console.log("c45-demo-always-visible: ok");
