import type { Account, AccountEligibility } from "@/lib/api";
import { accountKind } from "@/lib/accountKind";

export type AccountAvailabilityReading =
  | { kind: "checking" | "unavailable" }
  | { kind: "ready"; value: number; warning?: "payments" | "plans"; note?: string; coveredByMove?: { fromLabel: string; shortAfterCover: number } };

export type AccountAvailabilitySnapshot = {
  status: "loading" | "ready" | "failed";
  positions?: Record<string, AccountEligibility> | null;
};

export function formatAvailabilityAmount(value: number): string {
  return `${value < 0 ? "−" : ""}£${Math.abs(value).toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Read the same conservative server limit as Spend from; never derive from bank balances or substitute the payday closing projection. */
export function accountAvailability(
  account: Account,
  snapshot: AccountAvailabilitySnapshot,
): AccountAvailabilityReading | undefined {
  if (accountKind(account) !== "Current" || account.manual || account.currency !== "GBP" || account.include_in_safe_to_spend === false) return undefined;
  if (snapshot.status === "loading") return { kind: "checking" };
  if (snapshot.status !== "ready" || (account.status !== "connected" || account.paused)) return { kind: "unavailable" };
  const position = snapshot.positions?.[account.id];
  if (!position || position.uncertain || typeof position.after_payments_and_plans !== "number" || !Number.isFinite(position.after_payments_and_plans)) return { kind: "unavailable" };
  const value = position.spend_from_headroom;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { kind: "unavailable" };
  const paymentGap = [position.low_point, position.after_payments].some(v => typeof v === "number" && Number.isFinite(v) && v < 0);
  const plansGap = [position.low_point_and_plans, position.after_payments_and_plans].some(v => typeof v === "number" && Number.isFinite(v) && v < 0);
  // G410: a live suggested move covers (some of) a payment gap. The engine decides (same legs and gate
  // as the move card), so a dismissed or no-longer-needed move has no earmark and this is plain short.
  const covered = paymentGap && position.covered_by_move && position.covered_by_move.amount > 0 && position.covered_by_move.from.length
    ? {
        fromLabel: new Set(position.covered_by_move.from.map((f) => f.account_id)).size > 1 ? `${new Set(position.covered_by_move.from.map((f) => f.account_id)).size} of your other accounts` : position.covered_by_move.from[0].name,
        shortAfterCover: typeof position.short_after_cover === "number" ? position.short_after_cover : 0,
      }
    : undefined;
  return {
    kind: "ready", value,
    warning: paymentGap ? "payments" : plansGap ? "plans" : undefined,
    coveredByMove: covered,
    note: covered ? (covered.shortAfterCover > 0
        ? `Payments look short this pay period, even after the suggested move from ${covered.fromLabel}. Open the account for the working.`
        : `Payments look short this pay period, covered by the suggested move from ${covered.fromLabel}. Open the account for the working.`)
      : paymentGap ? "Payments look short this pay period. Open the account for the working."
      : plansGap ? "Short after plans this pay period. Open the account for the working."
      : `Estimated limit after known payments and plans this pay period${position.estimated ? "; some plan sources are estimated" : ""}. Separate account limits, not amounts to add together.`,
  };
}
