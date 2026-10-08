#!/usr/bin/env node
// H113: flags /design preview directories whose every referencing board item is
// done or cancelled and whose last commit is older than 7 days. Such a preview
// belongs to a decided round and should have been collapsed to its single gate
// preview (or deleted) by the fold-in session. See CLAUDE.md "Design work".
//
// Warning mode (default): prints the stale list and exits 0, so it can run in
// `scripts/session.sh finish` before the prune lands.
// Strict mode: `npm run check:design-stale -- --strict` (or `node
// scripts/check-design-stale.mjs --strict`) exits 1 when anything is stale.
// Turn strict on, for example by passing --strict in the finish gate, once the
// H113 prune has landed and the list is empty.
//
// A preview with NO referencing item is not flagged here (it may simply be
// unreferenced); the inventory script lists those as UNSURE or DELETE-CANDIDATE.
// Housekeeping items (H113, H43, G126) are ignored when deciding, as in the
// inventory. Item matching rules are in scripts/_design-preview-data.mjs.
//
// Usage: node scripts/check-design-stale.mjs [--strict]   (from frontend/)

import { gather, DONE_STATES, HOUSEKEEPING_IDS, STALE_DAYS } from "./_design-preview-data.mjs";

const strict = process.argv.includes("--strict");
const rows = gather({ full: false });

const stale = rows.filter((r) => {
  const items = r.items.filter((i) => !HOUSEKEEPING_IDS.has(i.id) || DONE_STATES.has(i.state));
  if (items.length === 0) return false;
  if (!items.every((i) => DONE_STATES.has(i.state))) return false;
  return r.ageD > STALE_DAYS;
});

if (stale.length === 0) {
  console.log(`check:design-stale OK: no preview is stale (all items done or cancelled and older than ${STALE_DAYS} days) across ${rows.length} previews.`);
  process.exit(0);
}

const label = strict ? "FAIL" : "WARNING";
console.log(`check:design-stale ${label}: ${stale.length} stale preview director${stale.length === 1 ? "y" : "ies"} (every referencing item done or cancelled, last commit older than ${STALE_DAYS} days):`);
for (const r of stale) {
  console.log(`  ${r.slug}  last commit ${r.date}  items ${r.items.map((i) => `${i.id} (${i.state})`).join(", ")}`);
}
console.log("Collapse each decided round to its single gate preview (rendering the production component) or delete it. See CLAUDE.md \"Design work\".");
if (strict) process.exit(1);
console.log("(warning only; pass --strict to fail)");
