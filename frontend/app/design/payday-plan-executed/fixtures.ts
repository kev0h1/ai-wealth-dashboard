import type { CompanionItem } from "@/lib/api";

// G164 — Kevin's real payday-morning payload, Friday 25 September 2026 (see
// board notes on G164). Kevin authorises these figures in this public
// preview (feedback_real_data_in_design_previews): salary £4,798.08 landed
// 00:29 into Premier Current Account (Barclays); seven standing orders fired
// the same night totalling £3,170; the PLAN itself only legged out £2,725
// to 3 destination accounts — the understating figure this round exists to
// fix (item 4 of the brief). Do not round or "clean up" any of these
// numbers, they are the evidence.

/**
 * The item as companion.py already emits it today: `dests`/`total` are the
 * PLAN's own legs (£2,725 to 3 accounts), not what actually moved. `salary`
 * still carries the pre-credit shape (no landed time). This is what the
 * production ExecutedPaydayRow/PaydayPlanCard renders unmodified — the
 * "Today" reference each variant's client shows for comparison.
 */
export const EXECUTED_ITEM: CompanionItem = {
  id: "design-g164-executed",
  type: "payday_plan",
  headline: "Payday plan: split £2,725 across 3 accounts",
  body: "A tight month: buffers trimmed so every payment is covered. £2,725 distributed.",
  action: { label: "See what's due ›", route: "/upcoming" },
  estimated: false,
  covered: false,
  executed: true,
  total: 2725,
  trimmed: true,
  salary: {
    account_id: "salary-barclays-premier",
    name: "Premier Current Account",
    provider: "Barclays",
    amount: 4798.08,
    stays: 0,
  },
  dests: [
    {
      account_id: "dest-hsbc-maingi",
      name: "MAINGI K M",
      provider: "HSBC",
      balance: 1200,
      bills_total: 1614,
      bill_count: 4,
      spend_typical: 0,
      buffer: 0,
      target: 1805,
      move: 1805,
      usual: 1695,
    },
    {
      account_id: "dest-natwest-numberone",
      name: "THE NUMBER ONE",
      provider: "NatWest",
      balance: 900,
      bills_total: 810,
      bill_count: 11,
      spend_typical: 20,
      buffer: 0,
      target: 830,
      move: 830,
      usual: 910,
    },
    {
      account_id: "dest-monzo-kevin",
      name: "Kevin Mbithi Maingi",
      provider: "Monzo",
      balance: 300,
      bills_total: 7,
      bill_count: 1,
      spend_typical: 83,
      buffer: 0,
      target: 90,
      move: 90,
      usual: 833,
    },
  ],
};

/**
 * What actually moved: INVENTED shape for this preview only (no API
 * contract exists yet — the counting-fix backend change is folded in after
 * Kevin's pick, per CLAUDE.md's "Design work" section). Seven standing
 * orders that fired overnight Fri 25 Sep, summing to exactly £3,170 — the
 * figure the executed row and expanded receipt should report instead of
 * the plan's own £2,725/3. The first three rows are the same destination
 * accounts the plan itself legged out (same amounts); the other four are
 * bill/payee standing orders the plan's own `dests` list never modelled
 * (it only tracks transfers to Kevin's OWN accounts), which is the actual
 * root of the undercount.
 */
export type ActualMove = { name: string; note?: string; amount: number; isOwnAccount?: boolean };

export const ACTUAL_MOVES: ActualMove[] = [
  { name: "MAINGI K M", note: "HSBC · bills & buffer", amount: 1805, isOwnAccount: true },
  { name: "THE NUMBER ONE", note: "NatWest · bills & buffer", amount: 830, isOwnAccount: true },
  { name: "Kevin Mbithi Maingi", note: "Monzo · spending", amount: 90, isOwnAccount: true },
  { name: "Camden Council", note: "Council tax", amount: 210 },
  { name: "MotoFinance", note: "Car finance", amount: 145 },
  { name: "PureGym", note: "Membership", amount: 45 },
  { name: "Starling Saver", note: "Savings pot", amount: 45 },
];

export const ACTUAL_TOTAL = ACTUAL_MOVES.reduce((sum, m) => sum + m.amount, 0); // 3170
export const ACTUAL_COUNT = ACTUAL_MOVES.length; // 7
export const LANDED_AT = "00:29";
export const LANDED_DATE = "Fri 25 Sep";
export const SALARY_AMOUNT = 4798.08;
export const STAYS_AFTER = Math.round(SALARY_AMOUNT - ACTUAL_TOTAL); // ~1628
