import type { Account, AccountEligibility, CashflowData } from "./api";
import { sourceClass } from "./coverPlanSourceClass";
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

/** G238: the server's per-account position (backend `compute_account_positions`),
 * pounds. When present the sheet shows these figures instead of recomputing. */
export type UpcomingAccountPosition = {
  afterPayments: number | null;
  plansReserved: number;
  afterPaymentsAndPlans: number | null;
  /** Mid-period minimum running balance minus plans (null when uncertain). */
  lowPointAndPlans: number | null;
  /** The Spend from figure Home shows: min(after payments and plans, low point and plans), live-move reserve and pool cap applied. Null when uncertain or not shown. */
  spendFrom: number | null;
  uncertain: boolean;
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
  /** G238: server position for this account, when the API supplied it. */
  position?: UpcomingAccountPosition;
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

/** G238: map GET /today's `account_eligibility` onto the sheet's position type.
 * Entries from an old API (no position fields) are skipped so the sheet keeps
 * its own arithmetic. */
export function positionsFromToday(
  eligibility: Record<string, AccountEligibility> | null | undefined,
  accounts: Pick<Account, "id" | "type" | "subtype">[],
): Record<string, UpcomingAccountPosition> | null {
  if (!eligibility) return null;
  const out: Record<string, UpcomingAccountPosition> = {};
  const isCurrent = (id: string) => {
    const account = accounts.find((a) => a.id === id);
    return Boolean(account) && sourceClass(account as Account) === "current";
  };
  for (const [id, entry] of Object.entries(eligibility)) {
    if (typeof entry.uncertain !== "boolean" || typeof entry.plans_reserved !== "number") continue;
    out[id] = {
      afterPayments: typeof entry.after_payments === "number" ? entry.after_payments : null,
      plansReserved: entry.plans_reserved,
      afterPaymentsAndPlans: typeof entry.after_payments_and_plans === "number" ? entry.after_payments_and_plans : null,
      lowPointAndPlans: typeof entry.low_point_and_plans === "number" ? entry.low_point_and_plans : null,
      // Home's Spend from (G111) is current accounts only, using sourceClass.
      // Same predicate here, so a savings pot or ISA (or an account not yet
      // loaded) never gets a Spend from line on the sheet.
      spendFrom: isCurrent(id) && !entry.uncertain && typeof entry.spend_from_headroom === "number" ? entry.spend_from_headroom : null,
      uncertain: entry.uncertain,
    };
  }
  return out;
}
