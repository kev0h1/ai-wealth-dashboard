// G264 (approved 2026-10-12): Spend's jump strip is in flow like Planning's,
// never sticky on mobile; zero-value to-categorise stops are hidden by default.
// Run: npm run -s check:g264-jump-strip
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { unresolvedHeading, unresolvedWorthAsking } from "../lib/spendUnresolved.ts";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const page = read("app/components/SpendPage.tsx");
const nav = read("components/SpendJourneyNav.tsx");
const planning = read("app/planning/SectionJumpStrip.tsx");
const verdict = read("components/SpendVerdictView.tsx");
const header = read("components/SpendHeader.tsx");

// 1. The mobile strip wrapper: the lg:hidden wrapper around <SpendJourneyNav> has no sticky/fixed/z-index.
const m = page.match(/<div className="([^"]*)">\s*<SpendJourneyNav destinations=\{journeyDestinations\} \/>/);
assert.ok(m, "mobile strip wrapper found");
assert.match(m[1], /lg:hidden/);
assert.doesNotMatch(m[1], /sticky|fixed|top-0|z-\d+|backdrop|-mx-4|py-2/, "mobile strip wrapper is in flow with no spacer");
assert.doesNotMatch(nav, /sticky|fixed/);
// Desktop keeps the sticky summary rail.
assert.match(page, /aria-label="Pay period summary" className="min-w-0 lg:sticky lg:top-6"/);

// 2. Planning parity: neither strip is pinned, both are a plain grid of 11/12-high chips.
assert.doesNotMatch(planning, /sticky|fixed/);
assert.match(planning, /<div className="grid grid-cols-3 gap-2">/);
assert.match(nav, /className=\{`grid gap-2 /);
assert.match(nav, /min-h-12/, "44px+ targets");

// 3. The rail is gone.
assert.equal(existsSync(new URL("../components/SpendJourneyRail.tsx", import.meta.url)), false);
assert.equal(existsSync(new URL("../app/design/spend-rail", import.meta.url)), false);
assert.doesNotMatch(page + nav + verdict, /SpendJourneyRail|data-spend-timeline/);
assert.doesNotMatch(nav, /summary\?:/);

// 4. Zero-value rule on by default; chips and ledger row use the same rule.
assert.match(verdict, /hideTrivialUnresolved = true/);
assert.match(page, /unresolvedWorthAsking\(verdict\.unresolved\.total\) \?/);
assert.match(header, /unresolvedWorthAsking\(unresolvedTotal\) &&/);
assert.equal(unresolvedWorthAsking(0.4), false);
assert.equal(unresolvedWorthAsking(0.5), true);
assert.equal(unresolvedWorthAsking(125), true);
assert.equal(unresolvedHeading(1), "1 payment still needs a category");
assert.equal(unresolvedHeading(3), "3 payments still need a category");
assert.doesNotMatch(verdict, /still need a category<\/h2>|payment\{[^}]*\} still need a category/);

console.log("g264-jump-strip: ok");
