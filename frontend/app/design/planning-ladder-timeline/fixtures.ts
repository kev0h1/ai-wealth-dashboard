// Invented, reconciled fixtures. All seven production priorities retain their order.
import type { GrowLadderStep, GrowView } from "@wealth/shared";
import type { Commitment, DebtPlanSummary } from "@/lib/api";

export type Scenario = "buffer" | "debt" | "goals" | "done" | "empty" | "hidden" | "long" | "attention" | "neutral";
export type CheckpointMeta = Record<string, { figure?: string; figureLabel?: string; summary?: string; attention?: "watch" | "risk" }>;
export const SCENARIOS: Scenario[] = ["buffer", "debt", "goals", "done", "empty", "hidden", "long", "attention", "neutral"];
export const scenarioLabel: Record<Scenario, string> = { buffer: "Active buffer", debt: "Active debt", goals: "Investing stage", done: "All done", empty: "No ladder", hidden: "Hidden balances", long: "Long names", attention: "Needs attention", neutral: "Neutral locked" };
export const TODAY = new Date("2026-10-06T12:00:00Z");
export const ORDER = ["essentials", "pension_match", "starter_buffer", "expensive_debt", "full_fund", "pension_topup", "isa_invest"] as const;
const whole = (value: number) => "£" + value.toLocaleString("en-GB");

export function fixtureFor(scenario: Scenario) {
  const complete = scenario === "done";
  const investing = scenario === "goals" || complete;
  const balance = investing ? 4500 : scenario === "debt" ? 1500 : 900;
  const interestDebt = investing ? 0 : 2400;
  const debtPayment = interestDebt ? 400 : 0;
  // The fixture deliberately mirrors /grow's distinct lenses: essentials is
  // income minus spending before debt, while the verdict also deducts debt.
  const income = 2520;
  const spending = 1500;
  const essentialsSpare = income - spending;
  const fullFundTarget = spending * 3;
  const surplus = income - spending - debtPayment;
  const short = scenario === "attention";
  const activeIndex = scenario === "neutral" ? -1 : scenario === "debt" ? 3 : investing ? 6 : 2;
  const titles = ["Essentials", "Employer pension match", "Starter buffer", "Expensive debt", "Full emergency fund", "Pension top-up", "ISA / general investing"];
  const details = [
    "Your typical income covers everyday spending, leaving " + whole(essentialsSpare) + " before planned debt repayments.",
    "Your contributions meet the employer match recorded for this example.",
    balance >= 1500 ? "Your £1,500 starter-buffer target is met." : "£900 saved towards your £1,500 starter-buffer target.",
    interestDebt ? "£2,400 remains on an interest-bearing card, with £400 a month planned." : "There is no interest-bearing debt left in this example.",
    balance >= fullFundTarget ? "Your £4,500 emergency-fund target is met." : "Your longer-term cash target is £4,500, equal to three months of essential spending.",
    investing ? "Your pension top-up decision for this example is complete." : "Review pension contributions once the earlier priorities are covered.",
    complete ? "Your investing decision for this example is complete. Review it when your circumstances change." : investing ? "Your buffer and expensive debt checkpoints are covered. Review how to fund longer-term goals." : "Review investing once the buffer is funded and expensive debt is cleared.",
  ];
  const ladder: GrowLadderStep[] = scenario === "empty" ? [] : ORDER.map((key, index) => {
    const state: GrowLadderStep["state"] = complete ? "done" : activeIndex === -1 ? (index < 2 ? "done" : "locked") : index < activeIndex ? "done" : index === activeIndex ? (short ? "attention" : "active") : "locked";
    return {
      key, title: scenario === "long" && key === "starter_buffer" ? "Build a dependable emergency buffer for your household" : titles[index],
      state, detail: details[index],
      options: state === "active" || state === "attention" ? [short ? "Check the current-period payments before adding to this buffer." : "Review this checkpoint before moving on to the next priority."] : [],
    };
  });
  const view: GrowView = {
    verdict: { headline: "You have " + whole(surplus) + " spare in a typical month", sub: "Your buffer covers " + balance / 50 + " days" },
    surplus_monthly: surplus,
    surplus_ledger: { income, spending, debt_deduction: debtPayment, debt_deducted: debtPayment > 0, surplus, n_months: 3, month_labels: ["Jul", "Aug", "Sep"] },
    period_gate: { short, to_cover: short ? 180 : 0, period_end: "2026-10-25" },
    buffer: { current: balance, target: 4500, pct: balance / 45, days_covered: balance / 50, target_months: 3 },
    debt: { has_debt: interestDebt > 0, total: interestDebt, all_promo: false, expensive_total: interestDebt, promo_cliff: null },
    invest: { portfolio_value: complete ? 8000 : 0, has_investments: complete }, ladder, notes: [],
  };
  const debt: DebtPlanSummary = {
    totals: { buckets: { carried_total: interestDebt, float_total: 0 }, monthly_payment: debtPayment },
    cards: interestDebt ? [{ account_id: "fixture-card", name: "Fixture credit card", debt: interestDebt, currency: "GBP", classification: "carried_interest", monthly: debtPayment, rate_schedule: [{ from: "2026-01", until: null, apr_pct: 24.9, source: "standard", kind: null }] }] : [],
  };
  const goals: Commitment[] = complete ? [] : [{ id: "fixture-goal", name: "Home deposit", amount: 6000, target_date: "2027-10-01", funding_account_id: null, funding_account_name: null, source: "manual", status: "active", progress: 3000, remaining: 3000, periods_left: 12, per_period_slice: 250, period_label: "monthly", on_track: true, feasibility: "surplus", feasibility_tone: null, shared_pot_goals: [] }];
  const metadata: CheckpointMeta = {
    essentials: { figure: whole(essentialsSpare), figureLabel: "Monthly spare", summary: "Everyday spending fits within your typical income before planned debt repayments." },
    starter_buffer: { figure: balance >= 1500 ? "£1,500" : "£900", figureLabel: balance >= 1500 ? "Target met" : "Saved", summary: balance >= 1500 ? "Your starter-buffer target is met." : "The starter-buffer target is £1,500.", ...(short ? { attention: "watch" as const } : {}) },
    expensive_debt: { figure: whole(interestDebt), figureLabel: "Interest-bearing", summary: interestDebt ? "This card balance is charging interest, with £400 a month planned." : "There is no interest-bearing balance left." },
    full_fund: { figure: whole(fullFundTarget), figureLabel: investing ? "Target met" : "Target", summary: investing ? "Three months of essential spending is covered." : "Build towards three months of essential spending." },
    isa_invest: complete ? { figure: "£8,000", figureLabel: "Invested", summary: details[6] } : { summary: details[6] },
  };
  return { view, debt, goals, hideValues: scenario === "hidden", metadata };
}
