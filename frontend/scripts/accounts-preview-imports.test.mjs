#!/usr/bin/env node
// G117: the accounts-canvas-before-cards design preview used to define its
// own local AccountGroupCard and PinnedBand components, hand-retyped copies
// of AccountsPage.tsx's real pinned-band and account-group-section markup,
// rather than importing the real pieces (components/AccountPinnedBand.tsx,
// components/AccountGroupSection.tsx). The class strings matched what
// shipped on the day someone retyped them, but nothing stopped the two
// diverging the next time either file changed alone — the same H42 gap
// that let G48 ship without the Lead row every design variant showed,
// because that preview's own components never imported HomeBrief.tsx.
//
// This is a plain-Node static-source guard (same framework-free pattern as
// scripts/home-cache-shape.test.mjs / scripts/check-design-index.mjs, no
// deps, runs in session finish without an install step): it scans the
// preview's own source for a top-level function/const declaration whose
// name collides with a production component it is expected to import
// instead of redefine. It does NOT try to diff markup — that is what
// actually importing the real component buys you; this only catches the
// preview regressing back to a local fork under the same name.
//
// Run with:
//   node scripts/accounts-preview-imports.test.mjs
// or:
//   npm run -s check:accounts-preview-imports

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const previewFile = path.join(
  frontendRoot,
  "app",
  "design",
  "accounts-canvas-before-cards",
  "AccountsCanvasBeforeCardsClient.tsx",
);

// Production components the preview must import, not redefine. Keyed by
// the name a local redefinition would carry, valued by the module it
// should be imported from instead.
const MUST_IMPORT_NOT_DEFINE = {
  AccountGroupCard: "@/components/AccountGroupSection (as AccountGroupSection)",
  PinnedBand: "@/components/AccountPinnedBand (as AccountPinnedBand)",
};

const source = readFileSync(previewFile, "utf8");

let failures = 0;

// A local redefinition would show up as a top-level `function Name(` or
// `const Name = (` / `const Name = function` declaration.
for (const [bannedName, importFrom] of Object.entries(MUST_IMPORT_NOT_DEFINE)) {
  const functionDeclRe = new RegExp(`^function ${bannedName}\\s*\\(`, "m");
  const constDeclRe = new RegExp(`^const ${bannedName}\\s*=`, "m");
  if (functionDeclRe.test(source) || constDeclRe.test(source)) {
    failures += 1;
    console.error(
      `FAIL: the preview redefines '${bannedName}' locally instead of importing it from ${importFrom}. ` +
        `This is the exact G117 drift shape: a hand-retyped copy of production markup that nothing stops from diverging.`,
    );
  } else {
    console.log(`PASS: '${bannedName}' is not locally redefined (expected to be imported from ${importFrom})`);
  }
}

// The two production components must actually be imported, not just
// absent as local names (e.g. from a silent rename that dropped the
// feature entirely rather than importing the real thing).
const requiredImports = [
  { name: "AccountGroupSection", from: "@/components/AccountGroupSection" },
  { name: "AccountPinnedBand", from: "@/components/AccountPinnedBand" },
];

for (const { name, from } of requiredImports) {
  const importRe = new RegExp(`import ${name} from "${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  if (importRe.test(source)) {
    console.log(`PASS: '${name}' is imported from '${from}'`);
  } else {
    failures += 1;
    console.error(`FAIL: expected an import of '${name}' from '${from}', found none.`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll accounts-preview-imports (G117) checks passed.");
