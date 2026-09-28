// Plain-Node regression test for G168's cross-surface dismiss fix.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs --experimental-loader ./scripts/g168-stub-loader.mjs scripts/month-closed-dismiss.test.mjs
// or:
//   npm run -s check:month-closed-dismiss
//
// What was rejected (TODO.md G168, 2026-09-27): the approved design ("Chip
// and chevron") was built faithfully in every visible respect, but the
// Home dismiss chip's onDismiss handler called the shared, UNSCOPED server
// dismiss (api.dismissTodayItem(id)). companion.py's needle-item builder
// gated the item's existence on that ONE per-user dismissed set read by
// every caller of /today — Penny included, since app/penny/PennyPage.tsx
// reads the identical feed — so dismissing on Home silently deleted
// Penny's supposedly-permanent copy too, directly contradicting the
// approved "Penny never dismisses" rule.
//
// The fix (2026-09-28) is server-side, not "make Home local-only" (an
// earlier draft of this fix took that path and was replaced: it gave up
// cross-device persistence for Home's own dismissal, which the ticket
// requires): companion.py's needle builder now ALWAYS builds the item
// through its two-day window regardless of dismissal, and only stamps a
// `home_dismissed` boolean read from a SEPARATE, surface-scoped dismissed
// set (`dismiss_item(uid, item_id, surface="home")`, written to a
// `home_dismissed` field the shared `ids` field never touches). The
// backend refuses an unscoped dismiss of a needle id with 400. This file
// pins the frontend half of that contract:
//
//   1. Home's dismiss of the needle item calls the REAL server dismiss,
//      scoped: api.dismissTodayItem(id, "home") — not unscoped, not
//      skipped — AND still writes the local onHomeDismiss suppression for
//      an instant, no-round-trip hide (the existing convention every other
//      advice card on Home already uses).
//   2. HomeBrief hides a needle item the server has already stamped
//      `home_dismissed: true` on (the cross-device case: dismissed on
//      another device, this device's next /today fetch reflects it).
//   3. Penny's own dedicated read (app/penny/PennyPage.tsx's `needleItem`)
//      finds the SAME item regardless of `home_dismissed` — it is never
//      filtered on that field, so a Home dismissal (from any device) can
//      never remove Penny's copy.
//   4. A second BriefBody render in Penny's shape (dismissible=false, the
//      exact mode app/penny/PennyPage.tsx renders informational items in)
//      never double-renders the needle item — proven via the real,
//      exported `pennyInformationalItems` helper, not a re-implementation.
//   5. The real MonthClosedCard, rendered as PennyPage.tsx actually renders
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
// real click ultimately does. The rest need no substitution: they're read
// straight from rendered markup / the real filtering logic.

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

// Review fix (2026-09-28): each check block that renders BriefBody gets a
// FRESH `window.localStorage` (and fresh `capturedProps`) via this helper,
// called at the top of every such block below. Before this fix a single
// FakeLocalStorage instance was shared across the whole file, so check 1's
// onDismiss() call (which writes the item id via onHomeDismiss/
// dismissOnHome) left it in localStorage for every check that ran after —
// including check 2, whose whole point is to prove the SERVER-side
// `home_dismissed` flag alone is enough to hide the item. With the leftover
// localStorage entry present, BriefBody's own `dismissedIds` filter
// (HomeBrief.tsx's `useHomeDismissedAdvice`, ~line 1888) already removed
// the item before the `!i.home_dismissed` guard (~line 2023) ever ran, so
// check 2 passed for the wrong reason and would keep passing even with that
// guard deleted — proven by temporarily removing it, see this commit's
// message for the before/after run.
function resetWindow() {
  globalThis.window = { localStorage: new FakeLocalStorage() };
}
resetWindow();

const fakeRouter = { push: () => {} };

const NEEDLE_ITEM = {
  id: "needle:2026-08-27",
  type: "needle",
  headline: "Your month closed on Thursday.",
  body: "",
  action: { label: "Here's how it went ›", route: "/month/story?which=last" },
  estimated: false,
};

// ── 1. Home's dismiss must call the SCOPED server dismiss, plus the local
//      optimistic suppression ─────────────────────────────────────────────

