// Canonical types shared between the web and mobile apps.
// The API clients in each app import from here.

export interface Account {
  id: string;
  name: string;
  type: string;
  subtype?: string;
  balance: number;
  currency: string;
  provider: string;
  provider_id?: string;
  status: string;
  account_number?: string;
  sort_code?: string;
  manual?: boolean;
  logo_url?: string;
  bg_colors?: string[];
  apr?: number | null;
}

export type ManualAccountType = "savings" | "current" | "credit_card";

export interface ManualAccount {
  id: string;
  name: string;
  balance: number;
  account_type: ManualAccountType;
  updated_at: string | null;
}

export type RuleMatchType = "description_contains" | "description_equals" | "category";
export type RuleMatchField = "description" | "merchant";
export type RuleSign = "same" | "opposite";

export interface ManualAccountRule {
  id: string;
  name: string;
  target_account_id: string;
  target_account_name: string | null;
  match_type: RuleMatchType;
  match_value: string;
  sign: RuleSign;
  active: boolean;
  /** Optional account scope — null/absent means "any account". */
  source_account_id?: string | null;
  source_account_name?: string | null;
  /** Which single field an equals rule compares. Null for contains/category rules. */
  match_field?: RuleMatchField | null;
  /** Null/absent = matches all history (every rule created before roll-forward existed). */
  applies_from?: string | null;
}

export interface Transaction {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  merchant_name?: string;
  category?: string;
  transaction_type: "debit" | "credit";
  planned?: boolean;
}

export interface MonoAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  provider: string;
  status: string;
  source: "mono";
}

export interface MpesaAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  provider: string;
  status: string;
  source: "mpesa";
}

export interface KPIs {
  net_worth: number;
  cash: number;
  runway: number;
  investments: number;
  pensions: number;
  last_updated: string | null;
}

export interface Insight {
  id: string;
  title: string;
  impact: number;
  confidence: number;
  rationale: string;
  action: string;
  category: string;
}

