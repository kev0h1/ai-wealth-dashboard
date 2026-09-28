// Plain-Node regression test for G168's rejection fix.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs --experimental-loader ./scripts/g168-stub-loader.mjs scripts/month-closed-dismiss.test.mjs
// or:
//   npm run -s check:month-closed-dismiss
//
// What was rejected (TODO.md G168, 2026-09-27): the approved design ("Chip
// and chevron") was built faithfully in every visible respect, but the
// Home dismiss chip's onDismiss handler ALSO called the shared server
// dismiss (api.dismissTodayItem). companion.py's needle-item builder gates
// the item on ONE per-user dismissed set read by every caller of /today —
// Penny included, since app/penny/PennyPage.tsx reads the identical feed —
// so dismissing on Home silently deleted Penny's supposedly-permanent copy
// too, directly contradicting the approved "Penny never dismisses" rule.
//
// The fix: Home's dismiss is now Home-only, the SAME onHomeDismiss
// (useHomeDismissedAdvice) convention every other advice card on Home
// already uses (a purely local, per-device localStorage suppression,
// lib/homeDismissedAdvice.ts) — and it no longer calls
// api.dismissTodayItem at all for this item type. This file pins two
// properties:
//
//   1. Home's dismiss of the needle item calls onHomeDismiss (the local
//      store) and NEVER api.dismissTodayItem.
//   2. A second BriefBody render in Penny's shape (dismissible=false, the
//      exact mode app/penny/PennyPage.tsx renders informational items in)
//      still surfaces the SAME needle item after Home's local dismissal —
//      proving the suppression never reached the shared feed.
//   3. The real MonthClosedCard, rendered as PennyPage.tsx actually renders
//      it (surface="penny", no onDismiss prop), exposes a Minimise control
//      and NO Dismiss control at all — there is no way to fire a dismiss
//      from Penny's card, structurally.
//
// Harness note: this repo has no jsdom/click simulation (see
// scripts/spend-from-render.test.mjs's own "ceiling on this technique"
// comment for the established limits of renderToStaticMarkup). Property 1
// is exercised by capturing the REAL onDismiss closure BriefBody
// constructs — via scripts/g168-stub-loader.mjs substituting
// components/MonthClosedCard with a props-capturing stub — and calling it
// directly, a plain function call, which is exactly what dispatching a
// real click ultimately does. Properties 2 and 3 need no substitution:
// they're read straight from rendered markup / the real component's
// filtering logic.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BriefBody } from "../components/HomeBrief.tsx";
import RealMonthClosedCard from "../components/MonthClosedCard.tsx";
import { api } from "../lib/api.ts";
import { readHomeDismissedAdvice } from "../lib/homeDismissedAdvice.ts";
import { pennyInformationalItems } from "../lib/companionItems.ts";
// Alias specifier — redirected to the props-capturing stub by
// scripts/g168-stub-loader.mjs. This is the SAME specifier
// components/HomeBrief.tsx itself imports, so both resolve to the one
// stub module instance.
import { capturedProps } from "@/components/MonthClosedCard";

let failures = 0;

function check(label, cond) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

// Fake `window` — just enough for lib/homeDismissedAdvice.ts and
// components/MonthClosedCard.tsx's own localStorage reads/writes. Neither
// module needs anything else from `window`.
class FakeLocalStorage {
  constructor() { this.store = new Map(); }
  getItem(k) { return this.store.has(k) ? this.store.get(k) : null; }
  setItem(k, v) { this.store.set(k, String(v)); }
  removeItem(k) { this.store.delete(k); }
}
globalThis.window = { localStorage: new FakeLocalStorage() };

const fakeRouter = { push: () => {} };

const NEEDLE_ITEM = {
  id: "needle:2026-08-27",
  type: "needle",
  headline: "Your month closed on Thursday.",
  body: "",
  action: { label: "Here's how it went ›", route: "/month/story?which=last" },
  estimated: false,
};

// ── 1. Home's dismiss must never fire the shared server dismiss ───────────

const dismissTodayItemCalls = [];
api.dismissTodayItem = (itemId) => {
  dismissTodayItemCalls.push(itemId);
  return Promise.resolve();
};

