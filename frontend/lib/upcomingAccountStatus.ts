import type { UpcomingAccountSummary } from "@/lib/upcomingAccounts";
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
  if (account.status === "short" && account.shortfall !== null) {
    return { amount: account.shortfall, label: "Short for payments", signal: "risk", estimated: false };
  }
  if (account.status === "unfunded" && account.shortfall !== null) {
    return { amount: account.shortfall, label: "Short for transfers", signal: "move", estimated: false };
  }
  const result = accountPlan(account, plans);
  if (result.uncertain) {
    return { amount: null, label: "Calculation needs checking", signal: "unknown", estimated: false };
  }
  if (result.assigned.length && result.afterPlans !== null) {
    const short = (result.planGap ?? 0) > 0;
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
