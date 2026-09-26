import type {
  Account,
  AccountEligibility,
  CompanionItem,
  InvestmentAccount,
  PaydayPlanDest,
  PaydayPlanSalary,
  SafeToSpend,
  Transaction,
} from "@/lib/api";
import type { ReconnectProvider } from "@/components/ReconnectStrip";

// G134 — Home surface inventory catalogue. Fixtures only, no live data (see
// scripts/check-design-no-live-data.mjs). This file supplies every fixture
// this preview needs BEYOND the eight kinds already in
// app/design/home-brief-cards/productionFixtures.ts, which is imported and
// reused as-is (not extended) — see this preview's own header comment for
// why: PRODUCTION_CARD_FIXTURES' `ProductionCardKind` union is consumed by
// an existing switch in VariantB.tsx with no default case, so widening that
// shared union would force an edit to an already-shipped, unrelated preview
// to keep it exhaustive. Every new item this file needs (trajectory,
// rhythm-info, the bare "info" fallback, needle, payday_plan) is typed
// directly against CompanionItem instead.

// ── Trajectory (the card that prompted G134) ────────────────────────────
// Same shape family as `cliff` — both route through CliffCard (see
// components/HomeBrief.tsx's CliffCard, which reads `item.type ===
// "trajectory"` to pick the TrendingDown icon and "Debt trajectory" label).
// Invented figures: the real trajectory copy lives in
// app/design/g88-home-real/realFixtures.ts and is Kevin's own carried-debt
// total, which must never appear on an auth-exempt, publicly reachable
// /design page — only the wording PATTERN is adapted from it, not the number.
export const TRAJECTORY_ITEM: CompanionItem = {
  id: "trajectory:g134:example",
  type: "trajectory",
  headline: "The cards aren't coming down at your current pace, £8,240 carried across 3 cards.",
  body: "£1,150 will still be on the Barclaycard Platinum when its 0% ends in Mar 2027. From then it'd cost about £28 a month unless it's cleared or moved.",
  action: { label: "See the route ›", route: "/debt-plan" },
  estimated: false,
  brief_lead: { value: "£8,240", companion: "carried across 3 cards" },
};

// ── Rhythm, payload-less (the "rhythm-info" bucket) ─────────────────────
// Same `type: "rhythm"` as the interactive card, but BriefBody only gives a
// rhythm item the interactive RhythmCard treatment when
// `payload.multiple >= 1.5` (components/HomeBrief.tsx, ~line 1990). No
// payload at all here, which is the more common shape for a pattern note
// with nothing to react to — it falls through to the plain CliffCard
// info-card treatment ("Spending pattern" label, no accent, no CTA).
export const RHYTHM_INFO_ITEM: CompanionItem = {
  id: "rhythm:info:g134:example",
  type: "rhythm",
  headline: "Weekend takeaways have been quieter than usual this month",
  body: "Just noting the change, no action needed.",
  action: null,
  estimated: false,
};

// ── Bare paragraph fallback ("other"/info) ──────────────────────────────
// `type: "info"` is the one CompanionItem type BriefBody's otherItems bucket
// actually catches (it excludes every other named type explicitly) — see
// components/HomeBrief.tsx's `otherItems` filter and its render, a plain
// headline-in-<strong> + body paragraph with no card chrome at all.
export const OTHER_INFO_ITEM: CompanionItem = {
  id: "info:g134:example",
  type: "info",
  headline: "Your card terms are now saved.",
  body: "Thanks for confirming your APR, I can plan around it from here.",
  action: null,
  estimated: false,
};

// ── Needle ───────────────────────────────────────────────────────────────
// Rendered as inline JSX inside BriefBody itself (components/HomeBrief.tsx,
// ~lines 2067-2081), not a separate exported component — a plain headline
// paragraph plus one text-link action, reproduced faithfully here since
// there is nothing importable for it.
export const NEEDLE_ITEM: CompanionItem = {
  id: "needle:g134:example",
  type: "needle",
  headline: "Your August closed 12% better than July",
  body: "",
  action: { label: "See what changed", route: "/spend" },
  estimated: false,
};

// ── Payday plan (PaydayPlanSection, a HomeBrief sibling export) ─────────
// Same production-shaped approach as app/design/payday-plan-grammar/fixtures.ts's
// `paydayPlanItem` helper — kept at the API boundary (CompanionItem) so the
// real PaydayPlanCard/ExecutedPaydayRow render for real rather than a
// forked markup copy.
const PAYDAY_SALARY: PaydayPlanSalary = {
  account_id: "salary-hsbc",
  name: "HSBC Current",
  provider: "HSBC",
  amount: 2450,
  stays: 640,
};

