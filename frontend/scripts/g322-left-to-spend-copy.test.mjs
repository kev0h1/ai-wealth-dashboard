// G322 (G321 option B): the app no longer calls the figure "Safe to Spend".
// Scans the production app surfaces for the user-facing phrase (spaced or
// capitalised-hyphen forms, comments stripped) and for the three
// misleading-as-written strings the G321 review found. Identifiers
// (safe-to-spend element ids, /safe-to-spend API path, get_safe_to_spend,
// safe_to_spend keys, SafeToSpend component names) are deliberately allowed,
// as are design previews and the marketing, store listing and video kit files
// (G323, owned by Codex).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("..", import.meta.url));
const repo = join(frontend, "..");

const SCAN_DIRS = ["components", "lib", "app", "content"];
const SKIP_DIRS = new Set(["node_modules", ".next", "design"]);
const EXTS = /\.(tsx?|mjs|md|json)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

function stripComments(src, file) {
  if (/\.(md|json)$/.test(file)) return src;
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const PHRASES = [/safe to spend/i, /Safe-to-Spend/, /safe-to-spend figure/i];
const MISLEADING = [/genuinely yours to spend/i, /just cruise/i, /enjoy it\b/i, /not a forecast/i];

const files = [
  ...SCAN_DIRS.flatMap((d) => walk(join(frontend, d))),
  join(repo, "TERMS.md"),
];
const backendDirs = ["app/services", "app/routers", "app/workers", "app/core"].map((d) => join(repo, "backend", d));
const backendFiles = backendDirs.flatMap((d) => readdirSync(d).filter((n) => n.endsWith(".py")).map((n) => join(d, n)));

function stripPy(src) {
  return src
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "")
    .replace(/^\s*#.*$/gm, "")
    .replace(/\s#\s.*$/gm, "");
}

const hits = [];
for (const file of files) {
  const text = stripComments(readFileSync(file, "utf8"), file);
  for (const re of [...PHRASES, ...MISLEADING]) {
    const m = text.match(re);
    if (m) hits.push(`${relative(repo, file)}: ${m[0]}`);
  }
}
for (const file of backendFiles) {
  const text = stripPy(readFileSync(file, "utf8"));
  for (const re of [/safe to spend/i, /Safe-to-Spend/, /safe-to-spend (figure|state|verdict)/i, ...MISLEADING]) {
    const m = text.match(re);
    if (m) hits.push(`${relative(repo, file)}: ${m[0]}`);
  }
}
assert.deepEqual(hits, [], `user-facing "Safe to Spend" or misleading copy remains:\n${hits.join("\n")}`);

// The new copy is present where the review put it.
const card = readFileSync(join(frontend, "components/SafeToSpendCard.tsx"), "utf8");
assert.match(card, /Estimated left to spend/);
assert.match(card, /Counts your connected current accounts and the bills Sorted has learned\. Not other accounts, pending payments or bills it has not seen yet\./);
assert.match(card, /data-sts-counts/);
console.log("g322-left-to-spend-copy: ok");
