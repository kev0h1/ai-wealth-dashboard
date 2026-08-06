/**
 * Accounts-screen API methods.
 * Only NEW methods that don't exist in mobile/lib/api.ts go here.
 * Import via: import { accountsApi } from "@/lib/api/accounts";
 */

import Constants from "expo-constants";
import { getToken } from "@/lib/storage";
import type { ManualAccount, ManualAccountRule, Transaction } from "@/lib/shared";

export type { ManualAccount, ManualAccountRule } from "@/lib/shared";
export type { ManualAccountType, RuleMatchType, RuleSign } from "@/lib/shared";

// ── Extended InvestmentAccount with all fields used by this screen ────────────
export interface InvestmentAccountFull {
  id: string;
  provider: string;
  account_type: string;
  account_reference: string;
  total_value: number;
  display_value: number | null;
  statement_date: string | null;
  last_refreshed: string | null;
  added_since: number;
  notes_since: number;
  provisional: boolean;
}

export interface InvestmentNote {
  id: string;
  fund_name: string;
  trade_date: string;
  kind: "buy" | "sale";
  amount: number;
  superseded: boolean;
}

export interface AccountCategorySummary {
  name: string;
  total: number;
  count: number;
  pct: number;
}

export interface CardTerms {
  apr_pct: number | null;
  promos: { kind: string; apr_pct: number; until: string }[];
  status: "confirmed" | "skipped" | null;
}

export interface CardTermsCard {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  currency: string;
  terms: CardTerms | null;
}

export interface TermsPill {
  label: string;
  amber?: boolean;
}

export interface UploadStatementResult {
  inserted: number;
  skipped: number;
  bank_name: string;
  account_number: string;
}

export interface UploadInvestmentStatementResult {
  provider: string;
  account_type: string;
  total_value: number;
  holdings_count: number;
}

export interface RNFile {
  uri: string;
  name: string;
  mimeType: string;
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

async function postFormData<T>(path: string, formData: FormData): Promise<T> {
  const authH = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { ...(authH as Record<string, string>) },
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `${res.status}`);
  }
  return res.json();
}

