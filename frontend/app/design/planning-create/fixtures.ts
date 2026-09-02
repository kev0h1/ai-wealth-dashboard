// Pure-data fixtures for /design/planning-create — the "consolidate adding a
// big expense, an allocation, and a one-off" round. No "use client", no JSX,
// shared verbatim by all three variants so the resulting-cards comparison is
// apples-to-apples.
//
// Reuses three real accounts from the shared design-preview account fixture
// (see ../_mockAccounts.ts) so the account picker inside the allocation shape
// and the one-off shape looks like real bank data, not placeholder rows.

import { mockAccounts } from "../_mockAccounts";
import type { Account, Commitment, Allocation } from "@/lib/api";

// Owner correction, 2026-08-29 (verbatim: "an allocation isn't necessarily
// every month, it can be just once"): `Allocation` now carries `recurrence:
// "every_period" | "once"` plus `completed` natively (landed on lib/api.ts
// and AllocationSheet.tsx's real "How often?" picker while this round was
// in progress) — no local type extension needed, the fixtures below just
// fill in the real fields.
export type AllocationRecurrence = "every_period" | "once";

export const accounts: Account[] = mockAccounts.filter((a) =>
  ["acc-1", "acc-4", "acc-18", "acc-12"].includes(a.id)
);

// acc-1 Premier Current Account (Barclays), acc-4 Kevin Mbithi Maingi (Monzo),
// acc-18 Marcus Online Saver (Savings), acc-12 Rainy Day Pot (Starling, Savings)

export const goal: Commitment = {
  id: "goal-1",
  name: "New car",
  amount: 4000,
  target_date: "2027-01-01",
  funding_pots: [
    {
      account_id: "acc-18",
      name: "Marcus Online Saver",
      kind: "connected",
      count_existing: true,
      contributing_balance: 1450,
    },
  ],
  funding_account_id: "acc-18",
  funding_account_name: "Marcus Online Saver",
  source: "manual",
  status: "active",
  progress: 1450,
  remaining: 2550,
  periods_left: 5,
  per_period_slice: 510,
  period_label: "monthly",
  on_track: true,
  feasibility: "surplus",
  feasibility_note: "Fits comfortably in your monthly spare.",
  feasibility_tone: "info",
  shared_pot_goals: [],
  pace_note: null,
};

export const allocation: Allocation = {
  id: "alloc-1",
  name: "House deposit top-up",
  amount_per_period: 150,
  fill_account_id: "acc-12",
  match_type: "description_contains",
  match_value: "Saving Challenge (2026)",
  fill_display_name: "Saving Challenge (2026)",
  effective_from: "2026-08-22",
  active: true,
  filled_this_period: 90,
  remaining: 60,
  period_start: "2026-08-22",
  period_end: "2026-09-04",
  recurrence: "every_period",
  completed: false,
  pending: false,
};

// A ONCE envelope — a reservation for this pay period only, filled the same
// way (a chosen account plus a chosen incoming payment series), no ongoing
// commitment. Owner's example: money isn't always set aside on a rhythm.
export const allocationOnce: Allocation = {
  id: "alloc-2",
  name: "Bonus set-aside",
  amount_per_period: 300,
  fill_account_id: "acc-1",
  match_type: "description_contains",
  match_value: "Quarterly bonus",
  fill_display_name: "Quarterly bonus",
  effective_from: "2026-08-22",
  active: true,
  filled_this_period: 300,
  remaining: 0,
  period_start: "2026-08-22",
  period_end: "2026-09-04",
  recurrence: "once",
  completed: false,
  pending: false,
};

// GET /allocations/fill-candidates?account_id=acc-12 — the "which payment
// fills it?" step revealed once an account is chosen (AllocationSheet.tsx,
// owner correction 2026-08-29: matched off the transaction, not "any credit
// into the account").
export const fillCandidates = [
  { series_key: "saving-challenge-2026", display_name: "Saving Challenge (2026)", last_amount: 90, occurrences_90d: 3 },
  { series_key: "standing-order-savings", display_name: "Standing order to savings", last_amount: 50, occurrences_90d: 6 },
];

// GET /allocations/fill-candidates?account_id=acc-1 — a once-envelope's
// account tends to be a current account rather than a savings pot (the
// money is only passing through this period, not building toward
// anything), so its candidate list is deliberately a different account and
// a different-looking series than the recurring example above.
export const fillCandidatesOnce = [
  { series_key: "quarterly-bonus", display_name: "Quarterly bonus", last_amount: 300, occurrences_90d: 1 },
];

export const oneOff = {
  name: "Car service",
  amount: 180,
  dateLabel: "Fri 4 Sep",
  accountId: "acc-1",
};

export function accountById(id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

/** "Every pay period" / "Just this period" — the recurrence caption shown
 * on an envelope card, right after the "fed by X" line. */
export function recurrenceLabel(r: AllocationRecurrence): string {
  return r === "once" ? "This period only" : "Every pay period";
}
