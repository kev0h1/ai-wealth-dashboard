import Constants from "expo-constants";
import { getToken } from "./storage";
import type {
  Account, Transaction, KPIs, DebtInsights, BudgetItem, InvestmentAccount,
} from "@wealth/shared";
export type {
  Account, Transaction, KPIs, DebtInsights, BudgetItem, InvestmentAccount,
} from "@wealth/shared";

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

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
  pinLogin: (pin: string) =>
    post<{ session_token: string; ok: boolean }>("/auth/pin", { pin }),

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
};
