import type { CycleStory, MoneyShape, SpendVerdict } from "@/lib/api";

/**
 * Frozen fictional examples for C22 feature captures. These are deliberately
 * separate periods: the closed September review never claims to describe the
 * current 8–30 October spending view.
 */
export const INSIGHT_STORY: CycleStory = {
  status: "ok",
  early_days: false,
  period: { start: "2026-09-01", end: "2026-09-30", closed: true, days_elapsed: 30, days_to_payday: 0 },
  chapters: {
    opening: { income_in: 2400, count: 1 },
    cliff: { week1_spend: 360, period_spend: 1800, week1_pct: 20, commitments: [{ payee: "Rent", total: 820 }] },
    spending: {
      total_spend: 1800,
      income_in: 2400,
      top_categories: [
        { category: "Rent", total: 820 },
        // The real StoryPlayer ranks and displays its first five rows. All
        // seven source categories remain here so its total is auditable:
        // fixed £1,200 (Rent/Bills/Groceries/Transport) + free £600
        // (Shopping/Eating Out/Entertainment) = £1,800 spent.
        { category: "Shopping", total: 240 },
        { category: "Eating Out", total: 200 },
        { category: "Bills", total: 180 },
        { category: "Entertainment", total: 160 },
        { category: "Groceries", total: 140 },
        { category: "Transport", total: 60 },
      ],
    },
    cards: { present: false, material: false, new_spend: 0, payments: 0, delta: 0, share_of_spend: 0 },
    moves: {
      card_feeding: { count: 0, total: 0 },
      ritual_saving: { count: 1, total: 400 },
      deliberate_saving: { count: 0, total: 0 },
      buffer_draws: { count: 0, total: 0 },
      other_shuffles: { count: 0, total: 0 },
    },
    keeping: { set_aside: 400, drawn_back: 0, external: 0, kept: 400 },
    close: { month_end_cash: 200, card_delta: 0, streak_weeks: 4 },
    self_facts: { traits: [], fired: {} },
  },
  narrative: {
    opening: "£2,400 came in during September.",
    month: "£1,800 was spent during September.",
    moves: "£400 went to savings separately.",
    keeping: "You kept the money you set aside.",
    close: "September closed with £200 in cash.",
    self: "",
    source: "fictional-c22-feature-capture",
  },
  cards_link: false,
  is_preview: false,
  is_demo: true,
};

/** Current 8–30 October period. The header only reads these server-shaped
 * figures; £860 Out + £400 Moved is reconciled independently from September.
 */
export const SPEND_VERDICT: SpendVerdict = {
  state: "normal",
  reading: "Your spending is in line with your usual pace.",
  notables: [],
  quiet_flags: [],
  majority: [],
  unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
  moved: [{ kind: "pots", label: "Moved to savings", amount: 400, payments_count: 1, categories: ["Savings"] }],
  pills: { spent: 860, income: 2400, net: 1540 },
  period: { start: "2026-10-08", end: "2026-10-30", days_elapsed: 10, days_left: 12, offset: 0, closed: false },
  pace_series: [{ day: 10, actual: 860, usual: 850 }],
  moved_total: 400,
  unresolved_total: 0,
  unresolved_material: false,
  impact: null,
};

const jobs = [
  { id: "fixed" as const, label: "Fixed", amount: 1200, share: 50, categories: ["Rent", "Bills", "Groceries", "Transport"], txn_type: "debit" as const, drivers: [{ category: "Rent", amount: 820 }, { category: "Bills", amount: 180 }, { category: "Groceries", amount: 140 }, { category: "Transport", amount: 60 }] },
  { id: "moved" as const, label: "Moved", amount: 400, share: 17, categories: ["Savings"], txn_type: "debit" as const, drivers: [{ category: "Savings", amount: 400 }] },
  { id: "free" as const, label: "Free", amount: 600, share: 25, categories: ["Shopping", "Eating Out", "Entertainment"], txn_type: "debit" as const, drivers: [{ category: "Shopping", amount: 240 }, { category: "Eating Out", amount: 200 }, { category: "Entertainment", amount: 160 }] },
  { id: "left" as const, label: "Left over", amount: 200, share: 8, categories: ["Income"], txn_type: "credit" as const, drivers: [{ category: "Income remaining", amount: 200 }] },
];

/** A completed period for the money-shape engine. Actual flows are £2,200,
 * leaving £200 unspent; the 50/30/20 guide is separately £1,200/£720/£480.
 */
