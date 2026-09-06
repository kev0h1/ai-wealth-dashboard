#!/usr/bin/env node
// Guards app/design/page.tsx against drift: every app/design/*/page.tsx
// directory must have a matching `slug: "..."` entry in ROUTES, and every
// slug listed there must have a matching directory. Plain Node, no deps,
// so it can run in CI/session finish without an install step.
//
// Usage: node scripts/check-design-index.mjs   (from frontend/)

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const designDir = path.join(frontendRoot, "app", "design");
const indexFile = path.join(designDir, "page.tsx");

function listPreviewDirs() {
  return readdirSync(designDir)
    .filter((entry) => {
      const full = path.join(designDir, entry);
      if (!statSync(full).isDirectory()) return false;
      return statSync(path.join(full, "page.tsx"), { throwIfNoEntry: false }) != null;
    })
    .sort();
}

function listIndexedSlugs() {
  const source = readFileSync(indexFile, "utf8");
  const slugRe = /slug:\s*"([^"]+)"/g;
  const slugs = [];
  let match;
  while ((match = slugRe.exec(source)) !== null) {
    slugs.push(match[1]);
  }
  return slugs.sort();
}

const dirs = listPreviewDirs();
const slugs = listIndexedSlugs();
const dirSet = new Set(dirs);
const slugSet = new Set(slugs);

const missingFromIndex = dirs.filter((d) => !slugSet.has(d));
const missingDirectory = slugs.filter((s) => !dirSet.has(s));

if (missingFromIndex.length === 0 && missingDirectory.length === 0) {
  console.log(`check:design-index OK (${dirs.length} preview directories, ${slugs.length} indexed slugs)`);
  process.exit(0);
}

if (missingFromIndex.length > 0) {
  console.error("Directories under app/design/*/page.tsx with no entry in app/design/page.tsx:");
  for (const d of missingFromIndex) console.error(`  - ${d}`);
}

if (missingDirectory.length > 0) {
  console.error("Slugs listed in app/design/page.tsx with no matching directory:");
  for (const s of missingDirectory) console.error(`  - ${s}`);
}

console.error("\nAdd or remove an entry in app/design/page.tsx (ROUTES) to fix this.");
process.exit(1);
