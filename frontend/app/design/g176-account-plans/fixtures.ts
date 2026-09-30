import type { CashflowData, UpcomingBill } from "@/lib/api";
import type { Plan } from "@/lib/upcomingPlans";
import { remaining } from "@/lib/upcomingPlans";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";

export type Scenario = "gap" | "covered" | "unassigned" | "suggested" | "billgap" | "missing" | "empty" | "overlap";
export const SCENARIOS: { id: Scenario; label: string }[] = [{ id: "gap", label: "Plans need cash" }, { id: "covered", label: "Everything funded" }, { id: "unassigned", label: "Paying account unknown" }, { id: "suggested", label: "Matched from transfers" }, { id: "billgap", label: "A bill is short" }, { id: "missing", label: "Balance unavailable" }, { id: "empty", label: "No set-asides" }, { id: "overlap", label: "Calculation needs checking" }];
export const PERIOD = "Through Thu 29 Oct";
export const ACCOUNTS = [{ id: "monzo", provider: "Monzo", bank: "Monzo", name: "Everyday account", type: "bank", subtype: "current", currency: "GBP", balance: 348, manual: false }, { id: "barclays", provider: "Barclays", bank: "Barclays", name: "Household account", type: "bank", subtype: "current", currency: "GBP", balance: 920, manual: false }, { id: "challenge", provider: "Monzo", bank: "Monzo", name: "Challenge pot", type: "saving", subtype: "saving", currency: "GBP", balance: 60, manual: false }] as const;
export function plansFor(scenario: Scenario): Plan[] { if (scenario === "empty") return []; const suggested = scenario === "suggested"; const unassigned = scenario === "unassigned"; return [{ id: "round-ups", recordId: "allocation-round-ups", kind: "allocation", name: "Savings challenge", destination: "Challenge pot", destinationIds: ["challenge"], sourceId: unassigned ? null : "monzo", evidence: unassigned ? "unknown" : suggested ? "recent-transfers" : "chosen", periodPence: 36000, filledPence: 6000, remainingPence: 30000, active: true, overlapUncertain: scenario === "overlap", overlapReason: "forecast-transfer" }, { id: "holiday", recordId: "goal-holiday", kind: "goal", name: "Summer break", destination: "Holiday pot", destinationIds: ["holiday"], sourceId: unassigned || suggested ? null : "monzo", evidence: unassigned || suggested ? "unknown" : "chosen", periodPence: 6500, filledPence: 0, remainingPence: 6500, active: true }]; }
export function cashflowFor(scenario: Scenario): Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows"> { const opening = scenario === "covered" ? 620 : scenario === "billgap" ? 6 : scenario === "missing" ? null : 348; const bills: UpcomingBill[] = [{ name: "Account membership", amount: 12, expected_date: "2026-10-08", days_away: 8, kind: "commitment", account_id: "monzo", account_name: "Everyday account", account_bank: "Monzo", account_balance: opening }, { name: "Home broadband", amount: 36, expected_date: "2026-10-12", days_away: 12, kind: "commitment", account_id: "barclays", account_name: "Household account", account_bank: "Barclays", account_balance: 920 }]; if (scenario === "overlap") bills.push({ name: "Challenge pot transfer", amount: 300, expected_date: "2026-10-16", days_away: 16, kind: "movement", account_id: "monzo", dest_account_id: "challenge", account_name: "Everyday account", account_bank: "Monzo", account_balance: opening }); return { upcoming_bills: bills, upcoming_income: [], internal_inflows: [] }; }
export function forecastFor(scenario: Scenario) { return walkUpcomingAccounts(cashflowFor(scenario), Date.parse("2026-10-29T23:59:59Z")); }

/** The unchanged hero contract, allocations only, never the new goal overlay. */
export function heroFor(scenario: Scenario, plans: Plan[]) {
  const accounts = forecastFor(scenario).accounts;
  const cash = accounts.reduce((sum, account) => sum + Math.round((account.opening ?? 0) * 100), 0);
  const bills = accounts.reduce((sum, account) => sum + Math.round(account.outgoing * 100), 0);
  const allocations = plans.filter((plan) => plan.kind === "allocation").reduce((sum, plan) => sum + remaining(plan), 0);
  return { cash, bills, allocations, runway: cash - bills - allocations };
}
