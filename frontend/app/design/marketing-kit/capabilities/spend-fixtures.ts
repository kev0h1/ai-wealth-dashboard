import type { SpendVerdict, Transaction } from "@/lib/api";
import { CATEGORY_COLOURS } from "@/lib/categories";

/**
 * C22 fictional Spend proof, frozen for the current 8–30 November pay
 * period. The capture clock is 17 November (day 10), which keeps every
 * comparison scoped to the same point in the same pay period.
 *
 * £860 Out is categorised in full. The £400 moved to savings is deliberately
 * outside Out, exactly as the shipped Spend hero explains.
 */
export const SPEND_CHANGE_VERDICT: SpendVerdict = {
  state: "normal",
  reading: "You spent £120 more than usual by day 10, mostly on Eating Out.",
  notables: [
    {
      category: "Eating Out",
      spent: 240,
      multiple: 2,
      excess: 120,
      payments_count: 4,
      cause: [
        { name: "Brixton Kitchen", amount: 92 },
        { name: "Canal Café", amount: 58 },
        { name: "Market Lunch", amount: 48 },
      ],
      pace: { spent: 240, usual_by_now: 120 },
    },
  ],
  quiet_flags: [],
  majority: [
    { category: "Groceries", spent: 220, payments_count: 5, has_baseline: true, elevated: false },
    { category: "Bills", spent: 180, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Transport", spent: 120, payments_count: 6, has_baseline: true, elevated: false },
    { category: "Shopping", spent: 100, payments_count: 2, has_baseline: true, elevated: false },
  ],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
  moved: [{ kind: "pots", label: "Moved to savings", amount: 400, payments_count: 1, categories: ["Savings"] }],
  pills: { spent: 860, income: 2400, net: 1540 },
  period: { start: "2026-11-08", end: "2026-11-30", days_elapsed: 10, days_left: 13, offset: 0, closed: false },
  // The day-10 endpoint is authoritative: £860 actual versus £740 usual.
  // The entire £120 period difference is the named Eating Out excess above.
  pace_series: [
    { day: 1, actual: 74, usual: 74 },
    { day: 2, actual: 146, usual: 148 },
    { day: 3, actual: 228, usual: 222 },
    { day: 4, actual: 312, usual: 296 },
    { day: 5, actual: 398, usual: 370 },
    { day: 6, actual: 480, usual: 444 },
    { day: 7, actual: 574, usual: 518 },
    { day: 8, actual: 670, usual: 592 },
    { day: 9, actual: 768, usual: 666 },
    { day: 10, actual: 860, usual: 740 },
  ],
  moved_total: 400,
  unresolved_total: 0,
  unresolved_material: false,
  impact: null,
};

/** Four named payments reconcile exactly to Eating Out's £240 total. */
export const EATING_OUT_PAYMENTS: Transaction[] = [
  { id: "c22-eating-out-brixton-kitchen", account_id: "c22-current", date: "2026-11-16", amount: 92, currency: "GBP", description: "Brixton Kitchen", merchant_name: "Brixton Kitchen", category: "Eating Out", transaction_type: "debit" },
  { id: "c22-eating-out-canal-cafe", account_id: "c22-current", date: "2026-11-14", amount: 58, currency: "GBP", description: "Canal Café", merchant_name: "Canal Café", category: "Eating Out", transaction_type: "debit" },
  { id: "c22-eating-out-market-lunch", account_id: "c22-current", date: "2026-11-12", amount: 48, currency: "GBP", description: "Market Lunch", merchant_name: "Market Lunch", category: "Eating Out", transaction_type: "debit" },
  { id: "c22-eating-out-corner-table", account_id: "c22-current", date: "2026-11-09", amount: 42, currency: "GBP", description: "Corner Table", merchant_name: "Corner Table", category: "Eating Out", transaction_type: "debit" },
];

/** Use the product's canonical category colours, never campaign-only hues. */
export const SPEND_CATEGORY_COLOURS: Record<string, string> = CATEGORY_COLOURS;
