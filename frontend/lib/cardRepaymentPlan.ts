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

function longDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "date unavailable";
}

/** "£150 a pay period" or "£150 each pay period (monthly)": the plan's amount for the live period. */
export function planAmountLine(facts: CardPlanFacts | null | undefined, periodLabel: string | null | undefined): string {
  const planned = facts?.this_period_planned;
  if (planned == null) return "Amount unavailable";
  const cadence = periodLabel ? `each pay period (${periodLabel})` : "a pay period";
  return `${gbp(planned)} ${cadence}`;
}

/** What has been paid towards this period's amount. Never a promise. */
export function paidLine(facts: CardPlanFacts | null | undefined): string | null {
  if (!facts || facts.this_period_planned == null) return null;
  const paid = facts.paid_this_period ?? 0;
  if (paid <= 0) return "Nothing paid yet this pay period";
  return `${gbp2(paid)} paid this pay period`;
}

/** "would clear by Mar 2028": hedged, and silent when the balance is cleared or no month is known. */
export function projectedMonthLine(facts: CardPlanFacts | null | undefined): string | null {
  if (!facts?.would_clear_by) return null;
  return `At this pace it would clear by about ${facts.would_clear_by}`;
}

/** A fact about an offer with an end date, never advice. Null when the card has none. */
export function offerLine(facts: CardPlanFacts | null | undefined): string | null {
  const promo = facts?.promo;
  if (!promo) return null;
  const by = `${gbp(promo.planned_by_end)} by ${longDate(promo.until)}`;
  const against = promo.balance_is_offer ? "the offer balance" : "the card balance";
  if (promo.clears_before_end) {
    return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would cover ${against} of about ${gbp(promo.balance)}.`;
  }
  const left = Math.max(0, promo.balance - promo.planned_by_end);
  return `The offer ends ${longDate(promo.until)}. The plan would pay about ${by}, which would leave about ${gbp(left)} of ${against} when it ends.`;
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
