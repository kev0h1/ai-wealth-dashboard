// G398 (Kevin 2026-11-02): Ink is the Penny icon default for anyone who has
// never chosen. Explicit Original and Outline choices are honoured, and the
// device seed is only ever overwritten by the server's answer.
// Run: npm run -s check:g398-penny-default
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_PENNY_APPEARANCE, PENNY_APPEARANCE_STORAGE_KEY, pennyAppearanceFromSnapshot,
  readSeededPennyAppearance, writeSeededPennyAppearance,
} from "../lib/pennyAppearance.ts";
import { applyWholeDocument } from "../lib/preferencesSnapshot.ts";

const memory = () => {
  const data = new Map();
  return { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
};

assert.equal(DEFAULT_PENNY_APPEARANCE, "ink");
for (const bad of [undefined, null, "", "chat", 9, [], {}]) {
  assert.equal(pennyAppearanceFromSnapshot(bad), "ink", `${JSON.stringify(bad)} falls back to ink`);
}
for (const kept of ["original", "outline", "ink"]) assert.equal(pennyAppearanceFromSnapshot(kept), kept);

// The whole-document apply (mount hydration) uses the same default.
const applied = [];
const cb = {
  applyHideNetWorth() {}, applyDarkMode() {}, applyPennyAppearance: v => applied.push(v),
  applyPayPeriodConfig() {}, applyDebtTargetMonths() {}, applyDebtTrackingStart() {},
  setSpendWidgets() {}, setHomePinnedWidget() {}, setDebtBurndownOverrides() {}, setRawPrefs() {},
};
applyWholeDocument({}, cb);
applyWholeDocument({ penny_appearance: "original" }, cb);
applyWholeDocument({ penny_appearance: "outline" }, cb);
assert.deepEqual(applied, ["ink", "original", "outline"], "unset becomes ink, explicit choices are kept");

// Seed: no seed stays null (neutral door, no flash of a gradient tile).
assert.equal(readSeededPennyAppearance(memory()), null);

// A pre-change device still seeded "original" with the server unset: the seed
// paints once, then the server answer (ink) replaces it, so it never persists.
const legacy = memory();
legacy.setItem(PENNY_APPEARANCE_STORAGE_KEY, "original");
assert.equal(readSeededPennyAppearance(legacy), "original");
writeSeededPennyAppearance(pennyAppearanceFromSnapshot(undefined), legacy);
assert.equal(readSeededPennyAppearance(legacy), "ink", "the server-resolved default overwrites the stale seed");

// An explicit server choice is written back unchanged.
writeSeededPennyAppearance(pennyAppearanceFromSnapshot("original"), legacy);
assert.equal(readSeededPennyAppearance(legacy), "original");

// Settings picker reads the context value, which starts from the one default.
const ctx = readFileSync(new URL("../components/PreferencesContext.tsx", import.meta.url), "utf8");
assert.match(ctx, /useState<PennyAppearance>\(DEFAULT_PENNY_APPEARANCE\)/);
console.log("g398-penny-default: ok");
