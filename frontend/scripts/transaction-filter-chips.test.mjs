// Plain-Node regression test for the G119 review bug: buildChipItems()
// (lib/transactionFilters.ts) used to build the direction chip as an
// `else if` — only ever shown when no category was active. That was
// correct for the world it was written in, where txn_type only ever
// arrived bundled with a category as one deep-linked concept. Once
// FilterSheet.tsx (folded into production alongside the chips) let a user
// pick a category AND a direction independently in the same sheet, the
// `else if` silently swallowed the direction filter: selecting "Bills"
// plus "Money out" narrowed the list to 4 of 9 payments but showed a
// single "Bills ×" chip, so the extra narrowing was invisible and the
// direction filter had no way to clear on its own.
//
// The fix distinguishes the two cases on `categoryLabel` alone (present =
// one deep-linked concept, clear together; absent = independently
// composed, two separate chips) — see buildChipItems's own docstring in
// lib/transactionFilters.ts for the full reasoning. This test proves BOTH
// shapes: the composed (unlabelled) case now renders two independently-
// clearable chips, and the labelled deep-link case (MoneyShapeHero.tsx's
// "Money you moved"/"Everything that went out") still renders exactly one,
// clearing category+categories+label+txn_type together, unchanged.
//
// Same framework-free pattern as scripts/accounts-pinned.test.mjs: imports
// the REAL production module (lib/transactionFilters.ts), no React, no
// JSX (buildChipItems is pure logic split out of the .tsx component
// specifically so a plain-Node test can reach it directly — see
// lib/transactionFilters.ts's own comment on that split).
//
// Run with:
//   npm run -s check:transaction-filter-chips
// or:
//   node --no-warnings --experimental-strip-types --experimental-loader ./scripts/_ts-extensionless-loader.mjs scripts/transaction-filter-chips.test.mjs

import { buildChipItems, EMPTY_FILTERS } from "../lib/transactionFilters.ts";

let failures = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`FAIL: ${label}\n  expected: ${e}\n  actual:   ${a}`);
  } else {
    console.log(`PASS: ${label}`);
  }
}

function noop() {}

function baseArgs(overrides = {}) {
  return {
    filters: { ...EMPTY_FILTERS, ...overrides.filters },
    categoryLabel: overrides.categoryLabel ?? null,
    onClearCategory: overrides.onClearCategory ?? noop,
    onClearDirection: overrides.onClearDirection ?? noop,
    onClearMerchants: noop,
    onClearPeriod: noop,
  };
}

// ── THE BUG: a category AND a direction, composed independently (no
// categoryLabel — exactly what FilterSheet.tsx's applyFilterDraft produces)
// ─────────────────────────────────────────────────────────────────────────
{
  const items = buildChipItems(baseArgs({
    filters: { category: "Bills", txnType: "debit" },
  }));
  const keys = items.map((i) => i.key);
  check("composed category+direction renders TWO chips, not one", keys, ["category", "direction"]);
  const categoryItem = items.find((i) => i.key === "category");
  const directionItem = items.find((i) => i.key === "direction");
  check("composed category chip is the bare category name", categoryItem?.label, "Bills");
  check("composed direction chip reads 'Money out'", directionItem?.label, "Money out");
}

// The category chip's own clear must NOT touch the direction filter, and
// vice versa — each is independently clearable in the composed case.
{
  let categoryCleared = false;
  let directionCleared = false;
  const items = buildChipItems(baseArgs({
    filters: { category: "Bills", txnType: "debit" },
    onClearCategory: () => { categoryCleared = true; },
    onClearDirection: () => { directionCleared = true; },
  }));
  items.find((i) => i.key === "category").onClear();
  check("clearing the composed category chip fires onClearCategory only", [categoryCleared, directionCleared], [true, false]);

  categoryCleared = false;
  directionCleared = false;
  const items2 = buildChipItems(baseArgs({
    filters: { category: "Bills", txnType: "debit" },
    onClearCategory: () => { categoryCleared = true; },
    onClearDirection: () => { directionCleared = true; },
  }));
  items2.find((i) => i.key === "direction").onClear();
  check("clearing the composed direction chip fires onClearDirection only", [categoryCleared, directionCleared], [false, true]);
}

// ── THE PRE-EXISTING (unchanged) CASE: a labelled deep link names
// category+txn_type as ONE concept — e.g. MoneyShapeHero.tsx's "Money you
// moved" (categories+txn_type+label together) ───────────────────────────
{
  const items = buildChipItems(baseArgs({
    filters: { categories: ["Savings", "Transfer"], txnType: "debit" },
    categoryLabel: "Money you moved",
  }));
  const keys = items.map((i) => i.key);
  check("labelled category+direction deep link renders exactly ONE chip", keys, ["category"]);
  check("labelled chip carries the label text, not the raw category list", items[0].label, "Money you moved");
}

// ── THE OTHER labelled shape: txn_type + label with NO category at all
// (MoneyShapeHero.tsx's overspent-only "Everything that went out") ───────
{
  const items = buildChipItems(baseArgs({
    filters: { txnType: "debit" },
    categoryLabel: "Everything that went out",
  }));
  const keys = items.map((i) => i.key);
  check("labelled direction-only deep link (no category) still renders ONE chip", keys, ["category"]);
  check("labelled direction-only chip carries the label", items[0].label, "Everything that went out");
}

// ── Old-style single-dimension deep links / sheet picks, unaffected ──────
{
  const catOnly = buildChipItems(baseArgs({ filters: { category: "Groceries" } }));
  check("category alone (no direction) still renders one category chip", catOnly.map((i) => i.key), ["category"]);

  const dirOnly = buildChipItems(baseArgs({ filters: { txnType: "credit" } }));
  check("direction alone (no category) still renders one direction chip", dirOnly.map((i) => i.key), ["direction"]);
  check("direction-only chip reads 'Money in'", dirOnly[0].label, "Money in");

  const none = buildChipItems(baseArgs({}));
  check("no filters active renders no chips", none.length, 0);
}

if (failures > 0) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll transaction-filter-chips (G119 review) checks passed.");
