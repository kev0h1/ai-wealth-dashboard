import type { SpendVerdict, SpendIncomeRow, Transaction } from "@/lib/api";

// G326: the Spend page reads its period from the server verdict's `period`
// object, never from its own pay-period math. Everything here is a pure read
// of that object. The `?? ` fallbacks exist only for a verdict cached before
// the newer fields shipped (they are optional in the shared type), and are
// the one place a client-derived day count survives.

/** "Day N of M" operands from the one server object. */
export function periodDayCount(verdict: SpendVerdict): { day: number; total: number | null } {
  const p = verdict.period;
  if (p.day_number != null && p.length_days != null) return { day: p.day_number, total: p.length_days };
  return { day: p.days_elapsed, total: p.days_left == null ? null : p.days_elapsed + p.days_left };
}

export function periodDayCaption(verdict: SpendVerdict): string {
  const { day, total } = periodDayCount(verdict);
  return `Day ${day}${total != null ? ` of ${total}` : ""}`;
}

/** Server label ("25 Sep to 29 Oct"), or the caller's own label for an older payload. */
export function periodLabelFromVerdict(verdict: SpendVerdict, fallback: string): string {
  return verdict.period.label ?? fallback;
}

/** True once the server has sent the rows behind In. */
export function hasServerIncome(verdict: SpendVerdict): boolean {
  return Array.isArray(verdict.period.income_rows);
}

export function incomeRowToTransaction(row: SpendIncomeRow): Transaction {
  return {
    id: row.id,
    account_id: row.account_id,
    date: row.date,
    amount: Math.abs(row.amount),
    currency: "GBP",
    description: row.description,
    merchant_name: row.merchant_name || undefined,
    category: row.category || "Income",
    transaction_type: row.amount < 0 ? "debit" : "credit",
  };
}

/** The income list: exactly the rows the server counted, largest first. */
export function serverIncomeTransactions(verdict: SpendVerdict): Transaction[] {
  return (verdict.period.income_rows ?? []).map(incomeRowToTransaction);
}

export function incomeRowsTotal(verdict: SpendVerdict): number {
  return Math.round((verdict.period.income_rows ?? []).reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Fixed month names (not Intl) so "Sep" reads the same on every ICU build.
function formatRowDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** Eyebrow for the "pay arrived" timeline node: the real date of the largest
 *  income row, with early-landing pay's attribution made plain. */
export function payArrivedText(verdict: SpendVerdict, fallbackDate: string): string {
  const rows = verdict.period.income_rows;
  if (!rows || rows.length === 0) return `Pay arrived · ${fallbackDate}`;
  const lead = rows[0];
  const date = formatRowDate(lead.date);
  return lead.attributed_early
    ? `Pay arrived ${date}, counted for this period`
    : `Pay arrived · ${date}`;
}
