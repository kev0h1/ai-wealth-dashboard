// G381 (Kevin 2026-10-31): the teaching sheet's "Where did this money go?" step offers
// "Paying off one of my cards". It files the row as Debt through the scoped correction
// flow (mine-card), reuses the existing option row pattern, creates no card picker and keeps
// the copy rules (British English, no em dashes, no exclamation marks).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sheet = readFileSync(new URL("../components/TeachingSheet.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../lib/api.ts", import.meta.url), "utf8");

const root = sheet.slice(sheet.indexOf('step === "movement-root" && !isCredit'), sheet.indexOf('step === "movement-kind"'));
assert.ok(root.length > 200, "movement-root debit step found");
assert.match(root, /Paying off one of my cards/, "the option is on the debit movement step");
assert.match(root, /openReview\(\{ choice: \{ resolution: "mine-card" \}, category: "Debt"/, "it opens scope review as mine-card with no extra payload");
assert.equal((root.match(/Paying off one of my cards/g) || []).length, 1);
// The existing row pattern: same button classes as the sibling options, an icon tile, a 56px target.
const option = root.slice(root.lastIndexOf("<button", root.indexOf("Paying off one of my cards")), root.indexOf("</button>", root.indexOf("Paying off one of my cards")));
assert.match(option, /min-h-\[56px\] rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-700\/60/);
assert.match(option, /disabled=\{busy\}/);
assert.match(sheet, /const DebtCategoryIcon = getCategoryIcon\("Debt", iconOverrides\)/, "card payments share the saved Debt category identity");
assert.match(option, /<DebtCategoryIcon size=\{18\} aria-hidden="true" \/>/);
// No card picker was invented: the option goes straight to the common scope review.
assert.match(option, /openReview\(/);
assert.doesNotMatch(sheet, /movement-card/);
// A credit never gets it: the credit branch is a different ask.
const creditRoot = sheet.slice(sheet.indexOf('step === "movement-root" && isCredit'), sheet.indexOf('step === "movement-root" && !isCredit'));
assert.doesNotMatch(creditRoot, /Paying off one of my cards/);
// Types and fallback category.
assert.match(api, /"mine-card"/);
assert.match(sheet, /category: "Debt"/);
const destinationResolutions = ["spending", "mine-here", "mine-card", "mine-savings", "mine-investment", "mine-goal", "mine-offline"];
for (const resolution of destinationResolutions) {
  assert.match(api, new RegExp(`"${resolution}"`), `scoped correction retains the ${resolution} destination`);
}
// Copy rules on the strings this item added.
for (const copy of ["Paying off one of my cards"]) {
  assert.doesNotMatch(copy, /[—–!]/);
}
console.log("g381 card payment option ok");
