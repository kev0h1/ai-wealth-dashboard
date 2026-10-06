import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AccountLedgerRow from "../components/AccountLedgerRow.tsx";
import FirstSyncCard from "../components/FirstSyncCard.tsx";
import { AccountsSyncBanner, syncLine, syncPhase } from "../components/SyncNote.tsx";
import {
  connectionSyncInfos,
  deriveSyncKind,
  heroSyncingInfo,
  pendingConnectionInfos,
  pollDelayMs,
  shouldPollTick,
} from "../lib/syncStatusView.ts";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ── Rows: default props render today's row; syncing rows ship treatment B.
const row = { id: "a", name: "Premier Current", provider: "Barclays", kind: "Current", balance: 44, status: "connected", pinned: false, dormant: false, attention: false, source: "bank", raw: { id: "a", name: "Premier Current", type: "transaction", balance: 44, currency: "GBP", provider: "Barclays", provider_id: "barclays", status: "connected" } };
const plain = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row }));
assert.match(plain, /text-\[16px\] font-semibold money text-slate-900 dark:text-slate-100/, "default balance classes unchanged");
assert.match(plain, /w-full min-h-\[60px\] flex items-center gap-3 px-4 py-2\.5/, "default row classes unchanged");
assert.doesNotMatch(plain, /data-sync-phase|As of|animate-spin|Pending/, "no sync UI by default");

const info = { kind: "refresh", bank: "Barclays", asOf: "2026-10-05T09:41:00" };
for (const over of [{}, { stalled: true }, { failed: true }]) {
  const html = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row: { ...row, balance: -50 }, sync: { ...info, ...over } }));
  assert.doesNotMatch(html, /\b(red|rose)-\d/, "no red while syncing, even for a negative balance");
  assert.match(html, /text-slate-700 dark:text-slate-200/, "stale balance in secondary ink");
  assert.match(html, /As of 09:41 · (Updating|Delayed|Not updated)/);
  assert.match(html, /animate-spin|border-slate-300/, "ring while syncing, hollow once stopped");
  const page = renderToStaticMarkup(React.createElement(AccountsSyncBanner, { connections: [{ ...info, ...over }], onRetry: () => {} }));
  assert.doesNotMatch(page, /\b(red|rose)-\d|—|role="alert"/);
  if (over.stalled || over.failed) assert.match(page, /Try again/, "problem states offer a retry");
  else assert.doesNotMatch(page, /Try again/);
}
const pending = renderToStaticMarkup(React.createElement(AccountLedgerRow, { row, sync: { kind: "new-bank", bank: "Monzo" } }));
assert.match(pending, />Pending</, "a never-synced bank says Pending, never £0");
assert.doesNotMatch(pending, /£0|money /, "Pending is set in Figtree, not the money face");

// ── Phases and copy.
assert.equal(syncPhase({ kind: "refresh" }), "syncing");
assert.equal(syncPhase({ kind: "refresh", startedAt: Date.now() - 11 * 60 * 1000 }), "stalled");
assert.equal(syncPhase({ kind: "refresh", failed: true, stalled: true }), "failed");
assert.match(syncLine({ kind: "new-bank", bank: "ob-monzo" }), /Fetching from Monzo\. Not in your figure yet\./);
assert.match(syncLine({ kind: "refresh", bank: "Barclays", failed: true }), /Could not update Barclays\. Showing saved figures\./);

// ── Kind derivation (pure).
assert.equal(deriveSyncKind({ firstSync: false, hasUnsyncedConnection: true, userTriggered: false }), "new-bank");
assert.equal(deriveSyncKind({ firstSync: false, hasUnsyncedConnection: true, userTriggered: true }), "new-bank", "server evidence beats the tap");
assert.equal(deriveSyncKind({ firstSync: false, hasUnsyncedConnection: false, userTriggered: true }), "refresh");
assert.equal(deriveSyncKind({ firstSync: false, hasUnsyncedConnection: false, userTriggered: false }), "background");
assert.equal(deriveSyncKind({ firstSync: true, hasUnsyncedConnection: true, userTriggered: false }), "background", "a first sync is FirstSyncCard's, not a kind");

// ── Hero info from server state.
const st = (state, over = {}) => ({ state, first_sync: false, connections: [{ provider: "finexer", connection_id: "c2", bank: "ob-monzo", state }], ...over });
assert.equal(heroSyncingInfo({ status: st("idle", { connections: [] }), refreshing: false, refreshFailed: false }), null);
assert.equal(heroSyncingInfo({ status: st("syncing", { first_sync: true }), refreshing: false, refreshFailed: false }), null, "first sync keeps FirstSyncCard");
const newBank = heroSyncingInfo({ status: st("syncing"), refreshing: false, refreshFailed: false, asOf: "2026-10-05T09:41:00" });
assert.deepEqual([newBank.kind, newBank.bank, newBank.stalled, newBank.failed, newBank.asOf], ["new-bank", "ob-monzo", false, false, "2026-10-05T09:41:00"]);
assert.equal(newBank.startedAt, undefined, "stalled comes from the server, never the client clock");
assert.equal(heroSyncingInfo({ status: st("stalled"), refreshing: false, refreshFailed: false }).stalled, true);
assert.equal(heroSyncingInfo({ status: st("failed"), refreshing: false, refreshFailed: false }).failed, true);
assert.equal(heroSyncingInfo({ status: null, refreshing: true, refreshFailed: false }).kind, "refresh");
assert.equal(heroSyncingInfo({ status: null, refreshing: false, refreshFailed: true }).failed, true);
assert.equal(heroSyncingInfo({ status: null, refreshing: false, refreshFailed: false }), null);
const infos = connectionSyncInfos(st("stalled"));
assert.equal(infos.get("c2").stalled, true);
assert.equal(connectionSyncInfos(st("idle", { connections: [] })).size, 0);
assert.deepEqual(pendingConnectionInfos(infos, [{ connection_id: "c2" }]), [], "a connection that owns an account is not pending");
assert.equal(pendingConnectionInfos(infos, [{ connection_id: "c1" }]).length, 1);