export interface SavingsInsight {
  id: string;
  category: string;
  /** Visible transaction category this insight can safely annotate in the
   * Spend breakdown. null when there is no reliable one-to-one category
   * (for example, a mortgage identified by merchant rather than category). */
  app_category?: string | null;
  icon: string;
  label: string;
  title: string;
  body: string;
  savings_estimate: string | null;
  /** Numeric monthly £ figure behind `savings_estimate` (e.g. 32 for
   *  "~£32/mo"), parsed server-side so clients never re-derive it. null
   *  when the estimate is absent or unparseable — never a silent 0.
   *  Optional so a client running against an older backend that doesn't
   *  send this field degrades gracefully (treat missing the same as null). */
  savings_estimate_monthly?: number | null;
  pinned: boolean;
  is_new: boolean;
  refreshed_at: string | null;
  triggered_by: {
    merchant_key: string;
    display_name: string;
    monthly_amount: number;
    occurrences: number;
    /** True when `monthly_amount` is the recurring engine's own per-series
     *  figure (exact, matches the card's title/body), false when it's a
     *  plain window average over ad-hoc spend (honest but approximate —
     *  render with a "~" hedge). Optional so a client running against an
     *  older backend degrades to treating it as approximate. */
    is_recurring?: boolean;
  }[];
  user_context: Record<string, string> | null;
  has_workflow: boolean;
  /** In-app route showing the user's own spend for this category (primary action) */
  app_route?: string | null;
  /** Why a dismissed insight came back to the spotlight (null = normal show) */
  return_reason?: string | null;
  /** Parsed contract/deal end date from user context */
  deadline_at?: string | null;
  /** Set when the triggering spend actually ceased AND the whole spend
   *  category confirmed a net drop — a real, verified saving, not an
   *  estimate (see `substituted` below for the "merchant went silent but
   *  the category didn't drop" case, which is NOT a saving). */
  verified_savings?: number | null;
  verified_merchant?: string | null;
  /** "fact" (honest default — no confirmed engagement with this card before
   *  the win verified) or "earned" (confirmed engagement beforehand, via
   *  POST /savings-insights/{id}/opened). Only meaningful when
   *  `verified_savings` is set; null otherwise. Drives copy only — both
   *  tiers use the same banner treatment; see `verified_savings_line` for
   *  the actual rendered sentence. */
  verified_tier?: "fact" | "earned" | null;
  /** Server-composed celebration/fact sentence for verified_savings, built
   *  from whole phrase chunks so the merchant name can never land flush
   *  against the next word. Render verbatim, never re-splice verified_merchant
   *  into a client-side template. null unless verified_savings is set. */
  verified_savings_line?: string | null;
  /** True when the triggering merchant went silent but the insight's whole
   *  spend category never net'd down — the money most likely moved to a
   *  different merchant in the same category, so this is NOT a saving.
   *  Mutually exclusive with `verified_savings` (never both set). Render
   *  neutrally — no celebration styling, no green. */
  substituted?: boolean;
  substituted_merchant?: string | null;
  /** The ceased merchant's own monthly figure — for context in the neutral
   *  copy, NOT a saving figure (see `substituted_line`). */
  substituted_amount?: number | null;
  /** Server-composed neutral sentence for the `substituted` state, e.g.
   *  "Payments to Nandos stopped, but Eating Out overall hasn't moved.
   *  Worth a look at where it went." Render verbatim. null unless
   *  `substituted` is true. */
  substituted_line?: string | null;
  /** A dated-promotion claim's own stated expiry, when the generated body
   *  named a specific time-bound offer. When it's SOONER than the default
   *  weekly TTL it governs `content_valid_until` below (see
   *  `_compute_content_valid_until` in savings_insights.py), otherwise the
   *  default TTL governs and this is informational only. null when no
   *  dated claim was made. Nulled alongside title/body/savings_estimate
   *  whenever `state` is not "fresh". */
  claim_valid_until?: string | null;
  /** OWNER DECISION (2026-09-01, reversing the live "Find me alternatives"
   *  pull model on cost grounds): every category is researched weekly by
   *  the app now (POST /savings-insights/{id}/research is retired), and
   *  every researched entry carries this displayed expiry,
   *  min(claim_valid_until, researched_at + 7 days). Nulled alongside
   *  title/body/savings_estimate whenever `state` is not "fresh" (content
   *  has aged past it, or was never researched at all). */
  content_valid_until?: string | null;
  /** Server-composed Zone 2 expiry sentence, house-style-consistent (same
   *  pattern as `verified_savings_line`/`substituted_line`): "Valid until
   *  Mon 8 Sep" when a real, sooner claim_valid_until governs, else
   *  "Refreshes weekly, researched 2d ago" for generic content on the
   *  default TTL. Render verbatim. null unless `state` is "fresh". */
  expiry_line?: string | null;
  /** When the title/body/savings_estimate above were last actually
   *  researched (web search + LLM), for the always-visible research-age
   *  stamp. null once content has aged past `content_valid_until` or was
   *  never researched (state is not "fresh" in both cases). */
  researched_at?: string | null;
  /** STRUCTURAL FIX (Insights honesty review, owner phone report
   *  2026-09-01: "some have data some do not and it ruins the credibility
   *  of this page") — the single, exhaustive, mutually-exclusive state this
   *  insight is in, derived server-side (see `_derive_insight_state` in
   *  backend/app/routers/savings_insights.py). Every render decision on
   *  this card (banner vs. no banner, compact row vs. full card, content
   *  vs. "checking back soon") should switch on THIS field.
   *    verified    - a genuine, bank-confirmed saving
   *    substituted - the triggering spend stopped, but the whole category
   *                  didn't net down, honestly NOT a saving
   *    fresh       - researched content (title/body/[savings_estimate]) is
   *                  current (now < content_valid_until) and safe to
   *                  render, every category alike (owner decision
   *                  2026-09-01 retired the push/pull cadence split)
   *    quiet       - no current research, compact row, no tap affordance.
   *                  The normal between-weekly-refresh state now, not a
   *                  first-run-only or pull-only case (folds the old
   *                  `push_stale` state into this one)
   *  Optional so a client running against an older backend that doesn't
   *  send this field degrades gracefully. */
  state?: "verified" | "substituted" | "fresh" | "quiet";
  /** Which "money shape" job (see MoneyShape below) this insight's category
   *  lives under, for the Insights tab's job-grouped tip list. "moved" and
   *  "left" are never assigned to an insight (nothing to save on money
   *  already moved to savings or already left over), so this is narrower
   *  than MoneyShapeJob["id"]. Optional/nullable so a client running
   *  against an older backend, or an insight whose category doesn't map
   *  cleanly to a job, degrades to the "Other" group. */
  job?: "fixed" | "free" | null;
}

