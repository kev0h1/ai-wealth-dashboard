// G164 (2026-09-26, Kevin) — the payday plan lifecycle. Fixture data only,
// no API calls, no real user data: the decision this round builds dropped
// the "already split" executed/receipt state outright (the plan is purely
// advisory, so there is nothing left to report once the pay lands), which
// also removes the need for the real 25 Sep payload the previous
// (superseded) round of this preview used — there is no more receipt ledger
// for it to authenticate. Every figure below is invented, in the same style
// as app/design/g134-home-inventory/fixtures.ts's own payday-plan fixtures.

import type { CompanionItem, PaydayPlanDest, PaydayPlanSalary, SafeToSpend } from "@/lib/api";

const SALARY: PaydayPlanSalary = {
  account_id: "salary-hsbc",
  name: "HSBC Current",
  provider: "HSBC",
  amount: 2450,
  stays: 640,
};

const DESTS: PaydayPlanDest[] = [
  {
    account_id: "bills-premier",
    name: "Premier Current",
    provider: "Barclays",
    balance: 44.68,
    bills_total: 820,
    bill_count: 3,
    spend_typical: 0,
    buffer: 100,
    target: 920,
    move: 920,
    usual: null,
  },
  {
    account_id: "everyday-monzo",
    name: "Monzo",
    provider: "Monzo",
    balance: 640,
    bills_total: 0,
    bill_count: 0,
    spend_typical: 380,
    buffer: 80,
    target: 460,
    move: 460,
    usual: 400,
  },
  {
    account_id: "saver-nationwide",
    name: "Savings",
    provider: "Nationwide",
    balance: 2100,
    bills_total: 0,
    bill_count: 0,
    spend_typical: 0,
    buffer: 0,
    target: 230,
    move: 230,
    usual: null,
    commitment_names: ["House deposit"],
  },
];

const TOTAL = DESTS.reduce((sum, d) => sum + d.move, 0);

/** `home-live` / `penny` live states — a real, currently-active plan
 * (`preview: true`, hedged heading via `next_pay`). This is the ONLY plan
 * shape that exists now: there is no further "executed" state to fork from
 * it (G164) — a plan whose destinations already clear on their own the
 * moment it would first be proposed is never persisted or shown at all (no
 * item), and a plan the user acted on by hand is marked done and celebrated
 * once via the standard celebration card, not this card. */
export const LIVE_PLAN_ITEM: CompanionItem = {
  id: "payday_plan:g164:live",
  type: "payday_plan",
  headline: `Payday plan: split £${SALARY.amount.toLocaleString("en-GB")} across ${DESTS.length} accounts`,
  body: `£${TOTAL.toLocaleString("en-GB")} distributed, £${SALARY.stays.toLocaleString("en-GB")} stays in ${SALARY.name}.`,
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  total: TOTAL,
  preview: true,
  next_pay: "2026-09-28",
  dests: DESTS,
  salary: SALARY,
};

/** `penny-expanded` — the SAME shape a tap on Penny's entry row fetches
 * live via `/today?payday_preview=1` (PaydayPlanSection's own
 * `handleTogglePreview`). That fetch can't run in this unauthenticated,
 * static preview, so this state renders `PaydayPlanCard` directly with this
 * fixture item and a no-op `onClose`, rather than the section's real
 * click-to-fetch toggle — see the client's own state-by-state note. */
export const PREVIEW_PLAN_ITEM: CompanionItem = LIVE_PLAN_ITEM;

// ── SafeToSpend fixtures — one per window position this preview needs ────
const BASE_STS = {
  status: "ok" as const,
  safe_to_spend: 685,
  bills_total: 210,
  income_before_payday: 0,
  buffer: 100,
  state: "comfortable" as const,
  estimated: false,
  calculation_status: "complete" as const,
};

/** `home-t5` — five days before payday, the earliest the entry row opens
 * (lib/paydayWindow.ts: 1..5 inclusive). */
export const STS_T5: SafeToSpend = {
  ...BASE_STS,
  next_payday: "2026-09-30",
  days_until_payday: 5,
};

/** `home-live` — inside the live-plan window (days_into_period <= 3 of the
 * NEW period backend-side); the exact `days_until_payday` value doesn't
 * gate this state, `hasLivePlan` (an item being present) does. */
export const STS_LIVE: SafeToSpend = {
  ...BASE_STS,
  next_payday: "2026-10-28",
  days_until_payday: 27,
};

/** `home-paid` — well inside the new period, no live plan any more (the
 * standing-orders/hand-actioned case has already resolved and the backend
 * emits nothing further) — outside the T-5-days window and with no item,
 * `isPaydayWindowActive` is false, so `PaydayPlanSection` mounts to null. */
export const STS_PAID: SafeToSpend = {
  ...BASE_STS,
  next_payday: "2026-10-28",
  days_until_payday: 25,
};

/** `penny-entry` / `penny-expanded` — deliberately mid-period (nowhere near
 * the T-5 window) to demonstrate Penny's entry row has no `gate`, so it
 * shows all month, not just in the run-up to payday. */
export const STS_MID_PERIOD: SafeToSpend = {
  ...BASE_STS,
  next_payday: "2026-10-15",
  days_until_payday: 19,
};

/** `penny-next` — a payday roughly a month further out again, standing in
 * for "the moment right after the previous payday's salary was observed":
 * the entry row's subline always names `safeToSpend.next_payday`, so this
 * fixture demonstrates it has already rolled to the FOLLOWING payday. */
export const STS_NEXT_PAYDAY: SafeToSpend = {
  ...BASE_STS,
  next_payday: "2026-10-28",
  days_until_payday: 25,
};
