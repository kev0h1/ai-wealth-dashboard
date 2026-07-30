import { getToken } from "./auth";
import type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleSign,
  SubscriptionInfo,
} from "@wealth/shared";
export type {
  Account, Transaction, MonoAccount, MpesaAccount, KPIs, Insight,
  SavingsInsight, WorkflowStep, WorkflowDef, ChallengeProgress, Challenge,
  ChallengesData, InvestmentAccount, InvestmentHolding, BudgetItem,
  DebtInsights, DebtBurndown, UserPreferences, CategoryRule, BillLabel,
  ManualAccount, ManualAccountType, ManualAccountRule, RuleMatchType, RuleSign,
  SubscriptionInfo,
} from "@wealth/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export const logoUrl = (domain: string) => `${API_BASE}/logo/${encodeURIComponent(domain)}`;

export interface PagedTransactions {
  items: Transaction[];
  total: number;
  page: number;
  pages: number;
}

export interface AccountCategorySummary {
  name: string;
  total: number;
  count: number;
  pct: number;
}

export type NotificationPrefs = {
  transactions: boolean;
  budget_alerts: boolean;
  goal_milestones: boolean;
  insights: boolean;
  period_digest: boolean;
  bill_alerts: boolean;
};

export type GoalSummary = {
  pillar: "debt" | "savings" | "budget";
  label: string;
  detail: string;
  pct: number;
  done: boolean;
  at_risk?: boolean;
  url: string;
};

export type CashflowWeek = {
  label: string;
  projected_income: number;
  projected_spend: number;
  projected_bills: number;
};

export type UpcomingBill = {
  name: string;
  amount: number;
  expected_date: string;
  days_away: number;
  account_id?: string | null;
  account_name?: string | null;
  account_bank?: string | null;
  account_balance?: number | null;
  category?: string | null;
  edited?: boolean;
  rule_label?: string | null;
};

export type IncomeSuggestion = {
  key: string;
  avg_amount: number;
  schedule_label: string | null;
  next_date: string;
};

export type IncomeSchedule = {
  type: "weekly" | "biweekly" | "day_of_month" | "last_weekday";
  weekday?: number;
  day?: number;
  anchor?: string;
};

export type IncomeStream = {
  key: string;
  avg_amount: number;
  occurrences: number;
  schedule: IncomeSchedule | null;
  schedule_label: string | null;
  next_date: string | null;
  status: "confirmed" | "rejected" | "suggested";
};

export type CashflowData = {
  weekly_projection: CashflowWeek[];
  upcoming_bills: UpcomingBill[];
  upcoming_income: UpcomingBill[];
  avg_daily_spend: number;
  available_balance: number;
  next_payday: string | null;
  payday_source: "confirmed" | "period" | null;
  income_suggestion: IncomeSuggestion | null;
};

export type TransportMode = {
  name: string;
  total: number;
  count: number;
  pct: number;
  colour: string;
  monthly: number;
};

export type TransportTx = {
  name: string;
  amount: number;
  date: string;
  mode: string;
};

export type TransportSummary = {
  period_days: number;
  total_spend: number;
  weekly_avg: number;
  monthly_avg: number;
  modes: TransportMode[];
  car_total: number;
  car_monthly: number;
  rideshare_total: number;
  rideshare_monthly: number;
  pt_total: number;
  pt_monthly: number;
  office_days: number;
  wfh_days: number;
  weekdays_in_period: number;
  weekly_commute_cost: number;
  annual_commute_projection: number;
  top_transactions: TransportTx[];
};

export type ValueDelivered = {
  insights_acted_on: number;
  total_monthly_saving: number;
  verified_monthly_saving?: number;
  breakdown: { title: string; monthly_saving: number; estimate_label: string }[];
};

export type MirrorTrait = {
  id: string;
  title: string;
  narrative: string;
  evidence: string[];
  kind: "structure" | "habit" | "pleasure" | "hygiene";
  choice: "keep" | "change" | null;
};

export type MirrorPortrait =
  | { status: "insufficient_data" }
  | {
      status: "ok";
      computed_at: string;
      window_days: number;
      traits: MirrorTrait[];
    };