// ── Money shape (GET /money-shape) ──────────────────────────────────────
// Owner brief 2026-09-02: money has a few jobs, and the proportion between
// them matters more than any line item — describe the user's own shape,
// never grade it (BEHAVIOURS.md's "The Mirror Is Not A Score" named rule,
// same discipline applied here). Backs the Insights tab's redesigned hero
// (MoneyShapeHero), "What works for you" evidence card (WhatWorksCard) and
// the per-job grouping of the existing savings-insight tip cards below
// them — see app/insights/InsightsPage.tsx's SavingsInsightsSection.

export interface MoneyShapeJob {
  id: "fixed" | "moved" | "free" | "left";
  label: string;
  amount: number;
  /** Percent share of take-home, 0-100. Shares across all four jobs sum to
   *  100 (subject to rounding). */
  share: number;
  /** Effective spend categories behind this job this period — drives the
   *  Insights hero's "tap a job to see the transactions behind it" link
   *  (MoneyShapeHero: /transactions?categories=...&from=...&to=...&label=...).
   *  Present on every job the backend sends (including "moved", listing
   *  its movement-kind categories only, e.g. Savings/Investment — no
   *  longer Penny-only), but MAY BE EMPTY when nothing genuinely applies
   *  that period; an empty array is not "no filter", so MoneyShapeHero
   *  falls back to a generic per-job destination rather than link with an
   *  empty filter (see its JOB_HREF fallback). Optional/absent only on an
   *  older backend that predates this field entirely, which falls back
   *  the same way. The overspent "left"/"Beyond take-home" row is a
   *  separate case that ignores this field regardless — see MoneyShapeHero's
   *  `jobHref`. */
  categories?: string[];
  /** "credit" on the "left" job (it's what came IN, not a spend category)
   *  and "debit" on fixed/free/moved. MoneyShapeHero appends it to the
   *  transactions link verbatim whenever present, never hardcodes it.
   *  Optional so an older backend without this field still degrades
   *  gracefully (link just omits `txn_type`, unfiltered by direction).
   *  The overspent "left"/"Beyond take-home" row is a separate case that
   *  hardcodes "debit" itself regardless of this field — see
   *  MoneyShapeHero's `jobHref`. */
  txn_type?: "credit" | "debit";
}

export interface MoneyShapePeriod {
  start: string;
  end: string;
  /** Human-readable range, e.g. "28 Jul to 27 Aug" — render verbatim. */
  label: string;
}

export interface MoneyShapeTrend {
  /** Oldest to newest, one label per pay period. */
  periods: string[];
  fixed: number[];
  moved: number[];
  free: number[];
  left: number[];
}

export interface MoneyShapeEvidenceRow {
  period: string;
  flag: "hit" | "miss";
  /** Signed — negative means the period ended short, render with the −£
   *  currency minus (see formatCash-style helpers), never a plain hyphen. */
  left_over: number;
}

export interface MoneyShapeTrait {
  id: string;
  title: string;
  /** null when the user hasn't made a keep/change call on this trait in
   *  their Mirror yet — see WhatWorksCard's "choose keep or change to
   *  unlock a proposal" line for that state. */
  choice: "keep" | "change" | null;
}

export interface MoneyShapeProposal {
  headline: string;
  body: string;
  /** Question to hand Penny verbatim when the user taps "Propose in
   *  Planning" — never move money without this round-tripping through a
   *  consent-gated Penny turn first. */
  penny_ask: string;
}

export interface MoneyShapeWhatWorks {
  state: "ok" | "thin" | "no_pattern";
  periods_available: number;
  periods_needed: number;
  pattern_id: "early_saving" | "calm_start" | null;
  headline: string;
  /** Chip copy for the evidence rows below — null whenever there are no
   *  rows to label (thin/no_pattern). */
  flag_labels: { hit: string; miss: string } | null;
  evidence: MoneyShapeEvidenceRow[];
  trait: MoneyShapeTrait | null;
  /** Consent-gated Penny proposal — non-null only when the evidence
   *  supports one AND the user hasn't already made a keep/change call.
   *  Render as a "Propose in Planning" block, never auto-apply. */
  proposal: MoneyShapeProposal | null;
}

