import { accountPaymentGap, type UpcomingAccountSummary } from "@/lib/upcomingAccounts";
import { shortDayMonth } from "./cardRepayment";
import { accountPlan, type Plan } from "@/lib/upcomingPlans";

export type AccountStatus = {
  amount: number | null;
  label: string;
  signal: "risk" | "plan" | "move" | "unknown" | null;
  estimated: boolean;
};

/** Presentation only. Preserve the account calculation's result precedence.
 * A payment gap is the walk's peak shortfall, not its closing balance. */
export function statusFor(account: UpcomingAccountSummary, plans: Plan[]): AccountStatus {
  const gap = accountPaymentGap(account);
  if (gap !== null) {
    // G410: a live suggested move covers (some of) the gap. Covered is watch (amber), never red;
    // whatever it would not cover stays a genuine short. A dismissed move leaves no earmark, so the row is plain short again.
    const suggestion = account.coverSuggestion;
    if (suggestion && account.status === "short") {
      const combinedGap = Math.max(gap, suggestion.shortfall ?? 0);
      const includesPlans = combinedGap > gap + 0.005;
      // The move pays the payment gap first. Any residue once that is covered
      // belongs to plans, so it is a watch state rather than a bill-risk red.
      const billsStillShort = suggestion.amount + 0.005 < gap;
      if (suggestion.shortAfterCover > 0) return { amount: suggestion.shortAfterCover, label: billsStillShort ? "Short after the suggested move" : "Short after the suggested move for plans", signal: billsStillShort ? "risk" : "plan", estimated: false };
      return { amount: combinedGap, label: includesPlans ? "Short for payments and plans, a move would cover it" : "Short, a move would cover it", signal: "move", estimated: false };
    }
    return { amount: gap, label: "Short for payments", signal: "risk", estimated: false };
  }
  const result = accountPlan(account, plans);
  if (result.uncertain) {
    return { amount: null, label: "Calculation needs checking", signal: "unknown", estimated: false };
  }
  if (result.afterPlans !== null && (result.assigned.length > 0 || (account.position?.plansReserved ?? 0) > 0)) {
    const short = (result.planGap ?? 0) > 0;
    if (short && account.coverSuggestion) {
      if (account.coverSuggestion.shortAfterCover > 0) return { amount: account.coverSuggestion.shortAfterCover, label: "Short after the suggested move", signal: "plan", estimated: result.estimated };
      return { amount: result.planGap! / 100, label: "Short for plans, a move would cover it", signal: "move", estimated: result.estimated };
    }
    return {
      amount: (short ? result.planGap! : result.afterPlans) / 100,
      label: short ? "Short for plans" : "Left after plans",
      signal: short ? "plan" : null,
      estimated: account.status === "covered" && result.estimated,
    };
  }
  if (account.status === "covered" && account.closing !== null) {
    return { amount: account.closing, label: "Left after payments", signal: null, estimated: false };
  }
  return { amount: null, label: "Coverage unavailable", signal: "unknown", estimated: false };
}

const gbp = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function money(value: number) {
  return `${value < 0 ? "−" : ""}£${gbp.format(Math.abs(value))}`;
}

/** Session-only memory of the By account fold (G229). Cleared on sign-out. */
export const FINE_FOLD_KEY = "wd_upcoming_accounts_fine_open";

/** G266: "£13.72 short for the NW World Mastercard repayment on 28 Oct". */
export function cardRepaymentShortCopy(account: UpcomingAccountSummary): string {
  const pence = Math.round((account.shortfall ?? 0) * 100);
  const amount = `£${(pence / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const target = account.shortFor;
  return target ? `${amount} short for the ${target.label} on ${shortDayMonth(target.date)}` : `${amount} short for payments`;
}
