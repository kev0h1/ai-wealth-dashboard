#!/usr/bin/env node
// H113 phase 1: inventory of every /design preview directory with a proposed
// action. Read-only; deletes nothing. Slower than a check (one git log per
// directory plus a board CLI call) and date-dependent, so it is a plain
// script, not a check:*.
//
// Usage (from frontend/):
//   node scripts/design-preview-inventory.mjs            # markdown to stdout
//   node scripts/design-preview-inventory.mjs --json     # JSON
//   node scripts/design-preview-inventory.mjs --write    # write docs/design/H113-preview-inventory.md

import { writeFileSync } from "node:fs";
import path from "node:path";
import { gather, repoRoot, STALE_DAYS } from "./_design-preview-data.mjs";

const args = new Set(process.argv.slice(2));
const rows = gather();
const ORDER = ["KEEP", "GATE-CANDIDATE", "DELETE-CANDIDATE", "UNSURE"];
rows.sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action) || a.slug.localeCompare(b.slug));

if (args.has("--json")) {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

const counts = Object.fromEntries(ORDER.map((a) => [a, rows.filter((r) => r.action === a).length]));
const cell = (s) => String(s).replace(/\|/g, "\\|");
const today = new Date().toISOString().slice(0, 10);

const lines = [];
lines.push("# H113 design preview inventory (phase 1, nothing deleted)");
lines.push("");
lines.push(`Generated ${today} by \`frontend/scripts/design-preview-inventory.mjs\`. ${rows.length} preview directories under \`frontend/app/design/\` (excluding \`_components\`).`);
lines.push("");
lines.push("## Counts per proposed action");
lines.push("");
for (const a of ORDER) lines.push(`- ${a}: ${counts[a]}`);
lines.push("");
lines.push("## Rules");
lines.push("");
lines.push("- KEEP: a referencing item is todo, in-progress, review, uat, rejected or blocked (including marketing items G222 to G224, C22); or referenced by `docs/compliance`, marketing assets or `docs/design/c22-marketing-kit.md`; or really imported (not just mentioned in a comment) from outside `app/design`.");
lines.push("- Housekeeping items H113, H43 and G126 only list previews while sweeping them, so they appear in the Items column but do not on their own keep a preview.");
lines.push("- GATE-CANDIDATE: renders production components and every referencing item is done or cancelled (at least one). One per shipped surface is what Kevin may keep.");
lines.push(`- DELETE-CANDIDATE: no open item, last commit older than ${STALE_DAYS} days, hand-authored markup only.`);
lines.push("- UNSURE: anything else.");
lines.push("- \"Renders production\" means a file in the directory imports from `@/components`, `@/app/components` or a relative `components` path. It does not prove the page is a faithful gate for the shipped surface.");
lines.push("- Item matching: `design/<slug>` in an item's TODO.md block, or the bare slug when it contains a hyphen. One-word slugs match path form only, so expect some false negatives where prose names a preview loosely.");
lines.push("");
lines.push("## Table");
lines.push("");
lines.push("| Action | Slug | Items (state) | Last commit | Renders | Outside imports (mentions) | Compliance / media | Reason |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  lines.push(
    "| " +
      [
        r.action,
        "`" + r.slug + "`",
        r.items.length ? r.items.map((i) => `${i.id} (${i.state})`).join(", ") : "none",
        r.date || "n/a",
        r.rendersProd ? "production" : "hand-authored",
        [r.importers.length ? r.importers.join(", ") : "none", r.mentions.length ? `(mentions: ${r.mentions.join(", ")})` : ""].filter(Boolean).join(" "),
        [...r.compliance, ...r.media].join(", ") || "none",
        r.reason,
      ]
        .map(cell)
        .join(" | ") +
      " |",
  );
}
lines.push("");
const md = lines.join("\n");

if (args.has("--write")) {
  const out = path.join(repoRoot, "docs", "design", "H113-preview-inventory.md");
  writeFileSync(out, md);
  console.log(`wrote ${path.relative(repoRoot, out)} (${rows.length} rows)`);
  console.log(JSON.stringify(counts));
} else {
  console.log(md);
}
