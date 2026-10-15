// G275 (Kevin 2026-10-15): the Spend aim rings must appear on a cold load, with
// no Mirror visit. Cause: SpendPage only ever read the signals cache, which
// only the Mirror (MirrorPage fetchSignals(0)) filled. Proves:
//  1. Spend's own load path requests signals per period, not only on mutation.
//  2. fetchSignals dedupes through the shared cache and in-flight map, and a
//     failed fetch no longer writes an empty map that shadows "no aims".
//  3. An aim change paints optimistically (applyAimChange).
//  4. The ring keeps its aria-label and the row shows the visible hint.
//  5. Copy rules on the new strings.
//
// Run: npm run -s check:g275-aim-first-load

import assert from "node:assert/strict";
import React from "react";
import { readFileSync } from "node:fs";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { renderToStaticMarkup } from "react-dom/server";
import { api } from "../lib/api.ts";
import { fetchSignals, cachedSignals, invalidateSignalsCache, applyAimChange } from "../lib/signalsCache.ts";
import { MajorityRowView } from "../components/SpendVerdictView.tsx";
import { aimHint, aimSentence } from "../components/AimProgress.tsx";

const h = React.createElement;
const noop = () => {};
const router = { back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: noop };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const render = (el) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, el));

// 1. Spend's own load requests signals ---------------------------------------
const page = read("../app/components/SpendPage.tsx");
assert.match(page, /useEffect\(\(\) => \{ refetchSignals\(false\); \}, \[refetchSignals\]\)/, "Spend requests signals on load and per period");
assert.ok(!/catch\(\(\) => setFetchedSignals/.test(page), "a failed fetch must not write an empty map");
assert.match(page, /signalsGenRef\.current\) return/, "older refetch generations are ignored");
assert.match(page, /onAimChanged=\{handleAimChanged\}/);
assert.match(page, /applyAimChange\(/);

// 2. dedupe + no empty shadow --------------------------------------------------
const checkpoint = { id: "a1", aim_amount: 350, spent_so_far: 328, days_left: 6, on_track: true };
let calls = 0;
api.categorySignals = async () => { calls++; return { signals: { "Eating Out": { suggested_aim: 350, checkpoint } } }; };
invalidateSignalsCache();
assert.equal(cachedSignals(0), null, "cold: nothing cached");
const [a, b] = await Promise.all([fetchSignals(0), fetchSignals(0)]);
assert.equal(calls, 1, "Spend and the Mirror share one in-flight fetch");
assert.equal(a["Eating Out"].checkpoint.aim_amount, 350);
assert.equal(b, a);
await fetchSignals(0);
assert.equal(calls, 1, "a warm entry is reused");
await fetchSignals(-1);
assert.equal(calls, 2, "the cache is keyed per period offset");
invalidateSignalsCache();
await fetchSignals(0);
assert.equal(calls, 3, "invalidation forces a fresh read");
// a period with no aims caches an empty map as a real answer, not as a missing one
api.categorySignals = async () => { calls++; return { signals: {} }; };
invalidateSignalsCache();
assert.deepEqual(await fetchSignals(0), {});
assert.deepEqual(cachedSignals(0), {}, "empty entry is a real hit for this period only");
assert.equal(cachedSignals(-2), null, "and does not stand in for another period");

// 3. optimistic aim change -------------------------------------------------------
const before = { Bills: { suggested_aim: 90, checkpoint: null } };
const set = applyAimChange(before, { category: "Bills", checkpoint });
assert.equal(set.Bills.checkpoint.aim_amount, 350);
assert.equal(set.Bills.suggested_aim, 90, "suggested aim is kept");
assert.equal(before.Bills.checkpoint, null, "input is not mutated");
assert.equal(applyAimChange(set, { category: "Bills", checkpoint: null }).Bills.checkpoint, null, "cancel clears the ring");
assert.equal(applyAimChange({}, { category: "Eating Out", checkpoint })["Eating Out"].checkpoint.id, "a1");

// 4. aria-label and visible hint -------------------------------------------------
const row = { category: "Eating Out", spent: 328, payments_count: 9 };
const html = render(h(MajorityRowView, { row, colours: {}, quietTag: false, onOpen: noop, tips: [], aim: checkpoint, periodDays: 28 }));
assert.equal(aimHint(checkpoint), "£328 of a £350 aim");
assert.ok(html.includes('aria-label="£328 of a £350 aim, '), "ring carries the aria-label");
assert.ok(text(html).includes("£328 of a £350 aim"), "visible hint in the row");
assert.ok(/<p aria-hidden="true"[^>]*>£328 of a £350 aim<\/p>/.test(html), "hint is visible and not read twice");
const none = render(h(MajorityRowView, { row, colours: {}, quietTag: false, onOpen: noop, tips: [], aim: null, periodDays: 28 }));
assert.ok(!none.includes("aim"), "no aim, no ring and no hint");

// 5. copy rules ---------------------------------------------------------------------
for (const s of [aimHint(checkpoint), aimSentence(checkpoint, 28)]) {
  assert.ok(!/[—–!]/.test(s) && !/over budget/i.test(s), `copy rules: ${s}`);
}
console.log("g275-aim-first-load: ok");