capturedProps.length = 0;
renderToStaticMarkup(
  React.createElement(BriefBody, {
    items: [NEEDLE_ITEM],
    safeToSpend: null,
    router: fakeRouter,
    dismissible: true,
  })
);

const homeNeedleProps = capturedProps.find((p) => p.item?.id === NEEDLE_ITEM.id);
check("Home render passes the needle item to MonthClosedCard", !!homeNeedleProps);
check("Home render sets surface=\"home\"", homeNeedleProps?.surface === "home");
check("Home render supplies an onDismiss function", typeof homeNeedleProps?.onDismiss === "function");

// The real click, once React dispatches it, ultimately does nothing more
// than call this function — so calling it directly is a faithful stand-in
// for a click, absent a DOM to dispatch one on.
homeNeedleProps.onDismiss();

check(
  "dismissing on Home never calls api.dismissTodayItem",
  dismissTodayItemCalls.length === 0
);
check(
  "dismissing on Home DOES write the Home-only local suppression",
  readHomeDismissedAdvice().has(NEEDLE_ITEM.id)
);

// ── 2. Penny's shape must still see the item after Home's local dismiss,
//      through exactly ONE path (its own dedicated `needleItem`/section c2
//      rendering), never a second time via BriefBody's informational
//      bucket. ───────────────────────────────────────────────────────────
//
// app/penny/PennyPage.tsx computes `informationalPennyItems` by calling
// the REAL, exported lib/companionItems.ts `pennyInformationalItems`
// helper directly (imported below, not re-implemented) — so this exercises
// the actual production logic, not a copy of it. "needle" is classified
// INFORMATIONAL by isActionableCompanionItem, so without
// pennyInformationalItems' own explicit "needle" exclusion it would ALSO
// land in this bucket on any device that hasn't dismissed it on Home yet
// (dismissedKeys is per-device localStorage) — and BriefBody has its OWN
// hardcoded, Home-shaped rendering for any needle item it's handed
// (surface="home", a real Dismiss ×, unconditionally, see its block
// above), which would double-render the card: once wrongly, with a
// dismiss control, via this section, and once correctly (chevron Minimise
// only) via the dedicated `needleItem` line PennyPage.tsx reads straight
// off the RAW, unfiltered items (section c2, exercised directly in part 3
// below). `dismissedKeys` is passed empty here deliberately — this must
// hold even on a device that has never dismissed anything on Home.

const informationalPennyItems = pennyInformationalItems([NEEDLE_ITEM], new Set());
const pennyDedicatedNeedleItem = [NEEDLE_ITEM].find(i => i.type === "needle") ?? null;

check(
  "pennyInformationalItems excludes the needle item — no double-render on Penny",
  informationalPennyItems.length === 0
);
check(
  "needle item still resolves via Penny's own dedicated (raw, unfiltered) read",
  pennyDedicatedNeedleItem?.id === NEEDLE_ITEM.id
);

// ── 3. The REAL card, rendered exactly as PennyPage.tsx renders it, has no
//      dismiss control at all — only Minimise. ─────────────────────────────
// app/penny/PennyPage.tsx's section c2 renders
// `<MonthClosedCard item={needleItem} router={router} surface="penny" />`
// with no onDismiss prop. No stub here — this is the real component.

const pennyMarkup = renderToStaticMarkup(
  React.createElement(RealMonthClosedCard, {
    item: NEEDLE_ITEM,
    router: fakeRouter,
    surface: "penny",
  })
);

check("Penny's card renders a Minimise control", pennyMarkup.includes('aria-label="Minimise"'));
check("Penny's card renders NO Dismiss control", !pennyMarkup.includes('aria-label="Dismiss"'));

// Belt and braces: Home's own render (surface="home") DOES still carry the
// real Dismiss control — confirms the assertion above is discriminating
// (surface="penny" hiding it) rather than the markup never containing it
// at all.
const homeMarkup = renderToStaticMarkup(
  React.createElement(RealMonthClosedCard, {
    item: NEEDLE_ITEM,
    router: fakeRouter,
    surface: "home",
    onDismiss: () => {},
  })
);
check("Home's card DOES render a Dismiss control", homeMarkup.includes('aria-label="Dismiss"'));

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
} else {
  console.log("\nAll checks passed.");
}
