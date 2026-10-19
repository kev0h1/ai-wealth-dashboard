// G294: a store that answers without the selected product must read as
// unavailable (with a retry), never as an endless "Loading". The picker's
// store states are effect-driven, so the render harness (static markup) cannot
// reach them; this proves the pure helper and pins each render site and the
// retry wiring in the component source.
//
// Run: npm run -s check:g294-store-unavailable
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { storePriceState, describeProductLookup, errorKind } from "../lib/storePriceState.ts";

for (const state of ["ready", "failed"]) {
  assert.equal(storePriceState(state, false), "unavailable", `${state} with no view is unavailable`);
}
for (const state of ["idle", "loading"]) {
  assert.equal(storePriceState(state, false), "loading", `${state} with no view is loading`);
}
for (const state of ["idle", "loading", "ready", "failed"]) {
  assert.equal(storePriceState(state, true), "ready");
}
assert.equal(describeProductLookup(["a", "b"], ["a"]), "requested=[a,b] returned=[a] missing=1");
assert.equal(describeProductLookup(["a"], []), "requested=[a] returned=[] missing=1");
class PluginError extends Error { constructor() { super("secret body"); this.name = "PluginError"; } }
assert.equal(errorKind(new PluginError()), "PluginError");
assert.ok(!errorKind(new PluginError()).includes("secret"));

const src = readFileSync(new URL("../components/PlanPicker.tsx", import.meta.url), "utf8");
assert.match(src, /playPrice === "unavailable" \? PURCHASE_UNAVAILABLE_SENTENCE/, "Play disclosure uses the unavailable sentence");
assert.match(src, /storePrice === "unavailable" \? PURCHASE_UNAVAILABLE_SENTENCE/, "Apple disclosure uses the unavailable sentence");
assert.equal((src.match(/"Price unavailable"/g) ?? []).length >= 3, true, "button labels no longer loop on Loading plans");
assert.ok((src.match(/reloadNonce\]\)/g) ?? []).length >= 2, "both store loaders re-run on reloadNonce");
assert.match(src, /setReloadNonce\(\(n\) => n \+ 1\)/, "Try again bumps the nonce");
assert.match(src, /Try again/);
assert.match(src, /reportStoreDiagnostic\("playProductsLoaded"/);
assert.match(src, /reportStoreDiagnostic\("iapProductsLoaded"/);
assert.match(src, /reportStoreDiagnostic\("playProductsFailed", errorKind\(e\)/);
console.log("g294-store-unavailable: ok");
