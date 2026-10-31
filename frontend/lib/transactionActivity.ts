import type { Transaction } from "@/lib/api";
import { todayIso } from "@/lib/calendar";
import { dateToUTCDay } from "@/lib/payPeriod";

/** List-only chronology supplied by the server, never a replacement bank date. */
export function transactionActivityDate(transaction: Transaction): string {
  return transaction.activity_date || transaction.date;
}

/** Explain a later bank posting day without moving it above recent activity. */
export function transactionPostingLabel(transaction: Transaction, today = todayIso()): string | null {
  if (transaction.is_pending || !transaction.activity_date) return null;
  const bankDay = dateToUTCDay(transaction.date);
  const activityDay = dateToUTCDay(transaction.activity_date);
  if (!Number.isFinite(bankDay) || !Number.isFinite(activityDay) || bankDay <= activityDay) return null;
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  }).format(new Date(bankDay));
  return `${bankDay > dateToUTCDay(today) ? "Posts" : "Posted"} ${label}`;
}

/** Hide explicit currency amounts in bank narratives without hiding merchant IDs. */
export function maskTransactionText(text: string, hidden: boolean, currency?: string): string {
  if (!hidden) return text;
  const codes = [...new Set(["GBP", "EUR", "USD", "KES", "KSh", currency || ""].filter(code => /^[A-Za-z]{3}$/.test(code)))].join("|");
  const prefix = new RegExp(`(?:[£€$]|\\b(?:${codes})\\s*)\\s*\\d[\\d,.]*`, "gi");
  const suffix = new RegExp(`\\b\\d[\\d,.]*\\s*(?:(?:${codes})\\b|[£€$])`, "gi");
  // Prefixes first: "Terminal 4 USD 38.60" must keep the terminal number.
  return text.replace(prefix, "amount hidden").replace(suffix, "amount hidden");
}
