// B53: the paid tiers are Lite, Standard and Plus. Pins the plan picker copy
// numbers, that Max and Connect are no longer offered, and the Plus upsell.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const picker = read("../components/PlanPicker.tsx");
const more = read("../components/MoreMessagesSheet.tsx");
const assistants = read("../components/ConnectedAssistantsCard.tsx");
const types = read("../../shared/src/types.ts");
const onboarding = read("../components/Onboarding.tsx");

// The TIERS array, up to its closing bracket.
const tiersBlock = picker.slice(picker.indexOf("const TIERS: Tier[] = ["), picker.indexOf("];", picker.indexOf("const TIERS: Tier[] = [")));
const ids = [...tiersBlock.matchAll(/\bid: "([a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(ids, ["statements", "lite", "standard", "plus"], "picker offers Statements, Lite, Standard, Plus only");
assert.ok(!/"Max"|"Connect"|id: "max"|id: "connect"/.test(tiersBlock), "no Max or Connect in the picker");

for (const line of [
  "Up to 10 connected accounts", "40 Penny messages a month",
  "Up to 25 connected accounts", "150 Penny messages a month",
  "Unlimited connected accounts", "300 Penny messages a month", "All features",
]) assert.ok(tiersBlock.includes(`"${line}"`), `picker includes "${line}"`);
assert.ok(!tiersBlock.includes("Up to 3 connected banks") && !tiersBlock.includes("Up to 20 connected accounts"), "old limits gone");
assert.ok(!/Daily bank updates|months of history|Priority bank updates|Updates every 4 hours|Full history/.test(tiersBlock), "paid bullets are accounts, Penny and all features only");
assert.ok(picker.includes("Plans differ only in connected accounts and Penny messages."), "picker states the true differentiator");
assert.ok(picker.includes("Every paid plan has all features"), "picker says every paid plan has all features");
assert.ok(onboarding.includes("Every paid plan has all features"), "onboarding says every paid plan has all features");

assert.match(types, /export type SubscriptionTier = "statements" \| "lite" \| "standard" \| "plus";/);
assert.ok(more.includes("Move to Plus, 300 a month"), "Penny sheet upsell is Plus, 300 a month");
assert.ok(!/Move to Max/.test(more), "Penny sheet no longer says Move to Max");
assert.ok(assistants.includes("Available on every paid plan") && !/Connect and Max|on Plus/.test(assistants), "assistants card names every paid plan");

for (const text of [tiersBlock, more, assistants, onboarding.slice(onboarding.indexOf("Choose your plan"), onboarding.indexOf("Choose your plan") + 400)]) {
  const copyStrings = [...text.matchAll(/"([^"\n]{12,})"/g)].map((m) => m[1]);
  for (const s of copyStrings) {
    assert.ok(!s.includes("—"), `em dash in: ${s}`);
    if (/[a-z] ?!(?!=)/.test(s) && !/[=!]==?|\|\|/.test(s)) assert.ok(!s.includes("!"), `exclamation mark in: ${s}`);
  }
}
console.log("B53: Lite 10, Standard 25, Plus unlimited accounts; 40, 150, 300 Penny; Max and Connect absent.");
