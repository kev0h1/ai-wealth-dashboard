import type { CashflowData, UpcomingBill } from "@/lib/api";
import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { walkUpcomingAccounts } from "@/lib/upcomingAccountWalk";
import { assessPlanOverlap, type Plan } from "@/lib/upcomingPlans";

export const PERIOD = "Payments through Thu 29 Oct";
export const FIXTURES = [
  { id: "long", label: "Long list, 2 need attention" },
  { id: "watch", label: "One to watch, 5 fine" },
  { id: "clear", label: "All clear" },
  { id: "all", label: "Every account short" },
] as const;
export type FixtureId = (typeof FIXTURES)[number]["id"];

const BANKS = ["Barclays", "NatWest", "HSBC", "Monzo", "Lloyds", "Santander", "Nationwide", "Starling", "First Direct", "Halifax"];
const END = Date.parse("2026-10-29T23:59:59Z");

type Spec = { bank: string; name: string; balance: number | null; bill: number; movement?: boolean };

function build(specs: Spec[], plans: Plan[] = []) {
  const bills: UpcomingBill[] = specs.map((spec, index) => ({
    name: spec.movement ? "Transfer to savings pot" : "Monthly payment",
    amount: spec.bill,
    expected_date: `2026-10-${String(5 + (index % 20)).padStart(2, "0")}`,
    days_away: 5 + (index % 20),
    kind: spec.movement ? "movement" : "commitment",
    account_id: `acct-${index}`,
    account_name: spec.name,
    account_bank: spec.bank,
    account_balance: spec.balance,
    ...(spec.movement ? { dest_account_id: "savings-pot" } : {}),
  }));
  const cashflow: Pick<CashflowData, "upcoming_bills" | "upcoming_income" | "internal_inflows"> = { upcoming_bills: bills, upcoming_income: [], internal_inflows: [] };
  return { accounts: walkUpcomingAccounts(cashflow, END).accounts as UpcomingAccountSummary[], plans: assessPlanOverlap(plans, cashflow, END) };
}

const fine = (count: number, offset = 0): Spec[] => Array.from({ length: count }, (_, i) => ({
  bank: BANKS[(i + offset) % BANKS.length],
  name: ["Current account", "Bills account", "Household account", "Everyday account"][(i + offset) % 4],
  balance: 400 + ((i * 137) % 600),
  bill: 20 + ((i * 11) % 60),
}));

/** Invented examples only. Every figure goes through the production walk and plan overlay. */
export function fixtureFor(id: FixtureId) {
  if (id === "long") {
    // 18 fine accounts; the short-for-payments and short-for-plans accounts sit in the middle of the list.
    const specs = fine(18);
    specs.splice(7, 0, { bank: "Barclays", name: "Bills account", balance: 30, bill: 120 });
    specs.splice(13, 0, { bank: "Monzo", name: "Everyday account", balance: 400, bill: 40 });
    const plans: Plan[] = [{ id: "savings", kind: "allocation", name: "Savings challenge", destination: "Challenge pot", destinationIds: ["challenge"], sourceId: "acct-13", evidence: "chosen", periodPence: 60000, filledPence: 0, remainingPence: 60000, active: true }];
    return { ...build(specs, plans), plansStatus: "ready" as const };
  }
  if (id === "watch") {
    const specs = fine(5);
    specs.splice(2, 0, { bank: "HSBC", name: "Current account", balance: 10, bill: 60, movement: true });
    return { ...build(specs), plansStatus: "ready" as const };
  }
  if (id === "clear") return { ...build(fine(6)), plansStatus: "ready" as const };
  return { ...build(fine(3).map((spec) => ({ ...spec, balance: 5, bill: 90 }))), plansStatus: "ready" as const };
}
