// Fixture data for /design/spend-tips — TEMPORARY PREVIEW, delete after
// design review. See SpendTipsClient.tsx for the owner brief this route
// answers.
//
// Majority rows and the Shopping notable are the owner's own real /spend
// data (phone screenshot, 2026-09-04). SavingsInsight tips copy the field
// shape from app/design/insights-live/fixtures.ts's FRESH_WEEKLY fixture
// so the REAL InsightCard (app/insights/InsightsPage.tsx) renders them
// exactly as it would in production — every required field is filled, not
// just the ones this preview happens to read.
import type { SavingsInsight, Transaction } from "@/lib/api";
import { openTipsFor, sumEstimates } from "@/lib/spendTips";

// Re-exported so every existing importer of this fixture module (shared.tsx,
// VariantB/C, TransactionsMock) keeps working unchanged — the underlying sum
// logic itself now lives in lib/spendTips.ts (Step 5, spend-tips promotion).
export { sumEstimates };

export interface MajorityRowFixture {
  category: string;
  payments_count: number;
  spent: number;
}

// Order matches the owner's screenshot (largest first). The client shows
// the first four then a static "Show all 9" link.
export const MAJORITY_ROWS: MajorityRowFixture[] = [
  { category: "Bills", payments_count: 12, spent: 2123.43 },
  { category: "Health", payments_count: 1, spent: 117.0 },
  { category: "Groceries", payments_count: 4, spent: 94.73 },
  { category: "Subscriptions", payments_count: 4, spent: 48.97 },
  { category: "Golf", payments_count: 2, spent: 48.0 },
  { category: "Entertainment", payments_count: 1, spent: 43.98 },
  { category: "Eating Out", payments_count: 2, spent: 41.75 },
  { category: "Charity", payments_count: 1, spent: 5.0 },
  { category: "Transport", payments_count: 1, spent: 2.0 },
];

export const MAJORITY_VISIBLE_COUNT = 4;

// Section header — "Looking normal · £2,525 across 9 categories" (sum of
// MAJORITY_ROWS above, rounded the same way SpendVerdictView's `fmt` does).
export const MAJORITY_SUM = MAJORITY_ROWS.reduce((s, r) => s + r.spent, 0);
export const MAJORITY_COUNT = MAJORITY_ROWS.length;

// The one notable above the list — "Needs a look" static card, matching
// the owner's screenshot: Shopping, 1 payment, day 7, £168.94, "4.6× usual".
export const NOTABLE_SHOPPING = {
  category: "Shopping",
  payments_count: 1,
  day: 7,
  spent: 168.94,
  multiple: 4.6,
};

// "Money you moved" collapsed bar — static, not counted in spending.
export const MONEY_MOVED_TOTAL = 6932;

// ── Fixture transactions per category, source data for the transactions
// page's own payments list (transactionsFor() below builds real Transaction
// objects off this map for TransactionsMock) ──────────────────────────────
// Every category's list is now the FULL payment list, row count matching
// the category's own `payments_count` in MAJORITY_ROWS above, amounts
// summing EXACTLY to that row's `spent` figure — no "showing N of M" caveat
// anywhere, because there is nothing left out. Golf/Entertainment/
// Eating Out/Charity/Transport/Health were already complete this way;
// Bills/Groceries/Subscriptions previously carried three representative
// rows each that did not sum to the category total, which is what this
// pass corrected. Dates fall within the owner's current pay period
// (28 Aug-5 Sep).
export interface FixtureTxn {
  merchant: string;
  date: string;
  amount: number;
}

