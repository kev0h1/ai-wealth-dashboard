import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { createNotificationPermissionController, INITIAL_NOTIFICATION_STATE } from "../lib/notificationPermissionController";
import { NotificationIntroduction, NotificationPermissionRowView, DeviceNotificationSettingsView, NotificationTopicsView } from "../components/notifications/NotificationViews";
import { notificationTopics } from "../lib/notificationTopics";

const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const base = { platform: "ios", permission: "prompt", registration: "needed", unavailable: null };
function harness(initial = {}, askedInitially = false) {
  let reading = { ...base, ...initial }, asked = askedInitially, uncertain = false, active = true;
  const calls = { read: 0, request: 0, register: 0, unsubscribe: 0, settings: 0 };
  const deps = {
    active: () => active,
    wasAsked: () => asked,
    markAsked: () => { asked = true; uncertain = true; },
    requestOutcomeUnknown: () => uncertain,
    markRequestCompleted: () => { uncertain = false; },
    read: async () => { calls.read++; return { ...reading }; },
    request: async () => { calls.request++; reading.permission = "granted"; return "granted"; },
    register: async () => { calls.register++; reading.registration = "ready"; },
    unsubscribe: async () => { calls.unsubscribe++; reading.registration = "off"; },
    openSettings: async () => { calls.settings++; },
  };
  const controller = createNotificationPermissionController(deps);
  const start = async () => { await controller.start(); };
  return { deps, calls, controller, start, state: controller.getSnapshot, set: patch => Object.assign(reading, patch), active: value => { active = value; }, asked: () => asked };
}

