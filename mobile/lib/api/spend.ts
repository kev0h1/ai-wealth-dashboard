// Spend-screen API extensions — methods missing from mobile/lib/api.ts
// These match the frontend/lib/api.ts signatures exactly.

import { getToken } from "@/lib/storage";
import Constants from "expo-constants";
import type { Transaction } from "@/lib/shared";

export type { Transaction };

export interface Checkpoint {
  id: string;
  ref: string;
  aim_amount: number;
  spent_so_far: number;
  days_left: number;
  created_at: string;
}

export interface CategorySignal {
  usual_rate_per_day: number | null;
  multiple: number | null;
  suggested_aim: number | null;
  checkpoint: Checkpoint | null;
  intent: "one_off" | "new_normal" | null;
  door_engaged: boolean;
}

export interface TransportMode {
  name: string;
  total: number;
  monthly: number;
  pct: number;
  colour: string;
  mode: string;
}

export interface TransportTx {
  id: string;
  description: string;
  merchant_name?: string;
  amount: number;
  date: string;
  mode: string;
}

export interface TransportSummary {
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
}

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
  return res.json() as Promise<T>;
}

async function patchReq<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function postReq<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function delReq<T>(path: string): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE", headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const spendApi = {
  /**
   * GET /spend/category-signals?offset=N
   * Returns per-category signals (multiple, checkpoint, intent, door_engaged)
   * for the pay period at `offset` relative to the current one.
   */
  categorySignals: (offset = 0) =>
    get<{
      period: {
        start: string;
        end: string;
        days_elapsed: number;
        days_left: number | null;
        offset: number;
        closed: boolean;
      };
      signals: Record<string, CategorySignal>;
    }>(`/spend/category-signals?offset=${offset}`),

  /**
   * GET /transactions/oldest
   * Returns the date of the oldest transaction — used to bound period nav.
   */
  oldestTransaction: () => get<{ date: string | null }>("/transactions/oldest"),

  /**
   * GET /transactions?limit=500
   * Full transaction list — filtered client-side by pay period.
   */
  allTransactions: () => get<Transaction[]>("/transactions?limit=500"),

  /**
   * PATCH /transactions/:id
   * Update a transaction's category. Supports bulk update via `additional_ids`.
   * Returns bulk_count = number of *additional* transactions updated.
   */
  patchTransaction: (
    id: string,
    data: { category: string; additional_ids?: string[] }
  ) =>
    patchReq<{ updated: string; custom_category: string; bulk_count?: number }>(
      `/transactions/${id}`,
      data
    ),

  /**
   * GET /transactions/:id/similar?scope=all|future
   * Returns transactions similar to :id for bulk re-categorisation.
   * scope "all" = all history; scope "future" = from today onwards.
   */
  similarTransactions: (id: string, scope: "all" | "future") =>
    get<Transaction[]>(`/transactions/${id}/similar?scope=${scope}`),

  /**
   * GET /transport/summary
   * 90-day rolling transport breakdown by mode.
   */
  transportSummary: () => get<TransportSummary>("/transport/summary"),

  /**
   * POST /trends/intent
   * Record whether a spending spike was one-off or a new normal.
   */
  recordTrendIntent: (category: string, answer: "one_off" | "new_normal") =>
    postReq<{ ok: boolean }>("/trends/intent", { category, answer }),

  /**
   * POST /checkpoints
   * Create a spend checkpoint (aim) for a category.
   */
  createCheckpoint: (ref: string, aim_amount?: number) =>
    postReq<Checkpoint>(
      "/checkpoints",
      aim_amount == null ? { ref } : { ref, aim_amount }
    ),

  /**
   * DELETE /checkpoints/:id
   * Cancel an active spend checkpoint.
   */
  cancelCheckpoint: (id: string) =>
    delReq<{ ok: boolean }>(`/checkpoints/${encodeURIComponent(id)}`),

  /**
   * GET /subscription
   * Check subscription tier (gates grocery scanner).
   */
  getSubscription: () =>
    get<{
      tier: string;
      status: string;
      limits: Record<string, unknown>;
      features: Record<string, boolean>;
    }>("/subscription"),

  /**
   * GET /categories
   * Retrieve built-in + custom category list for transaction recategorisation.
   */
  getCategories: () =>
    get<{ builtin: string[]; custom: string[]; all: string[] }>("/categories"),
};
