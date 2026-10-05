import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import { AccountsSyncBanner, syncLine, syncPhase } from "../components/SyncNote.tsx";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// Default props render today's row: no sync furniture at all.
const row = { id: "a", name: "Premier Current", provider: "Barclays", kind: "Current", balance: 44, status: "connected", pinned: false, dormant: false, attention: false, source: "bank", raw: { id: "a", name: "Premier Current", type: "transaction", balance: 44, currency: "GBP", provider: "Barclays", provider_id: "barclays", status: "connected" } };
const plain = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row }));
assert.match(plain, /text-\[16px\] font-semibold money text-slate-900 dark:text-slate-100/, "default balance classes unchanged");
assert.match(plain, /w-full min-h-\[60px\] flex items-center gap-3 px-4 py-2\.5/, "default row classes unchanged");
assert.doesNotMatch(plain, /data-sync-phase|As of|animate-spin|Pending/, "no sync UI by default");

// A syncing row stays ink and never red, even for a negative balance.
const info = { kind: "refresh", bank: "Barclays", startedAt: Date.now() - 1000, asOf: "2026-10-05T09:41:00" };
for (const treatment of ["line", "stale", "drawer"]) {
  for (const over of [{}, { stalled: true }, { failed: true }]) {
    const html = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row: { ...row, balance: -50 }, sync: { info: { ...info, ...over }, treatment } }));
    assert.doesNotMatch(html, /\b(red|rose)-\d/, "no red while syncing");
    assert.match(html, /data-sync-phase|As of/);
    const page = renderToStaticMarkup(React.createElement(AccountsSyncBanner, { treatment, connections: [{ ...info, ...over }], onRetry: () => {} }));
    assert.doesNotMatch(page, /\b(red|rose)-\d|—|role="alert"/);
    if (over.stalled || over.failed) assert.match(page, /Try again/, "problem states offer a retry");
    else assert.doesNotMatch(page, /Try again/);
  }
}

// Phases and copy.
assert.equal(syncPhase({ kind: "refresh" }), "syncing");
assert.equal(syncPhase({ kind: "refresh", startedAt: Date.now() - 11 * 60 * 1000 }), "stalled");
assert.equal(syncPhase({ kind: "refresh", failed: true, stalled: true }), "failed");
assert.match(syncLine({ kind: "new-bank", bank: "ob-monzo" }), /Fetching from Monzo\. Not in your figure yet\./);
assert.match(syncLine({ kind: "refresh", bank: "Barclays", failed: true }), /Could not update Barclays\. Showing saved figures\./);

// Source guards: the hero keeps its default figure/chip path and the new
// props are optional and gated on a treatment being chosen.
const sts = src("../components/SafeToSpendCard.tsx");
assert.match(sts, /syncing\?: SyncingInfo;/);
assert.match(sts, /syncTreatment\?: SyncTreatment;/);
assert.match(sts, /const sync = syncing && syncTreatment \?/);
assert.match(sts, /: figureClass;/, "default figure colour path retained");
assert.match(sts, /\$\{stateChipClass\}/, "default chip classes retained");
assert.match(sts, /figureAccent && !sync/, "G218 accent bar is suppressed while syncing");
assert.match(sts, /const freshnessLabel = sync \? null/, "no second timestamp while syncing");
assert.match(sts, /const recovery = sync \? null/, "no recovery CTA while syncing");
assert.match(sts, /risk=\{exactCashRunway < 0 && !sync\}/, "ledger figures stay ink while syncing");
assert.match(sts, /last known cash figure until/, "verdict wording replaced while syncing");
const note = src("../components/SyncNote.tsx");
assert.match(note, /from "@\/components\/ProgressLedger"/, "ring comes from the shared ledger primitives");
assert.doesNotMatch(note, /—|from-indigo|to-violet|bg-red|text-red|rose-/, "no em dash, gradient or red");
assert.match(src("../app/design/page.tsx"), /slug: "sync-loading"/);
console.log("g214-sync-loading: ok");