{
  const t = harness(); await t.start();
  assert.equal(t.state().introduction, true);
  assert.equal(t.calls.request, 0, "Reading first-launch permission never requests it");
  await t.controller.enable();
  assert.deepEqual([t.asked(), t.calls.request, t.calls.register], [true, 1, 1]);
  assert.deepEqual([t.state().permission, t.state().registration, t.state().introduction], ["granted", "ready", false]);
  t.controller.stop();
}
{
  const t = harness(); await t.start();
  t.deps.request = async () => { t.calls.request++; assert.equal(t.asked(), true, "Attempt recorded before the OS request"); t.set({ permission: "denied" }); return "denied"; };
  await t.controller.enable();
  assert.equal(t.calls.register, 0);
  assert.equal(t.state().permission, "denied");
  assert.equal(t.state().introduction, false);
  // Android can still report prompt after a dismissed/declined attempt.
  t.controller.stop();
  const next = harness({ permission: "prompt" }, t.asked()); await next.start();
  assert.equal(next.state().permission, "denied");
  assert.equal(next.state().introduction, false);
  assert.equal(next.calls.request, 0);
  next.controller.stop();
}
{
  const t = harness({ platform: "web" }); await t.start();
  const os = deferred();
  t.deps.request = () => { t.calls.request++; return os.promise; };
  const first = t.controller.enable();
  assert.equal(t.calls.request, 1, "Browser request starts in the original click stack");
  const second = t.controller.enable();
  assert.equal(t.calls.request, 1, "Repeated taps do not make a second request");
  t.set({ permission: "granted" }); os.resolve("granted");
  await Promise.all([first, second]);
  assert.equal(t.calls.register, 1);
  t.controller.stop();
}
{
  const t = harness(); await t.start();
  t.deps.request = async () => { t.calls.request++; throw Error("bridge failed before prompting"); };
  await t.controller.enable();
  assert.equal(t.state().permission, "unknown", "A failed request is not evidence of a denial");
  assert.equal(t.state().requestUncertain, true);
  assert.equal(t.state().introduction, false);
  const html = render(h(DeviceNotificationSettingsView, { state: t.state(), onAction() {}, onBrowserToggle() {} }));
  assert.match(html, /Open notification settings/);
  await t.controller.refresh(); await t.controller.enable();
  assert.equal(t.calls.request, 1, "Uncertain requests are never repeated automatically");
  t.set({ permission: "granted", registration: "ready" }); await t.controller.refresh();
  assert.equal(t.state().requestUncertain, false, "A real OS reading resolves the uncertain request");
  t.controller.stop();
}
{
  const t = harness(); await t.start();
  const os = deferred();
  t.deps.request = () => { t.calls.request++; return os.promise; };
  const pending = t.controller.enable();
  t.active(false); t.controller.stop(); os.resolve("granted"); await pending;
  assert.equal(t.calls.register, 0, "A signed-out/account-switched request cannot register for the new user");
}
{
  const t = harness(); await t.start();
  const os = deferred(); t.deps.request = () => os.promise;
  const pending = t.controller.enable();
  t.active(false); t.set({ permission: "granted" }); os.resolve("granted"); await pending;
  assert.equal(t.calls.register, 0, "No upload while the biometric lock is active");
  assert.equal(t.state().busy, false, "A lock during the prompt cannot leave a permanent busy state");
  t.active(true); await t.controller.refresh();
  assert.equal(t.state().permission, "granted");
  assert.equal(t.state().introduction, false);
  await t.controller.enable(); assert.equal(t.calls.register, 1);
  t.controller.stop();
}
{
  const t = harness({ permission: "denied" }); await t.start();
  await t.controller.openSettings(); await t.controller.refresh();
  assert.equal(t.state().permission, "denied", "Returning unchanged keeps the reminder");
  t.set({ permission: "granted", registration: "ready" }); await t.controller.refresh();
  assert.equal(render(h(NotificationPermissionRowView, { state: t.state(), onAction() {} })), "", "An enabled, registered device removes the reminder");
  t.controller.stop();
}
{
  const t = harness({ permission: "granted", registration: "needed" }); await t.start();
  t.deps.register = async () => { t.calls.register++; throw Error("offline"); };
  await t.controller.enable();
  assert.equal(t.state().permission, "granted", "Registration failure is not permission denial");
  assert.equal(t.state().registration, "needed");
  assert.match(t.state().error, /setup did not finish/);
  t.deps.register = async () => { t.calls.register++; t.set({ registration: "ready" }); };
  await t.controller.enable(); assert.equal(t.state().error, null);
  assert.equal(t.calls.request, 0, "Setup retries do not ask OS permission again");
  t.controller.stop();
}
{
  const t = harness({ permission: "denied" }); await t.start();
  t.deps.openSettings = async () => { throw Error("missing Activity"); };
  await t.controller.openSettings();
  assert.match(t.state().error, /Open Settings, find Sorted/);
  assert.equal(t.state().permission, "denied"); assert.equal(t.state().busy, false);
  t.controller.stop();
}
{
  const t = harness({ platform: "web", permission: "denied" }); await t.start();
  await t.controller.openSettings();
  assert.equal(t.calls.settings, 0, "Web never pretends it can open system settings");
  assert.equal(t.state().browserGuidance, true);
  t.set({ permission: "granted", registration: "needed" }); await t.controller.recheckBrowser();
  assert.equal(t.state().browserGuidance, false);
  assert.equal(t.state().registration, "needed", "Browser permission alone does not imply subscription");
  assert.equal(t.calls.register, 0, "A read does not override an existing browser subscription opt-out");
  await t.controller.enable(); assert.equal(t.calls.register, 1);
  await t.controller.disableBrowser();
  assert.equal(t.state().registration, "off");
  await t.controller.refresh(); assert.equal(t.calls.register, 1);
  t.controller.stop();
}
{
  const t = harness({ permission: "unavailable", unavailable: "old-app" }); await t.start();
  assert.equal(t.state().introduction, false); assert.equal(t.state().permission, "unavailable");
  await t.controller.enable(); assert.equal(t.calls.request, 0);
  t.controller.stop();
}
{
  const t = harness(); t.deps.read = async () => { throw Error("offline"); }; await t.start();
  assert.equal(t.state().permission, "unknown"); assert.equal(t.state().startup, false);
  assert.equal(t.state().introduction, false); t.controller.stop();
}
{
  const t = harness({ permission: "granted", registration: "checking" });
  const server = deferred();
  t.deps.checkRegistration = () => server.promise;
  const startup = t.start();
  await Promise.resolve();
  assert.equal(t.state().startup, false, "Slow delivery verification cannot block the whole product");
  assert.equal(t.state().permission, "granted");
  assert.equal(t.state().registration, "checking");
  server.reject(Error("offline")); await startup;
  assert.equal(t.state().registration, "unknown");
  assert.equal(t.state().permission, "granted", "Backend status failure is not an OS permission failure");
  t.controller.stop();
}
{
  const t = harness({ permission: "granted", registration: "checking" });
  const older = deferred(); let checks = 0;
  t.deps.checkRegistration = () => ++checks === 1 ? older.promise : Promise.resolve("ready");
  const startup = t.start(); await Promise.resolve();
  const registrationEvent = t.controller.refresh();
  older.resolve("needed"); await Promise.all([startup, registrationEvent]);
  assert.equal(checks, 2, "A token/resume event during an old status read queues a fresh read");
  assert.equal(t.state().registration, "ready", "The old pre-upload result cannot strand the reminder");
  t.controller.stop();
}
{
  const t = harness(); await t.start();
  const older = deferred(); let pendingRead = true;
  t.deps.read = async () => pendingRead ? older.promise : { ...base, permission: "granted", registration: "ready" };
  const stale = t.controller.refresh();
  pendingRead = false;
  await t.controller.enable();
  older.resolve({ ...base, permission: "denied" }); await stale;
  assert.equal(t.state().permission, "granted", "An older read cannot overwrite an explicit newer request");
  t.controller.stop();
}

