#!/usr/bin/env node
// H113: flags /design preview directories whose every referencing board item is
// done or cancelled and whose last commit is older than 7 days. Such a preview
// belongs to a decided round and should have been deleted whole by the fold-in
// session (Kevin, 2026-10-09). See CLAUDE.md "Design work".
//
// Exempt: a preview that code outside app/design imports (production code, a
// remotion composition or a frontend/scripts check gate), that another preview
// imports, or that a compliance pack or marketing asset references. Deleting
// those would break a build or a gate; fix the importer first, then delete.
//
// Strict (H113 prune landed): `npm run check:design-stale` runs with --strict
// and exits 1 when anything is stale. Without --strict it only warns.
//
// A preview with NO referencing item is not flagged here (it may simply be
// unreferenced); the inventory script lists those as UNSURE or DELETE-CANDIDATE.
// Housekeeping items (H113, H43, G126) are ignored when deciding, as in the
// inventory. Item matching rules are in scripts/_design-preview-data.mjs.
//
// Usage: node scripts/check-design-stale.mjs [--strict]   (from frontend/)

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gather, designDir, DONE_STATES, HOUSEKEEPING_IDS, STALE_DAYS } from "./_design-preview-data.mjs";

const strict = process.argv.includes("--strict");
const rows = gather({ full: true });

// Previews imported by a sibling preview (relative ../slug or @/app/design/slug).
const importedBySibling = new Set();
for (const r of rows) {
  const dir = path.join(designDir, r.slug);
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const src = readFileSync(full, "utf8");
        for (const m of src.matchAll(/from\s+["'](?:\.\.\/|@\/app\/design\/)([a-z0-9_-]+)/g)) if (m[1] !== r.slug) importedBySibling.add(m[1]);
      }
    }
  };
  walk(dir);
}

const stale = rows.filter((r) => {
  const items = r.items.filter((i) => !HOUSEKEEPING_IDS.has(i.id) || DONE_STATES.has(i.state));
  if (items.length === 0) return false;
  if (r.importers.length || importedBySibling.has(r.slug) || r.compliance.length || r.media.length) return false;
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
console.log("Delete each directory and its page.tsx index entry. See CLAUDE.md \"Design work\".");
if (strict) process.exit(1);
console.log("(warning only; pass --strict to fail)");
