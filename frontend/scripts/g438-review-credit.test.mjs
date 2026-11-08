// G438 (Kevin 2026-11-07): a lone credit that names the user is a question in the SAME
// transfers review sheet: one row component for both directions, copy adjusted for direction.
// (SheetFrame renders nothing on the server, so this reads the production component source
// and exercises the shared item helper with a credit candidate.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { remainingReviewItem } from "../lib/transferReview.ts";

const sheet = readFileSync(new URL("../components/MiscategorisedReviewSheet.tsx", import.meta.url), "utf8");
assert.equal((sheet.match(/function renderItem\(/g) ?? []).length, 1, "one row component renders debits and credits");
assert.match(sheet, /const credit = item\.transaction_type === "credit";/);
assert.match(sheet, /credit \? "Review this money in" : "Review this payment"/);
assert.match(sheet, /credit \? "Is this money in from one of your accounts\?" : "What was this payment\?"/);
assert.match(sheet, /Another of my accounts/);
assert.match(sheet, /Keep as income/);
assert.match(sheet, /api\.patchTransaction\(tx\.id, \{ category, defer_recompute: true \}\)/, "a credit answer is saved as the user's own category, remembered both ways");
assert.ok(!/—|!\s*<|exclamation/.test(sheet.match(/Review this money in[^\n]*/)[0]), "copy rules");

const credit = { id: "c1", ids: ["c1"], count: 1, series_key: "From Jordan Blake|credit", amount: 40, transaction_type: "credit", reason: { kind: "name" } };
assert.equal(remainingReviewItem(credit, new Set(["c1"])), null, "an answered credit leaves the sheet");
assert.deepEqual(remainingReviewItem(credit, new Set())?.ids, ["c1"]);
console.log("g438-review-credit: ok");
