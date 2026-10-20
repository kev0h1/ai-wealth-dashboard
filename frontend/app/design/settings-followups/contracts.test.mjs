// Preview-only contracts. Retire with the G296 design directory after approval.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { PlanPreview, ProfilePreview } from "./Sections.tsx";
import { PermissionRow, ConsentExplanation, RevokeExplanation } from "./Permission.tsx";
import { planFixture } from "./fixtures.ts";
const noop = () => {};
const text = html => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const source = name => readFileSync(new URL(name, import.meta.url), "utf8");
const permission = (checked, phase = "ready", pending = false) => render(h(PermissionRow, { checked, phase, pending, onChange: noop, onRetry: noop, switchRef: null }));
const plan = (state, platform = "web") => render(h(PlanPreview, { info: planFixture(state, platform), phase: ["loading", "error"].includes(state) ? state : "ready", onOpenPlans: noop, onRetry: noop }));
for (const checked of [false, true]) {
  const html = permission(checked);
  assert.match(html, new RegExp(`role="switch"[^>]*aria-checked="${checked}"`));
  assert.match(html, /aria-label="Setting things up"/);
  assert.match(html, /aria-describedby="penny-permission-help penny-permission-boundary"/);
  assert.match(html, /min-h-11 min-w-12/);
  assert.ok(text(html).includes(checked ? "On" : "Off"));
  assert.ok(text(html).includes("Every change needs your confirmation. Penny cannot move money or make bank payments."));
}
for (const phase of ["loading", "unavailable"]) {
  const html = permission(false, phase);
  assert.match(html, /data-permission-switch=""[^>]*|data-permission-switch="true"/);
  assert.match(html, /disabled=""/);
  assert.ok(!text(html).includes(" Off "));
  assert.ok(text(html).includes("Try again"));
}
assert.match(permission(false, "ready", true), /disabled=""/);
const consent = text(render(h(ConsentExplanation, { inSheet: false, onAccept: noop, onDecline: noop })));
for (const copy of ["Want me to be able to set things up for you?", "Things like envelopes, goals and one-offs.", "confirm before anything happens", "Yes, set things up", "Not now"]) assert.ok(consent.includes(copy), copy);
assert.ok(text(render(h(RevokeExplanation))).includes("proposals you have not confirmed will be cancelled"));
const profile = render(h(ProfilePreview, { name: "Alex Morgan", phase: "idle", dirty: false, onNameChange: noop, onSave: noop }));
assert.equal((profile.match(/<input/g) ?? []).length, 1);
assert.match(profile, /autoComplete="name"/);
assert.match(profile, /Full name/);
assert.ok(!/postcode|postal|latitude|longitude/i.test(profile));
assert.match(profile, /disabled=""/);
for (const platform of ["web", "ios", "android"]) {
  const fixture = planFixture("paid", platform);
  assert.deepEqual(fixture.prices_gbp, { statements: 0, lite: 5.99, standard: 9.99, plus: 12.99 });
  assert.equal(fixture.usage.penny_remaining, 266);
  assert.equal(fixture.usage.penny_messages + fixture.usage.penny_remaining, fixture.usage.penny_limit);
  const html = plan("paid", platform);
  assert.match(html, /£12\.99/);
  assert.match(html, /a month/);
  assert.equal((html.match(/<button/g) ?? []).length, 1, "one whole-row plan action");
  assert.ok(!/See plans|checkout is not live/i.test(html));
  assert.ok(text(html).includes(platform === "ios" ? "App Store" : platform === "android" ? "Google Play" : "Stripe"));
}
assert.ok(text(plan("free")).includes("Free access with no automatic renewal."));
assert.ok(text(plan("trial")).includes("Free until 3 Nov 2026, then £12.99 a month"));
assert.ok(text(plan("cancelled")).includes("Renewal is cancelled. Access ends on 3 Nov 2026."));
assert.ok(text(plan("past-due")).includes("Access is kept until 27 Oct 2026."));
assert.ok(text(plan("checkout-closed")).includes("Plus access No paid subscription."));
assert.ok(!text(plan("checkout-closed")).includes("checkout"));
assert.equal(planFixture("checkout-closed", "web").billing_live, false);
assert.ok(text(plan("loading")).includes("Checking your plan"));
assert.ok(text(plan("error")).includes("Tap to try again."));
const client = source("SettingsFollowupsClient.tsx");
assert.match(client, /previewOnly nativeOverride=\{platform !== "web"\}/);
assert.match(client, /onClickCapture=\{blockPickerLink\} onAuxClickCapture=\{blockPickerLink\}/);
assert.match(client, /onClickCapture=\{blockReference\} onAuxClickCapture=\{blockReference\}/);
assert.ok(!client.includes("manageHistory={false}"));
for (const name of ["SettingsFollowupsClient.tsx", "Permission.tsx", "Sections.tsx", "fixtures.ts"]) {
  const code = source(name);
  assert.ok(!/\bfetch\s*\(|\bapi\.\w+\s*\(|(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)/.test(code), `${name}: no account IO`);
  assert.ok(!code.includes("—"), `${name}: no em dash`);
}
console.log("G296 preview contracts passed: consent, permission states, profile, plan/provider fixtures and action isolation.");
