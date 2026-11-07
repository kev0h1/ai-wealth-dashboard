import type { SafeToSpend } from "./api";

type Forecast = Extract<SafeToSpend, { status: "ok" }>;
export type EvidenceRow = { label: string; value: number; total?: boolean; detail?: string };
export type LeftToSpendEvidence = {
  summaryLabel: string;
  summaryAmount: number;
  rows: EvidenceRow[];
  ledgerNote: string | null;
  dailyAmount: number | null;
  incomeBeforePayday: number | null;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pennies = (n: number) => Math.round(n * 100);

/** Presentation of server figures only. Never rebuild the dated cash walk:
 * the Home payload contains its minimum, but no dated/prefix decomposition.
 * An additive ledger is allowed only when the displayed pennies reconcile.
 */
export function buildLeftToSpendEvidence(data: Forecast, summaryAmount: number): LeftToSpendEvidence {
  const buffer = data.buffer;
  const plans = data.commitments_reserved ?? 0;
  const setAsides = data.allocations_reserved ?? 0;
  const cash = data.safe_to_spend_cash ?? data.safe_to_spend;
  const low = data.lowest_projected_balance;
  const income = data.income_before_payday;
  const values = [buffer, plans, setAsides, cash, data.safe_to_spend];
  const nonNegativeReserves = [buffer, plans, setAsides].every(n => finite(n) && n >= 0);
  const reconciledHold = nonNegativeReserves && values.every(finite) && pennies(cash) === pennies(data.safe_to_spend);
  const reconciledLow = finite(low) && nonNegativeReserves && values.every(finite)
    && pennies(low) - pennies(buffer) - pennies(plans) - pennies(setAsides) === pennies(cash);
  const reconciledEnd = reconciledLow && finite(data.spendable_now) && finite(data.bills_total) && data.bills_total >= 0 && finite(income) && income >= 0
    && pennies(data.spendable_now) - pennies(data.bills_total) + pennies(income) === pennies(low!);
  const rows: EvidenceRow[] = [];
  let ledgerNote: string | null = null;

  // G436: Left to spend is each counted current account on its own (balance plus predicted money
  // in, less predicted money out, negatives included), then goals, set-asides and the buffer.
  const lines = data.left_to_spend_lines;
  const byAccount = reconciledLow && !!lines && finite(lines.accounts_total) && pennies(lines.accounts_total) === pennies(low!);

  if (reconciledHold) {
    if (byAccount && lines) {
      rows.push({ label: "Your current accounts after predicted money in and out before payday", value: lines.accounts_total });
      ledgerNote = "Each current account on its own: its balance plus the money expected in, less the payments expected out. A move between your own accounts does not change it.";
    } else if (reconciledEnd) {
      rows.push({ label: "Cash now", value: data.spendable_now! });
      if (data.bills_total > 0) rows.push({ label: "Bills before payday", value: -data.bills_total });
      if (income > 0) rows.push({ label: "Income before payday", value: income });
    } else if (reconciledLow) {
      rows.push({ label: "Lowest cash before payday", value: low! });
      ledgerNote = "This uses the lowest cash forecast, rather than the ending balance. Income elsewhere in the period may not cover an earlier gap.";
    } else {
      rows.push({ label: "Cash after bills, buffer and plans", value: cash });
      ledgerNote = "The dated breakdown is not available in this snapshot. This starts with the cash forecast after bills, buffer, plans and set-asides.";
    }
    if (reconciledLow) {
      if (buffer > 0) rows.push({ label: "Buffer", value: -buffer });
      if (plans > 0) rows.push({ label: "Goal contributions", value: -plans });
      if (setAsides > 0) rows.push({ label: "Set-asides", value: -setAsides });
    }
    rows.push({ label: "Left to spend", value: data.safe_to_spend, total: true });
    if (!reconciledEnd && rows.length === 2 && pennies(rows[0].value) === pennies(rows[1].value)) {
      rows.shift();
      if (reconciledLow) rows[0].label = "Left to spend at the cash low point";
    }
  } else {
    // Older/mixed snapshots cannot justify an equation. Show the supplied
    // estimate without manufacturing an operand to force it to add up.
    rows.push({ label: "Left to spend estimate", value: data.safe_to_spend, total: true });
    ledgerNote = "The detailed working is not available for this snapshot. Check your bank for the latest balances.";
  }

  const pace = data.pace;
  rows[0].detail = "Across counted current accounts.";
  return {
    summaryLabel: summaryAmount === 0 ? "How we worked this out" : "How we got",
    summaryAmount, rows, ledgerNote,
    dailyAmount: pace && ["comfortable", "on_pace", "ahead", "early"].includes(pace.state) && finite(pace.sustainable) && pace.sustainable >= 0 ? pace.sustainable : null,
    incomeBeforePayday: !reconciledEnd && finite(income) && income > 0 ? income : null,
  };
}
