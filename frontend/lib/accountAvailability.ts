import type { Account, AccountEligibility } from "@/lib/api";
import { isCountedInLeftToSpend } from "@/lib/accountCounted";
import { accountKind } from "@/lib/accountKind";
import { coverSplitSentence, uncoveredSentence, type CoverSplit } from "@/lib/coverNarrative";

export type AccountAvailabilityReading =
  | { kind: "checking" | "unavailable" }
  | { kind: "ready"; value: number; warning?: "payments" | "plans"; note?: string; requiresMove?: boolean; coveredByMove?: { fromLabel: string; shortAfterCover: number; coversPlans?: boolean; split?: CoverSplit } };

export type AccountAvailabilitySnapshot = {
  status: "loading" | "ready" | "failed";
  positions?: Record<string, AccountEligibility> | null;
};

/**
 * G418: summary Available and Spend from figures use whole pounds, the same
 * rule as the Left to spend hero (formatSafeToSpendAmount): Intl rounding to
 * the nearest pound, halves away from zero, each figure rounded on its own, so
 * rows can differ from the rounded hero by a pound and callers never claim an
 * exact sum of rounded rows. A non-zero amount under £1 keeps its pence so it
 * never reads as £0. Working ledgers format their own exact pence.
 */
export function formatAvailabilityAmount(value: number): string {
  const abs = Math.abs(value);
  const pence = abs > 0 && abs < 1;
  return `${value < 0 ? "−" : ""}£${abs.toLocaleString("en-GB", {
    minimumFractionDigits: pence ? 2 : 0,
    maximumFractionDigits: pence ? 2 : 0,
  })}`;
}

/** Read the same conservative server limit as Spend from; never derive from bank balances or substitute the payday closing projection. */
export function accountAvailability(
  account: Account,
  snapshot: AccountAvailabilitySnapshot,
): AccountAvailabilityReading | undefined {
  if (accountKind(account) !== "Current" || account.manual || account.currency !== "GBP" || !isCountedInLeftToSpend(account)) return undefined;
  if (snapshot.status === "loading") return { kind: "checking" };
  if (snapshot.status !== "ready" || (account.status !== "connected" || account.paused)) return { kind: "unavailable" };
  const position = snapshot.positions?.[account.id];
  if (!position || position.uncertain || typeof position.after_payments_and_plans !== "number" || !Number.isFinite(position.after_payments_and_plans)) return { kind: "unavailable" };
  const value = position.spend_from_headroom;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { kind: "unavailable" };
  // G422: what an own-savings standing order explains is neither a payment nor
  // a plan shortfall. It is amber, carries the engine's own note, and never
  // shows the red payments warning.
  const savings = position.savings_at_risk && typeof position.savings_at_risk.amount === "number" && position.savings_at_risk.amount > 0 ? position.savings_at_risk : null;
  const savingsGap = savings ? savings.amount : 0;
  const rawPaymentShortfall = Math.max(0, ...[position.low_point, position.after_payments].filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map((v) => -v));
  const rawPlansShortfall = Math.max(0, ...[position.low_point_and_plans, position.after_payments_and_plans].filter((v): v is number => typeof v === "number" && Number.isFinite(v)).map((v) => -v));
  const paymentGap = savings ? rawPaymentShortfall - savingsGap > 0.005 : rawPaymentShortfall > 0;
  const paymentShortfall = savings ? Math.max(0, rawPaymentShortfall - savingsGap) : rawPaymentShortfall;
  const plansGap = savings ? rawPlansShortfall - savingsGap > 0.005 : rawPlansShortfall > 0;
  // G414: plans and set-asides use the same live cover-move contract as
  // payments. A dismissed or no-longer-needed move has no earmark, so the
  // underlying shortfall remains plain. The server remains the sole source.
  const warning = paymentGap ? "payments" : plansGap ? "plans" : undefined;
  // G428: current accounts cannot cover it alone, so one savings account is suggested for the rest.
  const savingsLeg = position.covered_by_move?.from.find((f) => f.source_kind === "savings");
  const split: CoverSplit | undefined = savingsLeg && typeof position.covered_by_move?.savings_amount === "number"
    ? { currentAmount: position.covered_by_move.current_amount ?? 0, savingsAmount: position.covered_by_move.savings_amount, savingsName: savingsLeg.display_label?.trim() || savingsLeg.name }
    : undefined;
  const covered = warning && position.covered_by_move && position.covered_by_move.amount > 0 && position.covered_by_move.from.length
    ? {
        fromLabel: new Set(position.covered_by_move.from.map((f) => f.account_id)).size > 1 ? `${new Set(position.covered_by_move.from.map((f) => f.account_id)).size} of your other accounts` : (position.covered_by_move.from[0].display_label?.trim() || position.covered_by_move.from[0].name),
        shortAfterCover: typeof position.short_after_cover === "number" ? position.short_after_cover : 0,
        ...(split ? { split } : {}),
        ...(paymentGap && typeof position.covered_by_move.shortfall === "number" && position.covered_by_move.shortfall > paymentShortfall + 0.005 ? { coversPlans: true } : {}),
      }
    : undefined;
  return {
    kind: "ready", value,
    warning,
    requiresMove: position.spend_from_requires_move === true,
    coveredByMove: covered,
    note: covered?.split ? `${covered.coversPlans ? "Payments and plans" : warning === "payments" ? "Payments" : "Plans"} look short this pay period. ${coverSplitSentence(covered.split, covered.shortAfterCover)} Open the account for the working.`
      : covered && covered.shortAfterCover > 0 && !covered.split && warning ? `${covered.coversPlans ? "Payments and plans" : warning === "payments" ? "Payments" : "Plans"} look short this pay period, even after the suggested move from ${covered.fromLabel}. ${uncoveredSentence(covered.shortAfterCover)} Open the account for the working.`
      : covered ? (covered.shortAfterCover > 0
        ? `${covered.coversPlans ? "Payments and plans" : warning === "payments" ? "Payments" : "Plans"} look short this pay period, even after the suggested move from ${covered.fromLabel}. Open the account for the working.`
        : `${covered.coversPlans ? "Payments and plans" : warning === "payments" ? "Payments" : "Plans"} look short this pay period, covered by the suggested move from ${covered.fromLabel}. Open the account for the working.`)
      : paymentGap ? "Payments look short this pay period. Open the account for the working."
      : plansGap ? "Short after plans this pay period. Open the account for the working."
      : savings ? savings.note
      : `Allocated from your shared Left to spend after known payments and plans this pay period${position.estimated ? "; some plan sources are estimated" : ""}${position.spend_from_requires_move ? ". This amount is available after the suggested move." : "."}`,
  };
}
