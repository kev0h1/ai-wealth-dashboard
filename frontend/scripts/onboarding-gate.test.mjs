// D12: onboarding is unreachable unless a loaded profile says exactly `false`,
// and plan selection is never written while billing is off.
//   npm run -s check:onboarding-gate
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { needsOnboarding, shouldShowOnboarding, markOnboarded, clearOnboarded, isMarkedOnboarded } from "../lib/onboardingGate.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(here, "..", p), "utf8");
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };

assert.equal(needsOnboarding(null), false, "failed fetch");
assert.equal(needsOnboarding(undefined), false);
assert.equal(needsOnboarding({}), false, "missing field");
assert.equal(needsOnboarding({ onboarding_complete: null }), false);
assert.equal(needsOnboarding({ onboarding_complete: true }), false);
assert.equal(needsOnboarding({ onboarding_complete: false }), true);

const s = mem();
assert.equal(shouldShowOnboarding({ onboarding_complete: false }, s, "a@b.com"), true, "new user");
assert.equal(shouldShowOnboarding({ onboarding_complete: true }, s, "A@b.com"), false);
assert.ok(isMarkedOnboarded(s, "a@b.com"), "complete profile marks the user");
assert.equal(shouldShowOnboarding({ onboarding_complete: false }, s, "a@b.com"), false, "later false never re-shows");
assert.equal(shouldShowOnboarding({ onboarding_complete: false }, s, "other@b.com"), true, "flag is per user");
clearOnboarded(s, "a@b.com");
assert.equal(shouldShowOnboarding({ onboarding_complete: false }, s, "a@b.com"), true, "cleared on deletion");
markOnboarded(s, null); // no email: no-op, no throw

const auth = read("components/AuthProvider.tsx");
assert.match(auth, /shouldShowOnboarding\(profile, localStorage, sessionEmailRef\.current\)/);
assert.ok(!/!profile\.onboarding_complete/.test(auth), "no falsy check on the profile flag");
assert.equal((auth.match(/setNeedsOnboarding\(true\)/g) || []).length, 1, "one path into onboarding");
assert.match(read("app/settings/SettingsPage.tsx"), /clearOnboarded\(localStorage/);

// C37: the plan step is skipped only for a purchase channel known to be off
// (D12 per channel); PlanPicker never renders for it and never while the
// channel is still unknown.
const ob = read("components/Onboarding.tsx");
assert.match(ob, /const purchaseChannel = usePurchaseChannel\(\);/);
assert.match(ob, /const channelKnown = purchaseChannel !== "unknown";/);
assert.match(ob, /const channelLive = channelKey !== null && planInfo\?\.billing_channels\?\.\[channelKey\] === true;/);
assert.match(ob, /const channelOff = !!planInfo && channelKnown && !channelLive;/);
assert.match(ob, /if \(step !== "plan" \|\| !channelOff\) return;[\s\S]{0,120}setStep\("income"\)/);
assert.ok(!/billingOff/.test(ob), "the Stripe-only billingOff gate is gone");
const planBlock = ob.slice(ob.indexOf('if (step === "plan")'), ob.indexOf('if (step === "income")'));
const gateAt = planBlock.indexOf("channelOff || !channelKnown ?");
assert.ok(gateAt > 0 && gateAt < planBlock.indexOf("<PlanPicker"), "PlanPicker only after the channel gate");
assert.match(ob, /billing_live_any === true[\s\S]{0,80}api\.selectFreePlan\(\)/, "skip writes Statements only when a channel is live");
assert.ok(!/Wealth/.test(ob), "the app is Sorted, never Wealth, in onboarding copy");
assert.ok(!/\p{Extended_Pictographic}/u.test(ob.replace(/[\u2190-\u21FF]/g, "")), "no emoji in Onboarding.tsx");
assert.ok(!ob.split("\n").some((l) => l.includes("\u2014") && !/^\s*(\/\/|\*|\/\*)/.test(l)), "no em dash in Onboarding.tsx copy (comments aside)");
console.log("ok  onboarding-gate");
