import assert from "node:assert/strict";
import { filedTransferAccountLabel, filedTransferRoute, filingDateRange, filedSeriesHistoryHref, recentFiledTransfers, isSafeFiledTransfersHref, shortFilingDate, movementMoney, maskFilingCopy } from "../lib/filedTransfers.ts";
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

// A filed receipt opens only its own series across all dates, never a broad
// list or an inherited period/category scope.
const series = "sorted:payments & savings";
const exactHref = `/transactions?filed_series=${encodeURIComponent(series)}`;
assert.equal(filedSeriesHistoryHref({ series_key: series, transactions_href: exactHref }), exactHref);
for (const href of ["/transactions", "/transactions?filed_series=other", `${exactHref}&from=2026-11-01`, `${exactHref}&filed_series=other`, "//example.test/transactions"]) {
  assert.equal(filedSeriesHistoryHref({ series_key: series, transactions_href: href }), null, href);
}
const completeHistory = Array.from({ length: 170 }, (_, index) => ({ date: new Date(Date.UTC(2026, 4, 24 + index)).toISOString(), amount: 10, currency: "GBP", debit: null, credit: null }));
assert.equal(recentFiledTransfers(completeHistory).length, 10);
assert.equal(recentFiledTransfers(completeHistory)[0].date, completeHistory[169].date);
assert.equal(recentFiledTransfers(completeHistory).at(-1).date, completeHistory[160].date);
assert.equal(completeHistory[0].date, "2026-05-24T00:00:00.000Z");
assert.equal(completeHistory.length, 170);
assert.deepEqual(recentFiledTransfers([]), []);

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
assert.equal(filedTransferRoute({ from_account: { id: "current", name: "MONZO CURRENT", bank: "MONZO" }, to_account: { id: "pot", name: "Saving Challenge pot", bank: "MONZO" }, description: "Transfer" }), "Monzo Current to Saving Challenge pot");
assert.equal(filedTransferRoute({ from_account: null, to_account: null, description: "Savings" }), "Savings");
assert.equal(filedTransferAccountLabel({ bank: "MONZO", name: "SAVING CHALLENGE POT" }), "Monzo · Saving Challenge Pot");
assert.equal(filingDateRange(`${currentYear}-01-01`, `${currentYear}-11-09`), "1 Jan to 9 Nov");
assert.equal(filingDateRange(`${currentYear}-11-09`, `${currentYear}-11-09`), "9 Nov");
assert.equal(filingDateRange(null, null), null);
for (const [actor, glyph] of [["sorted", "robot"], ["user", "finn-the-human"]]) {
  const icon = renderToStaticMarkup(React.createElement(FilingSourceIcon, { actor }));
  assert.match(icon, new RegExp(`data-phosphor-icon="${glyph}"`));
  assert.match(icon, /data-phosphor-weight="regular"/);
  assert.match(icon, /aria-hidden="true"/);
}

console.log("G449 filed-transfer helpers passed");