const TXNS: Record<string, FixtureTxn[]> = {
  // 12 rows summing to exactly £2,123.43.
  Bills: [
    { merchant: "Nationwide", date: "1 Sep", amount: 1124.0 },
    { merchant: "Birmingham City Council", date: "1 Sep", amount: 189.0 },
    { merchant: "Octopus Energy", date: "1 Sep", amount: 160.0 },
    { merchant: "Volkswagen Financial", date: "2 Sep", amount: 299.0 },
    { merchant: "Admiral", date: "2 Sep", amount: 68.5 },
    { merchant: "British Gas HomeCare", date: "3 Sep", amount: 54.5 },
    { merchant: "EE", date: "2 Sep", amount: 57.0 },
    { merchant: "Virgin Media", date: "3 Sep", amount: 45.0 },
    { merchant: "Aviva", date: "4 Sep", amount: 42.1 },
    { merchant: "Thames Water", date: "1 Sep", amount: 38.2 },
    { merchant: "Sky", date: "4 Sep", amount: 32.0 },
    { merchant: "TV Licence", date: "5 Sep", amount: 14.13 },
  ],
  Health: [{ merchant: "David Lloyd Leisure", date: "1 Sep", amount: 117.0 }],
  // 4 rows summing to exactly £94.73.
  Groceries: [
    { merchant: "Sainsbury's", date: "1 Sep", amount: 32.1 },
    { merchant: "Sainsbury's", date: "2 Sep", amount: 28.45 },
    { merchant: "Aldi", date: "3 Sep", amount: 15.0 },
    { merchant: "Sainsbury's", date: "4 Sep", amount: 19.18 },
  ],
  // 4 rows summing to exactly £48.97.
  Subscriptions: [
    { merchant: "Amazon Prime", date: "1 Sep", amount: 8.99 },
    { merchant: "iCloud", date: "30 Aug", amount: 15.0 },
    { merchant: "Netflix", date: "3 Sep", amount: 12.99 },
    { merchant: "Spotify", date: "28 Aug", amount: 11.99 },
  ],
  Golf: [
    { merchant: "Trentham Golf Club", date: "3 Sep", amount: 24.0 },
    { merchant: "Trentham Golf Club", date: "20 Aug", amount: 24.0 },
  ],
  Entertainment: [{ merchant: "Odeon Cinemas", date: "5 Sep", amount: 43.98 }],
  "Eating Out": [
    { merchant: "Nandos", date: "4 Sep", amount: 24.5 },
    { merchant: "Costa Coffee", date: "30 Aug", amount: 17.25 },
  ],
  Charity: [{ merchant: "British Red Cross", date: "1 Sep", amount: 5.0 }],
  Transport: [{ merchant: "TfL", date: "3 Sep", amount: 2.0 }],
};

export function txnsFor(category: string): FixtureTxn[] {
  return TXNS[category] ?? [];
}

// ── Real Transaction fixtures, for TransactionsMock's payment list ───────
// The owner correction (2026-09-05): a category tap doesn't open a sheet,
// it routes to /transactions?category=X&from=&to=, so this preview's list
// must render the REAL TransactionRow (components/TransactionRow.tsx)
// against real Transaction objects, not a bespoke merchant/date/amount
// row. Built straight off the TXNS map above (same rows, same sums) so the
// two never drift; every field TransactionRow reads is filled in, not just
// the ones this preview happens to use. Dates are 2026, matching this same
// file's tip fixtures below (`refreshed_at`/`researched_at` etc all sit in
// September 2026).
const FIXTURE_MONTHS: Record<string, string> = { Aug: "08", Sep: "09" };

function isoDateFromLabel(label: string): string {
  const [day, month] = label.split(" ");
  const mm = FIXTURE_MONTHS[month] ?? "01";
  return `2026-${mm}-${day.padStart(2, "0")}`;
}

