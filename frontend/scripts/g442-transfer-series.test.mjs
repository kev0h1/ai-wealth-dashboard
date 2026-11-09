// G442 (Kevin 2026-11-08): the transfers review groups unclear pairs by recurring series,
// shows the model's reason, lists what Sorted filed by itself under "Filed automatically: N"
// and lets each series be undone. It reuses the sheet's own row, button and surface classes:
// no new component, no new colour. (SheetFrame renders nothing on the server, so this reads
// the production component source and exercises the pure helpers.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { seriesPairs, seriesSinceLabel, withoutAnswered } from "../lib/transferReview.ts";

const pair = (key, creditId, debitId, extra = {}) => ({
  pair_key: key, date_diff_days: 2,
  credit: { id: creditId, account_id: "natw", date: "2026-11-02", amount: 65, currency: "GBP", description: "c", merchant_name: null, category: "Income" },
  debit: { id: debitId, account_id: "barc", date: "2026-10-31", amount: 65, currency: "GBP", description: "d", merchant_name: null, category: "Other" },
  ...extra,
});

// grouping: one suggestion covers every pair of its series, newest first as the server sends them
const series = pair("c3:d3", "c3", "d3", {
  series: { key: "abc", count: 3, first_date: "2026-09-02T00:00:00", pairs: [
    { pair_key: "c3:d3", credit_id: "c3", debit_id: "d3" },
    { pair_key: "c2:d2", credit_id: "c2", debit_id: "d2" },
    { pair_key: "c1:d1", credit_id: "c1", debit_id: "d1" }] },
  ai_reason: "The credit names Chase, but the money left NatWest.",
});
assert.deepEqual(seriesPairs(series).map(p => p.pair_key), ["c3:d3", "c2:d2", "c1:d1"], "one answer covers the whole series");
assert.deepEqual(seriesPairs(pair("a:b", "a", "b")), [{ pair_key: "a:b", credit_id: "a", debit_id: "b" }], "an older payload covers only itself");
assert.equal(seriesSinceLabel(3, "2026-09-02T00:00:00"), "3 times since Sep");
assert.equal(seriesSinceLabel(12, "2026-01-31"), "12 times since Jan");
assert.equal(seriesSinceLabel(1, "2026-09-02"), null, "a single payment is not a series");
assert.equal(seriesSinceLabel(2, null), "2 times");
assert.deepEqual(withoutAnswered([series, pair("x:y", "x", "y")], new Set(["c3:d3"])).map(p => p.pair_key), ["x:y"]);

const sheet = readFileSync(new URL("../components/MiscategorisedReviewSheet.tsx", import.meta.url), "utf8");
// the series is answered in one tap, each pair through the existing answer endpoints
assert.match(sheet, /const covered = seriesPairs\(pair\);/);
assert.match(sheet, /api\.confirmTransferPair\(item\.credit_id, item\.debit_id, true\)/, "same answer path, deferred recompute (G387)");
assert.match(sheet, /api\.dismissTransferPair\(item\.pair_key\)/);
assert.match(sheet, /\$\{nameOf\(pair\.debit\.account_id\)\} to \$\{nameOf\(pair\.credit\.account_id\)\}/, "Barclays to NatWest");
assert.match(sheet, /\$\{amountText\}, \$\{since\}\./, "amount, 3 times since Sep");
assert.match(sheet, /\{pair\.ai_reason && <p [^>]*text-xs leading-5 text-slate-600[^>]*data-ai-reason>\{pair\.ai_reason\}<\/p>\}/, "the model's reason is a short secondary line in the existing style");
assert.ok(!/invalidateAfterTransactionCorrection\(/.test(sheet.match(/function handleConfirmPair[\s\S]*?\n  }\n/)[0]), "no cache wipe per answer; one recompute when the sheet closes");

// G449 retains the history door when the review queue becomes empty and
// moves the receipt/Undo interaction into the shared history sheet.
assert.match(sheet, /data-filed-transfers-link/);
assert.match(sheet, /api\.getFiledTransfers\(\{ source: "sorted", page_size: 1 \}\)/);
assert.match(sheet, /FiledTransfersSheet nested initialSource="sorted"/);
assert.equal((sheet.match(/function renderPair\(/g) ?? []).length, 1);
assert.equal((sheet.match(/function renderItem\(/g) ?? []).length, 1);
console.log("g442-transfer-series: ok");
