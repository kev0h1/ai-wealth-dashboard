import Constants from "expo-constants";
import { getToken } from "./storage";
import type {
  Account, Transaction, KPIs, DebtInsights, BudgetItem, InvestmentAccount,
  GoalSummary, SavingsInsight, CashflowData, HomePreferences, ValueDelivered,
} from "./shared";
export type {
  Account, Transaction, KPIs, DebtInsights, BudgetItem, InvestmentAccount,
  GoalSummary, SavingsInsight, CashflowData, HomePreferences, ValueDelivered,
} from "./shared";

// ── Additional types for ported screens ──────────────────────────────────────

export type PaceState = "short" | "early" | "comfortable" | "on_pace" | "ahead" | "unavailable";

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
      card_delta?: number;
      pace?: {
        state: PaceState;
        pot?: number;
        days_left?: number;
        days_elapsed?: number;
        period_start?: string;
        discretionary_so_far?: number;
        sustainable?: number;
        actual?: number;
      };
      last_synced?: string | null;
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

export type CompanionAction = {
  label: string;
  route: string;
  kind?: string;
};

export type CompanionItem = {
  id: string;
  type: "move" | "rhythm" | "celebration" | "info" | "needle" | "ask" | "cliff" | "trajectory";
  headline: string;
  body: string;
  action: CompanionAction | null;
  estimated: boolean;
  secondary_action?: CompanionAction | null;
  amount?: number;
  covered?: boolean;
  payload?: {
    category?: string;
    multiple?: number;
    spent?: number;
    period_end?: string;
    dominant?: { name: string; amount: number; date: string } | null;
  } | null;
};

export type TodayResponse = {
  status: "ok";
  items: CompanionItem[];
};

export type NeedleSummary = {
  status: string;
  last_closed: {
    period_start: string;
    period_end: string;
    card_delta: number;
    month_end_cash: number;
    lines: { headline: string; movement: string; cash: string; streak?: string };
  } | null;
  current: { card_delta_so_far: number; cash_now: number; days_to_payday: number; days_into_period: number };
};

export type CardsStory = {
  status: string;
  period: { start: string; end: string; days_elapsed: number };
  movement: { delta: number; new_spend: number; payments: number };
  per_card: {
    account_id: string;
    name: string;
    provider: string;
    balance: number;
    delta: number;
    apr: number | null;
  }[];
  drivers: { category: string; total: number }[];
  pattern_line: string | null;
  trajectory: { period_end: string; delta: number }[];
};

export type CardTerms = {
  apr_pct: number | null;
  promos: { kind: string; apr_pct: number; until: string }[];
  min_payment_note: string | null;
  bt_offers: { ends: string | null; fee_pct: number | null; note: string | null }[];
  status: "confirmed" | "skipped" | null;
  confirmed_at: string | null;
  product_key: string | null;
  usage: "clear_monthly" | "carry" | null;
};

export type CardTermsCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  currency: string;
  source: string;
  terms: CardTerms | null;
  ask_eligible: boolean;
};

export type CardTermsList = {
  status: string;
  cards: CardTermsCard[];
  rate_note: string;
};

export type DebtPlanView = {
  status: string;
  computed_at: string;
  horizon_months: number;
  cards: {
    account_id: string;
    name: string;
    provider: string;
    balance: number;
    currency: string;
    debt: number;
    available: number | null;
    rate_schedule: { from: string; until: string | null; apr_pct: number | null; source: string; kind: string | null }[];
    payoff_month: string | null;
    months_to_payoff: number | null;
    total_interest: number | null;
    monthly_interest_now: number;
    interest_observed_monthly: number;
    paying_interest: boolean;
    flags: { terms_missing: boolean; standard_rate_missing: boolean; thin_history: boolean; assumptions: string[] };
    classification: "cleared_monthly" | "carried_zero" | "carried_interest" | "unclear" | null;
    usage: "clear_monthly" | "carry" | null;
  }[];
  totals: {
    debt: number;
    debt_free_month: string | null;
    monthly_interest_now: number;
    potential_monthly_interest: number;
    interest_to_clear: number;
    verdict: "good" | "drifting" | "bad";
  };
  projection?: { month: string; total: number }[];
  whats_working?: { account_id: string; name: string; payoff_month: string; monthly: number }[];
  extra_to_clear?: { amount: number; debt_free_month: string; horizon_months: number } | null;
  narration?: { text: string; source: "llm" | "fallback" } | null;
};

export type CycleStory = {
  status: "ok" | "no_data";
  early_days?: boolean;
  period?: {
    start: string;
    end: string;
    closed: boolean;
    days_elapsed: number;
    days_to_payday: number;
  };
  narrative?: {
    opening: string;
    month: string;
    moves: string;
    keeping: string;
    close: string;
    self: string;
    source: string;
  };
  cards_link?: boolean;
  is_preview?: boolean;
};

