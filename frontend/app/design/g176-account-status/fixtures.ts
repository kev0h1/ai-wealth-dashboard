import type { CashflowData, UpcomingBill } from "@/lib/api";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";
import { assessPlanOverlap, type Plan } from "@/lib/upcomingPlans";

export const PERIOD = "Payments through Thu 29 Oct";
export const SCENARIOS = [
  { id: "mixed", label: "Some accounts short" },
  { id: "covered", label: "Everything covered" },
  { id: "estimated", label: "Covered with an estimate" },
  { id: "short", label: "All accounts short" },
  { id: "moves", label: "Optional transfers" },
  { id: "unknown", label: "Balance unavailable" },
  { id: "overlap", label: "Calculation needs checking" },
  { id: "large", label: "Long names and large amounts" },
  { id: "loading", label: "Plans loading" },
  { id: "error", label: "Plans could not load" },
  { id: "empty", label: "No account payments" },
] as const;
export type Scenario = (typeof SCENARIOS)[number]["id"];

/** Invented examples. All numbers come through the same walk and plan overlay
 * as production; no live records, alternative funding logic or API services. */
export function fixtureFor(scenario: Scenario) {
  const bills: UpcomingBill[] = [
    { name: "Mobile plan", amount: 18, expected_date: "2026-10-05", days_away: 5, kind: "commitment", account_id: "natwest", account_name: "Bills account", account_bank: "NatWest", account_balance: 60 },
    { name: "Home broadband", amount: 22, expected_date: "2026-10-08", days_away: 8, kind: "commitment", account_id: "barclays", account_name: "Household account", account_bank: "Barclays", account_balance: 108.35 },
    { name: "Council tax", amount: 183, expected_date: "2026-10-12", days_away: 12, kind: "commitment", account_id: "hsbc", account_name: "Current account", account_bank: "HSBC", account_balance: 58.80 },
    { name: "Account membership", amount: 22, expected_date: "2026-10-15", days_away: 15, kind: "commitment", account_id: "monzo", account_name: "Everyday account", account_bank: "Monzo", account_balance: 275.60 },
  ];
  const plans: Plan[] = [{ id: "savings", kind: "allocation", name: "Savings challenge", destination: "Challenge pot", destinationIds: ["challenge"], sourceId: "monzo", evidence: "recent-transfers", periodPence: 32000, filledPence: 4800, remainingPence: 27200, active: true }];
  if (scenario === "covered" || scenario === "estimated") {
    bills[2].account_balance = 300;
    bills[3].account_balance = 425;
    if (scenario === "covered") plans[0].evidence = "chosen";
  }
  if (scenario === "short") bills.forEach((bill) => { bill.account_balance = 5; });
  if (scenario === "moves") {
    bills[2].kind = "movement";
    bills[2].name = "Transfer to savings";
    bills[2].dest_account_id = "savings-pot";
  }
  if (scenario === "unknown") bills[3].account_balance = null;
  if (scenario === "overlap") bills.push({ ...bills[3], name: "Challenge pot transfer", amount: 50, kind: "movement", expected_date: "2026-10-20", days_away: 20, dest_account_id: "challenge" });
  if (scenario === "large") {
    bills[0].account_balance = 1234585.89;
    bills[0].account_name = "Joint household and everyday expenses account";
    bills[1].account_bank = "Nottingham Building Society";
    bills[1].account_name = "Shared household account with a longer name";
  }
  const cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows"> = {
    upcoming_bills: scenario === "empty" ? [] : bills, upcoming_income: [], internal_inflows: [],
  };
  const end = Date.parse("2026-10-29T23:59:59Z");
  return {
    accounts: walkUpcomingAccounts(cashflow, end).accounts,
    plans: scenario === "empty" ? [] : assessPlanOverlap(plans, cashflow, end),
    plansStatus: scenario === "loading" ? "loading" as const : scenario === "error" ? "error" as const : "ready" as const,
  };
}