export interface MoneyShapePeriodEntry {
  start: string;
  end: string;
  /** Human-readable range, e.g. "31 Jul to 27 Aug" — render verbatim
   *  (matches MoneyShapePeriod.label's own convention). */
  label: string;
  take_home: number;
  overspent: number;
  jobs: MoneyShapeJob[];
  /** This period's own server-composed verdict sentence — NOT the same
   *  string as the top-level MoneyShape.verdict except when this is
   *  periods[0] (see money_shape.py's verdict_for, applied per-period
   *  here). Render verbatim via MoneyText. */
  verdict: string | null;
}

export interface MoneyShapeAverageEntry {
  months: 3 | 6 | 12 | 24;
  /** How many real pay periods went into this average — can be less than
   *  `months` worth of periods for a newer account; the honest count to
   *  cite alongside the average, never assumed from `months` alone. */
  period_count: number;
  start: string;
  end: string;
  take_home: number;
  overspent: number;
  /** Mean-per-pay-period amounts/shares over the window — already an
   *  average server-side, render with MoneyText exactly like a single
   *  period's jobs, no client-side averaging. */
  jobs: MoneyShapeJob[];
  /** Server-composed verdict for the averaged window, backend's own
   *  "Over the last {k} pay periods, ..." phrasing — distinct template
   *  from the single-period verdict_for, see money_shape.py. */
  verdict: string | null;
}

export interface MoneyShape {
  /** "thin" = not enough pay-period history yet — render the honest
   *  one-line placeholder, not a zero/empty version of the full shape. */
  status: "ok" | "thin";
  computed_at: string;
  /** null when status is "thin" (no full pay period to report on yet). */
  period: MoneyShapePeriod | null;
  take_home: number;
  /** > 0 when spend exceeded take-home this period — the hero's "Left
   *  over" row becomes "Beyond take-home" for this amount instead (ink
   *  colour, never red — see MoneyShapeHero). 0 in the normal case. */
  overspent: number;
  /** null when status is "thin". Four entries (fixed/moved/free/left) when
   *  present; shares sum to 100. */
  jobs: MoneyShapeJob[] | null;
  /** Server-composed verdict sentence, render verbatim via MoneyText. null
   *  when status is "thin". */
  verdict: string | null;
  trend: MoneyShapeTrend;
  /** Server-composed trend sentence, render verbatim, italic. null when
   *  there isn't yet a meaningful multi-period trend to state. */
  trend_line: string | null;
  what_works: MoneyShapeWhatWorks;
  /** Newest-first recent pay periods, one entry per completed period, each
   *  carrying its OWN take_home/overspent/jobs/verdict — the Insights
   *  hero's period picker selects an index into this array and renders
   *  that entry's own figures (see MoneyShapeHero's `currentEntry`), not a
   *  derived slice of `trend`. `trend`/`trend_line` stay independent of
   *  this — the hero only shows `trend_line` at index 0 (see
   *  MoneyShapeHero's `showTrendLine`). Optional/absent on an older
   *  backend predating this field, or a genuinely thin account with
   *  nothing to list yet — the hero then renders exactly as it did before
   *  this field existed (no picker, `period`/`take_home`/`overspent`/
   *  `jobs`/`verdict` above drive everything, as they always have). */
  periods?: MoneyShapePeriodEntry[];
  /** Mean-per-pay-period figures over a fixed set of horizons (whichever
   *  the backend has enough history for — an entry's absence for a given
   *  `months` means not enough periods yet, not a zero average). Selected
   *  via the same picker as `periods`, in its own sheet section. Optional/
   *  absent the same way `periods` is. */
  averages?: MoneyShapeAverageEntry[];
}

export interface WorkflowStep {
  id: string;
  label: string;
  type: "text" | "number" | "currency" | "select";
  options?: string[];
  placeholder?: string;
  unit?: string;
}

export interface WorkflowDef {
  cta: string;
  steps: WorkflowStep[];
}

export interface ChallengeProgress {
  actual_so_far: number;
  target: number;
  pct_used: number;
  on_track: boolean;
  time_left: string;
}

