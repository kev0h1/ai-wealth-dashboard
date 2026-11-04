import type { UpcomingAccountSummary } from "./upcomingAccounts";
import { accountPlan, type Plan } from "./upcomingPlans";
import { statusFor } from "./upcomingAccountStatus";
import { suggestedMovesFor } from "./coverSuggestion";

/** Whole-pound summaries keep meaningful penny-sized values and every sign. */
export function accountSummaryMoney(pence: number | null): string {
  if (pence === null || !Number.isFinite(pence)) return "Unavailable";
  const digits = Math.abs(pence) > 0 && Math.abs(pence) < 100 ? 2 : 0;
  return `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function accountReading(account: UpcomingAccountSummary, plans: Plan[], plansStatus: "loading" | "error" | "ready") {
  const ready = plansStatus === "ready";
  const visible = ready ? account : { ...account, position: undefined, coverSuggestion: undefined, suggestedMoves: [] };
  const result = accountPlan(visible, ready ? plans : []);
  const status = statusFor(visible, ready ? plans : []);
  const moves = ready ? suggestedMovesFor(account) : [];
  const raw = result.spendFromPence;
  const available = ready && !result.uncertain && account.status !== "unknown" && raw !== null && Number.isFinite(raw) ? Math.max(0, raw) : null;
  return { result, status: { ...status, signal: status.signal ?? (moves.length || account.position?.spendFromRequiresMove && ready ? "move" as const : null) }, moves, available };
}