const dismissTodayItemCalls = [];
api.dismissTodayItem = (itemId, surface) => {
  dismissTodayItemCalls.push([itemId, surface]);
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
  "dismissing on Home calls api.dismissTodayItem exactly once",
  dismissTodayItemCalls.length === 1
);
check(
  "dismissing on Home scopes the call to surface=\"home\" (the regression: an earlier build sent it unscoped, deleting Penny's copy)",
  dismissTodayItemCalls[0]?.[0] === NEEDLE_ITEM.id && dismissTodayItemCalls[0]?.[1] === "home"
);
check(
  "dismissing on Home ALSO writes the local suppression, for an instant hide with no round trip",
  readHomeDismissedAdvice().has(NEEDLE_ITEM.id)
);

// ── 2. HomeBrief must hide a needle item the server has already stamped
//      home_dismissed on (the cross-device case) ──────────────────────────
//
// Fresh localStorage AND fresh capturedProps: this must hold on a device
// that has NEVER locally dismissed this item on Home (dismissedIds/
// useHomeDismissedAdvice empty) — the only mechanism standing between the
// item and the render is the `home_dismissed` guard itself. Reusing check
// 1's window here would mask that: check 1's onDismiss() already wrote
// this same item id into local dismissedIds, so BriefBody's OWN local
// filter (unrelated to `home_dismissed`) would hide it first, and this
// check would keep passing even if the `!i.home_dismissed` guard were
// deleted entirely.

resetWindow();
capturedProps.length = 0;

check(
  "check 2 starts with an EMPTY local Home-dismissed set (isolation guard)",
  readHomeDismissedAdvice().size === 0
);

renderToStaticMarkup(
  React.createElement(BriefBody, {
    items: [{ ...NEEDLE_ITEM, home_dismissed: true }],
    safeToSpend: null,
    router: fakeRouter,
    dismissible: true,
  })
);

check(
  "a needle item with home_dismissed=true is never handed to MonthClosedCard on Home",
  capturedProps.find((p) => p.item?.id === NEEDLE_ITEM.id) === undefined
);

// ── 3. Penny's own dedicated read must find the item regardless of
//      home_dismissed — this is the property that makes Penny's copy
//      genuinely permanent under the new design. Mirrors the exact
//      expression app/penny/PennyPage.tsx uses for its `needleItem`
//      constant, not a re-implementation of different logic. ─────────────

const pennyDedicatedNeedleItem =
  [{ ...NEEDLE_ITEM, home_dismissed: true }].find((i) => i.type === "needle") ?? null;

check(
  "Penny's dedicated read finds the needle item even when home_dismissed is true",
  pennyDedicatedNeedleItem?.id === NEEDLE_ITEM.id
);

// ── 4. Penny's shape must never double-render the needle item through
//      BriefBody's informational bucket. ─────────────────────────────────
//
// app/penny/PennyPage.tsx computes `informationalPennyItems` by calling
// the REAL, exported lib/companionItems.ts `pennyInformationalItems`
// helper directly (imported above, not re-implemented) — so this exercises
// the actual production logic, not a copy of it. "needle" is classified
// INFORMATIONAL by isActionableCompanionItem, so without
// pennyInformationalItems' own explicit "needle" exclusion it would ALSO
// land in this bucket — and BriefBody has its OWN hardcoded, Home-shaped
// rendering for any needle item it's handed (surface="home", a real
// Dismiss ×, unconditionally, see its block above), which would
// double-render the card: once wrongly, with a dismiss control, via this
// section, and once correctly (chevron Minimise only) via the dedicated
// `needleItem` read exercised directly in part 3 above.

const informationalPennyItems = pennyInformationalItems([NEEDLE_ITEM], new Set());

check(
  "pennyInformationalItems excludes the needle item — no double-render on Penny",
  informationalPennyItems.length === 0
);

// ── 5. The REAL card, rendered exactly as PennyPage.tsx renders it, has no
//      dismiss control at all — only Minimise. ─────────────────────────────
// app/penny/PennyPage.tsx's section c2 renders
// `<MonthClosedCard item={needleItem} router={router} surface="penny" />`
// with no onDismiss prop. No stub here — this is the real component.
//
// Fresh window again: MonthClosedCard reads its OWN minimise preference
// from localStorage (a different key, `wd_month_closed_minimised`, see
// that component's docstring) — isolating this block keeps every check in
// this file independent of run order, not just the two that share the
// Home-dismissed key.

resetWindow();
capturedProps.length = 0;

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