export const accountsApi = {
  // ── Manual Accounts ────────────────────────────────────────────────────────
  manualAccounts: () => get<ManualAccount[]>("/manual-accounts"),

  createManualAccount: (body: { name: string; balance: number; account_type: import("@/lib/shared").ManualAccountType }) =>
    post<ManualAccount>("/manual-accounts", body),

  updateManualAccount: (id: string, body: Partial<{ name: string; balance: number; account_type: import("@/lib/shared").ManualAccountType }>) =>
    patch<ManualAccount>(`/manual-accounts/${encodeURIComponent(id)}`, body),

  deleteManualAccount: (id: string) =>
    del<{ deleted: string }>(`/manual-accounts/${encodeURIComponent(id)}`),

  // ── Manual Transactions ────────────────────────────────────────────────────
  manualTransactions: (accountId: string) =>
    get<Transaction[]>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`),

  addManualTransaction: (accountId: string, body: { description: string; amount: number; transaction_type: "debit" | "credit"; date: string }) =>
    post<Transaction>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions`, body),

  updateManualTransaction: (accountId: string, txId: string, body: Partial<{ description: string; amount: number; transaction_type: "debit" | "credit"; date: string }>) =>
    patch<Transaction>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`, body),

  deleteManualTransaction: (accountId: string, txId: string) =>
    del<{ deleted: string }>(`/manual-accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(txId)}`),

  // ── Paged transactions ────────────────────────────────────────────────────
  transactionsPaged: (accountId: string, opts?: { page?: number; pageSize?: number; q?: string; category?: string; days?: number }) => {
    const p = new URLSearchParams();
    if (opts?.page) p.set("page", String(opts.page));
    if (opts?.pageSize) p.set("page_size", String(opts.pageSize));
    if (opts?.q) p.set("q", opts.q);
    if (opts?.category) p.set("category", opts.category);
    if (opts?.days) p.set("days", String(opts.days));
    const qs = p.toString();
    return get<{ items: Transaction[]; total: number; page: number; pages: number }>(
      `/accounts/${encodeURIComponent(accountId)}/transactions${qs ? `?${qs}` : ""}`
    );
  },

  patchTransaction: (id: string, data: { category: string; additional_ids?: string[] }) =>
    patch<{ updated: string; bulk_count?: number }>(`/transactions/${encodeURIComponent(id)}`, data),

  similarTransactions: (txId: string, scope: "single" | "all" | "future") =>
    get<Transaction[]>(`/transactions/${encodeURIComponent(txId)}/similar?scope=${scope}`),

  // ── Account categories ────────────────────────────────────────────────────
  accountCategories: (accountId: string) =>
    get<AccountCategorySummary[]>(`/accounts/${encodeURIComponent(accountId)}/categories`),

  // ── Investment Accounts (full shape) ──────────────────────────────────────
  getInvestmentAccountsFull: () =>
    get<InvestmentAccountFull[]>("/investment/accounts"),

  deleteInvestmentAccount: (id: string) =>
    del<{ deleted: string }>(`/investment/accounts/${encodeURIComponent(id)}`),

  // ── Investment Notes ────────────────────────────────────────────────────────
  investmentNotes: (accountId: string) =>
    get<InvestmentNote[]>(`/investment/accounts/${encodeURIComponent(accountId)}/notes`),

  uploadInvestmentNote: async (accountId: string, file: RNFile, password?: string): Promise<{ account: InvestmentAccountFull; note: InvestmentNote }> => {
    const fd = new FormData();
    fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (password) fd.append("password", password);
    return postFormData(`/investment/accounts/${encodeURIComponent(accountId)}/notes`, fd);
  },

  uploadInvestmentNoteColdStart: async (file: RNFile, password?: string): Promise<{ account: InvestmentAccountFull }> => {
    const fd = new FormData();
    fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (password) fd.append("password", password);
    return postFormData("/investment/accounts/cold-start", fd);
  },

  deleteInvestmentNote: (noteId: string) =>
    del<{ account: InvestmentAccountFull }>(`/investment/notes/${encodeURIComponent(noteId)}`),

  // ── Investment Statement ────────────────────────────────────────────────────
  uploadInvestmentStatement: async (file: RNFile, password?: string): Promise<UploadInvestmentStatementResult> => {
    const fd = new FormData();
    fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (password) fd.append("password", password);
    return postFormData("/investment/upload", fd);
  },

  // ── Bank Statement ─────────────────────────────────────────────────────────
  uploadStatement: async (file: RNFile, password?: string, region?: string): Promise<UploadStatementResult> => {
    const fd = new FormData();
    fd.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    if (password) fd.append("password", password);
    if (region) fd.append("region", region);
    return postFormData("/statements/upload", fd);
  },

  // ── Manual Account Rules ───────────────────────────────────────────────────
  manualAccountRules: () => get<ManualAccountRule[]>("/manual-account-rules"),

  createManualAccountRule: (body: {
    name: string;
    target_account_id: string;
    source_account_id?: string | null;
    match_type: import("@/lib/shared").RuleMatchType;
    match_value: string;
    sign: import("@/lib/shared").RuleSign;
    backfill?: boolean;
  }) => post<ManualAccountRule>("/manual-account-rules", body),

  updateManualAccountRule: (id: string, body: {
    name?: string;
    match_type?: import("@/lib/shared").RuleMatchType;
    match_value?: string;
    sign?: import("@/lib/shared").RuleSign;
    source_account_id?: string | null;
    active?: boolean;
  }) => patch<ManualAccountRule>(`/manual-account-rules/${encodeURIComponent(id)}`, body),

  deleteManualAccountRule: (id: string) =>
    del<{ deleted: string }>(`/manual-account-rules/${encodeURIComponent(id)}`),

  // ── Card Terms ─────────────────────────────────────────────────────────────
  getCardTerms: () => get<{ cards: CardTermsCard[] }>("/card-terms"),

  createCardTerms: (accountId: string, body: { apr_pct?: number | null; promos?: { kind: string; apr_pct: number; until: string }[] }) =>
    post<{ terms: CardTerms }>(`/card-terms/${encodeURIComponent(accountId)}`, body),

  updateCardTerms: (accountId: string, body: { apr_pct?: number | null; promos?: { kind: string; apr_pct: number; until: string }[] }) =>
    patch<{ terms: CardTerms }>(`/card-terms/${encodeURIComponent(accountId)}`, body),

  // ── OAuth / Connect Links ──────────────────────────────────────────────────
  truelayerProviders: () =>
    get<{ id: string; name: string; logo: string }[]>("/auth/providers"),

  connectLink: (providerId?: string) =>
    get<{ auth_url: string }>(`/auth/connect${providerId ? `?provider=${encodeURIComponent(providerId)}` : ""}`),

  finexerConnectLink: () =>
    get<{ auth_url: string; connection_id: string }>("/finexer/connect"),

  // ── Investment holdings & price refresh ───────────────────────────────────
  getInvestmentHoldings: (accountId: string) =>
    get<import("@/lib/shared").InvestmentHolding[]>(`/investment/accounts/${encodeURIComponent(accountId)}/holdings`),

  refreshInvestmentPrices: async (accountId: string): Promise<{ updated: number; new_total: number }> => {
    const authH = await authHeaders();
    const res = await fetch(`${API_BASE}/investment/accounts/${encodeURIComponent(accountId)}/refresh`, {
      method: "POST",
      headers: authH,
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json() as Promise<{ updated: number; new_total: number }>;
  },

  // ── Preferences (pinned accounts) ─────────────────────────────────────────
  getPreferencesFull: () =>
    get<{ hide_net_worth: boolean; dark_mode?: boolean; region?: string; home_pinned_accounts?: string[] }>("/preferences"),

  updatePinnedAccounts: (homePinnedAccounts: string[]) =>
    patch<Record<string, unknown>>("/preferences", { home_pinned_accounts: homePinnedAccounts }),
};
