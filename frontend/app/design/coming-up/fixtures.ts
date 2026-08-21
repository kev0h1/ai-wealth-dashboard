// TEMPORARY PREVIEW — delete after design review.
//
// Fixture data for /design/coming-up — three redesign directions for the
// Home "Coming up" card (UpcomingBillsStrip.tsx). Two scenarios:
//
//  - BUSY_BILLS: mirrors the real screenshot that exposed the bugs (2 due
//    today, 1 tomorrow, 17 more within 14 days, £686 total out).
//  - QUIET_BILLS: a genuinely calm week (nothing today or tomorrow, 4 bills,
//    £132 total) — the state where the live card's amber-everywhere styling
//    is most wrong, since nothing here is a caution at all.
//
// One income item is included in BUSY only, and deliberately excluded from
// every count/total below it — this is the fix for the live component's
// bug where `all` (bills + income) fed the today/tomorrow pill counts while
// `totalBillAmount` summed bills only, so "2 due today" could silently
// include a salary landing, not a bill. This card's job is the shape of
// money going OUT; income belongs to Safe to Spend / Payday Plan elsewhere
// on Home (see DESIGN.md "Flows vs Positions").
//
// The bill-list shape and the dailyTotals/dueToday/totalOut/fmt/fmtSum
// helpers below now live in lib/comingUp.tsx, shared with the live card —
// FixtureBill is a straight alias so this file's data literals stay
// unchanged.

import type { ComingUpBill } from "@/lib/comingUp";
export { dailyTotals, dueToday, totalOut, fmt, fmtSum } from "@/lib/comingUp";

export type FixtureBill = ComingUpBill;

export type FixtureIncome = {
  name: string;
  amount: number;
  daysAway: number;
  date: string;
};

// Anchored to "today" = Wed 19 Aug 2026, matching the porting-checkpoint date.
export const BUSY_BILLS: FixtureBill[] = [
  { name: "Netflix", amount: 15.99, daysAway: 0, date: "Wed 19 Aug" },
  { name: "Council Tax", amount: 142.0, daysAway: 0, date: "Wed 19 Aug" },
  { name: "Sky Mobile", amount: 38.0, daysAway: 1, date: "Thu 20 Aug" },
  { name: "Spotify", amount: 11.99, daysAway: 2, date: "Fri 21 Aug" },
  { name: "Virgin Active Gym", amount: 34.99, daysAway: 2, date: "Fri 21 Aug" },
  { name: "Amazon Prime", amount: 8.99, daysAway: 3, date: "Sat 22 Aug" },
  { name: "Admiral Car Insurance", amount: 64.5, daysAway: 4, date: "Sun 23 Aug" },
  { name: "EE Phone Contract", amount: 42.0, daysAway: 5, date: "Mon 24 Aug" },
  { name: "Thames Water", amount: 29.5, daysAway: 6, date: "Tue 25 Aug" },
  { name: "Home Insurance", amount: 18.2, daysAway: 6, date: "Tue 25 Aug" },
  { name: "Octopus Electricity", amount: 55.0, daysAway: 7, date: "Wed 26 Aug" },
  { name: "Octopus Gas", amount: 47.3, daysAway: 8, date: "Thu 27 Aug" },
  { name: "BT Broadband", amount: 32.0, daysAway: 9, date: "Fri 28 Aug" },
  { name: "Car Park Permit", amount: 15.0, daysAway: 9, date: "Fri 28 Aug" },
  { name: "Disney+", amount: 7.99, daysAway: 10, date: "Sat 29 Aug" },
  { name: "Pet Insurance", amount: 24.0, daysAway: 11, date: "Sun 30 Aug" },
  { name: "Charity Direct Debit", amount: 17.31, daysAway: 11, date: "Sun 30 Aug" },
  { name: "Student Loan", amount: 55.0, daysAway: 12, date: "Mon 31 Aug" },
  { name: "TV Licence", amount: 13.25, daysAway: 13, date: "Tue 1 Sep" },
  { name: "YouTube Premium", amount: 12.99, daysAway: 13, date: "Tue 1 Sep" },
];
// 20 bills, £686.00 total. today=2, tomorrow=1, later=17 (later + today +
// tomorrow = 20, matching the real 14-day window instead of the live bug's
// "17 bills" headline that silently dropped the 3 due today/tomorrow).

export const BUSY_INCOME: FixtureIncome[] = [
  { name: "Salary · Acme Ltd", amount: 2400.0, daysAway: 0, date: "Wed 19 Aug" },
];
// Deliberately unused by all three variants below — proves income no longer
// leaks into the "2 due today" style pill.

