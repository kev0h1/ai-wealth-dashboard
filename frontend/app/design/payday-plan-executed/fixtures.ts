// G164 — Kevin's real payday-morning payload, Friday 25 September 2026 (see
// board notes on G164). Kevin authorises these figures in this public
// preview (feedback_real_data_in_design_previews): salary £4,798.08 landed
// 00:29 into Premier Current Account (Barclays); seven standing orders fired
// the same night totalling £3,170. Only the £3,170 total, the 7 count, the
// £4,798.08 salary and the landed time/date are real. The PER-ACCOUNT split
// below is NOT on the board — companion.py has no record of which account
// got how much, only the plan's own understated £2,725/3 legs — so every
// row here is an ILLUSTRATIVE split across Kevin's known destination
// accounts, sized to sum to the real £3,170 total. Say so wherever this
// data is described (page.tsx's route description, the client's header
// copy): "real total and count, illustrative per-account split". Do not
// round or "clean up" the totals, they are the evidence; the per-row
// amounts are invented and may be adjusted freely as long as they still
// sum to exactly £3,170.

/**
 * What moved: every leg is one of Kevin's OWN accounts, bank-badged and
 * "received" — a payday split is seven standing orders to accounts he
 * holds, never a mix of internal transfers and external bill payments.
 * The first three rows reuse the plan's own three legs (same accounts,
 * same amounts, £2,725 combined) for continuity with the understated
 * total this round fixes; the other four are the accounts the plan's own
 * `dests` list never legged out to, which is the real root of the
 * undercount. `note` is a short, invented reason (bills/spending/buffer),
 * never a repeat of the provider name already carried by the bank badge.
 */
export type ActualMove = { name: string; provider: string; note: string; amount: number };

export const ACTUAL_MOVES: ActualMove[] = [
  { name: "MAINGI K M", provider: "HSBC", note: "bills & buffer", amount: 1805 },
  { name: "THE NUMBER ONE", provider: "NatWest", note: "bills & buffer", amount: 830 },
  { name: "Kevin Mbithi Maingi", provider: "Monzo", note: "spending", amount: 90 },
  { name: "Kevin Maingi", provider: "Revolut", note: "spending", amount: 150 },
  { name: "Main G", provider: "Chase", note: "spending", amount: 120 },
  { name: "Personal", provider: "Starling", note: "buffer", amount: 100 },
  { name: "Savings Pot", provider: "Monzo", note: "faster payment", amount: 75 },
];

export const ACTUAL_TOTAL = ACTUAL_MOVES.reduce((sum, m) => sum + m.amount, 0); // 3170
export const ACTUAL_COUNT = ACTUAL_MOVES.length; // 7
export const LANDED_AT = "00:29";
export const LANDED_DATE = "Fri 25 Sep";
export const SALARY_AMOUNT = 4798.08;
export const STAYS_AFTER = Math.round(SALARY_AMOUNT - ACTUAL_TOTAL); // 1628
