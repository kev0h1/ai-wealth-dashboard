import type { CashflowData } from "./api";
import { upcomingDisplayName } from "./upcomingDisplayName";

export type UpcomingAccountEvent = {
  id: string;
  name: string;
  date: string;
  kind: "income" | "inflow" | "payment" | "movement";
  /** Signed pounds: incoming positive, outgoing negative. */
  amount: number;
  after: number | null;
};

export type UpcomingAccountSummary = {
  id: string;
  bank: string;
  name: string;
  opening: number | null;
  income: number;
  transfersIn: number;
  outgoing: number;
  closing: number | null;
  shortfall: number | null;
  status: "short" | "unfunded" | "covered" | "unknown";
  firstShortDate: string | null;
  hasUnassignedIncome: boolean;
  events: UpcomingAccountEvent[];
};

/**
 * Source-account evidence only. This never feeds the pooled hero calculation.
 * Include accounts with cash payments in the stated window, not card charges
 * or observed/settling debits which have already affected the opening balance.
 * Credits only fund their named destination; unknown income cannot establish
 * coverage. Use pennies, same-day credits first, and retain the lowest balance
 * so a later credit cannot conceal an earlier payment that needs funding.
 */
export function upcomingAccountWindow(periodEndMs: number, nowMs: number): number {
  const day = 86400000;
  const payday = periodEndMs + day;
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((payday - today) / day) <= 1 ? payday + 5 * day : payday - 1;
}

export function buildUpcomingAccountSummaries(
  cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">,
  endMs: number,
): UpcomingAccountSummary[] {
  const inWindow = (date: string) => Number.isFinite(Date.parse(date)) && Date.parse(date) <= endMs;
  const bills = cashflow.upcoming_bills.filter((bill) => inWindow(bill.expected_date) && !bill.is_credit_card && !bill.observed_pending);
  const income = cashflow.upcoming_income.filter((item) => inWindow(item.expected_date));
  const inflows = (cashflow.internal_inflows ?? []).filter((item) => inWindow(item.expected_date));
  const unknownIncome = income.some((item) => !item.account_id);
  const ids = [...new Set(bills.map((bill) => bill.account_id || "__unknown__"))];
  const pennies = (amount: number) => Math.round(amount * 100);

  return ids.map((id): UpcomingAccountSummary => {
    const payments = bills.filter((bill) => (bill.account_id || "__unknown__") === id);
    const first = payments[0];
    const opening = first.account_balance;
    const balanceKnown = id !== "__unknown__" && typeof opening === "number" && Number.isFinite(opening)
      && payments.every((bill) => typeof bill.account_balance === "number" && Number.isFinite(bill.account_balance) && pennies(bill.account_balance) === pennies(opening));
    const credits = income.filter((item) => item.account_id === id);
    const transfers = inflows.filter((item) => item.account_id === id);
    const rawEvents = [
      ...credits.map((item, index) => ({ id: `income-${index}`, name: upcomingDisplayName(item), date: item.expected_date, kind: "income" as const, amount: pennies(item.amount) })),
      ...transfers.map((item, index) => ({ id: `inflow-${index}`, name: item.source_account_name ? `From ${item.source_account_name}` : "Transfer in", date: item.expected_date, kind: "inflow" as const, amount: pennies(item.amount) })),
      ...payments.map((item, index) => ({ id: `payment-${index}`, name: upcomingDisplayName(item), date: item.expected_date, kind: item.kind === "movement" ? "movement" as const : "payment" as const, amount: -pennies(item.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || Number(a.amount < 0) - Number(b.amount < 0));
    let running = balanceKnown ? pennies(opening) : null;
    let gap = 0;
    let billGap = 0;
    let firstShortDate: string | null = null;
    let firstBillShortDate: string | null = null;
    const validAmounts = rawEvents.every((item) => Number.isFinite(item.amount));
    const knownWorking = balanceKnown && validAmounts;
    const events = rawEvents.map((event): UpcomingAccountEvent => {
      if (running !== null) running += event.amount;
      if (running !== null && event.amount < 0 && running < 0) {
        gap = Math.max(gap, -running);
        if (event.kind === "payment") {
          billGap = Math.max(billGap, -running);
          firstBillShortDate ??= event.date;
        }
        firstShortDate ??= event.date;
      }
      return { ...event, amount: event.amount / 100, after: knownWorking && running !== null ? running / 100 : null };
    });
    // Unassigned income funds no named account. It cannot invalidate cash
    // that already covers every payment, but a potential gap stays unknown.
    const verifiable = knownWorking && !(unknownIncome && gap > 0);
    const sum = (values: { amount: number }[]) => values.reduce((total, item) => total + pennies(item.amount), 0) / 100;
    return {
      id,
      bank: first.account_bank || first.account_name || "Account not identified",
      name: first.account_name || (id === "__unknown__" ? "Payment account unavailable" : "Payment account"),
      opening: balanceKnown ? opening : null,
      income: sum(credits),
      transfersIn: sum(transfers),
      outgoing: sum(payments),
      closing: verifiable && running !== null ? running / 100 : null,
      shortfall: verifiable ? (billGap || gap) / 100 : null,
      status: !verifiable ? "unknown" : billGap > 0 ? "short" : gap > 0 ? "unfunded" : "covered",
      firstShortDate: verifiable ? (billGap > 0 ? firstBillShortDate : firstShortDate) : null,
      hasUnassignedIncome: unknownIncome,
      events,
    };
  });
}
