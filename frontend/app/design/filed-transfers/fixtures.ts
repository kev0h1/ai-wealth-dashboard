/** Fictional G449 examples, never fetched from a customer or sent to an API. */
export type FilingSource = "ai" | "rule" | "confirmed";
export type TransferOccurrence = { date: string; amount: number };
export type FiledTransfer = {
  id: string;
  fromBank: string;
  fromAccount: string;
  toBank: string;
  toAccount: string;
  source: FilingSource;
  kind: "transfer" | "other";
  cadence: string;
  reason: string;
  occurrences: TransferOccurrence[];
};
export type FiledScope = "period" | "all";
export type FilingFilter = "all" | "sorted" | "confirmed";
export type TransferView = FiledTransfer & { visibleOccurrences: TransferOccurrence[]; total: number; latest: string };

export const PERIOD = { start: "2026-10-26", end: "2026-11-25", label: "26 Oct to 25 Nov" };
export const AS_OF = "2026-11-09";
export const PAGE_SIZE = 3;
const payments = (amount: number, ...dates: string[]): TransferOccurrence[] => dates.map(date => ({ date, amount }));

export const FILED_TRANSFERS: FiledTransfer[] = [
  { id: "bills", fromBank: "Barclays", fromAccount: "Everyday account", toBank: "HSBC", toAccount: "Bills account", source: "rule", kind: "transfer", cadence: "Monthly", reason: "The amount, date and reference match on both connected accounts.", occurrences: payments(1885, "2026-09-05", "2026-10-05", "2026-11-05") },
  { id: "joint", fromBank: "HSBC", fromAccount: "Everyday account", toBank: "Monzo", toAccount: "Joint household account", source: "confirmed", kind: "transfer", cadence: "Monthly", reason: "You confirmed that these payments are the same transfer each month.", occurrences: payments(420, "2026-10-03", "2026-11-03") },
  { id: "weekly", fromBank: "Barclays", fromAccount: "Everyday account", toBank: "Nationwide", toAccount: "Savings account", source: "ai", kind: "transfer", cadence: "Weekly", reason: "Both entries name your savings account and share the same payment reference.", occurrences: payments(250, "2026-10-19", "2026-10-26", "2026-11-02") },
  { id: "pension", fromBank: "HSBC", fromAccount: "Everyday account", toBank: "Vanguard", toAccount: "Personal pension", source: "ai", kind: "other", cadence: "Monthly", reason: "The matched entries identify your pension contribution, which is grouped as moved money.", occurrences: payments(120, "2026-10-01", "2026-11-01") },
  { id: "pot", fromBank: "Monzo", fromAccount: "Everyday account", toBank: "Monzo", toAccount: "Rainy day pot", source: "rule", kind: "other", cadence: "Weekly", reason: "The bank identifies both entries as a move into your own savings pot.", occurrences: payments(65, "2026-10-21", "2026-10-28", "2026-11-04") },
  { id: "topup", fromBank: "HSBC", fromAccount: "Bills account", toBank: "Barclays", toAccount: "Everyday account", source: "confirmed", kind: "transfer", cadence: "One payment", reason: "You confirmed that these two payments are one transfer.", occurrences: payments(500, "2026-10-20") },
  { id: "holiday", fromBank: "Barclays", fromAccount: "Everyday account", toBank: "Chase", toAccount: "Holiday savings", source: "ai", kind: "transfer", cadence: "Monthly", reason: "The amount and account references match on both sides.", occurrences: payments(80, "2026-09-18", "2026-10-18") },
  { id: "reserve", fromBank: "Monzo", fromAccount: "Joint household account", toBank: "Nationwide", toAccount: "Savings account", source: "rule", kind: "transfer", cadence: "One payment", reason: "The bank identifies a transfer between these connected accounts.", occurrences: payments(45, "2026-10-17") },
  { id: "pennies", fromBank: "Nationwide", fromAccount: "Savings account", toBank: "HSBC", toAccount: "Everyday account", source: "ai", kind: "transfer", cadence: "One payment", reason: "Both accounts show the same small amount and payment reference.", occurrences: payments(0.04, "2026-10-15") },
  { id: "long", fromBank: "HSBC", fromAccount: "Everyday account", toBank: "Monzo", toAccount: "Joint household bills and annual subscriptions account", source: "rule", kind: "transfer", cadence: "Monthly", reason: "The exact payment reference matches the saved transfer rule for this account.", occurrences: payments(135.68, "2026-09-12", "2026-10-12") },
  { id: "return", fromBank: "Chase", fromAccount: "Holiday savings", toBank: "Barclays", toAccount: "Everyday account", source: "ai", kind: "transfer", cadence: "One payment", reason: "The amount and reference agree on both connected accounts.", occurrences: payments(75, "2026-10-08") },
  { id: "standing", fromBank: "Barclays", fromAccount: "Everyday account", toBank: "Nationwide", toAccount: "Savings account", source: "confirmed", kind: "transfer", cadence: "Monthly", reason: "You confirmed this standing order and its matching credit.", occurrences: payments(30, "2026-09-02", "2026-10-02") },
];

export function transferViews(rows: FiledTransfer[], scope: FiledScope, filter: FilingFilter = "all"): TransferView[] {
  return rows.filter(row => filter === "all" || (filter === "confirmed" ? row.source === "confirmed" : row.source !== "confirmed"))
    .map(row => {
      const visibleOccurrences = row.occurrences.filter(item => scope === "all" || (item.date >= PERIOD.start && item.date <= PERIOD.end));
      return { ...row, visibleOccurrences, total: Math.round(visibleOccurrences.reduce((sum, item) => sum + item.amount, 0) * 100) / 100, latest: visibleOccurrences.at(-1)?.date ?? "" };
    }).filter(row => row.visibleOccurrences.length > 0).sort((a, b) => b.latest.localeCompare(a.latest) || a.id.localeCompare(b.id));
}

export function sourceLabel(row: Pick<FiledTransfer, "source">): string {
  return row.source === "confirmed" ? "You confirmed" : row.source === "ai" ? "Filed by Sorted · AI" : "Filed by Sorted · Rule";
}

export function shortDate(value: string): string {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
}