const PAYDAY_DESTS: PaydayPlanDest[] = [
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

const PAYDAY_TOTAL = PAYDAY_DESTS.reduce((sum, d) => sum + d.move, 0);

/** The live payday plan — PaydayPlanCard's own confirm/adjust treatment
 * (`preview: true`, hedged heading via `next_pay`). G164 (2026-09-26): the
 * payday plan is purely advisory, so there is no further "executed" state —
 * once the pay lands there is nothing left to report, and a plan overtaken
 * by the user's own standing orders is superseded quietly on the backend
 * (no item at all). */
export const PAYDAY_PLAN_ACTIVE_ITEM: CompanionItem = {
  id: "payday_plan:g134:active",
  type: "payday_plan",
  headline: `Payday plan: split £${PAYDAY_SALARY.amount.toLocaleString("en-GB")} across ${PAYDAY_DESTS.length} accounts`,
  body: `£${PAYDAY_TOTAL.toLocaleString("en-GB")} distributed, £${PAYDAY_SALARY.stays.toLocaleString("en-GB")} stays in ${PAYDAY_SALARY.name}.`,
  action: { label: "See the full plan", route: "/upcoming" },
  estimated: false,
  total: PAYDAY_TOTAL,
  preview: true,
  next_pay: "2026-09-28",
  dests: PAYDAY_DESTS,
  salary: PAYDAY_SALARY,
};

// ── ReconnectStrip fixture (HomeBrief's `banner` slot) ──────────────────
// N=1 stays a one-line row with its reconnect action inline.
export const RECONNECT_PROVIDERS: ReconnectProvider[] = [
  { provider: "NatWest", provider_id: "natwest", source: "truelayer", account_count: 3 },
];

// N>1 collapses to one connection summary behind a native disclosure,
// expanding to one action per bank consent (ReconnectStrip.tsx doc comment).
export const RECONNECT_PROVIDERS_MULTI: ReconnectProvider[] = [
  { provider: "NatWest", provider_id: "natwest", source: "truelayer", account_count: 3 },
  { provider: "Amex", provider_id: "amex", source: "finexer", account_count: 1 },
];

// ── A second, truly-generic ask (distinct from ask:card_terms) ─────────
// AskGenericCard renders any ask whose id isn't "ask:payday" — card_terms
// (productionFixtures.ts) is one instance of that; this is a second,
// unrelated instance so the catalogue shows "generic" is a real bucket, not
// a synonym for card_terms specifically.
export const GENERIC_ASK_ITEM: CompanionItem = {
  id: "ask:link-identity",
  type: "ask",
  headline: "Seen this Apple ID before?",
  body: "Signing in with Apple on a new device sometimes creates a second account. Tell me if this is you and I'll merge them.",
  action: { label: "Yes, that's me", route: "#" },
  estimated: false,
};

// ── Payday plan entry-row window fixture ─────────────────────────────────
// isPaydayWindowActive (lib/paydayWindow.ts) opens the entry row only when
// days_until_payday is 1..5 (and there's no live plan yet) — a plain
// safe_to_spend "ok" payload with that field set, otherwise unremarkable.
export const PAYDAY_WINDOW_SAFE_TO_SPEND: SafeToSpend = {
  status: "ok",
  safe_to_spend: 685,
  next_payday: "2026-09-22",
  days_until_payday: 3,
  bills_total: 210,
  income_before_payday: 0,
  buffer: 100,
  state: "comfortable",
  estimated: false,
  calculation_status: "complete",
};

// ── SafeToSpendCard fixtures — one per rendered state ───────────────────
const RECENT_SYNC = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

type StsFixture = {
  key: string;
  label: string;
  note: string;
  data: SafeToSpend | null;
  loading?: boolean;
  error?: boolean;
};

export const SAFE_TO_SPEND_STATES: readonly StsFixture[] = [
  {
    key: "comfortable",
    label: "Comfortable",
    note: "Plenty of headroom before payday.",
    data: {
      status: "ok",
      safe_to_spend: 685,
      calculation_version: 2,
      next_payday: "2026-09-28",
      days_until_payday: 9,
      bills_total: 210,
      income_before_payday: 0,
      buffer: 100,
      state: "comfortable",
      estimated: false,
      spendable_now: 995,
      payday_income: 2450,
      card_debt: 320,
      last_synced: RECENT_SYNC,
      safe_to_spend_cash: 685,
      lowest_projected_balance: 785,
      card_growth_total: 0,
      card_new_spend_total: 0,
      card_growth_reserved: 0,
      calculation_status: "complete",
    },
  },
  {
    key: "tight",
    label: "Tight",
    note: "Free cash is thin but positive; card spend this period is shown for context only.",
    data: {
      status: "ok",
      safe_to_spend: 38,
      next_payday: "2026-09-28",
      days_until_payday: 9,
      bills_total: 480,
      income_before_payday: 0,
      buffer: 100,
      state: "tight",
      estimated: false,
      spendable_now: 518,
      payday_income: 2450,
      card_debt: 1200,
      last_synced: RECENT_SYNC,
      safe_to_spend_cash: 38,
      lowest_projected_balance: 138,
      card_growth_total: 240,
      card_new_spend_total: 240,
      card_growth_reserved: 0,
      card_growth_wording: "carried",
      calculation_status: "complete",
    },
  },
  {
    key: "short",
    label: "Short (genuine bills gap)",
    note: "Projected balance goes negative before payday on the dated bills forecast alone.",
    data: {
      status: "ok",
      safe_to_spend: -64,
      next_payday: "2026-09-28",
      days_until_payday: 6,
      bills_total: 610,
      income_before_payday: 0,
      buffer: 100,
      state: "short",
      short_reason: "bills",
      estimated: false,
      spendable_now: 446,
      payday_income: 2450,
      card_debt: 900,
      last_synced: RECENT_SYNC,
      safe_to_spend_cash: -64,
      lowest_projected_balance: -64,
      card_growth_total: 0,
      card_new_spend_total: 0,
      card_growth_reserved: 0,
      calculation_status: "complete",
    },
  },
  {
    key: "cards_unconfirmed_short",
    label: "Short (cards unconfirmed overlay)",
    note: "state=\"short\" AND short_reason=\"cards_unconfirmed\" — the fail-closed reserve for an unlearned card repayment, clamped to £0 rather than showing a false positive figure.",
    data: {
      status: "ok",
      safe_to_spend: 0,
      next_payday: "2026-09-28",
      days_until_payday: 9,
      bills_total: 210,
      income_before_payday: 0,
      buffer: 100,
      state: "short",
      short_reason: "cards_unconfirmed",
      estimated: false,
      spendable_now: 340,
      payday_income: 2450,
      card_debt: 2100,
      last_synced: RECENT_SYNC,
      safe_to_spend_cash: 130,
      lowest_projected_balance: 230,
      card_growth_total: 950,
      card_new_spend_total: 820,
      card_growth_reserved: 130,
      card_growth_wording: "carried",
      calculation_status: "complete",
    },
  },
  {
    key: "degraded",
    label: "Degraded",
    note: "calculation_status=\"degraded\" — a reserve lookup failed, so the figure is withheld entirely rather than risk overstating what's free (fail-closed).",
    data: {
      status: "ok",
      safe_to_spend: 0,
      next_payday: "2026-09-28",
      days_until_payday: 9,
      bills_total: 0,
      income_before_payday: 0,
      buffer: 0,
      state: "short",
      estimated: false,
      calculation_status: "degraded",
    },
  },
  {
    key: "unsupported",
    label: "Unsupported",
    note: "status=\"insufficient_data\" with calculation_status=\"unsupported\": this shape existed for the Kenya region, which A98 (commit 5c1a93d2) removed entirely; kept here only as design history for the empty-state variant, not a live backend case.",
    // lib/api.ts's SafeToSpend type does not declare calculation_status on the
    // insufficient_data branch, so this fixture needs a cast to compile. The
    // cast is not evidence of current backend behaviour: A98 (commit
    // 5c1a93d2) removed the Kenya region, and nothing in backend/ (including
    // routers/analytics.py) emits calculation_status="unsupported" any more.
    // This entry models a removed case, retained purely so the empty-state
    // variant still has a fixture to render; it does not reflect what the
    // API returns today. Pre-existing type gap, unrelated to G134's two
    // rejection fixes; cast locally here rather than widening the shared type
    // as part of this fix.
    data: { status: "insufficient_data", calculation_status: "unsupported" } as SafeToSpend,
  },
  {
    key: "insufficient_data",
    label: "Insufficient data",
    note: "status=\"insufficient_data\" without \"unsupported\" — not enough account history yet to map bills.",
    data: { status: "insufficient_data" },
  },
  {
    key: "error",
    label: "Error",
    note: "error=true with data=null — the request itself failed; onRetry is wired so the retry button renders.",
    data: null,
    error: true,
  },
  {
    key: "loading",
    label: "Loading",
    note: "loading=true with data=null — the skeleton shown while the first request is in flight.",
    data: null,
    loading: true,
  },
  {
    key: "hidden",
    label: "Balances hidden",
    note: "Same comfortable payload as the first state, but hideNetWorth is forced true for this render — an overlay driven by PreferencesContext, not a prop on the card itself.",
    data: {
      status: "ok",
      safe_to_spend: 685,
      next_payday: "2026-09-28",
      days_until_payday: 9,
      bills_total: 210,
      income_before_payday: 0,
      buffer: 100,
      state: "comfortable",
      estimated: false,
      spendable_now: 995,
      payday_income: 2450,
      card_debt: 320,
      last_synced: RECENT_SYNC,
      safe_to_spend_cash: 685,
      lowest_projected_balance: 785,
      calculation_status: "complete",
    },
  },
] as const;

// ── HomeBriefClearedRow fixture ──────────────────────────────────────────
export const CLEARED_ADVICE = { count: 2, type: "cliff" as CompanionItem["type"] };

// G169 removed the ThisMonthStrip fixture (THIS_MONTH_SUMMARY) along with
// the component: it was Home's "Last month" strip, a duplicate of the
// month-closed card at the top of Home, so this zone's catalogue entry for
// it was removed too — see HomeInventoryClient.tsx's Zone 7.

// ── AccountLedgerRow fixtures (bankToRow/investmentToRow inputs) ────────
export const LEDGER_ACCOUNTS: Account[] = [
  {
    id: "acc-premier",
    name: "Premier Current",
    type: "transaction",
    subtype: "current",
    balance: 44.68,
    currency: "GBP",
    provider: "Barclays",
    provider_id: "barclays",
    status: "connected",
  },
  {
    id: "acc-savings",
    name: "Easy Access Saver",
    type: "savings",
    subtype: "savings",
    balance: 2100,
    currency: "GBP",
    provider: "Nationwide",
    provider_id: "nationwide",
    status: "connected",
  },
  {
    id: "acc-credit",
    name: "Platinum Cashback",
    type: "credit",
    subtype: "credit_card",
    balance: -731,
    currency: "GBP",
    provider: "Amex",
    provider_id: "amex",
    status: "connected",
  },
  {
    id: "acc-expired",
    name: "Joint Current",
    type: "transaction",
    subtype: "current",
    balance: 620,
    currency: "GBP",
    provider: "NatWest",
    provider_id: "natwest",
    status: "expired",
  },
];

export const LEDGER_INVESTMENT: InvestmentAccount = {
  id: "inv-isa",
  provider: "Vanguard",
  account_type: "Stocks & Shares ISA",
  account_reference: "isa-1",
  currency: "GBP",
  total_value: 9840,
  statement_date: "2026-08-31",
  last_refreshed: "2026-08-31",
  updated_at: "2026-08-31",
  added_since: 0,
  notes_since: 0,
  display_value: 9840,
};

export const LEDGER_PINNED_IDS = ["acc-savings"];

// ── TransactionRow fixtures ──────────────────────────────────────────────
export const RECENT_TRANSACTIONS: Transaction[] = [
  { id: "tx-1", account_id: "acc-premier", date: "2026-09-18", amount: 4.65, currency: "GBP", description: "Dishoom", merchant_name: "Dishoom", category: "Eating out", transaction_type: "debit" },
  { id: "tx-2", account_id: "acc-premier", date: "2026-09-18", amount: 62.0, currency: "GBP", description: "Tesco Stores", merchant_name: "Tesco", category: "Groceries", transaction_type: "debit" },
  { id: "tx-3", account_id: "acc-savings", date: "2026-09-17", amount: 200.0, currency: "GBP", description: "Transfer from Premier Current", category: "Transfer", transaction_type: "credit" },
  { id: "tx-4", account_id: "acc-premier", date: "2026-09-17", amount: 2450.0, currency: "GBP", description: "Auriq Ltd", merchant_name: "Auriq Ltd", category: "Income", transaction_type: "credit" },
  { id: "tx-5", account_id: "acc-credit", date: "2026-09-16", amount: 38.5, currency: "GBP", description: "Transport for London", merchant_name: "TfL", category: "Transport", transaction_type: "debit" },
  { id: "tx-6", account_id: "acc-premier", date: "2026-09-15", amount: 12.99, currency: "GBP", description: "Netflix", merchant_name: "Netflix", category: "Subscriptions", transaction_type: "debit", planned: true },
];

export const PINNED_WIDGET_TRANSACTIONS: Transaction[] = RECENT_TRANSACTIONS;

// ── spendFrom / accountEligibility (Home's hero sub-line, G110) ─────────
export const ACCOUNT_ELIGIBILITY: Record<string, AccountEligibility> = {
  "acc-premier": { short: false, headroom: 340, spend_from_headroom: 340 },
};
