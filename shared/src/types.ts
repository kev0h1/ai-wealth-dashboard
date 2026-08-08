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
  icon: string;
  label: string;
  title: string;
  body: string;
  savings_estimate: string | null;
  pinned: boolean;
  is_new: boolean;
  refreshed_at: string | null;
  triggered_by: {
    merchant_key: string;
    display_name: string;
    monthly_amount: number;
    occurrences: number;
  }[];
  user_context: Record<string, string> | null;
  has_workflow: boolean;
  /** Why a dismissed insight came back to the spotlight (null = normal show) */
  return_reason?: string | null;
  /** Parsed contract/deal end date from user context */
  deadline_at?: string | null;
  /** Set when the triggering spend actually ceased — a real saving, not an estimate */
  verified_savings?: number | null;
  verified_merchant?: string | null;
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

export type SubscriptionTier = "free" | "pro" | "premium" | "family";

export interface SubscriptionLimits {
  max_connections: number | null;
  history_days: number | null;
  max_budget_categories: number | null;
  ai_chat_messages_per_month: number | null;
  receipt_scans_per_month: number | null;
}

export interface SubscriptionFeatures {
  savings_insights: boolean;
  debt_plan_creation: boolean;
  investment_tracking: boolean;
  custom_categories: boolean;
  challenges: boolean;
  export: boolean;
}

export interface SubscriptionUsage {
  ai_chat_messages: number;
  receipt_scans: number;
}

export interface TierPrice {
  monthly: number;
  annual: number;
}

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: string;
  limits: SubscriptionLimits;
  features: SubscriptionFeatures;
  usage: SubscriptionUsage;
  prices: Record<string, TierPrice>;
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

export interface GrowLadderStep {
  key: string;
  title: string;
  state: "done" | "active" | "locked";
  /** Facts only */
  detail: string;
  /** Generic trade-off phrasing */
  options: string[];
}

export interface GrowView {
  verdict: GrowVerdict;
  surplus_monthly: number;
  buffer: GrowBuffer;
  debt: GrowDebt;
  invest: GrowInvest;
  ladder: GrowLadderStep[];
  notes: string[];
}
