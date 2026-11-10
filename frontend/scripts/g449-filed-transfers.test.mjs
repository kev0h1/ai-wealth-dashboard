import assert from "node:assert/strict";
import { isSafeFiledTransfersHref, shortFilingDate, movementMoney, maskFilingCopy } from "../lib/filedTransfers.ts";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FilingSourceIcon from "../components/FilingSourceIcon.tsx";

// The sheet must only hand off to the local, bounded transaction history
// route. Keep hostile near-misses beside the positive route contract.
assert.equal(isSafeFiledTransfersHref("/transactions"), true);
assert.equal(isSafeFiledTransfersHref("/transactions?from=2026-10-01&to=2026-10-31"), true);
for (const href of [
  "/transactions-evil", "//example.test/transactions", "https://example.test/transactions",
  "/transactions#fragment", "/transactions\\outside", "/transactions\n", "/transactions@evil",
]) assert.equal(isSafeFiledTransfersHref(href), false, href);

// Dates must not drift with the device timezone, and older evidence needs a
// year so a receipt can be placed accurately.
const currentYear = new Date().getUTCFullYear();
assert.equal(shortFilingDate(`${currentYear}-01-02`), "2 Jan");
assert.equal(shortFilingDate("invalid"), null);
assert.match(shortFilingDate(`${currentYear - 1}-01-02`) ?? "", new RegExp(String(currentYear - 1)));

assert.equal(movementMoney(1234.56, "GBP", "debit"), "−£1,234.56");
assert.equal(movementMoney(15.25, "USD", "credit"), "+$15.25");
assert.equal(movementMoney(15.25, "USD", "credit", true), "+$••••");
assert.equal(movementMoney(15.25, "KES", "debit", true), "−KSh ••••");
assert.equal(movementMoney(15.25, "", undefined), "Currency unavailable");
assert.equal(movementMoney(NaN, "GBP"), "Amount unavailable");
assert.equal(maskFilingCopy("Moved £80, $20, €3 and KSh 140.25", true), "Moved £••••, $••••, €•••• and KSh ••••");
for (const [actor, glyph] of [["sorted", "robot"], ["user", "finn-the-human"]]) {
  const icon = renderToStaticMarkup(React.createElement(FilingSourceIcon, { actor }));
  assert.match(icon, new RegExp(`data-phosphor-icon="${glyph}"`));
  assert.match(icon, /data-phosphor-weight="regular"/);
  assert.match(icon, /aria-hidden="true"/);
}

console.log("G449 filed-transfer helpers passed");
