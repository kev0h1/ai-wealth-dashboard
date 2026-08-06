/**
 * Settings-screen API additions.
 *
 * This file extends the main api.ts with methods and types needed exclusively
 * by the Settings screen, so we don't pollute the shared API module.
 *
 * Import from here within the settings screen and its sub-components.
 */

import Constants from "expo-constants";
import { getToken } from "@/lib/storage";

const API_BASE: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  "https://wealth.auriqltd.co.uk/api";

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
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

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotificationPrefs = {
  transactions: boolean;
  budget_alerts: boolean;
  goal_milestones: boolean;
  insights: boolean;
  period_digest: boolean;
  bill_alerts: boolean;
};

/**
 * Extended preferences payload covering all settings-screen fields.
 * The main api.ts updatePreferences only handles hide_net_worth / dark_mode / region.
 */
export type SettingsPrefsUpdate = Partial<{
  hide_net_worth: boolean;
  dark_mode: boolean;
  region: string;
  income_value: number;
  pension_annual: number;
  has_child_benefit: boolean;
  notification_prefs: NotificationPrefs;
  cover_plan_excluded_accounts: string[];
}>;

// ── API calls ─────────────────────────────────────────────────────────────────

/**
 * POST /accounts/sync-history
 * Re-fetches the last 90 days from all connected banks.
 */
export const syncHistory = (): Promise<{ message: string; total_accounts: number }> =>
  post("/accounts/sync-history");

/**
 * PATCH /preferences with the full settings-screen payload.
 * This wraps the generic endpoint with stronger typing for the settings screen.
 */
export const updateSettingsPreferences = (body: SettingsPrefsUpdate): Promise<unknown> =>
  patch("/preferences", body);

/**
 * Register an Expo push token with the backend so it can send notifications.
 * Uses the same /push/subscribe endpoint, but sends an Expo token instead of
 * a web PushSubscriptionJSON object.
 */
export const subscribeExpoPush = (
  token: string
): Promise<{ ok: boolean }> =>
  post("/push/subscribe", { expo_push_token: token });
