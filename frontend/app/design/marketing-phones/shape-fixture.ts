import type { MoneyShape, MoneyShapeJob } from "@/lib/api";
import { SCENARIO } from "./catalog";

// A separate, completed period. This is recorded cash flow, not November's
// £312 left-to-spend forecast or a target allocation of current balances.
const jobs: MoneyShapeJob[] = [
  { id: "fixed", label: "Fixed", amount: 900, share: 50, categories: ["Bills", "Groceries", "Transport"], txn_type: "debit", drivers: [{ category: "Bills", amount: 450 }, { category: "Groceries", amount: 300 }, { category: "Transport", amount: 150 }] },
  { id: "moved", label: "Moved", amount: 300, share: 17, categories: ["Savings"], txn_type: "debit", drivers: [{ category: "Savings", amount: 300 }] },
  { id: "free", label: "Free", amount: 450, share: 25, categories: ["Eating Out", "Shopping"], txn_type: "debit", drivers: [{ category: "Eating Out", amount: 250 }, { category: "Shopping", amount: 200 }] },
  { id: "left", label: "Left over", amount: 150, share: 8, categories: ["Income"], txn_type: "credit", drivers: [{ category: "Income remaining", amount: 150 }] },
];
const period = { start: SCENARIO.completedPeriodStart, end: SCENARIO.completedPeriodEnd, label: SCENARIO.completedPeriodLabel };
const recorded = {
  take_home: 1800, overspent: 0, total_out: 1650, beyond: 0,
  beyond_source: null, card_growth: 0, savings_drawdown: 0, jobs,
  verdict: "Of every £100 you took home, £50 was spoken for before you chose anything. £25 was yours to spend freely.",
};

export const C22_CLOSED_SHAPE: MoneyShape = {
  status: "ok", computed_at: "2026-11-17T09:41:00.000Z", period, ...recorded,
  periods: [{ ...period, ...recorded }], averages: [], trend: { periods: [period.label], fixed: [50], moved: [17], free: [25], left: [8] },
  trend_line: null,
  what_works: { state: "no_pattern", periods_available: 1, periods_needed: 4, pattern_id: null, headline: "No clear pattern yet across 1 pay period.", flag_labels: null, evidence: [], trait: null, proposal: null },
};
