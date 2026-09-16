#!/usr/bin/env node
// Guards components/AccountMiniCard.tsx's BANK_META against drift: every
// entry that claims a `logoFile: "..."` must have that file present under
// public/banks/, and every file under public/banks/ must be claimed by at
// least one BANK_META entry (no dead assets). This is what would have
// caught G107 — BANK_META curated 28 providers with a logoFile set for
// several of them, but public/banks/ only ever held five of the files, so
// 22 entries silently fell back to the initials chip. Plain Node, no deps,
// same convention as scripts/check-design-index.mjs.
//
// Usage: node scripts/check-bank-logos.mjs   (from frontend/)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const sourceFile = path.join(frontendRoot, "components", "AccountMiniCard.tsx");
const banksDir = path.join(frontendRoot, "public", "banks");

function listClaimedLogoFiles() {
  const source = readFileSync(sourceFile, "utf8");
  // Scope the scan to the BANK_META object literal only, so a logoFile-shaped
  // string anywhere else in the file (there isn't one today, but this stays
  // correct if one appears) can't produce a false pass or fail here.
  const startMarker = "export const BANK_META: Record<string, BankMeta> = {";
  const start = source.indexOf(startMarker);
  if (start === -1) {
    console.error(`Could not find "${startMarker}" in ${path.relative(frontendRoot, sourceFile)}`);
    process.exit(1);
  }
  // Find the matching closing brace for the object literal by brace counting.
  let depth = 0;
  let end = -1;
  for (let i = start + startMarker.length - 1; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) {
    console.error("Could not find the closing brace of BANK_META — unbalanced braces?");
    process.exit(1);
  }
  const block = source.slice(start, end);

  const entryRe = /^\s*([A-Z_0-9]+):\s*\{([^}]*)\}/gm;
  const claims = []; // { key, file }
  let match;
  while ((match = entryRe.exec(block)) !== null) {
    const [, key, body] = match;
    const fileMatch = /logoFile:\s*"([^"]+)"/.exec(body);
    if (fileMatch) claims.push({ key, file: fileMatch[1] });
  }
  return claims;
}

// Only image files are candidate logo assets — public/banks/ also carries
// NOTICE.md (provenance/licence record for every logo here, see G107),
// which isn't a logoFile and shouldn't be flagged as orphaned.
const IMAGE_EXT_RE = /\.(png|jpg|jpeg|svg|webp)$/i;

function listBundledFiles() {
  if (!existsSync(banksDir)) return [];
  return readdirSync(banksDir).filter((f) => !f.startsWith(".") && IMAGE_EXT_RE.test(f));
}

const claims = listClaimedLogoFiles();
const bundled = new Set(listBundledFiles());
const claimedFiles = new Set(claims.map((c) => c.file));

const missing = claims.filter((c) => !bundled.has(c.file));
const orphaned = [...bundled].filter((f) => !claimedFiles.has(f));

if (missing.length === 0 && orphaned.length === 0) {
  console.log(`check:bank-logos OK (${claims.length} BANK_META entries with a logoFile, ${bundled.size} files in public/banks/)`);
  process.exit(0);
}

if (missing.length > 0) {
  console.error("BANK_META entries claim a logoFile that does not exist in public/banks/:");
  for (const { key, file } of missing) console.error(`  - ${key}: logoFile: "${file}"`);
}

if (orphaned.length > 0) {
  console.error("Files in public/banks/ that no BANK_META entry claims (dead weight — remove or wire up):");
  for (const f of orphaned) console.error(`  - ${f}`);
}

console.error("\nEither bundle the missing file under public/banks/, or remove the logoFile from that BANK_META entry so it falls back to the initials chip.");
process.exit(1);
