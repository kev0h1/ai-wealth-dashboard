import assert from "node:assert/strict";
import { providerHealthNotice } from "../lib/providerHealth.ts";

assert.equal(providerHealthNotice("Monzo", "degraded"), "Monzo is having problems right now. You can still try, or come back later.");
assert.equal(providerHealthNotice("Monzo", "DOWN"), "Monzo is having problems right now. You can still try, or come back later.");
assert.equal(providerHealthNotice("Monzo", "operational"), null);
assert.equal(providerHealthNotice("Monzo", undefined), null);
assert.equal(providerHealthNotice("", "down"), "This bank is having problems right now. You can still try, or come back later.");
console.log("a183 provider health: ok");
