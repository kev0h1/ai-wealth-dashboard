import type { Account } from "@/lib/api";
import type { ForecastStatus } from "@/lib/cashForecastStatus";

export type Variant = "a" | "b";
export type Row = { label: string; value: number; total?: boolean };
export type Example = {
  id: string; label: string; headline: number | null; projected: number | null;
  status: ForecastStatus; headlineLabel: string; support: string;
  rows: Row[]; ledgerNote?: string; daily: number | null;
  payday: string; days: number; expectedPay: number | null;
  laterIncome?: { value: number; date: string };
  card: { purchases: number | null; balanceGrowth: number | null; hold: number | null; repayment: "unconfirmed" | "confirmed" | "unknown"; debt: number };
  sources: { account: Account; limit: number }[];
  showCardsLink: boolean; syncing?: boolean;
  recovery?: { label: string; destination: string };
};

export const COUNTS_INTRO = "Based on your connected current accounts and the bills Sorted knows about.";
export const COUNTS_EXCLUSIONS = "It doesn't include other accounts, payments still pending, or bills Sorted hasn't spotted yet.";
export const DISCLAIMER = "An estimate from your bank data. It can be wrong, so check your bank for your latest balance. Not financial advice.";

export function money(value: number | null, exact = false): string {
  if (value === null) return "Unavailable";
  const pennies = exact || (value < 0 && Math.abs(value) < 0.5);
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: pennies ? 2 : 0, maximumFractionDigits: pennies ? 2 : 0,
  })}`;
}

export function dateLabel(iso: string, weekday = false): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { ...(weekday ? { weekday: "short" as const } : {}), day: "numeric", month: "short", timeZone: "Europe/London" });
}
