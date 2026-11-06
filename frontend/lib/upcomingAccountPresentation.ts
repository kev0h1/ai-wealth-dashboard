import { accountPaymentGap, type UpcomingAccountSummary, type UpcomingSuggestedMove } from "./upcomingAccounts";
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

const finitePence = (pounds: number | null | undefined) => {
  const pence = typeof pounds === "number" && Number.isFinite(pounds) ? Math.round(pounds * 100) : null;
  return pence !== null && Number.isSafeInteger(pence) ? pence : null;
};

/** G417: an action reading before suggested moves, independent of the pooled
 * spending allocation. The engine's balances and payment gap remain authoritative. */
export function accountActionReading(account: UpcomingAccountSummary, plans: Plan[], plansStatus: "loading" | "error" | "ready") {
  const ready = plansStatus === "ready";
  const result = accountPlan(account, ready ? plans : []);
  const afterPayments = Number.isSafeInteger(result.afterPayments) ? result.afterPayments : null;
  const combinedKnown = ready && !result.uncertain && account.status !== "unknown" && result.afterPlans !== null && Number.isSafeInteger(result.afterPlans);
  const afterPlans = combinedKnown ? result.afterPlans : null;
  const paymentGap = finitePence(accountPaymentGap(account)) ?? 0;
  const transferGap = account.status === "unfunded" ? Math.max(0, finitePence(account.shortfall) ?? 0) : 0;
  const lowAfterPlans = combinedKnown ? finitePence(account.position?.lowPointAndPlans) : null;
  const gap = Math.max(paymentGap, transferGap, -(afterPlans ?? afterPayments ?? 0), -(lowAfterPlans ?? 0), 0);
  const closingGap = Math.max(0, -(afterPlans ?? afterPayments ?? 0));
  const earlierGap = gap > closingGap;
  const headline = gap > 0 ? -gap : afterPlans ?? afterPayments;
  // A cover mark cannot create a credit after the current payment/plan gap has
  // disappeared. Outgoing earmarks still describe their own source allocation.
  const moves: UpcomingSuggestedMove[] = ready ? suggestedMovesFor(account).filter(move => move.amount < 0 || gap > 0) : [];
  // An old API can supply a validated cover sentence without account-position
  // legs. Keep its recommendation, but never invent a deadline or payment event.
  const legacy = !account.position && account.coverSuggestion;
  const legacyPence = legacy ? finitePence(legacy.amount) : null;
  const legacyResidual = legacy ? finitePence(legacy.shortAfterCover) : null;
  if (ready && account.status === "short" && paymentGap > 0 && !moves.length && legacy && legacyPence !== null && Number.isSafeInteger(legacyPence) && legacyPence > 0
    && legacyResidual !== null && legacyResidual >= Math.max(0, paymentGap - legacyPence) && legacyResidual <= Math.max(0, gap - legacyPence)
    && Number.isSafeInteger(legacy.fromCount) && legacy.fromCount > 0
    && Math.abs(legacy.amount * 100 - legacyPence) < 1e-6 && typeof legacy.fromName === "string" && legacy.fromName.trim()) {
    moves.push({ id: `legacy-cover:${account.id}`, counterpartId: "legacy-cover", counterpartName: legacy.fromCount > 1 ? `${legacy.fromCount} other accounts` : legacy.fromName, amount: legacyPence / 100, byDate: null });
  }
  const incoming = moves.reduce((sum, move) => sum + Math.max(0, Math.round(move.amount * 100)), 0);
  const outgoing = moves.reduce((sum, move) => sum + Math.max(0, Math.round(-move.amount * 100)), 0);
  const netMove = incoming - outgoing;
  const afterMove = moves.length && afterPlans !== null ? afterPlans + netMove : null;
  // A positive closing result is not proof that an earlier payment is covered.
  const remainingGap = gap > 0 ? Math.max(0, gap - netMove) : Math.max(0, -(afterMove ?? 0));
  const signal = paymentGap > 0 && paymentGap > Math.max(0, netMove) ? "risk" as const
    : account.status === "unknown" || ready && !combinedKnown ? "unknown" as const
    : gap > 0 ? paymentGap > 0 && remainingGap === 0 ? "move" as const : transferGap > 0 ? "move" as const : "plan" as const
    : moves.length ? "move" as const : null;
  const hasPlans = combinedKnown && (result.reservedPence > 0 || result.assigned.length > 0);
  const caption = headline === null ? "Check balance" : gap > 0 ? earlierGap ? "Short before payday" : transferGap > 0 && paymentGap === 0 ? "Short for transfers" : "Short"
    : ready && !combinedKnown ? "Payments only" : hasPlans ? "Left after plans" : "Left after payments";
  const futureIncome = earlierGap && paymentGap > 0 && account.firstShortDate !== null
    && account.events.some(event => event.credited !== false && event.kind === "income" && event.date > account.firstShortDate!);
  return { result, ready, combinedKnown, afterPayments, afterPlans, headline, gap, paymentGap, transferGap, earlierGap, moves, incoming, outgoing, afterMove, remainingGap, signal, hasPlans, caption, futureIncome };
}

const upFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const exactMoney = (pence: number) => `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** G421: the sources of a suggested cover as short rows (name and amount), never an and-chain.
 * The engine uses at most two sources. An older payload with more shows its largest and one combined row. */
export function accountMoveRows(moves: readonly UpcomingSuggestedMove[]): { name: string; amount: string }[] {
  const incoming = moves.filter(move => move.amount > 0).map(move => ({ name: upFirst(move.counterpartName), pence: Math.round(move.amount * 100) })).sort((a, b) => b.pence - a.pence);
  const rows = incoming.length <= 2 ? incoming : [incoming[0], { name: `${incoming.length - 1} other accounts`, pence: incoming.slice(1).reduce((sum, row) => sum + row.pence, 0) }];
  return rows.map(row => ({ name: row.name, amount: exactMoney(row.pence) }));
}

export function accountActionNote(account: UpcomingAccountSummary, reading: ReturnType<typeof accountActionReading>) {
  const { result, ready, combinedKnown, headline, gap, paymentGap, earlierGap, moves, incoming, outgoing, afterMove, remainingGap, signal, futureIncome } = reading;
  const exact = (pence: number) => `${pence < 0 ? "−" : ""}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
  const to = moves.filter(move => move.amount < 0).map(move => move.counterpartName).join(" and ");
  if (headline === null) return "This account’s balance needs checking.";
  if (!ready) return "Payments only. Plans are still to be checked.";
  if (incoming || outgoing) {
    const move = incoming && outgoing ? `${exact(incoming)} suggested in; ${exact(outgoing)} set aside for ${to}.`
      : outgoing ? `${exact(outgoing)} set aside for ${to}.`
      : `A ${exact(incoming)} move ${afterMove !== null && remainingGap === 0 ? "covers it" : "would help"}.`;
    if (afterMove === null) return `${move} The full result still needs checking.`;
    return `${move} ${accountSummaryMoney(afterMove)} after the ${moves.length === 1 ? "move" : "moves"}${remainingGap > 0 && afterMove < 0 ? ", still short" : ""}.${remainingGap > 0 && afterMove >= 0 ? ` An earlier gap of ${exact(remainingGap)} still needs covering.` : ""}`;
  }
  if (!combinedKnown) return "Payments only. Plans need checking.";
  if (earlierGap) return `${futureIncome ? "Income arrives after a payment falls due." : paymentGap > 0 ? "An earlier payment needs covering." : "Plans need money earlier in this period."} ${accountSummaryMoney(reading.afterPlans)} left at the end of the period.`;
  if (signal === "risk") {
    const date = account.firstShortDate && new Date(`${account.firstShortDate.slice(0, 10)}T12:00:00Z`);
    const when = date && Number.isFinite(date.getTime()) ? ` by ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}` : "";
    return `Payments need more money${when}. Tap to see the gap.`;
  }
  // G426: an own-savings standing order says so in the engine's plain wording; the "may stay put" line is for a move into another own spendable account.
  if (reading.transferGap > 0) return account.position?.savingsAtRisk?.note ?? "A planned move is not fully funded when it leaves. It may stay put, with no fee.";
  if (gap > 0) return `Payments are covered. More money is needed for ${result.assigned.length === 1 ? result.assigned[0].name : "your plans"}.${result.estimated ? " Paying account based on recent transfers." : ""}`;
  return result.estimated ? "Paying account based on recent transfers." : "";
}
