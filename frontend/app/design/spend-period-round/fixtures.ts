// TEMPORARY PREVIEW fixtures for /design/spend-period-round — delete after
// design review (G38). One deliberately dense, internally-consistent
// SpendVerdict fixture (not one per state — this round is about layout, not
// state coverage, see /design/spend-live for the five-state set) plus the
// supporting fixtures (accounts, aim signals, savings-tip insight, money
// shape) needed to render the FULL period view end to end: the instrument
// header, the miscategorised-transfers banner, three notables split into a
// hero ("Needs a look") and two "Also running warm" mini-rows (one above the
// 2.0x amber threshold, one below it, so both badge states are visible), a
// material unresolved-ask card, a "Looking normal" majority list with one
// quiet-flagged (amber "above usual") row and one zero-spend row, a
// "Money you moved" accordion, and the closing money-shape instrument card —
// the same density brief the ticket asked for, not three tidy rows.
//
// Typed against the real SpendVerdict/SavingsInsight/MoneyShape/Account/
// Checkpoint interfaces (lib/api.ts, shared/src/types.ts) so a payload-shape
// drift fails `tsc --noEmit` here, not silently later. Reconciliation
// invariant (notables + majority + unresolved = pills.spent) is asserted at
// the bottom, same convention as /design/spend-live/fixtures.ts.

import type {
  Account,
  Checkpoint,
  MoneyShape,
  SavingsInsight,
  SpendVerdict,
  SpendVerdictPaceEntry,
  Transaction,
} from "@/lib/api";

function linearSeries(days: number, actualFinal: number, usualFinal: number | null): SpendVerdictPaceEntry[] {
  const series: SpendVerdictPaceEntry[] = [];
  for (let day = 1; day <= days; day++) {
    series.push({
      day,
      actual: Math.round((actualFinal * day) / days),
      usual: usualFinal === null ? null : Math.round((usualFinal * day) / days),
    });
  }
  if (series.length > 0) series[series.length - 1] = { ...series[series.length - 1], actual: actualFinal };
  return series;
}

export const PREVIEW_ACCOUNTS: Account[] = [
  {
    id: "fixture-account-barclays",
    name: "Barclays Premier",
    type: "current",
    balance: 1820.4,
    currency: "GBP",
    provider: "Barclays",
    status: "active",
  },
];

export const PREVIEW_INCOME_TXNS: Transaction[] = [
  {
    id: "fixture-income-salary",
    account_id: "fixture-account-barclays",
    date: "2026-07-31",
    amount: 2650,
    currency: "GBP",
    description: "ACME CORP LTD PAYROLL",
    merchant_name: "Acme Corp",
    category: "Income",
    transaction_type: "credit",
  },
];

// Aim/checkpoint signals — Bills (the hero) gets the manual "Set an aim"
// offer (no checkpoint yet); Eating Out (an amber warm row) has one already
// running, so both AimBlock states are reachable from this one fixture.
export const PREVIEW_SIGNALS: Record<string, { suggested_aim: number | null; checkpoint: Checkpoint | null }> = {
  Bills: { suggested_aim: 900, checkpoint: null },
  "Eating Out": {
    suggested_aim: 180,
    checkpoint: { id: "fixture-checkpoint-eating-out", aim_amount: 180, spent_so_far: 340, days_left: 15, on_track: false },
  },
};