export interface Challenge {
  id: string;
  tier: "easy" | "medium" | "stretch" | "budget";
  cadence: "daily" | "weekly";
  title: string;
  category: string;
  baseline: number;
  target: number;
  reduction_pct: number;
  currency: string;
  xp_reward: number;
  period_start: string;
  period_end: string;
  status: "active" | "completed" | "failed";
  actual: number | null;
  progress?: ChallengeProgress;
}

export interface ChallengesData {
  stats: {
    total_xp: number;
    level: number;
    xp_in_level: number;
    xp_per_level: number;
    streak: number;
    completed: number;
    failed: number;
  };
  challenges: Challenge[];
  budget_challenges: Challenge[];
  history: Challenge[];
}

export interface InvestmentAccount {
  id: string;
  provider: string;
  account_type: string;
  account_reference: string;
  currency: string;
  total_value: number;
  statement_date: string | null;
  last_refreshed: string | null;
  updated_at: string;
  added_since: number;
  notes_since: number;
  display_value: number;
}

export interface InvestmentNote {
  id: string;
  trade_date: string;
  kind: "purchase" | "sale";
  amount: number;  // signed: + purchase, - sale
  fund_name: string;
  units: number | null;
  price_per_unit: number | null;
  reference: string | null;
  superseded: boolean;
}

export interface InvestmentHolding {
  id: string;
  name: string;
  isin: string | null;
  type: string;
  units: number | null;
  price_per_unit: number | null;
  statement_value: number;
  current_price: number | null;
  current_value: number | null;
  last_refreshed: string | null;
}

export interface BudgetItem {
  category: string;
  monthly_limit: number;
}

export interface DebtAccount {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  apr: number | null;
  monthly_interest: number;
}

export interface DebtRecommendation {
  category: string;
  monthly_spend: number;
  cut_25pct_saves: number;
  cut_50pct_saves: number;
}

export interface DebtInsights {
  total_debt: number;
  accounts: DebtAccount[];
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  monthly_debt_payment: number;
  payment_needed_12mo: number;
  gap_to_12mo: number;
  months_at_current_rate: number;
  weighted_apr: number;
  category_spending: Record<string, number>;
  recommendations: DebtRecommendation[];
  recent_discretionary: {
    id: string;
    description: string;
    amount: number;
    date: string;
    category: string;
  }[];
}

export interface BurndownPoint {
  month: string;
  actual: number | null;
  target: number | null;
  projected: number | null;
}

export interface DebtBurndown {
  burndown: BurndownPoint[];
  current_debt: number;
  target_months: number;
  target_date: string;
  monthly_payment_needed: number;
  currency: string;
  total_interest_target: number;
  total_interest_projected: number;
  weighted_apr: number;
  strategy: string;
  has_rates: boolean;
  start_date: string;
}

export interface UserPreferences {
  hide_net_worth: boolean;
  dark_mode?: boolean;
  region?: string;
  pay_period_config?: unknown;
}

export interface CategoryRule {
  id: string;
  description: string;
  pattern: string;
  category: string;
  created_at: string;
}

export interface BillLabel {
  merchant_key: string;
  display_name: string;
  category: string;
  icon: string;
  label: string;
  is_skip: boolean;
}

export type SubscriptionTier = "statements" | "lite" | "standard" | "connect" | "max";

export interface SubscriptionLimits {
  open_banking: boolean;
  max_banks: number | null;
  max_accounts: number | null;
  refresh: string;
  penny_messages_per_month: number | null;
  mcp_tool_calls_per_month: number | null;
  history_days: number | null;
  statement_uploads_per_month: number | null;
}

export interface SubscriptionTopup {
  messages: number;
  price_gbp: number;
}

export interface SubscriptionUsage {
  year_month: string;
  penny_messages: number;
  cost_usd: number;
}

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: string;
  prices_gbp: Record<string, number>;
  topup: SubscriptionTopup;
  limits: SubscriptionLimits;
  usage: SubscriptionUsage;
}

export interface GrowVerdict {
  /** Factual headline, e.g. "You've got ~£240/month spare" */
  headline: string;
  /** e.g. "Your buffer covers ~4 days" */
  sub: string;
}

export interface GrowBuffer {
  current: number;
  target: number;
  pct: number;
  days_covered: number;
  target_months: number;
}

export interface GrowDebt {
  has_debt: boolean;
  total: number;
  all_promo: boolean;
  expensive_total: number;
  /** ISO date of earliest 0% end, or null */
  promo_cliff: string | null;
}

