// TEMPORARY PREVIEW fixtures for /design/spend-shape — delete after design
// review. See SpendShapeClient.tsx for the full brief this route answers.
//
// Owner brief (2026-09-05, verbatim figures): the August money shape is
// take-home split Fixed £2,836 (47%), Moved to savings £922 (15%), Free
// spending £2,322 (38%), Beyond take-home £1,141; verdict "Of every £100
// you take home, £47 was spoken for before you chose anything, and spending
// went £1,141 past what came in."; trend line "Fixed share is up 4 points
// over six pay periods." None of the keys in
// app/design/insights-live/fixtures.ts's MONEY_SHAPE_FIXTURES carry these
// exact numbers (its own "overspent" key is a different, earlier example),
// so this file builds its own MoneyShape fixture instead, shaped
// field-for-field like shared/src/types.ts's MoneyShape contract and
// following the same overspent-branch conventions as that file's
// MONEY_SHAPE_OVERSPENT: shares are computed over fixed+moved+free only
// (2836+922+2322=6080; take_home = 6080 − 1141 overspent = 4939), with
// largest-remainder apportionment (raw 46.64/15.16/38.19 → floors
// 46/15/38, sum 99, the one spare point goes to fixed's largest remainder
// → 47/15/38, sum 100) and the "left" job pinned to amount 0 / share 0 in
// the overspent branch. That 0-share pin used to be the source of a live
// bug (fixed 2026-09-05, see MoneyShapeHero.tsx's `overspentHere` branch):
// the hero's "Beyond take-home" row showed the real £1,141 overspend figure
// right next to that job's own 0%, because the AMOUNT swapped in
// `entry.overspent` but the row's own percentage cell never did. The row
// now reads "over" instead of a percentage on this branch.
//
// Five historical periods (Mar-Jul) are invented (not owner-supplied) so
// MoneyShapeHero's period picker and WhatWorksCard's evidence table have
// something real to render — take_home held flat at £4,939 across all six
// periods for simplicity, fixed share stepping 43→47 so trend.fixed's
// first-to-last delta is exactly 4, matching the owner's trend_line
// verbatim.
import type { MoneyShape, MoneyShapePeriodEntry, MoneyShapeAverageEntry } from "@/lib/api";

const TAKE_HOME = 4939; // 6080 (fixed+moved+free) − 1141 (overspent)

const FIXED_CATEGORIES = ["Bills", "Rent", "Debt Repayment"];
const MOVED_CATEGORIES = ["Savings", "Investment"];
const FREE_CATEGORIES = ["Groceries", "Eating Out", "Shopping", "Entertainment"];
const LEFT_CATEGORIES = ["Income"];

function jobs(
  fixed: { amount: number; share: number },
  moved: { amount: number; share: number },
  free: { amount: number; share: number },
  left: { amount: number; share: number }
) {
  return [
    { id: "fixed" as const, label: "Fixed (bills, debt, rent)", amount: fixed.amount, share: fixed.share, categories: FIXED_CATEGORIES, txn_type: "debit" as const },
    { id: "moved" as const, label: "Moved to savings", amount: moved.amount, share: moved.share, categories: MOVED_CATEGORIES, txn_type: "debit" as const },
    { id: "free" as const, label: "Free spending", amount: free.amount, share: free.share, categories: FREE_CATEGORIES, txn_type: "debit" as const },
    { id: "left" as const, label: "Left over", amount: left.amount, share: left.share, categories: LEFT_CATEGORIES, txn_type: "credit" as const },
  ];
}

