// Invented fixtures for the G242 round. Nothing here is real user data.
import type { Checkpoint, MirrorTrait, SavingsInsight, SpendVerdict, Transaction } from "@/lib/api";

export const PERIOD_DAYS = 28;
const PERIOD = { start: "2026-09-28", end: "2026-10-25", days_elapsed: 22, days_left: 6, offset: 0, closed: false };

/** Usual per-period figure per category, as the baseline AimSheet reads. */
export const USUAL: Record<string, number> = { "Eating Out": 107, Groceries: 300, Transport: 95, Padel: 70 };

/** Pre-filled aim: ~93% of usual rounded to 5, the same rule AimSheet applies. */
export function suggestedAim(category: string): number | null {
  const u = USUAL[category];
  return u == null ? null : Math.max(5, Math.round((u * 0.93) / 5) * 5);
}

export function verdictFor(eatingOutSpent: number): SpendVerdict {
  const majority = [
    { category: "Groceries", spent: 214, payments_count: 9, has_baseline: true, elevated: false },
    { category: "Eating Out", spent: eatingOutSpent, payments_count: 6, has_baseline: true, elevated: false },
    { category: "Transport", spent: 61, payments_count: 5, has_baseline: true, elevated: false },
    { category: "Shopping", spent: 44, payments_count: 2, has_baseline: true, elevated: false },
    { category: "Subscriptions", spent: 38, payments_count: 4, has_baseline: true, elevated: false },
  ];
  const notableSpent = 96;
  const total = notableSpent + majority.reduce((s, r) => s + r.spent, 0);
  return {
    state: "normal",
    reading: "",
    notables: [
      {
        category: "Padel", spent: notableSpent, multiple: 1.8, excess: 43, payments_count: 4,
        cause: [{ name: "Playtomic", amount: 64 }],
        pace: { spent: notableSpent, usual_by_now: 53 },
      },
    ],
    quiet_flags: [],
    majority,
    unresolved: { total: 0, payments_count: 0, ask_worthy: false, weight: "routine", largest: null },
    moved: [],
    pills: { spent: total, income: 0, net: -total },
    period: PERIOD,
    moved_total: 0,
  };
}

/** A live aim, shaped like the checkpoint the backend returns. */
export function aimFor(amount: number, spent: number, id = "fixture-aim"): Checkpoint {
  return { id, aim_amount: amount, spent_so_far: spent, days_left: PERIOD.days_left, on_track: true };
}

export const SPENT: Record<string, number> = { Groceries: 214, "Eating Out": 82, Transport: 61, Padel: 96 };

export const EATING_OUT_TXNS: Transaction[] = [
  ["2026-10-20", 24.5, "Dishoom", "DISHOOM COVENT GARDEN"],
  ["2026-10-17", 14.2, "Pret A Manger", "PRET A MANGER 0412"],
  ["2026-10-12", 19.8, "Wagamama", "WAGAMAMA LTD"],
  ["2026-10-08", 9.5, "Gail's", "GAILS BAKERY"],
  ["2026-10-03", 8.0, "Costa", "COSTA COFFEE"],
  ["2026-09-30", 6.0, "Pret A Manger", "PRET A MANGER 0412"],
].map(([date, amount, merchant, description], i) => ({
  id: `fixture-eo-${i}`,
  account_id: "fixture-account",
  date: date as string,
  amount: amount as number,
  currency: "GBP",
  description: description as string,
  merchant_name: merchant as string,
  category: "Eating Out",
  transaction_type: "debit",
}));

export const TRAITS: MirrorTrait[] = [
  {
    id: "fixture-trait-eating-out",
    title: "Your Signature: Eating Out",
    narrative: "Eating out is where you spend more than people with a similar income, and it holds steady month to month.",
    evidence: ["About £107 a pay period over the last 6 months", "6 payments so far this period"],
    kind: "pleasure",
    choice: null,
    ref_category: "Eating Out",
  },
  {
    id: "fixture-trait-front-loader",
    title: "You front-load your month",
    narrative: "Most of your spending lands in the first week after pay, then it settles.",
    evidence: ["58% of spending falls in the first 7 days of the period"],
    kind: "structure",
    choice: null,
    ref_category: null,
  },
  {
    id: "fixture-trait-regular-saver",
    title: "You save little and often",
    narrative: "Small transfers to savings land most weeks, though you draw some of it back out.",
    evidence: ["Saved in 22 of the last 26 weeks", "Drew back £120 in the last 2 months"],
    kind: "habit",
    choice: "keep",
    ref_category: null,
  },
];

// ── Round 2: open tips, shaped field-for-field like the spend-tips fixtures so the
// production InsightCard and the Spend subline signifier read them as real. ──────
function openTip(id: string, appCategory: string, label: string, title: string, body: string, monthly: number | null): SavingsInsight {
  return {
    id, category: label.toLowerCase(), app_category: appCategory, icon: "💡", label, title, body,
    savings_estimate: monthly != null ? `~£${monthly}/mo` : null,
    savings_estimate_monthly: monthly,
    pinned: false, is_new: false,
    refreshed_at: "2026-10-09T06:00:46.000000Z", return_reason: null,
    verified_savings: null, verified_merchant: null, verified_tier: null, verified_savings_line: null,
    substituted: false, substituted_merchant: null, substituted_amount: null, substituted_line: null,
    deadline_at: null, claim_valid_until: null,
    content_valid_until: "2026-10-16T06:00:46.000000Z",
    expiry_line: "Researched 2d ago",
    state: "fresh",
    researched_at: "2026-10-09T06:00:46.000000Z",
    triggered_by: [{ merchant_key: "pret a manger", display_name: "Pret A Manger", monthly_amount: 20.2, occurrences: 2, is_recurring: false }],
    user_context: null, has_workflow: true, app_route: null,
  };
}

export const EATING_OUT_TIP = openTip(
  "fixture-tip-eating-out", "Eating Out", "Lunch",
  "Meal deals could trim your weekday lunches",
  "Several lunch stops this period came to between £6 and £14. Supermarket meal deals and app offers often come in under £5, so swapping two a week could free up about £18 a month, if that suits your week.",
  18,
);
export const GROCERIES_TIPS: SavingsInsight[] = [
  openTip("fixture-tip-groceries-1", "Groceries", "Groceries", "Your regular shop may be cheaper at a discounter", "Comparing your usual basket suggests a discounter could be around £24 a month lower, though stock and distance vary.", 24),
  openTip("fixture-tip-groceries-2", "Groceries", "Loyalty", "Loyalty prices on three items you buy often", "Three items you buy most weeks have a members' price at your usual supermarket. No saving is costed yet.", null),
];
export const ALL_TIPS: SavingsInsight[] = [EATING_OUT_TIP, ...GROCERIES_TIPS];
export const PERIOD_FROM = "2026-09-28";
export const PERIOD_TO = "2026-10-25";