// Two savings-tip insights — one costed (Eating Out, single tip, an
// estimate) and one uncosted (Subscriptions, no estimate) — so
// lib/spendTips.ts's tipSubline() demonstrates both its "N tip(s), ~£X/mo"
// and its bare "N tip(s)" forms across the rows that carry them (the "Penny
// noticed" signifier DESIGN.md's 2026-09-05 note moved from a callout card
// into this subline, see openTipsFor/tipSubline; there is no separate
// callout card left on Spend's period view to reproduce here).
export const PREVIEW_INSIGHTS: SavingsInsight[] = [
  {
    id: "fixture-insight-eating-out",
    category: "Eating Out",
    app_category: "Eating Out",
    icon: "utensils",
    label: "Takeaway",
    title: "Deliveroo is now your most frequent takeaway",
    body: "You've ordered Deliveroo 6 times this period, more than any other takeaway. Their delivery fee runs a little higher than Uber Eats for the same restaurants nearby.",
    savings_estimate: "~£28/mo",
    savings_estimate_monthly: 28,
    pinned: false,
    is_new: true,
    refreshed_at: "2026-08-10T09:00:00Z",
    triggered_by: [{ merchant_key: "deliveroo", display_name: "Deliveroo", monthly_amount: 96, occurrences: 6, is_recurring: false }],
    user_context: null,
    has_workflow: false,
    state: "fresh",
  },
  {
    id: "fixture-insight-subscriptions",
    category: "Subscriptions",
    app_category: "Subscriptions",
    icon: "repeat",
    label: "Subscription",
    title: "A second music subscription is running alongside your first",
    body: "Both Spotify and Apple Music have been charging this period. Worth checking whether you still use both.",
    savings_estimate: null,
    savings_estimate_monthly: null,
    pinned: false,
    is_new: false,
    refreshed_at: "2026-08-02T09:00:00Z",
    triggered_by: [{ merchant_key: "apple_music", display_name: "Apple Music", monthly_amount: 11, occurrences: 1, is_recurring: true }],
    user_context: null,
    has_workflow: false,
    state: "fresh",
  },
];

const PERIOD = { start: "2026-07-31", end: "2026-08-27", days_elapsed: 13, days_left: 15, offset: 0, closed: false };

