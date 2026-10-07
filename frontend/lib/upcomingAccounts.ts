import type { CashflowData } from "./api";
import { walkUpcomingAccounts } from "./upcomingAccountWalk";

export type UpcomingAccountEvent = {
  id: string;
  name: string;
  date: string;
  kind: "income" | "inflow" | "payment" | "movement";
  /** Signed pounds: incoming positive, outgoing negative. */
  amount: number;
  after: number | null;
  /** The originating cashflow item (same reference as the list row), so a row can be matched to its editor. Never serialised. */
  source?: object;
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

/** Shared coverage boundary: before payday, with the established final-day lookahead. */
export function upcomingAccountWindow(periodEndMs: number, nowMs: number): number {
  const day = 86400000;
  const payday = periodEndMs + day;
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((payday - today) / day) <= 1 ? payday + 5 * day : payday - 1;
}

/** Convenience for consumers needing only the card; no second calculation. */
export function buildUpcomingAccountSummaries(
  cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows">,
  endMs: number,
): UpcomingAccountSummary[] {
  return walkUpcomingAccounts(cashflow, endMs).accounts;
}