export type UserProfile = {
  full_name: string;
  name_tokens: string[];
  onboarding_complete: boolean;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
};

export type InvestmentHolding = {
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
};

export type PagedTransactions = {
  items: Transaction[];
  total: number;
  page: number;
  pages: number;
};

export type IncomeStream = {
  key: string;
  avg_amount: number;
  occurrences: number;
  schedule: { type: string; weekday?: number; day?: number; anchor?: string } | null;
  schedule_label: string | null;
  next_date: string | null;
  status: "confirmed" | "rejected" | "suggested";
};

export type PlannedExpense = {
  id: string;
  name: string;
  amount: number;
  date: string;
  account_id?: string | null;
  created_at?: string;
};

export type Checkpoint = {
  id: string;
  aim_amount: number;
  spent_so_far: number;
  days_left: number;
  on_track: boolean;
};

export type ActiveAim = Checkpoint & { ref: string };

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

export const logoUrl = (domain: string) => `${API_BASE}/logo/${encodeURIComponent(domain)}`;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function del<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ── API ───────────────────────────────────────────────────────────────────────

export const api = {
  validateSession: async (): Promise<{ valid: boolean; name: string; email: string }> => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/auth/session/validate`, {
      method: "POST",
      headers,
    });
    if (!res.ok) throw new Error("Session invalid");
    return res.json();
  },

  kpis: () => get<KPIs>("/kpis"),

  accounts: () => get<Account[]>("/accounts"),

  syncAccounts: () => post<{ message: string; total_accounts: number }>("/accounts/sync", {}),

  transactions: (accountId: string) =>
    get<Transaction[]>(`/accounts/${accountId}/transactions`),

  allTransactions: () => get<Transaction[]>("/transactions?limit=200"),

  patchTransaction: (id: string, data: { category: string }) =>
    patch<{ updated: string; custom_category: string }>(`/transactions/${id}`, data),

  debtInsights: () => get<DebtInsights>("/debt/insights"),

  debtBurndown: (targetMonths = 12, strategy = "avalanche") =>
    get<{
      burndown: { month: string; actual: number | null; target: number | null; projected: number | null }[];
      current_debt: number;
      target_months: number;
      target_date: string;
      monthly_payment_needed: number;
      total_interest_target: number;
      weighted_apr: number;
      has_rates: boolean;
    }>(`/debt/burndown?target_months=${targetMonths}&strategy=${strategy}`),

  getBudgets: () => get<{ budgets: BudgetItem[] }>("/budgets"),

  setBudgets: async (budgets: BudgetItem[]) => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/budgets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ budgets }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json() as Promise<{ budgets: BudgetItem[] }>;
  },

  getPreferences: () =>
    get<{ hide_net_worth: boolean; dark_mode?: boolean; region?: string }>("/preferences"),

  updatePreferences: async (body: Partial<{ hide_net_worth: boolean; dark_mode: boolean; region: string }>) => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return res.json();
  },

  // Transactions with category filter/summary
  categorySpend: () =>
    get<{ category: string; amount: number; count: number }[]>("/transactions/by-category"),

  getInvestmentAccounts: () =>
    get<{
      id: string;
      provider: string;
      account_type: string;
      total_value: number;
      currency: string;
    }[]>("/investment/accounts"),

  deleteAccount: (accountId: string) => del<{ deleted: string }>(`/accounts/${encodeURIComponent(accountId)}`),

  transactionsByDays: (days: number) =>
    get<Transaction[]>(`/transactions?days=${days}`),

  cashflow: () =>
    get<{
      monthly: { month: string; income: number; spend: number; net: number }[];
      avg_income: number;
      avg_spend: number;
      avg_net: number;
    }>("/cashflow"),

  syncAll: () =>
    post<{ message: string; total_accounts: number }>("/accounts/sync", {}),

  goalsSummary: () => get<{ goals: GoalSummary[] }>("/goals/summary"),

  getSpotlightInsight: () => get<SavingsInsight | null>("/savings-insights/spotlight"),

  valueDelivered: () => get<ValueDelivered>("/value-delivered"),

  dismissSpotlightInsight: (id: string) =>
    post<{ dismissed: boolean }>(`/savings-insights/${id}/dismiss`),

  transactionsDays: (days: number) =>
    get<Transaction[]>(`/transactions?days=${days}`),

  getHomePreferences: () =>
    get<HomePreferences>("/preferences"),

  // ── Home screen ───────────────────────────────────────────────────────────
  safeToSpend: (opts?: { series?: boolean }) =>
    get<SafeToSpend>(`/safe-to-spend${opts?.series ? "?include=series" : ""}`),

  getToday: () => get<TodayResponse>("/today"),

  getNeedleSummary: () => get<NeedleSummary>("/needle/summary"),

  // ── Spend screen ──────────────────────────────────────────────────────────
  paceDetail: (offset = 0) =>
    get<{
      status: string;
      period?: { start: string; end: string; days_elapsed: number; days_left?: number; offset: number; closed: boolean };
      pace?: { state?: PaceState; pot?: number; sustainable?: number | null; actual: number; discretionary_so_far: number };
      choices?: {
        category: string; spent: number; rate_per_day: number; multiple: number | null;
        share_of_discretionary: number | null; txn_count: number; usual_rate_per_day: number | null; txn_ids: string[];
      }[];
      notable_day: null | { date: string; weekday: string; amount: number; usual: number; multiple: number; top_categories: { category: string; total: number }[] };
    }>(`/pace/detail?offset=${offset}`),

  categorySignals: (offset = 0) =>
    get<{
      period: { start: string; end: string; days_elapsed: number; days_left: number | null; offset: number; closed: boolean };
      signals: Record<string, {
        usual_rate_per_day: number | null;
        multiple: number | null;
        suggested_aim: number | null;
        checkpoint: Checkpoint | null;
        intent: "one_off" | "new_normal" | null;
        door_engaged: boolean;
      }>;
    }>(`/spend/category-signals?offset=${offset}`),

  // ── Planning / Cashflow screen ────────────────────────────────────────────
  atRiskCount: () => get<{ count: number }>("/cashflow/at-risk-count"),

  dismissRecurring: (key: string) =>
    post<{ ok: boolean }>("/cashflow/dismiss-recurring", { key }),

  editUpcoming: (params: { key: string; date: string; new_date?: string | null; new_amount?: number | null; scope: "one" | "future" }) =>
    post<{ ok: boolean }>("/cashflow/edit-upcoming", params),

  addPlanned: (params: { name: string; amount: number; date: string; account_id?: string }) =>
    post<{ planned: PlannedExpense; impact: { safe_to_spend_before: number | null; safe_to_spend_after: number | null; state_after: "comfortable" | "tight" | "short" | null } }>("/planned", params),

  getPlanned: () => get<PlannedExpense[]>("/planned"),

  deletePlanned: (id: string) => del<{ ok: boolean }>(`/planned/${encodeURIComponent(id)}`),

  // ── Insights screen ───────────────────────────────────────────────────────
  insights: () => get<{ id: string; title: string; impact: number; confidence: number; rationale: string; action: string; category: string }[]>("/insights"),

  getSavingsInsights: () => get<SavingsInsight[]>("/savings-insights"),

  newInsightCount: () => get<{ count: number }>("/savings-insights/new-count"),

  markInsightsViewed: () => post<{ ok: boolean }>("/savings-insights/mark-viewed", {}),

  refreshSavingsInsights: () => post<{ message: string }>("/savings-insights/refresh", {}),

  pinSavingsInsight: (id: string) =>
    patch<{ pinned: boolean }>(`/savings-insights/${encodeURIComponent(id)}/pin`, {}),

  // ── Settings screen ───────────────────────────────────────────────────────
  getProfile: () => get<UserProfile>("/profile"),

  updateProfile: async (full_name: string, postcode?: string, complete = true): Promise<UserProfile> => {
    const headers = await authHeaders();
    const body: Record<string, unknown> = { full_name, complete };
    if (postcode !== undefined) body.postcode = postcode;
    const res = await fetch(`${API_BASE}/profile`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json() as Promise<UserProfile>;
  },

  getCategories: () => get<{ builtin: string[]; custom: string[]; all: string[] }>("/categories"),

  addCategory: (name: string) =>
    post<{ builtin: string[]; custom: string[]; all: string[] }>("/categories", { name }),

  deleteCategory: async (name: string): Promise<{ deleted: string }> => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/categories/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json() as Promise<{ deleted: string }>;
  },

  getSubscription: () =>
    get<{
      tier: string;
      status: string;
      limits: { max_connections: number | null; history_days: number | null; max_budget_categories: number | null; ai_chat_messages_per_month: number | null };
      features: { savings_insights: boolean; debt_plan_creation: boolean; investment_tracking: boolean; custom_categories: boolean; challenges: boolean; export: boolean };
      usage: { ai_chat_messages: number; receipt_scans: number };
    }>("/subscription"),

  deleteUserAccount: async (): Promise<{ deleted: boolean }> => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/account`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    if (!res.ok) throw new Error("Delete failed");
    return res.json() as Promise<{ deleted: boolean }>;
  },

  // ── Accounts screen ───────────────────────────────────────────────────────
  accountCategories: (accountId: string) =>
    get<{ name: string; total: number; count: number; pct: number }[]>(`/accounts/${accountId}/categories`),

  transactionsPaged: (accountId: string, opts?: { page?: number; pageSize?: number; q?: string; category?: string; days?: number }) => {
    const p = new URLSearchParams();
    if (opts?.page) p.set("page", String(opts.page));
    if (opts?.pageSize) p.set("page_size", String(opts.pageSize));
    if (opts?.q) p.set("q", opts.q);
    if (opts?.category) p.set("category", opts.category);
    if (opts?.days) p.set("days", String(opts.days));
    const qs = p.toString();
    return get<PagedTransactions>(`/accounts/${accountId}/transactions${qs ? `?${qs}` : ""}`);
  },

  getInvestmentHoldings: (id: string) =>
    get<InvestmentHolding[]>(`/investment/accounts/${encodeURIComponent(id)}/holdings`),

  refreshInvestmentPrices: async (id: string): Promise<{ updated: number; new_total: number }> => {
    const headers = await authHeaders();
    const r = await fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(id)}/refresh`, {
      method: "POST",
      headers,
    });
    if (!r.ok) throw new Error(`Error ${r.status}`);
    return r.json() as Promise<{ updated: number; new_total: number }>;
  },

  getAccountRate: (accountId: string) => get<{ apr: number | null }>(`/accounts/${encodeURIComponent(accountId)}/rate`),

  setAccountRate: async (accountId: string, apr: number | null): Promise<{ apr: number | null }> => {
    const headers = await authHeaders();
    const r = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/rate`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ apr }),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<{ apr: number | null }>;
  },

  // ── Month / Cycle screen ──────────────────────────────────────────────────
  getCycleStory: (which: "current" | "last", previewClose?: boolean) =>
    get<CycleStory>(`/cycle/story?which=${which}${previewClose ? "&preview_close=1" : ""}`),

  listCheckpoints: () => get<{ checkpoints: ActiveAim[] }>("/checkpoints"),

  createCheckpoint: (ref: string, aim_amount?: number) =>
    post<Checkpoint>("/checkpoints", aim_amount == null ? { ref } : { ref, aim_amount }),

  cancelCheckpoint: (id: string) => del<{ ok: boolean }>(`/checkpoints/${encodeURIComponent(id)}`),

  // ── Cards screen ──────────────────────────────────────────────────────────
  getCardsStory: (which: "current" | "last" = "current") =>
    get<CardsStory>(`/cards/story?which=${which}`),

  getCardTerms: () => get<CardTermsList>("/card-terms"),

  saveCardTerms: async (accountId: string, body: {
    status: "confirmed" | "skipped";
    apr_pct?: number | null;
    usage?: "clear_monthly" | "carry" | null;
  }): Promise<{ status: string; terms: CardTerms }> => {
    const headers = await authHeaders();
    const r = await fetch(`${API_BASE}/card-terms/${encodeURIComponent(accountId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<{ status: string; terms: CardTerms }>;
  },

  // ── Mirror screen ─────────────────────────────────────────────────────────
  getMirror: (refresh = false) =>
    get<MirrorPortrait>(`/mirror${refresh ? "?refresh=1" : ""}`),

  setMirrorChoice: (trait_id: string, choice: "keep" | "change") =>
    post<{ ok: boolean; trait_id: string; choice: string }>("/mirror/choice", { trait_id, choice }),

  // ── Debt Plan screen ──────────────────────────────────────────────────────
  getDebtPlanView: () => get<DebtPlanView>("/debt-plan"),

  // ── Income streams ────────────────────────────────────────────────────────
  getIncomeStreams: () => get<IncomeStream[]>("/income/streams"),

  confirmIncomeStream: (key: string) =>
    post<IncomeStream>("/income/streams/confirm", { key }),

  rejectIncomeStream: (key: string) =>
    post<{ ok: boolean }>("/income/streams/reject", { key }),

  confirmPayday: () =>
    post<{ ok: boolean; payday: string; schedule: unknown; period: { start: string; end: string } }>("/income/confirm-payday", {}),

  // ── Misc ──────────────────────────────────────────────────────────────────
  dismissTodayItem: (item_id: string) =>
    post<{ ok: boolean }>("/today/dismiss", { item_id }),

  recordTrendIntent: (category: string, answer: "one_off" | "new_normal") =>
    post<{ ok: boolean }>("/trends/intent", { category, answer }),

  health: () => get<{ status: string; truelayer_configured: boolean }>("/health"),
};