export type SafeToSpend =
  | { status: "insufficient_data" }
  | {
      status: "ok";
      safe_to_spend: number;
      next_payday: string;
      days_until_payday: number;
      bills_total: number;
      income_before_payday: number;
      buffer: number;
      state: "comfortable" | "tight" | "short";
      estimated: boolean;
      spendable_now?: number;
      payday_income?: number;
      card_debt?: number;
    };

export type MoneyBasic = {
  id: string;
  topic: string;
  icon: string;
  title: string;
  body: string;
  takeaway?: string;
  tax_year: string;
};

export type CompanionAction = {
  label: string;
  route: string;
};

export type CompanionItem = {
  id: string;
  type: "move" | "rhythm" | "celebration" | "info" | "needle";
  headline: string;
  body: string;
  action: CompanionAction | null;
  estimated: boolean;
};

export type TodayResponse = {
  status: "ok";
  items: CompanionItem[];
};

export type DebtPlanMilestone = {
  id: string;
  type: "payment" | "action";
  text: string;
  target_balance: number | null;
  done: boolean;
  done_at: string | null;
  /* Live tracking for spend-cap action steps, derived from transactions */
  live_category?: string;
  live_target?: number;
  live_spend?: number;
};

export type DebtPlan = {
  target_months: number | null;
  debt_at_creation: number | null;
  created_at: string | null;
  milestones: DebtPlanMilestone[];
  done_count: number;
  total_count: number;
  current_debt: number;
};

export type SuggestedPlan = {
  mode?: "add" | "replace";
  kind?: "debt" | "savings";
  target_months?: number;
  target_amount?: number;
  milestones: { type: string; text: string; target_balance?: number }[];
};

export type SavingsAccountOption = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  selected: boolean;
  manual: boolean;
};

export type SavingsInsights = {
  configured: boolean;
  accounts: SavingsAccountOption[];
  current_savings: number;
  target_amount: number;
  target_type: "months" | "amount" | null;
  target_months: number | null;
  pct_funded: number;
  months_funded: number;
  monthly_income: number;
  monthly_spending: number;
  monthly_surplus: number;
  months_to_target: number;
  funded_date: string | null;
  has_data: boolean;
};

export type SavingsGoalInput = {
  target_type: "months" | "amount";
  target_months?: number;
  target_amount?: number;
  account_ids: string[];
};

export type SavingsPlanMilestone = {
  id: string;
  type: "savings" | "action";
  text: string;
  target_balance: number | null;
  done: boolean;
  done_at: string | null;
  live_category?: string;
  live_target?: number;
  live_spend?: number;
};

export type SavingsPlan = {
  target_amount: number | null;
  savings_at_creation: number | null;
  created_at: string | null;
  milestones: SavingsPlanMilestone[];
  done_count: number;
  total_count: number;
  current_savings: number;
};

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// A fetch that dies on a flaky network (e.g. WiFi→mobile handover mid-transfer)
// otherwise hangs indefinitely and pages spin forever waiting on Promise.all.
// Abort stalled GETs and retry once — GETs are safe to repeat.
async function get<T>(path: string, attempt = 0): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const networkErr = e instanceof TypeError; // fetch network failure
    if ((aborted || networkErr) && attempt < 1) return get<T>(path, attempt + 1);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export type UserProfile = {
  full_name: string;
  name_tokens: string[];
  onboarding_complete: boolean;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};

export type FuelStation = {
  node_id: string;
  brand: string | null;
  name: string | null;
  postcode: string | null;
  city: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  ppl: number;
  updated: string | null;
  is_supermarket: boolean;
};

export type FuelNearby = {
  grade: string;
  grade_label: string;
  anchor: { lat: number; lng: number };
  radius_km: number;
  paid_ppl: number | null;
  count: number;
  cheapest_ppl: number | null;
  median_ppl: number | null;
  savings_ppl: number | null;
  snapshot_fetched_at: string | null;
  stations: FuelStation[];
};

export type BasketItem = {
  name: string;
  qty: number;
  unit_price: number | null;
  line_price: number | null;
  category: string;
};

export type Basket = {
  id: string;
  shop: string | null;
  purchased_at: string | null;
  date_estimated?: boolean;
  currency: string;
  total: number | null;
  item_count: number;
  items: BasketItem[];
  created_at: string | null;
};

