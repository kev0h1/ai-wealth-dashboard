import type { MoneyShape, MoneyShapeJob } from "@/lib/api";
import type { SectionId } from "@/lib/paySplitReference";

export type ScenarioId = "under" | "fixed" | "free" | "beyond" | "thin";
export type Driver = { label: string; amount: number };
export type Scenario = { id: ScenarioId; title: string; shape: MoneyShape; drivers: Record<SectionId, Driver[]> };
const emptyDrivers: Record<SectionId, Driver[]> = { fixed: [], free: [], moved: [] };
const whatWorks: MoneyShape["what_works"] = { state: "thin", periods_available: 1, periods_needed: 4, pattern_id: null, headline: "More complete periods are needed for a pattern.", flag_labels: null, evidence: [], trait: null, proposal: null };

function scenario(id: ScenarioId, title: string, fixed: number, free: number, moved: number): Scenario {
  const income = 4844;
  const total = fixed + free + moved;
  const base = Math.max(income, total);
  const left = Math.max(0, income - total);
  const amounts = { fixed, free, moved, left };
  const labels = { fixed: "Fixed", free: "Free", moved: "Moved", left: "Left over" };
  const categories = { fixed: ["Mortgage", "Loans", "Bills", "Groceries", "Transport"], free: ["Shopping", "Eating Out", "Entertainment"], moved: ["Savings", "Investment"], left: ["Salary"] };
  const jobs = (["fixed", "moved", "free", "left"] as const).map((job): MoneyShapeJob => ({ id: job, label: labels[job], amount: amounts[job], share: amounts[job] / base * 100, categories: categories[job], txn_type: job === "left" ? "credit" : "debit" }));
  const fixedCore = id === "beyond" ? [{ label: "Mortgage", amount: 1124 }, { label: "Car finance", amount: 429 }, { label: "Groceries", amount: 500 }, { label: "Transport", amount: 385 }, { label: "Household bills", amount: 320 }, { label: "Other commitments", amount: 78 }] : [{ label: "Mortgage", amount: 1124 }, { label: "Car finance", amount: 429 }, { label: "Other bills and commitments", amount: fixed - 1553 }];
  return { id, title, shape: { status: "ok", computed_at: "2026-10-16T09:00:00Z", period: { start: "2026-09-01", end: "2026-09-30", label: "Sep" }, take_home: income, overspent: Math.max(0, total - income), total_out: total, beyond: Math.max(0, total - income), beyond_source: null, card_growth: 0, savings_drawdown: 0, jobs, verdict: null, trend: { periods: [], fixed: [], moved: [], free: [], left: [] }, trend_line: null, what_works: whatWorks }, drivers: { fixed: fixedCore, free: [{ label: "Shopping", amount: Math.round(free * .45) }, { label: "Eating out", amount: Math.round(free * .35) }, { label: "Entertainment and other", amount: free - Math.round(free * .45) - Math.round(free * .35) }], moved: [{ label: "Savings", amount: 700 }, { label: "Investing", amount: moved - 700 }] } };
}

export const SCENARIOS: Scenario[] = [
  scenario("under", "Within reference costs", 2100, 1200, 1100),
  scenario("fixed", "Fixed above reference", 2700, 1100, 1000),
  scenario("free", "Free above reference", 1900, 1750, 1050),
  scenario("beyond", "Beyond income", 2836, 1552, 963),
  { id: "thin", title: "First full period pending", shape: { status: "thin", computed_at: "2026-10-16T09:00:00Z", period: null, take_home: 0, overspent: 0, jobs: null, verdict: null, trend: { periods: [], fixed: [], moved: [], free: [], left: [] }, trend_line: null, what_works: whatWorks }, drivers: emptyDrivers },
];
export function scenarioFor(value: string | null): Scenario { return SCENARIOS.find(item => item.id === value) ?? SCENARIOS[3]; }
// Synthetic evidence uses the same wire shape as the production engine.
for (const item of SCENARIOS) {
  for (const job of item.shape.jobs ?? []) {
    if (job.id !== "left") job.drivers = item.drivers[job.id].map(driver => ({ category: driver.label, amount: driver.amount }));
  }
}
