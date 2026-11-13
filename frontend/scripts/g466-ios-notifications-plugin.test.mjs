// G466: belt-and-braces. The iOS SortedNotifications plugin is also registered
// at bridge start through packageClassList in the generated
// capacitor.config.json (the way npm plugins like StoreKit's NativePurchases
// are); the runtime registerPluginInstance fallback remains. The proven root
// cause of "Update to check notifications" is NOT established; this change is
// harmless either way, and the on-device diagnostic below captures the cause.
// No Xcode here, so this runs the real setup script against a fake ios/ tree
// and reads the Swift and TS sources.
import assert from "node:assert/strict";
import { reportMissingNotificationBridge } from "../lib/nativeNotificationSettings";
import { readFileSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../../", import.meta.url).pathname;
const spike = join(root, "capacitor-spike");
const swift = readFileSync(join(spike, "native-notifications/ios/SortedNotificationsPlugin.swift"), "utf8");
const ts = readFileSync(join(root, "frontend/lib/nativeNotificationSettings.ts"), "utf8");
const codemagic = readFileSync(join(root, "codemagic.yaml"), "utf8");
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok", name); };

ok("Swift class is a CAPBridgedPlugin with the expected jsName and methods", () => {
  assert.match(swift, /@objc\(SortedNotificationsPlugin\)/);
  assert.match(swift, /class SortedNotificationsPlugin: CAPPlugin, CAPBridgedPlugin/);
  assert.match(swift, /jsName = "SortedNotifications"/);
  assert.match(swift, /identifier = "SortedNotificationsPlugin"/);
  assert.match(swift, /CAPPluginMethod\(name: "getStatus"/);
  assert.match(swift, /CAPPluginMethod\(name: "openSettings"/);
});

ok("runtime registration is only a guarded fallback (no double registration)", () => {
  assert.match(swift, /bridge\.plugin\(withName: "SortedNotifications"\) == nil/);
  assert.equal((swift.match(/registerPluginInstance/g) || []).length, 1);
});

ok("web header check is kept and never invokes a missing proxy (A133)", () => {
  assert.match(ts, /PluginHeaders/);
  assert.match(ts, /header\.name === "SortedNotifications"/);
  assert.match(ts, /if \(!hasNativeNotificationSettings\(\)\) throw/);
});

ok("codemagic runs the setup script after cap sync", () => {
  const sync = codemagic.indexOf("npx cap sync ios");
  const setup = codemagic.indexOf("bash scripts/setup-ios-notifications.sh");
  assert.ok(sync > 0 && setup > sync);
});

ok("setup script adds SortedNotificationsPlugin to packageClassList, idempotently, keeping cap sync's entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "g466-"));
  const app = join(dir, "App/App");
  mkdirSync(join(app, "Base.lproj"), { recursive: true });
  mkdirSync(join(dir, "App/App.xcodeproj"), { recursive: true });
  writeFileSync(join(dir, "App/App.xcodeproj/project.pbxproj"), [
    "/* Begin PBXBuildFile section */", "/* End PBXBuildFile section */",
    "/* Begin PBXFileReference section */", "/* End PBXFileReference section */",
    "\t\tAAAA = {", "\t\t\tisa = PBXGroup;", "\t\t\tchildren = (", "\t\t\t);", "\t\t\tpath = App;", "\t\t};",
    "\t\tBBBB = {", "\t\t\tisa = PBXSourcesBuildPhase;", "\t\t\tfiles = (", "\t\t\t);", "\t\t};", ""].join("\n"));
  writeFileSync(join(app, "Base.lproj/Main.storyboard"), '<viewController customClass="CAPBridgeViewController" id="x"/>');
  writeFileSync(join(app, "capacitor.config.json"), JSON.stringify({ appId: "x", packageClassList: ["NativePurchasesPlugin", "PushNotificationsPlugin"] }, null, "\t"));
  const run = () => execFileSync("bash", [join(spike, "scripts/setup-ios-notifications.sh")], { env: { ...process.env, IOS_DIR: dir }, encoding: "utf8" });
  run(); run();
  const cfg = JSON.parse(readFileSync(join(app, "capacitor.config.json"), "utf8"));
  assert.deepEqual(cfg.packageClassList, ["NativePurchasesPlugin", "PushNotificationsPlugin", "SortedNotificationsPlugin"]);
  assert.equal(cfg.appId, "x");
});

ok("diagnostic: fires once, only on native iOS with the header missing, plugin names only", () => {
  const mk = (platform, headers, native = true) => ({
    isNativePlatform: () => native, getPlatform: () => platform, PluginHeaders: headers, registerPlugin: () => {},
    isPluginAvailable: () => false,
  });
  const run = (cap) => { const sent = []; reportMissingNotificationBridge({ cap, build: "b1", send: (...a) => { sent.push(a); } }); return sent; };
  assert.deepEqual(run(mk("android", [{ name: "App" }])), []);
  assert.deepEqual(run(mk("ios", [{ name: "App" }], false)), []);
  assert.deepEqual(run(mk("ios", [{ name: "SortedNotifications" }])), []);
  const sent = run(mk("ios", [{ name: "PushNotifications" }, { name: "App", secret: "x" }]));
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], "notification-bridge-missing");
  assert.equal(sent[0][1], "plugin_headers=[App,PushNotifications] platform=ios app=b1 registerPlugin=function");
  assert.equal(sent[0][2], "ios");
  assert.deepEqual(run(mk("ios", [{ name: "App" }])), [], "once per launch");
});

ok("Swift logs the registration state on device", () => {
  assert.match(swift, /NSLog\("\[G466\] capacitorDidLoad/);
  assert.match(swift, /registered before fallback/);
  assert.match(swift, /registered after fallback/);
});

console.log(`g466: ${n} checks passed`);