export const MONEY_SHAPE: MoneyShape = {
  status: "ok",
  computed_at: "2026-10-01T09:00:00.000Z",
  period: { start: "2026-09-01", end: "2026-09-30", label: "1 Sep to 30 Sep" },
  take_home: 2400,
  overspent: 0,
  total_out: 2200,
  beyond: 0,
  beyond_source: null,
  card_growth: 0,
  savings_drawdown: 0,
  jobs,
  verdict: "Of every £100 you took home, £50 was spoken for before you chose anything. £25 was yours to spend freely.",
  periods: [{ start: "2026-09-01", end: "2026-09-30", label: "1 Sep to 30 Sep", take_home: 2400, overspent: 0, total_out: 2200, beyond: 0, beyond_source: null, card_growth: 0, savings_drawdown: 0, jobs, verdict: "Of every £100 you took home, £50 was spoken for before you chose anything. £25 was yours to spend freely." }],
  averages: [],
  trend: { periods: ["Apr", "May", "Jun", "Jul", "Aug", "Sep"], fixed: [49, 50, 48, 51, 50, 50], moved: [14, 15, 16, 15, 17, 17], free: [27, 26, 28, 25, 25, 25], left: [10, 9, 8, 9, 8, 8] },
  trend_line: "Your fixed share has stayed steady across six pay periods.",
  what_works: { state: "no_pattern", periods_available: 6, periods_needed: 4, pattern_id: null, headline: "No clear pattern yet across 6 pay periods.", flag_labels: null, evidence: [], trait: null, proposal: null },
};

/** Current 8–30 October Spend detail. This is not the closed September
 * money-shape example above: it exists solely to show the same period as the
 * Spend pace proof in a different production component. £860 spent is Fixed
 * plus Free; the £400 movement is reported separately, leaving £1,140.
 */
const octJobs = [
  { id: "fixed" as const, label: "Fixed", amount: 560, share: 23, categories: ["Bills", "Groceries", "Transport"], txn_type: "debit" as const, drivers: [{ category: "Bills", amount: 260 }, { category: "Groceries", amount: 180 }, { category: "Transport", amount: 120 }] },
  { id: "moved" as const, label: "Moved", amount: 400, share: 17, categories: ["Savings"], txn_type: "debit" as const, drivers: [{ category: "Savings", amount: 400 }] },
  { id: "free" as const, label: "Free", amount: 300, share: 13, categories: ["Shopping", "Eating Out", "Entertainment"], txn_type: "debit" as const, drivers: [{ category: "Shopping", amount: 150 }, { category: "Eating Out", amount: 90 }, { category: "Entertainment", amount: 60 }] },
  { id: "left" as const, label: "Left over", amount: 1140, share: 47, categories: ["Income"], txn_type: "credit" as const, drivers: [{ category: "Income remaining", amount: 1140 }] },
];

export const OCT_SHAPE: MoneyShape = {
  status: "ok",
  computed_at: "2026-10-18T09:00:00.000Z",
  period: { start: "2026-10-08", end: "2026-10-30", label: "8 Oct to 30 Oct" },
  take_home: 2400,
  overspent: 0,
  total_out: 1260,
  beyond: 0,
  beyond_source: null,
  card_growth: 0,
  savings_drawdown: 0,
  jobs: octJobs,
  verdict: "Of every £100 you took home, £23 was spoken for before you chose anything. £13 was yours to spend freely.",
  periods: [{ start: "2026-10-08", end: "2026-10-30", label: "8 Oct to 30 Oct", take_home: 2400, overspent: 0, total_out: 1260, beyond: 0, beyond_source: null, card_growth: 0, savings_drawdown: 0, jobs: octJobs, verdict: "Of every £100 you took home, £23 was spoken for before you chose anything. £13 was yours to spend freely." }],
  averages: [],
  trend: { periods: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"], fixed: [22, 24, 23, 25, 24, 23], moved: [15, 16, 17, 15, 16, 17], free: [15, 14, 13, 15, 14, 13], left: [48, 46, 47, 45, 46, 47] },
  trend_line: "Your fixed share is lower than your last completed period.",
  what_works: { state: "no_pattern", periods_available: 6, periods_needed: 4, pattern_id: null, headline: "No clear pattern yet across 6 pay periods.", flag_labels: null, evidence: [], trait: null, proposal: null },
};
