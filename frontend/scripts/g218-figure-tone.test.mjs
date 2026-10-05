// G218: pins the Safe to Spend figure tones.
//
// Production passes no `figureTone`, so the card must render exactly today's
// classes. This file pins those class names (so a refactor cannot quietly
// recolour the shipped hero) and the documented mapping for every other tone.
//
// Run: npm run -s check:g218-figure-tone

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { figureToneClasses, isPlansOnlyShort, FIGURE_TONES_USING_PLANS_ONLY } from "../components/SafeToSpendCard.tsx";

const CASES = {
  onTrack: { state: "comfortable", isCardsUnconfirmedShort: false, plansOnly: false },
  tight: { state: "tight", isCardsUnconfirmedShort: false, plansOnly: false },
  card: { state: "short", isCardsUnconfirmedShort: true, plansOnly: false },
  shortCash: { state: "short", isCardsUnconfirmedShort: false, plansOnly: false },
  shortPlans: { state: "short", isCardsUnconfirmedShort: false, plansOnly: true },
};
const INK = "text-slate-900 dark:text-slate-100";

// 1. Default tone: today's shipped classes, byte for byte.
const t = (c) => figureToneClasses("tinted", c);
assert.equal(t(CASES.onTrack).figure, "text-emerald-700 dark:text-emerald-300");
assert.equal(t(CASES.shortCash).figure, "text-red-600 dark:text-red-400");
assert.equal(t(CASES.tight).figure, INK);
assert.equal(t(CASES.card).figure, INK);
// The plans-only flag must not change the default tone at all.
assert.deepEqual(t(CASES.shortPlans), t(CASES.shortCash));
assert.equal(t(CASES.onTrack).chip, "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300");
assert.equal(t(CASES.tight).chip, "bg-slate-100 text-amber-800 dark:bg-slate-700/70 dark:text-amber-200");
assert.equal(t(CASES.shortCash).chip, "bg-slate-100 text-red-700 dark:bg-slate-700/70 dark:text-red-300");
for (const c of Object.values(CASES)) assert.equal(t(c).accent, null);

// 2. tinted-vivid (variant B): only the dark red moves.
const b = (c) => figureToneClasses("tinted-vivid", c);
assert.equal(b(CASES.shortCash).figure, "text-red-600 dark:text-red-500");
assert.equal(b(CASES.onTrack).figure, t(CASES.onTrack).figure);
assert.deepEqual(b(CASES.shortPlans), b(CASES.shortCash));

// 3. ink (variant A): ink in every state, plans-only chip is amber.
const a = (c) => figureToneClasses("ink", c);
for (const c of Object.values(CASES)) { assert.equal(a(c).figure, INK); assert.equal(a(c).accent, null); }
assert.equal(a(CASES.shortCash).chip, t(CASES.shortCash).chip);
assert.equal(a(CASES.shortPlans).chip, t(CASES.tight).chip);

// 4. ink-accent (variant C): rule only for On track and cash-led short.
const c = (x) => figureToneClasses("ink-accent", x);
for (const x of Object.values(CASES)) assert.equal(c(x).figure, INK);
assert.match(c(CASES.onTrack).accent, /bg-emerald-600/);
assert.match(c(CASES.shortCash).accent, /bg-red-600 dark:bg-red-500/);
for (const k of ["tight", "card", "shortPlans"]) assert.equal(c(CASES[k]).accent, null, k);
assert.equal(c(CASES.shortPlans).chip, t(CASES.tight).chip);

// 5. Plans-only derivation from the payload.
const ok = { status: "ok", state: "short", short_reason: "bills", safe_to_spend: -250, safe_to_spend_cash: -250, buffer: 0, lowest_projected_balance: 0, commitments_reserved: 50, allocations_reserved: 200 };
assert.equal(isPlansOnlyShort(ok), true, "Kevin's screenshot: £0 cash, £250 of set-asides");
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: -86, commitments_reserved: 0, allocations_reserved: 0, safe_to_spend_cash: -86 }), false, "bills push cash negative");
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: -1 }), false, "cash itself negative");
assert.equal(isPlansOnlyShort({ ...ok, buffer: 40 }), false, "buffer eats the headroom, not only set-asides");
assert.equal(isPlansOnlyShort({ ...ok, commitments_reserved: 0, allocations_reserved: 0 }), false, "nothing set aside");
assert.equal(isPlansOnlyShort({ ...ok, lowest_projected_balance: undefined }), false, "unknown is not plans-only");
assert.equal(isPlansOnlyShort({ ...ok, short_reason: "cards_unconfirmed" }), false);
assert.equal(isPlansOnlyShort({ ...ok, state: "tight", safe_to_spend_cash: 20 }), false);

assert.equal(isPlansOnlyShort({ ...ok, buffer: 40, lowest_projected_balance: 40 }), true, "headroom exactly equal to a non-zero buffer");
assert.deepEqual(FIGURE_TONES_USING_PLANS_ONLY, { tinted: false, "tinted-vivid": false, ink: true, "ink-accent": true });

// 6. Source guard: the defaults a production render relies on.
const src = readFileSync(new URL("../components/SafeToSpendCard.tsx", import.meta.url), "utf8");
assert.match(src, /figureTone = "tinted"/, "default tone must stay tinted");
assert.match(src, /previewBalancesVisible = false/, "masking must default to production behaviour");
assert.match(src, /!previewBalancesVisible && \(hideNetWorth \|\| !preferencesReady\)/);
assert.doesNotMatch(readFileSync(new URL("../components/HomePage.tsx", import.meta.url).pathname.replace("components/HomePage.tsx", "app/components/HomePage.tsx"), "utf8"), /figureTone|previewBalancesVisible/, "Home must not opt in");

console.log("g218-figure-tone: all assertions passed");