// Newest first, per MoneyShape["periods"]'s own contract.
const PERIODS: MoneyShapePeriodEntry[] = [
  {
    start: "2026-07-28", end: "2026-08-27", label: "28 Jul to 27 Aug",
    take_home: TAKE_HOME, overspent: 1141,
    jobs: jobs({ amount: 2836, share: 47 }, { amount: 922, share: 15 }, { amount: 2322, share: 38 }, { amount: 0, share: 0 }),
    verdict: "Of every £100 you take home, £47 was spoken for before you chose anything, and spending went £1,141 past what came in.",
  },
  {
    start: "2026-06-28", end: "2026-07-27", label: "28 Jun to 27 Jul",
    take_home: TAKE_HOME, overspent: 0,
    jobs: jobs({ amount: 2272, share: 46 }, { amount: 741, share: 15 }, { amount: 1679, share: 34 }, { amount: 247, share: 5 }),
    verdict: "Of every £100 you take home, £46 is spoken for before you choose anything. £34 is yours to spend freely.",
  },
  {
    start: "2026-05-28", end: "2026-06-27", label: "28 May to 27 Jun",
    take_home: TAKE_HOME, overspent: 0,
    // free dropped 1729 -> 1728 so 2223+741+1728+247 sums exactly to
    // TAKE_HOME (4939), not 4940 — the review fix (2026-09-05).
    jobs: jobs({ amount: 2223, share: 45 }, { amount: 741, share: 15 }, { amount: 1728, share: 35 }, { amount: 247, share: 5 }),
    verdict: "Of every £100 you take home, £45 is spoken for before you choose anything. £35 is yours to spend freely.",
  },
  {
    start: "2026-04-28", end: "2026-05-27", label: "28 Apr to 27 May",
    take_home: TAKE_HOME, overspent: 0,
    jobs: jobs({ amount: 2223, share: 45 }, { amount: 790, share: 16 }, { amount: 1679, share: 34 }, { amount: 247, share: 5 }),
    verdict: "Of every £100 you take home, £45 is spoken for before you choose anything. £34 is yours to spend freely.",
  },
  {
    start: "2026-03-28", end: "2026-04-27", label: "28 Mar to 27 Apr",
    take_home: TAKE_HOME, overspent: 0,
    jobs: jobs({ amount: 2173, share: 44 }, { amount: 790, share: 16 }, { amount: 1729, share: 35 }, { amount: 247, share: 5 }),
    verdict: "Of every £100 you take home, £44 is spoken for before you choose anything. £35 is yours to spend freely.",
  },
  {
    start: "2026-02-28", end: "2026-03-27", label: "28 Feb to 27 Mar",
    take_home: TAKE_HOME, overspent: 0,
    // free dropped 1729 -> 1728 so 2124+840+1728+247 sums exactly to
    // TAKE_HOME (4939), not 4940 — the review fix (2026-09-05).
    jobs: jobs({ amount: 2124, share: 43 }, { amount: 840, share: 17 }, { amount: 1728, share: 35 }, { amount: 247, share: 5 }),
    verdict: "Of every £100 you take home, £43 is spoken for before you choose anything. £35 is yours to spend freely.",
  },
];

// delta = 47 − 43 = 4 (>= 3) → matches the owner's own trend_line verbatim.
const TREND = {
  periods: ["Mar", "Apr", "May", "Jun", "Jul", "Aug"],
  fixed: [43, 44, 45, 45, 46, 47],
  moved: [17, 16, 16, 15, 15, 15],
  free: [35, 35, 34, 35, 34, 38],
  left: [5, 5, 5, 5, 5, 0],
};

// calm_start evidence: hit periods (calm start) = Mar, Apr, May, Jun, Aug
// (5), of which left_over > 0 for Mar/Apr/May/Jun (4) and NOT for Aug
// (current, overspent −1141) — k=4, hit_n=5, matching WhatWorksCard's own
// headline template exactly ("...4 times out of 5."). Jul is the lone
// "fast" miss.
const WHAT_WORKS = {
  state: "ok" as const,
  periods_available: 6,
  periods_needed: 4,
  pattern_id: "calm_start" as const,
  headline: "Pay periods that started calm, under £45 of free spending in the first three days, ended with cash left over 4 times out of 5.",
  flag_labels: { hit: "calm", miss: "fast" },
  evidence: [
    { period: "Mar", flag: "hit" as const, left_over: 247 },
    { period: "Apr", flag: "hit" as const, left_over: 247 },
    { period: "May", flag: "hit" as const, left_over: 247 },
    { period: "Jun", flag: "hit" as const, left_over: 247 },
    { period: "Jul", flag: "miss" as const, left_over: -95 },
    { period: "Aug", flag: "hit" as const, left_over: -1141 },
  ],
  trait: { id: "fast_start", title: "you often spend fast in the first three days", choice: "change" as const },
  proposal: {
    headline: "Give the first three days a number?",
    body: "Your calm starts ended with cash left over more often. Penny can help you set a first-week allocation in Planning, you approve before anything moves.",
    penny_ask: "Help me set an allocation for the first week of my pay period",
  },
};

