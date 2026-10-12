// A138: native push must re-register after sign-in even when the first token
// wait races the token deleted at logout. Drives the pure resync controller.
// Run with: npm run -s check:a138-push-resync
import { readFileSync } from "node:fs";
import { createPushResyncController, RESYNC_BACKOFF_MS } from "../lib/capacitorPush";
import { noDeviceAdvice, REGISTER_DEVICE_LABEL } from "../lib/testPushAdvice";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { failures += 1; console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`); }
  else console.log(`PASS: ${label}`);
}

function harness(results) {
  const timers = [];
  let calls = 0;
  const c = createPushResyncController({
    attempt: async () => results[Math.min(calls++, results.length - 1)],
    setTimer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimer: (t) => { t.live = false; },
  });
  const fire = async () => { const t = timers.filter((x) => x.live).pop(); t.live = false; t.fn(); await Promise.resolve(); await Promise.resolve(); };
  return { c, timers, calls: () => calls, fire };
}

check("backoff schedule", RESYNC_BACKOFF_MS, [2000, 5000, 15000, 45000]);

{
  const h = harness(["no-token", "no-token", "granted"]);
  await h.c.run();
  check("no-token: not completed, retry in 2s", [h.c.completed, h.timers.map((t) => t.ms)], [false, [2000]]);
  await h.fire();
  check("second no-token: not completed, retry in 5s", [h.c.completed, h.timers.map((t) => t.ms), h.calls()], [false, [2000, 5000], 2]);
  await h.fire();
  check("granted: completed after success only", [h.c.completed, h.calls()], [true, 3]);
  await h.c.run();
  check("completed: no further attempts", h.calls(), 3);
}
{
  const h = harness(["unavailable"]);
  await h.c.run();
  for (let i = 0; i < 6; i++) { if (h.timers.some((t) => t.live)) await h.fire(); }
  check("bounded: schedule stops after the last delay", [h.timers.map((t) => t.ms), h.calls(), h.c.completed], [[2000, 5000, 15000, 45000], 5, false]);
  const live = h.timers.filter((t) => t.live).length;
  await h.c.resume();
  check("resume after exhaustion: one more attempt, no new timer", [h.calls(), h.timers.length, live], [6, 4, 0]);
}
{
  const h = harness(["no-token", "granted"]);
  await h.c.run();
  await h.c.resume();
  check("resume retries and completes", [h.c.completed, h.calls()], [true, 2]);
}
{
  const h = harness(["skipped"]);
  await h.c.run();
  check("skipped (no session / not granted): no retry timer", [h.timers.length, h.c.completed], [0, false]);
}
{
  const h = harness(["denied", "granted"]);
  await h.c.run();
  check("denied: no retry timer", [h.timers.length, h.c.completed], [0, false]);
}
{
  const h = harness(["no-token", "granted"]);
  await h.c.run();
  h.c.reset();
  check("reset (sign-out) cancels the pending retry", h.timers.every((t) => !t.live), true);
  await h.c.run();
  check("after reset a new sign-in resyncs", h.c.completed, true);
}

{
  // reset while an attempt is in flight, then run(): the new generation attempts and completes.
  const releases = [];
  const results = ["no-token", "granted"];
  let calls = 0;
  const c = createPushResyncController({
    attempt: () => new Promise((res) => { const r = results[calls++]; releases.push(() => res(r)); }),
    setTimer: () => ({}),
    clearTimer: () => {},
  });
  const first = c.run();
  c.reset();
  const second = c.run();
  check("reset mid-attempt: new run() starts its own attempt", calls, 2);
  releases[1]();
  await second;
  check("new generation completes", c.completed, true);
  releases[0]();
  await first;
  check("stale attempt finishing later does not undo or retry", [c.completed, calls], [true, 2]);
}

// Settings action: native vs web.
const n = noDeviceAdvice(true), w = noDeviceAdvice(false);
check("native: Register this device action, no toggle advice", [n.action, /off and on/i.test(n.text)], [REGISTER_DEVICE_LABEL, false]);
check("web: toggle advice kept, no action", [w.action, /off and on/i.test(w.text)], [null, true]);
check("copy: no em dashes or exclamations", [n.text + w.text].every((t) => !/[—!]/.test(t)), true);

// Source guards.
const push = readFileSync(new URL("../lib/capacitorPush.ts", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/settings/SettingsPage.tsx", import.meta.url), "utf8");
check("resume listener gated on PluginHeaders App", /h\.name === "App"/.test(push) && /addListener\("resume"/.test(push), true);
check("settings wires Register this device to init then re-test", /handleRegisterDevice/.test(settings) && /await initCapacitorPush\(\)/.test(settings) && /noDeviceAdvice\(notifPermission === "native"\)/.test(settings), true);
check("settings has no hardcoded off-and-on advice", /off and on again/.test(settings), false);

const helper = readFileSync(new URL("../lib/testPushAdvice.ts", import.meta.url), "utf8");
check("old toggle sentence appears only in the web branch of the helper", [/Turn notifications off and on/.test(settings), (helper.match(/Turn notifications off and on/g) || []).length], [false, 1]);
check("no comma-splice blocked copy anywhere", /blocked, enable/i.test(settings + helper), false);
check("every blocked branch uses the shared text", (settings.match(/NOTIFICATIONS_BLOCKED_TEXT/g) || []).length >= 3, true);

if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log("all passed");
