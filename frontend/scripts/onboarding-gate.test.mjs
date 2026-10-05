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

// Billing off: the plan step is skipped and PlanPicker never renders.
const ob = read("components/Onboarding.tsx");
assert.match(ob, /const billingOff = !!planInfo && planInfo\.billing_live !== true;/);
assert.match(ob, /if \(step !== "plan" \|\| !billingOff\) return;[\s\S]{0,120}setStep\("income"\)/);
const planBlock = ob.slice(ob.indexOf('if (step === "plan")'), ob.indexOf('if (step === "income")'));
assert.ok(planBlock.indexOf("billingOff ?") > 0 && planBlock.indexOf("billingOff ?") < planBlock.indexOf("<PlanPicker"), "PlanPicker only after the billingOff branch");
console.log("ok  onboarding-gate");
