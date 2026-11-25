// G475: card repayment plans. A plan is a commitment whose target is a card, so
// it reuses the goal sheet; this file holds the few pure helpers and every
// word the Debt row and the sheet say about one. Copy rules: British English,
// no em dashes, no exclamation marks, predictions are hedged ("about",
// "would"), never advice to pay a particular card, red is not used here.
import type { Account, CardPlanFacts, CardRepayment, Commitment } from "@/lib/api";

export const CARD_PLAN_KIND = "card_repayment";

export function isCardPlan(item: Pick<Commitment, "plan_kind"> | null | undefined): boolean {
  return item?.plan_kind === CARD_PLAN_KIND;
}

/** A credit card, by the same type and subtype words the rest of the app reads. */
export function isCardAccount(account: Pick<Account, "type" | "subtype">): boolean {
  return `${account.type ?? ""} ${account.subtype ?? ""}`.toLowerCase().includes("credit");
}

const gbp = (value: number) => `£${Math.round(value).toLocaleString("en-GB")}`;
const gbp2 = (value: number) => `£${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const exactMoney = (value: number) => Number.isInteger(value) ? gbp(value) : gbp2(value);
/** Stored card-plan amounts retain pence when present, but never manufacture .00. */
export const cardPlanMoney = (value: number) => exactMoney(value);

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "date unavailable";
}

/** "£150 a pay period" or "£150 each pay period (monthly)": the plan's amount for the live period. */
export function planAmountLine(facts: CardPlanFacts | null | undefined, periodLabel: string | null | undefined): string {
  if (facts?.status === "pending") return "Preparing plan figures";
  if (facts?.status === "stale" || facts?.status === "unavailable") return "Plan figures unavailable";
  const planned = facts?.display_period_planned ?? facts?.this_period_planned;
  if (planned == null) return "Amount unavailable";
  if (facts?.schedule_state === "paused") return "Plan paused";
  if (facts?.schedule_state === "ended") return "Schedule ended";
  if (facts?.final_period_amount) return `${exactMoney(planned)} planned this pay period`;
  if (facts?.amount_varies) return `${exactMoney(planned)} planned ${facts.schedule_state === "not_started" ? "next pay period" : "this pay period"}`;
  const cadence = periodLabel ? `each pay period (${periodLabel})` : "a pay period";
  const starts = facts?.schedule_state === "not_started" && facts.starts_on ? ` from ${longDate(facts.starts_on)}` : "";
  return `${exactMoney(planned)} ${cadence}${starts}`;
}

/** What has been paid towards this period's amount. Never a promise. */
export function paidLine(facts: CardPlanFacts | null | undefined): string | null {
  if (!facts || facts.this_period_planned == null) return null;
  if (facts.schedule_state === "not_started" && facts.starts_on) return `Repayments count from ${longDate(facts.starts_on)}`;
  if (facts.paid_this_period == null) return "Payment data unavailable";
  const paid = facts.paid_this_period;
  if (paid <= 0) return "Nothing paid yet this pay period";
  return `${gbp2(paid)} paid to this card this pay period`;
}

/**
 * G492's conservative, persisted finish line. Do not fall back to the legacy
 * `would_clear_by`: it has no offer-bound provenance and may be stale.
 */
export function projectedMonthLine(facts: CardPlanFacts | null | undefined): string | null {
  if (facts?.status !== "ready") return "Finish date unavailable";
  const finish = facts?.finish_estimate;
  if (!finish) return "Finish date unavailable";
  if (finish.status === "ready" && finish.basis === "before_offer_end" && typeof finish.label === "string" && finish.label.trim()) return `Estimated finish ${finish.label}`;
  if (finish.status !== "unavailable") return "Finish date unavailable";
  switch (finish.reason) {
    case "no_payoff": return "No finish date on this plan";
    case "future_plan": return "Finish date not available yet";
    case "paused": return "Plan paused.";
    case "ended": return "Schedule ended";
    case "balance_cleared": return "Balance cleared";
    default: return "Finish date unavailable";
  }
}

/** The one offer deadline the compact row may surface. Its value is stored, never derived. */
export function offerDeadlineLine(facts: CardPlanFacts | null | undefined): string | null {
  const offer = facts?.status === "ready" ? facts.promo : null;
  if (!offer?.until) return null;
  return `Offer ends ${longDate(offer.until)}`;
}

/**
 * Evidence stays in the existing sheet. Every figure below comes straight
 * from the persisted snapshot, so an omitted/stale fact remains omitted.
 */
export function cardPlanEvidenceLines(facts: CardPlanFacts | null | undefined): string[] {
  if (facts?.status !== "ready") return [facts?.status === "pending" ? "Preparing plan figures" : "Plan figures unavailable"];
  const lines: string[] = [];
  const offer = facts.promo;
  const progress = offer?.progress;
  if (progress?.status === "ready") {
    if (progress.paid != null && progress.target != null) lines.push(`Repaid ${cardPlanMoney(progress.paid)} of ${cardPlanMoney(progress.target)}`);
    if (progress.expected_by_now != null) lines.push(`Expected by now ${cardPlanMoney(progress.expected_by_now)}`);
  }
  if (facts.this_period_planned != null) lines.push(`Planned this pay period ${cardPlanMoney(facts.this_period_planned)}`);
  if (facts.paid_this_period != null) lines.push(`Paid this pay period ${cardPlanMoney(facts.paid_this_period)}`);
  if (facts.paid_from_source_this_period != null) lines.push(`Paid from your account this pay period ${cardPlanMoney(facts.paid_from_source_this_period)}`);
  if (facts.reserved_from_source_this_period != null) lines.push(`Reserved from your account this pay period ${cardPlanMoney(facts.reserved_from_source_this_period)}`);
  const deadline = offerDeadlineLine(facts);
  if (deadline) lines.push(deadline);
  if (offer?.residual_at_end != null) lines.push(`Residual at offer end ${cardPlanMoney(offer.residual_at_end)}`);
  if (offer?.outlook === "on_track") lines.push("Offer outlook: on track");
  if (offer?.outlook === "short") lines.push("Offer outlook: short at the offer end");
  if (offer?.outlook === "behind") lines.push("Offer outlook: behind expected progress");
  if (offer?.outlook === "paused") lines.push("Offer outlook: paused");
  const finish = facts.finish_estimate;
  lines.push(finish?.status === "unavailable" && finish.reason === "no_payoff" ? "No finish estimate is available from the saved plan and current data" : projectedMonthLine(facts) ?? "Finish date unavailable");
  return lines;
}

/** A fact about an offer with an end date, never advice. Null when the card has none. */
export function offerLine(facts: CardPlanFacts | null | undefined): string | null {
  const promo = facts?.promo;
  if (!promo) return null;
  if (promo.planned_by_end == null || promo.balance == null || promo.residual_at_end == null) return "Offer projection unavailable";
  const by = `${gbp(promo.planned_by_end)} by ${longDate(promo.until)}`;
  const against = promo.balance_is_offer ? "the offer balance" : "the card balance";
  if (promo.clears_before_end) {
    return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would cover ${against} of about ${gbp(promo.balance)}.`;
  }
  return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would leave about ${gbp(promo.residual_at_end)} of ${against} when it ends.`;
}

/** What the sheet says about where a prefilled amount came from. */
export function prefillBasisLine(basis: string | null | undefined, estimated: boolean): string | null {
  if (!basis) return null;
  const what = basis === "direct_debit" ? "your usual direct debit" : basis === "fixed_payment" ? "the fixed payment on this card" : basis === "usual_repayments" ? "what you usually pay this card" : "the statement estimate";
  return `${estimated ? "About, from" : "From"} ${what}. Change it if you like.`;
}

/** G476: "£200.00 on 24 Sep" style date for a repayment row. */
export function shortRepaymentDate(iso: string | null | undefined): string {
  if (!iso) return "date unavailable";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "date unavailable";
}

/** One repayment row, hedged: "About £200.00 on 24 Sep from Example Current". */
export function repaymentLine(item: CardRepayment): string {
  const from = item.source_account_name ? ` from ${item.source_account_name}` : "";
  const tail = item.matched ? "" : ", paying account not found";
  return `About ${gbp2(item.amount)} on ${shortRepaymentDate(item.date)}${from}${tail}`;
}

/** The newest repayment whose paying debit was found for this account and gives a rule to track. */
export function legMatchFor(repayments: readonly CardRepayment[] | null | undefined, sourceId: string | null | undefined): CardRepayment | null {
  if (!sourceId) return null;
  return (repayments ?? []).find(item => item.matched && item.source_account_id === sourceId && item.fill_rule) ?? null;
}

/** What the automatic card-leg match found, in words. */
export function legMatchLine(item: CardRepayment): string {
  const left = shortRepaymentDate(item.debit_date ?? item.date);
  const arrived = shortRepaymentDate(item.card_date);
  const from = item.source_account_name ?? "your account";
  return `Found a payment of about ${gbp2(item.amount)} that left ${from} on ${left} and appeared on the card on ${arrived}. It is tracked unless you choose another.`;
}

export const CARD_PLAN_COPY = {
  exactWording: "This matches this exact wording, so a payment with a different reference may not be recognised.",
  chooseDifferent: "Choose a different payment",
  recentTitle: "Recent repayments",
  recentHelper: "From this card's own history. Tap one to use its amount.",
  sourcePick: "These came from more than one account. Choose the one this plan should use.",
  noHistory: "No recent repayments found on this card.",
  creditsTitle: "Recent payments into the card",
  creditsHelper: "We could not match one to a payment from your account automatically. Pick one below, or search.",
  searchLabel: "Search the card and your paying account",
  searchHelper: "By words in the bank's own description (for example PAYMENT RECEIVED) or by amount.",
  searchEmpty: "Nothing found in the last 180 days on these two accounts.",
  searchUnmatched: "Could not be matched to a payment from your paying account.",
  setPlan: "Set a plan",
  debtFootnote: "The amounts above add up to the total owed. Balances stay in Accounts. Each card can have one repayment plan, set here.",
  emptyHint: "A plan replaces that card's usual payment in your figures, so it is counted once.",
  deleteConfirm: "Delete this plan? That card's usual payment counts again. Nothing is paid or moved.",
  purpose: "Choose a card",
  noCards: "No credit card is connected. Connect a card in Accounts first.",
  allCardsHavePlans: "Every connected card already has a plan.",
  moneyNote: "Saving changes this plan only. It does not move money.",
} as const;
