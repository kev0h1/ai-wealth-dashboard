// Production-component contracts; no temporary design route or real API IO.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import YourPlanCard from "../components/YourPlanCard.tsx";
import { PennyPermissionView } from "../components/settings/PennyPermissionSettings.tsx";
import { ProfileSettingsForm } from "../components/settings/ProfileSettingsForm.tsx";
import { savePennyPermission } from "../lib/pennyPermission.ts";
import { planFixture } from "./fixtures/g296-settings.ts";
const noop = () => {};
const router = { bfcacheId: "g296", push: noop, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: async () => {} };
const plan = (state, platform = "web", overrides = {}) => render(h(AppRouterContext.Provider, { value: router }, h(YourPlanCard, { info: state === "loading" || state === "error" ? null : { ...planFixture(state, platform), ...overrides }, error: state === "error" })));
const permission = props => render(h(PennyPermissionView, { checked: false, phase: "ready", busy: false, intent: null, error: "", notice: "", onRequest: noop, onConfirm: noop, onCancel: noop, onRetry: noop, ...props }));
for (const checked of [false, true]) {
  const html = permission({ checked });
  assert.match(html, new RegExp(`role="switch"[^>]*aria-checked="${checked}"`));
  assert.match(html, /aria-describedby="penny-permission-help penny-permission-boundary"/);
  assert.match(html, /Penny cannot move money or make bank payments/);
  assert.doesNotMatch(html, /Penny permission confirmation/, "no consent action runs or renders before request");
}
for (const phase of ["loading", "unavailable"]) {
  const html = permission({ phase });
  assert.doesNotMatch(html, /aria-checked|role="switch"/, "unknown state is not announced as Off");
  assert.match(html, /data-permission-switch=""[^>]*disabled|disabled=""[^>]*data-permission-switch/);
}
const pending = permission({ intent: true });
for (const copy of ["Want me to be able to set things up for you?", "confirm before anything happens", "Yes, set things up", "Not now"]) assert.ok(pending.includes(copy));
assert.doesNotMatch(pending, /role="dialog"/, "approved A stays inline");
assert.match(permission({ checked: true, intent: false }), /proposals you have not confirmed will be cancelled/);
assert.match(permission({ checked: true, intent: false, busy: true }), /<fieldset disabled=""/);
assert.match(permission({ error: "Could not verify permission" }), /role="alert"/);
const profile = render(h(ProfileSettingsForm, { name: "Alex Morgan", loading: false, loadError: false, saving: false, dirty: true, status: "", onChange: noop, onSave: noop, onRetry: noop }));
assert.equal((profile.match(/<input/g) || []).length, 1);
assert.match(profile, /autoComplete="name"/);
assert.match(profile, /<form/);
assert.doesNotMatch(profile, /postcode|postal|latitude|longitude/i);
for (const platform of ["web", "ios", "android"]) {
  const html = plan("paid", platform);
  assert.match(html, /£12\.99/); assert.match(html, /a month/);
  assert.ok(html.includes(platform === "ios" ? "App Store" : platform === "android" ? "Google Play" : "Stripe"));
  assert.doesNotMatch(html, /See plans|checkout is not live/);
}
assert.match(plan("paid", "web", { billing_period: "annual" }), /£129\.99/);
assert.match(plan("paid", "web", { billing_period: "annual" }), /a year/);
assert.doesNotMatch(plan("paid", "web", { billing_prices_gbp: undefined }), /£12\.99/, "missing catalogue cannot invent the current price");
assert.match(plan("free"), /Free access with no automatic renewal/);
assert.match(plan("trial"), /Free until 3 Nov 2026, then/);
assert.match(plan("cancelled"), /Renewal is cancelled/);
assert.doesNotMatch(plan("cancelled"), /Renews |then £/);
assert.match(plan("past-due"), /Access is kept until 27 Oct 2026/);
assert.match(plan("checkout-closed"), /No paid subscription/);
assert.doesNotMatch(plan("checkout-closed"), /£12\.99/);
assert.match(plan("loading"), /Checking your plan/);
assert.match(plan("error"), /Tap to try again/);

// A lost response can still mean the server committed the write. Only the
// verified read, never an optimistic flag, may decide what the switch shows.
for (const desired of [false, true]) for (const mutationFails of [false, true]) for (const saved of [false, true, null, "throw"]) {
  const calls = [];
  const write = label => async () => { calls.push(label); if (mutationFails) throw Error("lost response"); };
  const result = await savePennyPermission(desired, { grant: write("grant"), revoke: write("revoke"), refresh: async () => { calls.push("refresh"); if (saved === "throw") throw Error("offline"); return saved === null ? null : { penny_agent_consent: saved ? "timestamp" : null }; } });
  assert.deepEqual(calls, [desired ? "grant" : "revoke", "refresh"]);
  assert.deepEqual(result, saved === null || saved === "throw" ? { kind: "unknown" } : { kind: saved === desired ? "confirmed" : "rejected", checked: saved });
}
const source = file => readFileSync(new URL(file, import.meta.url), "utf8");
const controller = source("../components/settings/PennyPermissionSettings.tsx");
assert.match(controller, /saving\.current/, "duplicate submissions guarded synchronously");
assert.match(controller, /setIntent\(!snapshot\?\.penny_agent_consent\)/);
assert.doesNotMatch(controller, /usePurchaseChannel|nativeOverride|platform ===/, "permission UI is identical across purchase channels");
assert.match(controller, /confirmationRef\.current\?\.focus/);
const api = source("../lib/api.ts");
assert.match(api, /updateProfile: async \(full_name: string, complete = true\)/);
assert.match(source("../next.config.ts"), /geolocation=\(self\)/, "same-origin point-of-use geolocation is not blocked by the document policy");
assert.doesNotMatch(source("../components/Onboarding.tsx"), /postcode/i);
assert.ok(!existsSync(new URL("../app/design/settings-followups", import.meta.url)), "approved design preview retired under H113");
console.log("G296 Settings: production consent/profile/plan renders and all 16 permission reconciliation paths passed.");