const prefs = { transactions: true, goal_milestones: true, insights: true, period_digest: true, bill_alerts: true, category_pace: true, classification_attention: true };
for (const tipsEnabled of [false, true]) {
  const html = render(h(NotificationTopicsView, { preferences: prefs, tipsEnabled, onToggle() {} }));
  assert.equal((html.match(/role="switch"/g) ?? []).length, tipsEnabled ? 7 : 6);
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, tipsEnabled ? 7 : 6);
  assert.equal(html.includes("New tips about your spending"), tipsEnabled);
}
const saved = render(h(NotificationTopicsView, { preferences: { ...prefs, transactions: false, bill_alerts: false }, tipsEnabled: true, onToggle() {} }));
assert.equal((saved.match(/aria-checked="false"/g) ?? []).length, 2);
assert.match(saved, /bg-slate-500/);
assert.equal(notificationTopics(false).some(topic => topic.key === "insights"), false);
const intro = render(h(NotificationIntroduction, { native: true, busy: false, onContinue() {} }));
for (const glyph of ["bell", "calendar-dots", "list-checks"]) assert.ok(intro.includes(`data-phosphor-icon="${glyph}"`));
assert.doesNotMatch(intro, /lucide|Send a test notification|bg-gradient/);
const off = { ...INITIAL_NOTIFICATION_STATE, ...base, permission: "denied", startup: false };
const row = render(h(NotificationPermissionRowView, { state: off, onAction() {} }));
assert.match(row, /Turn on notifications/); assert.match(row, /data-phosphor-icon="bell-slash"/);
assert.doesNotMatch(row, /Dismiss|aria-label="Close|text-red|bg-red|text-rose/);
for (const permission of ["prompt", "denied", "granted", "unknown", "unavailable"]) {
  const html = render(h(DeviceNotificationSettingsView, { state: { ...off, permission }, onAction() {}, onBrowserToggle() {} }));
  assert.doesNotMatch(html, /Send a test notification|lucide/);
}
const checkingWeb = render(h(DeviceNotificationSettingsView, { state: { ...off, platform: "web", permission: "granted", registration: "checking" }, onAction() {}, onBrowserToggle() {} }));
assert.doesNotMatch(checkingWeb, /role="switch"|<button/, "A registration check exposes no action until it completes");

const source = file => readFileSync(new URL(file, import.meta.url), "utf8");
const home = source("../app/components/HomePage.tsx");
assert.ok(home.indexOf("<HomeNotificationPermission") > home.indexOf("<HomeTransfersCheck"));
const auth = source("../components/AuthProvider.tsx");
assert.ok(auth.indexOf('<NotificationPermissionProvider account={user.email}>') > auth.indexOf("if (!user)"), "Permission controller is behind sign-in");
assert.ok(auth.indexOf('<NotificationPermissionProvider account={user.email}>') > auth.indexOf('pathname?.startsWith("/design/")'), "Anonymous design routes never mount it");
assert.match(auth, /pathname === "\/ops" \|\| pathname\?\.startsWith\("\/ops\/"\) \? content : <NotificationPermissionProvider/, "The Board app's operational route never starts a notification permission journey");
assert.match(source("../components/NativePushResync.tsx"), /if \(!email\) return/);
assert.doesNotMatch(source("../app/settings/SettingsPage.tsx"), /Send a test notification|handleTestPush|handleRegisterDevice/);
assert.match(source("../components/TutorialContext.tsx"), /if \(notificationIntroduction\) return/);
assert.match(source("../lib/capacitorPush.ts"), /options\.requestPermission === true/, "Registration is prompt-free by default");
assert.match(source("../lib/notificationPermissions.ts"), /getToken\(\) === session/, "Async work checks the original signed-in session");
assert.match(source("../lib/nativeNotificationSettings.ts"), /headers\.some\(header => header\.name === "SortedNotifications"\)/);
assert.ok(!existsSync(new URL("../app/design/g409-notifications", import.meta.url)), "Approved temporary previews retired");
console.log("G409: permission flow, no-repeat requests, session/lock races, resume, browser opt-outs, Phosphor icons and accessible production views passed");