function slugify(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function transactionsFor(category: string): Transaction[] {
  const rows = TXNS[category] ?? [];
  return rows.map((t, i) => ({
    id: `fixture-${slugify(category)}-${i}`,
    account_id: "fixture-account",
    date: isoDateFromLabel(t.date),
    amount: t.amount,
    currency: "GBP",
    description: t.merchant,
    merchant_name: t.merchant,
    category,
    transaction_type: "debit" as const,
  }));
}

// The fixture pay period behind the transactions page's own period chip
// (?from=&to=, shown as "1 Sep → 25 Sep" via TransactionsMock's copy of
// formatPeriodChip) — a plain 1st-to-25th pay period, the shape a real
// category tap from Spend arrives with. Independent of the individual
// transaction dates above (a few of which fall in late August): the point
// of this fixture is the chip's exact rendered format, not a strict
// every-row-inside-the-range guarantee.
export const TRANSACTIONS_PERIOD_FROM = "2026-09-01";
export const TRANSACTIONS_PERIOD_TO = "2026-09-25";

// ── Tips, shaped field-for-field like insights-live's FRESH_WEEKLY fixture
// so the real InsightCard renders every field correctly. `app_category` is
// the visible Spend category this tip annotates (SavingsInsight's own
// field for exactly this purpose) — tipsFor() below matches on it. ────────
const MOBILE: SavingsInsight = {
  id: "mobile-spend-tips",
  category: "mobile",
  app_category: "Bills",
  icon: "📱",
  label: "Mobile",
  title: "You pay EE £57/mo, SIM-only could cut that sharply",
  body: "Asda Mobile and Lebara both offer 5GB plans at £5/month, a fraction of your current spend. Switching could free up around £52 per month, though you'd need to check if the data allowance suits your needs.",
  savings_estimate: "~£52/mo",
  savings_estimate_monthly: 52,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T19:44:05.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-08T19:44:05.000000Z",
  expiry_line: "Researched 3d ago",
  state: "fresh",
  researched_at: "2026-09-01T19:44:05.000000Z",
  triggered_by: [
    { merchant_key: "ee", display_name: "Ee", monthly_amount: 57.0, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

const ENERGY: SavingsInsight = {
  id: "energy-spend-tips",
  category: "energy",
  app_category: "Bills",
  icon: "⚡",
  label: "Energy",
  title: "Your £160/mo energy bill could drop with fixed tariffs",
  body: "Fixed-price tariffs like Outfox EnergyFix'd Dual offer protection against future price rises. If you have solar panels or a battery, Economy 7 import tariffs could save ~10p per kWh on overnight charging.",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T19:44:05.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-08T19:44:05.000000Z",
  expiry_line: "Researched 3d ago",
  state: "fresh",
  researched_at: "2026-09-01T19:44:05.000000Z",
  triggered_by: [
    { merchant_key: "octopus energy", display_name: "Octopus Energy", monthly_amount: 160.0, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

const GYM: SavingsInsight = {
  id: "gym-spend-tips",
  category: "gym",
  app_category: "Health",
  icon: "🏋️",
  label: "Gym",
  title: "You pay £117/mo at David Lloyd, could save ~£95",
  body: "Your current David Lloyd Leisure membership costs around £117 per month on a rolling contract. JD Gyms offers no-contract memberships from £21.99/month for the first three months, and PureGym starts from £15/month with rolling terms, both without long-term commitment. Switching to either could cut your gym spend significantly while keeping the flexibility you have now.",
  savings_estimate: "~£95/mo",
  savings_estimate_monthly: 95,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T19:44:05.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-08T19:44:05.000000Z",
  expiry_line: "Researched 3d ago",
  state: "fresh",
  researched_at: "2026-09-01T19:44:05.000000Z",
  triggered_by: [
    { merchant_key: "david lloyd leisure", display_name: "David Lloyd Leisure", monthly_amount: 117.0, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

const GROCERIES: SavingsInsight = {
  id: "groceries-spend-tips",
  category: "groceries",
  app_category: "Groceries",
  icon: "🛒",
  label: "Groceries",
  title: "You spend ~£137/mo on groceries, try Aldi or Lidl",
  body: "Aldi and Lidl are consistently the cheapest UK supermarkets in 2026 for most items. Since you shop mainly at Sainsburys, switching some trips to Aldi or Lidl could lower your overall bill, though the exact saving depends on which items you buy most often.",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T19:44:05.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-08T19:44:05.000000Z",
  expiry_line: "Researched 3d ago",
  state: "fresh",
  researched_at: "2026-09-01T19:44:05.000000Z",
  triggered_by: [
    { merchant_key: "sainsburys", display_name: "Sainsburys", monthly_amount: 137.0, occurrences: 4, is_recurring: false },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

const SUBSCRIPTIONS: SavingsInsight = {
  id: "subscriptions-spend-tips",
  category: "subscriptions",
  app_category: "Subscriptions",
  icon: "🔁",
  label: "Subscriptions",
  title: "You spend £22/month on Netflix and Prime",
  body: "Streaming bundles and retention discounts could help cut costs. Try negotiating with your providers or rotating subscriptions seasonally to watch what you need, then cancel until the next show drops.",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-02T06:01:12.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: false,
  substituted_merchant: null,
  substituted_amount: null,
  substituted_line: null,
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: "2026-09-09T06:01:12.000000Z",
  expiry_line: "Researched 2d ago",
  state: "fresh",
  researched_at: "2026-09-02T06:01:12.000000Z",
  triggered_by: [
    { merchant_key: "netflix", display_name: "Netflix", monthly_amount: 12.99, occurrences: 1, is_recurring: true },
    { merchant_key: "amazon prime", display_name: "Amazon Prime", monthly_amount: 8.99, occurrences: 1, is_recurring: true },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

// Substituted — Eating Out/Nandos. A closed state: never counts as an open
// tip anywhere in these variants (tipsFor() below only returns state
// "fresh" tips).
export const SUBSTITUTED_EATING_OUT: SavingsInsight = {
  id: "eating-out-spend-tips",
  category: "eating_out",
  app_category: "Eating Out",
  icon: "🍽️",
  label: "Eating Out",
  title: "",
  body: "",
  savings_estimate: null,
  savings_estimate_monthly: null,
  pinned: false,
  is_new: false,
  refreshed_at: "2026-09-01T06:00:46.000000Z",
  return_reason: null,
  verified_savings: null,
  verified_merchant: null,
  verified_tier: null,
  verified_savings_line: null,
  substituted: true,
  substituted_merchant: "Nandos",
  substituted_amount: 24.5,
  substituted_line: "Payments to Nandos stopped, but Eating Out overall hasn't moved. Worth a look at where it went.",
  deadline_at: null,
  claim_valid_until: null,
  content_valid_until: null,
  expiry_line: null,
  state: "substituted",
  researched_at: null,
  triggered_by: [
    { merchant_key: "nandos", display_name: "Nandos", monthly_amount: 24.5, occurrences: 1, is_recurring: false },
    { merchant_key: "costa coffee", display_name: "Costa Coffee", monthly_amount: 17.25, occurrences: 1, is_recurring: false },
  ],
  user_context: null,
  has_workflow: true,
  app_route: null,
};

// Every OPEN tip (never includes the substituted/closed fixture above).
export const OPEN_TIPS: SavingsInsight[] = [MOBILE, ENERGY, GYM, GROCERIES, SUBSCRIPTIONS];

// Every tip fixture that exists, open or closed — tipsFor() below filters
// THIS list (not OPEN_TIPS directly) so the substituted Eating Out fixture
// actually exercises the `state === "fresh"` exclusion instead of being
// kept out by construction. Eating Out must resolve to zero open tips.
const ALL_TIPS: SavingsInsight[] = [...OPEN_TIPS, SUBSTITUTED_EATING_OUT];

// Per-category open tips — thin wrapper over the live openTipsFor
// (lib/spendTips.ts), so this fixture module carries no filtering logic of
// its own to drift out of sync with production. A substituted/verified/
// quiet tip is a closed or silent state and must never render as an
// actionable tip in these variants; openTipsFor's own state check is what
// guarantees that (see ALL_TIPS's SUBSTITUTED_EATING_OUT fixture above).
export function tipsFor(category: string): SavingsInsight[] {
  return openTipsFor(category, ALL_TIPS);
}
