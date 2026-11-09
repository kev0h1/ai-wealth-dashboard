import { currencySymbol, formatCurrency, MINUS } from "./currency";

/** Durable filing evidence returned by the G449 history endpoint. */
export type FilingSource = "all" | "sorted" | "user";
export type FilingActor = Exclude<FilingSource, "all"> | "unknown";

export interface FiledTransferAccount {
  id: string;
  name: string;
  bank: string;
}

export interface FiledTransferLeg {
  id: string;
  account_id: string;
  account_name: string;
  account_bank: string;
  date: string;
  amount: number;
  currency: string;
  transaction_type: "debit" | "credit";
}

export interface FiledTransferOccurrence {
  date: string;
  amount: number;
  currency: string;
  debit: FiledTransferLeg | null;
  credit: FiledTransferLeg | null;
}

export interface FiledTransferItem {
  series_key: string;
  actor: FilingActor;
  kind: "own_transfer" | "other";
  from_account: FiledTransferAccount | null;
  to_account: FiledTransferAccount | null;
  description: string;
  total_amount: number;
  currency: string;
  count: number;
  first_date: string | null;
  last_date: string | null;
  cadence: string | null;
  reason: string | null;
  occurrences: FiledTransferOccurrence[];
  can_undo: boolean;
  undo_count: number;
  history_complete: boolean;
  transactions_href: string | null;
  undo_unavailable_reason?: string | null;
}

export interface FiledTransfersQuery {
  from?: string;
  to?: string;
  source?: FilingSource;
  page?: number;
  page_size?: number;
}

export interface FiledTransfersResponse {
  items: FiledTransferItem[];
  total_series: number;
  page: number;
  page_size: number;
  pages: number;
  scope: { start: string; end: string } | null;
  scope_total: number | null;
  scope_currency: string | null;
  source: FilingSource;
  updated_at: string | null;
  complete: boolean;
}

export interface FiledTransfersUndoResult {
  ok: true;
  undone: number;
  transaction_ids: string[];
  recomputed?: boolean;
  pending?: boolean;
}

export function movementMoney(value: number, currency: string | null | undefined, sign?: "debit" | "credit", hidden = false): string {
  const prefix = sign === "debit" || value < 0 ? MINUS : sign === "credit" ? "+" : "";
  if (!currency) return hidden ? "Amount hidden" : "Currency unavailable";
  if (!Number.isFinite(value)) return "Amount unavailable";
  return prefix + (hidden ? `${currencySymbol(currency)}••••` : formatCurrency(Math.abs(value), currency));
}

/** Prose may carry native-currency figures as well as the GBP Spend total. */
export function maskFilingCopy(value: string, hidden: boolean): string {
  return hidden ? value.replace(/([~−+-]?(?:[£€$]|KSh\s*|KES\s*|\b[A-Z]{3}\s+))\d(?:[\d,]*\d)?(?:\.\d+)?[km]?/g, "$1••••") : value;
}

export function shortFilingDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.valueOf())) return null;
  const nowYear = new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(date.getUTCFullYear() === nowYear ? {} : { year: "numeric" }), timeZone: "UTC" }).format(date);
}

export function isSafeFiledTransfersHref(value: string | null): value is string {
  if (!value || /[\\\x00-\x1f]/.test(value) || value.includes("#") || value.includes("@")) return false;
  try {
    const url = new URL(value, "https://sorted.local");
    return value.startsWith("/") && !value.startsWith("//") && url.origin === "https://sorted.local" && url.pathname === "/transactions" && !url.username && !url.password && !url.hash;
  }
  catch { return false; }
}
