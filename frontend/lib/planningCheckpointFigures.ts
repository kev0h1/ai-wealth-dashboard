import type { GrowView } from "@wealth/shared";

export type CheckpointFigures = Record<string, { amount: number; label: string }>;

/** Display operands for the existing /grow checkpoints, not a second plan.
 * Essentials excludes debt repayments; the full-fund rung has a fixed
 * three-month lens, unlike the user's configurable Cash and investments target.
 * Keep these lenses in sync with backend/app/routers/grow.py's ladder.
 */
export function planningCheckpointFigures(view: GrowView): CheckpointFigures {
  const figures: CheckpointFigures = {};
  const income = view.surplus_ledger?.income;
  const spending = view.surplus_ledger?.spending;
  const validIncome = typeof income === "number" && Number.isFinite(income);
  const validSpending = typeof spending === "number" && Number.isFinite(spending);

  if (validIncome && validSpending && (income > 0 || spending > 0)) {
    const balance = income - spending;
    figures.essentials = { amount: balance, label: balance < 0 ? "Monthly gap" : "Monthly spare" };
  }
  if (validSpending && spending > 0) {
    if (Number.isFinite(view.buffer.current)) {
      figures.starter_buffer = { amount: view.buffer.current, label: "Saved" };
    }
    figures.full_fund = { amount: spending * 3, label: "3-month target" };
  }
  if (Number.isFinite(view.debt.expensive_total)) {
    figures.expensive_debt = { amount: view.debt.expensive_total, label: "Interest-bearing" };
  }
  if (view.invest.has_investments && Number.isFinite(view.invest.portfolio_value)) {
    figures.isa_invest = { amount: view.invest.portfolio_value, label: "Invested" };
  }
  return figures;
}
