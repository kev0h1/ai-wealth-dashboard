import type { CashflowData, UpcomingBill } from "@/lib/api";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";

// Invented examples only. This is a proposed breakdown contract, NOT an API
// extension. Existing allocations know their receiving account, not the payer.
// A source can be suggested from transfer evidence or chosen by the user; a
// shared bank/provider/destination is never proof of a source or of duplication.
export type Scenario = "gap" | "covered" | "unassigned" | "billgap" | "missing" | "empty";
export type Variant = "a" | "b";
export type Plan = {
  id: string;
  kind: "allocation" | "goal";
  name: string;
  destination: string;
  sourceId: string | null;
  evidence: "recent-transfers" | "chosen" | "unknown";
  /** Allocation target or this period's goal contribution, never a goal's total target. */
  periodPence: number;
  filledPence: number;
  active: boolean;
};
export type Payment = { name: string; pence: number; date: string; scope: "once" | "future"; skipped: boolean };
export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "gap", label: "Plans need cash" },
  { id: "covered", label: "Everything funded" },
  { id: "unassigned", label: "Paying account unknown" },
  { id: "billgap", label: "A bill is short" },
  { id: "missing", label: "Balance unavailable" },
  { id: "empty", label: "No set-asides" },
];
export const ACCOUNTS = [
  { id: "monzo", bank: "Monzo", name: "Everyday account" },
  { id: "barclays", bank: "Barclays", name: "Household account" },
] as const;
export const PERIOD = "Through Thu 29 Oct";
export const PAYMENT: Payment = { name: "Orchard digital services", pence: 1899, date: "2026-10-01", scope: "once", skipped: false };

export function money(pence: number, positive = false) {
  return `${pence < 0 ? "−" : positive && pence > 0 ? "+" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
export function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}
export function remaining(plan: Plan) {
  return plan.active ? Math.max(0, plan.periodPence - plan.filledPence) : 0;
}
export function plansFor(scenario: Scenario): Plan[] {
  if (scenario === "empty") return [];
  return [
    { id: "round-ups", kind: "allocation", name: "Savings challenge", destination: "Challenge pot", sourceId: scenario === "unassigned" ? null : "monzo", evidence: scenario === "unassigned" ? "unknown" : "recent-transfers", periodPence: 36000, filledPence: 6000, active: true },
    { id: "holiday", kind: "goal", name: "Summer break", destination: "Holiday pot", sourceId: scenario === "unassigned" ? null : "monzo", evidence: scenario === "unassigned" ? "unknown" : "chosen", periodPence: 6500, filledPence: 0, active: true },
  ];
}
export function forecastFor(scenario: Scenario) {
  const opening = scenario === "covered" ? 620 : scenario === "billgap" ? 6 : scenario === "missing" ? null : 348;
  const bills: UpcomingBill[] = [
    { name: "Account membership", amount: 12, expected_date: "2026-10-08", days_away: 8, kind: "commitment", account_id: "monzo", account_name: "Everyday account", account_bank: "Monzo", account_balance: opening },
    { name: "Home broadband", amount: 36, expected_date: "2026-10-12", days_away: 12, kind: "commitment", account_id: "barclays", account_name: "Household account", account_bank: "Barclays", account_balance: 920 },
  ];
  const cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows"> = {
    upcoming_bills: bills, upcoming_income: [], internal_inflows: [],
  };
  return walkUpcomingAccounts(cashflow, Date.parse("2026-10-29T23:59:59Z"));
}

export function accountPlan(account: UpcomingAccountSummary, plans: Plan[]) {
  const assigned = plans.filter((plan) => plan.active && plan.sourceId === account.id && plan.evidence !== "unknown");
  const unassigned = plans.filter((plan) => plan.active && remaining(plan) > 0 && (!plan.sourceId || plan.evidence === "unknown"));
  const allocationPence = assigned.filter((plan) => plan.kind === "allocation").reduce((sum, plan) => sum + remaining(plan), 0);
  const goalPence = assigned.filter((plan) => plan.kind === "goal").reduce((sum, plan) => sum + remaining(plan), 0);
  const reservedPence = allocationPence + goalPence;
  const afterPayments = account.closing === null ? null : Math.round(account.closing * 100);
  const afterPlans = afterPayments === null ? null : afterPayments - reservedPence;
  // A voluntary reserve does not turn a covered payment into a bill-risk flag.
  const planGap = afterPayments === null ? null : Math.max(0, reservedPence - Math.max(0, afterPayments));
  return { assigned, unassigned, allocationPence, goalPence, reservedPence, afterPayments, afterPlans, planGap };
}

/** Keep the existing hero's equation, including its allocations-only reserve.
 * The account plan is a separate "if you set this aside" view and includes
 * proposed goal contributions, which are not new debits in that hero. */
export function heroFor(scenario: Scenario, plans: Plan[]) {
  if (scenario === "missing") return null;
  const accounts = forecastFor(scenario).accounts;
  const cash = accounts.reduce((sum, account) => sum + Math.round((account.opening ?? 0) * 100), 0);
  const bills = accounts.reduce((sum, account) => sum + Math.round(account.outgoing * 100), 0);
  const allocations = plans.filter((plan) => plan.kind === "allocation").reduce((sum, plan) => sum + remaining(plan), 0);
  return { cash, bills, allocations, runway: cash - bills - allocations };
}