export const QUIET_BILLS: FixtureBill[] = [
  { name: "Netflix", amount: 15.99, daysAway: 3, date: "Sat 22 Aug" },
  { name: "Spotify", amount: 11.99, daysAway: 5, date: "Mon 24 Aug" },
  { name: "Gym Membership", amount: 34.99, daysAway: 8, date: "Thu 27 Aug" },
  { name: "Council Tax", amount: 69.03, daysAway: 11, date: "Sun 30 Aug" },
];
// 4 bills, £132.00 total, nothing due today or tomorrow.

export const QUIET_INCOME: FixtureIncome[] = [];

// HEAVY_BILLS mirrors what the real live "Coming up" card actually shows
// today (29 bills, £4,173 total, 2 due today, 1 tomorrow) — the D/E/F
// "brand metaphor" variants get exercised at this scale too, because a
// design that reads cleanly at BUSY's 20 bills / £686 can still fall apart
// once a mortgage and nursery fees land in the same fortnight. Amounts sum
// to exactly £4,173.00 (verified by script, not hand-added).
export const HEAVY_BILLS: FixtureBill[] = [
  { name: "Council Tax", amount: 142.0, daysAway: 0, date: "Wed 19 Aug" },
  { name: "Netflix", amount: 15.99, daysAway: 0, date: "Wed 19 Aug" },
  { name: "Sky Mobile", amount: 38.0, daysAway: 1, date: "Thu 20 Aug" },
  { name: "Spotify", amount: 11.99, daysAway: 2, date: "Fri 21 Aug" },
  { name: "Virgin Active Gym", amount: 34.99, daysAway: 2, date: "Fri 21 Aug" },
  { name: "Amazon Prime", amount: 8.99, daysAway: 3, date: "Sat 22 Aug" },
  { name: "Car Finance", amount: 397.03, daysAway: 3, date: "Sat 22 Aug" },
  { name: "Admiral Car Insurance", amount: 64.5, daysAway: 4, date: "Sun 23 Aug" },
  { name: "Life Insurance", amount: 45.0, daysAway: 4, date: "Sun 23 Aug" },
  { name: "Mortgage", amount: 1850.0, daysAway: 5, date: "Mon 24 Aug" },
  { name: "EE Phone Contract", amount: 42.0, daysAway: 5, date: "Mon 24 Aug" },
  { name: "Thames Water", amount: 29.5, daysAway: 6, date: "Tue 25 Aug" },
  { name: "Home Insurance", amount: 18.2, daysAway: 6, date: "Tue 25 Aug" },
  { name: "Credit Card Min Payment", amount: 85.0, daysAway: 6, date: "Tue 25 Aug" },
  { name: "Octopus Electricity", amount: 95.0, daysAway: 7, date: "Wed 26 Aug" },
  { name: "Nursery Fees", amount: 870.0, daysAway: 7, date: "Wed 26 Aug" },
  { name: "Octopus Gas", amount: 87.3, daysAway: 8, date: "Thu 27 Aug" },
  { name: "Gym Partner", amount: 22.0, daysAway: 8, date: "Thu 27 Aug" },
  { name: "BT Broadband", amount: 32.0, daysAway: 9, date: "Fri 28 Aug" },
  { name: "Car Park Permit", amount: 15.0, daysAway: 9, date: "Fri 28 Aug" },
  { name: "Disney+", amount: 7.99, daysAway: 10, date: "Sat 29 Aug" },
  { name: "Apple iCloud", amount: 2.99, daysAway: 10, date: "Sat 29 Aug" },
  { name: "Pet Insurance", amount: 24.0, daysAway: 11, date: "Sun 30 Aug" },
  { name: "Charity Direct Debit", amount: 17.31, daysAway: 11, date: "Sun 30 Aug" },
  { name: "Student Loan", amount: 155.0, daysAway: 12, date: "Mon 31 Aug" },
  { name: "Water Softener Rental", amount: 14.99, daysAway: 12, date: "Mon 31 Aug" },
  { name: "TV Licence", amount: 13.25, daysAway: 13, date: "Tue 1 Sep" },
  { name: "YouTube Premium", amount: 12.99, daysAway: 13, date: "Tue 1 Sep" },
  { name: "Boiler Cover", amount: 19.99, daysAway: 13, date: "Tue 1 Sep" },
];
// 29 bills, £4,173.00 total. today=2, tomorrow=1.

// totalOut/dueToday/dailyTotals/fmt/fmtSum moved to lib/comingUp.tsx and
// re-exported above — kept here as the single source both this preview and
// the live card import from.

export function dueTomorrow(bills: FixtureBill[]): FixtureBill[] {
  return bills.filter((b) => b.daysAway === 1);
}