export type ItemTrend = {
  key: string;
  name: string;
  latest: number;
  previous: number;
  pct_change: number;
  currency: string;
  store: string | null;
  date: string | null;
};

export type StorePrice = {
  key: string;
  name: string;
  cheapest_store: string;
  cheapest_price: number;
  dearest_store: string;
  dearest_price: number;
  saving: number;
  currency: string;
};

export type BasketInsights = {
  receipt_count: number;
  item_trends: ItemTrend[];
  store_prices: StorePrice[];
  headline: string | null;
};

export type NeedleClosed = {
  period_start: string;
  period_end: string;
  card_delta: number;
  month_end_cash: number;
  lines: { headline: string; movement: string; cash: string; streak?: string };
};

export type NeedleSummary = {
  status: string;
  last_closed: NeedleClosed | null;
  current: { card_delta_so_far: number; cash_now: number; days_to_payday: number; days_into_period: number };
};

export type CardsStoryCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  delta: number;
  apr: number | null;
};

export type CardsStory = {
  status: string;
  period: { start: string; end: string; days_elapsed: number };
  movement: { delta: number; new_spend: number; payments: number };
  per_card: CardsStoryCard[];
  drivers: { category: string; total: number }[];
  pattern_line: string | null;
  trajectory: { period_end: string; delta: number }[];
};

