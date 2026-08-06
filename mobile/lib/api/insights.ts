import Constants from "expo-constants";
import { getToken } from "@/lib/storage";

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SavingsInsights = {
  configured: boolean;
  accounts: {
    account_id: string;
    name: string;
    provider: string;
    balance: number;
    selected: boolean;
    manual: boolean;
  }[];
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

export type SuggestedPlan = {
  mode?: "add" | "replace";
  kind?: "debt" | "savings";
  target_months?: number;
  target_amount?: number;
  milestones: { type: string; text: string; target_balance?: number }[];
};

export type Basket = {
  id: string;
  shop: string | null;
  purchased_at: string | null;
  date_estimated?: boolean;
  currency: string;
  total: number | null;
  item_count: number;
  items: {
    name: string;
    qty: number;
    unit_price: number | null;
    line_price: number | null;
    category: string;
  }[];
  created_at: string | null;
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

export type WorkflowField = {
  key: string;
  label: string;
  type: "text" | "currency" | "select";
  options?: string[];
};

export type WorkflowDef = {
  label: string;
  fields: WorkflowField[];
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { detail?: string };
      if (j.detail) detail = j.detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function put<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── API methods ───────────────────────────────────────────────────────────────

export const insightsApi = {
  savingsInsights: () => get<SavingsInsights>("/savings/insights"),

  saveSavingsGoal: (goal: SavingsGoalInput) =>
    put<SavingsInsights>("/savings/goal", goal),

  deleteSavingsGoal: () =>
    del<{ configured: boolean }>("/savings/goal"),

  addSavingsManualAccount: (body: { name: string; balance: number }) =>
    post<SavingsInsights>("/savings/manual-account", body),

  updateSavingsManualAccount: (id: string, body: { name?: string; balance?: number }) =>
    patch<SavingsInsights>(`/savings/manual-account/${id}`, body),

  deleteSavingsManualAccount: (id: string) =>
    del<SavingsInsights>(`/savings/manual-account/${id}`),

  getSavingsPlan: () =>
    get<{ plan: SavingsPlan | null }>("/savings/plan"),

  toggleSavingsPlanStep: (stepId: string, done: boolean) =>
    patch<{ plan: SavingsPlan | null }>(`/savings/plan/step/${stepId}`, { done }),

  deleteSavingsPlanStep: (stepId: string) =>
    del<{ plan: SavingsPlan | null }>(`/savings/plan/step/${stepId}`),

  deleteSavingsPlan: () =>
    del<{ plan: SavingsPlan | null }>("/savings/plan"),

  listBaskets: () => get<Basket[]>("/baskets"),

  deleteBasket: (id: string) =>
    del<{ ok: boolean }>(`/baskets/${id}`),

  scanReceipt: async (image: string): Promise<Basket> => {
    const headers = await authHeaders();
    const res = await fetch(`${API_BASE}/baskets/scan-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ image }),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const j = (await res.json()) as { detail?: string };
        if (j.detail) detail = j.detail;
      } catch {}
      throw new Error(detail);
    }
    return res.json() as Promise<Basket>;
  },

  getMoneyBasics: (topic?: string) => {
    const qs = topic ? `?topic=${encodeURIComponent(topic)}` : "";
    return get<{ items: MoneyBasic[]; tax_year: string }>(`/money-basics${qs}`);
  },

  getWorkflows: () =>
    get<Record<string, WorkflowDef>>("/savings-insights/workflows"),

  saveInsightContext: (insightId: string, context: Record<string, string>) =>
    post<{ message: string }>(`/savings-insights/${insightId}/context`, { context }),

  getUnknownBills: () =>
    get<{ unknown_bills: unknown; label_options: unknown }>("/savings-insights/unknown-bills"),

  labelBill: (merchant_key: string, category: string) =>
    post<{ message: string; category: string }>("/savings-insights/label", {
      merchant_key,
      category,
    }),

  getBillLabels: () =>
    get<unknown[]>("/savings-insights/labels"),

  deleteBillLabel: (merchant_key: string) =>
    del<{ deleted: string }>(`/savings-insights/labels/${encodeURIComponent(merchant_key)}`),

  taxChat: (messages: { role: string; content: string }[]) =>
    post<{ reply: string }>("/chat/tax", { messages }),
};
