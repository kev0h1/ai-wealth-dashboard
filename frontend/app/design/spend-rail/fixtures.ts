// G264 fixtures: one LONG pay-period journey (pay arrived, three changes, payments to
// categorise, the rest of the spending in 14 categories, charts) so the page scrolls for
// real on a 390px phone. Typed against the real SpendVerdict. Invented figures.
import type { SpendVerdict } from "@/lib/api";
import { SPEND_VERDICT_FIXTURES } from "../spend-live/fixtures";

const BASE = SPEND_VERDICT_FIXTURES.normal;

const MAJORITY: SpendVerdict["majority"] = [
  ["Mortgage", 1124, 1], ["Bills", 633, 12], ["Car finance", 429, 1], ["Groceries", 306, 5], ["Eating Out", 203, 14],
  ["Health", 182, 2], ["Entertainment", 164, 6], ["Subscriptions", 122, 9], ["Travel", 118, 4], ["Cash", 115, 2],
  ["Shopping", 61, 3], ["Golf", 36, 2], ["Software", 22, 1], ["Charity", 5, 1],
].map(([category, spent, payments_count]) => ({
  category: category as string, spent: spent as number, payments_count: payments_count as number, has_baseline: true, elevated: false,
}));

const majorityTotal = MAJORITY.reduce((s, r) => s + r.spent, 0);

export type RailFixtureKey = "base" | "nochanges" | "nothingtocategorise" | "zero";

function make(overrides: Partial<SpendVerdict> = {}, unresolvedTotal = 84, unresolvedCount = 3): SpendVerdict {
  const notables = overrides.notables ?? BASE.notables;
  const notableSum = notables.reduce((s, n) => s + n.spent, 0);
  return {
    ...BASE,
    reading: "You spent more than usual by day 16, mostly on Bills.",
    notables,
    quiet_flags: overrides.quiet_flags ?? BASE.quiet_flags,
    majority: MAJORITY,
    unresolved: unresolvedCount === 0
      ? { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null }
      : {
        total: unresolvedTotal, payments_count: unresolvedCount, ask_worthy: false, weight: "routine",
        largest: {
          id: "fixture-rail-1", display_name: "Wise", raw_description: "WISE *8827 TRANSFER", amount: unresolvedTotal,
          date: "2026-08-04", account_id: "fixture-account-barclays",
        },
      },
    pills: { spent: Math.round(notableSum + majorityTotal + unresolvedTotal), income: 29800, net: 0 },
    period: { ...BASE.period, days_elapsed: 16, days_left: 19 },
    ...overrides,
  };
}

export const RAIL_VERDICTS: Record<RailFixtureKey, SpendVerdict> = {
  base: make(),
  nochanges: make({ notables: [], quiet_flags: [] }),
  nothingtocategorise: make({}, 0, 0),
  // One payment worth 40p: shows as "1 payment · £0" today.
  zero: make({}, 0.4, 1),
};
