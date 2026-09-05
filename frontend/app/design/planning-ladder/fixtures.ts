// TEMPORARY PREVIEW fixtures — delete with the rest of this route after
// design review. Values are the owner's real Planning figures, captured
// 2026-09-04, the day of the phone-screenshot brief (locked rungs push the
// live 0% cliff + off-pace goal below the fold).

import type { GrowLadderStep, GrowView } from "@wealth/shared";
import type { Commitment, DebtPlanSummary } from "@/lib/api";

/** Fixed "today" the whole preview reasons from — the owner brief's date.
 *  Hoisted here (rather than re-declared per variant) so resolveAttention's
 *  "is the 0% cliff within 30 days" check and every screenshot agree on the
 *  same instant. */
export const TODAY = new Date("2026-09-04T00:00:00");

// ── ladder (7 real rungs, unchanged order) ───────────────────────────────

export const LADDER_STEPS: GrowLadderStep[] = [
  {
    key: "essentials",
    title: "Essentials",
    state: "done",
    detail:
      "In a typical month, your everyday spending fits within your income, with about £739/month to spare. This excludes savings, investments and debt repayments",
    options: [],
  },
  {
    key: "pension_match",
    title: "Employer pension match",
    state: "done",
    detail:
      "Your income (£107,000) and pension contributions (~£24,000/year) are on file. An employer match is a guaranteed 100% return on the matched amount, some people check their scheme's match ceiling first.",
    options: [],
    link: { label: "See your tax levers ›", route: "/insights?tab=tax" },
  },
  {
    key: "starter_buffer",
    title: "Starter buffer",
    state: "active",
    detail: "Your buffer holds £1,166 against a 1-month target of £5,166",
    options: [
      "Some people build a small cash buffer before tackling anything else",
      "Others prioritise clearing expensive debt first, since it's a guaranteed saving",
    ],
  },
  {
    key: "expensive_debt",
    title: "Expensive debt",
    state: "locked",
    detail: "You have no debt carrying interest right now",
    options: [
      "Overpaying debt is a guaranteed return equal to the rate, investing may return more or less and your capital is at risk",
      "Some people keep a small cash buffer alongside expensive debt rather than putting every spare pound towards it",
    ],
  },
  {
    key: "full_fund",
    title: "Full emergency fund",
    state: "locked",
    detail: "Your buffer holds £1,166 against a 3-month target of £15,499",
    options: [
      "Some people hold 3-6 months of essential spending in cash before investing more",
      "Others invest sooner and treat other credit as a backstop, that carries its own risk",
    ],
  },
  {
    key: "pension_topup",
    title: "Pension top-up",
    state: "locked",
    detail:
      "£1,000 into your pension costs you ~£600 at 40% relief. Adjusted income on file: £83,000. You contribute ~£24,000/yr, around £36,000 of this year's £60,000 annual allowance remains.",
    options: [
      "Some people top up pension contributions for the tax relief before investing elsewhere",
      "Others prioritise ISA investing for easier access to the money",
    ],
    link: { label: "See your tax levers ›", route: "/insights?tab=tax" },
  },
  {
    key: "isa_invest",
    title: "ISA / general investing",
    state: "locked",
    detail: "This unlocks once your buffer reaches ~3 months of spending and any expensive debt is cleared",
    options: [
      "Some people prioritise ISA or pension contributions once debt and buffer are sorted; others keep building cash",
      "Investing can lose money as well as gain it, and past performance isn't a guide to future returns",
    ],
  },
];

// ── grow view (verdict / buffer / debt / invest / notes) ─────────────────
// Identical across both period states except `period_gate`.

function baseGrowView(): Omit<GrowView, "period_gate"> {
  return {
    verdict: {
      headline: "After debt repayments, you're about £412/month short",
      sub: "Your buffer covers ~7 days",
    },
    surplus_monthly: -412.5,
    buffer: { current: 1165.83, target: 15498.57, pct: 7.5, days_covered: 7, target_months: 3 },
    debt: {
      has_debt: true,
      total: 24697.87,
      // true so the calm-state hero's normal branch renders its "at 0%
      // until" line (view.debt.all_promo && view.debt.promo_cliff) — the
      // whole preview is exercising the Sept-2026 cliff, so the hero should
      // show it too, not just the folded ladder / attention resolver.
      all_promo: true,
      expensive_total: 0,
      promo_cliff: "2026-09-30",
    },
    invest: { portfolio_value: 14378.56, has_investments: true },
    ladder: LADDER_STEPS,
    notes: [
      "Investing can lose money as well as gain it, and past performance isn't a guide to future returns. Your capital is at risk.",
      "The cash-ISA limit drops to £12,000 for under-65s from April 2027.",
    ],
  };
}

export const GROW_VIEW_SHORT: GrowView = {
  ...baseGrowView(),
  period_gate: { short: true, to_cover: 1107.91, period_end: "2026-09-25" },
};

export const GROW_VIEW_CALM: GrowView = {
  ...baseGrowView(),
  period_gate: { short: false, to_cover: 0, period_end: "2026-09-25" },
};

export function growView(state: "short" | "calm"): GrowView {
  return state === "short" ? GROW_VIEW_SHORT : GROW_VIEW_CALM;
}

// ── debt position (4 cards, 2 of them sharing the "currently at 0%"
// bucket — one carries the Sept 2026 promo cliff the whole preview is
// about, the other is a plain standing 0% card with no cliff) ───────────

export const DEBT_SUMMARY: DebtPlanSummary = {
  totals: {
    buckets: { carried_total: 24697.87, float_total: 0 },
    monthly_payment: 100,
  },
  cards: [
    {
      account_id: "card-credit-card",
      name: "Credit Card",
      debt: 20000,
      currency: "GBP",
      classification: "carried_zero",
      monthly: null,
      rate_schedule: [{ from: "2026-06", until: "2026-09", apr_pct: 0, source: "promo", kind: null }],
    },
    {
      account_id: "card-store-card",
      name: "Store Card",
      debt: 3653.87,
      currency: "GBP",
      classification: "carried_zero",
      monthly: null,
      rate_schedule: [{ from: "2024-01", until: null, apr_pct: 0, source: "standard", kind: null }],
    },
    {
      account_id: "card-amex",
      name: "Amex",
      debt: 100,
      currency: "GBP",
      classification: "cleared_monthly",
      monthly: 100,
      rate_schedule: [{ from: "2020-01", until: null, apr_pct: null, source: "unknown", kind: null }],
    },
    {
      account_id: "card-very",
      name: "Very",
      debt: 944,
      currency: "GBP",
      classification: "unclear",
      monthly: null,
      rate_schedule: [{ from: "2022-01", until: null, apr_pct: null, source: "unknown", kind: null }],
    },
  ],
};

// ── long-term goal (Japan, running behind pace) ──────────────────────────

export const GOAL_JAPAN: Commitment = {
  id: "goal-japan",
  name: "Japan",
  amount: 5000,
  target_date: "2027-10-01",
  funding_account_id: null,
  funding_account_name: null,
  source: "manual",
  status: "active",
  progress: 1065,
  remaining: 3935,
  periods_left: 13,
  per_period_slice: 305,
  period_label: "monthly",
  on_track: false,
  feasibility: "stretch",
  feasibility_tone: "caution",
  shared_pot_goals: [],
};

export const GOALS: Commitment[] = [GOAL_JAPAN];