// Two `averages` entries (review fix, 2026-09-05) so MoneyShapeHero's
// averages scope control has something real to select. Mean-per-pay-period
// amounts computed by hand off PERIODS above (a real backend computes these
// server-side; this fixture hand-derives them once so the numbers stay
// internally consistent with PERIODS rather than being invented
// separately). Both windows apply the same largest-remainder share
// convention already used elsewhere in this file:
//   3 months (Jun, Jul, Aug): fixed mean (2836+2272+2223)/3=2443.67->2444,
//   moved (922+741+741)/3=801.33->801, free (2322+1679+1728)/3=1909.67->1910
//   -- these three sum to 5155, ABOVE take_home (4939), so this window is
//   itself overspent on average (Aug's own overspend dominates a 3-period
//   mean): shares computed over fixed+moved+free only (2444/5155=47.41%->47,
//   801/5155=15.54%->16, 1910/5155=37.05%->37, summing to exactly 100),
//   "left" pinned to amount 0 / share 0, same overspent-branch convention as
//   PERIODS[0] (Aug) above; overspent = 5155-4939 = 216.
//   6 months (Mar-Aug): fixed mean (2836+2272+2223+2223+2173+2124)/6=
//   13851/6=2308.5->2309, moved (922+741+741+790+790+840)/6=4824/6=804,
//   free (2322+1679+1728+1679+1729+1728)/6=10865/6=1810.83->1811 -- these
//   three sum to 4924, BELOW take_home (4939), so this window is NOT
//   overspent on average (only 1 of 6 periods was): shares computed over
//   take_home as normal (2309/4939=46.75%->47, 804/4939=16.28%->16,
//   1811/4939=36.67%->37, left (4939-4924=15)/4939=0.30%->0, summing to
//   exactly 100); overspent 0.
const AVERAGES: MoneyShapeAverageEntry[] = [
  {
    months: 3, period_count: 3,
    start: "2026-05-28", end: "2026-08-27",
    take_home: TAKE_HOME, overspent: 216,
    jobs: jobs({ amount: 2444, share: 47 }, { amount: 801, share: 16 }, { amount: 1910, share: 37 }, { amount: 0, share: 0 }),
    verdict: "Over the last 3 pay periods, £47 of every £100 you took home was spoken for before you chose anything, and spending averaged £216 past what came in.",
  },
  {
    months: 6, period_count: 6,
    start: "2026-02-28", end: "2026-08-27",
    take_home: TAKE_HOME, overspent: 0,
    jobs: jobs({ amount: 2309, share: 47 }, { amount: 804, share: 16 }, { amount: 1811, share: 37 }, { amount: 15, share: 0 }),
    verdict: "Over the last 6 pay periods, £47 of every £100 you took home was spoken for before you chose anything. £37 was yours to spend freely.",
  },
];

export const SPEND_SHAPE: MoneyShape = {
  status: "ok",
  computed_at: "2026-09-05T06:00:00.000000Z",
  period: { start: PERIODS[0].start, end: PERIODS[0].end, label: PERIODS[0].label },
  take_home: PERIODS[0].take_home,
  overspent: PERIODS[0].overspent,
  jobs: PERIODS[0].jobs,
  verdict: PERIODS[0].verdict,
  trend: TREND,
  trend_line: "Fixed share is up 4 points over six pay periods.",
  what_works: WHAT_WORKS,
  periods: PERIODS,
  averages: AVERAGES,
};
