/**
 * Debt Plan API methods + types.
 * These are NOT in mobile/lib/api.ts — add here only.
 * The shared api.ts helpers (get, post, authHeaders, API_BASE) are re-implemented
 * here to keep this file independent of api.ts internals.
 */

import Constants from "expo-constants";
import { getToken } from "../storage";

// ── Types ─────────────────────────────────────────────────────────────────────

export type CardPromoKind = "purchases" | "balance_transfer" | "both";

export type CardPromo = {
  kind: CardPromoKind;
  apr_pct: number;
  until: string; // "YYYY-MM-DD" ISO date (last day of end month)
};

export type BtOffer = {
  ends: string | null;       // "YYYY-MM-DD" or null
  fee_pct: number | null;
  note: string | null;
};

export type CardTerms = {
  apr_pct: number | null;
  promos: CardPromo[];
  min_payment_note: string | null;
  bt_offers: BtOffer[];
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

export type CardTermsLookup = {
  status: string;
  product_key: string | null;
  display_name: string | null;
  representative_apr: number | null;
  stale: boolean;
  candidates: string[];
  lookup_status: string;
  source_url: string | null;
  ambiguous: boolean;
  rate_basis: string;
  rate_note: string;
};

export type CardTermsSaveBody = {
  status: "confirmed" | "skipped";
  apr_pct?: number | null;
  promos?: CardPromo[];
  min_payment_note?: string | null;
  bt_offers?: BtOffer[];
  product_key?: string | null;
  usage?: "clear_monthly" | "carry" | null;
};

export type DebtPlanRateSegment = {
  from: string;
  until: string | null;
  apr_pct: number | null;
  source: "promo" | "standard" | "unknown";
  kind: string | null;
};

export type DebtPlanMovement = {
  monthly: number | null;
  per_period: { start: string; end: string; net: number }[];
  periods_used: number;
  basis: string;
};

export type DebtPlanViewCard = {
  account_id: string;
  name: string;
  provider: string;
  balance: number;
  currency: string;
  debt: number;
  available: number | null;
  movement: DebtPlanMovement;
  rate_schedule: DebtPlanRateSegment[];
  payoff_month: string | null;
  months_to_payoff: number | null;
  total_interest: number | null;
  monthly_interest_now: number;
  interest_observed_monthly: number;
  paying_interest: boolean;
  terms_contradiction: boolean;
  potential_monthly_interest: number;
  zero_interest_lines: number;
  first_interest_month: string | null;
  monthly_interest_at_first: number | null;
  flags: {
    terms_missing: boolean;
    standard_rate_missing: boolean;
    thin_history: boolean;
    promo_whole_balance_assumed: boolean;
    assumptions: string[];
  };
  near_term_source: "upcoming bills" | null;
  mapping_ambiguous: boolean;
  classification: "cleared_monthly" | "carried_zero" | "carried_interest" | "unclear" | null;
  classification_evidence: string[];
  usage: "clear_monthly" | "carry" | null;
  usage_conflict: boolean;
  balance_at_first_interest: number | null;
  near_term_bills: {
    name: string;
    amount: number;
    next_date: string;
    confidence: number;
    matched: number;
    occurrences: number;
  }[];
};

export type DebtPlanScenarioB =
  | { months_sooner: null; interest_saved: null; note: string }
  | {
      debt_free_month: string | null;
      total_interest: number;
      window_months: number | null;
      as_is_interest_over_window: number | null;
      interest_saved: number | null;
      months_sooner: number | null;
      as_is_clears: boolean;
      as_is_debt_free_month: string | null;
      pooled_count: number;
      pooled_nonclearing_count: number;
      covers_all_debt: boolean;
      assumption: string;
    };

export type DebtPlanRefinanceOption = {
  source_account_id: string;
  source_name: string;
  destination_account_id: string;
  destination_name: string;
  transferable: number;
  fee: number;
  interest_saved: number;
  net_saving: number;
  window_months: number;
  break_even_weeks: number | null;
  assumptions: string[];
};

export type DebtPlanTotals = {
  debt: number;
  debt_free_month: string | null;
  monthly_interest_now: number;
  potential_monthly_interest: number;
  interest_to_clear: number;
  nonclearing: { count: number; total_balance: number; monthly_interest_share: number };
  verdict: "good" | "drifting" | "bad";
  buckets?: {
    cleared_monthly: number;
    carried_zero: number;
    carried_interest: number;
    unclear: number;
    carried_total: number;
    float_total: number;
    carried_card_count: number;
    cleared_card_count: number;
  };
};

export type DebtPlanProjectionPoint = { month: string; total: number };
export type DebtPlanWin = {
  account_id: string;
  name: string;
  payoff_month: string;
  monthly: number;
};
export type DebtPlanExtraToClear = {
  amount: number;
  debt_free_month: string;
  horizon_months: number;
};
export type DebtPlanHistoryPoint = { month: string; total: number };
export type DebtPlanHistory = {
  points: DebtPlanHistoryPoint[];
  trend_3m: number;
  trend_3m_all: number;
  rising: boolean;
  assumptions: string[];
};
export type DebtPlanNarration = {
  text: string;
  source: "llm" | "fallback";
  ask?: {
    account_id: string;
    name: string;
    provider: string;
    kind: string;
  } | null;
};

export type DebtPlanView = {
  status: string;
  computed_at: string;
  horizon_months: number;
  cards: DebtPlanViewCard[];
  totals: DebtPlanTotals;
  scenario_b: DebtPlanScenarioB;
  refinance_options: DebtPlanRefinanceOption[];
  projection?: DebtPlanProjectionPoint[];
  whats_working?: DebtPlanWin[];
  extra_to_clear?: DebtPlanExtraToClear | null;
  history?: DebtPlanHistory;
  narration?: DebtPlanNarration | null;
};

// ── HTTP helpers (self-contained, do not import from api.ts) ──────────────────

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

async function post<T>(path: string, body?: unknown): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── API methods ───────────────────────────────────────────────────────────────

/** GET /debt-plan — full debt plan view */
export function getDebtPlanView(): Promise<DebtPlanView> {
  return get<DebtPlanView>("/debt-plan");
}

/** GET /card-terms — all credit cards with any saved terms */
export function getCardTerms(): Promise<CardTermsList> {
  return get<CardTermsList>("/card-terms");
}

/**
 * POST /card-terms/:accountId/lookup
 * Queries external sources for a card's representative rate.
 * Returns ambiguous=true when multiple products match; drives candidates phase.
 */
export function lookupCardTerms(accountId: string): Promise<CardTermsLookup> {
  return post<CardTermsLookup>(
    `/card-terms/${encodeURIComponent(accountId)}/lookup`
  );
}

/**
 * POST /card-terms/:accountId
 * Saves confirmed or skipped card terms (status, rate, promos, BT offers, usage).
 */
export async function saveCardTerms(
  accountId: string,
  body: CardTermsSaveBody
): Promise<{ status: string; terms: CardTerms }> {
  const headers = await authHeaders();
  const r = await fetch(
    `${API_BASE}/card-terms/${encodeURIComponent(accountId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }
  );
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<{ status: string; terms: CardTerms }>;
}
