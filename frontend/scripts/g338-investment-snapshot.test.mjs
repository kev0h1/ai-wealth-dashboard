// G338: investment accounts are a value snapshot. No growth, gain, anchor or
// return surface remains; the caveat and "Capital at risk." sit with the value.
//
// Run: npm run -s check:g338-investment-snapshot

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatPriceDay } from "../lib/priceDay.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

// The growth tree is gone.
for (const rel of [
  "lib/investmentGrowth.ts",
  "components/InvestmentGrowthSection.tsx",
  "components/PortfolioGrowthCard.tsx",
  "components/PortfolioGrowthDetail.tsx",
  "components/portfolio-growth",
]) {
  assert.equal(fs.existsSync(path.join(root, rel)), false, `${rel} should be deleted`);
}

// Investment surfaces carry no growth wording. AccountsPage is scoped to its
// investment block, since the file also covers unrelated accounts.
const accounts = read("app/components/AccountsPage.tsx");
const start = accounts.indexOf("investmentAccounts.map(inv =>");
assert.ok(start > 0, "investment block not found");
const block = accounts.slice(start);
const files = {
  "AccountsPage investment block": block,
  "lib/priceDay.ts": read("lib/priceDay.ts"),
  "lib/api.ts": read("lib/api.ts"),
};
const banned = [
  "Growth since", "Edit anchor", "likely price timing", "Simple gain", "time-weighted",
  "Gain ", "'s value", "InvestmentGrowth", "getInvestmentGrowth", "setInvestmentAnchor",
  "clearInvestmentAnchor", "gain_abs", "gain_pct", "has_anchor",
];
for (const [name, text] of Object.entries(files)) {
  for (const b of banned) assert.ok(!text.includes(b), `${name} still contains "${b}"`);
}
// "paid in" survives only as contract-note provenance in the account header.
const paidInHits = block.split("\n").filter((l) => /percent|%.*paid in|of paid in/i.test(l));
assert.equal(paidInHits.length, 0, "no percent-of-paid-in figure");

// The caveat and the risk line sit with the value.
assert.ok(accounts.includes("Estimated from your holdings and recent prices. For the exact value, check"));
assert.ok(accounts.includes("Capital at risk."));
assert.ok(accounts.includes("Prices as of"));

// Price day label (moved from the G333 gate).
assert.equal(formatPriceDay("2026-10-16", "2026-10-15"), "15 to 16 Oct");
assert.equal(formatPriceDay("2026-10-16", "2026-10-16"), "16 Oct");
assert.equal(formatPriceDay("2026-10-02", "2026-09-30"), "30 Sep to 2 Oct");
assert.equal(formatPriceDay(null), null);

console.log("g338-investment-snapshot: ok");
