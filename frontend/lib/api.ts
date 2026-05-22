import { getToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";

export interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  provider: string;
  status: string;
  account_number?: string;
  sort_code?: string;
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
  last_updated: string;
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

export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
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

export const api = {
  health: () => get<{ status: string; truelayer_configured: boolean }>("/health"),
  accounts: () => get<Account[]>("/accounts"),
  syncAccounts: () => post<{ message: string; total_accounts: number }>("/accounts/sync"),
  transactions: (accountId: string) =>
    get<Transaction[]>(`/accounts/${accountId}/transactions`),
  kpis: () => get<KPIs>("/kpis"),
  insights: () => get<Insight[]>("/insights"),
  connectLink: () => get<{ auth_url: string }>("/auth/truelayer/link"),
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
    accounts: { name: string; provider: string; balance: number }[];
    monthly_income: number;
    monthly_spending: number;
    monthly_surplus: number;
    monthly_debt_payment: number;
    payment_needed_12mo: number;
    gap_to_12mo: number;
    months_at_current_rate: number;
    category_spending: Record<string, number>;
    recommendations: { category: string; monthly_spend: number; cut_25pct_saves: number; cut_50pct_saves: number }[];
    recent_discretionary: { id: string; description: string; amount: number; date: string; category: string }[];
  }>("/debt/insights"),
  debtChat: (messages: { role: string; content: string }[], session_id?: string) =>
    post<{ reply: string; session_id?: string }>("/debt/chat", { messages, session_id }),
  getPreferences: () => get<{ hide_net_worth: boolean; dark_mode?: boolean }>("/preferences"),
  updatePreferences: (body: Partial<{ hide_net_worth: boolean; dark_mode: boolean; pay_period_config: unknown }>) =>
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
  syncHistory: () => post<{ message: string; total_accounts: number }>("/accounts/sync-history"),
  deleteAccount: (accountId: string) =>
    fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}`, {
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

  getMpesaAccounts: () => get<MpesaAccount[]>("/mpesa/accounts"),
  getMpesaTransactions: (id: string) => get<Transaction[]>(`/mpesa/accounts/${id}/transactions`),
};