// notablesSum 2080+340+448=2868, majoritySum (nonzero) 421+122+118+115+61+22+5
// =864, unresolved.total 340 -> reconciled 4072 === pills.spent (asserted below).
export const SPEND_VERDICT_FIXTURE: SpendVerdict = {
  state: "normal",
  reading:
    "Running about £1,586 ahead of usual, mostly Bills. You also moved £1,750 to savings and cards.",
  notables: [
    {
      category: "Bills",
      spent: 2080,
      multiple: 2.6,
      excess: 1280,
      payments_count: 14,
      cause: [
        { name: "British Gas", amount: 340 },
        { name: "EDF", amount: 180 },
        { name: "Council Tax", amount: 167 },
      ],
      pace: { spent: 2080, usual_by_now: 800 },
      // Bills' 1,280 excess is 81% of the period's 1,586 total excess (past
      // the 60% "accounts for most of that" threshold), same share-of-total
      // grammar as spend_verdict.py's compute_spend_verdict.
      consequence_line: { text: "Bills alone accounts for most of that." },
    },
    {
      category: "Eating Out",
      spent: 340,
      multiple: 2.1,
      excess: 178,
      payments_count: 11,
      cause: [
        { name: "Deliveroo", amount: 96 },
        { name: "Nando's", amount: 54 },
      ],
      pace: { spent: 340, usual_by_now: 162 },
    },
    {
      // Deliberately BELOW the 2.0x amber threshold (paceBadgeClasses,
      // SpendVerdictView.tsx) — this is what proves the grouped tile shows
      // both a genuine-concern amber row (Eating Out above) and a routine
      // neutral-slate row (this one) side by side, not amber applied to
      // every notable equally.
      category: "Transport",
      spent: 448,
      multiple: 1.4,
      excess: 128,
      payments_count: 22,
      cause: [{ name: "Shell", amount: 210 }],
      pace: { spent: 448, usual_by_now: 320 },
    },
  ],
  quiet_flags: [{ category: "Subscriptions", spent: 122, multiple: 1.6, excess: 30, payments_count: 9 }],
  majority: [
    { category: "Groceries", spent: 421, payments_count: 4, has_baseline: true, elevated: false },
    { category: "Subscriptions", spent: 122, payments_count: 9, has_baseline: true, elevated: true },
    { category: "Travel", spent: 118, payments_count: 4, has_baseline: true, elevated: false },
    { category: "Cash", spent: 115, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Shopping", spent: 61, payments_count: 3, has_baseline: true, elevated: false },
    { category: "Software", spent: 22, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Charity", spent: 5, payments_count: 1, has_baseline: true, elevated: false },
    { category: "Entertainment", spent: 0, payments_count: 0, has_baseline: true, elevated: false },
  ],
  unresolved: {
    total: 340,
    payments_count: 3,
    ask_worthy: true,
    weight: "material",
    largest: {
      id: "fixture-unplaced-1",
      display_name: "Finexer",
      raw_description: "FINEXER LTD OPENBANKINGPAYMENT FT.",
      amount: 210,
      date: "2026-08-06",
      account_id: "fixture-account-barclays",
    },
  },
  moved: [
    { kind: "pots", label: "To your pots", amount: 1450, payments_count: 22, goal_names: ["Japan"], categories: ["Savings"] },
    { kind: "credit_cards", label: "To your credit cards", amount: 300, payments_count: 1, categories: ["Debt"] },
  ],
  pills: { spent: 4072, income: 2650, net: -1422 },
  period: PERIOD,
  pace_series: linearSeries(13, 4072, 2486),
  moved_total: 1750,
  unresolved_total: 340,
  unresolved_material: true,
};

// Miscategorised-transfers guardrail banner fixture — a small nonzero count
// so the body's first quiet card is present (density, not a special state).
export const PREVIEW_MISCATEGORISED_COUNT = 2;
export const PREVIEW_PAIR_COUNT = 0;
export const PREVIEW_REVIEW_TOTAL = 2;

// Closing money-shape instrument — "ok" status (not thin), four jobs summing
// to 100 share, no overspend, so every variant's closing card renders the
// real four-cell instrument rather than the null/thin fallback.
export const PREVIEW_MONEY_SHAPE: MoneyShape = {
  status: "ok",
  computed_at: "2026-08-13T09:00:00Z",
  period: { start: "2026-07-31", end: "2026-08-27", label: "31 Jul to 27 Aug" },
  take_home: 2650,
  overspent: 0,
  jobs: [
    { id: "fixed", label: "Fixed (bills, debt, rent)", amount: 1192, share: 45, categories: ["Bills"], txn_type: "debit" },
    { id: "moved", label: "Moved to savings", amount: 345, share: 13, categories: ["Savings"], txn_type: "debit" },
    { id: "free", label: "Free spending", amount: 795, share: 30, categories: ["Groceries", "Eating Out", "Shopping"], txn_type: "debit" },
    { id: "left", label: "Left over", amount: 318, share: 12, categories: ["Income"], txn_type: "credit" },
  ],
  verdict: "Of every £100 you take home, £45 was spoken for before you chose anything.",
  trend: { periods: [], fixed: [], moved: [], free: [], left: [] },
  trend_line: null,
  what_works: { state: "thin", periods_available: 1, periods_needed: 3, pattern_id: null, headline: "", flag_labels: null, evidence: [], trait: null, proposal: null },
};

function assertFixtureInvariants(v: SpendVerdict): void {
  const notablesSum = v.notables.reduce((s, n) => s + n.spent, 0);
  const majoritySum = v.majority.reduce((s, m) => s + m.spent, 0);
  const reconciled = notablesSum + majoritySum + v.unresolved.total;
  if (reconciled !== v.pills.spent) {
    throw new Error(
      `[spend-period-round/fixtures.ts] reconciliation failed: notables ${notablesSum} + majority ${majoritySum} + unresolved ${v.unresolved.total} = ${reconciled}, but pills.spent = ${v.pills.spent}`
    );
  }
  const jobShareSum = PREVIEW_MONEY_SHAPE.jobs!.reduce((s, j) => s + j.share, 0);
  if (jobShareSum !== 100) {
    throw new Error(`[spend-period-round/fixtures.ts] money-shape job shares sum to ${jobShareSum}, not 100`);
  }
}

if (process.env.NODE_ENV !== "production") {
  assertFixtureInvariants(SPEND_VERDICT_FIXTURE);
}