// ── Poll schedule (pure).
assert.equal(pollDelayMs("syncing"), 3000);
assert.equal(pollDelayMs("stalled"), 15000);
assert.equal(pollDelayMs("idle"), null);
assert.equal(pollDelayMs("failed"), null, "nothing runs once failed; Try again restarts it");
assert.equal(pollDelayMs(null), null);
assert.equal(shouldPollTick({ visible: false, inFlight: false, cancelled: false }), false, "paused when hidden");
assert.equal(shouldPollTick({ visible: true, inFlight: true, cancelled: false }), false, "never overlapping");
assert.equal(shouldPollTick({ visible: true, inFlight: false, cancelled: true }), false);
assert.equal(shouldPollTick({ visible: true, inFlight: false, cancelled: false }), true);

// ── Shipped default classes and stale grammar on the hero (source guards).
const sts = src("../components/SafeToSpendCard.tsx");
assert.match(sts, /syncing\?: SyncingInfo;/);
assert.doesNotMatch(sts, /syncTreatment|sync\.treatment|SyncLedgerRow|syncLedgerClass/, "A and C treatments are gone from production");
assert.match(sts, /const sync = syncing \? \{ info: syncing, phase: syncPhase\(syncing\) \} : null;/);
assert.match(sts, /const heroFigureClass = sync \? "text-slate-700 dark:text-slate-200" : figureClass;/, "figure steps to secondary ink; default colour path retained");
assert.match(sts, /\$\{stateChipClass\}/, "default chip classes retained");
assert.match(sts, /Last known amount · as of/, "stale caption");
// G218 fold-in: the figure is forced to slate ink (no emerald, red or amber)
// whenever a sync is active.
const heroFigureLine = sts.split("\n").find((l) => l.includes("const heroFigureClass ="));
assert.ok(heroFigureLine, "heroFigureClass is defined");
const syncBranch = heroFigureLine.slice(heroFigureLine.indexOf("sync ?"), heroFigureLine.lastIndexOf(": figureClass"));
assert.match(syncBranch, /text-slate-/, "syncing figure is slate ink");
assert.doesNotMatch(syncBranch, /amber|red|emerald|rose/, "no verdict colour in the syncing branch");
assert.match(sts, /const freshnessLabel = sync \? null/, "no second timestamp while syncing");
assert.match(sts, /const recovery = sync \? null/, "no recovery CTA while syncing");
assert.match(sts, /risk=\{exactCashRunway < 0 && !sync\}/, "ledger figures stay ink while syncing");
assert.match(sts, /onRetry=\{onSyncRetry\}/, "Try again is the sync retry, not the card reload");
assert.doesNotMatch(sts.slice(sts.indexOf("const sync = syncing"), sts.indexOf("const calculationItems")), /red|rose/);
const note = src("../components/SyncNote.tsx");
assert.match(note, /from "@\/components\/ProgressLedger"/, "ring comes from the shared ledger primitives");
assert.doesNotMatch(note, /—|from-indigo|to-violet|bg-red|text-red|rose-/, "no em dash, gradient or red");

// ── Home and Accounts wiring.
const home = src("../app/components/HomePage.tsx");
assert.match(home, /syncing=\{heroSync \?\? undefined\}/);
assert.match(home, /heroSyncingInfo\(/);
assert.match(home, /addEventListener\("visibilitychange"/, "Home re-asks when the tab becomes visible");
assert.match(home, /pollDelayMs\(syncStatus\?\.state\)/, "Home polls on the shared schedule");
assert.equal((home.match(/setInterval\(/g) ?? []).length, 1, "one poll, not a second");
const acc = src("../app/components/AccountsPage.tsx");
assert.match(acc, /<AccountsSyncBanner/);
assert.match(acc, /sync=\{syncFor\(row\)\}/);
assert.match(acc, /acc\.paused/, "a paused bank never shows as syncing");
assert.match(acc, /PausedBanksStrip/);

// ── First sign-up: same grammar, no figure, no verdict.
const first = renderToStaticMarkup(React.createElement(FirstSyncCard, { state: "syncing", connections: [{ provider: "finexer", bank: "ob-monzo" }] }));
assert.match(first, /No figure yet/);
assert.match(first, /We will show your Safe to Spend once Monzo has synced/);
assert.match(first, /data-sync-chip="syncing"/);
assert.doesNotMatch(first, /\b(red|rose)-\d|£/);

assert.match(src("../app/design/page.tsx"), /slug: "sync-loading"/);
assert.match(src("../app/design/page.tsx"), /approved B, folded in/);
console.log("g214-sync-loading: ok");