export const api = {
  health: () => get<{ status: string; truelayer_configured: boolean }>("/health"),
  getProfile: () => get<UserProfile>("/profile"),
  updateProfile: async (full_name: string, postcode?: string, complete = true): Promise<UserProfile> => {
    const body: Record<string, unknown> = { full_name, complete };
    if (postcode !== undefined) body.postcode = postcode;
    const res = await fetch(`${API_BASE}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Failed to save");
    return data as UserProfile;
  },
  fuelNearby: (opts: { grade: string; paid?: number; lat?: number; lng?: number; radiusKm?: number }) => {
    const p = new URLSearchParams({ grade: opts.grade });
    if (opts.paid !== undefined) p.set("paid", String(opts.paid));
    if (opts.lat !== undefined) p.set("lat", String(opts.lat));
    if (opts.lng !== undefined) p.set("lng", String(opts.lng));
    if (opts.radiusKm !== undefined) p.set("radius_km", String(opts.radiusKm));
    return get<FuelNearby>(`/fuel/nearby?${p.toString()}`);
  },
  scanReceipt: async (image: string): Promise<Basket> => {
    const res = await fetch(`${API_BASE}/baskets/scan-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ image }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Couldn't scan that receipt");
    return data as Basket;
  },
  listBaskets: () => get<Basket[]>("/baskets"),
  basketInsights: () => get<BasketInsights>("/baskets/insights"),
  getBasket: (id: string) => get<Basket>(`/baskets/${encodeURIComponent(id)}`),
  deleteBasket: (id: string) =>
    fetch(`${API_BASE}/baskets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => r.json()) as Promise<{ ok: boolean }>,
  accounts: () => get<Account[]>("/accounts"),
  syncAccounts: () => post<{ message: string; total_accounts: number }>("/accounts/sync"),
  transactions: (accountId: string, opts?: {
    page?: number; pageSize?: number; q?: string; category?: string; days?: number;
    txnType?: "debit" | "credit";
  }) => {
    const p = new URLSearchParams();
    if (opts?.page) p.set("page", String(opts.page));
    if (opts?.pageSize) p.set("page_size", String(opts.pageSize));
    if (opts?.q) p.set("q", opts.q);
    if (opts?.category) p.set("category", opts.category);
    if (opts?.days) p.set("days", String(opts.days));
    if (opts?.txnType) p.set("txn_type", opts.txnType);
    const qs = p.toString();
    return get<PagedTransactions>(`/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`);
  },
  accountCategories: (accountId: string) =>
    get<AccountCategorySummary[]>(`/accounts/${accountId}/categories`),
  kpis: () => get<KPIs>("/kpis"),
  safeToSpend: () => get<SafeToSpend>("/safe-to-spend"),
  cashflow: () => get<CashflowData>("/cashflow"),
  valueDelivered: () => get<ValueDelivered>("/value-delivered"),
  getMirror: (refresh = false) =>
    get<MirrorPortrait>(`/mirror${refresh ? "?refresh=1" : ""}`),
  setMirrorChoice: (trait_id: string, choice: "keep" | "change") =>
    post<{ ok: boolean; trait_id: string; choice: string }>("/mirror/choice", { trait_id, choice }),
  transportSummary: () => get<TransportSummary>("/transport/summary"),
  oldestTransaction: () => get<{ date: string | null }>("/transactions/oldest"),
  goalsSummary: () => get<{ goals: GoalSummary[] }>("/goals/summary"),
  allTransactions: (days = 365) => get<Transaction[]>(`/transactions?days=${days}`),
  dismissRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/dismiss-recurring", { key }),
  restoreRecurring: (key: string) => post<{ ok: boolean }>("/cashflow/restore-recurring", { key }),
  editUpcoming: (params: { key: string; date: string; new_date?: string | null; new_amount?: number | null; scope: "one" | "future" }) =>
    post<{ ok: boolean }>("/cashflow/edit-upcoming", params),
  clearUpcomingOverride: (params: { key: string; date: string }) =>
    post<{ ok: boolean }>("/cashflow/clear-override", params),
  previewUpcomingRule: (params: { key: string; text: string; anchor_date: string }) =>
    post<{ ok: boolean; schedule?: Record<string, unknown>; label?: string; next_dates?: string[]; error?: string }>("/cashflow/preview-rule", params),
  applyUpcomingRule: (params: { key: string; schedule: Record<string, unknown> }) =>
    post<{ ok: boolean; label?: string }>("/cashflow/apply-rule", params),
  clearUpcomingRule: (params: { key: string }) =>
    post<{ ok: boolean }>("/cashflow/clear-rule", params),
  deleteUserAccount: async (): Promise<{ deleted: boolean }> => {
    const res = await fetch(`${API_BASE}/account`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json();
  },
  insights: () => get<Insight[]>("/insights"),
  truelayerProviders: () => get<{ id: string; name: string; logo: string }[]>("/auth/truelayer/providers"),
  connectLink: (provider?: string) => get<{ auth_url: string }>(`/auth/truelayer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  finexerProviders: () => get<{ id: string; name: string; logo: string }[]>("/auth/finexer/providers"),
  finexerConnectLink: (provider?: string) => get<{ auth_url: string; connection_id: string }>(`/auth/finexer/link${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  mockData: () => get<unknown>("/test/mock-data"),
  validateSession: () =>
    fetch(`${API_BASE}/auth/session/validate`, {
      method: "POST",
      headers: authHeaders(),
    }).then((r) => r.ok),
  patchTransaction: (id: string, data: { category: string; additional_ids?: string[] }) =>
    fetch(`${API_BASE}/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(data),
    }).then((r) => r.json()) as Promise<{ updated: string; custom_category: string; bulk_count: number }>,
  similarTransactions: (id: string, scope: "all" | "future") =>
    get<Transaction[]>(`/transactions/${id}/similar?scope=${scope}`),
  syncAll: () => post<{ message: string }>("/accounts/sync", {}),
  autoCategorise: () => post<{ message: string }>("/transactions/auto-categorise", {}),
  debtInsights: () => get<{
    total_debt: number;
    accounts: { account_id: string; name: string; provider: string; balance: number; apr: number | null; monthly_interest: number }[];
    monthly_income: number;
    monthly_spending: number;
    monthly_surplus: number;
    monthly_debt_payment: number;
    payment_needed_12mo: number;
    gap_to_12mo: number;
    months_at_current_rate: number;
    weighted_apr: number;
    category_spending: Record<string, number>;
    recommendations: { category: string; monthly_spend: number; cut_25pct_saves: number; cut_50pct_saves: number }[];
    recent_discretionary: { id: string; description: string; amount: number; date: string; category: string }[];
  }>("/debt/insights"),
  debtChat: (messages: { role: string; content: string }[], session_id?: string, page_context?: string) =>
    post<{ reply: string; session_id?: string; suggested_plan?: SuggestedPlan | null }>("/debt/chat", { messages, session_id, page_context }),
  taxChat: (messages: { role: string; content: string }[]) =>
    post<{ reply: string }>("/chat/tax", { messages }),
  getDebtPlan: () => get<{ plan: DebtPlan | null }>("/debt/plan"),
  saveDebtPlan: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/debt/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then(r => r.json()) as Promise<{ plan: DebtPlan | null }>,
  addDebtPlanMilestones: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/debt/plan/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then(r => r.json()) as Promise<{ plan: DebtPlan | null; added: number }>,
  toggleDebtPlanStep: (stepId: string, done: boolean) =>
    fetch(`${API_BASE}/debt/plan/step/${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ done }),
    }).then(r => r.json()) as Promise<{ plan: DebtPlan | null }>,
  deleteDebtPlanStep: (stepId: string) =>
    fetch(`${API_BASE}/debt/plan/step/${encodeURIComponent(stepId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ plan: DebtPlan | null }>,
  deleteDebtPlan: () =>
    fetch(`${API_BASE}/debt/plan`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ plan: DebtPlan | null }>,
  savingsInsights: () => get<SavingsInsights>("/savings/insights"),
  saveSavingsGoal: (goal: SavingsGoalInput) =>
    fetch(`${API_BASE}/savings/goal`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(goal),
    }).then(r => r.json()) as Promise<SavingsInsights>,
  deleteSavingsGoal: () =>
    fetch(`${API_BASE}/savings/goal`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ configured: boolean }>,
  addSavingsManualAccount: (body: { name: string; balance: number }) =>
    fetch(`${API_BASE}/savings/manual-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<SavingsInsights>,
  updateSavingsManualAccount: (id: string, body: { name?: string; balance?: number }) =>
    fetch(`${API_BASE}/savings/manual-account/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<SavingsInsights>,
  deleteSavingsManualAccount: (id: string) =>
    fetch(`${API_BASE}/savings/manual-account/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<SavingsInsights>,
  getSavingsPlan: () => get<{ plan: SavingsPlan | null }>("/savings/plan"),
  saveSavingsPlan: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/savings/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then(r => r.json()) as Promise<{ plan: SavingsPlan | null }>,
  addSavingsPlanMilestones: (plan: SuggestedPlan) =>
    fetch(`${API_BASE}/savings/plan/milestones`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(plan),
    }).then(r => r.json()) as Promise<{ plan: SavingsPlan | null; added: number }>,
  toggleSavingsPlanStep: (stepId: string, done: boolean) =>
    fetch(`${API_BASE}/savings/plan/step/${encodeURIComponent(stepId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ done }),
    }).then(r => r.json()) as Promise<{ plan: SavingsPlan | null }>,
  deleteSavingsPlanStep: (stepId: string) =>
    fetch(`${API_BASE}/savings/plan/step/${encodeURIComponent(stepId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ plan: SavingsPlan | null }>,
  deleteSavingsPlan: () =>
    fetch(`${API_BASE}/savings/plan`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ plan: SavingsPlan | null }>,
  getPreferences: () => get<{
    hide_net_worth: boolean;
    dark_mode?: boolean;
    notification_prefs?: NotificationPrefs;
    income_bracket?: string;
    income_value?: number;
    pension_annual?: number;
    has_child_benefit?: boolean;
    home_pinned_accounts?: string[];
    home_pinned_cards?: string[];
    recurring_categories?: string[];
    dismissed_recurring?: string[];
    spend_widgets?: string[] | null;
    budget_widgets?: string[] | null;
    home_pinned_widget?: string | null;
  }>("/preferences"),
  updatePreferences: (body: Partial<{
    hide_net_worth: boolean;
    dark_mode: boolean;
    pay_period_config: unknown;
    notification_prefs: NotificationPrefs;
    income_bracket: string;
    income_value: number;
    pension_annual: number;
    has_child_benefit: boolean;
    home_pinned_accounts: string[];
    home_pinned_cards: string[];
    recurring_categories: string[];
    spend_widgets: string[];
    budget_widgets: string[];
    home_pinned_widget: string | null;
  }>) =>
    fetch(`${API_BASE}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<{ hide_net_worth: boolean; dark_mode?: boolean }>,
  getCategories: () => get<{ builtin: string[]; custom: string[]; all: string[] }>("/categories"),
  addCategory: (name: string) => post<{ builtin: string[]; custom: string[]; all: string[] }>("/categories", { name }),
  deleteCategory: (name: string) =>
    fetch(`${API_BASE}/categories/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,
  getChatSession: () => get<{ session_id: string; messages: { role: string; content: string }[] }>("/debt/chat/session"),
  newChatSession: () => post<{ session_id: string; messages: [] }>("/debt/chat/new", {}),
  getBudgets: () => get<{ budgets: { category: string; monthly_limit: number }[] }>("/budgets"),
  setBudgets: (budgets: { category: string; monthly_limit: number }[]) =>
    fetch(`${API_BASE}/budgets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ budgets }),
    }).then(r => r.json()) as Promise<{ budgets: { category: string; monthly_limit: number }[] }>,
  budgetChat: (messages: { role: string; content: string }[], session_id?: string) =>
    post<{ reply: string; session_id?: string; suggested_budgets?: { category: string; monthly_limit: number }[] }>("/budget/chat", { messages, session_id }),
  getBudgetChatSession: () => get<{ session_id: string; messages: { role: string; content: string }[] }>("/budget/chat/session"),
  newBudgetChatSession: () => post<{ session_id: string; messages: [] }>("/budget/chat/new", {}),
  budgetPaceProfile: () => get<{ curves: Record<string, number[]>; sample_points: number; periods_analysed: number }>("/budget/pace-profile"),
  syncHistory: () => post<{ message: string; total_accounts: number }>("/accounts/sync-history"),
  deleteAccount: (accountId: string) =>
    fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  // Offline (manually-tracked) accounts
  manualAccounts: () => get<ManualAccount[]>("/manual-accounts"),
  createManualAccount: (body: { name: string; balance: number; account_type: ManualAccountType }) =>
    post<ManualAccount>("/manual-accounts", body),
  updateManualAccount: (id: string, body: { name?: string; balance?: number; account_type?: ManualAccountType }) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<ManualAccount>,
  deleteManualAccount: (id: string) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  // Offline-account ledger (hand-added + rule-posted entries)
  manualTransactions: (accountId: string) =>
    get<Transaction[]>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`),
  addManualTransaction: (accountId: string, body: { description: string; amount: number; transaction_type: "credit" | "debit"; date?: string }) =>
    post<Transaction>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`, body),
  updateManualTransaction: (accountId: string, txId: string, body: Partial<{ description: string; amount: number; transaction_type: "credit" | "debit"; date: string }>) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<Transaction>,
  deleteManualTransaction: (accountId: string, txId: string) =>
    fetch(`${API_BASE}/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  // Transaction-mirror rules
  manualAccountRules: () => get<ManualAccountRule[]>("/manual-account-rules"),
  createManualAccountRule: (body: {
    name: string; target_account_id: string;
    match_type: RuleMatchType; match_value: string; sign: RuleSign;
  }) => post<ManualAccountRule>("/manual-account-rules", body),
  updateManualAccountRule: (id: string, body: Partial<{
    name: string; match_type: RuleMatchType; match_value: string; sign: RuleSign; active: boolean;
  }>) =>
    fetch(`${API_BASE}/manual-account-rules/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    }).then(r => r.json()) as Promise<ManualAccountRule>,
  deleteManualAccountRule: (id: string) =>
    fetch(`${API_BASE}/manual-account-rules/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  // Yapily (UK open banking)
  yapilyInstitutions: (country = "GB") =>
    get<{ id: string; name: string; logo: string; countries: string[] }[]>(`/auth/yapily/institutions?country=${country}`),
  yapilyRequisition: (institution_id: string) =>
    post<{ link: string; requisition_id: string }>("/auth/yapily/requisition", { institution_id }),
  yapilySync: () => post<{ message: string }>("/yapily/sync", {}),
  deleteYapilyConnection: (consentToken: string) =>
    fetch(`${API_BASE}/yapily/connections/${encodeURIComponent(consentToken)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  // Mono (Kenya open banking)
  monoPublicKey: () => get<{ public_key: string }>("/auth/mono/public-key"),
  monoExchange: (code: string) => post<{ message: string; account_id: string }>("/auth/mono/exchange", { code }),
  monoSync: () => post<{ message: string }>("/mono/sync", {}),
  getMonoAccounts: () => get<MonoAccount[]>("/mono/accounts"),
  getMonoTransactions: (id: string) => get<Transaction[]>(`/mono/accounts/${id}/transactions`),
  deleteMonoConnection: (id: string) =>
    fetch(`${API_BASE}/mono/connections/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: boolean }>,

  // M-Pesa CSV upload (legacy — kept for backward compat)
  uploadMpesa: (file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    return fetch(`${API_BASE}/mpesa/upload`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || `${r.status}`);
      }
      return r.json() as Promise<{ inserted: number; account_id: string }>;
    });
  },

  // Generic bank statement upload (any bank, any region)
  uploadStatement: async (file: File, password?: string, region = "Kenya") => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    form.append("region", region);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000); // 2.5 min

    let r: Response;
    try {
      r = await fetch(`${API_BASE}/statement/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("The request timed out — the file may be too large or the server is busy. Please try again.");
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Network error: ${msg}`);
    }
    clearTimeout(timer);

    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try {
        const body = await r.json();
        if (body?.detail) detail = body.detail;
      } catch {
        try { detail = await r.text() || detail; } catch { /* ignore */ }
      }
      throw new Error(detail);
    }

    return r.json() as Promise<{
      inserted: number;
      skipped: number;
      account_id: string;
      bank_name: string;
      account_number: string;
      balance: number | null;
    }>;
  },

  // Investment accounts
  getInvestmentAccounts: () => get<InvestmentAccount[]>("/investment/accounts"),

  uploadInvestmentStatement: async (file: File, password?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (password) form.append("password", password);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150_000);
    let r: Response;
    try {
      r = await fetch(`${API_BASE}/investment/upload`, {
        method: "POST",
        headers: authHeaders(),
        body: form,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === "AbortError") throw new Error("Request timed out. Please try again.");
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    clearTimeout(timer);
    if (!r.ok) {
      let detail = `Server error (${r.status})`;
      try { const b = await r.json(); if (b?.detail) detail = b.detail; } catch { try { detail = await r.text() || detail; } catch { /* ignore */ } }
      throw new Error(detail);
    }
    return r.json() as Promise<{ account_id: string; provider: string; account_type: string; total_value: number; holdings_count: number }>;
  },

  getInvestmentHoldings: (id: string) =>
    get<InvestmentHolding[]>(`/investment/accounts/${encodeURIComponent(id)}/holdings`),

  deleteInvestmentAccount: (id: string) =>
    fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,

  refreshInvestmentPrices: async (id: string) => {
    const r = await fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(id)}/refresh`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (!r.ok) {
      const b = await r.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error((b?.detail as string) || `Error ${r.status}`);
    }
    return r.json() as Promise<{ updated: number; new_total: number }>;
  },

  challenges: () => get<ChallengesData>("/challenges"),
  getRules: () => get<{ rules: { id: string; description: string; pattern: string; category: string; created_at: string }[] }>("/rules"),
  parseRule: (text: string) => post<{ pattern: string; category: string } | { error: string }>("/rules/parse", { text }),
  addRule: (description: string, pattern: string, category: string) =>
    post<{ id: string; description: string; pattern: string; category: string }>("/rules", { description, pattern, category }),
  setTransactionPlanned: (id: string, planned: boolean) =>
    fetch(`${API_BASE}/transactions/${encodeURIComponent(id)}/planned`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ planned }),
    }).then(r => r.json()) as Promise<{ updated: string; planned: boolean }>,
  deleteRule: (id: string) =>
    fetch(`${API_BASE}/rules/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() }).then(r => r.json()) as Promise<{ deleted: string }>,
  getDailyMoneyBasic: () => get<MoneyBasic>("/money-basics/daily"),
  getMoneyBasics: (topic?: string) =>
    get<{ items: MoneyBasic[]; tax_year: string }>(`/money-basics${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`),
  getSavingsInsights: () => get<SavingsInsight[]>("/savings-insights"),
  newInsightCount: () => get<{ count: number }>("/savings-insights/new-count"),
  markInsightsViewed: () => post<{ ok: boolean }>("/savings-insights/mark-viewed", {}),
  atRiskCount: () => get<{ count: number }>("/cashflow/at-risk-count"),
  getSpotlightInsight: () => get<SavingsInsight | null>("/savings-insights/spotlight"),
  dismissSpotlightInsight: (id: string) =>
    post<{ status: string }>(`/savings-insights/${encodeURIComponent(id)}/dismiss`, {}),
  pinSavingsInsight: (id: string) =>
    fetch(`${API_BASE}/savings-insights/${encodeURIComponent(id)}/pin`, {
      method: "PATCH",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ pinned: boolean }>,
  refreshSavingsInsights: () => post<{ message: string }>("/savings-insights/refresh", {}),
  getUnknownBills: () => get<{
    unknown_bills: { merchant_key: string; display_name: string; monthly_amount: number; occurrences: number }[];
    label_options: Record<string, { icon: string; label: string }>;
  }>("/savings-insights/unknown-bills"),
  labelBill: (merchant_key: string, category: string) =>
    post<{ message: string; category: string }>("/savings-insights/label", { merchant_key, category }),
  getWorkflows: () => get<Record<string, WorkflowDef>>("/savings-insights/workflows"),
  saveInsightContext: (insightId: string, context: Record<string, string>) =>
    fetch(`${API_BASE}/savings-insights/${encodeURIComponent(insightId)}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ context }),
    }).then(r => r.json()) as Promise<{ message: string }>,
  getBillLabels: () => get<{ merchant_key: string; display_name: string; category: string; icon: string; label: string; is_skip: boolean }[]>("/savings-insights/labels"),
  deleteBillLabel: (merchant_key: string) =>
    fetch(`${API_BASE}/savings-insights/labels/${encodeURIComponent(merchant_key)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then(r => r.json()) as Promise<{ deleted: string }>,
  getMpesaAccounts: () => get<MpesaAccount[]>("/mpesa/accounts"),
  getMpesaTransactions: (id: string) => get<Transaction[]>(`/mpesa/accounts/${id}/transactions`),
  getAccountRate: (accountId: string) => get<{ apr: number | null }>(`/accounts/${encodeURIComponent(accountId)}/rate`),
  setAccountRate: (accountId: string, apr: number | null) =>
    fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ apr }),
    }).then(r => r.json()) as Promise<{ apr: number | null }>,

  getVapidPublicKey: () => get<{ public_key: string }>("/push/vapid-public-key"),

  subscribePush: (subscription: PushSubscriptionJSON) =>
    fetch(`${API_BASE}/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(subscription),
    }).then((r) => r.json()) as Promise<{ ok: boolean }>,

  unsubscribePush: (endpoint: string) =>
    fetch(`${API_BASE}/push/subscribe`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ endpoint }),
    }).then((r) => r.json()) as Promise<{ ok: boolean }>,

  getSubscription: () => get<SubscriptionInfo>("/subscription"),

  getIncomeStreams: () => get<IncomeStream[]>("/income/streams"),
  confirmIncomeStream: (key: string) =>
    post<IncomeStream>("/income/streams/confirm", { key }),
  rejectIncomeStream: (key: string) =>
    post<{ ok: boolean }>("/income/streams/reject", { key }),
  setManualIncome: (schedule: IncomeSchedule, amount?: number) =>
    post<IncomeStream>("/income/streams/manual", { schedule, amount }),
  deleteIncomeStream: (key: string) =>
    fetch(`${API_BASE}/income/streams/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: authHeaders(),
    }).then((r) => r.json()) as Promise<{ ok: boolean }>,

  debtBurndown: (targetMonths?: number, strategy?: string, startDate?: string) => get<{
    burndown: {
      month: string;
      actual: number | null;
      target: number | null;
      projected: number | null;
    }[];
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
  }>(`/debt/burndown?${new URLSearchParams({ ...(targetMonths !== undefined ? { target_months: String(targetMonths) } : {}), ...(strategy ? { strategy } : {}), ...(startDate ? { start_date: startDate } : {}) }).toString()}`),

  getToday: () => get<TodayResponse>("/today"),
  getNeedleSummary: () => get<NeedleSummary>("/needle/summary"),
  getCardsStory: () => get<CardsStory>("/cards/story"),

  dismissTodayItem: (item_id: string) =>
    post<{ ok: boolean }>("/today/dismiss", { item_id }),
};
