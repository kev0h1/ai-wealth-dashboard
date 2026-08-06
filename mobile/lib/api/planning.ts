import { PlannedExpense } from "@/lib/api";
import { getToken } from "@/lib/storage";
import Constants from "expo-constants";

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

async function patchReq<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface PlanningUpcomingItem {
  name: string;
  amount: number;
  expected_date: string;
  original_date?: string | null;
  days_away: number;
  account_id?: string | null;
  account_name?: string | null;
  account_bank?: string | null;
  account_balance?: number | null;
  category?: string | null;
  pending?: boolean;
  days_past_due?: number;
  planned?: boolean;
  planned_id?: string | null;
  edited?: boolean;
  rule_label?: string | null;
}

export interface PlanningCashflow {
  upcoming_bills: PlanningUpcomingItem[];
  upcoming_income: PlanningUpcomingItem[];
  available_balance: number | null;
  bills_total?: number;
  next_payday?: string | null;
  monthly?: unknown;
  avg_income?: number;
  avg_spend?: number;
  avg_net?: number;
}

export const planningApi = {
  planningCashflow: (): Promise<PlanningCashflow> =>
    get<PlanningCashflow>("/cashflow"),

  restoreRecurring: (key: string): Promise<{ ok: boolean }> =>
    post("/cashflow/restore-recurring", { key }),

  skipUpcomingOccurrence: (key: string, date: string): Promise<{ ok: boolean }> =>
    post("/cashflow/skip-occurrence", { key, date }),

  updatePlanned: (
    id: string,
    patch_body: { name?: string; amount?: number; date?: string; account_id?: string | null }
  ): Promise<PlannedExpense> =>
    patchReq(`/planned/${encodeURIComponent(id)}`, patch_body),

  clearUpcomingOverride: (params: { key: string; date: string }): Promise<{ ok: boolean }> =>
    post("/cashflow/clear-override", params),

  previewUpcomingRule: (params: {
    key: string;
    text: string;
    anchor_date: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    schedule?: Record<string, unknown>;
    label?: string;
    next_dates?: string[];
  }> => post("/cashflow/preview-rule", params),

  applyUpcomingRule: (params: {
    key: string;
    schedule: Record<string, unknown>;
  }): Promise<{ ok: boolean }> => post("/cashflow/apply-rule", params),

  clearUpcomingRule: (params: { key: string }): Promise<{ ok: boolean }> =>
    post("/cashflow/clear-rule", params),
};