export interface GrowInvest {
  portfolio_value: number;
  has_investments: boolean;
}

/** Owner decision, 2026-08-30: Grow must never lead with "spare to stash"
 *  when the CURRENT pay period is short — the same fact Home's Safe-to-Spend
 *  hero already gives its "Short this pay period, £X to cover" reading
 *  (backend/app/routers/analytics.py's compute_safe_to_spend, state ===
 *  "short"). Additive alongside the unchanged typical-month figures below;
 *  does not touch surplus_monthly or the median engine. */
export interface GrowPeriodGate {
  short: boolean;
  /** £ still needed to cover the current pay period. 0 when not short. */
  to_cover: number;
  /** ISO date of the next payday this gate resolves at, or null when
   *  status wasn't "ok" (e.g. insufficient data). */
  period_end: string | null;
}

export interface GrowLadderStep {
  key: string;
  title: string;
  /** "attention" is a client-only synthetic state: the period-gate rung
   *  prepended above Essentials when period_gate.short (see GrowVariant1.tsx).
   *  It never comes from the API and never enters the done/active/locked
   *  priority chain the backend computes. */
  state: "done" | "active" | "locked" | "attention";
  /** Facts only */
  detail: string;
  /** Generic trade-off phrasing */
  options: string[];
  /** Optional quiet in-app link rendered under the detail ("›" suffix already in label) */
  link?: { label: string; route: string };
}

export interface GrowView {
  verdict: GrowVerdict;
  surplus_monthly: number;
  buffer: GrowBuffer;
  debt: GrowDebt;
  invest: GrowInvest;
  ladder: GrowLadderStep[];
  notes: string[];
  period_gate: GrowPeriodGate;
}

// ── Month in Review (cycle story) ──────────────────────────────────────────

export interface CycleStoryPeriod {
  start: string;
  end: string;
  closed: boolean;
  days_elapsed: number;
  days_to_payday: number;
}

/** One row of the cards chapter's per-card breakdown. Amounts are absolute;
 *  direction is carried by the sign of `delta` (positive = balance grew). */
export interface CycleStoryCardBreakdown {
  account_id: string;
  name: string;
  /** Provider/institution key as stored on the account record, e.g. "Barclaycard".
   *  Resolve to a brand key via the app's bankKey()-equivalent before display. */
  provider: string;
  new_spend: number;
  delta: number;
}

export interface CycleStoryChapters {
  opening: { income_in: number; count: number };
  cliff: { week1_spend: number; period_spend: number; week1_pct: number; commitments: { payee: string; total: number }[] } | null;
  switch?: { week1_card_pct: number; rest_card_pct: number; switch_day: string | null } | null;
  spending?: {
    total_spend: number;
    income_in: number;
    top_categories: { category: string; total: number }[];
  };
  cards?: {
    present: boolean;
    material: boolean;
    new_spend: number;
    payments: number;
    delta: number;
    share_of_spend: number;
    /** Optional: older cached stories computed before this field existed
     *  omit it entirely. Absent means "no per-card rows available", not "no cards". */
    breakdown?: CycleStoryCardBreakdown[];
  };
  moves: Record<"card_feeding" | "ritual_saving" | "deliberate_saving" | "buffer_draws" | "other_shuffles", { count: number; total: number }>;
  keeping: { set_aside: number; drawn_back: number; external: number; kept: number };
  close: { month_end_cash: number; card_delta: number; streak_weeks: number | null } | null;
  self_facts: { traits: { id: string; title: string; choice: string | null }[]; fired: Record<string, boolean> };
}

export interface CycleStoryNarrative {
  opening: string;
  month: string;
  moves: string;
  keeping: string;
  close: string;
  self: string;
  source: string;
}

export interface CycleStoryTomorrow {
  push_title: string;
  push_body: string;
  brief_headline: string;
  brief_body: string;
}

export interface CycleStory {
  status: "ok" | "no_data";
  early_days?: boolean;
  period?: CycleStoryPeriod;
  chapters?: CycleStoryChapters;
  narrative?: CycleStoryNarrative;
  cards_link?: boolean;
  tomorrow?: CycleStoryTomorrow;
  is_preview?: boolean;
  persona?: string;
  is_demo?: boolean;
}
